import { ScrollView, StyleSheet, Text, Linking } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Colors } from "@/constants/colors";

export default function TermsOfServiceScreen() {
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
      <Text style={styles.heading}>Terms of Service</Text>
      <Text style={styles.lastUpdated}>Last updated: June 10, 2026</Text>

      <Text style={styles.paragraph}>
        These Terms of Service ("Terms") govern your use of Daily Agent Digest ("the app"). By downloading, accessing, or using the app, you agree to these Terms. If you do not agree, do not use the app.
      </Text>

      <Text style={styles.sectionHeading}>Use of the App</Text>
      <Text style={styles.paragraph}>
        You may use the app only for lawful purposes and in accordance with these Terms. You are responsible for any activity that occurs under your account and for keeping your sign-in credentials and any API keys you provide secure.
      </Text>

      <Text style={styles.sectionHeading}>Third-Party Services and Credentials</Text>
      <Text style={styles.paragraph}>
        The app integrates with third-party services including YouTube/Google, OpenAI, Anthropic, and Google Gemini. You are responsible for complying with those services' terms, and for any usage, fees, or limits associated with credentials you provide.
      </Text>

      <Text style={styles.sectionHeading}>User Content and Conduct</Text>
      <Text style={styles.paragraph}>
        You agree not to misuse the app, attempt to disrupt its operation, reverse engineer it, or use it to violate any law or third-party rights.
      </Text>

      <Text style={styles.sectionHeading}>Intellectual Property</Text>
      <Text style={styles.paragraph}>
        The app and its original content, features, and functionality are owned by us and are protected by applicable intellectual property laws.
      </Text>

      <Text style={styles.sectionHeading}>Disclaimer of Warranties</Text>
      <Text style={styles.paragraph}>
        The app is provided "as is" and "as available" without warranties of any kind, whether express or implied, including fitness for a particular purpose. We do not guarantee that the app will be uninterrupted, error-free, or that results from AI analysis will be accurate.
      </Text>

      <Text style={styles.sectionHeading}>Limitation of Liability</Text>
      <Text style={styles.paragraph}>
        To the maximum extent permitted by law, we will not be liable for any indirect, incidental, or consequential damages arising from your use of the app.
      </Text>

      <Text style={styles.sectionHeading}>Termination</Text>
      <Text style={styles.paragraph}>
        We may suspend or terminate your access to the app at any time if you violate these Terms. You may stop using the app at any time and request deletion of your data by emailing support@travelone.ca.
      </Text>

      <Text style={styles.sectionHeading}>Changes to These Terms</Text>
      <Text style={styles.paragraph}>
        We may update these Terms from time to time. Continued use of the app after changes take effect constitutes acceptance of the revised Terms.
      </Text>

      <Text style={styles.sectionHeading}>Contact Us</Text>
      <Text style={styles.paragraph}>
        For questions about these Terms, contact us at{" "}
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
