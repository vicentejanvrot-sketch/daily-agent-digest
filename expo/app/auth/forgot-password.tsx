import { router } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import { ArrowLeft } from "lucide-react-native";
import { useAuth } from "@/lib/auth-provider";
import { Colors } from "@/constants/colors";

export default function ForgotPasswordScreen() {
  const insets = useSafeAreaInsets();
  const { sendPasswordReset } = useAuth();

  const [email, setEmail] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [emailFocused, setEmailFocused] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: "error" | "success" } | null>(null);

  const showToast = (message: string, type: "error" | "success") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  const handleSendReset = async () => {
    if (!email.trim()) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      showToast("Please enter your email address.", "error");
      return;
    }

    setIsLoading(true);
    const { error } = await sendPasswordReset(email.trim());
    setIsLoading(false);

    if (error) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      showToast(error.message, "error");
      return;
    }

    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    showToast("Check your inbox — we've sent a password reset link.", "success");
  };

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={-insets.bottom}
    >
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 60 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Back button */}
        <Pressable
          style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.6 }]}
          onPress={() => router.back()}
        >
          <ArrowLeft size={20} color={Colors.textSecondary} />
        </Pressable>

        {/* Card */}
        <View style={styles.card}>
          {/* App icon */}
          <Image
            source={require("@/assets/images/icon.png")}
            style={styles.icon}
            resizeMode="contain"
          />

          <Text style={styles.title}>Reset your password</Text>

          <Text style={styles.subtitle}>
            Enter the email address associated with your account and we'll send you a link to reset
            your password.
          </Text>

          {/* Email field */}
          <Text style={styles.label}>Email</Text>
          <TextInput
            style={[styles.input, emailFocused && styles.inputFocused]}
            placeholder="you@example.com"
            placeholderTextColor={Colors.textMuted}
            value={email}
            onChangeText={setEmail}
            onFocus={() => setEmailFocused(true)}
            onBlur={() => setEmailFocused(false)}
            autoCapitalize="none"
            autoComplete="email"
            autoCorrect={false}
            keyboardType="email-address"
            textContentType="emailAddress"
            editable={!isLoading}
            returnKeyType="done"
            onSubmitEditing={handleSendReset}
          />

          {/* Send reset button */}
          <Pressable
            style={({ pressed }) => [
              styles.button,
              pressed && styles.buttonPressed,
              isLoading && styles.buttonDisabled,
            ]}
            onPress={handleSendReset}
            disabled={isLoading}
          >
            <LinearGradient
              colors={Colors.accentGradient as unknown as readonly [string, string, ...string[]]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={StyleSheet.absoluteFill}
            />
            {isLoading ? (
              <ActivityIndicator color={Colors.white} size="small" />
            ) : (
              <Text style={styles.buttonText}>Send reset link</Text>
            )}
          </Pressable>

          {/* Back to sign in */}
          <Pressable
            style={({ pressed }) => [styles.linkWrap, pressed && { opacity: 0.6 }]}
            onPress={() => router.back()}
          >
            <Text style={styles.link}>Back to sign in</Text>
          </Pressable>
        </View>
      </ScrollView>

      {/* Toast */}
      {toast && (
        <View
          style={[
            styles.toast,
            toast.type === "error" ? styles.toastError : styles.toastSuccess,
            { top: insets.top + 12 },
          ]}
        >
          <Text
            style={[
              styles.toastText,
              toast.type === "error" ? styles.toastTextError : styles.toastTextSuccess,
            ]}
          >
            {toast.message}
          </Text>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingBottom: 40,
  },
  backBtn: {
    alignSelf: "flex-start",
    marginBottom: 16,
    padding: 8,
    marginLeft: -8,
  },
  card: {
    backgroundColor: Colors.card,
    borderRadius: 12,
    padding: 28,
    alignItems: "center",
  },
  icon: {
    width: 64,
    height: 64,
    borderRadius: 16,
    marginBottom: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: "700" as const,
    color: Colors.textPrimary,
    textAlign: "center",
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: Colors.textSecondary,
    textAlign: "center",
    lineHeight: 20,
    marginBottom: 24,
  },
  label: {
    alignSelf: "flex-start",
    fontSize: 13,
    fontWeight: "600" as const,
    color: Colors.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  input: {
    width: "100%",
    backgroundColor: Colors.input,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 15,
    color: Colors.textPrimary,
  },
  inputFocused: {
    borderColor: Colors.borderFocus,
  },
  button: {
    width: "100%",
    height: 48,
    borderRadius: 10,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 24,
  },
  buttonPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.98 }],
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  buttonText: {
    color: Colors.white,
    fontSize: 16,
    fontWeight: "600" as const,
  },
  linkWrap: {
    marginTop: 20,
    paddingVertical: 8,
  },
  link: {
    color: Colors.accent,
    fontSize: 14,
    fontWeight: "500" as const,
  },
  toast: {
    position: "absolute",
    left: 16,
    right: 16,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 13,
    zIndex: 100,
    shadowColor: Colors.black,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  toastError: {
    backgroundColor: Colors.destructiveBg,
    borderLeftWidth: 3,
    borderLeftColor: Colors.destructive,
  },
  toastSuccess: {
    backgroundColor: "hsl(142, 30%, 12%)",
    borderLeftWidth: 3,
    borderLeftColor: Colors.success,
  },
  toastText: {
    fontSize: 14,
    fontWeight: "500" as const,
  },
  toastTextError: {
    color: Colors.destructive,
  },
  toastTextSuccess: {
    color: Colors.success,
  },
});
