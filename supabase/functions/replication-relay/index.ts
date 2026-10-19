const encoder = new TextEncoder();

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function sign(secret: string, timestamp: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const prefix = encoder.encode(timestamp + ".");
  const bytes = encoder.encode(body);
  const message = new Uint8Array(prefix.length + bytes.length);
  message.set(prefix);
  message.set(bytes, prefix.length);
  const mac = await crypto.subtle.sign("HMAC", key, message);
  return "sha256=" + [...new Uint8Array(mac)].map((v) => v.toString(16).padStart(2, "0")).join("");
}

async function rpc(base: string, serviceKey: string, name: string, args: Record<string, unknown>) {
  return await fetch(base + "/rest/v1/rpc/" + name, {
    method: "POST",
    headers: { apikey: serviceKey, authorization: "Bearer " + serviceKey, "content-type": "application/json" },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(8000),
  });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
  const relayToken = Deno.env.get("REPLICATION_RELAY_TOKEN") ?? "";
  const authorization = req.headers.get("authorization") ?? "";
  if (relayToken.length < 32 || !constantTimeEqual(authorization, "Bearer " + relayToken)) {
    return new Response("unauthorized", { status: 401 });
  }
  const supabaseUrl = (Deno.env.get("SUPABASE_URL") ?? "").replace(/\/$/, "");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const peerUrl = Deno.env.get("REPLICATION_PEER_URL") ?? "";
  const localOrigin = Deno.env.get("REPLICATION_ORIGIN") ?? "";
  const peerKey = Deno.env.get("REPLICATION_PEER_KEY") ?? "";
  if (!supabaseUrl || !serviceKey || !peerUrl.startsWith("https://") || !localOrigin || peerKey.length < 32) {
    return new Response("replication not configured", { status: 503 });
  }

  const claimed = await rpc(supabaseUrl, serviceKey, "claim_platform_replication_outbox", { p_limit: 20, p_lease_seconds: 300 });
  if (!claimed.ok) return new Response("outbox unavailable", { status: 503 });
  const events = await claimed.json().catch(() => null);
  if (!Array.isArray(events)) return new Response("invalid outbox response", { status: 503 });

  let delivered = 0;
  let retried = 0;
  for (const row of events) {
    const event = {
      id: row.event_id,
      origin: row.origin,
      entity_type: row.entity_type,
      entity_id: row.entity_id,
      entity_version: row.entity_version,
      schema_version: row.schema_version,
      event_type: row.event_type,
      occurred_at: row.occurred_at,
      payload: row.payload,
    };
    if (event.origin !== localOrigin) {
      await rpc(supabaseUrl, serviceKey, "retry_platform_replication_event", { p_event_id: row.event_id, p_error_code: "origin_mismatch" }).catch(() => null);
      retried++;
      continue;
    }
    const body = JSON.stringify(event);
    if (encoder.encode(body).byteLength > 1_048_576) {
      await rpc(supabaseUrl, serviceKey, "retry_platform_replication_event", { p_event_id: row.event_id, p_error_code: "event_too_large" }).catch(() => null);
      retried++;
      continue;
    }
    const timestamp = Math.floor(Date.now() / 1000).toString();
    let response: Response | null = null;
    try {
      response = await fetch(peerUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-replication-origin": localOrigin,
          "x-replication-timestamp": timestamp,
          "x-replication-signature": await sign(peerKey, timestamp, body),
        },
        body,
        redirect: "error",
        signal: AbortSignal.timeout(8000),
      });
    } catch {
      response = null;
    }
    if (response && response.status >= 200 && response.status < 300) {
      const marked = await rpc(supabaseUrl, serviceKey, "mark_platform_replication_delivered", { p_event_id: row.event_id }).catch(() => null);
      const markedValue = marked?.ok ? await marked.json().catch(() => false) : false;
      if (marked?.ok && markedValue === true) delivered++;
      else retried++;
    } else {
      const code = response ? "peer_http_" + response.status : "peer_unreachable";
      await rpc(supabaseUrl, serviceKey, "retry_platform_replication_event", { p_event_id: row.event_id, p_error_code: code }).catch(() => null);
      retried++;
    }
  }

  return new Response(JSON.stringify({ claimed: events.length, delivered, retried }), {
    status: 200,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
});
