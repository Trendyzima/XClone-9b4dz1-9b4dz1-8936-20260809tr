const FRESH_APPWRITE_MODE = import.meta.env.VITE_TESTAGRAM_FRESH_MODE === 'true' ||
  (import.meta.env.VITE_TESTAGRAM_AUTH_PROVIDER ?? '').trim().toLowerCase() === 'appwrite';
const FUNCTION_BASE = (import.meta.env.VITE_TESTAGRAM_FEDERATED_MEDIA_URL ||
  'http://127.0.0.1:9/functions/v1/federated-media').replace(/\/+$/, '');

export function federatedMediaUrl(remoteUrl: unknown, _actorUrl?: unknown): string | null {
  // Federation is not enabled in the fresh Appwrite rollout until its Backend
  // inbox/outbox, signature validation and delivery endpoints are complete.
  if (FRESH_APPWRITE_MODE) return null;
  if (typeof remoteUrl !== "string" || !remoteUrl.trim()) return null;
  try {
    const target = new URL(remoteUrl);
    if (!target.hostname) return null;
    return `${FUNCTION_BASE}?url=${encodeURIComponent(target.toString())}`;
  } catch {
    return null;
  }
}
