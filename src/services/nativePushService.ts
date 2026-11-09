import { appwriteAuth, APPWRITE_AUTH_CHANGED_EVENT } from './appwriteAuth';
import { backendCapabilities } from './testagramCapabilityClient';

declare global {
  interface Window { __TESTAGRAM_FCM_TOKEN__?: string; }
}

let registeredToken: string | null = null;
let pendingToken: string | null = null;
let started = false;
let retryTimer: number | null = null;
let retryAttempt = 0;

async function registerToken(token: string): Promise<void> {
  const normalized = token.trim();
  if (!normalized) return;
  pendingToken = normalized;
  const user = await appwriteAuth.getCurrentUser().catch(() => null);
  if (!user || normalized === registeredToken) return;
  await backendCapabilities.call('testagram.notifications.fcm.register', {
    token: normalized, platform: 'android', provider: 'fcm',
  });
  registeredToken = normalized;
  pendingToken = null;
  retryAttempt = 0;
  if (retryTimer) { window.clearTimeout(retryTimer); retryTimer = null; }
}

function scheduleRetry() {
  if (!pendingToken || retryTimer || typeof window === 'undefined') return;
  const delay = Math.min(60_000, 1_000 * 2 ** retryAttempt);
  retryAttempt = Math.min(retryAttempt + 1, 6);
  retryTimer = window.setTimeout(() => {
    retryTimer = null;
    if (pendingToken) void registerToken(pendingToken).catch(scheduleRetry);
  }, delay);
}

export function startNativePushRegistration(): () => void {
  if (started || typeof window === 'undefined') return () => {};
  started = true;
  const onToken = (event: Event) => {
    const token = (event as CustomEvent<{ token?: string }>).detail?.token;
    if (token) void registerToken(token).catch(error => { console.warn('[Testagram] Backend push registration failed', error); scheduleRetry(); });
  };
  const onAuth = () => {
    if (window.__TESTAGRAM_FCM_TOKEN__) void registerToken(window.__TESTAGRAM_FCM_TOKEN__).catch(scheduleRetry);
  };
  const onVisible = () => {
    if (document.visibilityState === 'visible' && pendingToken) void registerToken(pendingToken).catch(scheduleRetry);
  };
  window.addEventListener('testagram:fcm-token', onToken);
  window.addEventListener(APPWRITE_AUTH_CHANGED_EVENT, onAuth);
  document.addEventListener('visibilitychange', onVisible);
  if (window.__TESTAGRAM_FCM_TOKEN__) void registerToken(window.__TESTAGRAM_FCM_TOKEN__).catch(scheduleRetry);
  return () => {
    window.removeEventListener('testagram:fcm-token', onToken);
    window.removeEventListener(APPWRITE_AUTH_CHANGED_EVENT, onAuth);
    document.removeEventListener('visibilitychange', onVisible);
    if (retryTimer) window.clearTimeout(retryTimer);
    retryTimer = null;
    started = false;
  };
}
