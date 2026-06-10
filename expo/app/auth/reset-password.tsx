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
import { ArrowLeft, Check } from "lucide-react-native";
import { useAuth } from "@/lib/auth-provider";
import { Colors } from "@/constants/colors";

export default function ResetPasswordScreen() {
  const insets = useSafeAreaInsets();
  const { updatePassword } = useAuth();

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const [pw1Focused, setPw1Focused] = useState(false);
  const [pw2Focused, setPw2Focused] = useState(false);

  const [showPassword, setShowPassword] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: "error" | "success" } | null>(null);

  const showToast = (message: string, type: "error" | "success") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  };

  const passwordsMatch = newPassword.length > 0 && newPassword === confirmPassword;
  const canSubmit = newPassword.length >= 6 && confirmPassword.length >= 6 && passwordsMatch;

  const handleReset = async () => {
    if (!newPassword.trim() || !confirmPassword.trim()) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      showToast("Please fill in both password fields.", "error");
      return;
    }

    if (newPassword.length < 6) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      showToast("Password must be at least 6 characters.", "error");
      return;
    }

    if (!passwordsMatch) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      showToast("Passwords do not match.", "error");
      return;
    }

    setIsLoading(true);
    const { error } = await updatePassword(newPassword);
    setIsLoading(false);

    if (error) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      showToast(error.message, "error");
      return;
    }

    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    showToast("Password updated! Sign in with your new password.", "success");
    setTimeout(() => {
      router.replace("/auth/login");
    }, 1500);
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
          <Image
            source={require("@/assets/images/icon.png")}
            style={styles.icon}
            resizeMode="contain"
          />

          <Text style={styles.title}>Set a new password</Text>

          <Text style={styles.subtitle}>
            Choose a strong password for your account. Must be at least 6 characters.
          </Text>

          {/* New password */}
          <Text style={styles.label}>New password</Text>
          <View style={styles.inputRow}>
            <TextInput
              style={[
                styles.input,
                styles.inputWithRight,
                pw1Focused && styles.inputFocused,
                passwordsMatch && newPassword.length > 0 && styles.inputValid,
              ]}
              placeholder="At least 6 characters"
              placeholderTextColor={Colors.textMuted}
              value={newPassword}
              onChangeText={(t) => {
                setNewPassword(t);
                setShowPassword(false);
              }}
              onFocus={() => setPw1Focused(true)}
              onBlur={() => setPw1Focused(false)}
              autoCapitalize="none"
              autoComplete="new-password"
              autoCorrect={false}
              secureTextEntry={!showPassword}
              textContentType="newPassword"
              editable={!isLoading}
              returnKeyType="next"
            />
            {passwordsMatch && newPassword.length > 0 && (
              <View style={styles.checkIcon}>
                <Check size={16} color={Colors.success} />
              </View>
            )}
          </View>

          {/* Confirm password */}
          <Text style={styles.label}>Confirm password</Text>
          <TextInput
            style={[
              styles.input,
              pw2Focused && styles.inputFocused,
              passwordsMatch && confirmPassword.length > 0 && styles.inputValid,
            ]}
            placeholder="Re-enter your new password"
            placeholderTextColor={Colors.textMuted}
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            onFocus={() => setPw2Focused(true)}
            onBlur={() => setPw2Focused(false)}
            autoCapitalize="none"
            autoComplete="new-password"
            autoCorrect={false}
            secureTextEntry={!showPassword}
            textContentType="newPassword"
            editable={!isLoading}
            returnKeyType="done"
            onSubmitEditing={handleReset}
          />

          {/* Mismatch hint */}
          {confirmPassword.length > 0 && !passwordsMatch && (
            <Text style={styles.mismatchHint}>Passwords do not match</Text>
          )}

          {/* Update password button */}
          <Pressable
            style={({ pressed }) => [
              styles.button,
              pressed && styles.buttonPressed,
              (!canSubmit || isLoading) && styles.buttonDisabled,
            ]}
            onPress={handleReset}
            disabled={!canSubmit || isLoading}
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
              <Text style={styles.buttonText}>Update password</Text>
            )}
          </Pressable>

          {/* Back to sign in */}
          <Pressable
            style={({ pressed }) => [styles.linkWrap, pressed && { opacity: 0.6 }]}
            onPress={() => router.replace("/auth/login")}
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
    marginTop: 16,
  },
  inputRow: {
    width: "100%",
    position: "relative",
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
  inputWithRight: {
    paddingRight: 36,
  },
  inputFocused: {
    borderColor: Colors.borderFocus,
  },
  inputValid: {
    borderColor: Colors.success,
  },
  checkIcon: {
    position: "absolute",
    right: 12,
    top: 0,
    bottom: 0,
    justifyContent: "center",
  },
  mismatchHint: {
    alignSelf: "flex-start",
    fontSize: 12,
    color: Colors.destructive,
    marginTop: 4,
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
    opacity: 0.5,
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
