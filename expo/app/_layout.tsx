import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack, router } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { ChevronLeft } from "lucide-react-native";
import { AuthProvider, useAuth } from "@/lib/auth-provider";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ToastProvider, ToastHost } from "@/components/Toast";
import { RunningOverlayProvider, RunningOverlay } from "@/lib/running-overlay";
import { YouTubeConnectionProvider } from "@/lib/useYouTubeConnection";
import { Colors } from "@/constants/colors";

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient();

function AuthGate() {
  const { status } = useAuth();

  useEffect(() => {
    if (status !== "loading") {
      SplashScreen.hideAsync();
    }
  }, [status]);

  if (status === "loading") {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={Colors.accent} />
      </View>
    );
  }

  // Always register both screen groups so React Navigation never
  // gets stuck on a stale screen when auth state changes.
  // Each group layout contains its own redirect guard.
  return (
    <YouTubeConnectionProvider>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="auth" options={{ headerShown: false }} />
        <Stack.Screen
          name="modal"
          options={{ presentation: "modal", headerShown: false }}
        />
        <Stack.Screen
          name="video-player"
          options={{ presentation: "modal", headerShown: false }}
        />
        <Stack.Screen
          name="support/faq"
          options={{
            headerShown: true,
            title: "FAQ",
            headerStyle: { backgroundColor: Colors.background },
            headerTintColor: Colors.textPrimary,
            headerShadowVisible: false,
            headerBackVisible: false,
            headerLeft: () => (
              <Pressable
                onPress={() => router.replace("/(tabs)/settings")}
                style={styles.backBtn}
                hitSlop={8}
              >
                <ChevronLeft size={22} color={Colors.textPrimary} />
                <Text style={styles.backLabel}>Back</Text>
              </Pressable>
            ),
          }}
        />
        <Stack.Screen
          name="support/privacy"
          options={{
            headerShown: true,
            title: "Privacy Policy",
            headerStyle: { backgroundColor: Colors.background },
            headerTintColor: Colors.textPrimary,
            headerShadowVisible: false,
            headerBackVisible: false,
            headerLeft: () => (
              <Pressable
                onPress={() => router.replace("/(tabs)/settings")}
                style={styles.backBtn}
                hitSlop={8}
              >
                <ChevronLeft size={22} color={Colors.textPrimary} />
                <Text style={styles.backLabel}>Back</Text>
              </Pressable>
            ),
          }}
        />
        <Stack.Screen
          name="support/terms"
          options={{
            headerShown: true,
            title: "Terms of Service",
            headerStyle: { backgroundColor: Colors.background },
            headerTintColor: Colors.textPrimary,
            headerShadowVisible: false,
            headerBackVisible: false,
            headerLeft: () => (
              <Pressable
                onPress={() => router.replace("/(tabs)/settings")}
                style={styles.backBtn}
                hitSlop={8}
              >
                <ChevronLeft size={22} color={Colors.textPrimary} />
                <Text style={styles.backLabel}>Back</Text>
              </Pressable>
            ),
          }}
        />
        <Stack.Screen name="+not-found" />
      </Stack>
    </YouTubeConnectionProvider>
  );
}

export default function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <SafeAreaProvider>
          <RunningOverlayProvider>
            <ToastProvider>
              <GestureHandlerRootView style={styles.root}>
                <AuthGate />
                <ToastHost />
                <RunningOverlay />
              </GestureHandlerRootView>
            </ToastProvider>
          </RunningOverlayProvider>
        </SafeAreaProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  loading: {
    flex: 1,
    backgroundColor: Colors.background,
    alignItems: "center",
    justifyContent: "center",
  },
  backBtn: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 4,
    marginLeft: -4,
    paddingVertical: 4,
    paddingRight: 8,
  },
  backLabel: {
    fontSize: 17,
    color: Colors.textPrimary,
  },
});
