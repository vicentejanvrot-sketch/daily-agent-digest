import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-provider";
import {
  startOfWeek,
  subDays,
  format,
  differenceInCalendarDays,
  addDays,
  startOfDay,
} from "date-fns";

export type TimePeriod = "7d" | "30d" | "all";

export interface DailyBucket {
  date: string;
  watchedSeconds: number;
  unwatchedSeconds: number;
  watchedCount: number;
  unwatchedCount: number;
}

export interface ChannelBucket {
  channelId: string;
  channelName: string;
  watchedSeconds: number;
  unwatchedSeconds: number;
  watchedCount: number;
  totalCount: number;
}

export interface AgentBucket {
  agentId: string;
  agentName: string;
  watchedSeconds: number;
  unwatchedSeconds: number;
  watchedCount: number;
  totalCount: number;
  channels: ChannelBucket[];
}

export interface WeeklyComparison {
  thisWeek: {
    watchedSeconds: number;
    unwatchedSeconds: number;
    watchedCount: number;
    totalCount: number;
  };
  lastWeek: {
    watchedSeconds: number;
    unwatchedSeconds: number;
    watchedCount: number;
    totalCount: number;
  };
  watchedTimeDiff: number;
  watchedCountDiff: number;
}

export interface WatchTimeStatsData {
  totalWatchedSeconds: number;
  totalUnwatchedSeconds: number;
  totalWatchedCount: number;
  totalCount: number;
  dailyTrend: DailyBucket[];
  byAgent: AgentBucket[];
  weeklyComparison: WeeklyComparison;
}

/**
 * Format a duration in seconds to "Xh Ym" format.
 * Under an hour returns "Ym", zero returns "0m".
 */
export function formatDuration(totalSeconds: number): string {
  if (totalSeconds <= 0) return "0m";
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

/** Compute percentage change of this vs last. Returns null if last is 0. */
function pctChange(thisVal: number, lastVal: number): number | null {
  if (lastVal === 0) return thisVal > 0 ? null : 0;
  return Math.round(((thisVal - lastVal) / lastVal) * 100);
}

/** Check whether an item is considered watched. */
function isWatched(status: string | null): boolean {
  return status === "watched" || status === "liked";
}

export function useWatchTimeStats(period: TimePeriod = "all") {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["watch-time-stats", period] as const,
    enabled: !!user,
    queryFn: async (): Promise<WatchTimeStatsData> => {
      // ── Compute date boundaries ──────────────────────────────
      const now = new Date();
      const todayStart = startOfDay(now);

      let startDate: string | null = null;
      if (period === "7d") {
        startDate = subDays(todayStart, 7).toISOString();
      } else if (period === "30d") {
        startDate = subDays(todayStart, 30).toISOString();
      }

      // Weekly comparison: Monday-based weeks
      const thisWeekStart = startOfWeek(todayStart, { weekStartsOn: 1 });
      const lastWeekStart = subDays(thisWeekStart, 7);
      const lastWeekEnd = subDays(thisWeekStart, 1);

      // ── Fetch items ──────────────────────────────────────────
      let itemsQuery = supabase
        .from("items")
        .select("id, agent_id, channel_id, channel_name, user_status, created_at")
        .order("created_at", { ascending: false });

      if (startDate) {
        itemsQuery = itemsQuery.gte("created_at", startDate);
      }

      const { data: items, error: itemsError } = await itemsQuery;
      if (itemsError) throw itemsError;

      const itemRows = (items ?? []) as Array<{
        id: string;
        agent_id: string;
        channel_id: string | null;
        channel_name: string | null;
        user_status: string | null;
        created_at: string;
      }>;

      if (itemRows.length === 0) {
        return emptyResult();
      }

      // ── Fetch agents ─────────────────────────────────────────
      const { data: agentRows, error: agentsError } = await supabase
        .from("agents")
        .select("id, name");

      if (agentsError) throw agentsError;

      const agentMap = new Map<string, string>();
      for (const a of (agentRows ?? []) as Array<{ id: string; name: string }>) {
        agentMap.set(a.id, a.name);
      }

      // ── Fetch item_analysis (batched in chunks of 200) ───────
      const itemIds = itemRows.map((it) => it.id);
      const durationMap = new Map<string, number>();

      const chunkSize = 200;
      for (let i = 0; i < itemIds.length; i += chunkSize) {
        const batch = itemIds.slice(i, i + chunkSize);
        const { data: analyses, error: analysisError } = await supabase
          .from("item_analysis")
          .select("item_id, duration_seconds")
          .in("item_id", batch);

        if (analysisError) throw analysisError;

        for (const row of (analyses ?? []) as Array<{
          item_id: string;
          duration_seconds: number | null;
        }>) {
          durationMap.set(row.item_id, row.duration_seconds ?? 0);
        }
      }

      // ── Aggregate ────────────────────────────────────────────
      let totalWatchedSeconds = 0;
      let totalUnwatatchedSeconds = 0;
      let totalWatchedCount = 0;

      // Daily trend: pre-initialize every day in range
      const dailyMap = new Map<string, DailyBucket>();

      if (startDate) {
        const rangeStart = new Date(startDate);
        const daysInRange = differenceInCalendarDays(todayStart, rangeStart) + 1;
        for (let d = 0; d < daysInRange; d++) {
          const day = addDays(rangeStart, d);
          const key = format(day, "yyyy-MM-dd");
          dailyMap.set(key, {
            date: key,
            watchedSeconds: 0,
            unwatchedSeconds: 0,
            watchedCount: 0,
            unwatchedCount: 0,
          });
        }
      }

      // By agent aggregation
      const agentAgg = new Map<
        string,
        {
          agentName: string;
          watchedSeconds: number;
          unwatchedSeconds: number;
          watchedCount: number;
          totalCount: number;
          channels: Map<
            string,
            {
              channelName: string;
              watchedSeconds: number;
              unwatchedSeconds: number;
              watchedCount: number;
              totalCount: number;
            }
          >;
        }
      >();

      // Weekly comparison
      let thisWeekWatched = 0;
      let thisWeekUnwatched = 0;
      let thisWeekWatchedCount = 0;
      let thisWeekTotal = 0;
      let lastWeekWatched = 0;
      let lastWeekUnwatched = 0;
      let lastWeekWatchedCount = 0;
      let lastWeekTotal = 0;

      for (const item of itemRows) {
        const duration = durationMap.get(item.id) ?? 0;
        const watched = isWatched(item.user_status);
        const created = new Date(item.created_at);
        const agentId = item.agent_id;
        const channelId = item.channel_id ?? "unknown";
        const channelName = item.channel_name ?? "Unknown Channel";

        // Totals
        if (watched) {
          totalWatchedSeconds += duration;
          totalWatchedCount++;
        } else {
          totalUnwatatchedSeconds += duration;
        }

        // Daily trend
        if (startDate) {
          const dayKey = format(created, "yyyy-MM-dd");
          const bucket = dailyMap.get(dayKey);
          if (bucket) {
            if (watched) {
              bucket.watchedSeconds += duration;
              bucket.watchedCount++;
            } else {
              bucket.unwatchedSeconds += duration;
              bucket.unwatchedCount++;
            }
          }
        }

        // By agent
        let agent = agentAgg.get(agentId);
        if (!agent) {
          agent = {
            agentName: agentMap.get(agentId) ?? "Unknown Agent",
            watchedSeconds: 0,
            unwatchedSeconds: 0,
            watchedCount: 0,
            totalCount: 0,
            channels: new Map(),
          };
          agentAgg.set(agentId, agent);
        }
        agent.totalCount++;
        if (watched) {
          agent.watchedSeconds += duration;
          agent.watchedCount++;
        } else {
          agent.unwatchedSeconds += duration;
        }

        let ch = agent.channels.get(channelId);
        if (!ch) {
          ch = {
            channelName,
            watchedSeconds: 0,
            unwatchedSeconds: 0,
            watchedCount: 0,
            totalCount: 0,
          };
          agent.channels.set(channelId, ch);
        }
        ch.totalCount++;
        if (watched) {
          ch.watchedSeconds += duration;
          ch.watchedCount++;
        } else {
          ch.unwatchedSeconds += duration;
        }

        // Weekly comparison
        const createdTime = created.getTime();
        const thisWeekStartTime = thisWeekStart.getTime();
        const lastWeekStartTime = lastWeekStart.getTime();
        const lastWeekEndTime = lastWeekEnd.getTime();

        if (createdTime >= thisWeekStartTime) {
          thisWeekTotal++;
          if (watched) {
            thisWeekWatched += duration;
            thisWeekWatchedCount++;
          } else {
            thisWeekUnwatched += duration;
          }
        } else if (createdTime >= lastWeekStartTime && createdTime <= lastWeekEndTime) {
          lastWeekTotal++;
          if (watched) {
            lastWeekWatched += duration;
            lastWeekWatchedCount++;
          } else {
            lastWeekUnwatched += duration;
          }
        }
      }

      const totalCount = totalWatchedCount + (itemRows.length - totalWatchedCount);

      // ── Build result ─────────────────────────────────────────
      const byAgent: AgentBucket[] = Array.from(agentAgg.entries()).map(
        ([agentId, a]) => ({
          agentId,
          agentName: a.agentName,
          watchedSeconds: a.watchedSeconds,
          unwatchedSeconds: a.unwatchedSeconds,
          watchedCount: a.watchedCount,
          totalCount: a.totalCount,
          channels: Array.from(a.channels.entries()).map(([chId, ch]) => ({
            channelId: chId,
            channelName: ch.channelName,
            watchedSeconds: ch.watchedSeconds,
            unwatchedSeconds: ch.unwatchedSeconds,
            watchedCount: ch.watchedCount,
            totalCount: ch.totalCount,
          })),
        }),
      );

      const dailyTrend = startDate
        ? Array.from(dailyMap.values()).sort((a, b) => a.date.localeCompare(b.date))
        : [];

      const weeklyComparison: WeeklyComparison = {
        thisWeek: {
          watchedSeconds: thisWeekWatched,
          unwatchedSeconds: thisWeekUnwatched,
          watchedCount: thisWeekWatchedCount,
          totalCount: thisWeekTotal,
        },
        lastWeek: {
          watchedSeconds: lastWeekWatched,
          unwatchedSeconds: lastWeekUnwatched,
          watchedCount: lastWeekWatchedCount,
          totalCount: lastWeekTotal,
        },
        watchedTimeDiff: pctChange(thisWeekWatched, lastWeekWatched) ?? 0,
        watchedCountDiff: pctChange(thisWeekWatchedCount, lastWeekWatchedCount) ?? 0,
      };

      return {
        totalWatchedSeconds,
        totalUnwatchedSeconds: totalUnwatatchedSeconds,
        totalWatchedCount,
        totalCount,
        dailyTrend,
        byAgent,
        weeklyComparison,
      };
    },
  });
}

function emptyResult(): WatchTimeStatsData {
  return {
    totalWatchedSeconds: 0,
    totalUnwatchedSeconds: 0,
    totalWatchedCount: 0,
    totalCount: 0,
    dailyTrend: [],
    byAgent: [],
    weeklyComparison: {
      thisWeek: { watchedSeconds: 0, unwatchedSeconds: 0, watchedCount: 0, totalCount: 0 },
      lastWeek: { watchedSeconds: 0, unwatchedSeconds: 0, watchedCount: 0, totalCount: 0 },
      watchedTimeDiff: 0,
      watchedCountDiff: 0,
    },
  };
}
