const FUNCTION_BASE = "https://ffrhglgkukgsuhxenena.supabase.co/functions/v1/federated-media-proxy";

export function federatedMediaUrl(remoteUrl: unknown, actorUrl: unknown): string | null {
  if (typeof remoteUrl !== "string" || !remoteUrl.trim()) return null;
  if (typeof actorUrl !== "string" || !actorUrl.trim()) return remoteUrl;
  try {
    const target = new URL(remoteUrl);
    const source = new URL(actorUrl);
    if (target.protocol !== "https:" || source.protocol !== "https:") return remoteUrl;
    return `${FUNCTION_BASE}?url=${encodeURIComponent(target.toString())}&source=${encodeURIComponent(source.toString())}`;
  } catch {
    return remoteUrl;
  }
}
