import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const STK_REQUIRED = [
  "MPESA_ENV",
  "MPESA_CONSUMER_KEY",
  "MPESA_CONSUMER_SECRET",
  "MPESA_SHORTCODE",
  "MPESA_PASSKEY",
  "MPESA_USD_KES_RATE",
];

const B2C_REQUIRED = [
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

  const env = (Deno.env.get("MPESA_ENV") ?? "").trim().toLowerCase();
  const stk = STK_REQUIRED.map((key) => ({ key, configured: Boolean(Deno.env.get(key)?.trim()) }));
  const b2c = B2C_REQUIRED.map((key) => ({ key, configured: Boolean(Deno.env.get(key)?.trim()) }));

  const sandbox = env === "sandbox";
  const live = env === "live";
  const stkReady = sandbox && stk.every((item) => item.configured);
  const b2cReady = live && b2c.every((item) => item.configured);

  return new Response(JSON.stringify({
    environment: sandbox ? "sandbox" : live ? "live" : env ? "invalid" : "unconfigured",
    sandbox,
    live,
    stk: { ready: stkReady, keys: stk },
    b2c: { ready: b2cReady, keys: b2c },
    ready: stkReady,
    withdrawals_ready: b2cReady,
  }), {
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
    },
  });
});