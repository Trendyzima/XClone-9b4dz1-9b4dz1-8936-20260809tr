import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-supabase-api-version",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
};

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { ...CORS, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });

function normalizeInstance(value: unknown): string {
  const raw = String(value || "mastodon.social").trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  if (!/^[a-z0-9.-]+(?::\d+)?$/i.test(raw)) throw new Error("Invalid Mastodon instance");
  return raw;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

  try {
    const auth = req.headers.get("Authorization");
    const url = new URL(req.url);
    let input: Record<string, unknown> = {};
    if (req.method !== "GET") {
      const text = await req.text();
      if (text) input = JSON.parse(text);
    }

    const action = String(input.action || url.searchParams.get("action") || "health");

    if (action === "health") {
      return json({ ok: true, service: "gateway-relay", backend: "supabase", upstream: "mastodon-compatible" });
    }

    if (action === "public_timeline") {
      const instance = normalizeInstance(input.instance || url.searchParams.get("instance"));
      const limit = Math.min(Math.max(Number(input.limit || url.searchParams.get("limit") || 20), 1), 40);
      const upstream = `https://${instance}/api/v1/timelines/public?limit=${limit}&local=true`;
      const headers: HeadersInit = { Accept: "application/json" };
      if (auth) headers.Authorization = auth;
      const response = await fetch(upstream, { headers });
      const text = await response.text();
      if (!response.ok) {
        return json({ error: "Mastodon upstream request failed", status: response.status, instance, body: text.slice(0, 1000) }, 502);
      }
      let data: unknown;
      try { data = JSON.parse(text); } catch { return json({ error: "Invalid Mastodon JSON", instance }, 502); }
      return json(Array.isArray(data) ? data : []);
    }

    return json({ error: "Unsupported gateway action", action }, 400);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Gateway failure" }, 500);
  }
});
