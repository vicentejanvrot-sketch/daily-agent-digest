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
}

interface VideoPlayerContentProps {
  videoId: string;
  width?: number;
  height?: number;
  playbackRate?: number;
  onReady?: () => void;
  onError?: () => void;
  onChangeState?: (event: string) => void;
  /** When true on web, the YouTube iframe gets pointer-events: none so overlay controls receive taps. */
  blockIframeTouches?: boolean;
}

declare const VideoPlayerContent: React.ForwardRefExoticComponent<
  VideoPlayerContentProps & React.RefAttributes<VideoPlayerHandle>
>;

export default VideoPlayerContent;
