import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const REQUIRED = [
  "MPESA_CONSUMER_KEY",
  "MPESA_CONSUMER_SECRET",
  "MPESA_SHORTCODE",
  "MPESA_PASSKEY",
  "MPESA_B2C_SHORTCODE",
  "MPESA_INITIATOR_NAME",
  "MPESA_SECURITY_CRED",
];

Deno.serve(async (req: Request) => {
  if (!req.headers.get("authorization")) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }

  const configured = REQUIRED.filter((key) => Boolean(Deno.env.get(key)?.trim()));

  return new Response(JSON.stringify({
    configured: configured.length,
    total: REQUIRED.length,
    ready: configured.length === REQUIRED.length,
    keys: REQUIRED.map((key) => ({ key, configured: configured.includes(key) })),
  }), {
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
    },
  });
});
