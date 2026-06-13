import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronUp,
  Plus,
  X,
} from "lucide-react-native";
import { Colors } from "@/constants/colors";
import {
  useAgent,
  useRecipients,
  useCreateAgent,
  useUpdateAgent,
  useUserSettings,
  useAddRecipient,
  useDeleteRecipient,
} from "@/lib/hooks";
import { AI_PROVIDERS, TIMEZONES, type AiProvider } from "@/lib/database";
import { useToast } from "@/components/Toast";
import type { Agent } from "@/lib/database";

// ─── helpers ────────────────────────────────────────────────────────

function validateEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// ─── time helpers ───────────────────────────────────────────────────

const HOURS = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, "0"));
const MINUTES = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, "0"));
const AMPM = ["AM", "PM"] as const;

function parseRunTime(time: string): { hour: string; minute: string; ampm: string } {
  const parts = time.split(":");
  const h = parseInt(parts[0] ?? "7", 10);
  const m = parseInt(parts[1] ?? "0", 10);
  const hour24 = Number.isNaN(h) ? 7 : h;
  const minute = Number.isNaN(m) ? 0 : m;
  const ampm = hour24 >= 12 ? "PM" : "AM";
  let hour12 = hour24 % 12;
  if (hour12 === 0) hour12 = 12;
  return {
    hour: String(hour12).padStart(2, "0"),
    minute: String(minute).padStart(2, "0"),
    ampm,
  };
}

function composeRunTime(hour: string, minute: string, ampm: string): string {
  let h = parseInt(hour, 10);
  if (Number.isNaN(h)) h = 7;
  const m = parseInt(minute, 10);
  const minuteVal = Number.isNaN(m) ? 0 : m;
  if (ampm === "PM" && h !== 12) h += 12;
  if (ampm === "AM" && h === 12) h = 0;
  return `${String(h).padStart(2, "0")}:${String(minuteVal).padStart(2, "0")}`;
}

// ─── main screen ────────────────────────────────────────────────────

const IPAD_BREAKPOINT = 768;

export default function AgentFormScreen() {
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const isWide = windowWidth >= IPAD_BREAKPOINT;
  const router = useRouter();
  const showToast = useToast();
  const { agentId } = useLocalSearchParams<{ agentId?: string }>();
  const isEdit = !!agentId;

  // existing data (edit mode)
  const agentQ = useAgent(agentId ?? null);
  const recipientsQ = useRecipients(agentId ?? null);
  const settingsQ = useUserSettings();

  // mutations
  const createAgent = useCreateAgent();
  const updateAgent = useUpdateAgent();
  const addRecipient = useAddRecipient(agentId ?? ""); // for create, we'll insert after
  const deleteRecipient = useDeleteRecipient();

  const agent = agentQ.data;
  const existingRecipients = recipientsQ.data ?? [];

  // ── form state ────────────────────────────────────────────────────
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [runTime, setRunTime] = useState("07:00");
  const [timezone, setTimezone] = useState("America/Edmonton");
  const [lookbackHours, setLookbackHours] = useState("36");
  const [aiProvider, setAiProvider] = useState<AiProvider>("lovable");
  const [includeShorts, setIncludeShorts] = useState(false);
  const [includeLive, setIncludeLive] = useState(false);
  const [minDuration, setMinDuration] = useState(3);
  const [freshnessWeight, setFreshnessWeight] = useState(1.0);
  const [priorityWeight, setPriorityWeight] = useState(1.0);
  const [durationWeight, setDurationWeight] = useState(1.0);
  const [keywordWeight, setKeywordWeight] = useState(0.5);
  const [keywords, setKeywords] = useState<string[]>([]);
  const [recipients, setRecipients] = useState<string[]>([]);

  const [keywordInput, setKeywordInput] = useState("");
  const [recipientInput, setRecipientInput] = useState("");
  const [saving, setSaving] = useState(false);

  // dropdowns
  const [tzOpen, setTzOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);

  // derived time parts for the three dropdowns
  const { hour: runHour, minute: runMinute, ampm: runAmPm } = useMemo(
    () => parseRunTime(runTime),
    [runTime],
  );

  const handleTimePartChange = useCallback(
    (part: "hour" | "minute" | "ampm", value: string) => {
      if (part === "hour") {
        setRunTime(composeRunTime(value, runMinute, runAmPm));
      } else if (part === "minute") {
        setRunTime(composeRunTime(runHour, value, runAmPm));
      } else {
        setRunTime(composeRunTime(runHour, runMinute, value));
      }
    },
    [runHour, runMinute, runAmPm],
  );

  // saved existing recipient ids for delete diff
  const existingRecipientMapRef = useRef<Map<string, string>>(new Map());

  // ── populate edit data ───────────────────────────────────────────
  const populatedRef = useRef(false);
  useEffect(() => {
    if (populatedRef.current) return;
    if (!isEdit) {
      // create mode — pre-fill default email from settings if present
      if (settingsQ.data?.default_email && recipients.length === 0) {
        const email = settingsQ.data.default_email.trim();
        if (email && validateEmail(email)) {
          setRecipients([email]);
        }
      }
      populatedRef.current = true;
      return;
    }
    if (!agent || recipientsQ.isLoading) return;
    setName(agent.name ?? "");
    setDescription(agent.description ?? "");
    setRunTime(agent.run_time_local ?? "07:00");
    setTimezone(agent.timezone ?? "America/Edmonton");
    setLookbackHours(String(agent.lookback_hours ?? 36));
    setAiProvider((agent.ai_provider as AiProvider) ?? "lovable");
    setIncludeShorts(agent.include_shorts ?? false);
    setIncludeLive(agent.include_live ?? false);
    setMinDuration(agent.min_duration_minutes ?? 3);
    setFreshnessWeight(agent.freshness_weight ?? 1.0);
    setPriorityWeight(agent.priority_weight ?? 1.0);
    setDurationWeight(agent.duration_weight ?? 1.0);
    setKeywordWeight(agent.keyword_weight ?? 0.5);
    setKeywords(agent.keywords ?? []);

    const existingEmails = existingRecipients.map((r) => r.email);
    setRecipients(existingEmails);
    const map = new Map<string, string>();
    for (const r of existingRecipients) {
      map.set(r.email, r.id);
    }
    existingRecipientMapRef.current = map;
    populatedRef.current = true;
  }, [agent, existingRecipients, recipientsQ.isLoading, isEdit, settingsQ.data]);

  // ── save ──────────────────────────────────────────────────────────

  const canSave = name.trim().length > 0 && name.trim().length <= 100 && !saving;

  const handleSave = useCallback(async () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      showToast("Agent name is required", "error");
      return;
    }
    if (trimmedName.length > 100) {
      showToast("Name must be 100 characters or fewer", "error");
      return;
    }
    const desc = description.trim();
    if (desc.length > 500) {
      showToast("Description must be 500 characters or fewer", "error");
      return;
    }
    if (keywords.length > 20) {
      showToast("Maximum 20 keywords", "error");
      return;
    }

    setSaving(true);
    Keyboard.dismiss();

    try {
      const payload = {
        name: trimmedName,
        description: desc || null,
        schedule_frequency: "daily",
        run_time_local: runTime,
        timezone,
        lookback_hours: Number(lookbackHours) || 36,
        ai_provider: aiProvider,
        include_shorts: includeShorts,
        include_live: includeLive,
        min_duration_minutes: minDuration,
        freshness_weight: freshnessWeight,
        priority_weight: priorityWeight,
        duration_weight: durationWeight,
        keyword_weight: keywordWeight,
        keywords: keywords.length > 0 ? keywords : null,
      };

      let savedAgent: Agent;

      if (isEdit && agentId) {
        const result = await updateAgent.mutateAsync({ id: agentId, ...payload });
        savedAgent = result as Agent;

        // diff recipients
        const newEmails = new Set(recipients.filter((e) => validateEmail(e)));
        const oldMap = existingRecipientMapRef.current;

        // delete removed
        for (const [email, id] of oldMap) {
          if (!newEmails.has(email)) {
            await deleteRecipient.mutateAsync(id);
          }
        }
        // insert new (use the same addRecipient mutation but for the agent)
        for (const email of newEmails) {
          if (!oldMap.has(email)) {
            // need to add
            const { supabase } = require("@/lib/supabase");
            await supabase.from("agent_recipients").insert({
              agent_id: agentId,
              email,
            });
          }
        }

        showToast("Agent updated", "success");
      } else {
        savedAgent = await createAgent.mutateAsync(payload);

        // insert recipients for the new agent
        const validEmails = recipients.filter((e) => validateEmail(e));
        if (validEmails.length > 0) {
          const { supabase } = require("@/lib/supabase");
          const rows = validEmails.map((email) => ({
            agent_id: savedAgent.id,
            email,
          }));
          await supabase.from("agent_recipients").insert(rows);
        }

        showToast("Agent created", "success");
      }

      // navigate to agent detail
      router.replace({
        pathname: "/(tabs)/agent-detail",
        params: { agentId: savedAgent.id },
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Save failed";
      showToast(msg, "error");
    } finally {
      setSaving(false);
    }
  }, [
    name, description, runTime, timezone, lookbackHours, aiProvider,
    includeShorts, includeLive, minDuration, freshnessWeight, priorityWeight,
    durationWeight, keywordWeight, keywords, recipients, isEdit, agentId,
    createAgent, updateAgent, deleteRecipient, showToast, router,
  ]);

  // ── keyword helpers ──────────────────────────────────────────────
  const addKeyword = useCallback(() => {
    const kw = keywordInput.trim();
    if (!kw) return;
    if (kw.length > 50) {
      showToast("Keyword must be 50 characters or fewer", "error");
      return;
    }
    if (keywords.length >= 20) {
      showToast("Maximum 20 keywords", "error");
      return;
    }
    if (keywords.includes(kw)) {
      showToast("Keyword already added", "error");
      return;
    }
    setKeywords((prev) => [...prev, kw]);
    setKeywordInput("");
  }, [keywordInput, keywords, showToast]);

  const removeKeyword = useCallback((kw: string) => {
    setKeywords((prev) => prev.filter((k) => k !== kw));
  }, []);

  // ── recipient helpers ────────────────────────────────────────────
  const addRecipientEmail = useCallback(() => {
    const email = recipientInput.trim();
    if (!email) return;
    if (!validateEmail(email)) {
      showToast("Enter a valid email", "error");
      return;
    }
    if (recipients.includes(email)) {
      showToast("Recipient already added", "error");
      return;
    }
    setRecipients((prev) => [...prev, email]);
    setRecipientInput("");
  }, [recipientInput, recipients, showToast]);

  const removeRecipient = useCallback((email: string) => {
    setRecipients((prev) => prev.filter((e) => e !== email));
  }, []);

  // ── cancel ───────────────────────────────────────────────────────
  const handleCancel = useCallback(() => {
    if (isEdit && agentId) {
      router.replace({ pathname: "/(tabs)/agent-detail", params: { agentId } });
    } else {
      router.replace("/(tabs)");
    }
  }, [isEdit, agentId, router]);

  // ── loading state ────────────────────────────────────────────────
  const isLoading = isEdit && (agentQ.isLoading || recipientsQ.isLoading);

  if (isLoading) {
    return (
      <View style={[styles.root, styles.centered]}>
        <ActivityIndicator size="large" color={Colors.accent} />
      </View>
    );
  }

  if (isEdit && !agent) {
    return (
      <View style={[styles.root, styles.centered]}>
        <Text style={styles.errorText}>Agent not found</Text>
        <Pressable onPress={handleCancel} style={styles.backBtnInline}>
          <Text style={styles.backBtnText}>Go back</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.content,
          isWide && styles.contentWide,
          { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 40 },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* ── Header ──────────────────────────────────────────────── */}
        <View style={styles.header}>
          <Pressable onPress={handleCancel} hitSlop={8} style={styles.backBtn}>
            <ArrowLeft size={20} color={Colors.textSecondary} />
          </Pressable>
          <Text style={styles.heading}>
            {isEdit ? "Edit Agent" : "New Agent"}
          </Text>
          <View style={{ width: 36 }} />
        </View>

        {/* ── Basic Information ────────────────────────────────────── */}
        <FormSection title="Basic Information">
          <FormLabel required>Agent Name</FormLabel>
          <TextInput
            style={styles.input}
            placeholder="e.g., Crypto, AI, Power Apps"
            placeholderTextColor={Colors.textMuted}
            value={name}
            onChangeText={setName}
            maxLength={100}
            autoCapitalize="words"
            returnKeyType="next"
          />
          {name.trim().length > 0 && name.trim().length >= 95 ? (
            <Text style={styles.charCount}>{name.trim().length}/100</Text>
          ) : null}

          <FormLabel>Description</FormLabel>
          <TextInput
            style={[styles.input, styles.textarea]}
            placeholder="What topics does this agent cover?"
            placeholderTextColor={Colors.textMuted}
            value={description}
            onChangeText={setDescription}
            maxLength={500}
            multiline
            numberOfLines={3}
            textAlignVertical="top"
          />
          {description.length > 400 ? (
            <Text style={styles.charCount}>{description.length}/500</Text>
          ) : null}
        </FormSection>

        {/* ── Schedule ─────────────────────────────────────────────── */}
        <FormSection title='Schedule — "When should this agent run?"'>
          <View style={styles.row}>
            <View style={styles.halfField}>
              <FormLabel>Run Time</FormLabel>
              <View style={styles.timeRow}>
                <TimeSelect
                  value={runHour}
                  options={HOURS}
                  onSelect={(v) => handleTimePartChange("hour", v)}
                />
                <Text style={styles.timeSep}>:</Text>
                <TimeSelect
                  value={runMinute}
                  options={MINUTES}
                  onSelect={(v) => handleTimePartChange("minute", v)}
                />
                <TimeSelect
                  value={runAmPm}
                  options={AMPM}
                  onSelect={(v) => handleTimePartChange("ampm", v)}
                />
              </View>
            </View>
            <View style={styles.halfField}>
              <FormLabel>Lookback Hours</FormLabel>
              <TextInput
                style={styles.input}
                value={lookbackHours}
                onChangeText={(t) => {
                  const num = Number(t);
                  if (t === "" || (!Number.isNaN(num) && num >= 1 && num <= 168)) {
                    setLookbackHours(t);
                  }
                }}
                placeholder="36"
                placeholderTextColor={Colors.textMuted}
                keyboardType="number-pad"
                maxLength={3}
              />
            </View>
          </View>

          <FormLabel>Timezone</FormLabel>
          <Dropdown
            value={timezone}
            options={[...TIMEZONES]}
            open={tzOpen}
            onToggle={() => { setTzOpen((v) => !v); setAiOpen(false); }}
            onSelect={(v) => { setTimezone(v); setTzOpen(false); }}
          />
        </FormSection>

        {/* ── AI Provider ──────────────────────────────────────────── */}
        <FormSection title='AI Provider — "Which AI should generate video summaries?"'>
          <Dropdown
            value={aiProvider}
            options={AI_PROVIDERS.map((p) => p.value)}
            labels={Object.fromEntries(AI_PROVIDERS.map((p) => [p.value, p.label]))}
            open={aiOpen}
            onToggle={() => { setAiOpen((v) => !v); setTzOpen(false); }}
            onSelect={(v) => { setAiProvider(v as AiProvider); setAiOpen(false); }}
          />
        </FormSection>

        {/* ── Video Filters ────────────────────────────────────────── */}
        <FormSection title='Video Filters — "What types of videos should be included?"'>
          <ToggleRow
            label="Include Shorts"
            subtitle="Include YouTube Shorts in results"
            value={includeShorts}
            onToggle={setIncludeShorts}
          />
          <ToggleRow
            label="Include Live/Upcoming"
            subtitle="Include live streams and premieres"
            value={includeLive}
            onToggle={setIncludeLive}
          />
          <FormLabel>Minimum Duration: {minDuration} minutes</FormLabel>
          <CustomSlider
            min={0}
            max={30}
            step={1}
            value={minDuration}
            onValueChange={setMinDuration}
          />
        </FormSection>

        {/* ── Ranking Preferences ──────────────────────────────────── */}
        <FormSection title='Ranking Preferences — "Adjust how videos are ranked in the digest"'>
          <SliderField
            label="Freshness Weight"
            value={freshnessWeight}
            onValueChange={setFreshnessWeight}
          />
          <SliderField
            label="Channel Priority Weight"
            value={priorityWeight}
            onValueChange={setPriorityWeight}
          />
          <SliderField
            label="Duration Preference"
            value={durationWeight}
            onValueChange={setDurationWeight}
            helper="Boosts videos 8–25 minutes"
          />
          <SliderField
            label="Keyword Relevance"
            value={keywordWeight}
            onValueChange={setKeywordWeight}
          />
        </FormSection>

        {/* ── Keywords ─────────────────────────────────────────────── */}
        <FormSection title="Keywords">
          <View style={styles.chipInputRow}>
            <TextInput
              style={[styles.input, styles.flex1]}
              placeholder="Add a keyword…"
              placeholderTextColor={Colors.textMuted}
              value={keywordInput}
              onChangeText={setKeywordInput}
              maxLength={50}
              returnKeyType="done"
              onSubmitEditing={addKeyword}
            />
            <Pressable
              style={({ pressed }) => [
                styles.addBtn,
                { backgroundColor: Colors.accent },
                pressed && styles.btnPressed,
              ]}
              onPress={addKeyword}
            >
              <Plus size={18} color={Colors.white} />
            </Pressable>
          </View>
          {keywords.length > 0 ? (
            <View style={styles.chipContainer}>
              {keywords.map((kw) => (
                <Chip key={kw} label={kw} onRemove={() => removeKeyword(kw)} />
              ))}
            </View>
          ) : null}
        </FormSection>

        {/* ── Email Recipients ─────────────────────────────────────── */}
        <FormSection title='Email Recipients — "Who should receive the daily digest?"'>
          <View style={styles.chipInputRow}>
            <TextInput
              style={[styles.input, styles.flex1]}
              placeholder="email@example.com"
              placeholderTextColor={Colors.textMuted}
              value={recipientInput}
              onChangeText={setRecipientInput}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              returnKeyType="done"
              onSubmitEditing={addRecipientEmail}
            />
            <Pressable
              style={({ pressed }) => [
                styles.addBtn,
                { backgroundColor: Colors.accent },
                pressed && styles.btnPressed,
              ]}
              onPress={addRecipientEmail}
            >
              <Plus size={18} color={Colors.white} />
            </Pressable>
          </View>
          {recipients.length > 0 ? (
            <View style={styles.chipContainer}>
              {recipients.map((email) => (
                <Chip
                  key={email}
                  label={email}
                  onRemove={() => removeRecipient(email)}
                />
              ))}
            </View>
          ) : null}
        </FormSection>

        {/* ── Actions ──────────────────────────────────────────────── */}
        <View style={styles.actions}>
          <Pressable
            style={({ pressed }) => [
              styles.submitBtn,
              { backgroundColor: Colors.accent, opacity: canSave ? 1 : 0.5 },
              pressed && canSave && styles.btnPressed,
            ]}
            onPress={() => void handleSave()}
            disabled={!canSave}
          >
            {saving ? (
              <ActivityIndicator size="small" color={Colors.white} />
            ) : (
              <Text style={styles.submitText}>
                {isEdit ? "Save Changes" : "Create Agent"}
              </Text>
            )}
          </Pressable>
          <Pressable
            style={({ pressed }) => [
              styles.cancelBtn,
              pressed && styles.btnPressed,
            ]}
            onPress={handleCancel}
          >
            <Text style={styles.cancelText}>Cancel</Text>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────

function FormSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={sectionStyles.wrap}>
      <Text style={sectionStyles.title}>{title}</Text>
      <View style={sectionStyles.body}>{children}</View>
    </View>
  );
}

const sectionStyles = StyleSheet.create({
  wrap: { marginBottom: 24 },
  title: {
    fontSize: 11,
    fontWeight: "700" as const,
    color: Colors.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 10,
  },
  body: {
    backgroundColor: Colors.card,
    borderRadius: 10,
    padding: 16,
    borderWidth: 1,
    borderColor: "hsl(220, 25%, 18%)",
  },
});

function FormLabel({ required, children }: { required?: boolean; children: React.ReactNode }) {
  return (
    <Text style={labelStyles.base}>
      {children}
      {required ? <Text style={labelStyles.star}> *</Text> : null}
    </Text>
  );
}

const labelStyles = StyleSheet.create({
  base: {
    fontSize: 12,
    fontWeight: "600" as const,
    color: Colors.textSecondary,
    marginBottom: 6,
    marginTop: 12,
  },
  star: { color: Colors.destructive },
});

function ToggleRow({
  label,
  subtitle,
  value,
  onToggle,
}: {
  label: string;
  subtitle?: string;
  value: boolean;
  onToggle: (v: boolean) => void;
}) {
  return (
    <Pressable
      style={({ pressed }) => [
        toggleStyles.row,
        pressed && { opacity: 0.7 },
      ]}
      onPress={() => onToggle(!value)}
    >
      <View style={toggleStyles.textCol}>
        <Text style={toggleStyles.label}>{label}</Text>
        {subtitle ? <Text style={toggleStyles.sub}>{subtitle}</Text> : null}
      </View>
      <View
        style={[
          toggleStyles.track,
          value && { backgroundColor: Colors.accent },
        ]}
      >
        <View
          style={[
            toggleStyles.thumb,
            value && toggleStyles.thumbOn,
          ]}
        />
      </View>
    </Pressable>
  );
}

const toggleStyles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 10,
  },
  textCol: { flex: 1, marginRight: 14 },
  label: { fontSize: 14, fontWeight: "600" as const, color: Colors.textPrimary },
  sub: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  track: {
    width: 48,
    height: 28,
    borderRadius: 14,
    backgroundColor: Colors.input,
    borderWidth: 1,
    borderColor: Colors.border,
    justifyContent: "center",
    paddingHorizontal: 2,
  },
  thumb: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: Colors.textMuted,
    alignSelf: "flex-start",
  },
  thumbOn: {
    alignSelf: "flex-end",
    backgroundColor: Colors.white,
  },
});

function SliderField({
  label,
  value,
  onValueChange,
  helper,
}: {
  label: string;
  value: number;
  onValueChange: (v: number) => void;
  helper?: string;
}) {
  return (
    <View style={sliderFieldStyles.wrap}>
      <View style={sliderFieldStyles.labelRow}>
        <Text style={sliderFieldStyles.label}>{label}</Text>
        <Text style={sliderFieldStyles.value}>{value.toFixed(1)}</Text>
      </View>
      <CustomSlider
        min={0}
        max={2}
        step={0.1}
        value={value}
        onValueChange={onValueChange}
      />
      {helper ? <Text style={sliderFieldStyles.helper}>{helper}</Text> : null}
    </View>
  );
}

const sliderFieldStyles = StyleSheet.create({
  wrap: { marginTop: 14 },
  labelRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 6,
  },
  label: { fontSize: 13, color: Colors.textPrimary, fontWeight: "500" as const },
  value: {
    fontSize: 13,
    fontWeight: "700" as const,
    color: Colors.accent,
    minWidth: 32,
    textAlign: "right",
  },
  helper: { fontSize: 11, color: Colors.textMuted, marginTop: 4, fontStyle: "italic" },
});

// ─── Custom Slider ───────────────────────────────────────────────────

function CustomSlider({
  min,
  max,
  step,
  value,
  onValueChange,
}: {
  min: number;
  max: number;
  step: number;
  value: number;
  onValueChange: (v: number) => void;
}) {
  const trackRef = useRef<View>(null);
  const [trackWidth, setTrackWidth] = useState(0);

  const fraction = (value - min) / (max - min);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,

        onPanResponderGrant: (evt) => {
          updateFromTouch(evt.nativeEvent.locationX);
        },
        onPanResponderMove: (evt) => {
          updateFromTouch(evt.nativeEvent.locationX);
        },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [min, max, step, trackWidth, onValueChange],
  );

  const updateFromTouch = useCallback(
    (locationX: number) => {
      if (trackWidth <= 0) return;
      let pct = locationX / trackWidth;
      pct = Math.max(0, Math.min(1, pct));
      let raw = min + pct * (max - min);
      raw = Math.round(raw / step) * step;
      raw = Number(raw.toFixed(1));
      raw = Math.max(min, Math.min(max, raw));
      onValueChange(raw);
    },
    [min, max, step, trackWidth, onValueChange],
  );

  return (
    <View
      ref={trackRef}
      style={sliderStyles.track}
      onLayout={(e) => setTrackWidth(e.nativeEvent.layout.width)}
      {...panResponder.panHandlers}
    >
      <View
        style={[sliderStyles.fill, { width: `${fraction * 100}%` as unknown as number }]}
      />
      <View
        style={[
          sliderStyles.thumb,
          { left: `${fraction * 100}%` as unknown as number },
        ]}
      />
    </View>
  );
}

const sliderStyles = StyleSheet.create({
  track: {
    height: 32,
    justifyContent: "center",
    position: "relative",
  },
  fill: {
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.accent,
    position: "absolute",
    left: 0,
  },
  thumb: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: Colors.white,
    borderWidth: 2,
    borderColor: Colors.accent,
    position: "absolute",
    marginLeft: -10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
    elevation: 2,
  },
});

// ─── Dropdown ────────────────────────────────────────────────────────

function Dropdown({
  value,
  options,
  labels,
  open,
  onToggle,
  onSelect,
}: {
  value: string;
  options: readonly string[];
  labels?: Record<string, string>;
  open: boolean;
  onToggle: () => void;
  onSelect: (v: string) => void;
}) {
  const display = labels?.[value] ?? value;

  return (
    <View style={dropdownStyles.wrap}>
      <Pressable
        style={({ pressed }) => [
          dropdownStyles.trigger,
          pressed && { opacity: 0.8 },
        ]}
        onPress={onToggle}
      >
        <Text style={dropdownStyles.triggerText}>{display}</Text>
        {open ? (
          <ChevronUp size={16} color={Colors.textSecondary} />
        ) : (
          <ChevronDown size={16} color={Colors.textSecondary} />
        )}
      </Pressable>
      {open ? (
        <View style={dropdownStyles.menu}>
          <ScrollView style={dropdownStyles.menuScroll} nestedScrollEnabled showsVerticalScrollIndicator={false}>
            {options.map((opt) => {
              const label = labels?.[opt] ?? opt;
              const selected = opt === value;
              return (
                <Pressable
                  key={opt}
                  style={({ pressed }) => [
                    dropdownStyles.option,
                    selected && dropdownStyles.optionSelected,
                    pressed && { opacity: 0.7 },
                  ]}
                  onPress={() => onSelect(opt)}
                >
                  <Text
                    style={[
                      dropdownStyles.optionText,
                      selected && dropdownStyles.optionTextSelected,
                    ]}
                    numberOfLines={1}
                  >
                    {label}
                  </Text>
                  {selected ? (
                    <Check size={16} color={Colors.accent} />
                  ) : null}
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}

const dropdownStyles = StyleSheet.create({
  wrap: { marginTop: 6 },
  trigger: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: Colors.input,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  triggerText: { fontSize: 14, color: Colors.textPrimary, flex: 1 },
  menu: {
    marginTop: 4,
    backgroundColor: Colors.card,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    maxHeight: 220,
    overflow: "hidden",
  },
  menuScroll: { maxHeight: 218 },
  option: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
  },
  optionSelected: { backgroundColor: `${Colors.accent}15` },
  optionText: { fontSize: 14, color: Colors.textSecondary, flex: 1 },
  optionTextSelected: { color: Colors.accent, fontWeight: "600" as const },
});

// ─── Time Select ─────────────────────────────────────────────────────

function TimeSelect({
  value,
  options,
  onSelect,
}: {
  value: string;
  options: readonly string[];
  onSelect: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <View style={timeSelectStyles.wrap}>
      <Pressable
        style={({ pressed }) => [
          timeSelectStyles.trigger,
          pressed && { opacity: 0.8 },
        ]}
        onPress={() => setOpen((v) => !v)}
      >
        <Text style={timeSelectStyles.triggerText}>{value}</Text>
        {open ? (
          <ChevronUp size={12} color={Colors.textSecondary} />
        ) : (
          <ChevronDown size={12} color={Colors.textSecondary} />
        )}
      </Pressable>
      {open ? (
        <View style={timeSelectStyles.menu}>
          <ScrollView
            style={timeSelectStyles.menuScroll}
            nestedScrollEnabled
            showsVerticalScrollIndicator={false}
          >
            {options.map((opt) => {
              const selected = opt === value;
              return (
                <Pressable
                  key={opt}
                  style={({ pressed }) => [
                    timeSelectStyles.option,
                    selected && timeSelectStyles.optionSelected,
                    pressed && { opacity: 0.7 },
                  ]}
                  onPress={() => {
                    onSelect(opt);
                    setOpen(false);
                  }}
                >
                  <Text
                    style={[
                      timeSelectStyles.optionText,
                      selected && timeSelectStyles.optionTextSelected,
                    ]}
                  >
                    {opt}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}

const timeSelectStyles = StyleSheet.create({
  wrap: { position: "relative", flex: 1 },
  trigger: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: Colors.input,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 2,
  },
  triggerText: { fontSize: 13, color: Colors.textPrimary, fontWeight: "500" as const },
  menu: {
    position: "absolute",
    top: "100%",
    left: 0,
    right: 0,
    marginTop: 4,
    backgroundColor: Colors.card,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    maxHeight: 180,
    overflow: "hidden",
    zIndex: 100,
  },
  menuScroll: { maxHeight: 178 },
  option: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
    alignItems: "center" as const,
  },
  optionSelected: { backgroundColor: `${Colors.accent}15` },
  optionText: { fontSize: 13, color: Colors.textSecondary },
  optionTextSelected: { color: Colors.accent, fontWeight: "600" as const },
});

// ─── Chip ────────────────────────────────────────────────────────────

function Chip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <View style={chipStyles.chip}>
      <Text style={chipStyles.text} numberOfLines={1}>
        {label}
      </Text>
      <Pressable onPress={onRemove} hitSlop={8} style={chipStyles.xBtn}>
        <X size={12} color={Colors.textSecondary} />
      </Pressable>
    </View>
  );
}

const chipStyles = StyleSheet.create({
  chip: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.input,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    gap: 6,
    alignSelf: "flex-start",
  },
  text: {
    fontSize: 12,
    color: Colors.textPrimary,
    maxWidth: 200,
  },
  xBtn: { padding: 2 },
});

// ─── Main styles ─────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 16 },
  contentWide: { maxWidth: 720, alignSelf: "center", width: "100%" },
  centered: { alignItems: "center", justifyContent: "center" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 24,
  },
  backBtn: { padding: 4 },
  heading: { fontSize: 22, fontWeight: "800" as const, color: Colors.textPrimary },
  input: {
    backgroundColor: Colors.input,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: Colors.textPrimary,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  textarea: { minHeight: 80, paddingTop: 10 },
  charCount: {
    fontSize: 11,
    color: Colors.textMuted,
    textAlign: "right",
    marginTop: 4,
  },
  row: { flexDirection: "row", gap: 10 },
  halfField: { flex: 1 },
  timeRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  timeSep: { fontSize: 14, color: Colors.textSecondary, fontWeight: "600" as const, marginHorizontal: 2 },
  flex1: { flex: 1 },
  chipInputRow: {
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
  },
  chipContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 12,
  },
  addBtn: {
    width: 40,
    height: 40,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  btnPressed: { opacity: 0.8, transform: [{ scale: 0.97 }] },
  actions: { marginTop: 8, gap: 10 },
  submitBtn: {
    height: 48,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  submitText: { fontSize: 16, fontWeight: "700" as const, color: Colors.white },
  cancelBtn: {
    height: 44,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: Colors.border,
  },
  cancelText: { fontSize: 15, fontWeight: "600" as const, color: Colors.textSecondary },
  errorText: { fontSize: 16, color: Colors.textSecondary, marginBottom: 12 },
  backBtnInline: {
    marginTop: 12,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: Colors.card,
    borderRadius: 8,
  },
  backBtnText: { fontSize: 14, color: Colors.accent, fontWeight: "600" as const },
});
