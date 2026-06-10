// Typed models for the shared Supabase schema.
// These tables already exist (created by the web app) — never recreate or alter them.

export type ItemStatus = "not_watched" | "watched" | "liked" | "watch_later";
export type ChannelStatus = "not_watched" | "watched" | "liked" | "watch_later";
export type AiProvider = "lovable" | "openai" | "anthropic" | "gemini";
export type RunStatus = "running" | "success" | "partial" | "failed" | "cancelled";

export interface Agent {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  schedule_frequency: string | null;
  run_time_local: string | null;
  timezone: string | null;
  lookback_hours: number | null;
  include_shorts: boolean | null;
  include_live: boolean | null;
  min_duration_minutes: number | null;
  ai_provider: AiProvider | null;
  freshness_weight: number | null;
  priority_weight: number | null;
  duration_weight: number | null;
  keyword_weight: number | null;
  keywords: string[] | null;
  created_at: string;
  updated_at: string | null;
}

export interface AgentRecipient {
  id: string;
  agent_id: string;
  email: string;
}

export interface Channel {
  id: string;
  agent_id: string;
  channel_url: string | null;
  channel_id: string | null;
  uploads_playlist_id: string | null;
  channel_name: string | null;
  channel_thumbnail: string | null;
  priority: number | null;
  is_enabled: boolean | null;
  user_status: ChannelStatus | null;
  last_scanned_at: string | null;
  created_at: string;
  updated_at: string | null;
}

export interface Run {
  id: string;
  agent_id: string;
  started_at: string | null;
  finished_at: string | null;
  status: RunStatus;
  videos_found_count: number | null;
  videos_new_count: number | null;
  videos_enriched_count: number | null;
  error_summary: string | null;
  channels_total: number | null;
  channels_scanned: number | null;
  current_channel_name: string | null;
}

export interface Item {
  id: string;
  agent_id: string;
  run_id: string | null;
  video_id: string | null;
  url: string | null;
  title: string | null;
  thumbnail_url: string | null;
  channel_name: string | null;
  channel_id: string | null;
  published_at: string | null;
  user_status: ItemStatus | null;
}

export interface ItemAnalysis {
  id: string;
  item_id: string;
  duration_seconds: number | null;
  definition: string | null;
  views_at_analysis: number | null;
  likes_at_analysis: number | null;
  comments_at_analysis: number | null;
  analyzed_at: string | null;
  short_summary: string | null;
  key_points: string[] | null;
  tags: string[] | null;
  ranking_score: number | null;
}

export interface RunAsset {
  id: string;
  run_id: string;
  hero_infographic_url: string | null;
  email_html_archive: string | null;
}

export interface UserSettings {
  user_id: string;
  youtube_api_key: string | null;
  openai_api_key: string | null;
  anthropic_api_key: string | null;
  gemini_api_key: string | null;
  default_email: string | null;
  default_video_quality: string | null;
  created_at: string | null;
  updated_at: string | null;
}

/** Read-only safe view of user_settings — key columns are masked.
 *  SELECT is not revoked on this view, so the client can safely
 *  read has_*_key flags and *_masked placeholders. */
export interface UserSettingsSafe {
  id: string;
  user_id: string;
  default_email: string | null;
  created_at: string | null;
  updated_at: string | null;
  has_youtube_key: boolean;
  youtube_api_key_masked: string | null;
  has_openai_key: boolean;
  openai_api_key_masked: string | null;
  has_anthropic_key: boolean;
  anthropic_api_key_masked: string | null;
  has_gemini_key: boolean;
  gemini_api_key_masked: string | null;
}

// An item joined with its analysis, as rendered in the feed.
export interface ItemWithAnalysis extends Item {
  item_analysis: ItemAnalysis[] | null;
}

// Per-agent accent color, cycled by index. Must match web app palette exactly.
export const AGENT_ACCENTS = [
  "hsl(199, 89%, 48%)", // blue
  "hsl(152, 69%, 50%)", // green
  "hsl(32, 95%, 55%)",  // orange
  "hsl(0, 72%, 55%)",   // red
  "hsl(199, 89%, 70%)", // light blue
  "hsl(280, 70%, 60%)", // purple
  "hsl(168, 70%, 50%)", // teal
  "hsl(30, 90%, 55%)",  // amber
] as const;

export function agentAccent(index: number): string {
  return AGENT_ACCENTS[index % AGENT_ACCENTS.length];
}

/** AI provider options matching the web app. */
export const AI_PROVIDERS = [
  { value: "lovable" as const, label: "Lovable" },
  { value: "openai" as const, label: "OpenAI" },
  { value: "anthropic" as const, label: "Anthropic" },
  { value: "gemini" as const, label: "Gemini" },
];

/** Timezone list for the schedule picker. */
export const TIMEZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Edmonton",
  "America/Los_Angeles",
  "America/Anchorage",
  "Pacific/Honolulu",
  "America/Toronto",
  "America/Vancouver",
  "America/Mexico_City",
  "America/Sao_Paulo",
  "America/Argentina/Buenos_Aires",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Madrid",
  "Europe/Rome",
  "Europe/Amsterdam",
  "Europe/Stockholm",
  "Europe/Moscow",
  "Europe/Istanbul",
  "Africa/Cairo",
  "Africa/Lagos",
  "Africa/Johannesburg",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Bangkok",
  "Asia/Singapore",
  "Asia/Shanghai",
  "Asia/Tokyo",
  "Asia/Seoul",
  "Australia/Sydney",
  "Australia/Melbourne",
  "Pacific/Auckland",
  "Pacific/Fiji",
] as const;
