import { StyleSheet, Text, View } from "react-native";
import { Colors } from "@/constants/colors";
import type { RunStatus } from "@/lib/database";

const CONFIG: Record<RunStatus, { label: string; color: string }> = {
  running: { label: "running", color: Colors.accent },
  success: { label: "success", color: Colors.success },
  partial: { label: "partial", color: Colors.warning },
  failed: { label: "failed", color: Colors.destructive },
  cancelled: { label: "cancelled", color: Colors.textMuted },
};

/** Convert an HSL color string to HSLA with a given alpha. */
function hsla(hsl: string, alpha: number): string {
  return hsl.replace(/^hsl\(/, "hsla(").replace(/\)$/, `, ${alpha})`);
}

interface StatusPillProps {
  status: RunStatus;
  compact?: boolean;
  icon?: React.ReactNode;
  label?: string;
}

export function StatusPill({ status, compact, icon, label }: StatusPillProps) {
  const cfg = CONFIG[status] ?? CONFIG.cancelled;
  return (
    <View
      style={[
        styles.pill,
        {
          backgroundColor: hsla(cfg.color, 0.15),
          borderColor: cfg.color,
        },
        compact && styles.compact,
      ]}
    >
      {icon != null ? <View style={styles.iconWrap}>{icon}</View> : null}
      <Text
        style={[styles.label, { color: cfg.color }, compact && styles.labelCompact]}
      >
        {label ?? cfg.label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
    alignSelf: "flex-start",
  },
  compact: { paddingHorizontal: 8, paddingVertical: 2 },
  iconWrap: { flexShrink: 0 },
  label: { fontSize: 12, fontWeight: "600" as const },
  labelCompact: { fontSize: 11 },
});
