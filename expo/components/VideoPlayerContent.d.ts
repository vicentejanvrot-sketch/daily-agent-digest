import type React from "react";

export interface VideoPlayerHandle {
  inject: (js: string) => void;
  getCurrentTime: () => Promise<number>;
  getDuration: () => Promise<number>;
  requestFullscreen: () => Promise<void>;
  exitFullscreen: () => Promise<void>;
}

interface VideoPlayerContentProps {
  videoId: string;
  width?: number;
  height?: number;
  playbackRate?: number;
  onReady?: () => void;
  onError?: () => void;
  onChangeState?: (event: string) => void;
}

declare const VideoPlayerContent: React.ForwardRefExoticComponent<
  VideoPlayerContentProps & React.RefAttributes<VideoPlayerHandle>
>;

export default VideoPlayerContent;
