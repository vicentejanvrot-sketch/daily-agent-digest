import { useMemo, useState, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import {
  Bot,
  Video,
  Activity,
  TrendingUp,
  Rss,
  Play,
  Clock,
  CheckCircle2,
  Circle,
  Clock4,
  MoreVertical,
  Sparkles,
} from "lucide-react-native";
import { Colors } from "@/constants/colors";

const statIconBlue = "hsl(199, 89%, 55%)" as const;
const statIconBg = "hsla(199, 89%, 55%, 0.16)" as const;
import {
  useAgents,
  useRuns,
  useItems,
  useChannelsAll,
  useStartRun,
  useDeleteAgent,
  useRealtimeInvalidation,
  getAgentColor,
  qk,
} from "@/lib/hooks";
import { supabase } from "@/lib/supabase";
import { timeAgo, relativeTime, compactNumber } from "@/lib/format";
import { useToast } from "@/components/Toast";
import { StatusPill } from "@/components/StatusPill";
import WatchTimeStats from "@/components/WatchTimeStats";
import { useRunningOverlay } from "@/lib/running-overlay";
import type { ItemStatus, Run, Channel } from "@/lib/database";

export default function DashboardScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const showToast = useToast();

  const agents = useAgents();
  const runs = useRuns(50);
  const items = useItems("all");
  const channels = useChannelsAll();
  const runAgent = useStartRun();
  const deleteAgent = useDeleteAgent();
  const overlay = useRunningOverlay();
  const queryClient = useQueryClient();

  useRealtimeInvalidation("runs", qk.runs, !overlay.state.status);
  useRealtimeInvalidation("items", qk.items("all"), !overlay.state.status);

  const [pendingId, setPendingId] = useState<string | null>(null);

  const refreshing =
    agents.isRefetching || runs.isRefetching || items.isRefetching || channels.isRefetching;
  const onRefresh = useCallback(() => {
    void agents.refetch();
    void runs.refetch();
    void items.refetch();
    void channels.refetch();
  }, [agents, runs, items, channels]);

  // ── derived stats ──────────────────────────────────────────────
  const listUnsorted = agents.data ?? [];
  const list = useMemo(
    () =>
      [...listUnsorted].sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
      ),
    [listUnsorted],
  );
  const runList = runs.data ?? [];
  const itemList = items.data ?? [];
  const channelList = channels.data ?? [];

  const perAgentChannels = useMemo(() => {
    const map: Record<string, Channel[]> = {};
    for (const ch of channelList) {
      if (!map[ch.agent_id]) map[ch.agent_id] = [];
      map[ch.agent_id].push(ch);
    }
    return map;
  }, [channelList]);

  const perAgentItems = useMemo(() => {
    const map: Record<string, { total: number; watched: number; unwatched: number; watchLater: number; liked: number }> = {};
    for (const it of itemList) {
      const idx = it.agent_id;
      if (!map[idx]) map[idx] = { total: 0, watched: 0, unwatched: 0, watchLater: 0, liked: 0 };
      map[idx].total += 1;
      if (it.user_status === "watched") map[idx].watched += 1;
      else if (it.user_status === "not_watched" || !it.user_status) map[idx].unwatched += 1;
      else if (it.user_status === "watch_later") map[idx].watchLater += 1;
      else if (it.user_status === "liked") map[idx].liked += 1;
    }
    return map;
  }, [itemList]);

  const perAgentLastRun = useMemo(() => {
    const map: Record<string, Run> = {};
    for (const r of runList) {
      if (!map[r.agent_id] && r.status === "success") map[r.agent_id] = r;
    }
    return map;
  }, [runList]);

  const successRate = useMemo(() => {
    if (runList.length === 0) return 0;
    const ok = runList.filter((r) => r.status === "success").length;
    return Math.round((ok / runList.length) * 100);
  }, [runList]);

  // ── run triggers ────────────────────────────────────────────────
  const runOne = useCallback(
    async (agentId: string, agentName: string) => {
      // Insert the run row first so we have a runId for the overlay + Realtime.
      const run = await runAgent.mutateAsync(agentId);
      // Show the overlay immediately; live progress arrives via Realtime.
      overlay.showRunning(agentName, run.id);

      // Invoke the existing edge function.
      const { error } = await supabase.functions.invoke("run-agent", {
        body: { agentId, runId: run.id },
      });
      if (error) {
        await supabase
          .from("runs")
          .update({
            status: "failed",
            finished_at: new Date().toISOString(),
            error_summary: error.message,
          })
          .eq("id", run.id);
        overlay.showError(agentName, error.message);
        void queryClient.invalidateQueries({ queryKey: qk.runs });
        return;
      }

      // Poll the runs table until the edge function finishes processing.
      // The realtime subscription in showRunning updates the overlay UI;
      // we just need to detect completion so "Run All" can sequence agents.
      while (true) {
        await new Promise((r) => setTimeout(r, 1500));
        const { data: polled } = await supabase
          .from("runs")
          .select("status, videos_new_count, error_summary")
          .eq("id", run.id)
          .single();

        if (!polled) continue;

        if (polled.status === "success") {
          // The realtime subscription may have already shown success.
          // Show it explicitly to guarantee the green card is visible.
          const count = (polled.videos_new_count as number) ?? 0;
          overlay.showSuccess(
            agentName,
            count > 0 ? `Found ${count} new videos` : "No new videos found",
          );
          // Brief pause so the user can see the green completion card.
          await new Promise((r) => setTimeout(r, 2000));
          break;
        }

        if (polled.status === "failed" || polled.status === "cancelled") {
          overlay.showError(
            agentName,
            (polled.error_summary as string) || "An unknown error occurred",
          );
          await new Promise((r) => setTimeout(r, 2000));
          break;
        }
      }

      void queryClient.invalidateQueries({ queryKey: qk.runs });
    },
    [runAgent, overlay, queryClient],
  );

  const triggerRun = useCallback(
    async (agentId: string) => {
      const agent = list.find((a) => a.id === agentId);
      const agentName = agent?.name ?? "Agent";
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      setPendingId(agentId);
      try {
        await runOne(agentId, agentName);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Failed to start run";
        overlay.showError(agentName, msg);
      } finally {
        setPendingId(null);
      }
    },
    [list, runOne, overlay],
  );

  const triggerRunAll = useCallback(async () => {
    if (list.length === 0) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setPendingId("all");
    // Process each agent in turn — the overlay shows progress per agent.
    for (const agent of list) {
      try {
        await runOne(agent.id, agent.name);
      } catch (e) {
        overlay.showError(agent.name, e instanceof Error ? e.message : "Run failed");
      }
    }
    setPendingId(null);
  }, [list, runOne, overlay]);

  const handleDelete = useCallback(
    (agentId: string, agentName: string) => {
      Alert.alert("Delete Agent", `Delete "${agentName}"? This cannot be undone.`, [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              await deleteAgent.mutateAsync(agentId);
              showToast("Agent deleted", "success");
            } catch (e) {
              showToast(e instanceof Error ? e.message : "Delete failed", "error");
            }
          },
        },
      ]);
    },
    [deleteAgent, showToast],
  );

  const loading = agents.isLoading || runs.isLoading || items.isLoading || channels.isLoading;

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 70 },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        scrollEnabled={!overlay.state.status}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.accent} />
        }
      >
        {/* ── Header ──────────────────────────────────────────────── */}
      <View style={styles.header}>
        <Text style={styles.heading}>Dashboard</Text>
        <View style={styles.headerBtns}>
          <Pressable
            style={({ pressed }) => [styles.newAgentBtn, pressed && styles.pressed]}
            onPress={() => router.push("/agent-form")}
          >
            <Text style={styles.newAgentText}>+ New Agent</Text>
          </Pressable>
          {list.length > 0 ? (
            <Pressable
              style={({ pressed }) => [styles.runAllBtn, pressed && styles.pressed]}
              onPress={() => void triggerRunAll()}
              disabled={pendingId !== null}
            >
              <LinearGradient
                colors={Colors.accentGradient as unknown as readonly [string, string, ...string[]]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={StyleSheet.absoluteFill}
              />
              {pendingId === "all" ? (
                <ActivityIndicator size="small" color={Colors.white} />
              ) : (
                <>
                  <Play size={14} color={Colors.white} fill={Colors.white} />
                  <Text style={styles.runAllText}>Run All</Text>
                </>
              )}
            </Pressable>
          ) : null}
        </View>
      </View>

      {loading ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator color={Colors.accent} />
        </View>
      ) : (
        <>
          {/* ── Stat cards ───────────────────────────────────────── */}
          <View style={styles.grid}>
            <StatCard
              icon={<Bot size={20} color={statIconBlue} strokeWidth={1.75} />}
              label="Active Agents"
              value={list.length}
            />
            <StatCard
              icon={<Video size={20} color={statIconBlue} strokeWidth={1.75} />}
              label="Channels Tracked"
              value={channelList.length}
            />
            <StatCard
              icon={<Activity size={20} color={statIconBlue} strokeWidth={1.75} />}
              label="Recent Runs"
              value={runList.length}
            />
            <StatCard
              icon={<TrendingUp size={20} color={statIconBlue} strokeWidth={1.75} />}
              label="Success Rate"
              value={successRate}
              suffix="%"
            />
          </View>

          {/* ── My Feeds ─────────────────────────────────────────── */}
          <SectionHeader
            title="My Feeds"
            action={list.length > 0 ? "View All" : undefined}
            onAction={() => router.push("/(tabs)/feed")}
          />
          {list.length === 0 ? (
            <EmptyCard text="No agents yet. Create one on the web app." />
          ) : (
            list.map((agent, i) => {
              const accent = getAgentColor(i);
              const stats = perAgentItems[agent.id] ?? { total: 0, watched: 0, unwatched: 0, watchLater: 0, liked: 0 };
              const pct = stats.total > 0 ? Math.round((stats.watched / stats.total) * 100) : 0;
              const allCaughtUp = stats.total > 0 && stats.unwatched === 0;
              return (
                <FeedCard
                  key={agent.id}
                  agent={agent}
                  accent={accent}
                  stats={stats}
                  watchedPct={pct}
                  allCaughtUp={allCaughtUp}
                  onPress={() => {
                    const status =
                      stats.unwatched > 0
                        ? "not_watched"
                        : stats.watchLater > 0
                          ? "watch_later"
                          : stats.watched > 0
                            ? "watched"
                            : "not_watched";
                    router.push({
                      pathname: "/(tabs)/feed",
                      params: { agentId: agent.id, status },
                    });
                  }}
                />
              );
            })
          )}

          {/* ── Watch Time Statistics ────────────────────────────── */}
          <WatchTimeStats />

          {/* ── My Agents ────────────────────────────────────────── */}
          <View style={styles.sectionSpacer} />
          <SectionHeader title="My Agents" />
          {list.length === 0 ? (
            <EmptyCard text="No agents yet. Create one on the web app." />
          ) : (
            list.map((agent, i) => {
              const accent = getAgentColor(i);
              const busy = pendingId === agent.id;
              const lastRun = perAgentLastRun[agent.id];
              const chCount = perAgentChannels[agent.id]?.length ?? 0;
              const newVideos = lastRun?.videos_new_count ?? 0;
              return (
                <AgentCard
                  key={agent.id}
                  agent={agent}
                  accent={accent}
                  channelCount={chCount}
                  lastRun={lastRun}
                  newVideos={newVideos}
                  busy={busy}
                  onRunNow={() => void triggerRun(agent.id)}
                  onEdit={() =>
                    router.push({ pathname: "/agent-form", params: { agentId: agent.id } })
                  }
                  onDelete={() => handleDelete(agent.id, agent.name)}
                  onTap={() =>
                    router.push({ pathname: "/(tabs)/agent-detail", params: { agentId: agent.id } })
                  }
                />
              );
            })
          )}
        </>
        )}
      </ScrollView>
    </View>
  );
}

// ── Sub-components ─────────────────────────────────────────────────

function StatCard({
  icon,
  label,
  value,
  suffix,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  suffix?: string;
}) {
  return (
    <View style={statStyles.card}>
      <View style={statStyles.topRow}>
        <Text style={statStyles.label}>{label}</Text>
        <View style={statStyles.iconBox}>{icon}</View>
      </View>
      <Text style={statStyles.value}>
        {value}
        {suffix ?? ""}
      </Text>
    </View>
  );
}

const statStyles = StyleSheet.create({
  card: {
    width: "47%",
    backgroundColor: Colors.card,
    borderRadius: 8,
    padding: 14,
    borderWidth: 1,
    borderColor: "hsl(220, 25%, 18%)",
    minHeight: 94,
    justifyContent: "space-between",
  },
  topRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  label: { fontSize: 12, fontWeight: "600" as const, color: Colors.textSecondary, flexShrink: 1, numberOfLines: 2, marginRight: 6 },
  iconBox: { width: 34, height: 34, borderRadius: 8, alignItems: "center", justifyContent: "center", flexShrink: 0, backgroundColor: statIconBg },
  value: { fontSize: 28, fontWeight: "800" as const, color: Colors.textPrimary, marginTop: 4 },
});

function FeedCard({
  agent,
  accent,
  stats,
  watchedPct,
  allCaughtUp,
  onPress,
}: {
  agent: { id: string; name: string; description: string | null };
  accent: string;
  stats: { total: number; watched: number; unwatched: number; watchLater: number; liked: number };
  watchedPct: number;
  allCaughtUp: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable style={({ pressed }) => [feedStyles.card, pressed && styles.pressed]} onPress={onPress}>
      <View style={[feedStyles.accentBar, { backgroundColor: accent }]} />
      <View style={feedStyles.body}>
        {/* top row */}
        <View style={feedStyles.topRow}>
          <View style={feedStyles.titleRow}>
            <Rss size={16} color={accent} />
            <Text style={feedStyles.name} numberOfLines={1}>{agent.name}</Text>
            {allCaughtUp ? (
              <View style={[feedStyles.caughtUpPill, { borderColor: Colors.success }]}>
                <Sparkles size={11} color={Colors.success} />
                <Text style={[feedStyles.caughtUpText, { color: Colors.success }]}>All caught up</Text>
              </View>
            ) : null}
          </View>
        </View>

        {agent.description ? (
          <Text style={feedStyles.desc} numberOfLines={1}>{agent.description}</Text>
        ) : null}

        {/* progress bar */}
        {stats.total > 0 ? (
          <View style={feedStyles.progressSection}>
            <View style={feedStyles.progressBarBg}>
              <View style={[feedStyles.progressBarFill, { width: `${watchedPct}%` as unknown as number }]} />
            </View>
            <Text style={feedStyles.progressPct}>{watchedPct}%</Text>
          </View>
        ) : (
          <Text style={feedStyles.noItems}>No items yet</Text>
        )}

        {/* stat counts */}
        <View style={feedStyles.countRow}>
          <CountChip icon={<Video size={12} color={Colors.textSecondary} />} value={stats.total} />
          <CountChip icon={<CheckCircle2 size={12} color={Colors.success} />} value={stats.watched} tint={Colors.success} />
          <CountChip icon={<Circle size={12} color={Colors.textMuted} />} value={stats.unwatched} tint={Colors.textMuted} />
          <CountChip icon={<Clock4 size={12} color={Colors.warning} />} value={stats.watchLater} tint={Colors.warning} />
        </View>
      </View>
    </Pressable>
  );
}

const feedStyles = StyleSheet.create({
  card: {
    flexDirection: "row",
    backgroundColor: Colors.card,
    borderRadius: 10,
    overflow: "hidden",
    marginBottom: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
  },
  accentBar: { width: 4 },
  body: { flex: 1, padding: 14 },
  topRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 8, flex: 1, flexWrap: "wrap" },
  name: { fontSize: 15, fontWeight: "700" as const, color: Colors.textPrimary },
  caughtUpPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
    marginLeft: 6,
  },
  caughtUpText: { fontSize: 10, fontWeight: "600" as const },
  desc: { fontSize: 12, color: Colors.textSecondary, marginTop: 4 },
  progressSection: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 12,
  },
  progressBarBg: {
    flex: 1,
    height: 5,
    borderRadius: 3,
    backgroundColor: "hsl(220, 20%, 18%)",
    overflow: "hidden",
  },
  progressBarFill: {
    height: "100%",
    borderRadius: 3,
    backgroundColor: Colors.success,
  },
  progressPct: { fontSize: 12, fontWeight: "700" as const, color: Colors.success, minWidth: 32, textAlign: "right" },
  noItems: { fontSize: 12, color: Colors.textMuted, marginTop: 8, fontStyle: "italic" },
  countRow: { flexDirection: "row", gap: 16, marginTop: 12 },
});

function CountChip({
  icon,
  value,
  tint,
}: {
  icon: React.ReactNode;
  value: number;
  tint?: string;
}) {
  return (
    <View style={countStyles.chip}>
      {icon}
      <Text style={[countStyles.val, tint ? { color: tint } : undefined]}>{value}</Text>
    </View>
  );
}

const countStyles = StyleSheet.create({
  chip: { flexDirection: "row", alignItems: "center", gap: 4 },
  val: { fontSize: 13, fontWeight: "700" as const, color: Colors.textPrimary },

});

function AgentCard({
  agent,
  accent,
  channelCount,
  lastRun,
  newVideos,
  busy,
  onRunNow,
  onEdit,
  onDelete,
  onTap,
}: {
  agent: { id: string; name: string; description: string | null; run_time_local: string | null };
  accent: string;
  channelCount: number;
  lastRun: Run | null;
  newVideos: number;
  busy: boolean;
  onRunNow: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onTap: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <Pressable style={({ pressed }) => [agentStyles.card, pressed && styles.pressed]} onPress={onTap}>
      <View style={[agentStyles.accentBar, { backgroundColor: accent }]} />
      <View style={agentStyles.body}>
        {/* top row */}
        <View style={agentStyles.topRow}>
          <View style={agentStyles.titleArea}>
            <Bot size={16} color={accent} />
            <Text style={agentStyles.name} numberOfLines={1}>{agent.name}</Text>
          </View>
          <View style={agentStyles.actions}>
            <Pressable
              style={({ pressed }) => [agentStyles.runBtn, pressed && styles.pressed]}
              onPress={(e) => { e.stopPropagation?.(); onRunNow(); }}
              disabled={busy}
              hitSlop={8}
            >
              {busy ? (
                <ActivityIndicator size="small" color={Colors.textSecondary} />
              ) : (
                <Play size={16} color={Colors.textSecondary} fill={Colors.textSecondary} />
              )}
            </Pressable>
            <Pressable
              style={({ pressed }) => [agentStyles.menuBtn, pressed && styles.pressed]}
              onPress={(e) => { e.stopPropagation?.(); setMenuOpen((v) => !v); }}
              hitSlop={8}
            >
              <MoreVertical size={18} color={Colors.textSecondary} />
            </Pressable>
          </View>
        </View>

        {agent.description ? (
          <Text style={agentStyles.desc} numberOfLines={2}>{agent.description}</Text>
        ) : null}

        {/* dropdown menu */}
        {menuOpen ? (
          <View style={agentStyles.menu}>
            <Pressable
              style={agentStyles.menuItem}
              onPress={(e) => { e.stopPropagation?.(); setMenuOpen(false); onEdit(); }}
            >
              <Text style={agentStyles.menuText}>Edit</Text>
            </Pressable>
            <View style={agentStyles.menuDivider} />
            <Pressable
              style={agentStyles.menuItem}
              onPress={(e) => { e.stopPropagation?.(); setMenuOpen(false); onDelete(); }}
            >
              <Text style={[agentStyles.menuText, { color: Colors.destructive }]}>Delete</Text>
            </Pressable>
          </View>
        ) : null}

        {/* meta row */}
        <View style={agentStyles.metaRow}>
          <View style={agentStyles.metaChip}>
            <Video size={12} color={Colors.textSecondary} />
            <Text style={agentStyles.metaText}>{channelCount} channels</Text>
          </View>
          {agent.run_time_local ? (
            <View style={agentStyles.metaChip}>
              <Clock size={12} color={Colors.textSecondary} />
              <Text style={agentStyles.metaText}>{agent.run_time_local}</Text>
            </View>
          ) : null}
        </View>

        {/* last-run pill */}
        {lastRun ? (
          <View style={[agentStyles.lastRunPill, { backgroundColor: "hsla(152, 69%, 50%, 0.15)", alignSelf: "flex-start", marginTop: 8 }]}>
            <CheckCircle2 size={12} color="hsl(152, 69%, 50%)" />
            <Text style={[agentStyles.lastRunText, { color: "hsl(152, 69%, 50%)" }]}>
              {relativeTime(lastRun.started_at)}
            </Text>
          </View>
        ) : null}

        {/* new videos */}
        {newVideos > 0 ? (
          <Text style={agentStyles.foundText}>
            Found <Text style={agentStyles.foundHighlight}>{compactNumber(newVideos)}</Text> new videos
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

const agentStyles = StyleSheet.create({
  card: {
    flexDirection: "row",
    backgroundColor: Colors.card,
    borderRadius: 10,
    overflow: "hidden",
    marginBottom: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
  },
  accentBar: { width: 4 },
  body: { flex: 1, padding: 14 },
  topRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  titleArea: { flexDirection: "row", alignItems: "center", gap: 8, flex: 1 },
  name: { fontSize: 15, fontWeight: "700" as const, color: Colors.textPrimary },
  actions: { flexDirection: "row", alignItems: "center", gap: 4 },
  runBtn: {
    width: 36,
    height: 36,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  menuBtn: {
    width: 36,
    height: 36,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  desc: { fontSize: 12, color: Colors.textSecondary, marginTop: 4, lineHeight: 17 },
  metaRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 10, marginTop: 12 },
  metaChip: { flexDirection: "row", alignItems: "center", gap: 4 },
  metaText: { fontSize: 11, color: Colors.textSecondary },
  lastRunPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  lastRunText: { fontSize: 11, fontWeight: "600" as const },
  foundText: { fontSize: 13, color: Colors.textSecondary, marginTop: 10 },
  foundHighlight: { color: Colors.textSecondary, fontWeight: "700" as const },
  menu: {
    backgroundColor: Colors.input,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
    marginTop: 8,
    overflow: "hidden",
  },
  menuItem: {
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  menuText: { fontSize: 14, color: Colors.textPrimary },
  menuDivider: { height: StyleSheet.hairlineWidth, backgroundColor: Colors.border },
});

function SectionHeader({
  title,
  action,
  onAction,
}: {
  title: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <View style={sectStyles.row}>
      <Text style={sectStyles.title}>{title}</Text>
      {action ? (
        <Pressable onPress={onAction} hitSlop={8}>
          <Text style={sectStyles.action}>{action}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const sectStyles = StyleSheet.create({
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 26,
    marginBottom: 12,
  },
  title: {
    fontSize: 13,
    fontWeight: "700" as const,
    color: Colors.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  action: { fontSize: 14, fontWeight: "600" as const, color: Colors.accent },
});

function EmptyCard({ text }: { text: string }) {
  return (
    <View style={emptyStyles.card}>
      <Text style={emptyStyles.text}>{text}</Text>
    </View>
  );
}

const emptyStyles = StyleSheet.create({
  card: {
    backgroundColor: Colors.card,
    borderRadius: 10,
    padding: 20,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
  },
  text: { fontSize: 13, color: Colors.textSecondary, textAlign: "center" },
});

// ── Shared styles ──────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background },
  content: { paddingHorizontal: 16 },
  header: {
    flexDirection: "column",
    alignItems: "flex-start",
    marginBottom: 20,
    gap: 12,
  },
  heading: { fontSize: 26, fontWeight: "800" as const, color: Colors.textPrimary },
  headerBtns: { flexDirection: "row", gap: 10, alignItems: "center", alignSelf: "flex-start" },
  newAgentBtn: {
    backgroundColor: Colors.accent,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
  },
  newAgentText: { color: Colors.white, fontSize: 13, fontWeight: "700" as const },
  runAllBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    height: 38,
    paddingHorizontal: 14,
    borderRadius: 10,
    overflow: "hidden",
    minWidth: 90,
    justifyContent: "center",
  },
  runAllText: { color: Colors.white, fontSize: 13, fontWeight: "700" as const },
  pressed: { opacity: 0.8, transform: [{ scale: 0.98 }] },
  loadingBox: { paddingVertical: 60, alignItems: "center" },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  sectionSpacer: { height: 4 },
});
