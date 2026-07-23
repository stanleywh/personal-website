import { createClient } from "https://esm.sh/@supabase/supabase-js@2.110.8";

const fallbackOrigins = [
  "https://stanleywh.github.io",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
];

const allowedOrigins = new Set(
  (Deno.env.get("ALLOWED_ORIGINS") ?? fallbackOrigins.join(","))
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
);

function corsHeaders(origin: string | null): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin ?? "",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function json(
  body: Record<string, unknown>,
  status: number,
  origin: string | null,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
  });
}

function jsonError(
  code: string,
  message: string,
  status: number,
  origin: string | null,
): Response {
  return json({ error: { code, message } }, status, origin);
}

Deno.serve(async (request) => {
  const origin = request.headers.get("Origin");
  const allowedOrigin = origin && allowedOrigins.has(origin) ? origin : null;
  if (origin && !allowedOrigin) {
    return jsonError("origin_not_allowed", "Origin not allowed", 403, null);
  }
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(allowedOrigin) });
  }
  if (request.method !== "POST") {
    return jsonError("method_not_allowed", "Method not allowed", 405, allowedOrigin);
  }

  const authorization = request.headers.get("Authorization");
  const accessToken = authorization?.replace(/^Bearer\s+/i, "");
  if (!authorization || !accessToken) {
    return jsonError("missing_authorization", "Missing authorization", 401, allowedOrigin);
  }

  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anonKey || !serviceKey) {
    return jsonError(
      "configuration_error",
      "Function configuration is incomplete",
      500,
      allowedOrigin,
    );
  }

  const userClient = createClient(url, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: { user }, error } = await userClient.auth.getUser();
  if (error || !user) {
    return jsonError("invalid_session", "Invalid session", 401, allowedOrigin);
  }

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: signOutError } = await admin.auth.admin.signOut(accessToken, "global");
  if (signOutError) {
    return jsonError(
      "session_revocation_failed",
      "Could not revoke account sessions",
      500,
      allowedOrigin,
    );
  }

  const { error: deleteError } = await admin.auth.admin.deleteUser(user.id);
  if (deleteError) {
    return jsonError("account_deletion_failed", "Could not delete the account", 500, allowedOrigin);
  }
  return json({ deleted: true }, 200, allowedOrigin);
});
