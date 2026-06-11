import { useLocalSearchParams, router } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Linking,
  Modal,
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
import * as Clipboard from "expo-clipboard";
import * as ScreenOrientation from "expo-screen-orientation";
import VideoPlayerContent from "@/components/VideoPlayerContent";
import type { VideoPlayerHandle } from "@/components/VideoPlayerContent";
import {
  Check,
  Circle,
  Clock,
  Copy,
  ExternalLink,
  Heart,
  MessageCircle,
  MoreHorizontal,
  Send,
  Settings,
  Share2,
  X,
} from "lucide-react-native";
import * as Haptics from "expo-haptics";
import { Colors } from "@/constants/colors";
import { useUpdateItemStatus } from "@/lib/hooks";
import { useToast } from "@/components/Toast";
import { openExternalLink } from "@/lib/open-link";
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

// ── Screen ─────────────────────────────────────────────────────────

export default function VideoPlayerScreen() {
  const { videoId, itemId } = useLocalSearchParams<{
    videoId?: string;
    itemId?: string;
  }>();
  const insets = useSafeAreaInsets();
  const updateStatus = useUpdateItemStatus();
  const showToast = useToast();

  // Shared quality / speed prefs (synced with Settings screen)
  const { quality, setQuality, speed, setSpeed, ready: prefsReady } = useVideoQuality();

  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const rawId = videoId?.trim() || null;
  const videoIdStr = rawId ? normalizeVideoId(rawId) : null;
  const itemIdStr = itemId?.trim() ?? null;

  // Auto-mark-as-watched guard + overlay (declared before the effect that uses them)
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
    autoWatchedRef.current = false;
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

  // Native-only ref for injecting quality changes into the WebView
  const playerRef = useRef<VideoPlayerHandle | null>(null);

  // ── Fullscreen management ────────────────────────────────────

  const enterFullscreen = useCallback(async () => {
    setIsFullscreen(true);
    if (Platform.OS !== "web") {
      await ScreenOrientation.lockAsync(
        ScreenOrientation.OrientationLock.LANDSCAPE,
      );
    } else {
      await playerRef.current?.requestFullscreen();
    }
  }, []);

  const exitFullscreen = useCallback(async () => {
    setIsFullscreen(false);
    if (Platform.OS !== "web") {
      await ScreenOrientation.unlockAsync();
    } else {
      await playerRef.current?.exitFullscreen();
    }
  }, []);

  const handleStateChange = useCallback(
    (event: string) => {
      if (event === "playing") {
        // Cancel any pending error timer — player recovered
        if (errorTimerRef.current) {
          clearTimeout(errorTimerRef.current);
          errorTimerRef.current = null;
        }
        setLoadError(false);
        enterFullscreen();
      } else if (event === "paused" || event === "ended") {
        exitFullscreen();
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
              });
            }, 3000);
          })
          .catch(() => {
            // Silently ignore — don't surface errors for auto-mark
          });
      }
    },
    [enterFullscreen, exitFullscreen, itemIdStr, updateStatus, watchedOverlayOpacity],
  );

  // Restore orientation / exit fullscreen on unmount
  useEffect(() => {
    return () => {
      if (Platform.OS !== "web") {
        ScreenOrientation.unlockAsync();
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
  }, []);

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

  const handleClose = useCallback(() => {
    router.back();
  }, []);

  const handleStatusChange = useCallback(
    async (status: ItemStatus) => {
      if (!itemIdStr) return;
      void Haptics.selectionAsync();
      try {
        await updateStatus.mutateAsync({ id: itemIdStr, status });
        showToast(`Marked as ${STATUS_ICONS[status].label}`, "success");
      } catch {
        showToast("Couldn't update status", "error");
      }
    },
    [itemIdStr, updateStatus, showToast],
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
      // Inject quality change into the YouTube player (native only)
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
      await setSpeed(s);
      const rate = Number(s);
      // Inject speed change into the running YouTube player
      if (playerRef.current) {
        playerRef.current.inject(
          `(function(){try{var f=document.getElementsByTagName('iframe');for(var i=0;i<f.length;i++){if((f[i].src||'').indexOf('youtube.com')!==-1){f[i].contentWindow.postMessage(JSON.stringify({event:'command',func:'setPlaybackRate',args:[${rate}]}),'*');break;}}}catch(e){}})();`,
        );
      }
    },
    [setSpeed],
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
      } catch {
        // ignore polling failures
      }
    }, 1000);
    return () => clearInterval(id);
  }, [ready]);

  // ── playbackRate as a number ───────────────────────────────────

  const playbackRate = Number(speed);

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

  // ── Normal: embedded player ─────────────────────────────────────

  return (
    <View style={styles.root}>
      {/* Chrome: hidden in fullscreen */}
      {!isFullscreen && (
        <>
          {/* Header */}
          <View style={[styles.header, { paddingTop: insets.top }]}>
            <Pressable onPress={handleClose} hitSlop={12} style={styles.closeBtn}>
              <X size={24} color={Colors.textPrimary} />
            </Pressable>
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
            {/* Gear icon — opens quality/speed sheet */}
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

          {/* Inline speed selector */}
          <View style={styles.speedSelectorRow}>
            <Text style={styles.speedLabel}>Speed</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.speedPillsContainer}
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
          </View>

          {/* Countdown time-left pill */}
          {duration > 0 && (
            <View style={styles.countdownWrapper}>
              <View style={styles.countdownPill}>
                <Clock size={14} color={Colors.textMuted} />
                <Text style={styles.countdownText}>
                  {formatTime(Math.max(0, duration - currentTime))} left
                </Text>
              </View>
            </View>
          )}

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
        </>
      )}

      {/* Player */}
      <View
        style={
          isFullscreen ? styles.fullscreenPlayerWrapper : styles.playerWrapper
        }
      >
        {!ready && !isFullscreen && (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator size="large" color={Colors.accent} />
          </View>
        )}
        <VideoPlayerContent
          ref={playerRef}
          videoId={videoIdStr}
          height={isFullscreen ? Math.max(windowWidth, windowHeight) : 220}
          playbackRate={playbackRate}
          onReady={() => {
            setReady(true);
            // Cancel any pending error timer — player is ready
            if (errorTimerRef.current) {
              clearTimeout(errorTimerRef.current);
              errorTimerRef.current = null;
            }
            setLoadError(false);
            // Re-apply the persisted speed on a freshly loaded video
            const rate = Number(speed);
            if (rate !== 1 && playerRef.current) {
              playerRef.current.inject(
                `(function(){try{var f=document.getElementsByTagName('iframe');for(var i=0;i<f.length;i++){if((f[i].src||'').indexOf('youtube.com')!==-1){f[i].contentWindow.postMessage(JSON.stringify({event:'command',func:'setPlaybackRate',args:[${rate}]}),'*');break;}}}catch(e){}})();`,
              );
            }
          }}
          onError={() => {
            // Debounce: only show error if player doesn't recover within 4 seconds
            if (errorTimerRef.current) {
              clearTimeout(errorTimerRef.current);
            }
            errorTimerRef.current = setTimeout(() => {
              errorTimerRef.current = null;
              setLoadError(true);
            }, 4000);
          }}
          onChangeState={handleStateChange}
        />

        {/* Fullscreen close button */}
        {isFullscreen && (
          <Pressable
            onPress={() => {
              void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              exitFullscreen();
            }}
            style={[
              styles.fullscreenCloseBtn,
              { top: insets.top + 8 },
            ]}
            hitSlop={12}
          >
            <X size={22} color={Colors.white} />
          </Pressable>
        )}
      </View>

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
          {/* Pressable that absorbs taps on the backdrop */}
          <View />
        </Pressable>

        {/* Bottom sheet — scrollable so nothing is clipped */}
        <View
          style={[styles.gearSheet, { paddingBottom: insets.bottom + 16 }]}
        >
          {/* Drag handle */}
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
  playerWrapper: {
    backgroundColor: Colors.black,
    overflow: "hidden",
  },
  fullscreenPlayerWrapper: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: Colors.black,
    zIndex: 100,
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
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.black,
    zIndex: 1,
  },

  // ── Inline speed selector ──────────────────────────────────
  speedSelectorRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 8,
    gap: 12,
  },
  speedLabel: {
    fontSize: 13,
    fontWeight: "500" as const,
    color: Colors.textMuted,
    minWidth: 42,
  },
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

  // ── Countdown pill ─────────────────────────────────────────
  countdownWrapper: {
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 6,
  },
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

  actionsRow: {
    flexDirection: "row",
    justifyContent: "space-evenly",
    paddingVertical: 16,
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
