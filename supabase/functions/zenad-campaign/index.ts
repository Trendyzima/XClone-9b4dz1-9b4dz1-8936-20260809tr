import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json({ error: "POST required" }, 405);
  if (!SUPABASE_URL) return json({ error: "Ad service is not configured" }, 503);
  try {
    // Compatibility endpoint only: Testagram owns campaign creation now.
    const body = await req.text();
    const response = await fetch(`${SUPABASE_URL}/functions/v1/testagram-ad-campaign`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(req.headers.get("Authorization") ? { Authorization: req.headers.get("Authorization")! } : {}),
      },
      body,
    });
    const payload = await response.json().catch(() => ({ error: "Campaign service returned invalid JSON" }));
    return json({ ...payload, owner: "testagram", compatibility: "zenad-campaign" }, response.status);
  } catch (error) {
    console.error("zenad-campaign compatibility proxy", error);
    return json({ error: "Campaign service unavailable" }, 502);
  }
});
