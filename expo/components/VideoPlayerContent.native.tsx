import YoutubeIframe, { YoutubeIframeRef } from "react-native-youtube-iframe";
import React, { useRef, useImperativeHandle, forwardRef } from "react";

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
 */
const VideoPlayerContent = forwardRef<VideoPlayerHandle, VideoPlayerContentProps>(
  function VideoPlayerContent(
    { videoId, width, height = 220, playbackRate = 1, onReady, onError, onChangeState },
    ref,
  ) {
    const youtubeRef = useRef<YoutubeIframeRef | null>(null);

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
    }));

    return (
      <YoutubeIframe
        ref={youtubeRef}
        width={width}
        height={height}
        videoId={videoId}
        play={false}
        playbackRate={playbackRate}
        onReady={onReady}
        onError={onError}
        onChangeState={onChangeState}
        webViewProps={{
          allowsInlineMediaPlayback: true,
          mediaPlaybackRequiresUserAction: true,
          injectedJavaScript: INJECTED_SPEED_HANDLER,
        }}
        initialPlayerParams={{
          controls: 1,
          modestbranding: 1,
          rel: 0,
          playsinline: 1,
          preventFullScreen: true,
        }}
      />
    );
  },
);

export default VideoPlayerContent;
