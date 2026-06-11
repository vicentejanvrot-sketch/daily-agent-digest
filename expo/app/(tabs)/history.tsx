import { useMemo } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import {
  CheckCircle,
  X,
  Ban,
  Clock,
  XCircle,
  History,
} from "lucide-react-native";
import { Colors } from "@/constants/colors";
import type { Run, RunStatus, Agent } from "@/lib/database";
import {
  useRuns,
  useAgents,
  useCancelRun,
  useRealtimeInvalidation,
  qk,
} from "@/lib/hooks";
import { useToast } from "@/components/Toast";

// ── Status badge config ───────────────────────────────────────────

interface StatusBadgeConfig {
  icon: typeof CheckCircle;
  label: string;
  color: string;
  bg: string;
}

const STATUS_BADGE: Record<RunStatus, StatusBadgeConfig> = {
  success: { icon: CheckCircle, label: "Success", color: Colors.success, bg: "rgba(34, 197, 94, 0.18)" },
  partial: { icon: CheckCircle, label: "Partial", color: Colors.success, bg: "rgba(34, 197, 94, 0.18)" },
  running: { icon: Clock, label: "Running", color: Colors.accent, bg: "rgba(14, 165, 233, 0.18)" },
  failed: { icon: XCircle, label: "Failed", color: Colors.destructive, bg: Colors.destructiveBg },
  cancelled: { icon: Ban, label: "Cancelled", color: Colors.textMuted, bg: "rgba(96, 105, 119, 0.18)" },
};

// ── Helpers ───────────────────────────────────────────────────────

/** Duration from two ISO strings. "In progress" when no finished_at. */
function formatDuration(start: string | null, end: string | null): string {
  if (!start) return "—";
  if (!end) return "In progress";
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (Number.isNaN(ms) || ms < 0) return "—";
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (sec === 0) return `${min}m`;
  return `${min}m ${sec}s`;
}

/** "MMM d, yyyy at h:mm AM/PM" — e.g. "Jun 9, 2026 at 6:21 PM" */
function formatTimestamp(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  const month = months[d.getMonth()];
  const day = d.getDate();
  const year = d.getFullYear();
  let hours = d.getHours();
  const ampm = hours >= 12 ? "PM" : "AM";
  hours = hours % 12 || 12;
  const mins = String(d.getMinutes()).padStart(2, "0");
  return `${month} ${day}, ${year} at ${hours}:${mins} ${ampm}`;
}

/** Format a number or show "—" for null/undefined. */
function fmtCount(n: number | null | undefined): string {
  if (n == null) return "—";
  return String(n);
}

// ── Screen ────────────────────────────────────────────────────────

export default function HistoryScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const toast = useToast();

  const runs = useRuns(100);
  const agents = useAgents();
  const cancelRun = useCancelRun();
  useRealtimeInvalidation("runs", qk.runs);

  const runData: Run[] = runs.data ?? [];

  // Build agent lookup
  const agentMap = useMemo(() => {
    const map = new Map<string, Agent>();
    if (agents.data) {
      for (const a of agents.data) map.set(a.id, a);
    }
    return map;
  }, [agents.data]);

  return (
    <View style={[styles.root, { paddingTop: insets.top + 12 }]}>
      <View style={styles.header}>
        <History size={26} color={Colors.accent} />
        <View style={styles.headerText}>
          <Text style={styles.heading}>Run History</Text>
          <Text style={styles.subheading}>
            {runData.length > 0
              ? `${runData.length} run${runData.length === 1 ? "" : "s"} across all agents`
              : "Timeline of agent activity"}
          </Text>
        </View>
      </View>

      {runs.isLoading && runData.length === 0 ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator size="large" color={Colors.accent} />
          <Text style={styles.loadingText}>Loading runs…</Text>
        </View>
      ) : (
        <FlatList
          data={runData}
          keyExtractor={(r) => r.id}
          contentContainerStyle={[
            styles.list,
            runData.length === 0 && styles.listEmpty,
          ]}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={runs.isRefetching}
              onRefresh={() => {
                void runs.refetch();
              }}
              tintColor={Colors.accent}
            />
          }
          ListEmptyComponent={
            <View style={styles.emptyCard}>
              <History size={40} color={Colors.textMuted} />
              <Text style={styles.emptyTitle}>No runs yet</Text>
              <Text style={styles.emptyBody}>
                When you run an agent, its results will appear here.
              </Text>
            </View>
          }
          renderItem={({ item }) => {
            const cfg = STATUS_BADGE[item.status] ?? STATUS_BADGE.cancelled;
            const StatusIcon = cfg.icon;
            const agent = agentMap.get(item.agent_id);
            const isRunning = item.status === "running";
            const isCancelling = cancelRun.isPending && cancelRun.variables === item.id;

            return (
              <View style={styles.card}>
                {/* Header: agent name + status badge */}
                <View style={styles.cardTop}>
                  <Pressable
                    onPress={() => {
                      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      router.push({
                        pathname: "/(tabs)/agent-detail",
                        params: { agentId: item.agent_id },
                      });
                    }}
                    style={styles.agentPressable}
                  >
                    <Text style={styles.agentName} numberOfLines={1}>
                      {agent?.name ?? "Unknown Agent"}
                    </Text>
                  </Pressable>

                  <View style={[styles.badge, { backgroundColor: cfg.bg }]}>
                    <StatusIcon size={13} color={cfg.color} />
                    <Text style={[styles.badgeLabel, { color: cfg.color }]}>
                      {cfg.label}
                    </Text>
                  </View>
                </View>

                {/* Date */}
                <Text style={styles.timestamp}>
                  {formatTimestamp(item.started_at)}
                </Text>

                {/* Stat grid — 2 columns */}
                <View style={styles.statGrid}>
                  {/* Left column */}
                  <View style={styles.statColumn}>
                    <View style={styles.statRow}>
                      <Text style={styles.statLabel}>Duration: </Text>
                      <Text style={styles.statValue}>
                        {formatDuration(item.started_at, item.finished_at)}
                      </Text>
                    </View>
                    <View style={styles.statRow}>
                      <Text style={styles.statLabel}>New: </Text>
                      <Text style={styles.statValue}>
                        {fmtCount(item.videos_new_count)}
                      </Text>
                    </View>
                  </View>

                  {/* Right column */}
                  <View style={styles.statColumn}>
                    <View style={styles.statRow}>
                      <Text style={styles.statLabel}>Found: </Text>
                      <Text style={styles.statValue}>
                        {fmtCount(item.videos_found_count)}
                      </Text>
                    </View>
                    <View style={styles.statRow}>
                      <Text style={styles.statLabel}>Enriched: </Text>
                      <Text style={styles.statValue}>
                        {fmtCount(item.videos_enriched_count)}
                      </Text>
                    </View>
                  </View>
                </View>

                {/* Cancel button for running runs */}
                {isRunning ? (
                  <Pressable
                    onPress={() => {
                      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                      cancelRun.mutate(item.id, {
                        onSuccess: () => toast("Run cancelled", "success"),
                        onError: () =>
                          toast("Failed to cancel run", "error"),
                      });
                    }}
                    disabled={isCancelling}
                    style={[
                      styles.cancelButton,
                      isCancelling && styles.cancelButtonDisabled,
                    ]}
                  >
                    {isCancelling ? (
                      <ActivityIndicator size="small" color={Colors.destructive} />
                    ) : (
                      <X size={14} color={Colors.destructive} />
                    )}
                    <Text style={styles.cancelLabel}>
                      {isCancelling ? "Cancelling…" : "Cancel Run"}
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            );
          }}
        />
      )}
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  headerText: { flex: 1 },
  heading: { fontSize: 24, fontWeight: "800" as const, color: Colors.textPrimary },
  subheading: { fontSize: 13, color: Colors.textSecondary, marginTop: 2 },

  // Loading
  loadingBox: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  loadingText: { fontSize: 14, color: Colors.textSecondary },

  // List
  list: { padding: 16, paddingBottom: 40 },
  listEmpty: { flex: 1, justifyContent: "center" },

  // Empty
  emptyCard: {
    alignItems: "center",
    backgroundColor: Colors.card,
    borderRadius: 16,
    padding: 40,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
    gap: 12,
  },
  emptyTitle: { fontSize: 17, fontWeight: "700" as const, color: Colors.textPrimary },
  emptyBody: { fontSize: 13, color: Colors.textSecondary, textAlign: "center", lineHeight: 19 },

  // Card
  card: {
    backgroundColor: Colors.card,
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
  },

  // Top row
  cardTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  agentPressable: { flex: 1 },
  agentName: {
    fontSize: 16,
    fontWeight: "700" as const,
    color: Colors.textPrimary,
  },

  // Status badge
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  badgeLabel: { fontSize: 12, fontWeight: "600" as const },

  // Timestamp
  timestamp: { fontSize: 12, color: Colors.textSecondary, marginTop: 6 },

  // Stat grid
  statGrid: {
    flexDirection: "row",
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.border,
  },
  statColumn: {
    flex: 1,
    gap: 6,
  },
  statRow: {
    flexDirection: "row",
    alignItems: "baseline",
  },
  statLabel: {
    fontSize: 12,
    color: Colors.textMuted,
  },
  statValue: {
    fontSize: 13,
    fontWeight: "700" as const,
    color: Colors.textPrimary,
  },

  // Cancel button
  cancelButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    marginTop: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.destructive,
  },
  cancelButtonDisabled: { opacity: 0.5 },
  cancelLabel: { fontSize: 13, fontWeight: "600" as const, color: Colors.destructive },
});
