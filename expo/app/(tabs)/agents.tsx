import { useState, useMemo, useCallback } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { Play, Clock, Tags, Mail, Zap } from "lucide-react-native";
import { useQueryClient } from "@tanstack/react-query";
import { Colors } from "@/constants/colors";
import { agentAccent } from "@/lib/database";
import { useAgents, useStartRun, useRealtimeInvalidation, qk } from "@/lib/hooks";
import { supabase } from "@/lib/supabase";
import { useRunningOverlay } from "@/lib/running-overlay";
import { useToast } from "@/components/Toast";

const IPAD_BREAKPOINT = 768;

export default function AgentsScreen() {
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const isWide = windowWidth >= IPAD_BREAKPOINT;
  const router = useRouter();
  const showToast = useToast();
  const agents = useAgents();
  const startRun = useStartRun();
  const overlay = useRunningOverlay();
  const queryClient = useQueryClient();
  useRealtimeInvalidation("agents", qk.agents, !overlay.state.status);

  const [pendingId, setPendingId] = useState<string | null>(null);

  const listUnsorted = agents.data ?? [];
  const list = useMemo(
    () =>
      [...listUnsorted].sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
      ),
    [listUnsorted],
  );

  const runOne = useCallback(
    async (agentId: string, agentName: string) => {
      // Insert the run row first so we have a runId for the overlay + Realtime.
      const run = await startRun.mutateAsync(agentId);
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
      while (true) {
        await new Promise((r) => setTimeout(r, 1500));
        const { data: polled } = await supabase
          .from("runs")
          .select("status, videos_new_count, error_summary")
          .eq("id", run.id)
          .single();

        if (!polled) continue;

        if (polled.status === "success") {
          const count = (polled.videos_new_count as number) ?? 0;
          overlay.showSuccess(
            agentName,
            count > 0 ? `Found ${count} new videos` : "No new videos found",
          );
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
    [startRun, overlay, queryClient],
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
    for (const agent of list) {
      try {
        await runOne(agent.id, agent.name);
      } catch (e) {
        overlay.showError(agent.name, e instanceof Error ? e.message : "Run failed");
      }
    }
    setPendingId(null);
  }, [list, runOne, overlay]);

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[styles.content, isWide && styles.contentWide, { paddingTop: insets.top + 16 }]}
      showsVerticalScrollIndicator={false}
      scrollEnabled={!overlay.state.status}
      refreshControl={
        <RefreshControl
          refreshing={agents.isRefetching}
          onRefresh={() => void agents.refetch()}
          tintColor={Colors.accent}
        />
      }
    >
      <View style={styles.header}>
        <View>
          <Text style={styles.heading}>Agents</Text>
          <Text style={styles.subheading}>{list.length} configured</Text>
        </View>
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
            <Zap size={15} color={pendingId === "all" ? "rgba(255,255,255,0.5)" : Colors.white} fill={pendingId === "all" ? "rgba(255,255,255,0.5)" : Colors.white} />
            <Text style={[styles.runAllText, pendingId === "all" && styles.disabledText]}>Run All</Text>
          </Pressable>
        ) : null}
      </View>

      {agents.isLoading ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator color={Colors.accent} />
        </View>
      ) : list.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>No agents yet</Text>
          <Text style={styles.emptyText}>
            Create an agent on the web app and it will appear here automatically.
          </Text>
        </View>
      ) : (
        list.map((agent, index) => {
          const accent = agentAccent(index);
          const busy = pendingId === agent.id;
          return (
            <Pressable
              key={agent.id}
              style={({ pressed }) => [styles.card, pressed && styles.pressed]}
              onPress={() => router.push({ pathname: "/(tabs)/agent-detail", params: { agentId: agent.id } })}
            >
              <View style={[styles.accentBar, { backgroundColor: accent }]} />
              <View style={styles.cardBody}>
                <Text style={styles.agentName} numberOfLines={1}>
                  {agent.name}
                </Text>
                {agent.description ? (
                  <Text style={styles.agentDesc} numberOfLines={2}>
                    {agent.description}
                  </Text>
                ) : null}

                <View style={styles.metaRow}>
                  <Meta icon={<Clock size={13} color={Colors.textSecondary} />} text={agent.schedule_frequency ?? "manual"} />
                  {agent.run_time_local ? (
                    <Meta icon={<Mail size={13} color={Colors.textSecondary} />} text={agent.run_time_local} />
                  ) : null}
                  {agent.keywords && agent.keywords.length > 0 ? (
                    <Meta icon={<Tags size={13} color={Colors.textSecondary} />} text={`${agent.keywords.length} keywords`} />
                  ) : null}
                </View>

                {agent.ai_provider ? (
                  <View style={[styles.providerChip, { borderColor: accent }]}>
                    <Text style={[styles.providerText, { color: accent }]}>
                      {agent.ai_provider}
                    </Text>
                  </View>
                ) : null}

                <Pressable
                  style={({ pressed }) => [
                    styles.runBtn,
                    { borderColor: busy ? "rgba(255,255,255,0.18)" : accent },
                    pressed && styles.pressed,
                  ]}
                  onPress={() => void triggerRun(agent.id)}
                  disabled={pendingId !== null}
                >
                  <Play size={14} color={busy ? "rgba(255,255,255,0.3)" : accent} fill={busy ? "rgba(255,255,255,0.3)" : accent} />
                  <Text style={[styles.runText, { color: busy ? "rgba(255,255,255,0.3)" : accent }]}>Run Now</Text>
                </Pressable>
              </View>
            </Pressable>
          );
        })
      )}
    </ScrollView>
  );
}

function Meta({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <View style={styles.meta}>
      {icon}
      <Text style={styles.metaText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background },
  content: { paddingHorizontal: 16, paddingBottom: 32 },
  contentWide: { maxWidth: 720, width: "100%", alignItems: "center" as const },
  header: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    marginBottom: 20,
  },
  heading: { fontSize: 26, fontWeight: "800" as const, color: Colors.textPrimary },
  subheading: { fontSize: 13, color: Colors.textSecondary, marginTop: 2 },
  runAllBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    height: 40,
    paddingHorizontal: 16,
    borderRadius: 10,
    overflow: "hidden",
    minWidth: 96,
    justifyContent: "center",
  },
  runAllText: { color: Colors.white, fontSize: 14, fontWeight: "700" as const },
  pressed: { opacity: 0.8, transform: [{ scale: 0.98 }] },
  loadingBox: { paddingVertical: 60, alignItems: "center" },
  emptyCard: {
    backgroundColor: Colors.card,
    borderRadius: 12,
    padding: 24,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
  },
  emptyTitle: { fontSize: 16, fontWeight: "700" as const, color: Colors.textPrimary, textAlign: "center" },
  emptyText: { fontSize: 13, color: Colors.textSecondary, textAlign: "center", marginTop: 6, lineHeight: 19 },
  card: {
    flexDirection: "row",
    backgroundColor: Colors.card,
    borderRadius: 12,
    overflow: "hidden",
    marginBottom: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
  },
  accentBar: { width: 4 },
  cardBody: { flex: 1, padding: 16 },
  agentName: { fontSize: 17, fontWeight: "700" as const, color: Colors.textPrimary },
  agentDesc: { fontSize: 13, color: Colors.textSecondary, marginTop: 4, lineHeight: 18 },
  metaRow: { flexDirection: "row", flexWrap: "wrap", gap: 14, marginTop: 12 },
  meta: { flexDirection: "row", alignItems: "center", gap: 5 },
  metaText: { fontSize: 12, color: Colors.textSecondary },
  providerChip: {
    alignSelf: "flex-start",
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginTop: 12,
  },
  providerText: { fontSize: 11, fontWeight: "600" as const, textTransform: "capitalize" },
  runBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    height: 40,
    borderRadius: 9,
    borderWidth: 1.5,
    marginTop: 16,
  },
  runText: { fontSize: 14, fontWeight: "700" as const },
  disabledText: { color: "rgba(255,255,255,0.5)" },
});
