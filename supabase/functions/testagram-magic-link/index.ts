import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const BRAND_URL = "https://testagram.site";
const FROM = "Testagram <noreply@testagram.site>";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function normalizeEmail(value: unknown) {
  const email = String(value ?? "").trim().toLowerCase();
  if (!email || email.length > 320 || !/^\S+@\S+\.\S+$/.test(email)) throw new Error("INVALID_EMAIL");
  return email;
}

function safeRedirect(value: unknown) {
  try {
    const candidate = new URL(String(value || BRAND_URL + "/auth"));
    const site = new URL(BRAND_URL);
    if (candidate.protocol !== "https:") return BRAND_URL + "/auth";
    if (candidate.hostname !== site.hostname && !candidate.hostname.endsWith(".testagram.site")) return BRAND_URL + "/auth";
    return candidate.toString();
  } catch { return BRAND_URL + "/auth"; }
}

function escapeHtml(value: unknown) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function brandedHtml(email: string, actionUrl: string) {
  const safeEmail = escapeHtml(email);
  const safeUrl = escapeHtml(actionUrl);
  return "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>Sign in to Testagram</title></head>" +
    "<body style=\"margin:0;background:#f4f7f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#172026\">" +
    "<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" style=\"background:#f4f7f8;padding:32px 12px\"><tr><td align=\"center\">" +
    "<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" style=\"max-width:560px;background:#fff;border-radius:20px;overflow:hidden\">" +
    "<tr><td style=\"padding:30px;text-align:center\"><a href=\"" + BRAND_URL + "\"><img src=\"https://testagram.site/app-icon.jpg\" width=\"72\" height=\"72\" alt=\"Testagram\" style=\"border-radius:18px\"></a><div style=\"font-size:25px;font-weight:800;margin-top:12px\">Testagram</div></td></tr>" +
    "<tr><td style=\"padding:10px 34px 34px\"><h1 style=\"font-size:26px;line-height:1.25;text-align:center\">Sign in to Testagram</h1>" +
    "<p style=\"font-size:16px;line-height:1.65\">Hello,</p><p style=\"font-size:16px;line-height:1.65\">Use the secure link below to sign in to your Testagram account. No verification code is required.</p>" +
    "<p style=\"text-align:center;margin:28px 0\"><a href=\"" + safeUrl + "\" style=\"display:inline-block;background:#111827;color:#fff;text-decoration:none;font-weight:700;padding:14px 24px;border-radius:12px\">Sign in to Testagram</a></p>" +
    "<p style=\"font-size:12px;line-height:1.55;color:#667085;word-break:break-all\">If the button does not work, copy this secure link:<br>" + safeUrl + "</p>" +
    "<p style=\"font-size:13px;line-height:1.6;color:#667085;margin-top:26px\">This email was sent to " + safeEmail + ". If you did not request this, you can safely ignore this email.</p></td></tr>" +
    "<tr><td style=\"padding:22px 30px;text-align:center;background:#f8fafb;border-top:1px solid #eef1f3\"><a href=\"" + BRAND_URL + "\" style=\"font-weight:700;color:#111827;text-decoration:none\">Open Testagram</a><div style=\"font-size:12px;color:#98a2b3;margin-top:8px\">© Testagram · Secure account communication</div></td></tr>" +
    "</table></td></tr></table></body></html>";
}

async function generateMagicLink(supabaseUrl: string, adminKey: string, email: string, redirectTo: string) {
  const response = await fetch(supabaseUrl + "/auth/v1/admin/generate_link", {
    method: "POST",
    headers: { apikey: adminKey, Authorization: "Bearer " + adminKey, "Content-Type": "application/json" },
    body: JSON.stringify({ type: "magiclink", email, redirect_to: redirectTo }),
  });
  const body = await response.text();
  if (!response.ok) {
    console.error("MAGIC_LINK_GENERATE_REJECTED", JSON.stringify({ status: response.status, body: body.slice(0, 500) }));
    throw new Error("GENERATE_LINK_HTTP_" + response.status);
  }
  let parsed: { action_link?: string; actionLink?: string };
  try { parsed = JSON.parse(body); } catch { throw new Error("GENERATE_LINK_INVALID_RESPONSE"); }
  const actionLink = parsed.action_link ?? parsed.actionLink;
  if (!actionLink) throw new Error("GENERATE_LINK_MISSING_ACTION_LINK");
  return actionLink;
}

async function sendEmail(resendKey: string, email: string, actionUrl: string) {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: "Bearer " + resendKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: FROM,
      to: [email],
      subject: "Your Testagram sign-in link",
      html: brandedHtml(email, actionUrl),
      text: "Use this secure Testagram sign-in link: " + actionUrl + "\n\nIf you did not request this, you can safely ignore this email.",
    }),
  });
  const body = await response.text();
  if (!response.ok) {
    console.error("MAGIC_LINK_RESEND_REJECTED", JSON.stringify({ status: response.status, body: body.slice(0, 500) }));
    throw new Error("RESEND_HTTP_" + response.status);
  }
  console.log("MAGIC_LINK_RESEND_ACCEPTED", JSON.stringify({ status: response.status }));
}

Deno.serve(async (req) => {
  const requestId = crypto.randomUUID();
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const adminKey = Deno.env.get("SUPABASE_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const resendKey = Deno.env.get("RESEND_API_KEY") ?? "";
    if (!supabaseUrl || !adminKey || !resendKey) {
      console.error("MAGIC_LINK_CONFIG_MISSING", JSON.stringify({ requestId, hasSupabaseUrl: !!supabaseUrl, hasAdminKey: !!adminKey, hasResendKey: !!resendKey }));
      return json({ error: "EMAIL_TRANSPORT_NOT_CONFIGURED" }, 503);
    }

    const body = await req.json();
    const email = normalizeEmail(body?.email);
    const redirectTo = safeRedirect(body?.redirect_to);

    // Deliberately bypass the /auth/v1/otp email-send path. generate_link creates
    // the Auth magic-link state; Resend is the only email transport.
    const actionLink = await generateMagicLink(supabaseUrl, adminKey, email, redirectTo);
    await sendEmail(resendKey, email, actionLink);

    console.log("MAGIC_LINK_SENT", JSON.stringify({ requestId }));
    return json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";
    console.error("MAGIC_LINK_FAILURE", JSON.stringify({ requestId, error: message }));
    const status = message === "INVALID_EMAIL" ? 400 : message.startsWith("RESEND_HTTP_") ? 502 : message.startsWith("GENERATE_LINK_HTTP_") ? 502 : 500;
    return json({ error: "MAGIC_LINK_SEND_FAILED", request_id: requestId }, status);
  }
});
