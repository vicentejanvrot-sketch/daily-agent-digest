import { Stack, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import React, { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import Constants from "@/constants/colors";
import { useAuth } from "@/lib/auth-provider";

export default function AuthLayout() {
  const { user, status } = useAuth();
  const router = useRouter();

  // Guard: if a session becomes active (e.g. sign-in completes),
  // bounce to the main tabs immediately.
  useEffect(() => {
    if (status === "loading") return;
    if (user) {
      router.replace("/(tabs)");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, status]);

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: styles.content,
          animation: "fade",
        }}
      >
        <Stack.Screen name="signup" />
        <Stack.Screen name="login" />
        <Stack.Screen name="forgot-password" />
        <Stack.Screen name="reset-password" />
      </Stack>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Constants.background,
  },
  content: {
    backgroundColor: Constants.background,
  },
});
