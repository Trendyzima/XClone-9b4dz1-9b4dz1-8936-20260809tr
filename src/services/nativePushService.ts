import { supabase } from '../lib/supabase';

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

  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) return;
  if (normalized === registeredToken) return;

  const { error } = await supabase.functions.invoke('register-push-token', {
    body: {
      token: normalized,
      platform: 'android',
      provider: 'fcm',
    },
  });

  if (error) {
    console.warn('[Testagram] native push registration failed:', error.message);
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

  const {
    data: { subscription },
  } = supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT') {
      registeredToken = null;
      pendingToken = null;
      retryAttempt = 0;
      if (retryTimer) {
        window.clearTimeout(retryTimer);
        retryTimer = null;
      }
      return;
    }

    if (session?.user && window.__TESTAGRAM_FCM_TOKEN__) {
      void registerToken(window.__TESTAGRAM_FCM_TOKEN__);
    }
  });

  const onVisible = () => {
    if (document.visibilityState === 'visible' && pendingToken) {
      void registerToken(pendingToken);
    }
  };
  document.addEventListener('visibilitychange', onVisible);

  return () => {
    window.removeEventListener('testagram:fcm-token', onToken);
    document.removeEventListener('visibilitychange', onVisible);
    subscription.unsubscribe();
    if (retryTimer) {
      window.clearTimeout(retryTimer);
      retryTimer = null;
    }
    started = false;
  };
}
