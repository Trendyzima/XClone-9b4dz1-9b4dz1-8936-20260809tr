import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  AP_CONTEXT,
  actorId,
  idOf,
  isSupportedActivity,
  typeOf,
} from "../_shared/activitypub-conformance.ts";
import {
  assertCanonicalPublicUrl,
  assertSafeRemoteUrl,
  canonicalOrigin,
} from "../_shared/activitypub-security.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SECRET_KEY") || "";
const ORIGIN = canonicalOrigin();
const CTX = [AP_CONTEXT, "https://w3id.org/security/v1"];
const AP = 'application/ld+json; profile="https://www.w3.org/ns/activitystreams", application/activity+json';
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-federation-internal",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
};

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { ...CORS, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
});
const enc = (value: string) => encodeURIComponent(value);

async function db(path: string, init: RequestInit = {}) {
  if (!SERVICE_KEY) throw Error("Federation service credential is not configured");
  const headers = new Headers(init.headers);
  headers.set("apikey", SERVICE_KEY);
  headers.set("Authorization", `Bearer ${SERVICE_KEY}`);
  headers.set("Content-Type", "application/json");
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...init, headers });
  if (!response.ok) throw Error(`database ${response.status}: ${(await response.text()).slice(0, 800)}`);
  return response;
}

function internal(request: Request) {
  const token = request.headers.get("x-federation-internal");
  const authorization = request.headers.get("authorization");
  return Boolean(SERVICE_KEY && (token === SERVICE_KEY || authorization === `Bearer ${SERVICE_KEY}`));
}

async function actorForUser(userId: string) {
  const actorResponse = await db(`activitypub_actors?user_id=eq.${enc(userId)}&select=*`);
  const actors = await actorResponse.json() as any[];
  const actor = actors[0];
  if (!actor) throw Error("Local ActivityPub actor not found");

  const keyResponse = await db(`activitypub_keys?user_id=eq.${enc(userId)}&select=*`);
  const keys = await keyResponse.json() as any[];
  const key = keys[0];
  if (!key?.private_key_pem) throw Error("Local ActivityPub signing key not found");

  return {
    ...actor,
    actor_url: actor.actor_id,
    private_key_pem: key.private_key_pem,
    public_key_pem: key.public_key_pem,
    key_id: key.key_id,
  };
}

function assertLocalActor(actor: any) {
  const actorUrl = String(actor?.actor_url || "");
  assertCanonicalPublicUrl(actorUrl);
  if (!actor?.private_key_pem) throw Error("Local ActivityPub actor has no private signing key");
  return actorUrl;
}

function base64(bytes: ArrayBuffer) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)));
}

async function sha256Base64(value: string) {
  return base64(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

function pemToArrayBuffer(pem: string) {
  const base64Body = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\\s+/g, "");
  const binary = atob(base64Body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function rsaSign(local: any, value: string) {
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(local.private_key_pem),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return base64(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(value)));
}

/** Legacy Cavage signature retained for Mastodon <=4.4 and broad compatibility. */
async function legacyHeaders(local: any, url: string, method: "GET" | "POST", body = "") {
  const target = new URL(url);
  const date = new Date().toUTCString();
  const digest = body ? `SHA-256=${await sha256Base64(body)}` : "";
  const lines = [
    `(request-target): ${method.toLowerCase()} ${target.pathname}${target.search}`,
    `host: ${target.host}`,
    `date: ${date}`,
  ];
  if (body) lines.push(`digest: ${digest}`);
  const signature = await rsaSign(local, lines.join("\n"));
  const headers: Record<string, string> = {
    Date: date,
    Accept: AP,
    "User-Agent": "Testagram-Federation/4.0",
    Signature: `keyId="${local.actor_url}#main-key",algorithm="rsa-sha256",headers="${lines.map((line) => line.split(":")[0]).join(" ")}",signature="${signature}"`,
  };
  if (body) {
    headers.Digest = digest;
    headers["Content-Type"] = 'application/ld+json; profile="https://www.w3.org/ns/activitystreams"';
  }
  return headers;
}

/** RFC9421 signer for newer Mastodon implementations. */
async function rfc9421Headers(local: any, url: string, method: "GET" | "POST", body = "") {
  const target = new URL(url);
  const created = Math.floor(Date.now() / 1000);
  const components = ["@method", "@target-uri", "host"];
  const digest = body ? `sha-256=:${await sha256Base64(body)}:` : "";
  if (body) components.push("content-digest");
  const covered = components.map((component) => {
    if (component === "@method") return `"@method": ${method}`;
    if (component === "@target-uri") return `"@target-uri": ${target.toString()}`;
    if (component === "host") return `"host": ${target.host}`;
    return `"content-digest": ${digest}`;
  }).join("\n");
  const signatureParams = `(${components.map((component) => `"${component}"`).join(" ")});created=${created};keyid="${local.actor_url}#main-key";alg="rsa-v1_5-sha256"`;
  const signature = await rsaSign(local, `${covered}\n"@signature-params": ${signatureParams}`);
  const headers: Record<string, string> = {
    Accept: AP,
    "User-Agent": "Testagram-Federation/4.0",
    "Signature-Input": `sig1=${signatureParams}`,
    Signature: `sig1=:${signature}:`,
  };
  if (body) {
    headers["Content-Digest"] = digest;
    headers["Content-Type"] = 'application/ld+json; profile="https://www.w3.org/ns/activitystreams"';
  }
  return headers;
}

async function signedFetch(local: any, url: string, method: "GET" | "POST", body = "") {
  assertSafeRemoteUrl(url);
  const legacy = await legacyHeaders(local, url, method, body);
  const requestInit: RequestInit = { method, headers: legacy };
  if (body) requestInit.body = body;
  let response = await fetch(url, requestInit);

  // Mastodon 4.5+ supports RFC9421; use it when legacy authentication is rejected.
  if ((response.status === 400 || response.status === 401) && method === "GET") {
    const modern = await rfc9421Headers(local, url, method, body);
    response = await fetch(url, { method, headers: modern });
  }
  return response;
}

async function remoteActor(local: any, url: string) {
  assertSafeRemoteUrl(url);
  const response = await signedFetch(local, url, "GET");
  const text = await response.text();
  if (!response.ok) throw Error(`remote actor ${response.status}: ${text.slice(0, 1200)}`);
  const actor = JSON.parse(text);
  if (!actor?.id || !actor?.inbox || !actor?.publicKey?.publicKeyPem) {
    throw Error("Remote actor does not satisfy ActivityPub actor contract");
  }
  if (String(actor.id) !== String(url)) throw Error("Remote actor id does not match requested actor URL");
  assertSafeRemoteUrl(String(actor.id));
  assertSafeRemoteUrl(String(actor.inbox));
  if (actor.endpoints?.sharedInbox) assertSafeRemoteUrl(String(actor.endpoints.sharedInbox));
  return actor;
}

async function resolve(local: any, target: string) {
  assertLocalActor(local);
  let actorUrl = String(target || "").trim().replace(/^@/, "");
  if (!actorUrl.startsWith("http://") && !actorUrl.startsWith("https://")) {
    const parts = actorUrl.split("@");
    if (parts.length !== 2 || !parts[0] || !parts[1]) throw Error("Expected @user@domain or ActivityPub actor URL");
    const [username, domain] = parts;
    if (!/^[A-Za-z0-9.-]+$/.test(domain)) throw Error("Invalid federation domain");
    const resource = encodeURIComponent(`acct:${username}@${domain}`);
    const webfinger = await fetch(`https://${domain}/.well-known/webfinger?resource=${resource}`, {
      headers: { Accept: "application/jrd+json, application/json", "User-Agent": "Testagram-Federation/4.0" },
    });
    if (!webfinger.ok) throw Error(`WebFinger ${webfinger.status} for ${domain}`);
    const finger = await webfinger.json();
    actorUrl = (finger.links || []).find((link: any) => link.rel === "self" && link.href && String(link.type || "").includes("activity"))?.href || "";
    if (!actorUrl) throw Error("WebFinger did not return an ActivityPub actor");
  }
  assertSafeRemoteUrl(actorUrl);
  const actor = await remoteActor(local, actorUrl);
  const canonical = String(actor.id);
  const inbox = String(actor.endpoints?.sharedInbox || actor.inbox || "");
  assertSafeRemoteUrl(canonical);
  assertSafeRemoteUrl(inbox);
  await db("federated_actors?on_conflict=actor_uri", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({
      actor_uri: canonical,
      username: actor.preferredUsername || null,
      domain: new URL(canonical).hostname,
      display_name: actor.name || actor.preferredUsername || null,
      bio: actor.summary || null,
      avatar_url: actor.icon?.url || null,
      inbox_url: actor.inbox || null,
      outbox_url: actor.outbox || null,
      followers_url: actor.followers || null,
      following_url: actor.following || null,
      public_key_pem: actor.publicKey?.publicKeyPem || null,
      raw_actor: actor,
      fetched_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }),
  });
  return { actorUrl: canonical, inbox, actor };
}

async function queue(local: any, userId: string, inbox: string, activity: any) {
  assertLocalActor(local);
  assertSafeRemoteUrl(inbox);
  if (!isSupportedActivity(activity)) throw Error(`Unsupported ActivityPub activity type: ${typeOf(activity) || "unknown"}`);
  const activityUri = idOf(activity);
  const activityActor = actorId(activity);
  if (!activityUri || !activityActor) throw Error("Outbound activity must have an id and actor");
  if (activityActor !== local.actor_url) throw Error("Outbound activity actor does not match the authenticated local actor");

  const now = new Date().toISOString();
  const outboxResponse = await db("activitypub_outbox", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      local_user_id: userId,
      activity_type: typeOf(activity),
      activity_id: activityUri,
      payload: activity,
      delivered: false,
      created_at: now,
    }),
  });
  const outboxRows = await outboxResponse.json() as any[];
  const outboxId = outboxRows[0]?.id;
  if (!outboxId) throw Error("Failed to persist ActivityPub outbox activity");

  const body = JSON.stringify(activity);
  let response: Response;
  try {
    response = await signedFetch(local, inbox, "POST", body);
  } catch (error) {
    throw Error(`Federation delivery failed: ${error instanceof Error ? error.message : "network error"}`);
  }

  const responseText = await response.text();
  if (!response.ok) {
    throw Error(`Remote inbox ${response.status}: ${responseText.slice(0, 1200)}`);
  }

  const patchResponse = await db(`activitypub_outbox?id=eq.${enc(outboxId)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ delivered: true }),
  });
  if (!patchResponse.ok) throw Error("ActivityPub delivery succeeded but outbox acknowledgement failed");

  return {
    status: "delivered",
    activityId: activityUri,
    outboxId,
    remoteStatus: response.status,
  };
}
async function relationship(userId: string, actorUrl: string) {
  const response = await db(`federated_follow_relationships?local_user_id=eq.${enc(userId)}&remote_actor_uri=eq.${enc(actorUrl)}&direction=eq.following&select=*`);
  const rows = await response.json() as any[];
  return rows[0] || null;
}

async function upsertRelationship(values: Record<string, unknown>) {
  await db("federated_follow_relationships?on_conflict=local_user_id,remote_actor_uri,direction", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(values),
  });
}

async function stableActivityId(localActor: string, remoteActor: string, kind: "follow" | "undo") {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${kind}|${localActor}|${remoteActor}`));
  const hex = Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${localActor}#activities/${kind}-${hex.slice(0, 48)}`;
}

async function follow(userId: string, local: any, target: string) {
  const remote = await resolve(local, target);
  const existing = await relationship(userId, remote.actorUrl);
  const activityId = existing?.follow_activity_uri || await stableActivityId(local.actor_url, remote.actorUrl, "follow");
  if (existing?.state === "active" && existing?.delivery_state === "delivered") {
    return { ok: true, idempotent: true, state: existing.state, actorUrl: remote.actorUrl, inbox: existing.remote_inbox_uri || remote.inbox, followActivityUri: activityId, deliveryState: existing.delivery_state || null };
  }
  const activity = { "@context": CTX, id: activityId, type: "Follow", actor: local.actor_url, object: remote.actorUrl };
  const queued = await queue(local, userId, remote.inbox, activity);
  const now = new Date().toISOString();
  await upsertRelationship({
    local_user_id: userId,
    remote_actor_uri: remote.actorUrl,
    direction: "following",
    state: "active",
    follow_activity_uri: activityId,
    remote_inbox_uri: remote.inbox,
    delivery_state: queued.status,
    delivery_attempts: 1,
    last_error: null,
    updated_at: now,
  });
  return { ok: true, state: "active", actorUrl: remote.actorUrl, inbox: remote.inbox, followActivityUri: activityId, deliveryState: queued.status, queue: queued };
}

async function unfollow(userId: string, local: any, target: string) {
  const remote = await resolve(local, target);
  const existing = await relationship(userId, remote.actorUrl);
  if (!existing || existing.state === "removed") return { ok: true, idempotent: true, state: "removed", actorUrl: remote.actorUrl };
  if (!existing.follow_activity_uri) throw Error("Cannot undo follow without the original Follow activity URI");
  const activityId = await stableActivityId(local.actor_url, remote.actorUrl, "undo");
  const activity = { "@context": CTX, id: activityId, type: "Undo", actor: local.actor_url, object: { id: existing.follow_activity_uri, type: "Follow", actor: local.actor_url, object: remote.actorUrl } };
  const queued = await queue(local, userId, remote.inbox, activity);
  // A local unfollow is a durable removal immediately; remote delivery is
  // asynchronous and must not make the UI resurrect the relationship.
  await upsertRelationship({ local_user_id: userId, remote_actor_uri: remote.actorUrl, direction: "following", state: "removed", undo_activity_uri: activityId, remote_inbox_uri: remote.inbox, delivery_state: "queued", updated_at: new Date().toISOString() });
  return { ok: true, state: "removed", actorUrl: remote.actorUrl, undoActivityUri: activityId, deliveryState: "queued", queue: queued };
}

async function handle(request: Request) {
  if (!internal(request)) return json({ error: "Internal federation transport only" }, 403);
  const body = await request.json() as any;
  const userId = String(body.user_id || "");
  if (!userId) return json({ error: "user_id required" }, 400);
  const local = await actorForUser(userId);
  if (body.operation === "resolve") {
    if (!body.target) return json({ error: "target required" }, 400);
    return json({ ok: true, ...await resolve(local, body.target) });
  }
  if (body.operation === "follow") {
    if (!body.target) return json({ error: "target required" }, 400);
    return json(await follow(userId, local, String(body.target)));
  }
  if (body.operation === "unfollow") {
    if (!body.target) return json({ error: "target required" }, 400);
    return json(await unfollow(userId, local, String(body.target)));
  }
  if (body.operation === "deliver") {
    const target = String(body.target || "");
    const activity = body.activity;
    if (!target || !activity?.type) return json({ error: "target and activity.type required" }, 400);
    const remote = await resolve(local, target);
    const activityWithId = { "@context": activity["@context"] || CTX, id: activity.id || `${local.actor_url}#activities/${crypto.randomUUID()}`, ...activity, actor: activity.actor || local.actor_url };
    const queued = await queue(local, userId, remote.inbox, activityWithId);
    return json({ ok: true, activity: activityWithId, remote: { actorUrl: remote.actorUrl, inbox: remote.inbox }, delivery: { status: "queued", queue: queued } }, 202);
  }
  if (body.operation === "health") return json({ ok: true, service: "federation-transport", activityPub: true, federationOrigin: ORIGIN, version: "4.0", deliveryMode: "queue-first", signatures: ["draft-cavage-http-signatures-12", "rfc9421"] });
  return json({ error: "Unknown federation transport operation" }, 400);
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (request.method === "GET" && new URL(request.url).pathname.endsWith("/health")) {
    return json({ ok: true, service: "federation-transport", activityPub: true, federationOrigin: ORIGIN, version: "4.0", deliveryMode: "queue-first", signatures: ["draft-cavage-http-signatures-12", "rfc9421"] });
  }
  if (request.method !== "POST") return json({ error: "POST required" }, 405);
  try {
    return await handle(request);
  } catch (error) {
    console.error("federation-transport", error);
    return json({ ok: false, error: error instanceof Error ? error.message : "Federation transport failed" }, 502);
  }
});
