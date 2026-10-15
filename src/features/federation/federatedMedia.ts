const FUNCTION_BASE = "https://ffrhglgkukgsuhxenena.supabase.co/functions/v1/federated-media";

export function federatedMediaUrl(remoteUrl: unknown, _actorUrl?: unknown): string | null {
  if (typeof remoteUrl !== "string" || !remoteUrl.trim()) return null;
  try {
    const target = new URL(remoteUrl);
    if (target.protocol !== "https:" || !target.hostname) return null;
    return `${FUNCTION_BASE}?url=${encodeURIComponent(target.toString())}`;
  } catch {
    return null;
  }
}
