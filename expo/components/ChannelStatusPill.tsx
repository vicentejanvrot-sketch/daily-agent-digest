import { StyleSheet, Text, View } from "react-native";
import { Colors } from "@/constants/colors";
import type { ChannelStatus } from "@/lib/database";

const CONFIG: Record<ChannelStatus, { label: string; color: string }> = {
  not_watched: { label: "Not Watched", color: Colors.textMuted },
  watched: { label: "Watched", color: Colors.success },
  liked: { label: "Liked", color: Colors.destructive },
  watch_later: { label: "Watch Later", color: Colors.warning },
};

export const CHANNEL_STATUS_FILTERS = [
  { key: "all", label: "All Channels" },
  { key: "not_watched", label: "Not Watched" },
  { key: "watched", label: "Watched" },
  { key: "liked", label: "Liked/Saved" },
  { key: "watch_later", label: "Watch Later" },
] as const;

export type ChannelFilterKey = (typeof CHANNEL_STATUS_FILTERS)[number]["key"];

export function ChannelStatusPill({ status }: { status: ChannelStatus | null }) {
  const cfg = (status && CONFIG[status]) ? CONFIG[status] : CONFIG.not_watched;
  return (
    <View style={[styles.pill, { backgroundColor: `${cfg.color}22` }]}>
      <View style={[styles.dot, { backgroundColor: cfg.color }]} />
      <Text style={[styles.label, { color: cfg.color }]}>{cfg.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    alignSelf: "flex-start",
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  label: { fontSize: 11, fontWeight: "600" as const },
});
