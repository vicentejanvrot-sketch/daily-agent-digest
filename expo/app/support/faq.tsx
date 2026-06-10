import { ScrollView, StyleSheet, Text, View, Pressable, Linking, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Colors } from "@/constants/colors";

interface QA {
  q: string;
  a: string;
}

const FAQ_DATA: QA[] = [
  {
    q: "What does this app do?",
    a: "Daily Agent Digest lets you create research agents that monitor YouTube channels and playlists, automatically surface new videos into a Research Feed, and track which videos you've watched.",
  },
  {
    q: "Do I need a YouTube account?",
    a: "Connecting your YouTube account is optional. It lets the app sync your playlists, watch history, and video actions. You can use the core feed features without connecting.",
  },
  {
    q: "Why do you ask for API keys?",
    a: "API keys (YouTube, OpenAI, Anthropic, Gemini) are optional and let the app fetch video data and run AI analysis on your behalf. Keys are stored securely and are never displayed back to you after saving.",
  },
  {
    q: "How is my data stored?",
    a: "Your settings and saved keys are stored securely in our backend. API keys are write-only — once saved, they cannot be read back by the app or displayed on screen.",
  },
  {
    q: "How do I delete my account or data?",
    a: "You can delete your account at any time from Settings → Delete Account. This permanently removes your account and all your data — your agents, feeds, watch history, and saved settings. The deletion happens immediately within the app and cannot be undone. If you have any trouble, contact us at support@travelone.ca.",
  },
  {
    q: "How do I get help?",
    a: "Contact us any time at support@travelone.ca and we'll respond as soon as possible.",
  },
];

export default function FAQScreen() {
  const insets = useSafeAreaInsets();

  const handleMailto = async () => {
    try {
      await Linking.openURL("mailto:support@travelone.ca");
    } catch {
      // mailto may not be supported on all simulators
    }
  };

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}
      showsVerticalScrollIndicator={false}
    >
      {FAQ_DATA.map((item, idx) => (
        <View
          key={idx}
          style={[styles.qaBlock, idx === FAQ_DATA.length - 1 && styles.lastBlock]}
        >
          <Text style={styles.question}>{item.q}</Text>
          <Text style={styles.answer}>{item.a}</Text>
        </View>
      ))}

      <Text style={styles.footer}>
        Still need help? Contact us at{" "}
        <Text style={styles.link} onPress={handleMailto}>
          support@travelone.ca
        </Text>
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  qaBlock: {
    marginBottom: 20,
  },
  lastBlock: {
    marginBottom: 6,
  },
  question: {
    fontSize: 16,
    fontWeight: "700" as const,
    color: Colors.textPrimary,
    marginBottom: 6,
    lineHeight: 22,
  },
  answer: {
    fontSize: 14,
    color: Colors.textSecondary,
    lineHeight: 21,
  },
  footer: {
    fontSize: 14,
    color: Colors.textSecondary,
    lineHeight: 21,
    marginTop: 10,
    paddingTop: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.border,
  },
  link: {
    color: Colors.accent,
    fontWeight: "600" as const,
  },
});
