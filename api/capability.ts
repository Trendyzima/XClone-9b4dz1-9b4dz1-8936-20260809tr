export const config = { runtime: "edge" };

const CANONICAL_SUPABASE_URL = "https://ffrhglgkukgsuhxenena.supabase.co";
// Publishable keys are safe for browser/public API use. Keep this canonical fallback
// so the capability route cannot fail merely because Vercel omitted a public env var.
const CANONICAL_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_h51Z3EHP2LN5o7HdRAB3Og_uhUA3oya";
const PUBLIC_CAPABILITIES = new Set(["testagram.capabilities.list", "testagram.health.read"]);
const PUBLIC_CACHE = "public, max-age=0, s-maxage=60, stale-while-revalidate=300";

function response(body: unknown, status = 200, cacheable = false) {
  const headers = new Headers({ "content-type": "application/json; charset=utf-8", "cache-control": cacheable ? PUBLIC_CACHE : "private, no-store", "x-content-type-options": "nosniff" });
  if (cacheable) { headers.set("CDN-Cache-Control", PUBLIC_CACHE); headers.set("Vercel-CDN-Cache-Control", PUBLIC_CACHE); headers.set("Vercel-Cache-Tag", "testagram-public-capability"); }
  return new Response(JSON.stringify(body), { status, headers });
}

export default async function handler(request: Request) {
  if (request.method !== "POST") return response({ ok: false, error: { code: "METHOD_NOT_ALLOWED", message: "POST required" } }, 405);
  const requestId = request.headers.get("x-request-id") || crypto.randomUUID();
  let body: { capability?: unknown; input?: unknown };
  try { body = await request.json(); } catch { return response({ ok: false, error: { code: "INVALID_JSON", message: "Request body must be JSON" }, request_id: requestId }, 400); }
  const capability = typeof body.capability === "string" ? body.capability.trim() : "";
  const input = body.input && typeof body.input === "object" && !Array.isArray(body.input) ? body.input : {};
  if (!capability) return response({ ok: false, error: { code: "CAPABILITY_REQUIRED", message: "Capability name is required" }, request_id: requestId }, 400);
  const authorization = request.headers.get("authorization");
  const isPublic = PUBLIC_CAPABILITIES.has(capability);
  if (!isPublic && !authorization?.startsWith("Bearer ")) return response({ ok: false, error: { code: "AUTH_REQUIRED", message: "Authentication required" }, request_id: requestId }, 401);
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || CANONICAL_SUPABASE_URL;
  const anonKey = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || CANONICAL_SUPABASE_PUBLISHABLE_KEY;
  if (!anonKey) return response({ ok: false, error: { code: "SUPABASE_CONFIG_MISSING", message: "Supabase public configuration is missing" }, request_id: requestId }, 500);
  try {
    const upstream = await fetch(`${supabaseUrl.replace(/\/$/, "")}/rest/v1/rpc/capability_dispatch`, {
      method: "POST",
      headers: { apikey: anonKey, Authorization: authorization || `Bearer ${anonKey}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ p_capability: capability, p_input: input }),
    });
    const raw = await upstream.text();
    let data: unknown = null; try { data = raw ? JSON.parse(raw) : null; } catch { data = null; }
    if (!upstream.ok) {
      const message = typeof data === "object" && data && "message" in data ? String((data as {message?: unknown}).message) : "Capability database request failed";
      const status = upstream.status === 401 || upstream.status === 403 ? upstream.status : upstream.status >= 500 ? 502 : 400;
      return response({ ok: false, error: { code: upstream.status === 401 || upstream.status === 403 ? "AUTH_REQUIRED" : "CAPABILITY_DISPATCH_FAILED", message }, request_id: requestId }, status);
    }
    return response({ ok: true, data, error: null, request_id: requestId }, 200, isPublic);
  } catch { return response({ ok: false, error: { code: "DATABASE_UNAVAILABLE", message: "Capability database unavailable" }, request_id: requestId }, 502); }
}