import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const publishableKey = (
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
  ?? import.meta.env.VITE_SUPABASE_ANON_KEY
) as string | undefined;

export const isSupabaseConfigured = Boolean(
  supabaseUrl
  && publishableKey
  && !supabaseUrl.includes("your-project")
  && !publishableKey.includes("your-public"),
);

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(supabaseUrl!, publishableKey!, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
        storageKey: "revision-tracker:auth:v1",
      },
    })
  : null;

export function requireSupabase(): SupabaseClient {
  if (!supabase) {
    throw new Error("Accounts are not configured in this build.");
  }
  return supabase;
}

export function isAuthorizationFailure(
  error: { code?: string } | null | undefined,
  status?: number,
): boolean {
  return status === 401
    || status === 403
    || error?.code === "PGRST301"
    || error?.code === "42501";
}
