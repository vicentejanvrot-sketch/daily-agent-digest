/** Relative time like "3h ago", "2d ago". */
export function timeAgo(iso: string | null): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const diff = Date.now() - then;
  const sec = Math.round(diff / 1000);
  if (sec < 60) return "just now";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 30) return `${day}d ago`;
  const mo = Math.round(day / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.round(mo / 12)}y ago`;
}

/** Human relative time like "about 3 hours ago". */
export function relativeTime(iso: string | null): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const diff = Date.now() - then;
  const sec = Math.round(diff / 1000);
  if (sec < 10) return "just now";
  if (sec < 60) return "less than a minute ago";
  const min = Math.round(sec / 60);
  if (min === 1) return "about 1 minute ago";
  if (min < 60) return `about ${min} minutes ago`;
  const hr = Math.round(min / 60);
  if (hr === 1) return "about 1 hour ago";
  if (hr < 24) return `about ${hr} hours ago`;
  const day = Math.round(hr / 24);
  if (day === 1) return "about 1 day ago";
  if (day < 30) return `about ${day} days ago`;
  const mo = Math.round(day / 30);
  if (mo === 1) return "about 1 month ago";
  if (mo < 12) return `about ${mo} months ago`;
  const yr = Math.round(mo / 12);
  return yr === 1 ? "about 1 year ago" : `about ${yr} years ago`;
}

/** Compact count like 1.2K, 3.4M. */
export function compactNumber(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}K`;
  return `${(n / 1_000_000).toFixed(n < 10_000_000 ? 1 : 0)}M`;
}

/** Seconds → "12:34" or "1:02:03". */
export function formatDuration(seconds: number | null | undefined): string {
  if (!seconds || seconds <= 0) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const pad = (x: number) => String(x).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}
