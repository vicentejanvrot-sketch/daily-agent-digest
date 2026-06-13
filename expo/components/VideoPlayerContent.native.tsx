import YoutubeIframe, { YoutubeIframeRef } from "react-native-youtube-iframe";
import React, { useRef, useImperativeHandle, forwardRef, useCallback, useState } from "react";
import { View } from "react-native";

// ── Public ref API ─────────────────────────────────────────────────

export interface VideoPlayerHandle {
  /** Inject a YouTube IFrame API call into the player. */
  inject: (js: string) => void;
  /** Returns the current playback position in seconds. */
  getCurrentTime: () => Promise<number>;
  /** Returns the total video duration in seconds. */
  getDuration: () => Promise<number>;
  /** Request the player to enter fullscreen (handled by parent via orientation + layout on native). */
  requestFullscreen: () => Promise<void>;
  /** Exit fullscreen if currently active. */
  exitFullscreen: () => Promise<void>;
  /** Start or resume playback. */
  play: () => Promise<void>;
  /** Pause playback. */
  pause: () => Promise<void>;
  /** Seek to a specific time in seconds. */
  seekTo: (seconds: number) => Promise<void>;
  /** Set playback volume (0–100). No-op on native; controlled via device buttons. */
  setVolume: (volume: number) => Promise<void>;
  /** Mute audio. No-op on native. */
  mute: () => Promise<void>;
  /** Unmute audio. No-op on native. */
  unMute: () => Promise<void>;
}

/**
 * Injected JavaScript that adds a supplementary message-event listener
 * so the library's setPlaybackRate / setVolume / mute / unmute are forwarded
 * to the YouTube IFrame API player.
 *
 * Two-pronged approach:
 * 1. Direct handler — listens for message events and calls player.* immediately.
 * 2. Fallback poll — if the direct handler can't reach window.player (timing),
 *    a pending-volume variable is polled every 200ms and applied when the
 *    player becomes available.
 *
 * Also injects a <style> tag to remove default body margins / iframe size
 * constraints that would cause letterboxing on the wrong axis.
 */
const INJECTED_JS = `
(function(){
  var pendingVolume = undefined;
  var pendingMuted = undefined; // true = mute, false = unmute

  function applyToPlayer(fn) {
    if (window.player && typeof window.player.setVolume === 'function') {
      try { fn(window.player); } catch(_) {}
      return true;
    }
    return false;
  }

  function handleMessageEvent(e) {
    try {
      // e.data may be a pre-parsed object on some WebView implementations
      var d = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
      if (!d || !d.eventName) return;
      switch (d.eventName) {
        case 'setPlaybackRate':
          applyToPlayer(function(p) { p.setPlaybackRate(d.meta.playbackRate); });
          break;
        case 'setVolume':
          pendingVolume = d.meta.volume;
          if (!applyToPlayer(function(p) { p.setVolume(d.meta.volume); })) {
            // Player not ready yet — polling will pick it up
          }
          break;
        case 'muteVideo':
          pendingMuted = true;
          applyToPlayer(function(p) { p.mute(); });
          break;
        case 'unMuteVideo':
          pendingMuted = false;
          applyToPlayer(function(p) { p.unMute(); });
          break;
      }
    } catch(_) {}
  }

  // Listen on both window (iOS) and document (Android) because React Native
  // WebView dispatches postMessage events on different targets per platform.
  window.addEventListener('message', handleMessageEvent);
  document.addEventListener('message', handleMessageEvent);

  // Fallback poll: apply any pending volume/mute change when the player
  // becomes available (covers the gap between message arrival and onReady).
  setInterval(function() {
    if (!window.player || typeof window.player.setVolume !== 'function') return;
    if (pendingVolume !== undefined) {
      try { window.player.setVolume(pendingVolume); } catch(_) {}
      pendingVolume = undefined;
    }
    if (pendingMuted === true) {
      try { window.player.mute(); } catch(_) {}
      pendingMuted = undefined;
    } else if (pendingMuted === false) {
      try { window.player.unMute(); } catch(_) {}
      pendingMuted = undefined;
    }
  }, 200);

  (function enforceFill(){
    var s=document.createElement('style');
    s.textContent='html,body{margin:0!important;padding:0!important;background:#000!important;overflow:hidden!important;width:100%!important;height:100%!important}'+
      ' iframe{display:block!important;width:100%!important;height:100%!important;max-width:100%!important;left:0!important}'+
      ' .ytp-chrome-top,.ytp-chrome-bottom{display:none!important}';
    document.head.appendChild(s);
  })();
  true;
})();
`;

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
  /** Ignored on native — only meaningful on web to block iframe tap interception. */
  blockIframeTouches?: boolean;
}

/**
 * Renders a YouTube embed inside a native WebView on iOS/Android.
 *
 * Accepts `playbackRate` to control speed and uses `webViewProps`
 * to capture a WebView ref so the parent can inject quality-change
 * JavaScript (`player.setPlaybackQuality('hd1080')` etc.).
 *
 * YouTube's native chrome is hidden (`controls: false`) so the parent
 * can render its own custom transport overlay and progress bar.
 */
const VideoPlayerContent = forwardRef<VideoPlayerHandle, VideoPlayerContentProps>(
  function VideoPlayerContent(
    { videoId, width, height: _height, playbackRate = 1, onReady, onError, onChangeState, onProgress: _onProgress, blockIframeTouches: _blockIframeTouches },
    ref,
  ) {
    const youtubeRef = useRef<YoutubeIframeRef | null>(null);
    const [shouldPlay, setShouldPlay] = useState(false);
    const [nativeVolume, setNativeVolume] = useState(100);
    const [nativeMuted, setNativeMuted] = useState(false);

    // Force the player into an exact 16:9 box derived from width only.
    // The incoming height prop is accepted for backward compat but NOT
    // used to size the player — this prevents the WebView from becoming
    // wider than 16:9 and causing YouTube's own pillarboxing (black side bars).
    const boxWidth = width ?? 0;
    const boxHeight = Math.round(boxWidth * 9 / 16);

    // Toggle-based play/pause so the prop always changes value.
    // If we used absolute setShouldPlay(true/false), a second call
    // with the same value would be a React no-op and YoutubeIframe
    // wouldn't re-render with the command.
    const play = useCallback(async () => {
      setShouldPlay(true);
    }, []);

    const pause = useCallback(async () => {
      setShouldPlay(false);
    }, []);

    const togglePlayback = useCallback(async () => {
      setShouldPlay((prev) => !prev);
    }, []);

    const seekTo = useCallback(async (seconds: number) => {
      youtubeRef.current?.seekTo(seconds, true);
    }, []);

    useImperativeHandle(ref, () => ({
      inject: (_js: string) => {
        // On native the library overrides webViewProps.ref, so we
        // cannot inject JS directly.  Instead the injected JavaScript
        // handler (INJECTED_JS) catches the library's own
        // sendPostMessage calls for setPlaybackRate / setVolume and
        // forwards them to window.player.  This method is a no-op on
        // native; the web platform file uses eval() for injection.
      },
      getCurrentTime: () =>
        youtubeRef.current?.getCurrentTime() ?? Promise.resolve(0),
      getDuration: () =>
        youtubeRef.current?.getDuration() ?? Promise.resolve(0),
      requestFullscreen: () => Promise.resolve(),
      exitFullscreen: () => Promise.resolve(),
      play,
      pause,
      seekTo,
      setVolume: async (volume: number) => {
        setNativeVolume(volume);
      },
      mute: async () => {
        setNativeMuted(true);
      },
      unMute: async () => {
        setNativeMuted(false);
      },
      togglePlayback,
    }), [play, pause, seekTo, togglePlayback]);

    return (
      <View
        style={{
          width: boxWidth,
          height: boxHeight,
          alignSelf: "center",
          overflow: "hidden",
          backgroundColor: "#000",
        }}
      >
        <YoutubeIframe
          ref={youtubeRef}
          width={boxWidth}
          height={boxHeight}
          videoId={videoId}
          play={shouldPlay}
          volume={nativeVolume}
          mute={nativeMuted}
          playbackRate={playbackRate}
          onReady={onReady}
          onError={onError}
          onChangeState={onChangeState}
          webViewProps={{
            allowsInlineMediaPlayback: true,
            mediaPlaybackRequiresUserAction: false,
            injectedJavaScript: INJECTED_JS,
            style: { width: boxWidth, height: boxHeight, backgroundColor: "transparent" },
            userAgent:
              "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
            allowsFullscreenVideo: true,
            domStorageEnabled: true,
            thirdPartyCookiesEnabled: true,
            // Prevent the native WebView from capturing touches so
            // the React Native transport overlay (rendered above) can
            // receive tap events on iOS/Android.
            pointerEvents: _blockIframeTouches ? ("none" as const) : ("auto" as const),
          }}
          initialPlayerParams={{
            controls: false,
            modestbranding: 1,
            rel: 0,
            playsinline: 1,
            preventFullScreen: true,
            origin: "https://www.youtube.com",
          }}
        />
      </View>
    );
  },
);

export default VideoPlayerContent;
