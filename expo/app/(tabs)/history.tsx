import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
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
  X,
  Ban,
  XCircle,
  History,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  Trash2,
} from "lucide-react-native";
import { Colors } from "@/constants/colors";
import type { Run, RunStatus, Agent, Channel } from "@/lib/database";
import {
  useRuns,
  useAgents,
  useCancelRun,
  useRealtimeInvalidation,
  useChannelsAll,
  useClearRuns,
  qk,
} from "@/lib/hooks";
import { useToast } from "@/components/Toast";
import { StatusPill } from "@/components/StatusPill";
import { timeAgo } from "@/lib/format";

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

  const handleDeleteAll = () => {
    Alert.alert(
      "Delete Run History",
      "This clears the Run History list only. Your videos, feed, and statistics are kept. This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete All",
          style: "destructive",
          onPress: () => {
            const runIds = runData.map((r) => r.id);
            clearRuns.mutate(runIds, {
              onSuccess: () => toast("Run history deleted", "success"),
              onError: () => toast("Failed to delete run history", "error"),
            });
          },
        },
      ],
    );
  };

  const runs = useRuns(100);
  const agents = useAgents();
  const cancelRun = useCancelRun();
  useRealtimeInvalidation("runs", qk.runs);

  const allChannels = useChannelsAll();
  const clearRuns = useClearRuns();

  const runData: Run[] = runs.data ?? [];

  // Track which runs have their channel list expanded
  const [expandedRuns, setExpandedRuns] = useState<Set<string>>(new Set());

  // Build agent lookup
  const agentMap = useMemo(() => {
    const map = new Map<string, Agent>();
    if (agents.data) {
      for (const a of agents.data) map.set(a.id, a);
    }
    return map;
  }, [agents.data]);

  // Build channels-by-agent lookup for per-run diagnostics
  const channelsByAgentMap = useMemo(() => {
    const map = new Map<string, Channel[]>();
    if (allChannels.data) {
      for (const ch of allChannels.data) {
        const list = map.get(ch.agent_id);
        if (list) {
          list.push(ch);
        } else {
          map.set(ch.agent_id, [ch]);
        }
      }
    }
    return map;
  }, [allChannels.data]);

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

        {runData.length > 0 && (
          <Pressable
            onPress={handleDeleteAll}
            disabled={clearRuns.isPending}
            style={({ pressed }) => [
              styles.deleteAllBtn,
              pressed && styles.deleteAllBtnPressed,
              clearRuns.isPending && styles.deleteAllBtnDisabled,
            ]}
          >
            <Trash2 size={16} color={Colors.destructive} />
            <Text style={styles.deleteAllText}>
              {clearRuns.isPending ? "Deleting…" : "Delete All"}
            </Text>
          </Pressable>
        )}
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
            const agent = agentMap.get(item.agent_id);
            const isRunning = item.status === "running";
            const isCancelling = cancelRun.isPending && cancelRun.variables === item.id;
            const isTerminal = item.status === "partial" || item.status === "failed" || item.status === "cancelled";
            const isExpanded = expandedRuns.has(item.id);
            const agentChannels = channelsByAgentMap.get(item.agent_id) ?? [];
            const hasChannels = agentChannels.length > 0;

            const toggleExpand = () => {
              setExpandedRuns((prev) => {
                const next = new Set(prev);
                if (next.has(item.id)) {
                  next.delete(item.id);
                } else {
                  next.add(item.id);
                }
                return next;
              });
            };

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

                  <StatusPill status={item.status} />
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
                    <View style={styles.statRow}>
                      <Text style={styles.statLabel}>Channels: </Text>
                      <Text style={styles.statValue}>
                        {fmtCount(item.channels_scanned)} / {fmtCount(item.channels_total)}
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

                {/* Warning summary for partial runs */}
                {item.status === "partial" && item.error_summary ? (
                  <View style={styles.warningRow}>
                    <AlertTriangle size={13} color={Colors.warning} />
                    <Text style={styles.warningLabel}>Completed with issues</Text>
                    <Text style={styles.warningSummary} numberOfLines={3}>
                      {item.error_summary}
                    </Text>
                  </View>
                ) : null}

                {/* Error summary for failed runs */}
                {item.status === "failed" && item.error_summary ? (
                  <View style={styles.errorRow}>
                    <XCircle size={13} color={Colors.destructive} />
                    <Text style={styles.errorSummary} numberOfLines={3}>
                      {item.error_summary}
                    </Text>
                  </View>
                ) : null}

                {/* Cancelled summary */}
                {item.status === "cancelled" && item.error_summary ? (
                  <View style={styles.cancelledRow}>
                    <Ban size={13} color={Colors.textMuted} />
                    <Text style={styles.cancelledSummary} numberOfLines={3}>
                      {item.error_summary}
                    </Text>
                  </View>
                ) : null}

                {/* Expandable channel list for terminal runs */}
                {isTerminal && hasChannels ? (
                  <>
                    <Pressable
                      onPress={toggleExpand}
                      style={({ pressed }) => [
                        styles.expandToggle,
                        pressed && styles.pressed,
                      ]}
                    >
                      {isExpanded ? (
                        <ChevronUp size={14} color={Colors.textSecondary} />
                      ) : (
                        <ChevronDown size={14} color={Colors.textSecondary} />
                      )}
                      <Text style={styles.expandToggleLabel}>
                        {isExpanded ? "Hide channels" : `Channels (${agentChannels.length})`}
                      </Text>
                    </Pressable>

                    {isExpanded ? (
                      <View style={styles.channelList}>
                        {agentChannels.map((ch) => {
                          const wasScanned =
                            ch.last_scanned_at &&
                            item.started_at &&
                            ch.last_scanned_at >= item.started_at;
                          return (
                            <View key={ch.id} style={styles.channelRow}>
                              <View
                                style={[
                                  styles.channelDot,
                                  {
                                    backgroundColor: wasScanned
                                      ? Colors.success
                                      : Colors.textMuted,
                                  },
                                ]}
                              />
                              <Text
                                style={styles.channelRowName}
                                numberOfLines={1}
                              >
                                {ch.channel_name ?? ch.channel_url ?? "Unnamed"}
                              </Text>
                              <Text style={styles.channelRowScanned}>
                                {ch.last_scanned_at
                                  ? timeAgo(ch.last_scanned_at)
                                  : "Never"}
                              </Text>
                            </View>
                          );
                        })}
                      </View>
                    ) : null}
                  </>
                ) : null}

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
    maxWidth: 720,
    width: "100%",
    alignSelf: "center",
  },
  headerText: { flex: 1 },
  heading: { fontSize: 24, fontWeight: "800" as const, color: Colors.textPrimary },
  subheading: { fontSize: 13, color: Colors.textSecondary, marginTop: 2 },

  // Loading
  loadingBox: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  loadingText: { fontSize: 14, color: Colors.textSecondary },

  // List
  list: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 40, maxWidth: 720, width: "100%", alignSelf: "center" },
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
    alignSelf: "stretch",
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

  // Pressed feedback
  pressed: { opacity: 0.7 },

  // Warning row (partial)
  warningRow: {
    marginTop: 12,
    backgroundColor: "rgba(245, 158, 11, 0.12)",
    borderRadius: 8,
    padding: 10,
    borderWidth: 1,
    borderColor: "rgba(245, 158, 11, 0.25)",
  },
  warningLabel: {
    fontSize: 12,
    fontWeight: "700" as const,
    color: Colors.warning,
  },
  warningSummary: {
    fontSize: 12,
    color: "rgba(245, 158, 11, 0.85)",
    marginTop: 2,
    lineHeight: 17,
  },

  // Error row (failed)
  errorRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 6,
    marginTop: 12,
    backgroundColor: Colors.destructiveBg,
    borderRadius: 8,
    padding: 10,
  },
  errorSummary: {
    flex: 1,
    fontSize: 12,
    color: Colors.destructive,
    lineHeight: 17,
  },

  // Cancelled row
  cancelledRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 6,
    marginTop: 12,
    backgroundColor: "rgba(96, 105, 119, 0.15)",
    borderRadius: 8,
    padding: 10,
  },
  cancelledSummary: {
    flex: 1,
    fontSize: 12,
    color: Colors.textMuted,
    lineHeight: 17,
  },

  // Expand toggle
  expandToggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 12,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: Colors.input,
    alignSelf: "flex-start",
  },
  expandToggleLabel: {
    fontSize: 12,
    fontWeight: "600" as const,
    color: Colors.textSecondary,
  },

  // Channel list
  channelList: {
    marginTop: 8,
    backgroundColor: Colors.input,
    borderRadius: 8,
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  channelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
  },
  channelDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    flexShrink: 0,
  },
  channelRowName: {
    flex: 1,
    fontSize: 12,
    color: Colors.textPrimary,
  },
  channelRowScanned: {
    fontSize: 11,
    color: Colors.textMuted,
    flexShrink: 0,
  },

  // Delete All button
  deleteAllBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.destructive,
  },
  deleteAllBtnPressed: { opacity: 0.6 },
  deleteAllBtnDisabled: { opacity: 0.5 },
  deleteAllText: {
    fontSize: 13,
    fontWeight: "600" as const,
    color: Colors.destructive,
  },
});
