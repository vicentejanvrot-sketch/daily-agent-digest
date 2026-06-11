import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useLocalSearchParams, router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Image } from "expo-image";
import * as Haptics from "expo-haptics";
import {
  Search,
  X,
  Bot,
  Radio,
  Filter,
  ArrowUpDown,
  ChevronDown,
  Check,
  Eye,
  Heart,
  Clock,
  Circle,
  Play,
  ThumbsUp,
  MessageCircle,
} from "lucide-react-native";
import { Colors } from "@/constants/colors";
import type { ItemStatus, ItemWithAnalysis, Channel, Agent } from "@/lib/database";
import {
  useFeedItems,
  useUpdateItemStatus,
  useAgents,
  useChannelsAll,
  useRealtimeInvalidation,
} from "@/lib/hooks";
import { useToast } from "@/components/Toast";
import { timeAgo, compactNumber, formatDuration } from "@/lib/format";

/** Extract YouTube video ID from a watch URL (fallback when video_id is null). */
function extractYoutubeId(url: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.hostname === "youtu.be") return u.pathname.slice(1).split("?")[0] || null;
    return u.searchParams.get("v") || null;
  } catch {
    return null;
  }
}

// ── Filter types ──────────────────────────────────────────────────

type StatusFilter = "all" | ItemStatus;
type SortMode = "recent" | "views" | "ranked";

const STATUS_OPTIONS: { key: StatusFilter; label: string; icon?: React.ReactNode }[] = [
  { key: "all", label: "All Statuses" },
  { key: "not_watched", label: "Not Watched", icon: <Circle size={16} color={Colors.textMuted} /> },
  { key: "watched", label: "Watched", icon: <Check size={16} color={Colors.success} /> },
  { key: "liked", label: "Liked/Saved", icon: <Heart size={16} color={Colors.destructive} /> },
  { key: "watch_later", label: "Watch Later", icon: <Clock size={16} color={Colors.warning} /> },
];

const SORT_OPTIONS: { key: SortMode; label: string }[] = [
  { key: "recent", label: "Recent" },
  { key: "views", label: "Views" },
  { key: "ranked", label: "Ranking" },
];

const ITEM_STATUS_ICONS: Record<
  ItemStatus,
  { icon: typeof Check; color: string; label: string }
> = {
  not_watched: { icon: Circle, color: Colors.textMuted, label: "Not Watched" },
  watched: { icon: Check, color: Colors.success, label: "Watched" },
  liked: { icon: Heart, color: Colors.destructive, label: "Liked/Saved" },
  watch_later: { icon: Clock, color: Colors.warning, label: "Watch Later" },
};

const STATUS_OPTIONS_COMPACT: { key: ItemStatus; label: string }[] = [
  { key: "not_watched", label: "Not Watched" },
  { key: "watched", label: "Watched" },
  { key: "liked", label: "Liked/Saved" },
  { key: "watch_later", label: "Watch Later" },
];

// ── Helpers ───────────────────────────────────────────────────────

function normalizeText(s: string | null | undefined): string {
  return (s ?? "").toLowerCase().trim();
}

function channelDisplayName(ch: Channel): string {
  return ch.channel_name || (ch.channel_url ?? "").replace(/^https?:\/\/www\.youtube\.com\//, "") || "Unknown";
}

// ── Main Screen ───────────────────────────────────────────────────

export default function FeedScreen() {
  const insets = useSafeAreaInsets();
  const showToast = useToast();
  const params = useLocalSearchParams<{ agentId?: string; status?: string }>();

  // Data
  const items = useFeedItems(500);
  const agents = useAgents();
  const channels = useChannelsAll();
  const updateStatus = useUpdateItemStatus();

  useRealtimeInvalidation("items", ["feedItems", 500]);

  // Filter state
  const [search, setSearch] = useState("");
  const [agentFilter, setAgentFilter] = useState<string>(params.agentId ?? "all");
  const [channelFilter, setChannelFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(
    (params.status as StatusFilter) || "not_watched",
  );
  const [sortMode, setSortMode] = useState<SortMode>("recent");

  const listUnsorted = agents.data ?? [];
  const agentList = useMemo(
    () =>
      [...listUnsorted].sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
      ),
    [listUnsorted],
  );
  const channelList = channels.data ?? [];

  // Channels filtered by selected agent
  const visibleChannels = useMemo(() => {
    if (agentFilter === "all") return channelList;
    return channelList.filter((ch) => ch.agent_id === agentFilter);
  }, [channelList, agentFilter]);

  // Items
  const allItems = items.data ?? [];

  // Channel → video count (from ALL items, not just displayed)
  const channelCounts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const it of allItems) {
      if (it.channel_id) {
        map[it.channel_id] = (map[it.channel_id] ?? 0) + 1;
      }
    }
    return map;
  }, [allItems]);

  // Filter + sort
  const filtered = useMemo(() => {
    let result = allItems;

    // Search: title, channel_name, short_summary, tags
    const q = normalizeText(search);
    if (q) {
      result = result.filter((it) => {
        const analysis = it.item_analysis?.[0] ?? null;
        if (normalizeText(it.title).includes(q)) return true;
        if (normalizeText(it.channel_name).includes(q)) return true;
        if (analysis?.short_summary && normalizeText(analysis.short_summary).includes(q)) return true;
        if (analysis?.tags?.some((t) => normalizeText(t).includes(q))) return true;
        return false;
      });
    }

    // Agent filter
    if (agentFilter !== "all") {
      result = result.filter((it) => it.agent_id === agentFilter);
    }

    // Channel filter
    if (channelFilter !== "all") {
      result = result.filter((it) => it.channel_id === channelFilter);
    }

    // Status filter
    if (statusFilter !== "all") {
      result = result.filter((it) => (it.user_status ?? "not_watched") === statusFilter);
    }

    // Sort
    if (sortMode === "views") {
      result = [...result].sort(
        (a, b) => (b.item_analysis?.[0]?.views_at_analysis ?? 0) - (a.item_analysis?.[0]?.views_at_analysis ?? 0),
      );
    } else if (sortMode === "ranked") {
      result = [...result].sort(
        (a, b) => (b.item_analysis?.[0]?.ranking_score ?? 0) - (a.item_analysis?.[0]?.ranking_score ?? 0),
      );
    }
    // "recent" uses server order (by published_at desc)

    return result;
  }, [allItems, search, agentFilter, channelFilter, statusFilter, sortMode]);

  // Actions
  const setStatus = useCallback(
    async (id: string, status: ItemStatus) => {
      void Haptics.selectionAsync();
      try {
        await updateStatus.mutateAsync({ id, status });
      } catch {
        showToast("Couldn't update status", "error");
      }
    },
    [updateStatus, showToast],
  );

  const openVideo = useCallback(
    (item: ItemWithAnalysis) => {
      const vid = item.video_id?.trim() || extractYoutubeId(item.url);
      router.push(`/video-player?videoId=${encodeURIComponent(vid ?? "")}&itemId=${encodeURIComponent(item.id)}`);
    },
    [],
  );

  const handleAgentChange = useCallback(
    (value: string) => {
      setAgentFilter(value);
      setChannelFilter("all"); // reset channel when agent changes
    },
    [],
  );

  // ── Channel dropdown options (deduped by channel_id, with badge counts + thumbnails) ───
  const channelOptions = useMemo(() => {
    const seen = new Set<string>();
    const deduped = visibleChannels.filter((ch) => {
      const cid = (ch.channel_id ?? ch.id) as string;
      if (seen.has(cid)) return false;
      seen.add(cid);
      return true;
    });
    return [
      {
        key: "all" as const,
        label: "All Channels",
        badge: allItems.length,
      },
      ...deduped.map((ch) => ({
        key: (ch.channel_id ?? ch.id) as string,
        label: channelDisplayName(ch),
        badge: channelCounts[ch.channel_id ?? ""] ?? 0,
        thumbnail: ch.channel_thumbnail ?? undefined,
        thumbnailText: (ch.channel_name ?? "?")[0].toUpperCase(),
      })),
    ];
  }, [visibleChannels, channelCounts, allItems.length]);

  // ── Render ──────────────────────────────────────────────────────

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.headerRow}>
        <Text style={styles.heading}>Research Feed</Text>
        {!items.isLoading ? (
          <Text style={styles.countBadge}>{filtered.length} videos</Text>
        ) : null}
      </View>

      {/* ── Search bar ─────────────────────────────────────────── */}
      <View style={styles.searchRow}>
        <Search size={16} color={Colors.textMuted} style={styles.searchIcon} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search videos, channels, tags..."
          placeholderTextColor={Colors.textMuted}
          value={search}
          onChangeText={setSearch}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
        />
        {search.length > 0 ? (
          <Pressable onPress={() => setSearch("")} hitSlop={8} style={styles.searchClear}>
            <X size={14} color={Colors.textMuted} />
          </Pressable>
        ) : null}
      </View>

      {/* ── Filter dropdowns — vertical stack ───────────────────── */}
      <View style={styles.filtersWrapper}>
        {/* Agent — full width */}
        <FilterDropdownFull
          icon={<Bot size={15} color={Colors.textSecondary} />}
          label="Agent"
          value={agentFilter}
          options={[
            { key: "all", label: "All Agents" },
            ...agentList.map((a) => ({ key: a.id, label: a.name })),
          ]}
          onChange={handleAgentChange}
        />

        {/* Channel — full width, with badge counts */}
        {visibleChannels.length > 0 ? (
          <FilterDropdownFull
            icon={<Radio size={15} color={Colors.textSecondary} />}
            label="Channel"
            value={channelFilter}
            options={channelOptions}
            onChange={(v) => setChannelFilter(v)}
          />
        ) : null}

        {/* Status + Sort — side by side */}
        <View style={styles.filterSideRow}>
          <View style={styles.filterHalf}>
            <FilterDropdownFull
              icon={<Filter size={15} color={Colors.textSecondary} />}
              label="Status"
              value={statusFilter}
              options={STATUS_OPTIONS}
              onChange={(v) => setStatusFilter(v)}
            />
          </View>
          <View style={styles.filterHalf}>
            <FilterDropdownFull
              icon={<ArrowUpDown size={15} color={Colors.textSecondary} />}
              label="Sort"
              value={sortMode}
              options={SORT_OPTIONS}
              onChange={(v) => setSortMode(v)}
            />
          </View>
        </View>
      </View>

      {/* ── List ───────────────────────────────────────────────── */}
      {items.isLoading ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator color={Colors.accent} />
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(it) => it.id}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl
              refreshing={items.isRefetching}
              onRefresh={() => void items.refetch()}
              tintColor={Colors.accent}
            />
          }
          ListEmptyComponent={
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>
                {search || agentFilter !== "all" || statusFilter !== "not_watched"
                  ? "No videos match your filters"
                  : "No videos yet"}
              </Text>
              <Text style={styles.emptyText}>
                {search || agentFilter !== "all" || statusFilter !== "not_watched"
                  ? "Try adjusting your search or filters."
                  : "Run an agent to start discovering videos."}
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <FeedCard
              item={item}
              onOpen={openVideo}
              onStatus={setStatus}
            />
          )}
        />
      )}
    </View>
  );
}

// ── Dropdown option shape ──────────────────────────────────────────

interface DropdownOption<T extends string = string> {
  key: T;
  label: string;
  badge?: number;
  icon?: React.ReactNode;
  thumbnail?: string;
  thumbnailText?: string;
}

// ── Full-Width Dropdown Component ──────────────────────────────────

function FilterDropdownFull<T extends string>({
  icon,
  label,
  value,
  options,
  onChange,
}: {
  icon: React.ReactNode;
  label: string;
  value: T;
  options: DropdownOption<T>[];
  onChange: (key: T) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.key === value);

  return (
    <>
      <Pressable
        style={({ pressed }) => [
          styles.dropdownFull,
          pressed && styles.pressed,
        ]}
        onPress={() => setOpen(true)}
      >
        <View style={styles.dropdownFullLeft}>
          {icon}
          <Text style={styles.dropdownFullLabel} numberOfLines={1}>
            {selected?.label ?? value}
          </Text>
          {selected?.badge !== undefined ? (
            <View style={styles.dropdownBadge}>
              <Text style={styles.dropdownBadgeText}>{selected.badge}</Text>
            </View>
          ) : null}
        </View>
        <ChevronDown size={14} color={Colors.textMuted} />
      </Pressable>

      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(false)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setOpen(false)}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>{label}</Text>
            <ScrollView
              style={styles.modalScroll}
              showsVerticalScrollIndicator={true}
              indicatorStyle="white"
              bounces={false}
            >
              {options.map((opt) => {
                const active = opt.key === value;
                return (
                  <Pressable
                    key={opt.key}
                    style={({ pressed }) => [
                      styles.modalOption,
                      active && styles.modalOptionActive,
                      pressed && styles.pressed,
                    ]}
                    onPress={() => {
                      onChange(opt.key);
                      setOpen(false);
                    }}
                  >
                    {/* Left check mark */}
                    <View style={styles.checkSlot}>
                      {active ? (
                        <Check size={16} color={Colors.accent} />
                      ) : null}
                    </View>

                    {/* Channel thumbnail */}
                    {opt.thumbnail ? (
                      <Image
                        source={{ uri: opt.thumbnail }}
                        style={styles.optionThumb}
                        contentFit="cover"
                        transition={100}
                      />
                    ) : opt.thumbnailText ? (
                      <View style={styles.optionThumbFallback}>
                        <Text style={styles.optionThumbFallbackText}>
                          {opt.thumbnailText}
                        </Text>
                      </View>
                    ) : null}

                    {/* Option icon (for status) */}
                    {opt.icon ? (
                      <View style={styles.optionIconSlot}>{opt.icon}</View>
                    ) : null}

                    {/* Label */}
                    <Text
                      style={[
                        styles.modalOptionText,
                        active && styles.modalOptionTextActive,
                      ]}
                      numberOfLines={1}
                    >
                      {opt.label}
                    </Text>

                    {/* Badge — right-aligned */}
                    {opt.badge !== undefined ? (
                      <View style={styles.optionBadge}>
                        <Text style={styles.optionBadgeText}>{opt.badge}</Text>
                      </View>
                    ) : null}
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

// ── Video Card ────────────────────────────────────────────────────

function FeedCard({
  item,
  onOpen,
  onStatus,
}: {
  item: ItemWithAnalysis;
  onOpen: (item: ItemWithAnalysis) => void;
  onStatus: (id: string, status: ItemStatus) => void;
}) {
  const analysis = useMemo(() => item.item_analysis?.[0] ?? null, [item.item_analysis]);
  const status = (item.user_status ?? "not_watched") as ItemStatus;
  const [statusOpen, setStatusOpen] = useState(false);

  const statusCfg = ITEM_STATUS_ICONS[status];
  const StatusIcon = statusCfg.icon;

  const channelInitial = (item.channel_name ?? "?")[0].toUpperCase();

  return (
    <Pressable
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
      onPress={() => onOpen(item)}
    >
      {/* Thumbnail */}
      <View style={styles.thumbWrap}>
        {item.thumbnail_url ? (
          <Image
            source={{ uri: item.thumbnail_url }}
            style={styles.thumb}
            contentFit="cover"
            transition={150}
          />
        ) : (
          <View style={[styles.thumb, styles.thumbFallback]} />
        )}
        <View style={styles.playOverlay}>
          <Play size={22} color={Colors.white} fill={Colors.white} />
        </View>
      </View>

      {/* Body */}
      <View style={styles.cardBody}>
        {/* Title + status control */}
        <View style={styles.titleRow}>
          <Text style={styles.title} numberOfLines={2}>
            {item.title ?? "Untitled"}
          </Text>
          <StatusControl
            status={status}
            statusCfg={statusCfg}
            StatusIcon={StatusIcon}
            open={statusOpen}
            onToggle={() => setStatusOpen((v) => !v)}
            onSelect={(s) => {
              setStatusOpen(false);
              onStatus(item.id, s);
            }}
            onClose={() => setStatusOpen(false)}
          />
        </View>

        {/* Channel avatar + name + time ago | duration */}
        <View style={styles.metaRow}>
          <View style={styles.metaLeft}>
            <View style={styles.channelAvatar}>
              <Text style={styles.channelAvatarText}>{channelInitial}</Text>
            </View>
            <Text style={styles.channel} numberOfLines={1}>
              {item.channel_name ?? "Unknown channel"} · {timeAgo(item.published_at)}
            </Text>
          </View>
          {analysis?.duration_seconds ? (
            <Text style={styles.durationInline}>
              {formatDuration(analysis.duration_seconds)}
            </Text>
          ) : null}
        </View>

        {analysis?.short_summary ? (
          <Text style={styles.summary} numberOfLines={2}>
            {analysis.short_summary}
          </Text>
        ) : null}

        {analysis?.tags && analysis.tags.length > 0 ? (
          <View style={styles.tagsRow}>
            {analysis.tags.slice(0, 4).map((t) => (
              <View key={t} style={styles.tag}>
                <Text style={styles.tagText}>{t}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {/* Stats row */}
        {analysis ? (
          <View style={styles.statsRow}>
            <Stat
              icon={<Eye size={12} color={Colors.textMuted} />}
              value={compactNumber(analysis.views_at_analysis)}
            />
            <Stat
              icon={<ThumbsUp size={12} color={Colors.textMuted} />}
              value={compactNumber(analysis.likes_at_analysis)}
            />
            <Stat
              icon={<MessageCircle size={12} color={Colors.textMuted} />}
              value={compactNumber(analysis.comments_at_analysis)}
            />
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

// ── Status Control (compact dropdown per card) ─────────────────────

function StatusControl({
  status,
  statusCfg,
  StatusIcon,
  open,
  onToggle,
  onSelect,
  onClose,
}: {
  status: ItemStatus;
  statusCfg: (typeof ITEM_STATUS_ICONS)[ItemStatus];
  StatusIcon: typeof Check;
  open: boolean;
  onToggle: () => void;
  onSelect: (s: ItemStatus) => void;
  onClose: () => void;
}) {
  return (
    <>
      <Pressable
        style={styles.statusControl}
        onPress={(e) => {
          e.stopPropagation?.();
          onToggle();
        }}
        hitSlop={6}
      >
        <StatusIcon
          size={15}
          color={statusCfg.color}
          fill={status === "liked" ? statusCfg.color : "transparent"}
        />
        <ChevronDown size={10} color={Colors.textMuted} />
      </Pressable>

      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={onClose}
      >
        <Pressable style={styles.modalBackdrop} onPress={onClose}>
          <View style={styles.statusModal}>
            <Text style={styles.statusModalTitle}>Set status</Text>
            {STATUS_OPTIONS_COMPACT.map((opt) => {
              const cfg = ITEM_STATUS_ICONS[opt.key];
              const IconC = cfg.icon;
              const active = opt.key === status;
              return (
                <Pressable
                  key={opt.key}
                  style={({ pressed }) => [
                    styles.statusOption,
                    active && styles.statusOptionActive,
                    pressed && styles.pressed,
                  ]}
                  onPress={(e) => {
                    e.stopPropagation?.();
                    onSelect(opt.key);
                  }}
                >
                  {/* Left check mark */}
                  <View style={styles.checkSlot}>
                    {active ? (
                      <Check size={16} color={Colors.accent} />
                    ) : null}
                  </View>
                  <IconC
                    size={16}
                    color={cfg.color}
                    fill={active && opt.key === "liked" ? cfg.color : "transparent"}
                  />
                  <Text
                    style={[
                      styles.statusOptionText,
                      active && styles.statusOptionTextActive,
                    ]}
                  >
                    {opt.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

// ── Stat sub-component ────────────────────────────────────────────

function Stat({ icon, value }: { icon: React.ReactNode; value: string }) {
  return (
    <View style={styles.stat}>
      {icon}
      <Text style={styles.statText}>{value}</Text>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background },
  headerRow: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 12,
    marginBottom: 10,
  },
  heading: {
    fontSize: 26,
    fontWeight: "800" as const,
    color: Colors.textPrimary,
  },
  countBadge: {
    fontSize: 13,
    fontWeight: "600" as const,
    color: Colors.textSecondary,
  },

  // Search
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: 16,
    marginBottom: 10,
    backgroundColor: Colors.input,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
    height: 44,
    paddingHorizontal: 12,
  },
  searchIcon: { marginRight: 8 },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: Colors.textPrimary,
    paddingVertical: 0,
  },
  searchClear: {
    marginLeft: 8,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: Colors.border,
    alignItems: "center",
    justifyContent: "center",
  },

  // Filter wrapper
  filtersWrapper: {
    paddingHorizontal: 16,
    marginBottom: 12,
    gap: 8,
  },
  filterSideRow: {
    flexDirection: "row",
    gap: 8,
  },
  filterHalf: {
    flex: 1,
  },

  // Full-width dropdown trigger
  dropdownFull: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: Colors.card,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
  },
  dropdownFullLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flex: 1,
  },
  dropdownFullLabel: {
    fontSize: 14,
    fontWeight: "600" as const,
    color: Colors.textSecondary,
    flex: 1,
  },
  dropdownBadge: {
    backgroundColor: Colors.input,
    borderRadius: 8,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  dropdownBadgeText: {
    fontSize: 11,
    fontWeight: "700" as const,
    color: Colors.textMuted,
  },

  // Dropdown Modal
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "center",
    alignItems: "center",
  },
  modalContent: {
    width: "82%",
    maxHeight: "64%",
    backgroundColor: Colors.card,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
    overflow: "hidden",
  },
  modalTitle: {
    fontSize: 14,
    fontWeight: "700" as const,
    color: Colors.textSecondary,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 8,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  modalScroll: {
    maxHeight: 340,
  },
  modalOption: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 13,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.border,
    gap: 10,
  },
  modalOptionActive: {
    backgroundColor: `${Colors.accent}15`,
  },
  checkSlot: {
    width: 22,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  optionThumb: {
    width: 28,
    height: 28,
    borderRadius: 14,
    flexShrink: 0,
  },
  optionThumbFallback: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: Colors.input,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  optionThumbFallbackText: {
    fontSize: 12,
    fontWeight: "700" as const,
    color: Colors.textMuted,
  },
  optionIconSlot: {
    flexShrink: 0,
  },
  modalOptionText: {
    fontSize: 15,
    color: Colors.textPrimary,
    flex: 1,
  },
  modalOptionTextActive: {
    color: Colors.white,
    fontWeight: "600" as const,
  },
  optionBadge: {
    backgroundColor: Colors.input,
    borderRadius: 8,
    paddingHorizontal: 7,
    paddingVertical: 2,
    flexShrink: 0,
  },
  optionBadgeText: {
    fontSize: 11,
    fontWeight: "600" as const,
    color: Colors.textMuted,
  },

  // List
  loadingBox: { paddingVertical: 60, alignItems: "center" },
  listContent: { padding: 16, gap: 14, paddingBottom: 32 },
  emptyCard: {
    backgroundColor: Colors.card,
    borderRadius: 12,
    padding: 28,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
    alignItems: "center",
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: "700" as const,
    color: Colors.textPrimary,
    textAlign: "center",
  },
  emptyText: {
    fontSize: 13,
    color: Colors.textSecondary,
    textAlign: "center",
    marginTop: 6,
    lineHeight: 19,
  },

  // Card
  card: {
    backgroundColor: Colors.card,
    borderRadius: 14,
    overflow: "hidden",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
  },
  thumbWrap: {
    width: "100%",
    aspectRatio: 16 / 9,
    backgroundColor: Colors.input,
  },
  thumb: { width: "100%", height: "100%" },
  thumbFallback: { backgroundColor: Colors.input },
  playOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.15)",
  },

  // Card body
  cardBody: { padding: 12 },

  // Title row (title + status control)
  titleRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 6,
  },
  title: {
    flex: 1,
    fontSize: 15,
    fontWeight: "700" as const,
    color: Colors.textPrimary,
    lineHeight: 21,
  },

  // Status control (compact)
  statusControl: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
    backgroundColor: Colors.input,
    marginTop: 1,
    flexShrink: 0,
  },
  statusModal: {
    width: "72%",
    backgroundColor: Colors.card,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
    overflow: "hidden",
  },
  statusModalTitle: {
    fontSize: 14,
    fontWeight: "700" as const,
    color: Colors.textSecondary,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 8,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  statusOption: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 13,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.border,
  },
  statusOptionActive: {
    backgroundColor: `${Colors.accent}12`,
  },
  statusOptionText: {
    fontSize: 15,
    color: Colors.textPrimary,
  },
  statusOptionTextActive: {
    color: Colors.textPrimary,
    fontWeight: "600" as const,
  },

  // Channel meta row
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 8,
    gap: 8,
  },
  metaLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    flex: 1,
  },
  channelAvatar: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: Colors.input,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  channelAvatarText: {
    fontSize: 11,
    fontWeight: "700" as const,
    color: Colors.textSecondary,
  },
  channel: {
    fontSize: 12,
    color: Colors.textSecondary,
    flex: 1,
  },
  durationInline: {
    fontSize: 12,
    fontWeight: "600" as const,
    color: Colors.textMuted,
    flexShrink: 0,
  },
  summary: {
    fontSize: 13,
    color: Colors.textSecondary,
    lineHeight: 19,
    marginTop: 10,
  },
  tagsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 10,
  },
  tag: {
    backgroundColor: Colors.input,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  tagText: { fontSize: 11, color: Colors.textSecondary },

  // Stats
  statsRow: {
    flexDirection: "row",
    gap: 16,
    marginTop: 10,
  },
  stat: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  statText: { fontSize: 12, color: Colors.textMuted },

  // Shared
  pressed: { opacity: 0.7, transform: [{ scale: 0.98 }] },
});
