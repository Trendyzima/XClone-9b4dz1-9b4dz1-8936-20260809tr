/** Tolerant, side-effect-free ActivityStreams normalization helpers. */
export function asArray<T = unknown>(value: T | T[] | null | undefined): T[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

export function firstString(...values: unknown[]): string | null {
  for (const value of values) if (typeof value === "string" && value.trim()) return value.trim();
  return null;
}

/** Resolve an ActivityStreams identifier from either a URI or a Link/actor object. */
export function idOf(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return firstString(record.id, record["@id"], record.href, record.url);
  }
  return null;
}

function linkUrl(value: unknown): string | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const resolved = linkUrl(item);
      if (resolved) return resolved;
    }
    return null;
  }
  return idOf(value);
}

/** Resolve an actor URI from a followers collection URI. */
export function followersOwnerUri(value: unknown): string | null {
  const id = idOf(value);
  if (!id) return null;
  try {
    const url = new URL(id);
    if (url.protocol !== "https:" || url.search || url.hash) return null;
    const path = url.pathname.replace(/\/$/, "");
    if (!path.endsWith("/followers")) return null;
    url.pathname = path.slice(0, -"/followers".length);
    return url.origin + url.pathname;
  } catch {
    return null;
  }
}

function recipientIds(value: unknown): string[] {
  return asArray(value).map(idOf).filter((id): id is string => !!id);
}

const PUBLIC_AUDIENCE = "https://www.w3.org/ns/activitystreams#Public";

function isFollowersCollection(value: string): boolean {
  try {
    return new URL(value).pathname.replace(/\/$/, "").endsWith("/followers");
  } catch {
    return value.replace(/[?#].*$/, "").replace(/\/$/, "").endsWith("/followers");
  }
}

/**
 * Infer Mastodon-compatible visibility. Public in the to field is public; Public in
 * the cc field is unlisted. Object-form recipients are valid ActivityStreams values.
 */
export function normalizeVisibility(value: unknown, to: unknown, cc: unknown): "public" | "unlisted" | "followers" | "direct" {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (raw === "public" || raw === "unlisted" || raw === "direct" || raw === "followers") return raw;
  if (raw === "private") return "followers";
  const toRecipients = recipientIds(to);
  const ccRecipients = recipientIds(cc);
  if (toRecipients.includes(PUBLIC_AUDIENCE)) return "public";
  if (ccRecipients.includes(PUBLIC_AUDIENCE)) return "unlisted";
  if ([...toRecipients, ...ccRecipients].some(isFollowersCollection)) return "followers";
  return "direct";
}

/** Accept URI strings, ActivityStreams Link objects, and arrays of links. */
export function normalizeAttachment(value: unknown) {
  const a = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return {
    url: linkUrl(a.url) || linkUrl(a.href) || linkUrl(a.remote_url) || linkUrl(a.preview_url) || linkUrl(a.previewUrl) || linkUrl(a.preview_remote_url),
    type: firstString(a.mediaType, a.mimeType, a.type),
    name: firstString(a.name, a.alt, a.description),
    width: typeof a.width === "number" ? a.width : null,
    height: typeof a.height === "number" ? a.height : null,
    blurhash: firstString(a.blurhash, a.blurHash),
  };
}