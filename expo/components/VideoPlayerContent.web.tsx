import React, { forwardRef, useImperativeHandle, useEffect, useRef } from "react";
import { View, StyleSheet, Platform } from "react-native";

// ── Public ref API (mirrors the native variant) ────────────────────

export interface VideoPlayerHandle {
  inject: (js: string) => void;
  /** Returns the current playback position in seconds (0 on web — unavailable). */
  getCurrentTime: () => Promise<number>;
  /** Returns the total video duration in seconds (0 on web — unavailable). */
  getDuration: () => Promise<number>;
  /** Request the iframe to enter fullscreen (web Fullscreen API). */
  requestFullscreen: () => Promise<void>;
  /** Exit fullscreen if currently active. */
  exitFullscreen: () => Promise<void>;
}

interface VideoPlayerContentProps {
  videoId: string;
  height?: number;
  playbackRate?: number;
  onReady?: () => void;
  onError?: () => void;
  /** Fires when the YouTube player state changes (playing, paused, ended, etc.). */
  onChangeState?: (event: string) => void;
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

/**
 * Renders a YouTube embed via a plain HTML iframe on web.
 * Accepts playbackRate for API consistency but the plain iframe
 * cannot programmatically control quality or speed.
 *
 * Uses the YouTube IFrame API (enablejsapi=1) and listens for
 * postMessage events to detect playback state changes.
 */
const VideoPlayerContent = forwardRef<VideoPlayerHandle, VideoPlayerContentProps>(
  function VideoPlayerContent(
    { videoId, height = 220, playbackRate: _playbackRate, onReady, onError, onChangeState },
    ref,
  ) {
    const iframeElRef = useRef<HTMLIFrameElement | null>(null);

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
      getCurrentTime: () => Promise.resolve(0),
      getDuration: () => Promise.resolve(0),
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
    }));

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
        // Player state change: {"event":"infoDelivery","info":{"playerState":1,...}}
        if (
          data.event === "infoDelivery" &&
          data.info &&
          typeof (data.info as Record<string, unknown>).playerState === "number"
        ) {
          const state = (data.info as { playerState: number }).playerState;
          const eventName = PLAYER_STATE_MAP[state];
          if (eventName) {
            onChangeState?.(eventName);
          }
        }
      };

      window.addEventListener("message", handleMessage);
      return () => window.removeEventListener("message", handleMessage);
    }, [onChangeState]);

    const embedUrl =
      `https://www.youtube.com/embed/${videoId}` +
      `?playsinline=1&controls=1&modestbranding=1&rel=0&enablejsapi=1`;

    return (
      <View style={[styles.wrapper, { height }]}>
        <Iframe
          ref={(el: HTMLIFrameElement | null) => {
            iframeElRef.current = el;
          }}
          src={embedUrl}
          style={{ width: "100%", height: "100%", border: "none" }}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
          allowFullScreen
          onLoad={onReady}
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
