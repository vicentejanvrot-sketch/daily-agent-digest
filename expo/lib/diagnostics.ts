import type { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

// Dev-only flag. Diagnostics are stripped/never run in production builds.
// Toggle to false to silence even in development.
const ENABLE_BACKEND_DIAGNOSTIC = true;

// The Supabase project this app is expected to share with the web app.
// Used only to warn if the configured URL points somewhere else.
const EXPECTED_SUPABASE_HOST = "wavkxbkirkyjwtnszmya.supabase.co";

let hasRunForSession = false;

/**
 * Temporary, dev-only diagnostic to verify the mobile app is wired to the
 * SAME Supabase project/user pool as the existing web app.
 *
 * After sign-in it logs the authenticated user's id/email and runs one
 * read-only query against the existing `agents` table (RLS-scoped to that
 * user), logging the returned row count. It never prints the anon key value.
 *
 * Remove this file and its call site before release.
 */
export async function runBackendDiagnostic(user: User | null): Promise<void> {
  if (!ENABLE_BACKEND_DIAGNOSTIC || !__DEV__ || !user) return;
  if (hasRunForSession) return;
  hasRunForSession = true;

  const url = process.env.EXPO_PUBLIC_SUPABASE_URL ?? "";
  const hasKey = (process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "").length > 0;

  console.log("[backend-diagnostic] ---- shared backend check ----");
  console.log(`[backend-diagnostic] supabase url: ${url || "(unset)"}`);
  console.log(`[backend-diagnostic] anon key present: ${hasKey ? "yes" : "no"}`);

  let host = "";
  try {
    host = new URL(url).host;
  } catch {
    host = "";
  }

  if (!url || !hasKey) {
    console.warn(
      "[backend-diagnostic] WARNING: EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY is missing. The app cannot reach the shared backend.",
    );
  } else if (host !== EXPECTED_SUPABASE_HOST) {
    console.warn(
      `[backend-diagnostic] WARNING: configured Supabase host "${host}" does not match the expected web project "${EXPECTED_SUPABASE_HOST}". The app is likely pointed at the wrong project.`,
    );
  }

  console.log(`[backend-diagnostic] authenticated user id: ${user.id}`);
  console.log(`[backend-diagnostic] authenticated user email: ${user.email ?? "(none)"}`);

  // Read-only query against the existing agents table, RLS-scoped to this user.
  const { data, error, count } = await supabase
    .from("agents")
    .select("id", { count: "exact", head: false })
    .eq("user_id", user.id);

  if (error) {
    console.warn(
      `[backend-diagnostic] agents read failed: ${error.message}. ` +
        "This may indicate the wrong project/key, a schema mismatch, or an RLS issue.",
    );
    return;
  }

  const rowCount = count ?? data?.length ?? 0;
  console.log(`[backend-diagnostic] agents rows for this user: ${rowCount}`);

  if (rowCount === 0) {
    console.warn(
      "[backend-diagnostic] WARNING: this user has 0 agents here. If you have agents on the web app, " +
        "the mobile app is likely pointed at the WRONG Supabase project or using a different anon key " +
        `(expected host: ${EXPECTED_SUPABASE_HOST}).`,
    );
  } else {
    console.log("[backend-diagnostic] OK: shared backend returned this user's existing agents.");
  }
  console.log("[backend-diagnostic] ---- end check ----");
}
