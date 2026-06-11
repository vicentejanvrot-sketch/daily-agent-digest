import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import {
  KeyRound,
  Link2,
  Mail,
  Monitor,
  Eye,
  EyeOff,
  Save,
  ChevronDown,
  LogOut,
  Unlink,
  User,
  ChevronRight,
  CircleHelp,
  FileText,
  ShieldCheck,
  MessageSquare,
  Trash2,
} from "lucide-react-native";
import { Colors } from "@/constants/colors";
import { useAuth } from "@/lib/auth-provider";
import { useUserSettings, useUpdateSettings, useUserSettingsSafe, useDeleteAccount, useDeleteApiKey } from "@/lib/hooks";
import { useToast } from "@/components/Toast";
import { useYouTubeConnection } from "@/lib/useYouTubeConnection";
import { useVideoQuality, QUALITY_KEYS, QUALITY_LABELS } from "@/lib/useVideoQuality";
import { openExternalLink } from "@/lib/open-link";

// ── Constants ─────────────────────────────────────────────────────



interface KeyDef {
  key: "youtube_api_key" | "openai_api_key" | "anthropic_api_key" | "gemini_api_key";
  label: string;
  helper: string;
  linkUrl: string;
  maxLen: number;
}

const KEY_DEFS: KeyDef[] = [
  {
    key: "youtube_api_key",
    label: "YouTube Data API Key",
    helper: "Required for fetching YouTube channel and video data.",
    linkUrl: "https://console.cloud.google.com/apis/credentials",
    maxLen: 100,
  },
  {
    key: "openai_api_key",
    label: "OpenAI API Key",
    helper: "Used for AI analysis and video enrichment.",
    linkUrl: "https://platform.openai.com/api-keys",
    maxLen: 200,
  },
  {
    key: "anthropic_api_key",
    label: "Anthropic API Key",
    helper: "Used for AI analysis and video enrichment.",
    linkUrl: "https://console.anthropic.com/settings/keys",
    maxLen: 200,
  },
  {
    key: "gemini_api_key",
    label: "Gemini API Key",
    helper: "Used for AI analysis and video enrichment.",
    linkUrl: "https://aistudio.google.com/app/apikey",
    maxLen: 200,
  },
];

/** Minimal email format check — matches the web app's validator. */
function isValidEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

/** Reject strings with whitespace or control characters. */
function hasBadChars(v: string): boolean {
  return /[\s\u0000-\u001F\u007F-\u009F]/.test(v);
}

// ── Component ─────────────────────────────────────────────────────

const IPAD_BREAKPOINT = 768;

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const isWide = windowWidth >= IPAD_BREAKPOINT;
  const { user, signOut } = useAuth();
  const showToast = useToast();

  const settings = useUserSettings();
  const safeSettings = useUserSettingsSafe();
  const updateSettings = useUpdateSettings();

  // ── Form state ────────────────────────────────────────────────

  const [defaultEmail, setDefaultEmail] = useState("");
  const [keys, setKeys] = useState<Record<string, string>>({
    youtube_api_key: "",
    openai_api_key: "",
    anthropic_api_key: "",
    gemini_api_key: "",
  });
  const [visibleKeys, setVisibleKeys] = useState<Record<string, boolean>>({});

  // YouTube connection state
  const yt = useYouTubeConnection();
  const deleteAccount = useDeleteAccount();
  const deleteKey = useDeleteApiKey();

  // Shared video quality pref (synced with in-player gear menu)
  const { quality: videoQuality, setQuality: persistQuality, ready: qualityReady } = useVideoQuality();

  // Local device settings (not in Supabase)
  const [qualityOpen, setQualityOpen] = useState(false);
  const [keepScreenOn, setKeepScreenOn] = useState(false);
  const [accordionOpen, setAccordionOpen] = useState(false);
  const accordionAnim = useRef(new Animated.Value(0)).current;

  // ── Helper: key status from safe view ──────────────────────────

  const keySaved = (def: KeyDef): boolean => {
    const row = safeSettings.data;
    if (!row) return false;
    const flagMap: Record<string, boolean | undefined> = {
      youtube_api_key: row.has_youtube_key,
      openai_api_key: row.has_openai_key,
      anthropic_api_key: row.has_anthropic_key,
      gemini_api_key: row.has_gemini_key,
    };
    return flagMap[def.key] ?? false;
  };

  const keyMasked = (def: KeyDef): string | null => {
    const row = safeSettings.data;
    if (!row) return null;
    const maskMap: Record<string, string | null | undefined> = {
      youtube_api_key: row.youtube_api_key_masked,
      openai_api_key: row.openai_api_key_masked,
      anthropic_api_key: row.anthropic_api_key_masked,
      gemini_api_key: row.gemini_api_key_masked,
    };
    return maskMap[def.key] ?? null;
  };

  // ── Load Supabase settings (email + metadata only — NEVER keys) ─

  useEffect(() => {
    if (settings.data) {
      setDefaultEmail(settings.data.default_email ?? "");
    }
    // Keys are intentionally NEVER pre-filled — the DB revokes SELECT
    // on the key columns, and the hook doesn't request them.
  }, [settings.data]);

  // ── Load local device settings ─────────────────────────────────

  useEffect(() => {
    AsyncStorage.getItem("@settings/keep_screen_on").then((v) => {
      setKeepScreenOn(v === "true");
    });
  }, []);

  // ── Accordion animation ────────────────────────────────────────

  const toggleAccordion = useCallback(() => {
    const next = !accordionOpen;
    setAccordionOpen(next);
    Animated.timing(accordionAnim, {
      toValue: next ? 1 : 0,
      duration: 220,
      useNativeDriver: false,
    }).start();
  }, [accordionOpen, accordionAnim]);

  const accordionHeight = accordionAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 140],
  });
  const chevronRotate = accordionAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "180deg"],
  });

  // ── Keep-screen-on toggle ──────────────────────────────────────

  const handleKeepScreenOn = useCallback(
    async (val: boolean) => {
      setKeepScreenOn(val);
      await AsyncStorage.setItem("@settings/keep_screen_on", String(val));
      try {
        if (val) {
          await activateKeepAwakeAsync();
        } else {
          deactivateKeepAwake();
        }
      } catch {
        // Keep-awake may fail silently on certain devices
      }
    },
    [],
  );

  // ── Quality picker ─────────────────────────────────────────────

  const handleQualitySelect = useCallback(
    async (q: string) => {
      setQualityOpen(false);
      await persistQuality(q as (typeof QUALITY_KEYS)[number]);
    },
    [persistQuality],
  );

  // ── Open link handler ─────────────────────────────────────────

  const handleOpenLink = useCallback(
    async (url: string) => {
      try {
        await openExternalLink(url);
      } catch {
        showToast("Couldn't open link", "error");
      }
    },
    [showToast],
  );

  // ── Save handler ───────────────────────────────────────────────

  const handleSave = useCallback(async () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    // Validate email
    const email = defaultEmail.trim();
    if (email && !isValidEmail(email)) {
      showToast("Please enter a valid email address.", "error");
      return;
    }

    // Validate keys
    for (const def of KEY_DEFS) {
      const val = (keys[def.key] ?? "").trim();
      if (!val) continue;
      if (hasBadChars(val)) {
        showToast(`${def.label} contains invalid characters.`, "error");
        return;
      }
      if (val.length < 10) {
        showToast(`${def.label} is too short (minimum 10 characters).`, "error");
        return;
      }
      if (val.length > def.maxLen) {
        showToast(`${def.label} is too long (maximum ${def.maxLen} characters).`, "error");
        return;
      }
    }

    // Build payload — skip empty key fields entirely so they don't
    // overwrite existing stored keys with blanks.
    const payload: Record<string, string | null> = {
      default_email: email || null,
    };

    for (const def of KEY_DEFS) {
      const val = (keys[def.key] ?? "").trim();
      if (val) {
        payload[def.key] = val;
      }
      // empty → omitted (write-only security model)
    }

    try {
      await updateSettings.mutateAsync(payload as any);
      showToast("Settings saved.", "success");
      // Clear key inputs so they aren't accidentally re-submitted
      setKeys({
        youtube_api_key: "",
        openai_api_key: "",
        anthropic_api_key: "",
        gemini_api_key: "",
      });
      setVisibleKeys({});
    } catch (err: any) {
      showToast(
        err?.message ?? "Failed to save settings. Please try again.",
        "error",
      );
    }
  }, [defaultEmail, keys, updateSettings, showToast]);

  // ── Render ─────────────────────────────────────────────────────

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        contentContainerStyle={[styles.content, isWide && styles.contentWide, { paddingTop: insets.top + 16 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.heading}>Settings</Text>

        {/* ── Profile card ──────────────────────────────── */}
        <View style={styles.profileCard}>
          <View style={styles.avatar}>
            <User size={22} color={Colors.accent} />
          </View>
          <View style={styles.profileInfo}>
            <Text style={styles.profileLabel}>Signed in as</Text>
            <Text style={styles.profileEmail} numberOfLines={1}>
              {user?.email ?? "—"}
            </Text>
          </View>
        </View>

        {/* ── YouTube Connection ──────────────────────── */}
        {yt.status !== "loading" && (
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <View style={styles.youtubeBadge}>
                <Text style={styles.youtubeBadgeText}>YT</Text>
              </View>
              <Text style={styles.cardTitle}>YouTube</Text>
            </View>
            {yt.status === "connected" ? (
              <>
                <Text style={styles.cardDesc}>
                  Connected as{" "}
                  <Text style={styles.connectedName}>
                    {yt.channelName ?? "YouTube channel"}
                  </Text>
                </Text>
                <Text style={styles.helperText}>
                  Your video actions (Watched, Liked, Watch Later) will sync to
                  your YouTube account.
                </Text>
                <Pressable
                  style={({ pressed }) => [
                    styles.youtubeDisconnectBtn,
                    pressed && styles.pressed,
                  ]}
                  onPress={() => yt.disconnect()}
                >
                  <Unlink size={15} color={Colors.destructive} />
                  <Text style={styles.youtubeDisconnectText}>Disconnect</Text>
                </Pressable>
              </>
            ) : (
              <>
                <Text style={styles.cardDesc}>
                  Connect your YouTube account to sync playlists, history, and
                  video actions.
                </Text>
                {yt.error ? (
                  <Text style={styles.errorText}>{yt.error}</Text>
                ) : null}
                <Pressable
                  style={({ pressed }) => [
                    styles.youtubeConnectBtn,
                    pressed && styles.youtubeConnectPressed,
                  ]}
                  onPress={() => yt.connect()}
                >
                  <Link2 size={15} color={Colors.white} />
                  <Text style={styles.youtubeConnectText}>
                    Connect YouTube
                  </Text>
                </Pressable>
                <Text style={styles.helperText}>
                  Sync playlists &amp; history
                </Text>
              </>
            )}
          </View>
        )}

        {settings.isLoading ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator color={Colors.accent} />
          </View>
        ) : (
          <>
            {/* ═══ Card 1: API Keys ═══ */}
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <KeyRound size={18} color={Colors.accent} />
                <Text style={styles.cardTitle}>API Keys</Text>
              </View>
              <Text style={styles.cardDesc}>
                Configure your API keys for YouTube data and AI providers. Keys are stored securely.
              </Text>

              {KEY_DEFS.map((def) => {
                const saved = keySaved(def);
                const masked = keyMasked(def);
                return (
                <View key={def.key} style={styles.fieldGroup}>
                  <View style={styles.fieldLabelRow}>
                    <Text style={styles.fieldLabel}>{def.label}</Text>
                    {saved && (
                      <>
                        <View style={styles.keySavedBadge}>
                          <Text style={styles.keySavedBadgeText}>Saved</Text>
                        </View>
                        <Pressable
                          style={({ pressed }) => [
                            styles.keyDeleteBtn,
                            pressed && styles.keyDeleteBtnPressed,
                            deleteKey.isPending && styles.disabled,
                          ]}
                          onPress={() => {
                            void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                            Alert.alert(
                              `Delete ${def.label}?`,
                              "This will remove the saved key. You can enter a new one at any time.",
                              [
                                { text: "Cancel", style: "cancel" },
                                {
                                  text: "Delete",
                                  style: "destructive",
                                  onPress: async () => {
                                    try {
                                      await deleteKey.mutateAsync(def.key);
                                      showToast(`${def.label} removed.`, "success");
                                    } catch (err: any) {
                                      showToast(
                                        err?.message ?? "Failed to delete key.",
                                        "error",
                                      );
                                    }
                                  },
                                },
                              ],
                            );
                          }}
                          hitSlop={6}
                        >
                          <Trash2 size={13} color={Colors.destructive} />
                        </Pressable>
                      </>
                    )}
                  </View>
                  {masked && (
                    <Text style={styles.keyMaskedText} numberOfLines={1}>
                      {masked}
                    </Text>
                  )}
                  <View style={styles.inputRow}>
                    <TextInput
                      style={styles.input}
                      value={keys[def.key] ?? ""}
                      onChangeText={(v) =>
                        setKeys((prev) => ({ ...prev, [def.key]: v }))
                      }
                      placeholder={
                        saved
                          ? "Saved — enter a new key to replace"
                          : "Enter your key"
                      }
                      placeholderTextColor={Colors.textMuted}
                      autoCapitalize="none"
                      autoCorrect={false}
                      secureTextEntry={!visibleKeys[def.key]}
                    />
                    <Pressable
                      style={styles.eyeBtn}
                      onPress={() =>
                        setVisibleKeys((prev) => ({
                          ...prev,
                          [def.key]: !prev[def.key],
                        }))
                      }
                      hitSlop={8}
                    >
                      {visibleKeys[def.key] ? (
                        <EyeOff size={18} color={Colors.textSecondary} />
                      ) : (
                        <Eye size={18} color={Colors.textSecondary} />
                      )}
                    </Pressable>
                  </View>
                  <Pressable
                    onPress={() => handleOpenLink(def.linkUrl)}
                    style={styles.helperLink}
                  >
                    <Text style={styles.helperLinkText}>Get your key ↗</Text>
                  </Pressable>
                  <Text style={styles.helperText}>{def.helper}</Text>
                </View>
                );
              })}
            </View>

            {/* ═══ Card 2: Default Email ═══ */}
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <Mail size={18} color={Colors.accent} />
                <Text style={styles.cardTitle}>Default Email</Text>
              </View>
              <Text style={styles.cardDesc}>
                Pre-filled when adding email recipients to new agents.
              </Text>
              <TextInput
                style={styles.input}
                value={defaultEmail}
                onChangeText={setDefaultEmail}
                placeholder="your@email.com"
                placeholderTextColor={Colors.textMuted}
                autoCapitalize="none"
                keyboardType="email-address"
                autoCorrect={false}
              />
            </View>

            {/* ═══ Card 3: Video Playback ═══ */}
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <Monitor size={18} color={Colors.accent} />
                <Text style={styles.cardTitle}>Video Playback</Text>
              </View>
              <Text style={styles.cardDesc}>
                Configure default video playback settings.
              </Text>

              {/* Quality dropdown */}
              <Text style={styles.fieldLabel}>Default Video Quality</Text>
              <Pressable
                style={styles.dropdown}
                onPress={() => setQualityOpen((o) => !o)}
              >
                <Text style={styles.dropdownText}>{QUALITY_LABELS[videoQuality] ?? videoQuality}</Text>
                <ChevronDown
                  size={16}
                  color={Colors.textSecondary}
                  style={{
                    transform: [{ rotate: qualityOpen ? "180deg" : "0deg" }],
                  }}
                />
              </Pressable>
              {!qualityReady ? (
                <View style={styles.loadingQuality}>
                  <ActivityIndicator size="small" color={Colors.accent} />
                </View>
              ) : null}
              {qualityOpen && (
                <View style={styles.dropdownMenu}>
                  {QUALITY_KEYS.map((q) => (
                    <Pressable
                      key={q}
                      style={[
                        styles.dropdownItem,
                        q === videoQuality && styles.dropdownItemActive,
                      ]}
                      onPress={() => handleQualitySelect(q)}
                    >
                      <Text
                        style={[
                          styles.dropdownItemText,
                          q === videoQuality && styles.dropdownItemTextActive,
                        ]}
                      >
                        {QUALITY_LABELS[q]}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              )}
              <Text style={styles.helperText}>
                Videos will start playing at this quality when available. This setting is saved locally.
              </Text>

              {/* Keep screen on */}
              <View style={styles.switchRow}>
                <View style={styles.switchLabel}>
                  <Text style={styles.fieldLabel}>Keep screen on while playing</Text>
                  <Text style={styles.helperText}>
                    Prevents your device from auto-locking during video playback.
                  </Text>
                </View>
                <Switch
                  value={keepScreenOn}
                  onValueChange={handleKeepScreenOn}
                  trackColor={{
                    false: Colors.input,
                    true: Colors.accent,
                  }}
                  thumbColor={keepScreenOn ? Colors.white : Colors.textSecondary}
                />
              </View>
            </View>

            {/* ═══ Card 4: About background playback (accordion) ═══ */}
            <Pressable style={styles.card} onPress={toggleAccordion}>
              <View style={styles.accordionHeader}>
                <Text style={styles.accordionTitle}>About background playback</Text>
                <Animated.View
                  style={{ transform: [{ rotate: chevronRotate }] }}
                >
                  <ChevronDown size={18} color={Colors.textSecondary} />
                </Animated.View>
              </View>
              <Animated.View
                style={[styles.accordionBody, { maxHeight: accordionHeight }]}
              >
                <Text style={styles.accordionText}>
                  Embedded YouTube videos automatically pause when your screen locks
                  or the app moves to the background. This is expected behavior on iOS —
                  both the operating system and the official YouTube embedded player
                  enforce this to preserve battery and comply with platform policies.
                  It is not a bug in the app.
                </Text>
              </Animated.View>
            </Pressable>

            {/* ═══ Card 5: Danger Zone ═══ */}
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <Trash2 size={18} color={Colors.destructive} />
                <Text style={[styles.cardTitle, { color: Colors.destructive }]}>
                  Danger Zone
                </Text>
              </View>
              <Text style={styles.cardDesc}>
                Permanently delete your account and all associated data. This action cannot be undone.
              </Text>
              <Pressable
                style={({ pressed }) => [
                  styles.deleteAccountBtn,
                  pressed && { opacity: 0.85, transform: [{ scale: 0.99 }] },
                  deleteAccount.isPending && styles.disabled,
                ]}
                onPress={() => {
                  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
                  Alert.alert(
                    "Delete Account?",
                    "This will permanently delete your account and all your data, including your agents, feeds, watch history, and saved settings. This cannot be undone.",
                    [
                      { text: "Cancel", style: "cancel" },
                      {
                        text: "Delete",
                        style: "destructive",
                        onPress: async () => {
                          try {
                            const result = await deleteAccount.mutateAsync();

                            if (result.method === "edge_function") {
                              showToast("Your account has been deleted.", "success");
                              await signOut();
                            } else {
                              // Client-fallback cleanup succeeded
                              showToast("Your account data has been deleted.", "success");
                              await signOut();
                              try {
                                await Linking.openURL(
                                  "mailto:support@travelone.ca?subject=Account%20Deletion%20Request&body=Please%20permanently%20delete%20my%20account%20login.%20My%20data%20has%20already%20been%20removed%20from%20within%20the%20app.",
                                );
                              } catch {
                                // mailto may not be supported
                              }
                            }
                          } catch {
                            showToast(
                              "Failed to delete account. Please try again or contact support@travelone.ca.",
                              "error",
                            );
                          }
                        },
                      },
                    ],
                  );
                }}
                disabled={deleteAccount.isPending}
              >
                {deleteAccount.isPending ? (
                  <ActivityIndicator size="small" color={Colors.destructive} />
                ) : (
                  <>
                    <Trash2 size={16} color={Colors.destructive} />
                    <Text style={styles.deleteAccountText}>Delete Account</Text>
                  </>
                )}
              </Pressable>
            </View>

            {/* ═══ Card 6: Support ═══ */}
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <CircleHelp size={18} color={Colors.accent} />
                <Text style={styles.cardTitle}>Support</Text>
              </View>

              <Pressable
                style={({ pressed }) => [
                  styles.supportRow,
                  pressed && styles.pressed,
                ]}
                onPress={() => router.push("/support/faq")}
              >
                <View style={styles.supportRowLeft}>
                  <CircleHelp size={18} color={Colors.textSecondary} />
                  <Text style={styles.supportRowLabel}>FAQ</Text>
                </View>
                <ChevronRight size={18} color={Colors.textMuted} />
              </Pressable>

              <View style={styles.supportDivider} />

              <Pressable
                style={({ pressed }) => [
                  styles.supportRow,
                  pressed && styles.pressed,
                ]}
                onPress={() => router.push("/support/privacy")}
              >
                <View style={styles.supportRowLeft}>
                  <ShieldCheck size={18} color={Colors.textSecondary} />
                  <Text style={styles.supportRowLabel}>Privacy Policy</Text>
                </View>
                <ChevronRight size={18} color={Colors.textMuted} />
              </Pressable>

              <View style={styles.supportDivider} />

              <Pressable
                style={({ pressed }) => [
                  styles.supportRow,
                  pressed && styles.pressed,
                ]}
                onPress={() => router.push("/support/terms")}
              >
                <View style={styles.supportRowLeft}>
                  <FileText size={18} color={Colors.textSecondary} />
                  <Text style={styles.supportRowLabel}>Terms of Service</Text>
                </View>
                <ChevronRight size={18} color={Colors.textMuted} />
              </Pressable>

              <View style={styles.supportDivider} />

              <Pressable
                style={({ pressed }) => [
                  styles.supportRow,
                  pressed && styles.pressed,
                ]}
                onPress={() => Linking.openURL("mailto:support@travelone.ca")}
              >
                <View style={styles.supportRowLeft}>
                  <MessageSquare size={18} color={Colors.textSecondary} />
                  <Text style={styles.supportRowLabel}>Contact Support</Text>
                </View>
                <ChevronRight size={18} color={Colors.textMuted} />
              </Pressable>
            </View>

            {/* ═══ Save button ═══ */}
            <Pressable
              style={({ pressed }) => [
                styles.saveBtn,
                pressed && styles.pressed,
                updateSettings.isPending && styles.disabled,
              ]}
              onPress={handleSave}
              disabled={updateSettings.isPending}
            >
              <LinearGradient
                colors={Colors.accentGradient as unknown as readonly [string, string, ...string[]]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={StyleSheet.absoluteFill}
              />
              {updateSettings.isPending ? (
                <ActivityIndicator size="small" color={Colors.white} />
              ) : (
                <View style={styles.saveInner}>
                  <Save size={17} color={Colors.white} />
                  <Text style={styles.saveText}>Save</Text>
                </View>
              )}
            </Pressable>
          </>
        )}

        {/* ── Sign out ───────────────────────────────── */}
        <Pressable
          style={({ pressed }) => [styles.signOutBtn, pressed && styles.pressed]}
          onPress={() => {
            void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            void signOut();
          }}
        >
          <LogOut size={16} color={Colors.destructive} />
          <Text style={styles.signOutText}>Sign out</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ── Styles ────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background },
  content: { paddingHorizontal: 16, paddingBottom: 40 },
  contentWide: { maxWidth: 720, alignSelf: "center", width: "100%" },
  heading: {
    fontSize: 26,
    fontWeight: "800" as const,
    color: Colors.textPrimary,
    marginBottom: 20,
  },

  // Profile
  profileCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    backgroundColor: Colors.card,
    borderRadius: 12,
    padding: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
    marginBottom: 20,
  },
  avatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: "hsl(199, 40%, 14%)",
    alignItems: "center",
    justifyContent: "center",
  },
  profileInfo: { flex: 1 },
  profileLabel: {
    fontSize: 11,
    color: Colors.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  profileEmail: {
    fontSize: 16,
    fontWeight: "700" as const,
    color: Colors.textPrimary,
    marginTop: 2,
  },
  loadingBox: { paddingVertical: 50, alignItems: "center" },

  // Cards
  card: {
    backgroundColor: Colors.card,
    borderRadius: 12,
    padding: 18,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
    marginBottom: 14,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 8,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: "700" as const,
    color: Colors.textPrimary,
  },
  cardDesc: {
    fontSize: 12,
    color: Colors.textMuted,
    lineHeight: 17,
    marginBottom: 16,
  },

  // Fields
  fieldGroup: { marginBottom: 16 },
  fieldLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: "600" as const,
    color: Colors.textSecondary,
    marginBottom: 7,
  },
  keySavedBadge: {
    backgroundColor: "hsla(142, 71%, 45%, 0.18)",
    borderRadius: 5,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  keySavedBadgeText: {
    fontSize: 10,
    fontWeight: "700" as const,
    color: Colors.success,
  },
  keyDeleteBtn: {
    width: 26,
    height: 26,
    borderRadius: 5,
    backgroundColor: "hsla(0, 72%, 51%, 0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  keyDeleteBtnPressed: {
    opacity: 0.7,
    backgroundColor: "hsla(0, 72%, 51%, 0.22)",
  },
  keyMaskedText: {
    fontSize: 11,
    color: Colors.textMuted,
    marginBottom: 8,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
  input: {
    backgroundColor: Colors.input,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: Colors.textPrimary,
  },
  inputRow: {
    position: "relative",
  },
  eyeBtn: {
    position: "absolute",
    right: 12,
    top: 0,
    bottom: 0,
    justifyContent: "center",
  },
  helperLink: {
    marginTop: 6,
    marginBottom: 2,
  },
  helperLinkText: {
    fontSize: 12,
    fontWeight: "600" as const,
    color: Colors.accent,
  },
  helperText: {
    fontSize: 11,
    color: Colors.textMuted,
    lineHeight: 15,
  },

  // Dropdown (quality picker)
  dropdown: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: Colors.input,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 8,
  },
  dropdownText: {
    fontSize: 15,
    color: Colors.textPrimary,
    fontWeight: "500" as const,
  },
  dropdownMenu: {
    backgroundColor: Colors.input,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: 10,
    overflow: "hidden",
  },
  dropdownItem: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
  },
  dropdownItemActive: {
    backgroundColor: "hsla(199, 89%, 48%, 0.15)",
  },
  dropdownItemText: {
    fontSize: 15,
    color: Colors.textPrimary,
  },
  dropdownItemTextActive: {
    color: Colors.white,
    fontWeight: "600" as const,
  },
  loadingQuality: {
    paddingVertical: 8,
    alignItems: "center",
  },

  // Switch row
  switchRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
    marginTop: 14,
  },
  switchLabel: {
    flex: 1,
  },

  // Accordion
  accordionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  accordionTitle: {
    fontSize: 16,
    fontWeight: "700" as const,
    color: Colors.textPrimary,
  },
  accordionBody: {
    overflow: "hidden",
  },
  accordionText: {
    fontSize: 13,
    color: Colors.textSecondary,
    lineHeight: 19,
    paddingTop: 12,
  },

  // Save
  saveBtn: {
    height: 48,
    borderRadius: 10,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 6,
  },
  saveInner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  saveText: {
    color: Colors.white,
    fontSize: 16,
    fontWeight: "700" as const,
  },
  pressed: { opacity: 0.85, transform: [{ scale: 0.99 }] },
  disabled: { opacity: 0.7 },

  // Sign out
  // YouTube connection
  youtubeBadge: {
    width: 28,
    height: 28,
    borderRadius: 6,
    backgroundColor: "hsl(0, 72%, 51%)",
    alignItems: "center",
    justifyContent: "center",
  },
  youtubeBadgeText: {
    fontSize: 12,
    fontWeight: "800" as const,
    color: Colors.white,
  },
  youtubeConnectBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    height: 44,
    borderRadius: 10,
    backgroundColor: Colors.success,
    marginBottom: 10,
  },
  youtubeConnectText: {
    color: Colors.white,
    fontSize: 15,
    fontWeight: "700" as const,
  },
  youtubeConnectPressed: {
    opacity: 0.9,
    backgroundColor: "hsl(142, 71%, 35%)",
  },
  youtubeDisconnectBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    height: 44,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.destructive,
    marginTop: 4,
  },
  youtubeDisconnectText: {
    color: Colors.destructive,
    fontSize: 15,
    fontWeight: "700" as const,
  },
  connectedName: {
    color: Colors.accent,
    fontWeight: "600" as const,
  },
  errorText: {
    fontSize: 12,
    color: Colors.destructive,
    marginBottom: 10,
  },

  // Support card
  supportRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 14,
  },
  supportRowLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  supportRowLabel: {
    fontSize: 15,
    fontWeight: "600" as const,
    color: Colors.textPrimary,
  },
  supportDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: Colors.border,
  },

  // Danger Zone
  deleteAccountBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    height: 44,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.destructive,
  },
  deleteAccountText: {
    color: Colors.destructive,
    fontSize: 15,
    fontWeight: "700" as const,
  },

  signOutBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    height: 48,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.destructive,
    marginTop: 28,
  },
  signOutText: {
    color: Colors.destructive,
    fontSize: 15,
    fontWeight: "700" as const,
  },
});
