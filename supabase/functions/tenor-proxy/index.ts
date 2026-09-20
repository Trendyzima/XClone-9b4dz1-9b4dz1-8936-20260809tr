import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const url = new URL(req.url);
    const q = (url.searchParams.get("q") || "").trim();
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || "20"), 1), 50);
    const apiKey = Deno.env.get("TENOR_API_KEY");

    if (!apiKey) {
      return new Response(JSON.stringify({ results: [], error: "TENOR_API_KEY is not configured" }), {
        status: 503,
        headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" },
      });
    }

    const endpoint = q
      ? "https://tenor.googleapis.com/v2/search"
      : "https://tenor.googleapis.com/v2/featured";

    const params = new URLSearchParams({
      key: apiKey,
      client_key: "testagram",
      limit: String(limit),
      media_filter: "nanogif,tinygif,mediumgif,gif",
      contentfilter: "medium",
      locale: "en_KE",
      country: "KE",
    });
    if (q) params.set("q", q);

    const upstream = await fetch(endpoint + "?" + params.toString(), {
      headers: { Accept: "application/json" },
    });

    const body = await upstream.text();
    return new Response(body, {
      status: upstream.status,
      headers: {
        ...cors,
        "Content-Type": upstream.headers.get("content-type") || "application/json",
        "Cache-Control": q ? "public, max-age=120, s-maxage=300" : "public, max-age=300, s-maxage=600",
      },
    });
  } catch (error) {
    return new Response(JSON.stringify({ results: [], error: error instanceof Error ? error.message : "GIF proxy failed" }), {
      status: 502,
      headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }
});
