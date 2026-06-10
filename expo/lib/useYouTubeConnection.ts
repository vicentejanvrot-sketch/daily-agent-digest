import createContextHook from "@nkzw/create-context-hook";
import { useState, useEffect, useCallback, useRef } from "react";
import * as WebBrowser from "expo-web-browser";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-provider";
import { useToast } from "@/components/Toast";

// ── Types ──────────────────────────────────────────────────────────

export type YouTubeStatus = "loading" | "connected" | "disconnected";

export interface YouTubeConnectionState {
  status: YouTubeStatus;
  channelName: string | null;
  channelThumbnail: string | null;
  error: string | null;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  syncAction: (videoId: string, action: YouTubeAction) => Promise<void>;
}

export type YouTubeAction = "rate" | "watch_later" | "unwatch_later";

const STORAGE_KEY = "@youtube/connection";

// Web app's existing https OAuth callback — already authorised on the
// Google OAuth client, so no Google Cloud changes are needed.
const REDIRECT = "https://youtubeagente.lovable.app/youtube-auth-callback";

// ── Context Hook ───────────────────────────────────────────────────

export const [YouTubeConnectionProvider, useYouTubeConnection] =
  createContextHook((): YouTubeConnectionState => {
    const { user } = useAuth();
    const showFn = useToast();
    const toastRef = useRef(showFn);
    toastRef.current = showFn;
    const notify = (msg: string, type: "success" | "error" | "info") =>
      toastRef.current?.(msg, type);

    const [status, setStatus] = useState<YouTubeStatus>("loading");
    const [channelName, setChannelName] = useState<string | null>(null);
    const [channelThumbnail, setChannelThumbnail] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const connectingRef = useRef(false);

    // ── Restore persisted connection on mount / user change ────────

    useEffect(() => {
      if (!user) {
        setStatus("disconnected");
        setChannelName(null);
        setChannelThumbnail(null);
        return;
      }

      AsyncStorage.getItem(STORAGE_KEY)
        .then((stored) => {
          if (stored) {
            try {
              const parsed = JSON.parse(stored);
              if (parsed.channelName) {
                setChannelName(parsed.channelName);
                setChannelThumbnail(parsed.channelThumbnail ?? null);
                setStatus("connected");
                return;
              }
            } catch {
              // corrupt storage — treat as disconnected
            }
          }
          setStatus("disconnected");
        })
        .catch(() => setStatus("disconnected"));
    }, [user]);

    // ── Connect ─────────────────────────────────────────────────

    const connect = useCallback(async () => {
      if (connectingRef.current) return;
      connectingRef.current = true;
      setError(null);

      try {
        // 1. Request the OAuth URL from the edge function, using the
        //    web app's already-authorised https redirect URI.
        const { data: authData, error: authError } = await supabase.functions.invoke(
          "youtube-auth",
          { body: { redirectUri: REDIRECT } },
        );

        if (authError) {
          throw new Error(
            authError.message || JSON.stringify(authError) || "Failed to start authentication"
          );
        }

        // The edge function may return the URL under different field names.
        // Try every likely key so a rename on the server doesn't break the client.
        const raw: Record<string, any> | undefined = authData as any;
        const authUrl: string | undefined =
          raw?.url ??
          raw?.authUrl ??
          raw?.authorizeUrl ??
          raw?.authorization_url ??
          raw?.redirectUrl ??
          raw?.data?.url ??
          raw?.data?.authUrl ??
          raw?.data?.authorizeUrl ??
          raw?.data?.authorization_url ??
          undefined;

        if (!authUrl) {
          const debugInfo =
            raw
              ? JSON.stringify(raw).slice(0, 200)
              : "(empty response)";
          throw new Error(
            `No authorization URL returned from server. Response: ${debugInfo}`
          );
        }

        // 2. Open in-app browser. After consent Google redirects to
        //    the https callback; openAuthSessionAsync detects the
        //    redirect and resolves with the final URL.
        const result = await WebBrowser.openAuthSessionAsync(authUrl, REDIRECT);

        if (result.type === "cancel" || result.type === "dismiss") {
          // User cancelled or the flow was dismissed — not an error, just a cancellation
          notify("YouTube connection cancelled", "info");
          return;
        }

        if (result.type !== "success" || !result.url) {
          setError("Authentication failed — unexpected browser response");
          notify("Authentication failed — unexpected browser response", "error");
          return;
        }

        // 3. Parse the authorization code from the redirect URL
        const redirectUrl = new URL(result.url);
        const code = redirectUrl.searchParams.get("code");
        const state = redirectUrl.searchParams.get("state");
        const errorParam = redirectUrl.searchParams.get("error");

        if (errorParam) {
          throw new Error(errorParam);
        }

        if (!code) {
          throw new Error("No authorization code received");
        }

        // 4. Exchange the code for tokens (server-side)
        const callbackBody: Record<string, string> = { code };
        if (state) callbackBody.state = state;
        callbackBody.redirectUri = REDIRECT;

        const { data: callbackData, error: callbackError } =
          await supabase.functions.invoke("youtube-auth-callback", {
            body: callbackBody,
          });

        if (callbackError) {
          throw new Error(callbackError.message || "Failed to complete authentication");
        }

        // 5. Extract channel info from the response
        const channel = (callbackData as any)?.channel;
        const name: string | null =
          channel?.name || channel?.title || channel?.snippet?.title || null;
        const thumbnail: string | null =
          channel?.thumbnail ||
          channel?.snippet?.thumbnails?.default?.url ||
          null;

        setChannelName(name);
        setChannelThumbnail(thumbnail);
        setStatus("connected");
        setError(null);

        // 6. Persist so the app remembers the connection across launches
        await AsyncStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({ channelName: name, channelThumbnail: thumbnail }),
        );

        notify("YouTube connected", "success");
      } catch (err: any) {
        const message = err?.message ?? "Connection failed";
        setError(message);
        // Only toast if the user didn't cancel (cancellation is handled above
        // with its own info toast, before the throw path).
        if (message !== "Authentication cancelled") {
          notify(message, "error");
        }
      } finally {
        connectingRef.current = false;
      }
    }, []);

    // ── Disconnect ──────────────────────────────────────────────

    const disconnect = useCallback(async () => {
      try {
        const { error: disconnectError } = await supabase.functions.invoke(
          "youtube-api",
          { body: { action: "disconnect" } },
        );

        if (disconnectError) {
          throw new Error(disconnectError.message || "Failed to disconnect");
        }

        setStatus("disconnected");
        setChannelName(null);
        setChannelThumbnail(null);
        setError(null);
        await AsyncStorage.removeItem(STORAGE_KEY);
        notify("YouTube disconnected", "success");
      } catch (err: any) {
        notify(err?.message ?? "Failed to disconnect", "error");
      }
    }, []);

    // ── Sync a video action to YouTube ──────────────────────────

    const syncAction = useCallback(
      async (videoId: string, action: YouTubeAction) => {
        if (status !== "connected") return;
        try {
          const { error: syncError } = await supabase.functions.invoke(
            "youtube-api",
            { body: { action, videoId } },
          );
          if (syncError) {
            console.warn("[youtube-sync] Failed:", syncError.message);
          }
        } catch (err: any) {
          console.warn("[youtube-sync] Failed:", err?.message);
        }
      },
      [status],
    );

    return {
      status,
      channelName,
      channelThumbnail,
      error,
      connect,
      disconnect,
      syncAction,
    };
  });
