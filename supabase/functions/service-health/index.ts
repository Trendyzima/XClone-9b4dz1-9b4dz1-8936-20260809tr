import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const url = Deno.env.get("SUPABASE_URL") ?? "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SECRET_KEY") ?? "";
const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
  },
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return json({ ok: true });
  if (req.method !== "GET") return json({ error: "GET required" }, 405);
  const started = performance.now();

  try {
    const checks = await Promise.all([
      db.from("profiles").select("id", { count: "exact", head: true }),
      db.from("posts").select("id", { count: "exact", head: true }).is("deleted_at", null),
      db.from("content_recommendations").select("id", { count: "exact", head: true }),
      db.from("wallet_transactions").select("id", { count: "exact", head: true }),
    ]);
    const [profiles, posts, recommendations, walletTransactions] = checks;
    const errors = checks.filter((x) => x.error).map((x) => x.error?.message ?? "database check failed");
    const healthy = errors.length === 0;
    const durationMs = Math.round(performance.now() - started);

    return json({
      status: healthy ? "ok" : "degraded",
      service: "testagram",
      version: "ops-v1",
      duration_ms: durationMs,
      checks: {
        database: healthy ? "ok" : "error",
        recommendations: recommendations.error ? "error" : "ok",
        wallet: walletTransactions.error ? "error" : "ok",
        federation: "external-runtime",
      },
      counts: {
        users: profiles.count ?? 0,
        posts: posts.count ?? 0,
        recommendations: recommendations.count ?? 0,
        wallet_transactions: walletTransactions.count ?? 0,
      },
      errors: errors.length ? errors.slice(0, 4) : undefined,
      checked_at: new Date().toISOString(),
    }, healthy ? 200 : 503);
  } catch (error) {
    return json({
      status: "error",
      service: "testagram",
      error: error instanceof Error ? error.message : String(error),
      checked_at: new Date().toISOString(),
    }, 503);
  }
});
