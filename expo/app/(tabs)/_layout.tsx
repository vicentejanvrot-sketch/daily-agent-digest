import { Tabs, useSegments, useRouter } from "expo-router";
import React, { useEffect } from "react";
import { StyleSheet } from "react-native";
import { LayoutDashboard, Bot, Rss, Clock, Settings } from "lucide-react-native";
import { Colors } from "@/constants/colors";
import { useAuth } from "@/lib/auth-provider";

export default function TabLayout() {
  const { user, status } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  // Guard: kick unauthenticated visitors back to Login.
  // Placed here (not in the root) so the root can always register both groups.
  useEffect(() => {
    if (status === "loading") return;
    if (!user) {
      router.replace("/auth/login");
    }
    // Only react to the actual auth result, not segment changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, status]);

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: Colors.accent,
        tabBarInactiveTintColor: Colors.textMuted,
        headerShown: false,
        tabBarStyle: styles.tabBar,
        tabBarLabelStyle: styles.tabLabel,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Dashboard",
          tabBarIcon: ({ color }) => <LayoutDashboard size={22} color={color} />,
        }}
      />
      <Tabs.Screen
        name="agents"
        options={{
          title: "Agents",
          tabBarIcon: ({ color }) => <Bot size={22} color={color} />,
        }}
      />
      <Tabs.Screen
        name="feed"
        options={{
          title: "Feed",
          tabBarIcon: ({ color }) => <Rss size={22} color={color} />,
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          title: "History",
          tabBarIcon: ({ color }) => <Clock size={22} color={color} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: "Settings",
          tabBarIcon: ({ color }) => <Settings size={22} color={color} />,
        }}
      />
      <Tabs.Screen
        name="agent-detail"
        options={{ href: null }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    backgroundColor: Colors.card,
    borderTopColor: Colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingBottom: 4,
    paddingTop: 4,
    height: 56,
  },
  tabLabel: {
    fontSize: 11,
    fontWeight: "600" as const,
  },
});
