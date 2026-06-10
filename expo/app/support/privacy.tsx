import { ScrollView, StyleSheet, Text, Linking } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Colors } from "@/constants/colors";

export default function PrivacyPolicyScreen() {
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
      <Text style={styles.heading}>Privacy Policy</Text>
      <Text style={styles.lastUpdated}>Last updated: June 10, 2026</Text>

      <Text style={styles.paragraph}>
        This Privacy Policy explains how Daily Agent Digest ("we", "us", or "the app") collects, uses, and protects your information. By using the app, you agree to the practices described here.
      </Text>

      <Text style={styles.sectionHeading}>Information We Collect</Text>
      <Text style={styles.paragraph}>
        We collect the email address you sign in with, settings you configure (such as your default email and research agents), and, if you choose to provide them, optional API keys for third-party services (YouTube, OpenAI, Anthropic, Gemini). If you connect your YouTube account, we access playlist, watch history, and video data you authorize through Google's sign-in.
      </Text>

      <Text style={styles.sectionHeading}>How We Use Your Information</Text>
      <Text style={styles.paragraph}>
        We use your information solely to provide the app's features: monitoring channels, building your Research Feed, syncing YouTube actions you request, and running AI analysis you initiate. We do not sell your personal information.
      </Text>

      <Text style={styles.sectionHeading}>Third-Party Services</Text>
      <Text style={styles.paragraph}>
        The app may interact with Google/YouTube, OpenAI, Anthropic, and Google Gemini using credentials you provide or authorize. Your use of those services is also governed by their respective privacy policies.
      </Text>

      <Text style={styles.sectionHeading}>Data Storage and Security</Text>
      <Text style={styles.paragraph}>
        Your data is stored securely in our backend. API keys are stored write-only and are never displayed back to you or read by the app after being saved.
      </Text>

      <Text style={styles.sectionHeading}>Data Retention and Deletion</Text>
      <Text style={styles.paragraph}>
        We retain your data for as long as your account is active. You can permanently delete your account and all associated data at any time directly within the app by going to Settings and selecting "Delete Account." This removes your data — including your agents, feeds, watch history, and saved settings — and the deletion takes effect immediately and cannot be undone. If you prefer, or if you need assistance, you can also request deletion by emailing{" "}
        <Text style={styles.link} onPress={handleMailto}>
          support@travelone.ca
        </Text>
        , and we will complete the deletion within 30 days.
      </Text>

      <Text style={styles.sectionHeading}>Children's Privacy</Text>
      <Text style={styles.paragraph}>
        The app is not directed to children under 13, and we do not knowingly collect personal information from them.
      </Text>

      <Text style={styles.sectionHeading}>Changes to This Policy</Text>
      <Text style={styles.paragraph}>
        We may update this Privacy Policy from time to time. Material changes will be reflected by updating the "Last updated" date above.
      </Text>

      <Text style={styles.sectionHeading}>Contact Us</Text>
      <Text style={styles.paragraph}>
        If you have questions about this Privacy Policy or your data, contact us at{" "}
        <Text style={styles.link} onPress={handleMailto}>
          support@travelone.ca
        </Text>
        .
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
  heading: {
    fontSize: 26,
    fontWeight: "800" as const,
    color: Colors.textPrimary,
    marginBottom: 4,
  },
  lastUpdated: {
    fontSize: 12,
    color: Colors.textMuted,
    marginBottom: 20,
  },
  sectionHeading: {
    fontSize: 16,
    fontWeight: "700" as const,
    color: Colors.textPrimary,
    marginTop: 18,
    marginBottom: 6,
  },
  paragraph: {
    fontSize: 14,
    color: Colors.textSecondary,
    lineHeight: 22,
    marginBottom: 10,
  },
  link: {
    color: Colors.accent,
    fontWeight: "600" as const,
  },
});
