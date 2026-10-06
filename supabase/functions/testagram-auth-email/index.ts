import { Webhook } from "npm:standardwebhooks@1";

const BRAND_URL = "https://testagram.site";
const LOGO_URL = "https://testagram.site/app-icon.jpg";
const FROM = "Testagram <noreply@testagram.site>";

type EmailData = {
  email_action_type?: string;
  site_url?: string;
  redirect_to?: string;
  token?: string;
  token_hash?: string;
  token_new?: string;
  token_hash_new?: string;
};

const escapeHtml = (value: unknown) => String(value ?? "")
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;").replaceAll("'", "&#039;");

function safeRedirect(value: string) {
  try {
    const candidate = new URL(value || BRAND_URL);
    const site = new URL(BRAND_URL);
    if (candidate.protocol !== "https:") return BRAND_URL;
    if (candidate.hostname !== site.hostname && !candidate.hostname.endsWith(".testagram.site")) return BRAND_URL;
    return candidate.toString();
  } catch { return BRAND_URL; }
}

function actionCopy(type: string) {
  const map: Record<string, { subject: string; title: string; intro: string; button: string }> = {
    signup: { subject: "Confirm your Testagram account", title: "Welcome to Testagram", intro: "Confirm your email address to finish creating your Testagram account.", button: "Confirm email" },
    magiclink: { subject: "Your Testagram sign-in link", title: "Sign in to Testagram", intro: "Use the secure link below to sign in to your Testagram account.", button: "Sign in to Testagram" },
    recovery: { subject: "Reset your Testagram password", title: "Reset your password", intro: "We received a request to reset your Testagram password.", button: "Reset password" },
    invite: { subject: "You're invited to Testagram", title: "You're invited to Testagram", intro: "You've been invited to join Testagram.", button: "Accept invitation" },
    email_change: { subject: "Confirm your Testagram email change", title: "Confirm your email change", intro: "Confirm this email change to keep your Testagram account secure.", button: "Confirm email change" },
  };
  return map[type] ?? { subject: "Testagram account notification", title: "Testagram account", intro: "We received a request involving your Testagram account.", button: "Open Testagram" };
}

function confirmationUrl(supabaseUrl: string, tokenHash: string, type: string, redirectTo: string) {
  if (!supabaseUrl) throw new Error("SUPABASE_URL_NOT_CONFIGURED");
  const url = new URL("/auth/v1/verify", supabaseUrl);
  url.searchParams.set("token", tokenHash);
  url.searchParams.set("type", type === "magiclink" ? "magiclink" : type);
  url.searchParams.set("redirect_to", redirectTo);
  return url.toString();
}

function brandedHtml(args: { email: string; title: string; intro: string; button: string; actionUrl?: string; token?: string }) {
  const email = escapeHtml(args.email), title = escapeHtml(args.title), intro = escapeHtml(args.intro);
  const button = escapeHtml(args.button), url = args.actionUrl ? escapeHtml(args.actionUrl) : "", token = args.token ? escapeHtml(args.token) : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>
<body style="margin:0;background:#f4f7f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#172026">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">Secure Testagram account email</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f7f8;padding:32px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:20px;overflow:hidden;box-shadow:0 8px 30px rgba(0,0,0,.07)">
<tr><td style="padding:30px 30px 18px;text-align:center"><a href="${BRAND_URL}" style="text-decoration:none"><img src="${LOGO_URL}" width="72" height="72" alt="Testagram" style="display:block;margin:0 auto 12px;border-radius:18px;object-fit:cover"></a><div style="font-size:25px;font-weight:800">Testagram</div></td></tr>
<tr><td style="padding:10px 34px 34px"><h1 style="font-size:26px;line-height:1.25;margin:12px 0 14px;text-align:center">${title}</h1><p style="font-size:16px;line-height:1.65;margin:0 0 20px">Hello,</p><p style="font-size:16px;line-height:1.65;margin:0 0 22px">${intro}</p>
${url ? `<p style="text-align:center;margin:28px 0"><a href="${url}" style="display:inline-block;background:#111827;color:#fff;text-decoration:none;font-weight:700;padding:14px 24px;border-radius:12px">${button}</a></p>` : ""}
${token ? `<div style="margin:24px 0;padding:18px;text-align:center;background:#f5f6f7;border:1px solid #e5e7eb;border-radius:12px"><div style="font-size:12px;color:#667085;margin-bottom:7px">Verification code</div><div style="font-size:28px;letter-spacing:6px;font-weight:800">${token}</div></div>` : ""}
${url ? `<p style="font-size:12px;line-height:1.55;color:#667085;word-break:break-all">If the button does not work, copy this link:<br>${url}</p>` : ""}
<p style="font-size:13px;line-height:1.6;color:#667085;margin-top:26px">This email was sent to ${email}. If you did not request this, you can safely ignore it.</p></td></tr>
<tr><td style="padding:22px 30px;text-align:center;background:#f8fafb;border-top:1px solid #eef1f3"><a href="${BRAND_URL}" style="font-weight:700;color:#111827;text-decoration:none">Open Testagram</a><div style="font-size:12px;color:#98a2b3;margin-top:8px">© Testagram · Secure account communication</div></td></tr>
</table></td></tr></table></body></html>`;
}

async function sendOne(apiKey: string, to: string, subject: string, html: string, text: string) {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM, to: [to], subject, html, text }),
  });
  const body = await response.text();
  if (!response.ok) {
    console.error("RESEND_REJECTED", JSON.stringify({ status: response.status, body: body.slice(0, 500) }));
    throw new Error(`RESEND_HTTP_${response.status}`);
  }
  console.log("RESEND_ACCEPTED", JSON.stringify({ status: response.status }));
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  const requestId = crypto.randomUUID();
  try {
    if (req.method !== "POST") return new Response("not allowed", { status: 405 });

    const secretRaw = Deno.env.get("SEND_EMAIL_HOOK_SECRET") ?? "";
    const resendKey = Deno.env.get("RESEND_API_KEY") ?? "";
    if (!secretRaw || !resendKey) {
      console.error("AUTH_EMAIL_CONFIG_MISSING", JSON.stringify({ requestId, hasHookSecret: !!secretRaw, hasResendKey: !!resendKey }));
      return json({ error: "EMAIL_TRANSPORT_NOT_CONFIGURED" }, 503);
    }

    const payload = await req.text();
    if (!payload) {
      console.error("AUTH_EMAIL_EMPTY_PAYLOAD", JSON.stringify({ requestId }));
      return json({ error: "INVALID_HOOK_PAYLOAD" }, 400);
    }

    const hookSecret = secretRaw.replace(/^v1,whsec_/, "");
    const event = new Webhook(hookSecret).verify(payload, Object.fromEntries(req.headers)) as { user?: { email?: string; new_email?: string }; email_data?: EmailData };
    const user = event.user ?? {};
    const data = event.email_data ?? {};
    const actionType = String(data.email_action_type ?? "");
    const email = String(user.email ?? "");
    if (!email || !email.includes("@")) throw new Error("INVALID_RECIPIENT");

    const copy = actionCopy(actionType);
    const redirectTo = safeRedirect(String(data.redirect_to ?? data.site_url ?? BRAND_URL));
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";

    console.log("AUTH_EMAIL_EVENT", JSON.stringify({ requestId, actionType, hasToken: !!data.token, hasTokenHash: !!data.token_hash, hasNewToken: !!data.token_new, emailChange: !!user.new_email }));

    if (actionType === "email_change" && user.new_email) {
      const newEmail = String(user.new_email);
      if (!newEmail.includes("@")) throw new Error("INVALID_NEW_RECIPIENT");
      if (data.token_new && data.token_hash) {
        await sendOne(resendKey, newEmail, copy.subject, brandedHtml({ email: newEmail, title: copy.title, intro: copy.intro, button: copy.button, actionUrl: confirmationUrl(supabaseUrl, String(data.token_hash), actionType, redirectTo), token: data.token_new }), `Testagram: ${copy.intro} ${data.token_new}`);
        if (data.token && data.token_hash_new) await sendOne(resendKey, email, "Confirm your Testagram email change", brandedHtml({ email, title: "Confirm your email change", intro: "A request was made to change the email address on your Testagram account. Confirm it if this was you.", button: "Confirm email change", actionUrl: confirmationUrl(supabaseUrl, String(data.token_hash_new), actionType, redirectTo), token: data.token }), "Testagram: confirm your email change using the verification code in this email.");
      } else if (data.token_hash && (data.token || data.token_new)) {
        const token = String(data.token ?? data.token_new);
        await sendOne(resendKey, newEmail, copy.subject, brandedHtml({ email: newEmail, title: copy.title, intro: copy.intro, button: copy.button, actionUrl: confirmationUrl(supabaseUrl, String(data.token_hash), actionType, redirectTo), token }), `Testagram: ${copy.intro} ${token}`);
      } else throw new Error("INCOMPLETE_EMAIL_CHANGE_PAYLOAD");
    } else if (data.token_hash) {
      const verifyType = actionType === "signup" ? "signup" : actionType === "recovery" ? "recovery" : actionType === "invite" ? "invite" : actionType === "magiclink" ? "magiclink" : actionType;
      const url = confirmationUrl(supabaseUrl, String(data.token_hash), verifyType, redirectTo);
      await sendOne(resendKey, email, copy.subject, brandedHtml({ email, title: copy.title, intro: copy.intro, button: copy.button, actionUrl: url, token: data.token }), `Testagram: ${copy.intro} Verification code: ${data.token ?? "Use the secure link in this email."}`);
    } else {
      await sendOne(resendKey, email, copy.subject, brandedHtml({ email, title: copy.title, intro: copy.intro, button: copy.button }), `Testagram: ${copy.intro}`);
    }

    console.log("AUTH_EMAIL_SUCCESS", JSON.stringify({ requestId, actionType }));
    return json({});
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";
    console.error("AUTH_EMAIL_FAILURE", JSON.stringify({ requestId, error: message }));
    const status = message.startsWith("RESEND_HTTP_") ? 502 : message.includes("INVALID") || message.includes("Incomplete") ? 400 : 401;
    return json({ error: "AUTH_EMAIL_DELIVERY_FAILED", request_id: requestId }, status);
  }
});
