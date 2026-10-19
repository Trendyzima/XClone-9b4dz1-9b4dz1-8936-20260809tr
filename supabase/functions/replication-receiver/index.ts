import { isValidReplicationEvent, MAX_REPLICATION_BODY_BYTES } from "../_shared/replication-contract.ts";

const encoder = new TextEncoder();
const MAX_BODY = MAX_REPLICATION_BODY_BYTES;

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" },
  });
}

async function readBoundedBody(req: Request, limit: number): Promise<Uint8Array> {
  if (!req.body) throw new Error("empty_body");
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      throw new Error("body_too_large");
    }
    chunks.push(value);
  }
  if (total === 0) throw new Error("empty_body");
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

async function hmacHex(secret: string, timestamp: string, body: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const prefix = encoder.encode(timestamp + ".");
  const combined = new Uint8Array(prefix.length + body.length);
  combined.set(prefix);
  combined.set(body, prefix.length);
  // The protocol signs timestamp + "." + exact raw request body.
  const mac = await crypto.subtle.sign("HMAC", key, combined);
  return [...new Uint8Array(mac)].map((v) => v.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return jsonResponse(405, { error: "method_not_allowed" });
  const origin = req.headers.get("x-replication-origin") ?? "";
  const timestamp = req.headers.get("x-replication-timestamp") ?? "";
  const signature = (req.headers.get("x-replication-signature") ?? "").replace(/^sha256=/, "");
  if (!IDENTITY.test(origin)) return jsonResponse(401, { error: "unauthorized_peer" });

  const peerKeysRaw = Deno.env.get("REPLICATION_PEER_KEYS_JSON") ?? "";
  let peerKeys: Record<string, string>;
  try { peerKeys = JSON.parse(peerKeysRaw); } catch { return jsonResponse(503, { error: "replication_not_configured" }); }
  const secret = peerKeys[origin];
  if (typeof secret !== "string" || encoder.encode(secret).byteLength < 32) return jsonResponse(401, { error: "unauthorized_peer" });

  const timestampNumber = Number(timestamp);
  if (!/^\d{10}$/.test(timestamp) || !Number.isSafeInteger(timestampNumber) || Math.abs(Date.now() / 1000 - timestampNumber) > 300) {
    return jsonResponse(401, { error: "invalid_timestamp" });
  }
  let bodyBuffer: Uint8Array;
  try { bodyBuffer = await readBoundedBody(req, MAX_BODY); }
  catch (error) {
    return jsonResponse(String(error).includes("body_too_large") ? 413 : 400, { error: String(error).includes("body_too_large") ? "body_too_large" : "empty_body" });
  }
  const expected = await hmacHex(secret, timestamp, bodyBuffer);
  if (!/^[0-9a-f]{64}$/i.test(signature) || !constantTimeEqual(signature.toLowerCase(), expected)) return jsonResponse(401, { error: "invalid_signature" });

  let event: any;
  try { event = JSON.parse(new TextDecoder().decode(bodyBuffer)); } catch { return jsonResponse(400, { error: "invalid_json" }); }
  if (!isValidReplicationEvent(event)) return jsonResponse(400, { error: "invalid_event" });
  if (event.origin !== origin) return jsonResponse(403, { error: "origin_mismatch" });

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !serviceKey) return jsonResponse(503, { error: "replication_storage_not_configured" });
  const canonicalEvent = {
    id: event.id, origin: event.origin, entity_type: event.entity_type, entity_id: event.entity_id,
    entity_version: event.entity_version, schema_version: event.schema_version,
    event_type: event.event_type, occurred_at: event.occurred_at, payload: event.payload,
  };
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(JSON.stringify(canonicalEvent)));
  const hashHex = [...new Uint8Array(digest)].map((v) => v.toString(16).padStart(2, "0")).join("");
  const record = {
    event_id: event.id, origin: event.origin, entity_type: event.entity_type,
    entity_id: event.entity_id, entity_version: event.entity_version,
    schema_version: event.schema_version, event_type: event.event_type,
    payload_hash: "\\x" + hashHex, payload: event,
    outcome: "received",
  };
  const base = supabaseUrl.replace(/\/$/, "") + "/rest/v1/platform_replication_inbox";
  const headers = { apikey: serviceKey, authorization: "Bearer " + serviceKey, "content-type": "application/json" };
  const inserted = await fetch(base + "?on_conflict=event_id", {
    method: "POST", headers: { ...headers, prefer: "resolution=ignore-duplicates,return=representation" }, body: JSON.stringify(record),
  });
  if (inserted.status === 409) return jsonResponse(409, { error: "entity_version_conflict" });
  if (!inserted.ok) return jsonResponse(503, { error: "replication_storage_unavailable" });
  const rows = await inserted.json().catch(() => []);
  if (Array.isArray(rows) && rows.length > 0) return jsonResponse(202, { status: "queued" });

  const existingResponse = await fetch(base + "?event_id=eq." + encodeURIComponent(event.id) + "&select=payload_hash,outcome", { headers });
  if (!existingResponse.ok) return jsonResponse(503, { error: "replication_storage_unavailable" });
  const existing = await existingResponse.json().catch(() => []);
  if (!Array.isArray(existing) || existing.length !== 1) return jsonResponse(503, { error: "replication_receipt_unavailable" });
  const storedHash = String(existing[0].payload_hash ?? "").replace(/^\\x/, "").toLowerCase();
  if (storedHash !== hashHex) return jsonResponse(409, { error: "event_id_payload_conflict" });
  return jsonResponse(200, { status: existing[0].outcome === "applied" ? "duplicate" : "queued" });
});
