import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { createRemoteJWKSet, jwtVerify } from "npm:jose@6";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization,apikey,content-type,x-github-oidc-token",
  "Content-Type": "application/json; charset=utf-8",
};

const timeoutMs = 2500;
const GITHUB_ISSUER = "https://token.actions.githubusercontent.com";
const GITHUB_AUDIENCE = "testagram-tv-health";
const GITHUB_REPOSITORY = "Trendyzima/XClone-9b4dz1-9b4dz1-8936-20260809tr";
const GITHUB_WORKFLOW = "TV Channel Health Monitor";
const githubJwks = createRemoteJWKSet(
  new URL("https://token.actions.githubusercontent.com/.well-known/jwks"),
);

async function authorizeGitHubActions(req: Request): Promise<boolean> {
  const token = req.headers.get("x-github-oidc-token");
  if (!token) return false;

  try {
    const { payload } = await jwtVerify(token, githubJwks, {
      issuer: GITHUB_ISSUER,
      audience: GITHUB_AUDIENCE,
      clockTolerance: 30,
    });

    return (
      payload.repository === GITHUB_REPOSITORY &&
      payload.workflow === GITHUB_WORKFLOW &&
      payload.ref === "refs/heads/main" &&
      (payload.event_name === "schedule" ||
        payload.event_name === "workflow_dispatch" ||
        payload.event_name === "push")
    );
  } catch {
    return false;
  }
}

async function probe(url: string) {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const r = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": "TestagramTV-Health/1.0",
        "Accept": "application/vnd.apple.mpegurl,application/x-mpegURL,video/*,audio/*,*/*",
        "Range": "bytes=0-2047",
      },
    });
    const type = (r.headers.get("content-type") || "").toLowerCase();
    let ok = r.ok || r.status === 206;
    if (ok && /mpegurl|m3u/.test(type)) {
      const body = await r.text();
      ok = /#EXTM3U|#EXTINF|#EXT-X-/.test(body);
    }
    return { ok, latency: Date.now() - started, error: ok ? null : "HTTP " + r.status };
  } catch (e) {
    return {
      ok: false,
      latency: Date.now() - started,
      error: e instanceof Error ? e.message : "probe failed",
    };
  } finally {
    clearTimeout(timer);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  if (!(await authorizeGitHubActions(req))) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: cors,
    });
  }

  const body = await req.json().catch(() => ({}));
  const channels = Array.isArray(body.channels) ? body.channels : [];
  const batch = channels.slice(0, Number(body.limit || 500));
  const results: any[] = [];
  let cursor = 0;

  const worker = async () => {
    while (cursor < batch.length) {
      const c = batch[cursor++];
      if (!c?.url) continue;
      const p = await probe(String(c.url));
      results.push({ channel_id: String(c.id), ...p });
    }
  };

  await Promise.all(Array.from({ length: Math.min(64, batch.length || 1) }, worker));

  const now = new Date().toISOString();
  const rows = results.map((r) => {
    const ch = batch.find((x: any) => String(x.id) === r.channel_id);
    return ch
      ? {
          channel_id: r.channel_id,
          url: String(ch.url),
          is_online: r.ok,
          last_checked_at: now,
          last_online_at: r.ok ? now : null,
          consecutive_failures: r.ok ? 0 : 1,
          consecutive_successes: r.ok ? 1 : 0,
          latency_ms: r.latency,
          check_error: r.error,
          source: ch.source || null,
          country: ch.country || null,
          group_name: ch.group || null,
          priority: Number(ch.priority || 0),
        }
      : null;
  }).filter(Boolean);

  const uniqueRows = [...new Map(rows.map((row: any) => [row.channel_id, row])).values()];

  if (uniqueRows.length) {
    const { error } = await supabase
      .from("tv_channel_health")
      .upsert(uniqueRows, { onConflict: "channel_id" });
    if (error) throw error;
  }

  return new Response(JSON.stringify({
    ok: true,
    checked: results.length,
    online: results.filter((x) => x.ok).length,
    offline: results.filter((x) => !x.ok).length,
    checked_at: new Date().toISOString(),
  }), { headers: cors });
});
