import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.51.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const OWNER_EMAIL = "nahashonnyaga794@gmail.com";
const FROM = "Testagram Security <noreply@testagram.site>";

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function hex(buffer: ArrayBuffer) {
  return Array.from(new Uint8Array(buffer)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function hmac(secret: string, value: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)));
}

function escapeHtml(value: unknown) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

async function sendEmail(subject: string, text: string, html: string, idempotencyKey: string) {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM, to: [OWNER_EMAIL], subject, text, html }),
  });
  if (!response.ok) {
    const body = await response.text();
    console.error("SECURITY_EMAIL_REJECTED", JSON.stringify({ status: response.status, body: body.slice(0, 500), idempotencyKey }));
    throw new Error(`RESEND_HTTP_${response.status}`);
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !RESEND_API_KEY) return json({ error: "security_email_not_configured" }, 503);

  try {
    const raw = await req.text();
    if (raw.length > 12000) return json({ error: "payload_too_large" }, 413);
    const signature = req.headers.get("x-testagram-security-signature") ?? "";
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: secret, error: secretError } = await admin.rpc("get_secret_for_worker", { secret_name: "staff_security_worker_token" });
    if (secretError || typeof secret !== "string" || !secret) return json({ error: "security_transport_not_configured" }, 503);
    const expected = await hmac(secret, raw);
    if (!constantTimeEqual(signature, expected)) return json({ error: "unauthorized" }, 401);

    const event = JSON.parse(raw) as {
      event_type?: string;
      audit_id?: string;
      actor_username?: string;
      target_username?: string;
      action?: string;
      reason?: string | null;
      created_at?: string;
      metadata?: Record<string, unknown>;
      reset_code?: string;
      expires_at?: string;
    };

    const eventType = String(event.event_type ?? "audit");
    const action = String(event.action ?? "unknown");
    const actor = String(event.actor_username ?? "unknown");
    const target = String(event.target_username ?? actor);
    const createdAt = String(event.created_at ?? new Date().toISOString());
    const safeMetadata = event.metadata && typeof event.metadata === "object" ? event.metadata : {};

    let subject = `Testagram security alert: ${action}`;
    let title = "Privileged staff activity detected";
    let body = [
      "A privileged Testagram staff action was recorded.",
      "",
      `Actor: ${actor}`,
      `Target: ${target}`,
      `Action: ${action}`,
      `Time: ${createdAt}`,
      event.reason ? `Reason: ${event.reason}` : "",
      event.audit_id ? `Audit ID: ${event.audit_id}` : "",
    ].filter(Boolean).join("\n");

    if (eventType === "staff_pin_reset_requested") {
      const code = String(event.reset_code ?? "");
      subject = "Testagram staff PIN reset confirmation required";
      title = "Staff PIN reset requested";
      body = [
        "A staff workspace PIN reset was requested.",
        "",
        `Actor: ${actor}`,
        `Time: ${createdAt}`,
        `Confirmation code: ${code}`,
        `Code expires: ${String(event.expires_at ?? "soon")}`,
        "",
        "Do not forward this code to anyone you do not trust. The code is required to complete the PIN reset.",
      ].join("\n");
    }

    const html = `<!doctype html><html><body style="font-family:Arial,sans-serif;background:#f6f8fa;padding:24px;color:#172026">
      <div style="max-width:600px;margin:auto;background:#fff;border:1px solid #e5e7eb;border-radius:16px;padding:28px">
      <h2>${escapeHtml(title)}</h2>
      <p>This message is part of Testagram's privileged-access security monitoring.</p>
      <table style="width:100%;border-collapse:collapse">
      <tr><td><b>Actor</b></td><td>${escapeHtml(actor)}</td></tr>
      <tr><td><b>Target</b></td><td>${escapeHtml(target)}</td></tr>
      <tr><td><b>Action</b></td><td>${escapeHtml(action)}</td></tr>
      <tr><td><b>Time</b></td><td>${escapeHtml(createdAt)}</td></tr>
      ${event.audit_id ? `<tr><td><b>Audit ID</b></td><td>${escapeHtml(event.audit_id)}</td></tr>` : ""}
      </table>
      ${eventType === "staff_pin_reset_requested" ? `<div style="margin:24px 0;padding:20px;text-align:center;background:#f3f4f6;border-radius:12px"><div style="font-size:12px;color:#667085">Confirmation code</div><div style="font-size:32px;font-weight:800;letter-spacing:8px">${escapeHtml(event.reset_code)}</div><div style="font-size:12px;color:#667085;margin-top:8px">Expires ${escapeHtml(event.expires_at)}</div></div>` : ""}
      <p style="font-size:13px;color:#667085">Metadata: ${escapeHtml(JSON.stringify(safeMetadata))}</p>
      </div></body></html>`;

    await sendEmail(subject, body, html, event.audit_id ?? crypto.randomUUID());
    return json({ ok: true });
  } catch (error) {
    console.error("SECURITY_EMAIL_FAILURE", error);
    return json({ error: "security_email_failed" }, 500);
  }
});
