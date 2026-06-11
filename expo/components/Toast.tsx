import createContextHook from "@nkzw/create-context-hook";
import { useCallback, useEffect, useRef, useState } from "react";
import { Animated, StyleSheet, Text, View } from "react-native";
import * as Haptics from "expo-haptics";
import { CheckCircle2, X } from "lucide-react-native";
import { Colors } from "@/constants/colors";

type ToastType = "error" | "success" | "info";

interface ToastData {
  message: string;
  type: ToastType;
}

export const [ToastProvider, useToastState] = createContextHook(() => {
  const [toast, setToast] = useState<ToastData | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback((message: string, type: ToastType = "info") => {
    if (timer.current) clearTimeout(timer.current);
    setToast({ message, type });
    if (type === "error") {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } else if (type === "success") {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
    timer.current = setTimeout(() => setToast(null), 3200);
  }, []);

  return { toast, show };
});

/** Convenience hook returning just the show function. */
export function useToast() {
  return useToastState().show;
}

/** Mount once near the root to render the active toast. */
export function ToastHost() {
  const { toast } = useToastState();
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (toast) {
      Animated.timing(opacity, {
        toValue: 1,
        duration: 180,
        useNativeDriver: true,
      }).start();
    } else {
      opacity.setValue(0);
    }
  }, [toast, opacity]);

  if (!toast) return null;

  const statusColor =
    toast.type === "error"
      ? "hsl(0, 72%, 55%)"
      : toast.type === "success"
        ? "hsl(142, 66%, 50%)"
        : "hsl(199, 89%, 48%)";

  return (
    <View pointerEvents="none" style={styles.overlay}>
      <Animated.View
        style={[
          styles.toast,
          { backgroundColor: statusColor, opacity },
        ]}
      >
        {toast.type === "success" ? (
          <View style={styles.iconCircle}>
            <CheckCircle2 size={20} color={"hsl(142, 66%, 50%)"} strokeWidth={2.5} />
          </View>
        ) : toast.type === "error" ? (
          <View style={styles.iconCircle}>
            <X size={20} color={"hsl(0, 72%, 55%)"} strokeWidth={2.5} />
          </View>
        ) : null}
        <Text style={styles.text}>{toast.message}</Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: "center",
    alignItems: "center",
    zIndex: 1000,
  },
  toast: {
    flexDirection: "row",
    alignItems: "center",
    maxWidth: "85%",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
    paddingVertical: 12,
    paddingHorizontal: 14,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 8,
  },
  iconCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: Colors.white,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
  },
  text: {
    flex: 1,
    fontSize: 14,
    fontWeight: "700" as const,
    color: Colors.white,
    textAlign: "left",
  },
});
