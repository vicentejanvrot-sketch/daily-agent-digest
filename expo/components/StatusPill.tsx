import { StyleSheet, Text, View } from "react-native";
import { Colors } from "@/constants/colors";
import type { RunStatus } from "@/lib/database";

const CONFIG: Record<RunStatus, { label: string; color: string }> = {
  running: { label: "running", color: Colors.warning },
  success: { label: "success", color: Colors.success },
  partial: { label: "partial", color: Colors.accent },
  failed: { label: "failed", color: Colors.destructive },
  cancelled: { label: "cancelled", color: Colors.textMuted },
};

export function StatusPill({ status, compact }: { status: RunStatus; compact?: boolean }) {
  const cfg = CONFIG[status] ?? CONFIG.cancelled;
  return (
    <View
      style={[
        styles.pill,
        {
          backgroundColor: `${cfg.color}15`,
          borderColor: cfg.color,
        },
        compact && styles.compact,
      ]}
    >
      <Text
        style={[styles.label, { color: cfg.color }, compact && styles.labelCompact]}
      >
        {cfg.label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
    alignSelf: "flex-start",
  },
  compact: { paddingHorizontal: 8, paddingVertical: 2 },
  label: { fontSize: 12, fontWeight: "600" as const },
  labelCompact: { fontSize: 11 },
});
