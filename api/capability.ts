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
  // The browser authenticates against the canonical rebuilt project. Older Vercel
  // environments can still contain SUPABASE_URL/VITE_SUPABASE_URL from the retired
  // project; allowing those variables to override this route creates the exact
  // production symptom: media upload succeeds against canonical Auth, while post
  // creation reaches a different Auth project and returns "Authentication required".
  // Pin the capability plane to the same canonical project as the browser.
  const supabaseUrl = CANONICAL_SUPABASE_URL;
  const anonKey = CANONICAL_SUPABASE_PUBLISHABLE_KEY;
  try {
    // Remote Fediverse bookmarks use ActivityPub object URIs, not local UUIDs.
    if (capability === "testagram.bookmarks.add" || capability === "testagram.bookmarks.remove" || capability === "testagram.bookmarks.list") {
      const postId = typeof (input as { post_id?: unknown }).post_id === "string" ? (input as { post_id: string }).post_id.trim() : "";
      if (capability === "testagram.bookmarks.list") {
        const headers = { apikey: anonKey, Authorization: authorization || `Bearer ${anonKey}`, Accept: "application/json" };
        const [localResponse, remoteResponse] = await Promise.all([
          fetch(`${supabaseUrl.replace(/\/$/, "")}/rest/v1/bookmarks?select=id,post_id,created_at&order=created_at.desc&limit=100`, { headers }),
          fetch(`${supabaseUrl.replace(/\/$/, "")}/rest/v1/federated_bookmarks?select=id,object_uri,created_at&order=created_at.desc&limit=100`, { headers }),
        ]);
        if (!localResponse.ok || !remoteResponse.ok) return response({ ok: false, error: { code: "BOOKMARK_LIST_FAILED", message: "Bookmark list request failed" }, request_id: requestId }, 502);
        const localItems = await localResponse.json();
        const remoteItems = await remoteResponse.json();
        const items = [...(Array.isArray(localItems) ? localItems : []), ...(Array.isArray(remoteItems) ? remoteItems : [])].sort((a,b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0,100);
        return response({ ok: true, data: { items }, error: null, request_id: requestId });
      }
      const isRemote = /^https:\/\//i.test(postId);
      const rpc = capability === "testagram.bookmarks.add"
        ? (isRemote ? "testagram_federated_bookmark_add" : "testagram_bookmark_add")
        : (isRemote ? "testagram_federated_bookmark_remove" : "testagram_bookmark_remove");
      const rpcBody = { [isRemote ? "p_object_uri" : "p_post_id"]: postId };
      const bookmarkResponse = await fetch(`${supabaseUrl.replace(/\/$/, "")}/rest/v1/rpc/${rpc}`, {
        method: "POST", headers: { apikey: anonKey, Authorization: authorization || `Bearer ${anonKey}`, "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(rpcBody),
      });
      const raw = await bookmarkResponse.text();
      let data: unknown = null; try { data = raw ? JSON.parse(raw) : null; } catch { data = null; }
      if (!bookmarkResponse.ok) return response({ ok: false, error: { code: "BOOKMARK_FAILED", message: typeof data === "object" && data && "message" in data ? String((data as {message?: unknown}).message) : "Bookmark request failed" }, request_id: requestId }, bookmarkResponse.status >= 500 ? 502 : bookmarkResponse.status);
      return response({ ok: true, data, error: null, request_id: requestId });
    }

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