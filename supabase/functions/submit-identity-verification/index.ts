import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const cors = {
  "Access-Control-Allow-Origin": "https://testagram.site",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  return new Response(JSON.stringify({
    ok: false,
    error: "LEGACY_ID_UPLOAD_DISABLED",
    message: "Testagram no longer accepts or stores national-ID photos. New account verification is handled by the Didit identity-first flow.",
  }), { status: 410, headers: cors });
});
