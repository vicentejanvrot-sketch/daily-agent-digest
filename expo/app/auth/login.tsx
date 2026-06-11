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
import { useAuth } from "@/lib/auth-provider";
import { Colors } from "@/constants/colors";

export default function LoginScreen() {
  const insets = useSafeAreaInsets();
  const { signIn } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  // Focus states for sky-blue border
  const [emailFocused, setEmailFocused] = useState(false);
  const [passwordFocused, setPasswordFocused] = useState(false);

  // Toast
  const [toast, setToast] = useState<{ message: string; type: "error" | "success" } | null>(null);

  const showToast = (message: string, type: "error" | "success") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  };

  const handleSignIn = async () => {
    if (!email.trim() || !password.trim()) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      showToast("Please fill in both email and password.", "error");
      return;
    }

    setIsLoading(true);
    const { error } = await signIn(email.trim(), password);
    setIsLoading(false);

    if (error) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      showToast(error.message, "error");
      return;
    }

    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    showToast("Welcome back!", "success");
    // Brief delay so the user sees the toast before navigating
    setTimeout(() => {
      router.replace("/(tabs)");
    }, 600);
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
        {/* Card */}
        <View style={styles.card}>
          {/* App icon */}
          <Image
            source={require("@/assets/images/icon.png")}
            style={styles.icon}
            resizeMode="contain"
          />

          {/* Title */}
          <Text style={styles.title}>Daily Agent Digest</Text>

          {/* Subtitle */}
          <Text style={styles.subtitle}>Sign in to your account to continue.</Text>

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
            returnKeyType="next"
          />

          {/* Password field */}
          <Text style={styles.label}>Password</Text>
          <TextInput
            style={[styles.input, passwordFocused && styles.inputFocused]}
            placeholder="Your password"
            placeholderTextColor={Colors.textMuted}
            value={password}
            onChangeText={setPassword}
            onFocus={() => setPasswordFocused(true)}
            onBlur={() => setPasswordFocused(false)}
            autoCapitalize="none"
            autoComplete="password"
            autoCorrect={false}
            secureTextEntry
            textContentType="password"
            editable={!isLoading}
            returnKeyType="done"
            onSubmitEditing={handleSignIn}
          />

          {/* Sign in button */}
          <Pressable
            style={({ pressed }) => [
              styles.button,
              pressed && styles.buttonPressed,
              isLoading && styles.buttonDisabled,
            ]}
            onPress={handleSignIn}
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
              <Text style={styles.buttonText}>Sign in</Text>
            )}
          </Pressable>

          {/* Forgot password link */}
          <Pressable
            style={({ pressed }) => [styles.linkWrap, pressed && { opacity: 0.6 }]}
            onPress={() => router.push("/auth/forgot-password")}
          >
            <Text style={styles.link}>Forgot password?</Text>
          </Pressable>

          {/* Sign up link */}
          <Pressable
            style={({ pressed }) => [styles.linkWrap, styles.linkWrapSecondary, pressed && { opacity: 0.6 }]}
            onPress={() => router.push("/auth/signup")}
          >
            <Text style={styles.linkSecondary}>Don&apos;t have an account? Sign up</Text>
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
    fontSize: 22,
    fontWeight: "700" as const,
    color: Colors.textPrimary,
    textAlign: "center",
    lineHeight: 28,
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 14,
    color: Colors.textSecondary,
    textAlign: "center",
    marginBottom: 28,
  },
  label: {
    alignSelf: "flex-start",
    fontSize: 13,
    fontWeight: "600" as const,
    color: Colors.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 6,
    marginTop: 16,
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
    marginTop: 28,
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
  linkWrapSecondary: {
    marginTop: 4,
  },
  link: {
    color: Colors.accent,
    fontSize: 14,
    fontWeight: "500" as const,
  },
  linkSecondary: {
    color: Colors.textSecondary,
    fontSize: 14,
    fontWeight: "500" as const,
  },
  // Toast
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
