import { useCallback, useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

// ── Canonical quality keys ──────────────────────────────────────────

export const QUALITY_KEYS = [
  "Auto",
  "1080p",
  "720p",
  "480p",
  "360p",
  "240p",
] as const;

export type QualityKey = (typeof QUALITY_KEYS)[number];

export const QUALITY_LABELS: Record<QualityKey, string> = {
  Auto: "Auto",
  "1080p": "1080p HD",
  "720p": "720p HD",
  "480p": "480p",
  "360p": "360p",
  "240p": "240p",
};

/** YouTube IFrame API quality values. */
export const QUALITY_YOUTUBE: Record<QualityKey, string> = {
  Auto: "default",
  "1080p": "hd1080",
  "720p": "hd720",
  "480p": "large",
  "360p": "medium",
  "240p": "small",
};

// ── Speed keys ──────────────────────────────────────────────────────

export const SPEED_KEYS = ["1", "1.25", "1.5", "1.75", "2"] as const;

export type SpeedKey = (typeof SPEED_KEYS)[number];

export const SPEED_LABELS: Record<SpeedKey, string> = {
  "1": "Normal (1\u00D7)",
  "1.25": "1.25\u00D7",
  "1.5": "1.5\u00D7",
  "1.75": "1.75\u00D7",
  "2": "2\u00D7",
};

// ── AsyncStorage keys ───────────────────────────────────────────────

const QUALITY_KEY = "@settings/video_quality";
const SPEED_KEY = "@settings/video_speed";

// ── Hook ────────────────────────────────────────────────────────────

/**
 * Shared hook for video quality and playback speed preferences.
 * Persisted to AsyncStorage so the Settings screen and the in-player
 * gear menu both read/write the same values.
 */
export function useVideoQuality() {
  const [quality, setQualityState] = useState<QualityKey>("Auto");
  const [speed, setSpeedState] = useState<SpeedKey>("2");
  const [ready, setReady] = useState(false);

  // Load persisted prefs on mount
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const [q, s] = await Promise.all([
        AsyncStorage.getItem(QUALITY_KEY),
        AsyncStorage.getItem(SPEED_KEY),
      ]);
      if (cancelled) return;
      if (q && (QUALITY_KEYS as readonly string[]).includes(q)) {
        setQualityState(q as QualityKey);
      }
      if (s && (SPEED_KEYS as readonly string[]).includes(s)) {
        setSpeedState(s as SpeedKey);
      }
      setReady(true);
    };
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const setQuality = useCallback(async (q: QualityKey) => {
    setQualityState(q);
    await AsyncStorage.setItem(QUALITY_KEY, q);
  }, []);

  const setSpeed = useCallback(async (s: SpeedKey) => {
    setSpeedState(s);
    await AsyncStorage.setItem(SPEED_KEY, s);
  }, []);

  return { quality, setQuality, speed, setSpeed, ready } as const;
}
