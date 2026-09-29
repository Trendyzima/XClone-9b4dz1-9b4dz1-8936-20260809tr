import "jsr:@supabase/functions-js/edge-runtime.d.ts";

Deno.serve(async req => {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Cache-Control": "no-store",
  };
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  return new Response(JSON.stringify({
    ok: false,
    error: {
      code: "MEDIA_TOKEN_RETIRED",
      message: "The legacy media-token transport is retired. TV uses native WebRTC through tv-media-control; other legacy media-engine transport is no longer supported.",
    },
  }), {
    status: 410,
    headers: { "Content-Type": "application/json", ...cors },
  });
});
