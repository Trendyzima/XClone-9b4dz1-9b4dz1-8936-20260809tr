import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.51.0";

function trustedMailUrl(value: string): string {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.hostname !== "mail.testagram.site" ||
      url.port ||
      url.username ||
      url.password ||
      (url.pathname !== "" && url.pathname !== "/") ||
      url.search ||
      url.hash
    ) return "";
    return url.origin;
  } catch {
    return "";
  }
}

const URL = Deno.env.get("SUPABASE_URL") ?? "";
const KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const MAIL_URL = trustedMailUrl(Deno.env.get("TESTAGRAM_MAIL_URL") ?? "");
const MAIL_TOKEN = Deno.env.get("TESTAGRAM_MAIL_TOKEN") ?? "";

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
const hex = (buffer: ArrayBuffer) => Array.from(new Uint8Array(buffer)).map((b) => b.toString(16).padStart(2, "0")).join("");
const eq = (a: string, b: string) => a.length === b.length && [...a].reduce((n, c, i) => n | (c.charCodeAt(0) ^ b.charCodeAt(i)), 0) === 0;
async function mac(secret: string, value: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)));
}
const esc = (v: unknown) => String(v ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!URL || !KEY || !MAIL_URL || !MAIL_TOKEN) return json({ error: "security_email_not_configured" }, 503);

  try {
    const raw = await req.text();
    const signature = req.headers.get("x-testagram-security-signature") ?? "";
    if (raw.length > 12000) return json({ error: "payload_too_large" }, 413);

    const admin = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const [{ data: secret }, { data: to }, { data: from }] = await Promise.all([
      admin.rpc("get_secret_for_worker", { secret_name: "staff_security_worker_token" }),
      admin.rpc("get_secret_for_worker", { secret_name: "testagram_security_owner_email" }),
      admin.rpc("get_secret_for_worker", { secret_name: "testagram_security_from_email" }),
    ]);
    if (typeof secret !== "string" || typeof to !== "string" || typeof from !== "string") {
      return json({ error: "security_transport_not_configured" }, 503);
    }
    if (!eq(signature, await mac(secret, raw))) return json({ error: "unauthorized" }, 401);

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
    const type = String(event.event_type ?? "audit");
    const actor = String(event.actor_username ?? "unknown");
    const target = String(event.target_username ?? actor);
    const action = String(event.action ?? "unknown");
    const created = String(event.created_at ?? new Date().toISOString());
    const subject = type === "staff_pin_reset_requested"
      ? "Testagram staff PIN reset confirmation required"
      : `Testagram security alert: ${action}`;
    const text = type === "staff_pin_reset_requested"
      ? ["A staff workspace PIN reset was requested.", "", `Actor: ${actor}`, `Time: ${created}`, `Confirmation code: ${String(event.reset_code ?? "")}`, `Code expires: ${String(event.expires_at ?? "")}`, "", "The code is required to complete the PIN reset."].join("\n")
      : ["A privileged Testagram staff action was recorded.", "", `Actor: ${actor}`, `Target: ${target}`, `Action: ${action}`, `Time: ${created}`, event.reason ? `Reason: ${event.reason}` : "", event.audit_id ? `Audit ID: ${event.audit_id}` : ""].filter(Boolean).join("\n");
    const html = `<!doctype html><html><body style="font-family:Arial,sans-serif;background:#f6f8fa;padding:24px;color:#172026"><div style="max-width:600px;margin:auto;background:#fff;border:1px solid #e5e7eb;border-radius:16px;padding:28px"><h2>Testagram privileged-access security</h2><p>${esc(subject)}</p><p><b>Actor:</b> ${esc(actor)}<br><b>Target:</b> ${esc(target)}<br><b>Action:</b> ${esc(action)}<br><b>Time:</b> ${esc(created)}</p>${type === "staff_pin_reset_requested" ? `<div style="margin:24px 0;padding:20px;text-align:center;background:#f3f4f6;border-radius:12px"><div style="font-size:12px;color:#667085">Confirmation code</div><div style="font-size:32px;font-weight:800;letter-spacing:8px">${esc(event.reset_code)}</div><div style="font-size:12px;color:#667085;margin-top:8px">Expires ${esc(event.expires_at)}</div></div>` : ""}<p style="font-size:12px;color:#667085">This message is part of Testagram's privileged-access monitoring.</p></div></body></html>`;

    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("testagram-security-email|" + raw));
    const idempotencyKey = hex(digest);
    const response = await fetch(MAIL_URL + "/emails", {
      method: "POST",
      redirect: "error",
      headers: {
        Authorization: "Bearer " + MAIL_TOKEN,
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify({ from, to: [to], subject, text, html }),
    });
    if (!response.ok) {
      console.error("SECURITY_EMAIL_REJECTED", JSON.stringify({ status: response.status }));
      throw new Error("TESTAGRAM_MAIL_HTTP_" + response.status);
    }
    return json({ ok: true });
  } catch (error) {
    console.error("SECURITY_EMAIL_FAILURE", error instanceof Error ? error.message : "unknown");
    return json({ error: "security_email_failed" }, 500);
  }
});
