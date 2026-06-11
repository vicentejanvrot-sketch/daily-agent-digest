import createContextHook from "@nkzw/create-context-hook";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Animated,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { BlurView } from "expo-blur";
import { CheckCircle2, Loader2, Tv } from "lucide-react-native";
import { supabase } from "@/lib/supabase";
import { Colors } from "@/constants/colors";

// ── Types ──────────────────────────────────────────────────────────

export type OverlayStatus = "running" | "success" | "error" | null;

export interface RunProgress {
  channelsTotal: number;
  channelsScanned: number;
  currentChannelName: string | null;
}

interface OverlayState {
  status: OverlayStatus;
  agentName: string;
  runId: string | null;
  message: string;
  progress: RunProgress;
}

const INITIAL_STATE: OverlayState = {
  status: null,
  agentName: "",
  runId: null,
  message: "",
  progress: { channelsTotal: 0, channelsScanned: 0, currentChannelName: null },
};

// ── Colour tokens for the overlay states ───────────────────────────

const overlayBlue = "hsl(199, 89%, 48%)" as const;
const overlayBlueBg = "hsla(199, 89%, 48%, 0.18)" as const;
const overlayGreen = "hsl(152, 69%, 50%)" as const;
const overlayRed = "hsl(0, 72%, 55%)" as const;

// ── Context hook ───────────────────────────────────────────────────

function useRunningOverlayState() {
  const [state, setState] = useState<OverlayState>(INITIAL_STATE);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cleanupChannel = useCallback(() => {
    if (channelRef.current) {
      void supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }
  }, []);

  const clearHideTimer = useCallback(() => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  /** Start tracking a running agent via Realtime. */
  const showRunning = useCallback(
    (agentName: string, runId: string, message?: string) => {
      cleanupChannel();
      clearHideTimer();

      setState({
        status: "running",
        agentName,
        runId,
        message: message ?? "Scanning channels for new videos…",
        progress: { channelsTotal: 0, channelsScanned: 0, currentChannelName: null },
      });

      // Subscribe to run-row updates
      const channel = supabase
        .channel(`run-progress-${runId}`)
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "runs",
            filter: `id=eq.${runId}`,
          },
          (payload) => {
            const row = payload.new as Record<string, unknown>;
            const newStatus = row.status as string | undefined;

            if (newStatus === "success") {
              cleanupChannel();
              const count = (row.videos_new_count as number) ?? 0;
              setState((prev) => ({
                ...prev,
                status: "success",
                message: count > 0 ? `Found ${count} new videos` : "No new videos found",
              }));
            } else if (newStatus === "partial") {
              // Partial completion — some channels scanned, some failed
              cleanupChannel();
              const count = (row.videos_new_count as number) ?? 0;
              setState((prev) => ({
                ...prev,
                status: "success",
                message:
                  count > 0
                    ? `Found ${count} new videos (some channels couldn't be scanned)`
                    : "Scan finished — some channels couldn't be scanned.",
              }));
            } else if (newStatus === "failed" || newStatus === "cancelled") {
              cleanupChannel();
              setState((prev) => ({
                ...prev,
                status: "error",
                message:
                  (row.error_summary as string) || "Check run details for more information",
              }));
            } else if (newStatus === "running" || newStatus == null) {
              // Still running — update progress
              setState((prev) => ({
                ...prev,
                progress: {
                  channelsTotal:
                    (row.channels_total as number) ??
                    prev.progress.channelsTotal,
                  channelsScanned:
                    (row.channels_scanned as number) ??
                    prev.progress.channelsScanned,
                  currentChannelName:
                    (row.current_channel_name as string) ?? null,
                },
              }));
            } else {
              // Safety net: unrecognised terminal status — resolve as success
              // so the overlay never gets permanently stuck
              cleanupChannel();
              setState((prev) => ({
                ...prev,
                status: "success",
                message: "Scan complete",
              }));
            }
          },
        )
        .subscribe((status) => {
          if (status === "CLOSED" || status === "CHANNEL_ERROR") {
            channelRef.current = null;
          }
        });

      channelRef.current = channel;
    },
    [cleanupChannel, clearHideTimer],
  );

  /** Manually show a success result. */
  const showSuccess = useCallback(
    (agentName: string, message: string) => {
      cleanupChannel();
      clearHideTimer();
      setState({
        status: "success",
        agentName,
        runId: null,
        message,
        progress: { channelsTotal: 0, channelsScanned: 0, currentChannelName: null },
      });
    },
    [cleanupChannel, clearHideTimer],
  );

  /** Manually show an error result. */
  const showError = useCallback(
    (agentName: string, message: string) => {
      cleanupChannel();
      clearHideTimer();
      setState({
        status: "error",
        agentName,
        runId: null,
        message,
        progress: { channelsTotal: 0, channelsScanned: 0, currentChannelName: null },
      });
    },
    [cleanupChannel, clearHideTimer],
  );

  /** Dismiss the overlay. */
  const hideOverlay = useCallback(() => {
    cleanupChannel();
    clearHideTimer();
    setState(INITIAL_STATE);
  }, [cleanupChannel, clearHideTimer]);

  // Auto-hide on success / error
  useEffect(() => {
    if (state.status === "success") {
      hideTimerRef.current = setTimeout(hideOverlay, 3000);
    } else if (state.status === "error") {
      hideTimerRef.current = setTimeout(hideOverlay, 4000);
    }
    return clearHideTimer;
  }, [state.status, hideOverlay, clearHideTimer]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanupChannel();
      clearHideTimer();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    state,
    showRunning,
    showSuccess,
    showError,
    hideOverlay,
  } as const;
}

export const [RunningOverlayProvider, useRunningOverlay] =
  createContextHook(useRunningOverlayState);

// ── Overlay UI component ───────────────────────────────────────────

export function RunningOverlay() {
  const { state, hideOverlay } = useRunningOverlay();

  // Fade-in animation
  const opacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (state.status) {
      opacity.setValue(0);
      Animated.timing(opacity, {
        toValue: 1,
        duration: 250,
        useNativeDriver: true,
      }).start();
    }
  }, [state.status, opacity]);

  if (!state.status) return null;

  const isRunning = state.status === "running";
  const canDismiss = !isRunning;

  const statusColor =
    isRunning ? overlayBlue : state.status === "success" ? overlayGreen : overlayRed;

  return (
    <Modal transparent visible animationType="none" statusBarTranslucent>
      <View style={styles.modalFill}>
        {/* Dimmed + blurred backdrop */}
        <Animated.View style={[styles.backdrop, { opacity }]}>
          <BlurView intensity={40} tint="dark" style={StyleSheet.absoluteFill} />
          <View style={styles.backdropFill} />
        </Animated.View>

        {/* Tappable area to dismiss (only when not running) */}
        <Pressable
          style={styles.dismissLayer}
          onPress={canDismiss ? hideOverlay : undefined}
        >
          {/* The card — stops tap propagation so tapping the card itself doesn't dismiss */}
          <Animated.View
            style={[styles.cardWrapper, { opacity }]}
            onStartShouldSetResponder={() => true}
          >
            <Pressable
              style={[
                styles.card,
                {
                  backgroundColor: statusColor,
                  shadowColor: "#FFFFFF",
                  shadowOffset: { width: 0, height: 0 },
                  shadowOpacity: 0.5,
                  shadowRadius: 30,
                  elevation: 24,
                },
              ]}
            >
              {isRunning ? (
                <RunningCard state={state} />
              ) : state.status === "success" ? (
                <SuccessCard state={state} />
              ) : (
                <ErrorCard state={state} />
              )}
            </Pressable>

            {canDismiss ? (
              <Text style={styles.dismissHint}>Click anywhere to dismiss</Text>
            ) : null}
          </Animated.View>
        </Pressable>
      </View>
    </Modal>
  );
}

// ── Running card ───────────────────────────────────────────────────

function RunningCard({ state }: { state: OverlayState }) {
  const spin = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const spinLoop = Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: 1000,
        useNativeDriver: true,
      }),
    );
    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1.5,
          duration: 800,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 1,
          duration: 800,
          useNativeDriver: true,
        }),
      ]),
    );
    spinLoop.start();
    pulseLoop.start();
    return () => {
      spinLoop.stop();
      pulseLoop.stop();
    };
  }, [spin, pulse]);

  const spinInterp = spin.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "360deg"],
  });

  const { channelsTotal, channelsScanned, currentChannelName } = state.progress;
  const progressPercent =
    channelsTotal > 0
      ? Math.round((channelsScanned / channelsTotal) * 100)
      : 0;

  return (
    <View style={cardStyles.inner}>
      {/* Spinner row */}
      <View style={cardStyles.spinnerRow}>
        <Animated.View
          style={[
            cardStyles.pulseRing,
            {
              transform: [{ scale: pulse }],
              opacity: pulse.interpolate({
                inputRange: [1, 1.5],
                outputRange: [0.4, 0],
              }),
            },
          ]}
        />
        <Animated.View style={{ transform: [{ rotate: spinInterp }] }}>
          <Loader2 size={32} color={Colors.white} strokeWidth={2.5} />
        </Animated.View>
      </View>

      {/* Title */}
      <Text style={cardStyles.title}>
        {"\uD83D\uDE80"} Running &ldquo;{state.agentName}&rdquo;
      </Text>
      <Text style={cardStyles.message}>{state.message}</Text>

      {/* Progress block */}
      {channelsTotal > 0 ? (
        <View style={cardStyles.progressBlock}>
          <View style={cardStyles.progressHeader}>
            <Text style={cardStyles.progressLabel}>Scanning channels</Text>
            <Text style={cardStyles.progressCount}>
              {channelsScanned} / {channelsTotal}
            </Text>
          </View>
          <View style={cardStyles.progressTrack}>
            <View
              style={[
                cardStyles.progressFill,
                { width: `${progressPercent}%` as unknown as number },
              ]}
            />
          </View>
          {currentChannelName ? (
            <View style={cardStyles.channelRow}>
              <Tv size={12} color="rgba(255,255,255,0.7)" />
              <Text style={cardStyles.channelName} numberOfLines={1}>
                {currentChannelName}
              </Text>
            </View>
          ) : null}
        </View>
      ) : (
        <View style={cardStyles.initRow}>
          <View style={cardStyles.initDot} />
          <Text style={cardStyles.initText}>Initializing…</Text>
        </View>
      )}
    </View>
  );
}

// ── Success card ───────────────────────────────────────────────────

function SuccessCard({ state }: { state: OverlayState }) {
  return (
    <View style={cardStyles.inner}>
      <View style={cardStyles.iconCircle}>
        <CheckCircle2 size={36} color={overlayGreen} strokeWidth={2.5} />
      </View>
      <Text style={cardStyles.title}>
        {"\u2611\uFE0F"} &ldquo;{state.agentName}&rdquo; Completed!
      </Text>
      <Text style={cardStyles.message}>{state.message}</Text>
    </View>
  );
}

// ── Error card ─────────────────────────────────────────────────────

function ErrorCard({ state }: { state: OverlayState }) {
  return (
    <View style={cardStyles.inner}>
      <Text style={cardStyles.title}>
        {"\u274C"} &ldquo;{state.agentName}&rdquo; Failed
      </Text>
      <Text style={cardStyles.message}>{state.message || "Check run details for more information"}</Text>
    </View>
  );
}

// ── Styles ─────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  modalFill: {
    flex: 1,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  backdropFill: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.75)",
  },
  dismissLayer: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "center",
    alignItems: "center",
  },
  cardWrapper: {
    width: "100%",
    alignItems: "center",
    paddingHorizontal: 24,
  },
  card: {
    width: "100%",
    maxWidth: 380,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
    padding: 24,
  },
  dismissHint: {
    color: "rgba(255,255,255,0.5)",
    fontSize: 12,
    marginTop: 16,
    textAlign: "center",
  },
});

const cardStyles = StyleSheet.create({
  inner: {
    alignItems: "center",
  },
  spinnerRow: {
    width: 56,
    height: 56,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  pulseRing: {
    position: "absolute",
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "rgba(255,255,255,0.25)",
  },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: Colors.white,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  title: {
    fontSize: 17,
    fontWeight: "700" as const,
    color: Colors.white,
    textAlign: "center",
    lineHeight: 24,
  },
  message: {
    fontSize: 14,
    color: "rgba(255,255,255,0.8)",
    marginTop: 6,
    textAlign: "center",
    lineHeight: 20,
  },
  progressBlock: {
    width: "100%",
    marginTop: 18,
  },
  progressHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  progressLabel: {
    fontSize: 12,
    color: "rgba(255,255,255,0.7)",
  },
  progressCount: {
    fontSize: 12,
    fontWeight: "600" as const,
    color: Colors.white,
  },
  progressTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: "rgba(255,255,255,0.2)",
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: 3,
    backgroundColor: Colors.white,
  },
  channelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 8,
  },
  channelName: {
    flex: 1,
    fontSize: 12,
    color: "rgba(255,255,255,0.7)",
  },
  initRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 14,
  },
  initDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "rgba(255,255,255,0.6)",
  },
  initText: {
    fontSize: 13,
    color: "rgba(255,255,255,0.7)",
  },
});
