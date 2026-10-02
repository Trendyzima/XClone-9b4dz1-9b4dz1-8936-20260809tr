import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { Pool } from "jsr:@db/postgres@^0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const MCP_URL = (Deno.env.get("NEWSIFY_MCP_URL") ?? "https://mcp.newsifytrends.com/mcp").replace(/\/$/, "");
const DEFAULT_GEO = Deno.env.get("NEWSIFY_GEO") ?? "US";
const DEFAULT_LANGUAGE = Deno.env.get("NEWSIFY_LANGUAGE") ?? "english";
const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const pool = new Pool(Deno.env.get("SUPABASE_DB_URL") ?? "", 1, true);

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
});

type McpResponse = { result?: Record<string, unknown>; error?: Record<string, unknown> };
type NewsifyItem = Record<string, unknown>;

async function vaultSecret(name: string): Promise<string | null> {
  const connection = await pool.connect();
  try {
    const result = await connection.queryObject<{ decrypted_secret: string }>`
      select decrypted_secret from vault.decrypted_secrets where name=${name} limit 1
    `;
    return result.rows[0]?.decrypted_secret ?? null;
  } finally { connection.release(); }
}

async function mcpRequest(id: number, method: string, params: Record<string, unknown>, sessionId?: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json, text/event-stream" };
  if (sessionId) headers["Mcp-Session-Id"] = sessionId;
  const response = await fetch(MCP_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
  const raw = await response.text();
  if (!response.ok) throw new Error(`Newsify MCP ${response.status}: ${raw.slice(0, 500)}`);
  const nextSession = response.headers.get("mcp-session-id") ?? sessionId;
  let parsed: McpResponse;
  if (raw.trim().startsWith("{")) parsed = JSON.parse(raw);
  else {
    const line = raw.split("\n").find((value) => value.startsWith("data:"));
    if (!line) throw new Error("Newsify MCP returned no JSON-RPC data");
    parsed = JSON.parse(line.slice(5).trim());
  }
  if (parsed.error) throw new Error(`Newsify MCP error: ${JSON.stringify(parsed.error).slice(0, 500)}`);
  return { body: parsed, sessionId: nextSession };
}

function extractItems(response: McpResponse): NewsifyItem[] {
  const result = response.result ?? {};
  const structured = result.structuredContent;
  if (structured && typeof structured === "object" && Array.isArray((structured as Record<string, unknown>).items)) {
    return (structured as Record<string, unknown>).items as NewsifyItem[];
  }
  const content = Array.isArray(result.content) ? result.content : [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const text = (block as Record<string, unknown>).text;
    if (typeof text !== "string") continue;
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === "object" && Array.isArray(parsed.items)) return parsed.items;
    } catch {}
  }
  return [];
}
const str = (v: unknown, fallback = "") => typeof v === "string" ? v.trim() : fallback;
const int = (v: unknown) => Number.isFinite(Number(v)) ? Math.round(Number(v)) : null;
const date = (v: unknown) => { const d = new Date(str(v)); return Number.isFinite(d.getTime()) ? d.toISOString() : new Date().toISOString(); };

async function syncNewsify() {
  const expected = await vaultSecret("newsify_worker_token");
  if (!expected) throw new Error("Newsify worker token is not configured");
  const lock = await db.rpc("newsify_sync_lock");
  if (lock.error) throw new Error(`sync_lock:${lock.error.message}`);
  if (lock.data !== true) return { skipped: true, reason: "already_running", synced: 0, created: 0, notified: 0 };

  try {
    let sessionId: string | undefined;
    try {
      const initialized = await mcpRequest(1, "initialize", {
        protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "testagram-newsify-sync", version: "1.0.0" },
      });
      sessionId = initialized.sessionId;
    } catch {
      const initialized = await mcpRequest(1, "initialize", {
        protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "testagram-newsify-sync", version: "1.0.0" },
      });
      sessionId = initialized.sessionId;
    }

    const called = await mcpRequest(2, "tools/call", {
      name: "get_trend_news",
      arguments: {
        userText: "Sync current Newsify trending stories into Testagram. Preserve Newsify IDs, summaries, attribution and article links.",
        limit: 25, geo: DEFAULT_GEO, language: DEFAULT_LANGUAGE,
      },
    }, sessionId);
    const items = extractItems(called.body);
    if (!items.length) throw new Error("Newsify returned zero normalized trend items");

    const now = new Date().toISOString();
    let synced = 0, created = 0, notified = 0;
    const { data: tokenRows, error: tokenError } = await db.from("app_push_tokens")
      .select("user_id").eq("provider", "fcm").eq("platform", "android").eq("enabled", true);
    if (tokenError) throw tokenError;
    const recipients = [...new Set((tokenRows ?? []).map((r: { user_id: string }) => r.user_id).filter(Boolean))];

    for (const item of items.slice(0, 25)) {
      const newsifyItemId = str(item.id || item.newsId || item.articleId);
      const title = str(item.title);
      if (!newsifyItemId || !title) continue;
      const geo = str(item.geo, DEFAULT_GEO) || DEFAULT_GEO;
      const language = str(item.language, DEFAULT_LANGUAGE) || DEFAULT_LANGUAGE;
      const publishedAt = date(item.publishedAt || item.published_at || item.createdAt);
      const score = int(item.importanceScore ?? item.importance_score);
      const tier = int(item.importanceTier ?? item.importance_tier);
      const row = {
        newsify_item_id: newsifyItemId,
        newsify_trend_id: str(item.trendId || item.trend_id) || null,
        trend_title: str(item.trendTitle || item.trend_title) || null,
        title,
        excerpt: str(item.excerpt || item.content) || null,
        detail_url: str(item.detailUrl || item.detail_url || item.newsifyUrl || item.newsify_url) || null,
        source_url: str(item.sourceUrl || item.source_url) || null,
        source_name: "Newsify",
        geo, language, importance_score: score, importance_tier: tier,
        trend_traffic: int(item.trendTraffic ?? item.trend_traffic),
        published_at: publishedAt, fetched_at: now, updated_at: now,
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        metadata: item,
      };
      const existing = await db.from("newsify_trending_items").select("id").eq("newsify_item_id", newsifyItemId).eq("geo", geo).eq("language", language).maybeSingle();
      if (existing.error) throw existing.error;
      const { error: saveError } = await db.from("newsify_trending_items").upsert(row, { onConflict: "newsify_item_id,geo,language" });
      if (saveError) throw saveError;
      synced++;
      const fresh = Date.now() - new Date(publishedAt).getTime() <= 6 * 60 * 60 * 1000;
      const breaking = tier === 1 || (score !== null && score >= 80);
      if (!fresh || !breaking) continue;

      for (const recipientId of recipients) {
        const result = await db.rpc("create_domain_notification", {
          p_recipient_id: recipientId, p_kind: "news_trending", p_actor_id: null, p_post_id: null, p_type: "news_trending",
          p_data: {
            title: title.slice(0, 120),
            body: (str(item.excerpt || item.content) || "A new Newsify trend is breaking.").slice(0, 240),
            action_url: str(item.detailUrl || item.detail_url || item.newsifyUrl || item.newsify_url) || "https://testagram.site/",
            newsify_item_id: newsifyItemId, source: "Newsify",
          },
          p_unique_key: `newsify:${newsifyItemId}:${recipientId}`,
        });
        if (!result.error && result.data) notified++;
      }
    }
    return { skipped: false, synced, created, notified, geo: DEFAULT_GEO, language: DEFAULT_LANGUAGE };
  } finally {
    try { await db.rpc("newsify_sync_unlock"); } catch { /* unlock is best-effort after the worker run */ }
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ ok: false, error: "POST required" }, 405);
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !Deno.env.get("SUPABASE_DB_URL")) return json({ ok: false, error: "server_not_configured" }, 500);
  const expected = await vaultSecret("newsify_worker_token").catch(() => null);
  const supplied = req.headers.get("x-newsify-sync-token") ?? "";
  if (!expected || supplied !== expected) return json({ ok: false, error: "unauthorized" }, 401);
  try { return json({ ok: true, ...(await syncNewsify()) }); }
  catch (error) {
    console.error("[newsify-sync] failed", error);
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 502);
  }
});