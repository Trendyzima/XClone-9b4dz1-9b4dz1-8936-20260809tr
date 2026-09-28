import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const headers = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(JSON.stringify({ ok: true }), { headers });
  return new Response(JSON.stringify({
    ok: false,
    error: { code: "LIVEKIT_REMOVED", message: "LiveKit transport has been removed. Use Testagram Media Engine." },
  }), { status: 410, headers });
});
