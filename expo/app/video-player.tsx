import { useLocalSearchParams, router } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Linking,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Clipboard from "expo-clipboard";
import * as ScreenOrientation from "expo-screen-orientation";
import { LinearGradient } from "expo-linear-gradient";
import VideoPlayerContent from "@/components/VideoPlayerContent";
import type { VideoPlayerHandle } from "@/components/VideoPlayerContent";
import {
  Check,
  Circle,
  Clock,
  Copy,
  ExternalLink,
  FastForward,
  Heart,
  Maximize,
  Minimize2,
  MessageCircle,
  MoreHorizontal,
  Pause,
  Play,
  Rewind,
  Send,
  Settings,
  Share2,
  Volume2,
  VolumeX,
  X,
} from "lucide-react-native";
import * as Haptics from "expo-haptics";
import { Colors } from "@/constants/colors";
import { useUpdateItemStatus } from "@/lib/hooks";
import { useToast } from "@/components/Toast";
import { openExternalLink } from "@/lib/open-link";
import { useYouTubeConnection } from "@/lib/useYouTubeConnection";
import {
  useVideoQuality,
  QUALITY_KEYS,
  QUALITY_LABELS,
  QUALITY_YOUTUBE,
  SPEED_KEYS,
  SPEED_LABELS,
} from "@/lib/useVideoQuality";
import type { QualityKey, SpeedKey } from "@/lib/useVideoQuality";
import type { ItemStatus } from "@/lib/database";

// ── Status icons (mirrors feed.tsx) ────────────────────────────────

const STATUS_ICONS: Record<
  ItemStatus,
  { icon: typeof Check; color: string; label: string }
> = {
  not_watched: { icon: Circle, color: Colors.textMuted, label: "Not Watched" },
  watched: { icon: Check, color: Colors.success, label: "Watched" },
  liked: { icon: Heart, color: Colors.destructive, label: "Liked" },
  watch_later: { icon: Clock, color: Colors.warning, label: "Watch Later" },
};

const STATUS_ENTRIES = Object.entries(STATUS_ICONS) as [
  ItemStatus,
  (typeof STATUS_ICONS)[ItemStatus],
][];

/** Compact labels for the inline speed pill row. */
const SPEED_PILL_LABELS: Record<SpeedKey, string> = {
  "1": "1\u00D7",
  "1.25": "1.25\u00D7",
  "1.5": "1.5\u00D7",
  "1.75": "1.75\u00D7",
  "2": "2\u00D7",
};

/** Extract a raw YouTube video ID from a watch URL (safety net). */
function extractYoutubeId(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname === "youtu.be") return u.pathname.slice(1).split("?")[0] || null;
    return u.searchParams.get("v") || null;
  } catch {
    return null;
  }
}

/** Return the raw 11-char YouTube ID from a value that might be a full URL. */
function normalizeVideoId(raw: string): string | null {
  if (/^[\w-]{11}$/.test(raw)) return raw;
  return extractYoutubeId(raw);
}

/** Format seconds as m:ss (e.g. 125 → "2:05"). Always returns a timestamp, even at 0. */
function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

// ── Resume-playback position persistence ────────────────────────────

const POSITION_SAVE_INTERVAL_MS = 5000;
const NEAR_END_THRESHOLD = 0.95;

interface SavedPosition {
  currentTime: number;
  duration: number;
  updatedAt: number;
}

function resumePositionKey(videoId: string): string {
  return `@video_position/${videoId}`;
}

async function saveResumePosition(
  videoId: string,
  currentTime: number,
  duration: number,
): Promise<void> {
  if (!videoId || duration <= 0) return;
  const data: SavedPosition = {
    currentTime,
    duration,
    updatedAt: Date.now(),
  };
  try {
    await AsyncStorage.setItem(resumePositionKey(videoId), JSON.stringify(data));
  } catch {
    // Silently ignore write failures
  }
}

async function loadResumePosition(
  videoId: string,
): Promise<SavedPosition | null> {
  if (!videoId) return null;
  try {
    const raw = await AsyncStorage.getItem(resumePositionKey(videoId));
    if (!raw) return null;
    const data = JSON.parse(raw) as SavedPosition;
    if (
      typeof data.currentTime !== "number" ||
      typeof data.duration !== "number"
    ) {
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

async function clearResumePosition(videoId: string): Promise<void> {
  if (!videoId) return;
  try {
    await AsyncStorage.removeItem(resumePositionKey(videoId));
  } catch {
    // Silently ignore
  }
}

// ── Screen ─────────────────────────────────────────────────────────

export default function VideoPlayerScreen() {
  const { videoId, itemId } = useLocalSearchParams<{
    videoId?: string;
    itemId?: string;
  }>();
  const insets = useSafeAreaInsets();
  const updateStatus = useUpdateItemStatus();
  const showToast = useToast();
  const youtubeConn = useYouTubeConnection();

  // Shared quality / speed prefs (synced with Settings screen)
  const { quality, setQuality, speed, setSpeed, ready: prefsReady } = useVideoQuality();

  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);

  const rawId = videoId?.trim() || null;
  const videoIdStr = rawId ? normalizeVideoId(rawId) : null;
  const itemIdStr = itemId?.trim() ?? null;

  // Auto-mark-as-watched guard + overlay
  const autoWatchedRef = useRef(false);
  const overlayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const watchedOverlayOpacity = useRef(new Animated.Value(0)).current;
  const [watchedOverlayVisible, setWatchedOverlayVisible] = useState(false);

  // Reset loadError when videoId changes (fresh load)
  useEffect(() => {
    setLoadError(false);
    setReady(false);
    setIsFullscreen(false);
    setIsPlaying(false);
    autoWatchedRef.current = false;
    lastSaveTimeRef.current = 0;
    hasResumedRef.current = false;
    if (overlayTimerRef.current) {
      clearTimeout(overlayTimerRef.current);
      overlayTimerRef.current = null;
    }
    if (errorTimerRef.current) {
      clearTimeout(errorTimerRef.current);
      errorTimerRef.current = null;
    }
    watchedOverlayOpacity.setValue(0);
    setWatchedOverlayVisible(false);
  }, [videoIdStr, watchedOverlayOpacity]);

  const [gearOpen, setGearOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  // ── Volume state ───────────────────────────────────────────
  const [volume, setVolumeState] = useState(100);
  const [isMuted, setIsMuted] = useState(false);
  const volumeRef = useRef(volume);
  const isMutedRef = useRef(isMuted);

  useEffect(() => {
    volumeRef.current = volume;
  }, [volume]);

  useEffect(() => {
    isMutedRef.current = isMuted;
  }, [isMuted]);

  useEffect(() => {
    currentTimeRef.current = currentTime;
  }, [currentTime]);

  // ── Resume-playback refs ──────────────────────────────────────

  const currentTimeRef = useRef(currentTime);
  const lastSaveTimeRef = useRef(0);
  const hasResumedRef = useRef(false);

  // ── Progress bar scrubbing state ─────────────────────────────

  const progressBarWidth = useRef(0);
  const durationRef = useRef(duration);
  const seekFractionRef = useRef(0);
  const playerRefForSeek = useRef<VideoPlayerHandle | null>(null);
  const [isSeeking, setIsSeeking] = useState(false);
  const [seekFraction, setSeekFraction] = useState(0);

  // ── Controls auto-hide ─────────────────────────────────────────
  const controlsOpacity = useRef(new Animated.Value(1)).current;
  const controlsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [controlsHidden, setControlsHidden] = useState(false);
  const isPlayingRef = useRef(isPlaying);
  const isSeekingRef = useRef(isSeeking);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  });

  useEffect(() => {
    isSeekingRef.current = isSeeking;
  });

  const fadeControlsIn = useCallback(() => {
    if (controlsTimerRef.current) {
      clearTimeout(controlsTimerRef.current);
      controlsTimerRef.current = null;
    }
    setControlsHidden(false);
    Animated.timing(controlsOpacity, {
      toValue: 1,
      duration: 300,
      useNativeDriver: true,
    }).start();
  }, [controlsOpacity]);

  const startHideTimer = useCallback(() => {
    if (controlsTimerRef.current) {
      clearTimeout(controlsTimerRef.current);
    }
    controlsTimerRef.current = setTimeout(() => {
      controlsTimerRef.current = null;
      setControlsHidden(true);
      Animated.timing(controlsOpacity, {
        toValue: 0,
        duration: 500,
        useNativeDriver: true,
      }).start();
    }, 5000);
  }, [controlsOpacity]);

  const resetControlsTimer = useCallback(() => {
    fadeControlsIn();
    if (isPlayingRef.current && !isSeekingRef.current) {
      startHideTimer();
    }
  }, [fadeControlsIn, startHideTimer]);

  // Start/stop auto-hide based on playback and seeking state
  useEffect(() => {
    if (!ready) return;
    if (isSeeking) {
      fadeControlsIn();
    } else if (isPlaying) {
      startHideTimer();
    } else {
      fadeControlsIn();
    }
  }, [isPlaying, isSeeking, ready, fadeControlsIn, startHideTimer]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (controlsTimerRef.current) {
        clearTimeout(controlsTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    durationRef.current = duration;
  }, [duration]);

  // Native-only ref for injecting quality changes into the WebView
  const playerRef = useRef<VideoPlayerHandle | null>(null);

  useEffect(() => {
    playerRefForSeek.current = playerRef.current;
  });

  // ── PanResponder for the progress bar ────────────────────────

  const clampLocation = useCallback((x: number) => {
    const w = progressBarWidth.current;
    if (w <= 0) return 0;
    return Math.max(0, Math.min(1, x / w));
  }, []);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => durationRef.current > 0,
      onMoveShouldSetPanResponder: () => durationRef.current > 0,
      onPanResponderGrant: (evt) => {
        setIsSeeking(true);
        const fraction = Math.max(0, Math.min(1, evt.nativeEvent.locationX / Math.max(1, progressBarWidth.current)));
        seekFractionRef.current = fraction;
        setSeekFraction(fraction);
      },
      onPanResponderMove: (evt) => {
        const fraction = Math.max(0, Math.min(1, evt.nativeEvent.locationX / Math.max(1, progressBarWidth.current)));
        seekFractionRef.current = fraction;
        setSeekFraction(fraction);
      },
      onPanResponderRelease: () => {
        const seekTime = seekFractionRef.current * durationRef.current;
        playerRefForSeek.current?.seekTo(seekTime);
        setIsSeeking(false);
      },
    }),
  ).current;

  // ── Fullscreen management ────────────────────────────────────

  const enterFullscreen = useCallback(async () => {
    setIsFullscreen(true);
    // Don't use the browser Fullscreen API on web — it moves the
    // iframe onto a native fullscreen layer that hides every React
    // Native overlay (including the custom transport controls).
    // The app already simulates fullscreen via absolute positioning
    // and orientation lock, which keeps the controls tappable.
  }, []);

  const exitFullscreen = useCallback(async () => {
    setIsFullscreen(false);
    if (Platform.OS !== "web") {
      try {
        await ScreenOrientation.unlockAsync();
      } catch {
        // ignore — orientation lock may not be active
      }
    }
  }, []);

  const toggleFullscreen = useCallback(async () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    resetControlsTimer();
    if (isFullscreen) {
      await exitFullscreen();
    } else {
      await enterFullscreen();
    }
  }, [isFullscreen, enterFullscreen, exitFullscreen, resetControlsTimer]);

  // ── Progress callback from the web player ──────────────────
  const handleProgress = useCallback(
    (ct: number, dur: number) => {
      // Don't fight the user's drag — skip updates while scrubbing
      if (isSeekingRef.current) return;
      if (typeof ct === "number") setCurrentTime(ct);
      if (typeof dur === "number") setDuration(dur);
    },
    [],
  );

  const handleStateChange = useCallback(
    (event: string) => {
      if (event === "playing") {
        setIsPlaying(true);
        if (errorTimerRef.current) {
          clearTimeout(errorTimerRef.current);
          errorTimerRef.current = null;
        }
        setLoadError(false);
      } else if (event === "paused" || event === "ended") {
        setIsPlaying(false);
        // Save position when paused so the user can resume later
        if (event === "paused" && videoIdStr) {
          saveResumePosition(videoIdStr, currentTimeRef.current, durationRef.current);
        }
      }
      // Clear saved position when the video ends naturally, so reopening
      // starts from the beginning rather than the last second.
      if (event === "ended" && videoIdStr) {
        clearResumePosition(videoIdStr);
      }
      // Auto-mark as watched when the video finishes naturally
      if (event === "ended" && itemIdStr && !autoWatchedRef.current) {
        autoWatchedRef.current = true;
        updateStatus
          .mutateAsync({ id: itemIdStr, status: "watched" })
          .then(() => {
            setWatchedOverlayVisible(true);
            Animated.timing(watchedOverlayOpacity, {
              toValue: 1,
              duration: 300,
              useNativeDriver: true,
            }).start();
            overlayTimerRef.current = setTimeout(() => {
              Animated.timing(watchedOverlayOpacity, {
                toValue: 0,
                duration: 300,
                useNativeDriver: true,
              }).start(() => {
                setWatchedOverlayVisible(false);
                router.back();
              });
            }, 3000);
          })
          .catch(() => {
            // Silently ignore
          });
      }
    },
    [itemIdStr, videoIdStr, updateStatus, watchedOverlayOpacity],
  );

  // Restore orientation / exit fullscreen on unmount
  useEffect(() => {
    return () => {
      // Save playback position so the user can resume when they come back
      if (videoIdStr) {
        saveResumePosition(videoIdStr, currentTimeRef.current, durationRef.current);
      }
      if (Platform.OS !== "web") {
        try {
          ScreenOrientation.unlockAsync();
        } catch {
          // ignore
        }
      }
      if (overlayTimerRef.current) {
        clearTimeout(overlayTimerRef.current);
        overlayTimerRef.current = null;
      }
      if (errorTimerRef.current) {
        clearTimeout(errorTimerRef.current);
        errorTimerRef.current = null;
      }
    };
  }, [videoIdStr]);

  // Sync isFullscreen when the user exits browser fullscreen (Escape key)
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const handleChange = () => {
      if (!document.fullscreenElement) {
        setIsFullscreen(false);
      }
    };
    document.addEventListener("fullscreenchange", handleChange);
    return () => document.removeEventListener("fullscreenchange", handleChange);
  }, []);

  const { width: windowWidth, height: windowHeight } = useWindowDimensions();

  // Embedded (non-fullscreen) player sizing — 16:9, full-width on tablet/desktop
  const EMBED_H_MARGIN = windowWidth >= 700 ? 24 : 0;
  const embeddedWidth = windowWidth - EMBED_H_MARGIN * 2;
  const embeddedHeight = Math.round(embeddedWidth / (16 / 9));

  // Fullscreen sizing — fill the full screen width edge-to-edge,
  // with black bars only on top/bottom (no pillarboxing).
  const longEdge = Math.max(windowWidth, windowHeight);
  const shortEdge = Math.min(windowWidth, windowHeight);
  let fullscreenWidth = longEdge;
  let fullscreenHeight = Math.round(longEdge / (16 / 9));
  if (fullscreenHeight > shortEdge) {
    fullscreenHeight = shortEdge;
    fullscreenWidth = Math.round(shortEdge * (16 / 9));
  }

  const handleClose = useCallback(() => {
    router.back();
  }, []);

  const handleStatusChange = useCallback(
    async (status: ItemStatus) => {
      if (!itemIdStr) return;
      void Haptics.selectionAsync();

      // "watched" triggers the same overlay + close flow as video-ended
      if (status === "watched") {
        autoWatchedRef.current = true;
        try {
          await updateStatus.mutateAsync({ id: itemIdStr, status: "watched" });
          setWatchedOverlayVisible(true);
          Animated.timing(watchedOverlayOpacity, {
            toValue: 1,
            duration: 300,
            useNativeDriver: true,
          }).start();
          overlayTimerRef.current = setTimeout(() => {
            Animated.timing(watchedOverlayOpacity, {
              toValue: 0,
              duration: 300,
              useNativeDriver: true,
            }).start(() => {
              setWatchedOverlayVisible(false);
              router.back();
            });
          }, 3000);
        } catch {
          showToast("Couldn't update status", "error");
        }
        return;
      }

      try {
        await updateStatus.mutateAsync({ id: itemIdStr, status });
        showToast(`Marked as ${STATUS_ICONS[status].label}`, "success");
      } catch {
        showToast("Couldn't update status", "error");
      }
    },
    [itemIdStr, updateStatus, showToast, watchedOverlayOpacity],
  );

  const handleOpenInYoutube = useCallback(async () => {
    if (!videoIdStr) return;
    try {
      await openExternalLink(`https://www.youtube.com/watch?v=${videoIdStr}`);
    } catch {
      showToast("Couldn't open link", "error");
    }
  }, [videoIdStr, showToast]);

  const shareUrl = `https://www.youtube.com/watch?v=${videoIdStr}`;

  // ── Transport controls ───────────────────────────────────────

  // ── Volume controls ────────────────────────────────────────

  const handleToggleMute = useCallback(async () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    resetControlsTimer();
    if (isMutedRef.current) {
      await playerRef.current?.unMute();
      setIsMuted(false);
    } else {
      await playerRef.current?.mute();
      setIsMuted(true);
    }
  }, [resetControlsTimer]);

  const handleVolumeChange = useCallback(
    async (v: number) => {
      resetControlsTimer();
      const clamped = Math.max(0, Math.min(100, Math.round(v)));
      setVolumeState(clamped);
      await playerRef.current?.setVolume(clamped);
      // If we were muted, unmute when user adjusts volume
      if (isMutedRef.current) {
        await playerRef.current?.unMute();
        setIsMuted(false);
      }
    },
    [resetControlsTimer],
  );

  // ── Transport controls ───────────────────────────────────────

  const togglePlayPause = useCallback(async () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    resetControlsTimer();
    // Use togglePlayback so the command always takes effect, even when
    // isPlaying (parent state) is out of sync with the native player.
    await playerRef.current?.togglePlayback();
  }, [resetControlsTimer]);

  const skipBack = useCallback(async () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    resetControlsTimer();
    const target = Math.max(0, currentTime - 10);
    setCurrentTime(target);
    await playerRef.current?.seekTo(target);
  }, [currentTime, resetControlsTimer]);

  const skipForward = useCallback(async () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    resetControlsTimer();
    const target = Math.min(duration || Infinity, currentTime + 10);
    setCurrentTime(target);
    await playerRef.current?.seekTo(target);
  }, [currentTime, duration, resetControlsTimer]);

  // ── YouTube sync actions ─────────────────────────────────────

  const handleSaveToWatchLater = useCallback(async () => {
    if (!videoIdStr || youtubeConn.status !== "connected") return;
    void Haptics.selectionAsync();
    try {
      await youtubeConn.syncAction(videoIdStr, "watch_later");
      showToast("Saved to Watch Later on YouTube", "success");
    } catch {
      showToast("Couldn't save to Watch Later", "error");
    }
  }, [videoIdStr, youtubeConn, showToast]);

  const handleLikeOnYoutube = useCallback(async () => {
    if (!videoIdStr || youtubeConn.status !== "connected") return;
    void Haptics.selectionAsync();
    try {
      await youtubeConn.syncAction(videoIdStr, "rate");
      showToast("Liked on YouTube", "success");
    } catch {
      showToast("Couldn't like on YouTube", "error");
    }
  }, [videoIdStr, youtubeConn, showToast]);

  // ── Share actions ────────────────────────────────────────────

  const handleCopyLink = useCallback(async () => {
    void Haptics.selectionAsync();
    try {
      await Clipboard.setStringAsync(shareUrl);
      setShareOpen(false);
      showToast("Link copied", "success");
    } catch {
      showToast("Couldn't copy link", "error");
    }
  }, [shareUrl, showToast]);

  const handleShareToApp = useCallback(
    async (scheme: string) => {
      void Haptics.selectionAsync();
      const text = encodeURIComponent(`Check out this video: ${shareUrl}`);
      let url: string;
      switch (scheme) {
        case "whatsapp":
          url = `whatsapp://send?text=${text}`;
          break;
        case "telegram":
          url = `tg://msg?text=${text}`;
          break;
        case "twitter":
          url = `twitter://post?message=${text}`;
          break;
        default:
          return;
      }
      try {
        const canOpen = await Linking.canOpenURL(url);
        if (canOpen) {
          await Linking.openURL(url);
          setShareOpen(false);
        } else {
          showToast(`${scheme} app not installed`, "error");
        }
      } catch {
        showToast("Couldn't open app", "error");
      }
    },
    [shareUrl, showToast],
  );

  const handleNativeShare = useCallback(async () => {
    void Haptics.selectionAsync();
    try {
      setShareOpen(false);
      await Share.share({ message: shareUrl, url: shareUrl });
    } catch {
      // user cancelled — no-op
    }
  }, [shareUrl]);

  // ── Gear menu actions ──────────────────────────────────────────

  const handleQualitySelect = useCallback(
    async (q: QualityKey) => {
      void Haptics.selectionAsync();
      await setQuality(q);
      if (Platform.OS !== "web" && playerRef.current) {
        const ytQuality = QUALITY_YOUTUBE[q];
        playerRef.current.inject(
          `(function(){try{var f=document.getElementsByTagName('iframe');for(var i=0;i<f.length;i++){if((f[i].src||'').indexOf('youtube.com')!==-1){f[i].contentWindow.postMessage(JSON.stringify({event:'command',func:'setPlaybackQuality',args:['${ytQuality}']}),'*');break;}}}catch(e){}})();`,
        );
      }
    },
    [setQuality],
  );

  const handleSpeedSelect = useCallback(
    async (s: SpeedKey) => {
      void Haptics.selectionAsync();
      resetControlsTimer();
      await setSpeed(s);
      const rate = Number(s);
      if (playerRef.current) {
        playerRef.current.inject(
          `(function(){try{var f=document.getElementsByTagName('iframe');for(var i=0;i<f.length;i++){if((f[i].src||'').indexOf('youtube.com')!==-1){f[i].contentWindow.postMessage(JSON.stringify({event:'command',func:'setPlaybackRate',args:[${rate}]}),'*');break;}}}catch(e){}})();`,
        );
      }
    },
    [setSpeed, resetControlsTimer],
  );

  // ── Poll current time & duration while the player is ready ─────

  useEffect(() => {
    if (!ready) return;
    const id = setInterval(async () => {
      try {
        const t = await playerRef.current?.getCurrentTime();
        const d = await playerRef.current?.getDuration();
        if (typeof t === "number") setCurrentTime(t);
        if (typeof d === "number") setDuration(d);
        // Periodic position save — every 5 s while playing, so the user
        // can resume from roughly where they left off.
        if (
          videoIdStr &&
          isPlayingRef.current &&
          typeof t === "number" &&
          typeof d === "number" &&
          d > 0
        ) {
          const now = Date.now();
          if (now - lastSaveTimeRef.current >= POSITION_SAVE_INTERVAL_MS) {
            lastSaveTimeRef.current = now;
            saveResumePosition(videoIdStr, t, d);
          }
        }
      } catch {
        // ignore polling failures
      }
    }, 1000);
    return () => clearInterval(id);
  }, [ready, videoIdStr]);

  // ── playbackRate as a number ───────────────────────────────────

  const playbackRate = Number(speed);

  // ── Progress fraction ──────────────────────────────────────────

  const progressFraction =
    duration > 0
      ? isSeeking
        ? seekFraction
        : currentTime / duration
      : 0;

  // ── Speed pills fragment (reused in embedded + fullscreen) ─────

  const speedPillsRow = (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.speedPillsContainer}
      style={{ flexGrow: 0 }}
    >
      {SPEED_KEYS.map((s) => {
        const isActive = s === speed;
        return (
          <Pressable
            key={s}
            style={({ pressed }) => [
              styles.speedPill,
              isActive && styles.speedPillActive,
              pressed && styles.speedPillPressed,
            ]}
            onPress={() => handleSpeedSelect(s)}
          >
            <Text
              style={[
                styles.speedPillText,
                isActive && styles.speedPillTextActive,
              ]}
            >
              {SPEED_PILL_LABELS[s]}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );

  // ── Countdown pill fragment ────────────────────────────────────

  const countdownPill = duration > 0 && (
    <View style={styles.countdownPill}>
      <Clock size={14} color={Colors.textMuted} />
      <Text style={styles.countdownText}>
        {formatTime(Math.max(0, duration - currentTime))} left
      </Text>
    </View>
  );

  // ── Missing video_id ────────────────────────────────────────────

  if (!videoIdStr) {
    return (
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <Pressable onPress={handleClose} hitSlop={12} style={styles.closeBtn}>
            <X size={24} color={Colors.textPrimary} />
          </Pressable>
          <Text style={styles.headerTitle}>Video Player</Text>
          <View style={styles.closeBtn} />
        </View>
        <View style={styles.center}>
          <Text style={styles.errorTitle}>No video available</Text>
          <Text style={styles.errorSubtitle}>
            This item doesn&apos;t have a valid video ID. It may not have been
            fully processed yet.
          </Text>
          <Pressable
            style={({ pressed }) => [styles.backBtn, pressed && styles.pressed]}
            onPress={handleClose}
          >
            <Text style={styles.backBtnText}>Go back</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  // ── Playback error ──────────────────────────────────────────────

  if (loadError) {
    return (
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <Pressable onPress={handleClose} hitSlop={12} style={styles.closeBtn}>
            <X size={24} color={Colors.textPrimary} />
          </Pressable>
          <Text style={styles.headerTitle}>Video Player</Text>
          <View style={styles.closeBtn} />
        </View>
        <View style={styles.center}>
          <Text style={styles.errorTitle}>Couldn&apos;t load video</Text>
          <Text style={styles.errorSubtitle}>
            This video may have embedding disabled by the channel, or it may be
            unavailable. Try watching it directly in the YouTube app.
          </Text>
          {videoIdStr ? (
            <Pressable
              style={({ pressed }) => [
                styles.openYoutubeBtn,
                pressed && styles.pressed,
              ]}
              onPress={handleOpenInYoutube}
            >
              <ExternalLink size={18} color={Colors.white} />
              <Text style={styles.openYoutubeBtnText}>Open in YouTube</Text>
            </Pressable>
          ) : null}
          <Pressable
            style={({ pressed }) => [
              styles.backBtn,
              pressed && styles.pressed,
            ]}
            onPress={handleClose}
          >
            <Text style={styles.backBtnText}>Go back</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  // ── Normal: player with transport overlay ───────────────────────

  return (
    <View style={styles.root}>
      {/* Chrome: hidden in fullscreen */}
      {!isFullscreen && (
        <>
          {/* Header */}
          <View style={[styles.header, { paddingTop: insets.top }]}>
            <Animated.View style={{ opacity: controlsOpacity }}>
              <Pressable onPress={handleClose} hitSlop={12} style={styles.closeBtn}>
                <X size={24} color={Colors.textPrimary} />
              </Pressable>
            </Animated.View>
            <Text style={styles.headerTitle}>Video Player</Text>
            {/* Share icon */}
            <Pressable
              onPress={() => {
                void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setShareOpen(true);
              }}
              hitSlop={12}
              style={styles.closeBtn}
            >
              <Share2 size={20} color={Colors.textSecondary} />
            </Pressable>
            {/* Gear icon */}
            <Pressable
              onPress={() => {
                void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setGearOpen(true);
              }}
              hitSlop={12}
              style={styles.closeBtn}
            >
              <Settings size={22} color={Colors.textSecondary} />
            </Pressable>
          </View>

          {/* Speed pills row (embedded) */}
          <Animated.View style={[styles.embeddedControlsRow, { opacity: controlsOpacity }]}>
            <View style={styles.speedPillsWrapper}>
              {speedPillsRow}
            </View>
          </Animated.View>
          {/* Countdown row (embedded) */}
          {countdownPill ? (
            <Animated.View style={[styles.countdownRow, { opacity: controlsOpacity }]}>
              {countdownPill}
            </Animated.View>
          ) : null}

          {/* Status actions */}
          <View style={styles.actionsRow}>
            {STATUS_ENTRIES.map(([key, cfg]) => {
              const IconC = cfg.icon;
              return (
                <Pressable
                  key={key}
                  style={({ pressed }) => [
                    styles.actionBtn,
                    pressed && styles.actionBtnPressed,
                  ]}
                  onPress={() => handleStatusChange(key)}
                >
                  <IconC
                    size={18}
                    color={cfg.color}
                    fill={key === "liked" ? cfg.color : "transparent"}
                  />
                  <Text style={styles.actionLabel}>{cfg.label}</Text>
                </Pressable>
              );
            })}
          </View>

          {/* YouTube sync actions (only when connected) */}
          {youtubeConn.status === "connected" && (
            <View style={styles.actionsRow}>
              <Pressable
                style={({ pressed }) => [
                  styles.actionBtn,
                  pressed && styles.actionBtnPressed,
                ]}
                onPress={handleSaveToWatchLater}
              >
                <Clock size={18} color={Colors.warning} />
                <Text style={styles.actionLabel}>Save to YouTube</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [
                  styles.actionBtn,
                  pressed && styles.actionBtnPressed,
                ]}
                onPress={handleLikeOnYoutube}
              >
                <Heart size={18} color={Colors.destructive} fill={Colors.destructive} />
                <Text style={styles.actionLabel}>Like on YouTube</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [
                  styles.actionBtn,
                  pressed && styles.actionBtnPressed,
                ]}
                onPress={handleOpenInYoutube}
              >
                <ExternalLink size={18} color={Colors.accent} />
                <Text style={styles.actionLabel}>Open in YouTube</Text>
              </Pressable>
            </View>
          )}

          {youtubeConn.status !== "connected" && (
            <View style={styles.openYoutubeRow}>
              <Pressable
                style={({ pressed }) => [
                  styles.openYoutubeInline,
                  pressed && styles.pressed,
                ]}
                onPress={handleOpenInYoutube}
              >
                <ExternalLink size={16} color={Colors.accent} />
                <Text style={styles.openYoutubeInlineText}>Open in YouTube</Text>
              </Pressable>
            </View>
          )}
        </>
      )}

      {/* ── Player container ─────────────────────────────────── */}
      <View
        style={[
          isFullscreen ? styles.fullscreenPlayerWrapper : styles.playerWrapper,
          !isFullscreen && { width: embeddedWidth },
        ]}
      >
        {!ready && !isFullscreen && (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator size="large" color={Colors.accent} />
          </View>
        )}

        {/* Single persistent player — never unmounts when toggling fullscreen.
             Only the container style and dimensions change, so playback is preserved. */}
        <View
          style={
            isFullscreen
              ? [styles.fullscreenPlayerInner, { width: fullscreenWidth, height: fullscreenHeight }]
              : {}
          }
        >
          <VideoPlayerContent
            ref={playerRef}
            videoId={videoIdStr}
            width={isFullscreen ? fullscreenWidth : embeddedWidth}
            height={isFullscreen ? fullscreenHeight : embeddedHeight}
            playbackRate={playbackRate}
            blockIframeTouches={false}
            onReady={async () => {
              setReady(true);
              if (errorTimerRef.current) {
                clearTimeout(errorTimerRef.current);
                errorTimerRef.current = null;
              }
              setLoadError(false);
              // Resume from saved position
              if (!hasResumedRef.current && videoIdStr) {
                hasResumedRef.current = true;
                try {
                  const saved = await loadResumePosition(videoIdStr);
                  if (saved && saved.duration > 0) {
                    if (saved.currentTime / saved.duration < NEAR_END_THRESHOLD) {
                      playerRef.current?.seekTo(saved.currentTime);
                    } else {
                      // Near the end — clear so next open starts from beginning
                      await clearResumePosition(videoIdStr);
                    }
                  }
                } catch {
                  // Ignore resume errors
                }
              }
              const rate = Number(speed);
              if (rate !== 1 && playerRef.current) {
                playerRef.current.inject(
                  `(function(){try{var f=document.getElementsByTagName('iframe');for(var i=0;i<f.length;i++){if((f[i].src||'').indexOf('youtube.com')!==-1){f[i].contentWindow.postMessage(JSON.stringify({event:'command',func:'setPlaybackRate',args:[${rate}]}),'*');break;}}}catch(e){}})();`,
                );
              }
            }}
            onError={() => {
              if (errorTimerRef.current) {
                clearTimeout(errorTimerRef.current);
              }
              errorTimerRef.current = setTimeout(() => {
                errorTimerRef.current = null;
                setLoadError(true);
              }, 4000);
            }}
            onChangeState={handleStateChange}
            onProgress={handleProgress}
          />
        </View>

      </View>

      {/* ── Embedded transport controls (below video, NOT overlaid) ──
           Rendered outside the player wrapper so the native WebView / iframe
           can't capture taps meant for the transport buttons. */}
      {!isFullscreen && ready && (
        <Animated.View style={[styles.embeddedControlsStrip, { opacity: controlsOpacity }]}>
          {/* Progress / scrubber row (embedded) */}
          <View style={styles.embeddedProgressRow}>
            <Text style={styles.progressTimeText}>
              {formatTime(isSeeking ? seekFraction * duration : currentTime)}
            </Text>
            <View
              style={styles.progressBar}
              onLayout={(e) => {
                progressBarWidth.current = e.nativeEvent.layout.width;
              }}
              {...panResponder.panHandlers}
            >
              <View style={styles.progressBarTrack}>
                <View
                  style={[
                    styles.progressBarFill,
                    { width: `${Math.min(100, progressFraction * 100)}%` },
                  ]}
                />
                <View
                  style={[
                    styles.progressBarHandle,
                    {
                      left: `${Math.min(100, progressFraction * 100)}%`,
                      opacity: isSeeking ? 1 : 0.6,
                      transform: [
                        { translateX: -6 },
                        { scale: isSeeking ? 1.3 : 1 },
                      ],
                    },
                  ]}
                />
              </View>
            </View>
            <Text style={styles.progressTimeText}>
              {formatTime(duration)}
            </Text>
            <Pressable
              onPress={toggleFullscreen}
              style={({ pressed }) => [
                styles.fullscreenToggleBtn,
                pressed && styles.fullscreenToggleBtnPressed,
              ]}
              hitSlop={8}
            >
              <Maximize size={18} color={Colors.textSecondary} />
            </Pressable>
          </View>

          <View style={styles.transportRow}>
            <Pressable
              onPress={skipBack}
              style={({ pressed }) => [
                styles.transportBtn,
                pressed && styles.transportBtnPressed,
              ]}
              hitSlop={8}
            >
              <Rewind size={26} color={Colors.white} />
            </Pressable>

            <Pressable
              onPress={togglePlayPause}
              style={({ pressed }) => [
                styles.transportBtn,
                styles.transportBtnPlay,
                pressed && styles.transportBtnPressed,
              ]}
              hitSlop={8}
            >
              {isPlaying ? (
                <Pause size={28} color={Colors.white} />
              ) : (
                <Play size={28} color={Colors.white} />
              )}
            </Pressable>

            <Pressable
              onPress={skipForward}
              style={({ pressed }) => [
                styles.transportBtn,
                pressed && styles.transportBtnPressed,
              ]}
              hitSlop={8}
            >
              <FastForward size={26} color={Colors.white} />
            </Pressable>
          </View>

          {/* Volume control (embedded) */}
          <View style={styles.volumeRow}>
            <Pressable
              onPress={handleToggleMute}
              style={({ pressed }) => [
                styles.volumeBtn,
                pressed && styles.volumeBtnPressed,
              ]}
              hitSlop={8}
            >
              {isMuted ? (
                <VolumeX size={18} color={Colors.white} />
              ) : (
                <Volume2 size={18} color={Colors.white} />
              )}
            </Pressable>
            {!isMuted && (
              <View
                style={styles.volumeSliderArea}
                onStartShouldSetResponder={() => true}
                onMoveShouldSetResponder={() => true}
                onResponderGrant={(evt) => {
                  const x = evt.nativeEvent.locationX;
                  handleVolumeChange((x / 80) * 100);
                }}
                onResponderMove={(evt) => {
                  const x = evt.nativeEvent.locationX;
                  handleVolumeChange((x / 80) * 100);
                }}
              >
                <View style={styles.volumeSliderTrack} pointerEvents="none">
                  <View
                    style={[
                      styles.volumeSliderFill,
                      { width: `${volume}%` },
                    ]}
                  />
                  <View
                    style={[
                      styles.volumeSliderThumb,
                      { left: `${volume}%` },
                    ]}
                  />
                </View>
              </View>
            )}
          </View>
        </Animated.View>
      )}

      {/* ── Fullscreen bottom bar (progress + transport + volume + speed + countdown) ── */}
      {isFullscreen && ready && (
        <Animated.View
          style={[
            styles.fullscreenBottomBar,
            {
              paddingBottom: insets.bottom + 16,
              paddingLeft: Math.max(20, insets.left),
              paddingRight: Math.max(20, insets.right),
            },
            { opacity: controlsOpacity },
          ]}
          pointerEvents="box-none"
        >
          <LinearGradient
            colors={["transparent", "rgba(0,0,0,0.7)"]}
            style={styles.fullscreenBottomGradient}
            pointerEvents="none"
          />
          {/* Progress / scrubber row (fullscreen) */}
          <View style={[styles.fullscreenProgressRow, { paddingHorizontal: 0 }]}>
            <Text style={styles.progressTimeText}>
              {formatTime(isSeeking ? seekFraction * duration : currentTime)}
            </Text>
            <View
              style={styles.progressBar}
              onLayout={(e) => {
                progressBarWidth.current = e.nativeEvent.layout.width;
              }}
              {...panResponder.panHandlers}
            >
              <View style={styles.progressBarTrack}>
                <View
                  style={[
                    styles.progressBarFill,
                    { width: `${Math.min(100, progressFraction * 100)}%` },
                  ]}
                />
                <View
                  style={[
                    styles.progressBarHandle,
                    {
                      left: `${Math.min(100, progressFraction * 100)}%`,
                      opacity: isSeeking ? 1 : 0.6,
                      transform: [
                        { translateX: -6 },
                        { scale: isSeeking ? 1.3 : 1 },
                      ],
                    },
                  ]}
                />
              </View>
            </View>
            <Text style={styles.progressTimeText}>
              {formatTime(duration)}
            </Text>
            <Pressable
              onPress={toggleFullscreen}
              style={({ pressed }) => [
                styles.fullscreenToggleBtn,
                pressed && styles.fullscreenToggleBtnPressed,
              ]}
              hitSlop={8}
            >
              <Minimize2 size={18} color={Colors.textSecondary} />
            </Pressable>
          </View>

          {/* Transport row */}
          <View style={[styles.fullscreenTransportRow, { paddingHorizontal: 0 }]}>
            <Pressable
              onPress={skipBack}
              style={({ pressed }) => [
                styles.transportBtn,
                pressed && styles.transportBtnPressed,
              ]}
              hitSlop={8}
            >
              <Rewind size={28} color={Colors.white} />
            </Pressable>

            <Pressable
              onPress={togglePlayPause}
              style={({ pressed }) => [
                styles.transportBtn,
                styles.transportBtnPlay,
                pressed && styles.transportBtnPressed,
              ]}
              hitSlop={8}
            >
              {isPlaying ? (
                <Pause size={30} color={Colors.white} />
              ) : (
                <Play size={30} color={Colors.white} />
              )}
            </Pressable>

            <Pressable
              onPress={skipForward}
              style={({ pressed }) => [
                styles.transportBtn,
                pressed && styles.transportBtnPressed,
              ]}
              hitSlop={8}
            >
              <FastForward size={28} color={Colors.white} />
            </Pressable>
          </View>
          {/* Volume control (fullscreen) */}
          <View style={[styles.fullscreenVolumeRow, { paddingHorizontal: 0 }]}>
            <Pressable
              onPress={handleToggleMute}
              style={({ pressed }) => [
                styles.volumeBtn,
                pressed && styles.volumeBtnPressed,
              ]}
              hitSlop={8}
            >
              {isMuted ? (
                <VolumeX size={18} color={Colors.white} />
              ) : (
                <Volume2 size={18} color={Colors.white} />
              )}
            </Pressable>
            {!isMuted && (
              <View
                style={styles.volumeSliderArea}
                onStartShouldSetResponder={() => true}
                onMoveShouldSetResponder={() => true}
                onResponderGrant={(evt) => {
                  const x = evt.nativeEvent.locationX;
                  handleVolumeChange((x / 80) * 100);
                }}
                onResponderMove={(evt) => {
                  const x = evt.nativeEvent.locationX;
                  handleVolumeChange((x / 80) * 100);
                }}
              >
                <View style={styles.volumeSliderTrack} pointerEvents="none">
                  <View
                    style={[
                      styles.volumeSliderFill,
                      { width: `${volume}%` },
                    ]}
                  />
                  <View
                    style={[
                      styles.volumeSliderThumb,
                      { left: `${volume}%` },
                    ]}
                  />
                </View>
              </View>
            )}
          </View>
          {/* Speed pills */}
          <View style={[styles.fullscreenControlsRow, styles.fullscreenControlsRowTop, { paddingHorizontal: 0 }]}>
            <View style={{ alignItems: "center" as const }}>
              {speedPillsRow}
            </View>
          </View>
          {/* Countdown */}
          {countdownPill ? (
            <View style={styles.fullscreenControlsRow}>
              {countdownPill}
            </View>
          ) : null}
        </Animated.View>
      )}

      {/* Fullscreen close button — root level so it renders above all overlays */}
      {isFullscreen && (
        <Animated.View
          style={[
            styles.fullscreenCloseBtnRoot,
            { top: insets.top + 8, right: Math.max(12, insets.right) + 12, opacity: controlsOpacity },
          ]}
        >
          <Pressable
            onPress={() => {
              void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              exitFullscreen();
              handleClose();
            }}
            style={styles.fullscreenCloseBtnInner}
            hitSlop={12}
          >
            <X size={22} color={Colors.white} />
          </Pressable>
        </Animated.View>
      )}

      {/* Tap overlay — reveals controls when hidden. Rendered at root level
          with high zIndex so it sits above ALL other content elements. */}
      {controlsHidden && (
        <Pressable
          style={[StyleSheet.absoluteFill, styles.tapOverlay]}
          onPress={resetControlsTimer}
        />
      )}

      {/* ── Share modal ───────────────────────────────────── */}
      <Modal
        visible={shareOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setShareOpen(false)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setShareOpen(false)}>
          <View />
        </Pressable>

        <View
          style={[styles.gearSheet, { paddingBottom: insets.bottom + 16 }]}
        >
          <View style={styles.handleBar} />

          <ScrollView
            bounces={false}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            <Text style={styles.sectionTitle}>Share</Text>

            {/* Video link display */}
            <View style={styles.shareLinkBox}>
              <Text style={styles.shareLinkText} numberOfLines={2}>
                {shareUrl}
              </Text>
            </View>

            {/* Copy link */}
            <Pressable
              style={({ pressed }) => [
                styles.optionRow,
                pressed && styles.optionRowPressed,
              ]}
              onPress={handleCopyLink}
            >
              <Copy size={18} color={Colors.textSecondary} />
              <Text style={styles.shareOptionLabel}>Copy link</Text>
            </Pressable>

            <View style={styles.shareDivider} />

            {/* WhatsApp */}
            <Pressable
              style={({ pressed }) => [
                styles.optionRow,
                pressed && styles.optionRowPressed,
              ]}
              onPress={() => handleShareToApp("whatsapp")}
            >
              <MessageCircle size={18} color="#25D366" />
              <Text style={styles.shareOptionLabel}>WhatsApp</Text>
            </Pressable>

            {/* Telegram */}
            <Pressable
              style={({ pressed }) => [
                styles.optionRow,
                pressed && styles.optionRowPressed,
              ]}
              onPress={() => handleShareToApp("telegram")}
            >
              <Send size={18} color="#0088cc" />
              <Text style={styles.shareOptionLabel}>Telegram</Text>
            </Pressable>

            {/* Twitter / X */}
            <Pressable
              style={({ pressed }) => [
                styles.optionRow,
                pressed && styles.optionRowPressed,
              ]}
              onPress={() => handleShareToApp("twitter")}
            >
              <X size={18} color={Colors.textSecondary} />
              <Text style={styles.shareOptionLabel}>Twitter / X</Text>
            </Pressable>

            <View style={styles.shareDivider} />

            {/* More… (native share sheet) */}
            <Pressable
              style={({ pressed }) => [
                styles.optionRow,
                pressed && styles.optionRowPressed,
              ]}
              onPress={handleNativeShare}
            >
              <MoreHorizontal size={18} color={Colors.textSecondary} />
              <Text style={styles.shareOptionLabel}>More…</Text>
            </Pressable>
          </ScrollView>
        </View>
      </Modal>

      {/* ── Auto-watched confirmation overlay ──────────────── */}
      {watchedOverlayVisible && (
        <Animated.View
          style={[styles.watchedOverlay, { opacity: watchedOverlayOpacity }]}
          pointerEvents="none"
        >
          <View style={styles.watchedBox}>
            <Text style={styles.watchedTitle}>Marked as Watched</Text>
            <Text style={styles.watchedSubtitle}>
              Video has been marked as watched in your library.
            </Text>
          </View>
        </Animated.View>
      )}

      {/* ── Gear menu modal ────────────────────────────────── */}
      <Modal
        visible={gearOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setGearOpen(false)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setGearOpen(false)}>
          <View />
        </Pressable>

        <View
          style={[styles.gearSheet, { paddingBottom: insets.bottom + 16 }]}
        >
          <View style={styles.handleBar} />

          <ScrollView
            bounces={false}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {/* ── Quality section ────────────────────────── */}
            <Text style={styles.sectionTitle}>Quality</Text>
            {QUALITY_KEYS.map((q) => {
              const isSelected = q === quality;
              return (
                <Pressable
                  key={q}
                  style={({ pressed }) => [
                    styles.optionRow,
                    isSelected && styles.optionRowActive,
                    pressed && styles.optionRowPressed,
                  ]}
                  onPress={() => handleQualitySelect(q)}
                >
                  <Text
                    style={[
                      styles.optionLabel,
                      isSelected && styles.optionLabelActive,
                    ]}
                  >
                    {QUALITY_LABELS[q]}
                  </Text>
                  {isSelected && (
                    <Check size={18} color={Colors.accent} />
                  )}
                </Pressable>
              );
            })}

            {/* ── Speed section ──────────────────────────── */}
            <Text style={[styles.sectionTitle, { marginTop: 20 }]}>Speed</Text>
            {SPEED_KEYS.map((s) => {
              const isSelected = s === speed;
              return (
                <Pressable
                  key={s}
                  style={({ pressed }) => [
                    styles.optionRow,
                    isSelected && styles.optionRowActive,
                    pressed && styles.optionRowPressed,
                  ]}
                  onPress={() => handleSpeedSelect(s)}
                >
                  <Text
                    style={[
                      styles.optionLabel,
                      isSelected && styles.optionLabelActive,
                    ]}
                  >
                    {SPEED_LABELS[s]}
                  </Text>
                  {isSelected && (
                    <Check size={18} color={Colors.accent} />
                  )}
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

// ── Styles ─────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  tapOverlay: {
    zIndex: 9999,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: "600" as const,
    color: Colors.textPrimary,
  },
  closeBtn: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 32,
  },
  errorTitle: {
    fontSize: 18,
    fontWeight: "600" as const,
    color: Colors.textPrimary,
    marginBottom: 8,
    textAlign: "center",
  },
  errorSubtitle: {
    fontSize: 14,
    color: Colors.textSecondary,
    textAlign: "center",
    lineHeight: 20,
    marginBottom: 24,
  },
  backBtn: {
    backgroundColor: Colors.accent,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 10,
  },
  backBtnText: {
    color: Colors.white,
    fontWeight: "600" as const,
    fontSize: 15,
  },
  openYoutubeBtn: {
    backgroundColor: Colors.destructive,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 10,
    marginBottom: 12,
  },
  openYoutubeBtnText: {
    color: Colors.white,
    fontWeight: "600" as const,
    fontSize: 15,
  },

  // ── Player wrappers ─────────────────────────────────────────
  playerWrapper: {
    width: "100%",
    alignSelf: "center",
    backgroundColor: Colors.black,
    overflow: "hidden",
    borderRadius: 10,
  },
  fullscreenPlayerWrapper: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: Colors.black,
    overflow: "hidden",
    zIndex: 100,
    justifyContent: "center",
    alignItems: "center",
  },
  fullscreenPlayerInner: {
    overflow: "hidden",
  },
  fullscreenCloseBtn: {
    position: "absolute",
    right: 12,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 110,
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.black,
    zIndex: 1,
  },

  // ── Embedded controls strip (below video, not overlaid) ────
  embeddedControlsStrip: {
    width: "100%",
    backgroundColor: Colors.black,
    paddingBottom: 12,
  },
  transportRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 24,
    paddingBottom: 12,
    paddingHorizontal: 24,
  },
  transportBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(255,255,255,0.15)",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 70,
  },
  transportBtnPlay: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: "rgba(255,255,255,0.22)",
  },
  transportBtnPressed: {
    backgroundColor: "rgba(255,255,255,0.3)",
  },

  // ── Progress / scrubber row ─────────────────────────────────
  progressRow: {
    width: "100%",
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 10,
  },
  progressRowFullscreen: {
    position: "absolute",
    left: 0,
    right: 0,
    maxWidth: "100%",
    zIndex: 108,
    paddingHorizontal: 20,
  },
  progressTimeText: {
    fontSize: 12,
    fontWeight: "600" as const,
    color: Colors.textMuted,
    fontVariant: ["tabular-nums"] as const,
    minWidth: 40,
    textAlign: "center",
  },
  progressBar: {
    flex: 1,
    height: 32,
    justifyContent: "center",
  },
  progressBarTrack: {
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.15)",
    overflow: "visible",
  },
  progressBarFill: {
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.accent,
  },
  progressBarHandle: {
    position: "absolute",
    top: -4,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: Colors.white,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 4,
  },
  fullscreenToggleBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: "rgba(255,255,255,0.08)",
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 2,
  },
  fullscreenToggleBtnPressed: {
    backgroundColor: "rgba(255,255,255,0.18)",
  },

  // ── Progress rows inside transport / bottom bar ───────────
  embeddedProgressRow: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 10,
    marginBottom: 4,
  },
  fullscreenProgressRow: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 12,
    gap: 10,
    marginBottom: 6,
  },

  // ── Embedded controls row ───────────────────────────────────
  embeddedControlsRow: {
    width: "100%",
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  speedPillsWrapper: {
    flexShrink: 1,
    alignItems: "center",
  },
  countdownRow: {
    width: "100%",
    alignSelf: "center",
    flexDirection: "row",
    justifyContent: "center",
    paddingHorizontal: 16,
    paddingBottom: 8,
  },


  // ── Speed pills ─────────────────────────────────────────────
  speedPillsContainer: {
    flexDirection: "row",
    gap: 8,
  },
  speedPill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: "transparent",
  },
  speedPillActive: {
    backgroundColor: Colors.accent,
    borderColor: Colors.accent,
  },
  speedPillPressed: {
    opacity: 0.7,
  },
  speedPillText: {
    fontSize: 13,
    fontWeight: "600" as const,
    color: Colors.textPrimary,
  },
  speedPillTextActive: {
    color: Colors.white,
  },

  // ── Countdown pill ──────────────────────────────────────────
  countdownPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: Colors.input,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  countdownText: {
    fontSize: 13,
    color: Colors.textMuted,
    fontVariant: ["tabular-nums"] as const,
  },

  // ── Fullscreen bottom bar ───────────────────────────────────
  fullscreenBottomBar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 105,
  },
  fullscreenBottomGradient: {
    ...StyleSheet.absoluteFillObject,
    height: 160,
    top: undefined,
  },
  fullscreenTransportRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 24,
    paddingBottom: 10,
    paddingHorizontal: 24,
  },
  fullscreenControlsRow: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 12,
    paddingHorizontal: 16,
  },
  fullscreenControlsRowTop: {
    paddingBottom: 6,
  },
  fullscreenCloseBtnRoot: {
    position: "absolute",
    right: 12,
    zIndex: 200,
  },
  fullscreenCloseBtnInner: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center",
    justifyContent: "center",
  },

  // ── Status actions ──────────────────────────────────────────
  actionsRow: {
    width: "100%",
    alignSelf: "center",
    flexDirection: "row",
    justifyContent: "space-evenly",
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  actionBtn: {
    alignItems: "center",
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
  },
  actionBtnPressed: {
    backgroundColor: Colors.input,
  },
  actionLabel: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontWeight: "500" as const,
  },
  pressed: {
    opacity: 0.7,
  },

  // ── Open in YouTube row (when not connected) ────────────────
  openYoutubeRow: {
    width: "100%",
    alignSelf: "center",
    alignItems: "center",
    paddingVertical: 4,
  },
  openYoutubeInline: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  openYoutubeInlineText: {
    fontSize: 13,
    color: Colors.accent,
    fontWeight: "500" as const,
  },

  // ── Gear modal ──────────────────────────────────────────────
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "flex-end",
  },
  gearSheet: {
    backgroundColor: Colors.card,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingHorizontal: 20,
    paddingTop: 10,
    maxHeight: "70%",
  },
  handleBar: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.border,
    alignSelf: "center",
    marginBottom: 14,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "700" as const,
    color: Colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginBottom: 10,
  },
  optionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 13,
    paddingHorizontal: 14,
    borderRadius: 10,
    marginBottom: 2,
  },
  optionRowActive: {
    backgroundColor: "hsla(199, 89%, 48%, 0.12)",
  },
  optionRowPressed: {
    backgroundColor: Colors.input,
  },
  optionLabel: {
    fontSize: 15,
    color: Colors.textPrimary,
    fontWeight: "500" as const,
  },
  optionLabelActive: {
    color: Colors.white,
    fontWeight: "600" as const,
  },

  // ── Share modal extras ─────────────────────────────────────
  shareLinkBox: {
    backgroundColor: Colors.input,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 6,
  },
  shareLinkText: {
    fontSize: 14,
    color: Colors.accent,
    fontWeight: "500" as const,
    lineHeight: 20,
  },
  shareOptionLabel: {
    fontSize: 15,
    color: Colors.textPrimary,
    fontWeight: "500" as const,
    marginLeft: 12,
  },
  shareDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: Colors.border,
    marginVertical: 6,
    marginHorizontal: 14,
  },

  // ── Volume control ─────────────────────────────────────────
  volumeRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingBottom: 14,
    paddingHorizontal: 24,
  },
  volumeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.12)",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 70,
  },
  volumeBtnPressed: {
    backgroundColor: "rgba(255,255,255,0.25)",
  },
  volumeSliderArea: {
    width: 80,
    height: 36,
    justifyContent: "center",
  },
  volumeSliderTrack: {
    width: "100%",
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.2)",
    overflow: "visible",
  },
  volumeSliderFill: {
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.white,
  },
  volumeSliderThumb: {
    position: "absolute",
    top: -3,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: Colors.white,
    marginLeft: -5,
  },
  fullscreenVolumeRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingBottom: 10,
    paddingHorizontal: 32,
  },

  // ── Auto-watched confirmation overlay ──────────────────────
  watchedOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "center",
    alignItems: "center",
    zIndex: 200,
  },
  watchedBox: {
    backgroundColor: "#1E293B",
    borderRadius: 12,
    paddingHorizontal: 28,
    paddingVertical: 20,
    maxWidth: "80%",
    alignItems: "center",
    shadowColor: "#FFFFFF",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.35,
    shadowRadius: 24,
    elevation: 20,
  },
  watchedTitle: {
    fontSize: 17,
    fontWeight: "700" as const,
    color: "#FFFFFF",
    textAlign: "center",
    marginBottom: 6,
  },
  watchedSubtitle: {
    fontSize: 14,
    color: "#94A3B8",
    textAlign: "center",
    lineHeight: 20,
  },
});
