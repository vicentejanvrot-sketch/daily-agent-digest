import YoutubeIframe, { YoutubeIframeRef } from "react-native-youtube-iframe";
import React, { useRef, useImperativeHandle, forwardRef, useCallback, useState } from "react";

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
}

/**
 * JavaScript injected into the WebView that adds a supplementary
 * message-event listener.  The library's built-in listener only
 * handles playVideo / pauseVideo / muteVideo / unMuteVideo, so
 * we catch setPlaybackRate (and setVolume) here and forward them
 * to the YouTube IFrame API player directly.
 */
const INJECTED_SPEED_HANDLER = `
(function(){
  window.addEventListener('message',function(e){
    try{
      var d=JSON.parse(e.data);
      if(d.eventName==='setPlaybackRate'&&window.player){
        window.player.setPlaybackRate(d.meta.playbackRate);
      }else if(d.eventName==='setVolume'&&window.player){
        window.player.setVolume(d.meta.volume);
      }
    }catch(_){}
  });
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
    { videoId, width, height = 220, playbackRate = 1, onReady, onError, onChangeState },
    ref,
  ) {
    const youtubeRef = useRef<YoutubeIframeRef | null>(null);
    const [shouldPlay, setShouldPlay] = useState(false);

    const play = useCallback(async () => {
      setShouldPlay(true);
    }, []);

    const pause = useCallback(async () => {
      setShouldPlay(false);
    }, []);

    const seekTo = useCallback(async (seconds: number) => {
      youtubeRef.current?.seekTo(seconds, true);
    }, []);

    useImperativeHandle(ref, () => ({
      inject: (_js: string) => {
        // On native the library overrides webViewProps.ref, so we
        // cannot inject JS directly.  Instead the injected JavaScript
        // handler (INJECTED_SPEED_HANDLER) catches the library's own
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
    }), [play, pause, seekTo]);

    return (
      <YoutubeIframe
        ref={youtubeRef}
        width={width}
        height={height}
        videoId={videoId}
        play={shouldPlay}
        playbackRate={playbackRate}
        onReady={onReady}
        onError={onError}
        onChangeState={onChangeState}
        webViewProps={{
          allowsInlineMediaPlayback: true,
          mediaPlaybackRequiresUserAction: true,
          injectedJavaScript: INJECTED_SPEED_HANDLER,
          userAgent:
            "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
          allowsFullscreenVideo: true,
          domStorageEnabled: true,
          thirdPartyCookiesEnabled: true,
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
    );
  },
);

export default VideoPlayerContent;
