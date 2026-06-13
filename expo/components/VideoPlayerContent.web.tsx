import React, { forwardRef, useImperativeHandle, useEffect, useRef, useCallback } from "react";
import { View, StyleSheet, Platform, type ViewStyle } from "react-native";

// ── Public ref API (mirrors the native variant) ────────────────────

export interface VideoPlayerHandle {
  inject: (js: string) => void;
  /** Returns the current playback position in seconds. */
  getCurrentTime: () => Promise<number>;
  /** Returns the total video duration in seconds. */
  getDuration: () => Promise<number>;
  /** Request the iframe to enter fullscreen (web Fullscreen API). */
  requestFullscreen: () => Promise<void>;
  /** Exit fullscreen if currently active. */
  exitFullscreen: () => Promise<void>;
  /** Start or resume playback. */
  play: () => Promise<void>;
  /** Pause playback. */
  pause: () => Promise<void>;
  /** Seek to a specific time in seconds. */
  seekTo: (seconds: number) => Promise<void>;
  /** Set playback volume (0–100). */
  setVolume: (volume: number) => Promise<void>;
  /** Mute audio. */
  mute: () => Promise<void>;
  /** Unmute audio. */
  unMute: () => Promise<void>;
}

interface VideoPlayerContentProps {
  videoId: string;
  width?: number;
  height?: number;
  playbackRate?: number;
  onReady?: () => void;
  onError?: () => void;
  /** Fires when the YouTube player state changes (playing, paused, ended, etc.). */
  onChangeState?: (event: string) => void;
  /** Fires periodically with the latest currentTime (seconds) and duration (seconds). */
  onProgress?: (currentTime: number, duration: number) => void;
  /** When true, the iframe gets pointer-events: none so taps reach overlay controls. */
  blockIframeTouches?: boolean;
}

/** Maps YouTube IFrame API numeric player states to string events. */
const PLAYER_STATE_MAP: Record<number, string> = {
  "-1": "unstarted",
  "0": "ended",
  "1": "playing",
  "2": "paused",
  "3": "buffering",
  "5": "video cued",
};

// react-native-web renders string-based element names as real DOM elements.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Iframe = "iframe" as any;

/** Post a command to the YouTube IFrame API player. */
function postToPlayer(iframe: HTMLIFrameElement | null, command: string, args?: unknown) {
  if (!iframe?.contentWindow) return;
  const msg = JSON.stringify({
    event: "command",
    func: command,
    // YouTube expects args wrapped in an array for functions with arguments
    // (e.g. setVolume → args: [50]) and an empty string for no-arg functions
    // (e.g. mute → args: ""). Sending args: [] causes YouTube to silently
    // ignore no-arg commands like mute/unmute.
    args: args !== undefined ? [args] : "",
  });
  iframe.contentWindow.postMessage(msg, "*");
}

/**
 * Renders a YouTube embed via a plain HTML iframe on web.
 *
 * Uses the YouTube IFrame API (enablejsapi=1) and listens for
 * postMessage events to detect playback state changes.
 * YouTube's native chrome is hidden (`controls=0`) so the parent
 * can render its own custom transport overlay and progress bar.
 */
const VideoPlayerContent = forwardRef<VideoPlayerHandle, VideoPlayerContentProps>(
  function VideoPlayerContent(
    { videoId, width: _width, height = 220, playbackRate: _playbackRate, onReady, onError, onChangeState, onProgress, blockIframeTouches },
    ref,
  ) {
    const iframeElRef = useRef<HTMLIFrameElement | null>(null);
    /** YouTube IFrame API has signalled onReady — player can accept commands. */
    const playerReadyRef = useRef(false);
    /** Commands queued before the player signalled ready. Flushed when onReady fires. */
    const pendingCommandsRef = useRef<Array<() => void>>([]);
    /** Tracks whether the iframe DOM has fired its load event. */
    const iframeLoadedRef = useRef(false);
    /** Latest currentTime from YouTube infoDelivery events. */
    const currentTimeRef = useRef(0);
    /** Latest duration from YouTube infoDelivery events. */
    const durationRef = useRef(0);
    /** Latest known player state — used by togglePlayback to decide play vs pause. */
    const isPlayingRef = useRef(false);
    /** Interval ID for the progress-polling heartbeat. Cleared on unmount. */
    const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

    /** Post a command now if the player is ready, otherwise queue it. */
    const sendCommand = useCallback((command: string, args?: unknown) => {
      const action = () => postToPlayer(iframeElRef.current, command, args);
      if (playerReadyRef.current) {
        action();
      } else {
        pendingCommandsRef.current.push(action);
      }
    }, []);

    const play = useCallback(async () => {
      sendCommand("playVideo");
    }, [sendCommand]);

    const pause = useCallback(async () => {
      sendCommand("pauseVideo");
    }, [sendCommand]);

    const seekTo = useCallback(async (seconds: number) => {
      sendCommand("seekTo", seconds);
    }, [sendCommand]);

    const setVolume = useCallback(async (volume: number) => {
      sendCommand("setVolume", volume);
    }, [sendCommand]);

    const mute = useCallback(async () => {
      sendCommand("mute");
    }, [sendCommand]);

    const unMute = useCallback(async () => {
      sendCommand("unMute");
    }, [sendCommand]);

    const togglePlayback = useCallback(async () => {
      // Use the internally tracked playing state (updated by infoDelivery
      // events) so the toggle is always correct regardless of parent sync.
      if (isPlayingRef.current) {
        sendCommand("pauseVideo");
      } else {
        sendCommand("playVideo");
      }
    }, [sendCommand]);

    // ── YouTube IFrame API listening handshake ────────────
    /** Posts the handshake that tells YouTube the host is ready to receive API events. */
    const sendListeningHandshake = useCallback(() => {
      const iframe = iframeElRef.current;
      if (!iframe?.contentWindow) return;
      const msg = JSON.stringify({
        event: "listening",
        id: "1",
        channel: "widget",
      });
      iframe.contentWindow.postMessage(msg, "*");
    }, []);

    /** Called when the iframe DOM finishes loading. Sends the listening handshake
     *  and retries every 500 ms until YouTube responds with onReady. */
    const handleIframeLoad = useCallback(() => {
      iframeLoadedRef.current = true;
      sendListeningHandshake();

      const handshakeInterval = setInterval(() => {
        if (playerReadyRef.current) {
          clearInterval(handshakeInterval);
          return;
        }
        sendListeningHandshake();
      }, 500);

      // Safety: stop retrying after 10 seconds even if onReady never arrives
      setTimeout(() => clearInterval(handshakeInterval), 10_000);

      // Keep infoDelivery flowing by periodically re-posting the handshake
      // while the player is ready — this keeps currentTime updating.
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = setInterval(() => {
        if (playerReadyRef.current) {
          sendListeningHandshake();
        }
      }, 500);

      onReady?.();
    }, [sendListeningHandshake, onReady]);

    // ── Forwarded ref API ─────────────────────────────────
    useImperativeHandle(ref, () => ({
      inject: (js: string) => {
        try {
          // Evaluate the injection JS in the browser context.
          // The JS searches for YouTube iframes via DOM and
          // postMessages commands (setPlaybackQuality, setPlaybackRate, etc.).
          // eslint-disable-next-line no-eval
          eval(js);
        } catch {
          // ignore injection failures
        }
      },
      getCurrentTime: () => Promise.resolve(currentTimeRef.current),
      getDuration: () => Promise.resolve(durationRef.current),
      requestFullscreen: async () => {
        if (iframeElRef.current) {
          try {
            if (iframeElRef.current.requestFullscreen) {
              await iframeElRef.current.requestFullscreen();
            } else {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              await (iframeElRef.current as any).webkitRequestFullscreen?.();
            }
          } catch {
            // Fullscreen request may be denied (e.g. no user gesture)
          }
        }
      },
      exitFullscreen: async () => {
        if (typeof document === "undefined") return;
        if (!document.fullscreenElement) return;
        try {
          if (document.exitFullscreen) {
            await document.exitFullscreen();
          } else {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await (document as any).webkitExitFullscreen?.();
          }
        } catch {
          // ignore
        }
      },
      play,
      pause,
      seekTo,
      setVolume,
      mute,
      unMute,
      togglePlayback,
    }), [play, pause, seekTo, setVolume, mute, unMute, togglePlayback]);

    // ── Cleanup poll interval on unmount ────────────────
    useEffect(() => {
      return () => {
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
        }
      };
    }, []);

    // ── Listen for YouTube IFrame API postMessage events ────
    useEffect(() => {
      if (Platform.OS !== "web") return;

      const handleMessage = (event: MessageEvent) => {
        // YouTube IFrame API sends JSON messages
        if (typeof event.data !== "string") return;
        let data: Record<string, unknown>;
        try {
          data = JSON.parse(event.data);
        } catch {
          return;
        }

        // YouTube player ready — flush any queued commands
        if (data.event === "onReady") {
          playerReadyRef.current = true;
          const queue = pendingCommandsRef.current;
          pendingCommandsRef.current = [];
          for (const cmd of queue) {
            cmd();
          }
          return;
        }

        // infoDelivery carries player state AND time updates
        if (data.event === "infoDelivery" && data.info) {
          const info = data.info as Record<string, unknown>;

          // Track real playback time
          if (typeof info.currentTime === "number") {
            currentTimeRef.current = info.currentTime;
          }
          if (typeof info.duration === "number") {
            durationRef.current = info.duration;
          }
          if (
            typeof info.currentTime === "number" ||
            typeof info.duration === "number"
          ) {
            onProgress?.(currentTimeRef.current, durationRef.current);
          }

          // Player state change — keep isPlayingRef in sync for togglePlayback
          if (typeof info.playerState === "number") {
            const stateNum = info.playerState as number;
            const eventName = PLAYER_STATE_MAP[stateNum];
            if (eventName) {
              // Track playing state locally so togglePlayback is always correct
              if (stateNum === 1) isPlayingRef.current = true;        // playing
              else if (stateNum === 2 || stateNum === 0) isPlayingRef.current = false; // paused / ended
              onChangeState?.(eventName);
            }
          }
        }
      };

      window.addEventListener("message", handleMessage);
      return () => window.removeEventListener("message", handleMessage);
    }, [onChangeState, onProgress]);

    const embedUrl = (() => {
      let url =
        `https://www.youtube.com/embed/${videoId}` +
        `?playsinline=1&controls=0&modestbranding=1&rel=0&enablejsapi=1`;
      if (typeof window !== "undefined" && window.location?.origin) {
        url += `&origin=${encodeURIComponent(window.location.origin)}`;
      }
      return url;
    })();

    const iframeStyle: ViewStyle = {
      width: "100%",
      height: "100%",
      border: "none",
    };

    return (
      <View style={[styles.wrapper, { height }]}>
        <Iframe
          ref={(el: HTMLIFrameElement | null) => {
            iframeElRef.current = el;
          }}
          src={embedUrl}
          style={iframeStyle}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
          allowFullScreen
          onLoad={handleIframeLoad}
          onError={onError}
        />
      </View>
    );
  },
);

export default VideoPlayerContent;

const styles = StyleSheet.create({
  wrapper: {
    width: "100%",
    overflow: "hidden",
  },
});
