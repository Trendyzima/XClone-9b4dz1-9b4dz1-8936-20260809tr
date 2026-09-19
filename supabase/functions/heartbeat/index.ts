import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const url = Deno.env.get("SUPABASE_URL") ?? "";
const publishableKey =
  Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ??
  Deno.env.get("SUPABASE_ANON_KEY") ?? "";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-testagram-client, x-testagram-client-version",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
    },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return json({ ok: true });
  if (req.method !== "POST") return json({ ok: false, error: "POST required" }, 405);
  if (!url || !publishableKey) return json({ ok: false, error: "Supabase configuration missing" }, 500);

  const authorization = req.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return json({ ok: false, error: "Authentication required" }, 401);
  }

  let clientVersion: string | null = null;
  try {
    const body = await req.json();
    if (body && typeof body.client_version === "string") clientVersion = body.client_version.slice(0, 40);
  } catch {
    // Empty heartbeat bodies are valid.
  }

  const supabase = createClient(url, publishableKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await supabase.rpc("touch_user_heartbeat", {
    p_client_version: clientVersion,
  });

  if (error) {
    const authFailure = /authentication required|jwt|token/i.test(error.message);
    return json({ ok: false, error: authFailure ? "Authentication required" : "Heartbeat unavailable" }, authFailure ? 401 : 503);
  }

  return json({ ok: true, heartbeat: data });
});
