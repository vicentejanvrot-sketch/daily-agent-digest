import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef } from "react";
import { Linking } from "react-native";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-provider";
import type {
  Agent,
  AgentRecipient,
  Channel,
  ChannelStatus,
  Run,
  ItemWithAnalysis,
  ItemStatus,
  UserSettings,
  UserSettingsSafe,
} from "@/lib/database";


/** Query keys, centralized so invalidation stays consistent. */
export const qk = {
  agents: ["agents"] as const,
  channels: (agentId: string) => ["channels", agentId] as const,
  channelsAll: ["channels"] as const,
  runs: ["runs"] as const,
  items: (filter: string) => ["items", filter] as const,
  settings: ["user_settings"] as const,
  safeSettings: ["user_settings_safe"] as const,
};

/** All agents owned by the current user. */
export function useAgents() {
  const { user } = useAuth();
  return useQuery({
    queryKey: qk.agents,
    enabled: !!user,
    queryFn: async (): Promise<Agent[]> => {
      const { data, error } = await supabase
        .from("agents")
        .select("*")
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Agent[];
    },
  });
}

/** Single agent by id. */
export function useAgent(agentId: string | null) {
  return useQuery({
    queryKey: ["agent", agentId],
    enabled: !!agentId,
    queryFn: async (): Promise<Agent | null> => {
      const { data, error } = await supabase
        .from("agents")
        .select("*")
        .eq("id", agentId)
        .single();
      if (error) throw error;
      return data as Agent | null;
    },
  });
}

/** Channels for a single agent. */
export function useChannels(agentId: string | null) {
  return useQuery({
    queryKey: qk.channels(agentId ?? ""),
    enabled: !!agentId,
    queryFn: async (): Promise<Channel[]> => {
      const { data, error } = await supabase
        .from("channels")
        .select("*")
        .eq("agent_id", agentId)
        .order("priority", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Channel[];
    },
  });
}

/** Recipients for a single agent. */
export function useRecipients(agentId: string | null) {
  return useQuery({
    queryKey: ["recipients", agentId],
    enabled: !!agentId,
    queryFn: async (): Promise<AgentRecipient[]> => {
      const { data, error } = await supabase
        .from("agent_recipients")
        .select("*")
        .eq("agent_id", agentId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as AgentRecipient[];
    },
  });
}

/** Runs filtered to a single agent. */
export function useAgentRuns(agentId: string | null, limit = 30) {
  return useQuery({
    queryKey: ["runs", agentId],
    enabled: !!agentId,
    queryFn: async (): Promise<Run[]> => {
      const { data, error } = await supabase
        .from("runs")
        .select("*")
        .eq("agent_id", agentId)
        .order("started_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (data ?? []) as Run[];
    },
  });
}

/** Recent runs across all agents. */
export function useRuns(limit = 50) {
  const { user } = useAuth();
  return useQuery({
    queryKey: qk.runs,
    enabled: !!user,
    queryFn: async (): Promise<Run[]> => {
      const { data, error } = await supabase
        .from("runs")
        .select("*")
        .order("started_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (data ?? []) as Run[];
    },
  });
}

/**
 * Feed items joined with their analysis.
 * `filter` is one of: "all" | ItemStatus.
 */
export function useItems(filter: "all" | ItemStatus) {
  const { user } = useAuth();
  return useQuery({
    queryKey: qk.items(filter),
    enabled: !!user,
    queryFn: async (): Promise<ItemWithAnalysis[]> => {
      let query = supabase
        .from("items")
        .select("*, item_analysis(*)")
        .order("published_at", { ascending: false })
        .limit(100);
      if (filter !== "all") {
        query = query.eq("user_status", filter);
      }
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as ItemWithAnalysis[];
    },
  });
}

/**
 * Feed items for the Research Feed screen — higher limit, no server-side
 * status filtering, so all client-side filtering/sorting works predictably.
 */
export function useFeedItems(limit = 500) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["feedItems", limit],
    enabled: !!user,
    queryFn: async (): Promise<ItemWithAnalysis[]> => {
      const { data, error } = await supabase
        .from("items")
        .select("*, item_analysis(*)")
        .order("published_at", { ascending: false, nullsFirst: false })
        .limit(limit);
      if (error) throw error;
      return (data ?? []) as ItemWithAnalysis[];
    },
  });
}

/** Update the watch status of a feed item, optimistically. */
export function useUpdateItemStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: ItemStatus }) => {
      const { error } = await supabase
        .from("items")
        .update({ user_status: status })
        .eq("id", id);
      if (error) throw error;
      return { id, status };
    },
    onMutate: async ({ id, status }) => {
      // Cancel outgoing feed queries so they don't overwrite our optimistic update.
      await queryClient.cancelQueries({ queryKey: ["feedItems"] });

      // Snapshot current feed data for rollback on error.
      const previousFeed = queryClient.getQueriesData<ItemWithAnalysis[]>({
        queryKey: ["feedItems"],
      });

      // Optimistically update each feed query cache in-place.
      for (const [queryKey, data] of previousFeed) {
        if (!data) continue;
        queryClient.setQueryData<ItemWithAnalysis[]>(queryKey, (old) =>
          old?.map((item) =>
            item.id === id ? { ...item, user_status: status } : item,
          ) ?? old,
        );
      }

      return { previousFeed };
    },
    onError: (_err, _vars, context) => {
      // Roll back every feed query to its pre-mutation snapshot.
      if (context?.previousFeed) {
        for (const [queryKey, data] of context.previousFeed) {
          queryClient.setQueryData(queryKey, data);
        }
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["items"] });
      void queryClient.invalidateQueries({ queryKey: ["feedItems"] });
      void queryClient.invalidateQueries({ queryKey: ["agentItemCounts"] });
    },
  });
}

/**
 * The current user's settings row (email + metadata only — NEVER key columns).
 * API keys are write-only: the database revokes SELECT on those columns,
 * so we intentionally never read them into client state.
 */
export function useUserSettings() {
  const { user } = useAuth();
  return useQuery({
    queryKey: qk.settings,
    enabled: !!user,
    queryFn: async (): Promise<Pick<UserSettings, "user_id" | "default_email" | "created_at" | "updated_at"> | null> => {
      const { data, error } = await supabase
        .from("user_settings")
        .select("user_id, default_email, created_at, updated_at")
        .eq("user_id", user?.id)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as any;
    },
  });
}

/** Persist settings changes (upsert keyed by user_id).
 *
 * All fields — including API keys — are written directly to the
 * user_settings table via the anon-key client, exactly as the web
 * app does.  Keys are validated (trimmed, length, no bad chars)
 * before writing and blank inputs are never persisted (write-only
 * security model: SELECT is revoked on key columns). */
export function useUpdateSettings() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  /** Maximum character lengths per key column. */
  const KEY_MAX_LENGTHS: Record<string, number> = {
    youtube_api_key: 100,
    openai_api_key: 200,
    anthropic_api_key: 200,
    gemini_api_key: 200,
  };

  return useMutation({
    mutationFn: async (patch: Partial<UserSettings>) => {
      const payload: Record<string, unknown> = { user_id: user?.id };

      for (const [k, v] of Object.entries(patch)) {
        if (v == null || v === "") continue;

        if (k in KEY_MAX_LENGTHS) {
          const trimmed = String(v).trim();
          if (!trimmed) continue;

          if (trimmed.length < 10) {
            throw new Error(`${k} is too short (minimum 10 characters).`);
          }
          if (trimmed.length > KEY_MAX_LENGTHS[k]) {
            throw new Error(
              `${k} is too long (maximum ${KEY_MAX_LENGTHS[k]} characters).`,
            );
          }
          if (/[\s\u0000-\u001F\u007F-\u009F]/.test(trimmed)) {
            throw new Error(`${k} contains invalid characters.`);
          }
          payload[k] = trimmed;
        } else {
          payload[k] = v;
        }
      }

      // Nothing to persist beyond the user_id anchor.
      if (Object.keys(payload).length <= 1) return;

      const { error } = await supabase
        .from("user_settings")
        .upsert(payload, { onConflict: "user_id" });

      if (error) {
        // Generic message — never echo the raw error, which could
        // contain the key value in a constraint or RLS rejection.
        throw new Error("Failed to save settings. Please try again.");
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: qk.settings });
      void queryClient.invalidateQueries({ queryKey: qk.safeSettings });
    },
  });
}

/**
 * Read-only safe view of the current user's settings.
 * The user_settings_safe Postgres view exposes has_*_key flags
 * and *_masked placeholders — the raw key columns are revoke-SELECT.
 * Re-fetched automatically after every successful save via query invalidation.
 */
export function useUserSettingsSafe() {
  const { user } = useAuth();
  return useQuery({
    queryKey: qk.safeSettings,
    enabled: !!user,
    queryFn: async (): Promise<UserSettingsSafe | null> => {
      const { data, error } = await supabase
        .from("user_settings_safe")
        .select("*")
        .eq("user_id", user?.id)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as UserSettingsSafe | null;
    },
  });
}

/**
 * Trigger a run for a single agent.
 * 1. Insert a run row (status "running") to get its id.
 * 2. Invoke the "run-agent" edge function with camelCase { agentId, runId }.
 * 3. If the invoke fails, mark the run as failed so History reflects it.
 */
export function useRunAgent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (agentId: string) => {
      const now = new Date().toISOString();

      // 1. Insert run row
      const { data: runRow, error: insertError } = await supabase
        .from("runs")
        .insert({ agent_id: agentId, status: "running", started_at: now })
        .select()
        .single();
      if (insertError) throw insertError;

      // 2. Invoke the existing edge function
      const { error: invokeError } = await supabase.functions.invoke("run-agent", {
        body: { agentId, runId: runRow.id },
      });

      // 3. If the invoke returned an error, update the run row
      if (invokeError) {
        await supabase
          .from("runs")
          .update({
            status: "failed",
            finished_at: new Date().toISOString(),
            error_summary: invokeError.message,
          })
          .eq("id", runRow.id);
        throw invokeError;
      }

      return runRow;
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: qk.runs });
      void queryClient.invalidateQueries({ queryKey: ["items"] });
    },
  });
}

/**
 * Insert a new run row (status "running") and return it immediately.
 * Does NOT invoke the edge function — the caller does that separately
 * so the overlay can start showing progress before the invoke completes.
 */
export function useStartRun() {
  return useMutation({
    mutationFn: async (agentId: string) => {
      const now = new Date().toISOString();
      const { data: runRow, error } = await supabase
        .from("runs")
        .insert({ agent_id: agentId, status: "running", started_at: now })
        .select()
        .single();
      if (error) throw error;
      return runRow as Run;
    },
  });
}

/**
 * Subscribe to Supabase Realtime for a table and invalidate the matching
 * React Query cache so changes from the web reflect live in the app.
 *
 * Uses a ref to guard against duplicate subscriptions and a stable
 * callback so the effect doesn't re-fire on every render when callers
 * pass inline arrays as queryKey.
 */
export function useRealtimeInvalidation(
  table: "runs" | "items" | "agents",
  queryKey: readonly unknown[],
  enabled = true,
) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  // Keep a stable ref of the latest callback deps so the effect
  // doesn't need to re-subscribe just because queryKey changed.
  const queryKeyRef = useRef(queryKey);
  queryKeyRef.current = queryKey;
  const queryClientRef = useRef(queryClient);
  queryClientRef.current = queryClient;

  useEffect(() => {
    // Always tear down any previous channel before deciding what to do,
    // so we never reuse an already-subscribed channel from Supabase's
    // internal registry (which would throw when we call `.on()` again).
    if (channelRef.current) {
      void supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }

    // Tear down only when disabled or user logs out
    if (!user || !enabled) return;

    // Build a brand-new channel: register listeners FIRST, subscribe LAST.
    // A unique suffix guarantees we never collide with a lingering channel
    // of the same topic that hasn't finished tearing down yet.
    const channel = supabase.channel(
      `realtime:${table}:${Math.random().toString(36).slice(2)}`,
    );

    channel.on(
      "postgres_changes",
      { event: "*", schema: "public", table },
      () => {
        void queryClientRef.current.invalidateQueries({
          queryKey: queryKeyRef.current,
        });
      },
    );

    channel.subscribe();
    channelRef.current = channel;

    return () => {
      if (channelRef.current) {
        void supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [table, user, enabled]);
}

/** Toggle a channel's is_enabled flag. */
export function useToggleChannel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, isEnabled }: { id: string; isEnabled: boolean }) => {
      const { error } = await supabase
        .from("channels")
        .update({ is_enabled: isEnabled })
        .eq("id", id);
      if (error) throw error;
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["channels"] });
    },
  });
}

/** Delete a channel. */
export function useDeleteChannel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("channels").delete().eq("id", id);
      if (error) throw error;
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["channels"] });
    },
  });
}

/** Add a channel to an agent. */
export function useAddChannel(agentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { channel_url: string; priority?: number }) => {
      const { error } = await supabase.from("channels").insert({
        agent_id: agentId,
        channel_url: payload.channel_url,
        priority: payload.priority ?? 3,
      });
      if (error) throw error;
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["channels"] });
    },
  });
}

/** Add a recipient to an agent. */
export function useAddRecipient(agentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (email: string) => {
      const { error } = await supabase.from("agent_recipients").insert({
        agent_id: agentId,
        email,
      });
      if (error) throw error;
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["recipients"] });
    },
  });
}

/** Remove a recipient. */
export function useDeleteRecipient() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("agent_recipients").delete().eq("id", id);
      if (error) throw error;
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["recipients"] });
    },
  });
}

/** All channels across all agents (RLS-scoped to the signed-in user). */
export function useChannelsAll() {
  const { user } = useAuth();
  return useQuery({
    queryKey: qk.channelsAll,
    enabled: !!user,
    queryFn: async (): Promise<Channel[]> => {
      const { data, error } = await supabase
        .from("channels")
        .select("*");
      if (error) throw error;
      return (data ?? []) as Channel[];
    },
  });
}

/** Delete an agent by id. */
export function useDeleteAgent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (agentId: string) => {
      const { error } = await supabase.from("agents").delete().eq("id", agentId);
      if (error) throw error;
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: qk.agents });
      void queryClient.invalidateQueries({ queryKey: qk.channelsAll });
      void queryClient.invalidateQueries({ queryKey: ["items"] });
    },
  });
}

/**
 * Per-agent accent color by position in a stable sorted list.
 * Use this with the agent's index in an alphabetically-sorted list
 * so the same agent always gets the same color as in the web app.
 */
export function getAgentColor(index: number): string {
  const { AGENT_ACCENTS } = require("@/lib/database");
  return AGENT_ACCENTS[index % AGENT_ACCENTS.length];
}

/** Create a new agent row. Returns the inserted agent. */
export function useCreateAgent() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (
      payload: Omit<
        Agent,
        "id" | "user_id" | "created_at" | "updated_at"
      >,
    ) => {
      const { data, error } = await supabase
        .from("agents")
        .insert({ ...payload, user_id: user?.id })
        .select()
        .single();
      if (error) throw error;
      return data as Agent;
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: qk.agents });
    },
  });
}

/** Update an existing agent row. Returns the updated agent. */
export function useUpdateAgent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      ...patch
    }: Partial<Agent> & { id: string }) => {
      const { data, error } = await supabase
        .from("agents")
        .update(patch)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data as Agent;
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: qk.agents });
    },
  });
}

/** Cancel a running run by setting its status to "cancelled". */
export function useCancelRun() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (runId: string) => {
      const { error } = await supabase
        .from("runs")
        .update({ status: "cancelled", finished_at: new Date().toISOString() })
        .eq("id", runId);
      if (error) throw error;
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: qk.runs });
    },
  });
}

/** Delete all runs belonging to the signed-in user (RLS-scoped). */
export function useClearRuns() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in");

      // Get the user's agent ids so we can scope the delete explicitly.
      const { data: agents, error: agentsError } = await supabase
        .from("agents")
        .select("id")
        .eq("user_id", user.id);
      if (agentsError) throw agentsError;

      const agentIds = (agents ?? []).map((a: { id: string }) => a.id);
      if (agentIds.length === 0) return;

      // RLS already scopes deletes to the user, but we filter by agent_id
      // explicitly so the delete has a concrete WHERE clause.
      const { error } = await supabase
        .from("runs")
        .delete()
        .in("agent_id", agentIds);
      if (error) throw error;
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: qk.runs });
    },
  });
}

/** Update a channel's priority. */
export function useUpdateChannelPriority() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, priority }: { id: string; priority: number }) => {
      const { error } = await supabase
        .from("channels")
        .update({ priority })
        .eq("id", id);
      if (error) throw error;
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["channels"] });
    },
  });
}

/**
 * Per-agent item counts using server-side exact counts (head: true).
 * Returns a map of agentId → { total, watched, unwatched, watchLater, liked }
 * without downloading any row data to the client.
 */
export function useAgentItemCounts(agentIds: string[]) {
  const { user } = useAuth();
  const sorted = useMemo(() => [...agentIds].sort(), [agentIds]);
  return useQuery({
    queryKey: ["agentItemCounts", ...sorted],
    enabled: !!user && agentIds.length > 0,
    staleTime: 30_000,
    queryFn: async (): Promise<
      Record<
        string,
        {
          total: number;
          watched: number;
          unwatched: number;
          watchLater: number;
          liked: number;
        }
      >
    > => {
      const results: Record<
        string,
        {
          total: number;
          watched: number;
          unwatched: number;
          watchLater: number;
          liked: number;
        }
      > = {};

      await Promise.all(
        agentIds.map(async (agentId) => {
          const [totalRes, watchedRes, unwatchedRes, watchLaterRes, likedRes] =
            await Promise.all([
              supabase
                .from("items")
                .select("*", { count: "exact", head: true })
                .eq("agent_id", agentId),
              supabase
                .from("items")
                .select("*", { count: "exact", head: true })
                .eq("agent_id", agentId)
                .eq("user_status", "watched"),
              supabase
                .from("items")
                .select("*", { count: "exact", head: true })
                .eq("agent_id", agentId)
                .or("user_status.is.null,user_status.eq.not_watched"),
              supabase
                .from("items")
                .select("*", { count: "exact", head: true })
                .eq("agent_id", agentId)
                .eq("user_status", "watch_later"),
              supabase
                .from("items")
                .select("*", { count: "exact", head: true })
                .eq("agent_id", agentId)
                .eq("user_status", "liked"),
            ]);

          results[agentId] = {
            total: totalRes.count ?? 0,
            watched: watchedRes.count ?? 0,
            unwatched: unwatchedRes.count ?? 0,
            watchLater: watchLaterRes.count ?? 0,
            liked: likedRes.count ?? 0,
          };
        }),
      );

      return results;
    },
  });
}

/** Run item counts grouped by run_id and user_status for a set of run IDs. */
export function useRunItemCounts(runIds: string[]) {
  return useQuery({
    queryKey: ["runItemCounts", ...runIds],
    enabled: runIds.length > 0,
    queryFn: async (): Promise<Record<string, Record<ItemStatus, number>>> => {
      const { data, error } = await supabase
        .from("items")
        .select("run_id, user_status")
        .in("run_id", runIds);
      if (error) throw error;

      const counts: Record<string, Record<ItemStatus, number>> = {};
      for (const row of (data ?? []) as Array<{ run_id: string; user_status: ItemStatus | null }>) {
        const rid = row.run_id;
        const st = row.user_status ?? "not_watched";
        if (!counts[rid]) {
          counts[rid] = { not_watched: 0, watched: 0, liked: 0, watch_later: 0 };
        }
        counts[rid][st] = (counts[rid][st] ?? 0) + 1;
      }
      return counts;
    },
  });
}

/**
 * Delete the current user's account and all associated data.
 *
 * Primary path: calls the `delete-account` edge function, which handles
 * all data cleanup and auth-user removal server-side.
 *
 * Fallback path: if the edge function is unavailable, performs a
 * best-effort client-side cleanup of user-owned rows, then the caller
 * signs out and opens a prefilled support email so the login record
 * can be removed manually.
 *
 * Returns an object describing which path succeeded so the caller can
 * show the right toast and take post-deletion actions.
 */
export function useDeleteAccount() {
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (): Promise<
      | { success: true; method: "edge_function" }
      | { success: true; method: "client_fallback" }
    > => {
      const userId = user?.id;
      if (!userId) throw new Error("Not authenticated");

      // ── Primary: edge function ──────────────────────────────
      const { error: fnError } = await supabase.functions.invoke(
        "delete-account",
      );

      if (!fnError) {
        return { success: true, method: "edge_function" };
      }

      // ── Fallback: client-side cleanup ───────────────────────
      const directUserTables = [
        "user_settings",
        "youtube_sync_log",
        "watch_time_stats",
        "agents",
      ] as const;

      for (const table of directUserTables) {
        try {
          await supabase.from(table).delete().eq("user_id", userId);
        } catch {
          // best-effort — continue cleaning other tables
        }
      }

      // Agent-scoped tables: the edge function handles cascading
      // deletes; here we also attempt a direct clean via RLS.
      const agentScopedTables = [
        "channels",
        "runs",
        "items",
        "agent_recipients",
      ] as const;

      for (const table of agentScopedTables) {
        try {
          await supabase.from(table).delete().neq("id", "00000000-0000-0000-0000-000000000000");
        } catch {
          // best-effort
        }
      }

      return { success: true, method: "client_fallback" };
    },
  });
}

/**
 * Delete a single API key by setting its column to null.
 * Accepts the column name (e.g. "youtube_api_key") and performs
 * a targeted upsert so the safe view immediately reflects the removal.
 */
export function useDeleteApiKey() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (keyColumn: string) => {
      const { error } = await supabase
        .from("user_settings")
        .upsert(
          { user_id: user?.id, [keyColumn]: null },
          { onConflict: "user_id" },
        );
      if (error) {
        throw new Error("Failed to delete key. Please try again.");
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: qk.safeSettings });
    },
  });
}

/** Re-fetch a query whenever its screen regains focus. */
export { useFocusEffect } from "expo-router";
