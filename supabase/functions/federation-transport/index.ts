import "jsr:@supabase/functions-js/edge-runtime.d.ts";

/** Shared ActivityPub interoperability primitives. Keep protocol parsing tolerant. */
export const AP_CONTEXT = [
  "https://www.w3.org/ns/activitystreams",
  "https://w3id.org/security/v1",
];

export const AP_TYPES = new Set(["Create", "Update", "Delete", "Undo", "Follow", "Accept", "Reject", "Like", "Announce", "EmojiReact", "Block", "Move", "Add", "Remove", "Flag", "QuoteRequest"]);

export function asArray<T = unknown>(value: T | T[] | null | undefined): T[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

export function firstString(...values: unknown[]): string | null {
  for (const value of values) if (typeof value === "string" && value.trim()) return value.trim();
  return null;
}

export function idOf(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") return firstString((value as Record<string, unknown>).id, (value as Record<string, unknown>).url);
  return null;
}

export function typeOf(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const t = (value as Record<string, unknown>).type;
  return typeof t === "string" ? t : null;
}

export function objectOf(activity: Record<string, unknown>): Record<string, unknown> | null {
  const object = activity.object;
  return object && typeof object === "object" ? object as Record<string, unknown> : null;
}

export function actorId(activity: Record<string, unknown>): string | null {
  return idOf(activity.actor);
}

export function normalizeVisibility(value: unknown, to: unknown, cc: unknown): "public" | "unlisted" | "followers" | "direct" {
  const raw = typeof value === "string" ? value.toLowerCase() : "";
  if (["direct", "private", "followers"].includes(raw)) return raw === "private" ? "followers" : raw as "followers" | "direct";
  const recipients = [...asArray(to), ...asArray(cc)].filter((x): x is string => typeof x === "string");
  if (recipients.some((x) => x === "https://www.w3.org/ns/activitystreams#Public")) return "public";
  if (recipients.some((x) => x.endsWith("/followers"))) return "followers";
  return "direct";
}

export function normalizeAttachment(value: unknown) {
  const a = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    url: firstString(a.url, a.href, a.preview_url),
    type: firstString(a.mediaType, a.mimeType, a.type),
    name: firstString(a.name, a.alt, a.description),
    width: typeof a.width === "number" ? a.width : null,
    height: typeof a.height === "number" ? a.height : null,
    blurhash: firstString(a.blurhash, a.blurHash),
  };
}

export function normalizeNote(object: Record<string, unknown>) {
  return {
    id: idOf(object),
    type: typeOf(object) || "Note",
    attributedTo: idOf(object.attributedTo),
    content: firstString(object.content, object.summary, object.name) || "",
    published: firstString(object.published, object.created),
    updated: firstString(object.updated, object.edited),
    inReplyTo: idOf(object.inReplyTo),
    quote: firstString(object.quoteUri, object.quoteUrl, object._misskey_quote, object.quote),
    to: asArray(object.to),
    cc: asArray(object.cc),
    attachments: asArray(object.attachment).map(normalizeAttachment),
    tags: asArray(object.tag),
    sensitive: object.sensitive === true,
    spoilerText: firstString(object.summary, object.spoiler_text) || "",
  };
}

export function isSupportedActivity(activity: Record<string, unknown>): boolean {
  const type = typeOf(activity);
  return !!type && AP_TYPES.has(type);
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(record[k])}`).join(",")}}`;
}

export function pageUrl(base: string, page: number, cursor?: string | null): string {
  const u = new URL(base); u.searchParams.set("page", String(page)); if (cursor) u.searchParams.set("cursor", cursor); return u.toString();
}


const PRIVATE_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1"]);

export function canonicalOrigin(): string {
  const configured = "https://testagram.site";
  return new URL(configured).origin;
}

export function canonicalUrl(path: string): string {
  return new URL(path.startsWith("/") ? path : `/${path}`, canonicalOrigin()).toString();
}

export function assertCanonicalPublicUrl(value: string): URL {
  const url = new URL(value);
  const origin = new URL(canonicalOrigin());
  if (url.protocol !== "https:") throw new Error("Federation URLs must use HTTPS");
  if (url.hostname !== origin.hostname) throw new Error("Non-canonical federation hostname");
  return url;
}

function isPrivateIpv4(host: string): boolean {
  const parts = host.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  return parts[0] === 10 || parts[0] === 127 || (parts[0] === 192 && parts[1] === 168) || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31);
}

export function assertSafeRemoteUrl(value: string): URL {
  const url = new URL(value);
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "https:") throw new Error("Remote federation URL must use HTTPS");
  if (PRIVATE_HOSTS.has(host) || isPrivateIpv4(host) || host.endsWith(".local") || host.endsWith(".internal")) throw new Error("Blocked private federation host");
  return url;
}



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

async function db(path: string, init: RequestInit = {}, allowStatuses: number[] = []) {
  if (!SERVICE_KEY) throw Error("Federation service credential is not configured");
  const headers = new Headers(init.headers);
  headers.set("apikey", SERVICE_KEY);
  headers.set("Authorization", `Bearer ${SERVICE_KEY}`);
  headers.set("Content-Type", "application/json");
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...init, headers });
  if (!response.ok && !allowStatuses.includes(response.status)) throw Error(`database ${response.status}: ${(await response.text()).slice(0, 800)}`);
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
  const payload = {
    local_user_id: userId,
    activity_type: typeOf(activity),
    activity_id: activityUri,
    payload: activity,
    delivered: false,
    attempts: 0,
    next_attempt_at: now,
    expires_at: new Date(Date.now()+14*86400000).toISOString(),
    created_at: now,
  };

  // activity_id is the federation idempotency key. Concurrent UI retries
  // collapse onto one durable activity instead of producing PostgreSQL 23505.
  const outboxResponse = await db("activitypub_outbox", {
    method: "POST",
    headers: { Prefer: "resolution=ignore-duplicates,return=representation" },
    body: JSON.stringify(payload),
  }, [409]);

  let outboxRows: any[] = [];
  try { outboxRows = await outboxResponse.json() as any[]; } catch {}
  if (!outboxResponse.ok && outboxResponse.status !== 409) {
    const detail = outboxRows?.[0]?.message || JSON.stringify(outboxRows);
    throw Error(`Failed to persist ActivityPub outbox activity: ${detail.slice(0, 1200)}`);
  }

  let outbox = outboxRows[0] || null;
  if (!outbox) {
    const existingResponse = await db(`activitypub_outbox?activity_id=eq.${enc(activityUri)}&select=*&limit=1`);
    if (!existingResponse.ok) throw Error("Failed to read existing ActivityPub outbox activity");
    const existingRows = await existingResponse.json() as any[];
    outbox = existingRows[0] || null;
  }
  if (!outbox?.id) throw Error("Failed to persist ActivityPub outbox activity");

  // Bridge the legacy activitypub_outbox record into the durable delivery
  // queue consumed by federation-delivery-worker. This closes the old gap where
  // a concurrent loser could return "queued" but no worker owned the activity.
  const activityRow = await db("federated_activities?on_conflict=uri", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify({
      uri: activityUri,
      activity_type: typeOf(activity),
      actor_uri: activityActor,
      object_uri: idOf(activity.object),
      target_uri: idOf(activity.target),
      raw_activity: activity,
      received_at: now,
      processed_at: now,
      processing_state: "processed",
      processing_attempts: 0,
    }),
  });
  if (!activityRow.ok) throw Error("Failed to persist federated activity delivery record");
  let activityRows: any[] = [];
  try { activityRows = await activityRow.json() as any[]; } catch {}
  const federatedActivityId = activityRows[0]?.id;
  if (!federatedActivityId) {
    const lookup = await db(`federated_activities?uri=eq.${enc(activityUri)}&select=id&limit=1`);
    if (!lookup.ok) throw Error("Failed to resolve federated activity delivery record");
    const rows = await lookup.json() as any[];
    if (!rows[0]?.id) throw Error("Federated activity delivery record has no id");
    activityRows = rows;
  }
  const activityId = activityRows[0].id;

  const deliveryUpsert = await db("federation_deliveries?on_conflict=activity_id,target_inbox", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify({
      activity_id: activityId,
      target_inbox: inbox,
      instance_domain: new URL(inbox).hostname,
      status: "pending",
      attempt_count: 0,
      next_attempt_at: now,
      activity_payload: activity,
    }),
  });
  if (!deliveryUpsert.ok) throw Error("Failed to persist federation delivery job");
  let deliveryRows: any[] = [];
  try { deliveryRows = await deliveryUpsert.json() as any[]; } catch {}
  let delivery = deliveryRows[0] || null;
  if (!delivery) {
    const lookup = await db(`federation_deliveries?activity_id=eq.${enc(activityId)}&target_inbox=eq.${enc(inbox)}&select=*&limit=1`);
    if (!lookup.ok) throw Error("Failed to resolve federation delivery job");
    const rows = await lookup.json() as any[];
    delivery = rows[0] || null;
  }
  if (!delivery?.id) throw Error("Federation delivery job has no id");

  if (outbox.delivered === true || delivery.status === "delivered") {
    if (outbox.delivered !== true) {
      await db(`activitypub_outbox?id=eq.${enc(outbox.id)}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ delivered: true, next_attempt_at: null, last_error: null }),
      });
    }
    return { status: "delivered", activityId: activityUri, outboxId: outbox.id, idempotent: true, remoteStatus: null };
  }

  // Atomically claim the durable delivery job. Exactly one concurrent caller
  // gets in_flight and performs the remote HTTP request; other callers return
  // queued and the worker owns retry/recovery if the winner crashes.
  const claimed = await db(`federation_deliveries?id=eq.${enc(delivery.id)}&status=in.(pending,retry)`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      status: "in_flight",
      attempt_count: Number(delivery.attempt_count || 0) + 1,
      last_attempt_at: now,
      locked_at: now,
      last_error: null,
    }),
  });
  let claimedRows: any[] = [];
  try { claimedRows = await claimed.json() as any[]; } catch {}
  if (!claimed.ok) throw Error("Failed to claim federation delivery job");

  if (claimedRows.length === 0) {
    return {
      status: "queued",
      activityId: activityUri,
      outboxId: outbox.id,
      idempotent: true,
      remoteStatus: null,
    };
  }

  const attemptNumber = Number(claimedRows[0]?.attempt_count || delivery.attempt_count || 1);
  const attemptResponse = await db(`activitypub_outbox?id=eq.${enc(outbox.id)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ attempts: attemptNumber, next_attempt_at: now, last_error: null }),
  });
  if (!attemptResponse.ok) throw Error("Failed to record ActivityPub delivery attempt");

  const body = JSON.stringify(activity);
  let response: Response;
  try {
    response = await signedFetch(local, inbox, "POST", body);
  } catch (error) {
    const message = error instanceof Error ? error.message : "network error";
    const retryAt = new Date(Date.now()+5*60*1000).toISOString();
    await db(`federation_deliveries?id=eq.${enc(delivery.id)}&status=eq.in_flight`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ status: "retry", last_error: message.slice(0, 2000), next_attempt_at: retryAt, locked_at: null }),
    }).catch(() => {});
    await db(`activitypub_outbox?id=eq.${enc(outbox.id)}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ last_error: message.slice(0, 2000), next_attempt_at: retryAt }),
    }).catch(() => {});
    throw Error(`Federation delivery failed: ${message}`);
  }

  const responseText = await response.text();
  if (!response.ok) {
    const message = `Remote inbox ${response.status}: ${responseText.slice(0, 1200)}`;
    const retryAt = new Date(Date.now()+5*60*1000).toISOString();
    await db(`federation_deliveries?id=eq.${enc(delivery.id)}&status=eq.in_flight`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ status: "retry", last_status_code: response.status, last_error: message, next_attempt_at: retryAt, locked_at: null }),
    }).catch(() => {});
    await db(`activitypub_outbox?id=eq.${enc(outbox.id)}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ last_error: message, next_attempt_at: retryAt }),
    }).catch(() => {});
    throw Error(message);
  }

  const deliveryAck = await db(`federation_deliveries?id=eq.${enc(delivery.id)}&status=eq.in_flight`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      status: "delivered",
      last_status_code: response.status,
      last_error: null,
      delivered_at: new Date().toISOString(),
      locked_at: null,
      // federation_deliveries.next_attempt_at is NOT NULL. A delivered job
      // no longer needs a retry deadline, but it must retain a valid timestamp
      // so the acknowledgement cannot violate the database contract.
      next_attempt_at: new Date().toISOString(),
    }),
  });
  if (!deliveryAck.ok) throw Error("Remote delivery succeeded but durable delivery acknowledgement failed");

  const patchResponse = await db(`activitypub_outbox?id=eq.${enc(outbox.id)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      delivered: true,
      next_attempt_at: null,
      last_error: null,
      expires_at: new Date(Date.now()+86400000).toISOString(),
      payload: {},
    }),
  });
  if (!patchResponse.ok) throw Error("ActivityPub delivery succeeded but outbox acknowledgement failed");

  return {
    status: "delivered",
    activityId: activityUri,
    outboxId: outbox.id,
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

async function stableInteractionId(localActor: string, remoteStatus: string, type: "Like" | "Announce") {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`interaction|${type}|${localActor}|${remoteStatus}`));
  const hex = Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${localActor}#activities/${type.toLowerCase()}-${hex.slice(0, 48)}`;
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

async function fetchRemoteObject(local:any,target:string){
  assertSafeRemoteUrl(target);
  const response=await signedFetch(local,target,"GET");
  const text=await response.text();
  if(!response.ok) throw Error("Remote object "+response.status+": "+text.slice(0,1200));
  const contentType=response.headers.get("content-type")||"";
  if(contentType.includes("json")) { try{return JSON.parse(text)}catch{throw Error("Remote ActivityPub object is not valid JSON")} }
  const link=response.headers.get("link")||"";
  const match=link.match(/<([^>]+)>;[^,]*rel="?alternate"?[^,]*type="?application\/activity\+json"?/i) || link.match(/<([^>]+)>;[^,]*type="?application\/activity\+json"?[^,]*rel="?alternate"?/i);
  if(!match?.[1]) throw Error("Remote status URL did not return ActivityPub JSON");
  const alt=await signedFetch(local,new URL(match[1],target).toString(),"GET");
  const altText=await alt.text();
  if(!alt.ok) throw Error("Remote ActivityPub alternate "+alt.status+": "+altText.slice(0,1200));
  try{return JSON.parse(altText)}catch{throw Error("Remote ActivityPub alternate is not valid JSON")}
}
async function collectionTotal(local:any,value:any){
  if(typeof value==="number") return value;
  if(value&&typeof value==="object"&&typeof value.totalItems==="number") return value.totalItems;
  const url=idOf(value); if(!url) return 0;
  try{
    const response=await signedFetch(local,url,"GET"); const text=await response.text();
    if(!response.ok) return 0; const data=JSON.parse(text);
    if(typeof data?.totalItems==="number") return data.totalItems;
    if(Array.isArray(data?.items)) return data.items.length;
  }catch{}
  return 0;
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
  if (body.operation === "fetch") {
    if (!body.target) return json({ error: "target required" }, 400);
    const remoteObject = await fetchRemoteObject(local, String(body.target));
    if (!remoteObject) return json({ ok: false, error: "Remote ActivityPub object not found" }, 404);
    return json({ ok: true, object: remoteObject }, 200);
  }
  if (body.operation === "inspect") {
    if (!body.target) return json({ error: "target required" }, 400);
    const remoteObject=await fetchRemoteObject(local,String(body.target));
    const [likes,reposts,replies]=await Promise.all([collectionTotal(local,remoteObject?.likes),collectionTotal(local,remoteObject?.shares),collectionTotal(local,remoteObject?.replies)]);
    return json({ok:true,counts:{likes,reposts,replies}},200);
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
    // Interaction targets are remote ActivityPub objects (status URIs), not actors.
    // Resolve the target object first, then deliver to the actor's inbox/sharedInbox.
    let remote;
    let remoteObject:any = null;
    if (/^https?:\/\//i.test(target)) {
      remoteObject = await fetchRemoteObject(local,target);
      const attributedTo = typeof remoteObject?.attributedTo === "string" ? remoteObject.attributedTo : idOf(remoteObject?.attributedTo);
      const actorTarget = attributedTo || (typeof remoteObject?.actor === "string" ? remoteObject.actor : idOf(remoteObject?.actor));
      if (!actorTarget) throw Error("Remote ActivityPub object has no attributedTo/actor");
      remote = await resolve(local, actorTarget);
    } else {
      remote = await resolve(local, target);
    }
    const { object_type: interactionObjectType, ...activityPayload } = activity;
    let activityWithId = { "@context": activityPayload["@context"] || CTX, id: activityPayload.id || `${local.actor_url}#activities/${crypto.randomUUID()}`, ...activityPayload, actor: activityPayload.actor || local.actor_url };
    if (activityWithId.type === "Like" || activityWithId.type === "Announce") {
      const statusUri = typeof activityWithId.object === "string" ? activityWithId.object : idOf(activityWithId.object);
      if (!statusUri) throw Error("Interaction activity requires a remote status URI");
      activityWithId = { ...activityWithId, id: await stableInteractionId(local.actor_url, statusUri, activityWithId.type) };
    }
    if (activityWithId.type === "Undo" && typeof activityWithId.object === "string") {
      const statusUri = activityWithId.object;
      const undoneType = interactionObjectType === "Announce" ? "Announce" : "Like";
      const interactionId = await stableInteractionId(local.actor_url, statusUri, undoneType);
      activityWithId = { ...activityWithId, id: `${local.actor_url}#activities/undo-${interactionId.split("/").pop()}`, object: { id: interactionId, type: undoneType, actor: local.actor_url, object: statusUri } };
    }
    if (activityWithId.type === "Like" || activityWithId.type === "Announce") {
      const recipient = remote.actorUrl;
      activityWithId = {
        ...activityWithId,
        to: Array.from(new Set([...(Array.isArray(activityWithId.to) ? activityWithId.to : []), recipient,
          ...(activityWithId.type === "Announce" ? ["https://www.w3.org/ns/activitystreams#Public"] : [])]))
      };
    }
    if (activityWithId.type === "Create" && activityWithId.object && typeof activityWithId.object === "object") {
      const note = activityWithId.object as Record<string, unknown>;
      const noteId = typeof note.id === "string" ? note.id : String(local.actor_url) + "#activities/reply-" + crypto.randomUUID();
      const recipient = remote.actorUrl;
      // Match Mastodon's addressing model: address the original author and preserve the original audience.
      const originalTo = Array.isArray(remoteObject?.to) ? remoteObject.to : (remoteObject?.to ? [remoteObject.to] : []);
      const originalCc = Array.isArray(remoteObject?.cc) ? remoteObject.cc : (remoteObject?.cc ? [remoteObject.cc] : []);
      const replyTo = Array.from(new Set([...(Array.isArray(note.to) ? note.to : []), ...originalTo, ...(note.inReplyTo ? [recipient] : [])]));
      const replyCc = Array.from(new Set([...(Array.isArray(note.cc) ? note.cc : []), ...originalCc]));
      const replyObject = {
        ...note,
        id: noteId,
        attributedTo: note.attributedTo || local.actor_url,
        to: replyTo,
        cc: replyCc.length ? replyCc : undefined,
        ...(note.inReplyTo ? { inReplyTo: note.inReplyTo } : {})
      };
      activityWithId = {
        ...activityWithId,
        to: replyTo,
        cc: replyCc.length ? replyCc : undefined,
        object: replyObject
      };
    }
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
