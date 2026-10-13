const PRIVATE_HOSTS = new Set(["localhost", "localhost.", "localhost.localdomain"]);

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
  if (url.username || url.password) throw new Error("Credentials are not allowed in federation URLs");
  return url;
}

function isPrivateIpv4(host: string): boolean {
  // URL normalizes non-canonical IPv4 spellings (e.g. 127.1 and integer hosts)
  // before hostname is read, so this also catches abbreviated/decimal variants.
  const parts = host.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b] = parts;
  return a === 0 || a === 10 || a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 0 || b === 168)) ||
    (a === 198 && (b === 18 || b === 19 || b === 51 && parts[2] === 100)) ||
    (a === 203 && b === 0 && parts[2] === 113) || a >= 224;
}

function isPrivateIpv6(host: string): boolean {
  const value = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (!value.includes(":")) return false;
  // Block unspecified/loopback, IPv4-mapped addresses, unique-local, link-local,
  // multicast, and the IPv6 discard/documentation-only special-purpose ranges.
  if (value === "::" || value === "::1" || value.startsWith("::ffff:") ||
      value.startsWith("fc") || value.startsWith("fd") ||
      /^fe[89ab]/.test(value) || value.startsWith("ff") ||
      value.startsWith("2001:0:") || value.startsWith("2001:2:") || value.startsWith("2001:db8:") || value.startsWith("2001:10:")) return true;
  return false;
}

export function assertSafeRemoteUrl(value: string): URL {
  const url = new URL(value);
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (url.protocol !== "https:") throw new Error("Remote federation URL must use HTTPS");
  if (url.username || url.password) throw new Error("Credentials are not allowed in remote federation URLs");
  if (!host || PRIVATE_HOSTS.has(host) || isPrivateIpv4(host) || isPrivateIpv6(host) ||
      host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".localhost")) {
    throw new Error("Blocked private federation host");
  }
  return url;
}
