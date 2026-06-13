import type React from "react";

export interface VideoPlayerHandle {
  inject: (js: string) => void;
  getCurrentTime: () => Promise<number>;
  getDuration: () => Promise<number>;
  requestFullscreen: () => Promise<void>;
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
  /** Toggle between play and pause regardless of tracked state. */
  togglePlayback: () => Promise<void>;
}

interface VideoPlayerContentProps {
  videoId: string;
  width?: number;
  height?: number;
  playbackRate?: number;
  onReady?: () => void;
  onError?: () => void;
  onChangeState?: (event: string) => void;
  /** Fires periodically with the latest currentTime (seconds) and duration (seconds). */
  onProgress?: (currentTime: number, duration: number) => void;
  /** When true on web, the YouTube iframe gets pointer-events: none so overlay controls receive taps. */
  blockIframeTouches?: boolean;
}

declare const VideoPlayerContent: React.ForwardRefExoticComponent<
  VideoPlayerContentProps & React.RefAttributes<VideoPlayerHandle>
>;

export default VideoPlayerContent;
