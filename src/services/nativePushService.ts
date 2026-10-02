import { supabase } from '../lib/supabase';

declare global {
  interface Window {
    __TESTAGRAM_FCM_TOKEN__?: string;
  }
}

let registeredToken: string | null = null;
let started = false;

async function registerToken(token: string): Promise<void> {
  const normalized = token.trim();
  if (!normalized || normalized === registeredToken) return;

  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) return;

  const { error } = await supabase.functions.invoke('register-push-token', {
    body: {
      token: normalized,
      platform: 'android',
      provider: 'fcm',
    },
  });

  if (error) {
    console.warn('[Testagram] native push registration failed:', error.message);
    return;
  }

  registeredToken = normalized;
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
  } = supabase.auth.onAuthStateChange((_event, session) => {
    if (session && window.__TESTAGRAM_FCM_TOKEN__) {
      void registerToken(window.__TESTAGRAM_FCM_TOKEN__);
    }
  });

  return () => {
    window.removeEventListener('testagram:fcm-token', onToken);
    subscription.unsubscribe();
    started = false;
  };
}
