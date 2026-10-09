import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const BASE_URL = "https://sportscore.com/api/widget/";
const ALLOWED_SPORTS = new Set(["football", "basketball", "cricket", "tennis"]);
const ATTRIBUTION = { label: "Powered by SportScore", url: "https://sportscore.com/" };
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "apikey, authorization, content-type, x-client-info",
  "Vary": "Origin",
};

function json(status: number, payload: Record<string, unknown>, cacheControl = "no-store") {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...cors, "Content-Type": "application/json; charset=utf-8", "Cache-Control": cacheControl },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "GET") return json(405, { ok: false, error: "METHOD_NOT_ALLOWED" });

  const requestUrl = new URL(req.url);
  const sport = (requestUrl.searchParams.get("sport") || "football").toLowerCase();
  const kind = (requestUrl.searchParams.get("kind") || "matches").toLowerCase();
  if (!ALLOWED_SPORTS.has(sport)) return json(400, { ok: false, error: "UNSUPPORTED_SPORT" });

  const endpoint = kind === "matches" ? "matches/" : kind === "standings" ? "standings/" : kind === "topscorers" ? "topscorers/" : "";
  if (!endpoint) return json(400, { ok: false, error: "UNSUPPORTED_KIND" });

  const params = new URLSearchParams({ sport, src: "testagram.site" });
  const rawLimit = Number(requestUrl.searchParams.get("limit") || "20");
  const limit = Math.min(50, Math.max(1, Number.isFinite(rawLimit) ? Math.floor(rawLimit) : 20));
  if (kind !== "standings") params.set("limit", String(limit));

  const slug = (requestUrl.searchParams.get("slug") || "").trim();
  if (kind !== "matches" && !/^[a-z0-9][a-z0-9-]{0,99}$/i.test(slug)) {
    return json(400, { ok: false, error: "VALID_SLUG_REQUIRED" });
  }
  if (slug) params.set("slug", slug);
  const stat = requestUrl.searchParams.get("stat");
  if (kind === "topscorers" && (stat === "goals" || stat === "assists")) params.set("stat", stat);

  try {
    const upstream = await fetch(BASE_URL + endpoint + "?" + params.toString(), {
      headers: { Accept: "application/json", "User-Agent": "Testagram Sports Hub/1.1 (+https://testagram.site)" },
      signal: AbortSignal.timeout(8000),
    });
    if (!upstream.ok) {
      console.error("[testagram-sports] provider rejected request", { status: upstream.status, sport, kind });
      return json(502, { ok: false, error: "SPORTS_PROVIDER_UNAVAILABLE", attribution: ATTRIBUTION });
    }
    const data: unknown = await upstream.json();
    return json(200, { ok: true, sport, kind, attribution: ATTRIBUTION, data }, "public, max-age=30, stale-while-revalidate=60");
  } catch (error) {
    console.error("[testagram-sports] provider request failed", error);
    return json(502, { ok: false, error: "SPORTS_PROVIDER_UNAVAILABLE", attribution: ATTRIBUTION });
  }
});
