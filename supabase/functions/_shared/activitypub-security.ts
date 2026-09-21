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
