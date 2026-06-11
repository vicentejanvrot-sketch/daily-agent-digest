import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import {
  ArrowLeft,
  Play,
  Pencil,
  Link2,
  Trash2,
  Plus,
  X,
  AlertTriangle,
  Mail,
  Clock,
  Globe,
  Cpu,
  Star,
  ImageOff,
  Check,
  ChevronDown,
  Filter,
  Ban,
} from "lucide-react-native";
import { useQueryClient } from "@tanstack/react-query";
import { Colors } from "@/constants/colors";
import { agentAccent, AI_PROVIDERS } from "@/lib/database";
import {
  useAgent,
  useChannels,
  useRecipients,
  useAgentRuns,
  useStartRun,
  useToggleChannel,
  useDeleteChannel,
  useAddChannel,
  useAddRecipient,
  useDeleteRecipient,
  useCancelRun,
  useUpdateChannelPriority,
  useRunItemCounts,
  useRealtimeInvalidation,
  qk,
} from "@/lib/hooks";
import { supabase } from "@/lib/supabase";
import { useRunningOverlay } from "@/lib/running-overlay";
import { useToast } from "@/components/Toast";
import { StatusPill } from "@/components/StatusPill";
import {
  CHANNEL_STATUS_FILTERS,
  type ChannelFilterKey,
} from "@/components/ChannelStatusPill";
import { timeAgo } from "@/lib/format";
import { openExternalLink } from "@/lib/open-link";

// ── Helpers ────────────────────────────────────────────────────────

function durationLabel(start: string | null, end: string | null): string {
  if (!start || !end) return "";
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (Number.isNaN(ms) || ms < 0) return "";
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  return `${Math.round(sec / 60)}m`;
}

const PRIORITY_OPTIONS = [
  { value: 5, label: "5 - Highest" },
  { value: 4, label: "4 - High" },
  { value: 3, label: "3 - Normal" },
  { value: 2, label: "2 - Low" },
  { value: 1, label: "1 - Lowest" },
] as const;

function providerLabel(provider: string | null): string {
  const found = AI_PROVIDERS.find((p) => p.value === provider);
  return found?.label ?? provider ?? "None";
}

// ── Priority picker for add-channel dialog ─────────────────────────

function PriorityPicker({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <View style={ppStyles.row}>
      {PRIORITY_OPTIONS.map((opt) => {
        const active = value === opt.value;
        return (
          <Pressable
            key={opt.value}
            style={({ pressed }) => [
              ppStyles.chip,
              active && ppStyles.chipActive,
              pressed && ppStyles.chipPressed,
            ]}
            onPress={() => onChange(opt.value)}
          >
            <Text style={[ppStyles.chipText, active && ppStyles.chipTextActive]}>
              {opt.value}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const ppStyles = StyleSheet.create({
  row: { flexDirection: "row", gap: 6, marginTop: 8 },
  chip: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: Colors.input,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  chipActive: {
    backgroundColor: `${Colors.accent}22`,
    borderColor: Colors.accent,
  },
  chipPressed: { opacity: 0.8 },
  chipText: { fontSize: 12, fontWeight: "600" as const, color: Colors.textSecondary },
  chipTextActive: { color: Colors.white },
});

// ── Compact priority dropdown for channel cards ───────────────────

const PRIORITY_ORDER = [5, 4, 3, 2, 1] as const;

function PriorityDropdown({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Closed pill */}
      <Pressable
        style={({ pressed }) => [
          pdStyles.pill,
          pressed && styles.pressed,
        ]}
        onPress={() => setOpen(true)}
        hitSlop={4}
      >
        <Text style={pdStyles.pillText}>{value}</Text>
        <Star size={12} color={Colors.warning} fill={Colors.warning} />
        <ChevronDown size={10} color={Colors.textMuted} />
      </Pressable>

      {/* Open menu */}
      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(false)}
      >
        <Pressable
          style={pdStyles.backdrop}
          onPress={() => setOpen(false)}
        >
          <View style={pdStyles.menuCard}>
            <Text style={pdStyles.menuTitle}>Priority</Text>
            {PRIORITY_ORDER.map((n) => {
              const active = n === value;
              return (
                <Pressable
                  key={n}
                  style={({ pressed }) => [
                    pdStyles.menuOption,
                    active && pdStyles.menuOptionActive,
                    pressed && styles.pressed,
                  ]}
                  onPress={() => {
                    onChange(n);
                    setOpen(false);
                  }}
                >
                  <View style={pdStyles.checkSlot}>
                    {active ? (
                      <Check size={14} color={Colors.accent} />
                    ) : null}
                  </View>
                  <Text
                    style={[
                      pdStyles.menuOptionText,
                      active && pdStyles.menuOptionTextActive,
                    ]}
                  >
                    {n}
                  </Text>
                  <Star
                    size={14}
                    color={Colors.warning}
                    fill={Colors.warning}
                  />
                </Pressable>
              );
            })}
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

const pdStyles = StyleSheet.create({
  pill: {
    width: 80,
    height: 28,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.card,
  },
  pillText: {
    fontSize: 12,
    fontWeight: "700" as const,
    color: Colors.textPrimary,
  },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.7)",
    justifyContent: "center",
    alignItems: "center",
    padding: 32,
  },
  menuCard: {
    width: 160,
    backgroundColor: Colors.card,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
    overflow: "hidden",
  },
  menuTitle: {
    fontSize: 12,
    fontWeight: "700" as const,
    color: Colors.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 8,
  },
  menuOption: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.border,
    gap: 8,
  },
  menuOptionActive: {
    backgroundColor: `${Colors.accent}15`,
  },
  checkSlot: {
    width: 18,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  menuOptionText: {
    fontSize: 15,
    color: Colors.textPrimary,
    flex: 1,
    fontWeight: "600" as const,
  },
  menuOptionTextActive: {
    color: Colors.white,
  },
});

// ── Info card ──────────────────────────────────────────────────────

function InfoCard({
  icon,
  title,
  subtitle,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
}) {
  return (
    <View style={icStyles.card}>
      <View style={icStyles.iconWrap}>{icon}</View>
      <View style={icStyles.body}>
        <Text style={icStyles.title} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={icStyles.subtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const icStyles = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.card,
    borderRadius: 10,
    padding: 14,
    marginBottom: 10,
    gap: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: Colors.input,
    alignItems: "center",
    justifyContent: "center",
  },
  body: { flex: 1 },
  title: { fontSize: 14, fontWeight: "600" as const, color: Colors.textPrimary },
  subtitle: { fontSize: 12, color: Colors.textSecondary, marginTop: 3 },
});

// ── Filter chip ────────────────────────────────────────────────────

function FilterBoolRow({ label, active }: { label: string; active: boolean }) {
  return (
    <View style={fbStyles.row}>
      {active ? (
        <Check size={14} color={Colors.success} />
      ) : (
        <X size={14} color={Colors.textMuted} />
      )}
      <Text
        style={[
          fbStyles.label,
          active ? { color: Colors.textPrimary } : { color: Colors.textMuted },
        ]}
      >
        {label}
      </Text>
    </View>
  );
}

const fbStyles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 },
  label: { fontSize: 13, fontWeight: "500" as const },
});

// ── Section header ─────────────────────────────────────────────────

function SectionHeader({
  title,
  onAdd,
  addLabel,
  badge,
}: {
  title: string;
  onAdd?: () => void;
  addLabel?: string;
  badge?: string;
}) {
  return (
    <View style={shStyles.row}>
      <View style={shStyles.left}>
        <Text style={shStyles.title}>{title}</Text>
        {badge ? <Text style={shStyles.badge}>{badge}</Text> : null}
      </View>
      {onAdd && addLabel ? (
        <Pressable
          style={({ pressed }) => [shStyles.addBtn, pressed && shStyles.addBtnPressed]}
          onPress={onAdd}
          hitSlop={8}
        >
          <Plus size={14} color={Colors.accent} />
          <Text style={shStyles.addBtnText}>{addLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const shStyles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 20,
    marginBottom: 12,
  },
  left: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: {
    fontSize: 13,
    fontWeight: "700" as const,
    color: Colors.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  badge: {
    fontSize: 11,
    fontWeight: "700" as const,
    color: Colors.accent,
    backgroundColor: `${Colors.accent}18`,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 999,
    overflow: "hidden",
  },
  addBtn: { flexDirection: "row", alignItems: "center", gap: 5 },
  addBtnPressed: { opacity: 0.7 },
  addBtnText: { fontSize: 13, color: Colors.accent, fontWeight: "600" as const },
});

// ── Run item status bars ───────────────────────────────────────────

function RunItemBars({
  runId,
  counts,
}: {
  runId: string;
  counts: Record<string, Record<string, number>> | undefined;
}) {
  const c = counts?.[runId];
  if (!c) return null;
  const entries = [
    { key: "watched", label: "Watched", color: Colors.success },
    { key: "not_watched", label: "Not watched", color: Colors.textMuted },
    { key: "liked", label: "Liked", color: Colors.destructive },
    { key: "watch_later", label: "Later", color: Colors.warning },
  ] as const;
  const total = entries.reduce((sum, e) => sum + (c[e.key] ?? 0), 0);
  if (total === 0) return null;

  return (
    <View style={riStyles.bars}>
      {entries.map((e) => {
        const n = c[e.key] ?? 0;
        if (n === 0) return null;
        const pct = Math.round((n / total) * 100);
        return (
          <View key={e.key} style={riStyles.barRow}>
            <View style={riStyles.barLabel}>
              <View style={[riStyles.dot, { backgroundColor: e.color }]} />
              <Text style={riStyles.barName}>{e.label}</Text>
            </View>
            <View style={riStyles.barTrack}>
              <View
                style={[
                  riStyles.barFill,
                  { width: `${pct}%` as unknown as number, backgroundColor: e.color },
                ]}
              />
            </View>
            <Text style={riStyles.barCount}>{n}</Text>
          </View>
        );
      })}
    </View>
  );
}

const riStyles = StyleSheet.create({
  bars: { marginTop: 10, gap: 6 },
  barRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  barLabel: { flexDirection: "row", alignItems: "center", gap: 5, width: 90 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  barName: { fontSize: 11, color: Colors.textSecondary },
  barTrack: {
    flex: 1,
    height: 5,
    borderRadius: 3,
    backgroundColor: Colors.input,
    overflow: "hidden",
  },
  barFill: { height: "100%", borderRadius: 3 },
  barCount: { fontSize: 11, fontWeight: "700" as const, color: Colors.textPrimary, width: 24, textAlign: "right" },
});

// ── Main screen ────────────────────────────────────────────────────

const IPAD_BREAKPOINT = 768;

export default function AgentDetailScreen() {
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const isWide = windowWidth >= IPAD_BREAKPOINT;
  const router = useRouter();
  const { agentId } = useLocalSearchParams<{ agentId: string }>();

  const showToast = useToast();
  const overlay = useRunningOverlay();
  const queryClient = useQueryClient();

  const agentQ = useAgent(agentId ?? null);
  const channelsQ = useChannels(agentId ?? null);
  const recipientsQ = useRecipients(agentId ?? null);
  const runsQ = useAgentRuns(agentId ?? null);

  const startRun = useStartRun();
  const toggleChannel = useToggleChannel();
  const deleteChannel = useDeleteChannel();
  const addChannel = useAddChannel(agentId ?? "");
  const addRecipient = useAddRecipient(agentId ?? "");
  const deleteRecipient = useDeleteRecipient();
  const cancelRun = useCancelRun();
  const updateChannelPriority = useUpdateChannelPriority();

  useRealtimeInvalidation("runs", ["runs", agentId], !overlay.state.status);

  const [channelFilter, setChannelFilter] = useState<ChannelFilterKey>("all");
  const [filterModalOpen, setFilterModalOpen] = useState(false);
  const [showAddChannel, setShowAddChannel] = useState(false);
  const [newChannelUrl, setNewChannelUrl] = useState("");
  const [newChannelPriority, setNewChannelPriority] = useState(3);
  const [showAddRecipient, setShowAddRecipient] = useState(false);
  const [newRecipientEmail, setNewRecipientEmail] = useState("");

  const agent = agentQ.data;
  const allChannels = channelsQ.data ?? [];
  const recipients = recipientsQ.data ?? [];
  const runs = runsQ.data ?? [];

  // Fetch per-run item counts for recent runs
  const runIds = useMemo(() => runs.map((r) => r.id), [runs]);
  const itemCountsQ = useRunItemCounts(runIds);
  const itemCounts = itemCountsQ.data;

  const filteredChannels = useMemo(() => {
    if (channelFilter === "all") return allChannels;
    return allChannels.filter((c) => (c.user_status ?? "not_watched") === channelFilter);
  }, [allChannels, channelFilter]);

  const accent = useMemo(() => {
    if (!agent) return Colors.agentBlue;
    return agentAccent(0);
  }, [agent]);

  const goBack = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/(tabs)/agents");
    }
  }, [router]);

  // ── Run trigger (overlay pattern, same as agents.tsx) ────────────
  const runOne = useCallback(
    async (aId: string, aName: string) => {
      const run = await startRun.mutateAsync(aId);
      overlay.showRunning(aName, run.id);

      const { error } = await supabase.functions.invoke("run-agent", {
        body: { agentId: aId, runId: run.id },
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
        overlay.showError(aName, error.message);
        void queryClient.invalidateQueries({ queryKey: qk.runs });
        return;
      }

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
            aName,
            count > 0 ? `Found ${count} new videos` : "No new videos found",
          );
          await new Promise((r) => setTimeout(r, 2000));
          break;
        }

        if (polled.status === "failed" || polled.status === "cancelled") {
          overlay.showError(
            aName,
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

  const triggerRun = useCallback(async () => {
    if (!agentId || !agent) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      await runOne(agentId, agent.name);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to start run";
      overlay.showError(agent.name, msg);
    }
  }, [agentId, agent, runOne, overlay]);

  const triggerEdit = useCallback(() => {
    if (!agentId) return;
    router.push({ pathname: "/agent-form", params: { agentId } });
  }, [agentId, router]);

  // ── Add channel ──────────────────────────────────────────────────
  const handleAddChannel = useCallback(async () => {
    const url = newChannelUrl.trim();
    if (!url) {
      showToast("Enter a channel URL", "error");
      return;
    }
    try {
      await addChannel.mutateAsync({
        channel_url: url,
        priority: newChannelPriority,
      });
      showToast("Channel added", "success");
      setNewChannelUrl("");
      setNewChannelPriority(3);
      setShowAddChannel(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to add channel";
      showToast(msg, "error");
    }
  }, [newChannelUrl, newChannelPriority, addChannel, showToast]);

  // ── Add recipient ────────────────────────────────────────────────
  const handleAddRecipient = useCallback(async () => {
    const email = newRecipientEmail.trim();
    if (!email.includes("@")) {
      showToast("Enter a valid email", "error");
      return;
    }
    try {
      await addRecipient.mutateAsync(email);
      showToast("Recipient added", "success");
      setNewRecipientEmail("");
      setShowAddRecipient(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to add recipient";
      showToast(msg, "error");
    }
  }, [newRecipientEmail, addRecipient, showToast]);

  // ── Delete channel ───────────────────────────────────────────────
  const handleDeleteChannel = useCallback(
    (id: string, name: string) => {
      Alert.alert("Remove Channel", `Remove "${name}" from this agent?`, [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: () => {
            deleteChannel.mutate(id);
          },
        },
      ]);
    },
    [deleteChannel],
  );

  // ── Delete recipient ─────────────────────────────────────────────
  const handleDeleteRecipient = useCallback(
    (id: string, email: string) => {
      Alert.alert("Remove Recipient", `Remove ${email}?`, [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: () => {
            deleteRecipient.mutate(id);
          },
        },
      ]);
    },
    [deleteRecipient],
  );

  // ── Cancel run ───────────────────────────────────────────────────
  const handleCancelRun = useCallback(
    (runId: string) => {
      Alert.alert("Cancel Run", "Stop this running agent?", [
        { text: "No", style: "cancel" },
        {
          text: "Cancel Run",
          style: "destructive",
          onPress: () => {
            cancelRun.mutate(runId);
            showToast("Run cancelled", "info");
          },
        },
      ]);
    },
    [cancelRun, showToast],
  );

  const handleOpenUrl = useCallback((url: string | null) => {
    if (!url) return;
    void openExternalLink(url);
  }, []);

  const refreshing =
    agentQ.isRefetching ||
    channelsQ.isRefetching ||
    recipientsQ.isRefetching ||
    runsQ.isRefetching;

  const onRefresh = useCallback(() => {
    void agentQ.refetch();
    void channelsQ.refetch();
    void recipientsQ.refetch();
    void runsQ.refetch();
  }, [agentQ, channelsQ, recipientsQ, runsQ]);

  const isLoading =
    agentQ.isLoading || channelsQ.isLoading || recipientsQ.isLoading || runsQ.isLoading;

  if (isLoading) {
    return (
      <View style={[styles.root, styles.loadingBox]}>
        <ActivityIndicator size="large" color={Colors.accent} />
      </View>
    );
  }

  if (!agent) {
    return (
      <View style={[styles.root, styles.loadingBox, { paddingTop: insets.top }]}>
        <Text style={styles.errorText}>Agent not found</Text>
        <Pressable onPress={goBack} style={styles.backBtnInline}>
          <Text style={styles.backBtnText}>Go back</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <>
      <ScrollView
        style={styles.root}
        contentContainerStyle={[styles.content, isWide && styles.contentWide, { paddingTop: insets.top + 8 }]}
        showsVerticalScrollIndicator={false}
        scrollEnabled={!overlay.state.status}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={Colors.accent}
          />
        }
        keyboardShouldPersistTaps="handled"
      >
        {/* Back button */}
        <Pressable
          style={({ pressed }) => [styles.backBtn, pressed && styles.pressed]}
          onPress={goBack}
          hitSlop={8}
        >
          <ArrowLeft size={20} color={Colors.textSecondary} />
          <Text style={styles.backLabel}>Agents</Text>
        </Pressable>

        {/* ── HEADER ── */}
        <View style={styles.headerCard}>
          <View style={[styles.accentBar, { backgroundColor: accent }]} />
          <View style={styles.headerBody}>
            <Text style={styles.agentName}>{agent.name}</Text>
            {agent.description ? (
              <Text style={styles.agentDesc}>{agent.description}</Text>
            ) : null}

            {/* Action buttons */}
            <View style={styles.actionRow}>
              <Pressable
                style={({ pressed }) => [
                  styles.runNowBtn,
                  pressed && styles.pressed,
                ]}
                onPress={() => void triggerRun()}
              >
                <LinearGradient
                  colors={Colors.accentGradient as unknown as readonly [string, string, ...string[]]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={StyleSheet.absoluteFill}
                />
                <Play size={15} color={Colors.white} fill={Colors.white} />
                <Text style={styles.runNowText}>Run Now</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [
                  styles.editBtn,
                  { borderColor: Colors.border },
                  pressed && styles.pressed,
                ]}
                onPress={triggerEdit}
              >
                <Pencil size={15} color={Colors.textSecondary} />
                <Text style={styles.editText}>Edit</Text>
              </Pressable>
            </View>
          </View>
        </View>

        {/* ── AGENT INFO CARDS ── */}
        <InfoCard
          icon={<Clock size={20} color={accent} />}
          title={
            agent.run_time_local
              ? `${agent.run_time_local} (${agent.timezone ?? "UTC"})`
              : "No schedule set"
          }
          subtitle={
            agent.schedule_frequency || agent.lookback_hours != null
              ? `${agent.schedule_frequency ?? "Manual"}${agent.lookback_hours != null ? ` • ${agent.lookback_hours}h lookback` : ""}`
              : undefined
          }
        />

        <InfoCard
          icon={<Cpu size={20} color={accent} />}
          title={providerLabel(agent.ai_provider)}
          subtitle="For video summaries"
        />

        <View style={icStyles.card}>
          <View style={icStyles.iconWrap}>
            <Star size={20} color={accent} />
          </View>
          <View style={icStyles.body}>
            <Text style={icStyles.title}>Filters</Text>
            <FilterBoolRow label="Shorts" active={agent.include_shorts === true} />
            <FilterBoolRow label="Live/Upcoming" active={agent.include_live === true} />
            {agent.min_duration_minutes != null ? (
              <Text style={styles.filterMinLine}>
                Min {agent.min_duration_minutes} min
              </Text>
            ) : null}
          </View>
        </View>

        {/* ── EMAIL RECIPIENTS (only if present) ── */}
        {recipients.length > 0 ? (
          <>
            <SectionHeader
              title={`Recipients (${recipients.length})`}
              onAdd={() => setShowAddRecipient((v) => !v)}
              addLabel="Add"
            />

            <View style={styles.recipientChips}>
              {recipients.map((r) => (
                <View key={r.id} style={styles.recipientChip}>
                  <Mail size={11} color={Colors.textSecondary} />
                  <Text style={styles.recipientEmail} numberOfLines={1}>
                    {r.email}
                  </Text>
                  <Pressable
                    onPress={() => handleDeleteRecipient(r.id, r.email)}
                    hitSlop={8}
                  >
                    <X size={12} color={Colors.textMuted} />
                  </Pressable>
                </View>
              ))}
            </View>
          </>
        ) : null}

        {/* ── CHANNELS SECTION ── */}
        <SectionHeader
          title={`Channels (${allChannels.length})`}
          onAdd={() => setShowAddChannel(true)}
          addLabel="Add Channel"
          badge={
            channelFilter !== "all"
              ? `${filteredChannels.length} of ${allChannels.length}`
              : undefined
          }
        />

        {/* Channel filter dropdown */}
        <View style={styles.filterRow}>
          <Filter size={14} color={Colors.textSecondary} />
          <Text style={styles.filterLabel}>Filter by status:</Text>
          <Pressable
            style={({ pressed }) => [
              styles.filterDropdownTrigger,
              pressed && { opacity: 0.8 },
            ]}
            onPress={() => setFilterModalOpen(true)}
          >
            <Text style={styles.filterDropdownText} numberOfLines={1}>
              {CHANNEL_STATUS_FILTERS.find((f) => f.key === channelFilter)?.label ?? "All Channels"}
            </Text>
            <ChevronDown size={14} color={Colors.textSecondary} />
          </Pressable>
        </View>

        {/* Filter dropdown modal */}
        <Modal
          visible={filterModalOpen}
          transparent
          animationType="fade"
          onRequestClose={() => setFilterModalOpen(false)}
        >
          <Pressable
            style={styles.filterModalBackdrop}
            onPress={() => setFilterModalOpen(false)}
          >
            <View style={styles.filterModalCard}>
              <View style={styles.filterModalHeader}>
                <Text style={styles.filterModalTitle}>Filter by status</Text>
                <Pressable
                  onPress={() => setFilterModalOpen(false)}
                  hitSlop={8}
                >
                  <X size={20} color={Colors.textSecondary} />
                </Pressable>
              </View>
              {CHANNEL_STATUS_FILTERS.map((f) => {
                const active = channelFilter === f.key;
                return (
                  <Pressable
                    key={f.key}
                    style={({ pressed }) => [
                      styles.filterModalOption,
                      active && styles.filterModalOptionActive,
                      pressed && { opacity: 0.7 },
                    ]}
                    onPress={() => {
                      setChannelFilter(f.key);
                      setFilterModalOpen(false);
                    }}
                  >
                    <View style={styles.filterModalCheckSlot}>
                      {active ? (
                        <Check size={16} color={Colors.white} />
                      ) : null}
                    </View>
                    <Text
                      style={[
                        styles.filterModalOptionText,
                        active && styles.filterModalOptionTextActive,
                      ]}
                      numberOfLines={1}
                    >
                      {f.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </Pressable>
        </Modal>

        {channelsQ.isLoading ? (
          <View style={styles.sectionLoading}>
            <ActivityIndicator color={Colors.accent} />
          </View>
        ) : filteredChannels.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyText}>
              {channelFilter === "all"
                ? "No channels added yet."
                : "No channels match this filter."}
            </Text>
          </View>
        ) : (
          filteredChannels.map((ch) => (
            <ChannelCard
              key={ch.id}
              channel={ch}
              accent={accent}
              onToggle={(isEnabled) =>
                toggleChannel.mutate({ id: ch.id, isEnabled })
              }
              onDelete={() =>
                handleDeleteChannel(
                  ch.id,
                  ch.channel_name ?? ch.channel_url ?? "channel",
                )
              }
              onOpenUrl={() => handleOpenUrl(ch.channel_url)}
              onPriorityChange={(priority) =>
                updateChannelPriority.mutate({ id: ch.id, priority })
              }
            />
          ))
        )}

        {/* ── RUN HISTORY SECTION ── */}
        <SectionHeader title={`Run History (${runs.length})`} />

        {runsQ.isLoading ? (
          <View style={styles.sectionLoading}>
            <ActivityIndicator color={Colors.accent} />
          </View>
        ) : runs.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyText}>
              No runs yet. Tap &ldquo;Run Now&rdquo; to start one.
            </Text>
          </View>
        ) : (
          runs.map((run) => (
            <View key={run.id} style={styles.runCard}>
              <View style={styles.runTop}>
                <StatusPill status={run.status} />
                <Text style={styles.runTime}>{timeAgo(run.started_at)}</Text>
              </View>

              <Text style={styles.runDuration}>
                {run.started_at
                  ? new Date(run.started_at).toLocaleString()
                  : "—"}
                {durationLabel(run.started_at, run.finished_at)
                  ? ` · ${durationLabel(run.started_at, run.finished_at)}`
                  : ""}
              </Text>

              {/* Per-run item counts by status */}
              <RunItemBars runId={run.id} counts={itemCounts} />

              <View style={styles.runStatsRow}>
                <RunStat label="Found" value={run.videos_found_count ?? 0} />
                <RunStat label="New" value={run.videos_new_count ?? 0} />
                <RunStat label="Enriched" value={run.videos_enriched_count ?? 0} />
                <RunStat
                  label="Channels"
                  value={`${run.channels_scanned ?? 0}/${run.channels_total ?? 0}`}
                />
              </View>

              {run.status === "partial" && run.error_summary ? (
                <View style={styles.warningRow}>
                  <AlertTriangle size={13} color={Colors.warning} />
                  <View style={styles.warningBody}>
                    <Text style={styles.warningLabel}>Completed with issues</Text>
                    <Text style={styles.warningSummary} numberOfLines={3}>
                      {run.error_summary}
                    </Text>
                  </View>
                </View>
              ) : null}

              {run.status === "failed" && run.error_summary ? (
                <View style={styles.errorRow}>
                  <AlertTriangle size={13} color={Colors.destructive} />
                  <Text style={styles.errorSummary} numberOfLines={3}>
                    {run.error_summary}
                  </Text>
                </View>
              ) : null}

              {run.status === "cancelled" && run.error_summary ? (
                <View style={styles.cancelledRow}>
                  <Ban size={13} color={Colors.textMuted} />
                  <Text style={styles.cancelledSummary} numberOfLines={3}>
                    {run.error_summary}
                  </Text>
                </View>
              ) : null}

              {run.status === "running" ? (
                <Pressable
                  style={({ pressed }) => [
                    styles.cancelRunBtn,
                    pressed && styles.pressed,
                  ]}
                  onPress={() => handleCancelRun(run.id)}
                >
                  <X size={14} color={Colors.destructive} />
                  <Text style={styles.cancelRunText}>Cancel Run</Text>
                </Pressable>
              ) : null}
            </View>
          ))
        )}

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* ── Add recipient modal ── */}
      <Modal
        visible={showAddRecipient}
        transparent
        animationType="fade"
        onRequestClose={() => setShowAddRecipient(false)}
      >
        <Pressable
          style={styles.modalBackdrop}
          onPress={() => setShowAddRecipient(false)}
        >
          <Pressable
            style={styles.modalCard}
            onPress={() => {}}
          >
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Add Recipient</Text>
              <Pressable
                onPress={() => setShowAddRecipient(false)}
                hitSlop={8}
              >
                <X size={20} color={Colors.textSecondary} />
              </Pressable>
            </View>

            <TextInput
              style={styles.formInput}
              placeholder="email@example.com"
              placeholderTextColor={Colors.textMuted}
              value={newRecipientEmail}
              onChangeText={setNewRecipientEmail}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              returnKeyType="done"
              onSubmitEditing={() => void handleAddRecipient()}
            />

            <Pressable
              style={({ pressed }) => [
                styles.modalConfirm,
                { backgroundColor: accent },
                !newRecipientEmail.trim().includes("@") && { opacity: 0.5 },
                pressed && styles.pressed,
              ]}
              onPress={() => void handleAddRecipient()}
              disabled={!newRecipientEmail.trim().includes("@") || addRecipient.isPending}
            >
              {addRecipient.isPending ? (
                <ActivityIndicator size="small" color={Colors.white} />
              ) : (
                <Text style={styles.modalConfirmText}>Add Recipient</Text>
              )}
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {/* ── Add channel modal ── */}
      <Modal
        visible={showAddChannel}
        transparent
        animationType="fade"
        onRequestClose={() => setShowAddChannel(false)}
      >
        <Pressable
          style={styles.modalBackdrop}
          onPress={() => setShowAddChannel(false)}
        >
          <Pressable
            style={styles.modalCard}
            onPress={() => {}}
          >
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Add Channel</Text>
              <Pressable
                onPress={() => setShowAddChannel(false)}
                hitSlop={8}
              >
                <X size={20} color={Colors.textSecondary} />
              </Pressable>
            </View>

            <Text style={styles.formLabel}>Channel URL</Text>
            <TextInput
              style={styles.formInput}
              placeholder="https://www.youtube.com/@ChannelName"
              placeholderTextColor={Colors.textMuted}
              value={newChannelUrl}
              onChangeText={setNewChannelUrl}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="done"
            />

            <Text style={[styles.formLabel, { marginTop: 14 }]}>Priority</Text>
            <PriorityPicker
              value={newChannelPriority}
              onChange={setNewChannelPriority}
            />

            <Pressable
              style={({ pressed }) => [
                styles.modalConfirm,
                { backgroundColor: accent },
                !newChannelUrl.trim() && { opacity: 0.5 },
                pressed && styles.pressed,
              ]}
              onPress={() => void handleAddChannel()}
              disabled={!newChannelUrl.trim() || addChannel.isPending}
            >
              {addChannel.isPending ? (
                <ActivityIndicator size="small" color={Colors.white} />
              ) : (
                <Text style={styles.modalConfirmText}>Add Channel</Text>
              )}
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

// ── Sub-components ─────────────────────────────────────────────────

function ChannelCard({
  channel,
  accent,
  onToggle,
  onDelete,
  onOpenUrl,
  onPriorityChange,
}: {
  channel: {
    id: string;
    channel_thumbnail: string | null;
    channel_name: string | null;
    channel_url: string | null;
    priority: number | null;
    is_enabled: boolean | null;
    last_scanned_at: string | null;
    user_status: import("@/lib/database").ChannelStatus | null;
  };
  accent: string;
  onToggle: (isEnabled: boolean) => void;
  onDelete: () => void;
  onOpenUrl: () => void;
  onPriorityChange: (priority: number) => void;
}) {
  return (
    <View style={styles.channelCard}>
      {/* Thumbnail */}
      <View style={styles.channelThumb}>
        {channel.channel_thumbnail ? (
          <Image
            source={{ uri: channel.channel_thumbnail }}
            style={styles.channelThumbImage}
            contentFit="cover"
          />
        ) : (
          <View style={styles.channelThumbPlaceholder}>
            <ImageOff size={18} color={Colors.textMuted} />
          </View>
        )}
      </View>

      <View style={styles.channelBody}>
        <View style={styles.channelTop}>
          <Pressable style={styles.channelNameRow} onPress={onOpenUrl}>
            <Text style={styles.channelName} numberOfLines={1}>
              {channel.channel_name || channel.channel_url || "Unnamed"}
            </Text>
            {channel.channel_url ? (
              <Link2 size={12} color={Colors.textMuted} style={styles.ml4} />
            ) : null}
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.iconBtn, pressed && styles.pressed]}
            onPress={onDelete}
            hitSlop={8}
          >
            <Trash2 size={14} color={Colors.destructive} />
          </Pressable>
        </View>

        {channel.channel_url && channel.channel_name ? (
          <Pressable onPress={onOpenUrl}>
            <Text style={styles.channelUrl} numberOfLines={1}>
              {channel.channel_url}
            </Text>
          </Pressable>
        ) : null}

        <View style={styles.channelMeta}>
          <PriorityDropdown
            value={channel.priority ?? 3}
            onChange={onPriorityChange}
          />
          <View style={styles.channelSwitch}>
            <Switch
              value={channel.is_enabled ?? false}
              onValueChange={onToggle}
              trackColor={{ false: Colors.border, true: accent }}
              thumbColor={channel.is_enabled ? Colors.white : Colors.textMuted}
              style={styles.switchControl}
            />
            <Text style={styles.enabledLabel}>
              {channel.is_enabled ? "On" : "Off"}
            </Text>
          </View>
        </View>

        <Text style={styles.channelScanned}>
          {channel.last_scanned_at
            ? `Scanned ${timeAgo(channel.last_scanned_at)}`
            : "Never scanned"}
        </Text>
      </View>
    </View>
  );
}

function RunStat({ label, value }: { label: string; value: number | string }) {
  return (
    <View style={styles.runStat}>
      <Text style={styles.runStatValue}>{value}</Text>
      <Text style={styles.runStatLabel}>{label}</Text>
    </View>
  );
}

// ── Styles ─────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background },
  content: { paddingHorizontal: 16, paddingBottom: 32 },
  contentWide: { maxWidth: 720, width: "100%", alignSelf: "center" },
  loadingBox: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.background,
  },
  errorText: { fontSize: 16, color: Colors.textSecondary, marginBottom: 12 },
  backBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 16,
    alignSelf: "flex-start",
  },
  backLabel: { fontSize: 14, color: Colors.textSecondary, fontWeight: "500" as const },
  backBtnInline: {
    marginTop: 12,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: Colors.card,
    borderRadius: 8,
  },
  backBtnText: { fontSize: 14, color: Colors.accent, fontWeight: "600" as const },
  pressed: { opacity: 0.75, transform: [{ scale: 0.98 }] },

  /* Header */
  headerCard: {
    flexDirection: "row",
    backgroundColor: Colors.card,
    borderRadius: 12,
    overflow: "hidden",
    marginBottom: 20,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
  },
  accentBar: { width: 4 },
  headerBody: { flex: 1, padding: 16 },
  agentName: { fontSize: 20, fontWeight: "800" as const, color: Colors.textPrimary },
  agentDesc: { fontSize: 14, color: Colors.textSecondary, marginTop: 6, lineHeight: 20 },

  /* Action buttons */
  actionRow: { flexDirection: "row", gap: 10, marginTop: 18 },
  runNowBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    height: 44,
    borderRadius: 10,
    overflow: "hidden",
  },
  runNowText: { color: Colors.white, fontSize: 15, fontWeight: "700" as const },
  editBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    height: 44,
    paddingHorizontal: 18,
    borderRadius: 10,
    borderWidth: 1.5,
  },
  editText: { fontSize: 14, color: Colors.textSecondary, fontWeight: "600" as const },

  /* Filter dropdown trigger */
  filterRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 14,
  },
  filterLabel: { fontSize: 12, fontWeight: "600" as const, color: Colors.textSecondary },
  filterDropdownTrigger: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: Colors.input,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  filterDropdownText: { fontSize: 13, color: Colors.textPrimary, flex: 1 },

  /* Filter modal */
  filterModalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.7)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  filterModalCard: {
    width: "100%",
    maxWidth: 400,
    backgroundColor: Colors.card,
    borderRadius: 16,
    padding: 20,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
  },
  filterModalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 14,
  },
  filterModalTitle: { fontSize: 16, fontWeight: "700" as const, color: Colors.textPrimary },
  filterModalOption: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 8,
    marginBottom: 2,
    gap: 10,
  },
  filterModalCheckSlot: {
    width: 20,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  filterModalOptionActive: { backgroundColor: `${Colors.accent}15` },
  filterModalOptionText: { fontSize: 14, color: Colors.textSecondary, flex: 1 },
  filterModalOptionTextActive: { color: Colors.white, fontWeight: "600" as const },

  /* Filter card min line */
  filterMinLine: { fontSize: 12, color: Colors.textSecondary, marginTop: 6 },

  /* Section loading */
  sectionLoading: { paddingVertical: 28, alignItems: "center" },

  /* Empty */
  emptyCard: {
    backgroundColor: Colors.card,
    borderRadius: 10,
    padding: 20,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
    marginBottom: 12,
  },
  emptyText: { fontSize: 13, color: Colors.textMuted, textAlign: "center" },

  /* Channel card */
  channelCard: {
    flexDirection: "row",
    backgroundColor: Colors.card,
    borderRadius: 12,
    overflow: "hidden",
    marginBottom: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
  },
  channelThumb: { width: 72, height: 72 },
  channelThumbImage: { width: 72, height: 72 },
  channelThumbPlaceholder: {
    width: 72,
    height: 72,
    backgroundColor: Colors.input,
    alignItems: "center",
    justifyContent: "center",
  },
  channelBody: { flex: 1, padding: 12 },
  channelTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  channelNameRow: { flexDirection: "row", alignItems: "center", flex: 1 },
  channelName: { fontSize: 14, fontWeight: "700" as const, color: Colors.textPrimary, flex: 1 },
  channelUrl: { fontSize: 11, color: Colors.accent, marginTop: 2 },
  channelMeta: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 10,
  },
  channelSwitch: { flexDirection: "row", alignItems: "center", gap: 6 },
  enabledLabel: { fontSize: 11, color: Colors.textSecondary },
  switchControl: { transform: [{ scaleX: 0.8 }, { scaleY: 0.8 }] },
  channelFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 10,
  },
  channelScanned: { fontSize: 11, color: Colors.textMuted },

  /* Recipient chips */
  recipientChips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 8 },
  recipientChip: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.card,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    gap: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
  },
  recipientEmail: { fontSize: 12, color: Colors.textPrimary, maxWidth: 180 },

  /* Add form */
  addFormCard: {
    backgroundColor: Colors.card,
    borderRadius: 10,
    padding: 14,
    marginBottom: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
  },
  formInput: {
    backgroundColor: Colors.input,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: Colors.textPrimary,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  formLabel: { fontSize: 12, fontWeight: "600" as const, color: Colors.textSecondary, marginBottom: 6 },
  addFormActions: { flexDirection: "row", gap: 10, marginTop: 10 },
  cancelBtn: {
    flex: 1,
    height: 40,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  cancelBtnText: { fontSize: 14, fontWeight: "600" as const, color: Colors.textSecondary },
  addFormSubmit: {
    flex: 1,
    height: 40,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  addFormSubmitText: { fontSize: 14, fontWeight: "700" as const, color: Colors.white },

  /* Run card */
  runCard: {
    backgroundColor: Colors.card,
    borderRadius: 12,
    padding: 16,
    marginBottom: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
  },
  runTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  runTime: { fontSize: 12, color: Colors.textMuted },
  runDuration: { fontSize: 12, color: Colors.textMuted, marginTop: 6 },
  runStatsRow: { flexDirection: "row", marginTop: 12, gap: 12 },
  runStat: { flex: 1 },
  runStatValue: { fontSize: 20, fontWeight: "700" as const, color: Colors.textPrimary },
  runStatLabel: { fontSize: 11, color: Colors.textSecondary, marginTop: 2 },
  errorRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 12,
    backgroundColor: Colors.destructiveBg,
    borderRadius: 8,
    padding: 10,
  },
  errorSummary: { flex: 1, fontSize: 12, color: Colors.destructive, lineHeight: 17 },

  /* Warning row (partial) */
  warningRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    marginTop: 12,
    backgroundColor: "rgba(245, 158, 11, 0.12)",
    borderRadius: 8,
    padding: 10,
    borderWidth: 1,
    borderColor: "rgba(245, 158, 11, 0.25)",
  },
  warningBody: { flex: 1 },
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

  /* Cancelled row */
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

  /* Cancel run */
  cancelRunBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    marginTop: 12,
    height: 36,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.destructive,
  },
  cancelRunText: { fontSize: 13, fontWeight: "600" as const, color: Colors.destructive },

  /* Add channel modal */
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.7)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  modalCard: {
    width: "100%",
    maxWidth: 400,
    backgroundColor: Colors.card,
    borderRadius: 16,
    padding: 20,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 18,
  },
  modalTitle: { fontSize: 18, fontWeight: "700" as const, color: Colors.textPrimary },
  modalConfirm: {
    height: 44,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 18,
  },
  modalConfirmText: { fontSize: 15, fontWeight: "700" as const, color: Colors.white },

  /* Utility */
  ml4: { marginLeft: 4 },
  mr8: { marginRight: 8 },
  iconBtn: { padding: 4 },
});
