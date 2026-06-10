import { StyleSheet, Text, View } from "react-native";
import { Colors } from "@/constants/colors";
import type { RunStatus } from "@/lib/database";

const CONFIG: Record<RunStatus, { label: string; color: string }> = {
  running: { label: "Running", color: Colors.warning },
  success: { label: "Success", color: Colors.success },
  partial: { label: "Partial", color: Colors.accent },
  failed: { label: "Failed", color: Colors.destructive },
  cancelled: { label: "Cancelled", color: Colors.textMuted },
};

export function StatusPill({ status, compact }: { status: RunStatus; compact?: boolean }) {
  const cfg = CONFIG[status] ?? CONFIG.cancelled;
  return (
    <View style={[styles.pill, { backgroundColor: `${cfg.color}22` }, compact && styles.compact]}>
      <View style={[styles.dot, { backgroundColor: cfg.color }]} />
      <Text style={[styles.label, { color: cfg.color }, compact && styles.labelCompact]}>
        {cfg.label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    alignSelf: "flex-start",
  },
  compact: { paddingHorizontal: 8, paddingVertical: 3 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  label: { fontSize: 12, fontWeight: "600" as const },
  labelCompact: { fontSize: 11 },
});
