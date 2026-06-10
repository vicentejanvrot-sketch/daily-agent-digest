import createContextHook from "@nkzw/create-context-hook";
import { useEffect, useState } from "react";
import type { AuthError, Session, User } from "@supabase/supabase-js";
import * as SecureStore from "expo-secure-store";
import { supabase } from "@/lib/supabase";
import { runBackendDiagnostic } from "@/lib/diagnostics";

type AuthStatus = "loading" | "authenticated" | "unauthenticated";

interface AuthState {
  status: AuthStatus;
  session: Session | null;
  user: User | null;
  signUp: (email: string, password: string) => Promise<{ error: AuthError | null; success: boolean }>;
  signIn: (email: string, password: string) => Promise<{ error: AuthError | null }>;
  signOut: () => Promise<void>;
  sendPasswordReset: (email: string) => Promise<{ error: AuthError | null }>;
  updatePassword: (newPassword: string) => Promise<{ error: AuthError | null }>;
}

export const [AuthProvider, useAuth] = createContextHook((): AuthState => {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    // Restore session on mount
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      setUser(s?.user ?? null);
      setStatus(s ? "authenticated" : "unauthenticated");
      if (s?.user) void runBackendDiagnostic(s.user);
    });

    // Listen for auth changes
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      setUser(s?.user ?? null);
      setStatus(s ? "authenticated" : "unauthenticated");
      if (s?.user) void runBackendDiagnostic(s.user);
    });

    return () => sub?.subscription.unsubscribe();
  }, []);

  const signUp = async (email: string, password: string) => {
    const { error } = await supabase.auth.signUp({ email, password });
    if (error) {
      console.warn("[auth-provider] signUp error:", error.message);
    }
    return { error, success: !error };
  };

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error };
  };

  const signOut = async () => {
    // 1. Tell Supabase to sign out (this calls removeItem on our adapter)
    await supabase.auth.signOut();

    // 2. Explicitly purge every known Supabase auth key from SecureStore
    //    so no stale session can survive across app launches.
    //    Supabase stores tokens under keys derived from the project URL.
    const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? "";
    const projectRef = supabaseUrl.match(/https:\/\/(.+)\.supabase\.co/)?.[1] ?? "";
    const keysToClear = [
      `sb-${projectRef}-auth-token`,
      "supabase.auth.token",
      "supabase.auth.refreshToken",
    ];
    await Promise.allSettled(
      keysToClear.map((key) => SecureStore.deleteItemAsync(key)),
    );

    // 3. Reset React state so the guards immediately redirect to Login.
    setSession(null);
    setUser(null);
    setStatus("unauthenticated");
  };

  const sendPasswordReset = async (email: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: "rork-app://reset-password",
    });
    return { error };
  };

  const updatePassword = async (newPassword: string) => {
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    return { error };
  };

  return { status, session, user, signUp, signIn, signOut, sendPasswordReset, updatePassword };
});
