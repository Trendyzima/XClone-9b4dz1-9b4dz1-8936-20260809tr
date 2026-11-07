import { APPWRITE_AUTH_CHANGED_EVENT, appwriteAuth } from '@/services/appwriteAuth';
import { backendCapabilities } from '@/services/testagramCapabilityClient';

declare global {
  interface Window {
    __TESTAGRAM_FCM_TOKEN__?: string;
  }
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

  const user = await appwriteAuth.getCurrentUser();
  if (!user) return;
  if (normalized === registeredToken) return;

  try {
    await backendCapabilities.call('testagram.notifications.fcm.register', { token: normalized, platform: 'android', provider: 'fcm' });
  } catch (error) {
    console.warn('[Testagram] native push registration failed:', error instanceof Error ? error.message : error);
    scheduleRetry();
    return;
  }

  registeredToken = normalized;
  pendingToken = null;
  retryAttempt = 0;
  if (retryTimer) {
    window.clearTimeout(retryTimer);
    retryTimer = null;
  }
}

function scheduleRetry() {
  if (!pendingToken || retryTimer || typeof window === 'undefined') return;
  const delay = Math.min(60_000, 1_000 * 2 ** retryAttempt);
  retryAttempt = Math.min(retryAttempt + 1, 6);
  retryTimer = window.setTimeout(() => {
    retryTimer = null;
    if (pendingToken) void registerToken(pendingToken);
  }, delay);
}

export function startNativePushRegistration(): () => void {
  if (started || typeof window === 'undefined') return () => {};
  started = true;

  const onToken = (event: Event) => {
    const token = (event as CustomEvent<{ token?: string }>).detail?.token;
    if (token) void registerToken(token);
  };

  window.addEventListener('testagram:fcm-token', onToken);

  const existingToken = window.__TESTAGRAM_FCM_TOKEN__;
  if (existingToken) void registerToken(existingToken);

  const onAuthChanged = () => {
    void appwriteAuth.getCurrentUser().then(user => {
      if (!user) {
      registeredToken = null;
      pendingToken = null;
      retryAttempt = 0;
      if (retryTimer) {
        window.clearTimeout(retryTimer);
        retryTimer = null;
      }
        registeredToken = null; pendingToken = null; retryAttempt = 0;
        if (retryTimer) { window.clearTimeout(retryTimer); retryTimer = null; }
        return;
      }
      if (window.__TESTAGRAM_FCM_TOKEN__) void registerToken(window.__TESTAGRAM_FCM_TOKEN__);
    }).catch(() => undefined);
  };
  window.addEventListener(APPWRITE_AUTH_CHANGED_EVENT, onAuthChanged);

  const onVisible = () => {
    if (document.visibilityState === 'visible' && pendingToken) {
      void registerToken(pendingToken);
    }
  };
  document.addEventListener('visibilitychange', onVisible);

  return () => {
    window.removeEventListener('testagram:fcm-token', onToken);
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener(APPWRITE_AUTH_CHANGED_EVENT, onAuthChanged);
    if (retryTimer) {
      window.clearTimeout(retryTimer);
      retryTimer = null;
    }
    started = false;
  };
}
