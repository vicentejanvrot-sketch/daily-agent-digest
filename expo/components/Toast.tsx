import createContextHook from "@nkzw/create-context-hook";
import { useCallback, useEffect, useRef, useState } from "react";
import { Animated, StyleSheet, Text, View } from "react-native";
import * as Haptics from "expo-haptics";
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

  const accent =
    toast.type === "error"
      ? Colors.destructive
      : toast.type === "success"
        ? Colors.success
        : Colors.accent;
  const bg =
    toast.type === "error"
      ? Colors.destructiveBg
      : toast.type === "success"
        ? "hsl(142, 30%, 12%)"
        : "hsl(199, 40%, 13%)";

  return (
    <View pointerEvents="none" style={styles.overlay}>
      <Animated.View
        style={[
          styles.toast,
          { backgroundColor: bg, borderLeftColor: accent, opacity },
        ]}
      >
        <Text style={[styles.text, { color: accent }]}>{toast.message}</Text>
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
    maxWidth: "85%",
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 13,
    borderLeftWidth: 3,
    shadowColor: Colors.black,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  text: {
    fontSize: 14,
    fontWeight: "500" as const,
    textAlign: "center",
  },
});
