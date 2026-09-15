import "jsr:@supabase/functions-js/edge-runtime.d.ts";

/** Shared ActivityPub interoperability primitives. Keep protocol parsing tolerant. */
export const AP_CONTEXT = [
  "https://www.w3.org/ns/activitystreams",
  "https://w3id.org/security/v1",
];

export const AP_TYPES = new Set(["Create", "Update", "Delete", "Undo", "Follow", "Accept", "Reject", "Like", "Announce", "Block", "Move", "Add", "Remove", "Flag", "QuoteRequest"]);

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
  return `{${Object.keys(record).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(record[k])}`).join(",')}}`;
}

export function pageUrl(base: string, page: number, cursor?: string | null): string {
  const u = new URL(base); u.searchParams.set("page", String(page)); if (cursor) u.searchParams.set("cursor", cursor); return u.toString();
}
