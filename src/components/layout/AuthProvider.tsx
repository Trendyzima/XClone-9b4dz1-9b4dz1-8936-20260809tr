import { useEffect } from 'react';
import { APPWRITE_AUTH_CHANGED_EVENT, appwriteAuth } from '@/services/appwriteAuth';
import { useAuthStore } from '@/stores/authStore';
import { finalizeAuthenticatedSession } from '@/lib/auth';
import {
  clearTestagramSessionLifetime,
  enforceTestagramSessionLifetime,
  markAuthenticatedSessionStarted,
} from '@/lib/sessionPolicy';

export async function sendActivityNotification(_input: {
  recipientUserId: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}) {
  // Notification writes are moving to the canonical Go Backend event API.
  // Never write directly to a legacy Supabase table or Edge Function.
  console.warn('[Notification] Client-side notification writes are disabled; emit a Backend domain event instead.');
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { login, logout, setLoading, setAuthError, clearAuthError } = useAuthStore();

  useEffect(() => {
    let mounted = true;
    let hydration: Promise<void> | null = null;

    const hydrate = async () => {
      if (hydration) return hydration;
      hydration = (async () => {
        setLoading(true);
        clearAuthError();
        try {
          const user = await appwriteAuth.getCurrentUser();
          if (!mounted) return;
          if (!user) {
            clearTestagramSessionLifetime();
            logout();
            setLoading(false);
            return;
          }
          if (!user.emailVerification) {
            logout();
            setLoading(false);
            const email = encodeURIComponent(user.email || '');
            if (window.location.pathname !== '/auth' || !new URLSearchParams(window.location.search).has('verify')) {
              window.location.replace('/auth?verify=1&email=' + email);
            }
            return;
          }
          const valid = await enforceTestagramSessionLifetime();
          if (!valid) {
            logout();
            setLoading(false);
            if (mounted) window.location.replace('/auth');
            return;
          }
          markAuthenticatedSessionStarted(user.$id);
          const mapped = await finalizeAuthenticatedSession(user);
          if (!mounted) return;
          login(mapped);
          setLoading(false);
        } catch (error) {
          if (!mounted) return;
          const message = error instanceof Error ? error.message : 'Appwrite session could not be restored.';
          if (message === 'EMAIL_NOT_VERIFIED') {
            logout();
            setLoading(false);
            window.location.replace('/auth?verify=1');
            return;
          }
          setAuthError(message);
          setLoading(false);
          console.error('[Auth] Appwrite session hydration failed:', error);
        } finally {
          hydration = null;
        }
      })();
      return hydration;
    };

    const onAuthChange = () => {
      void hydrate();
    };

    void hydrate();
    window.addEventListener(APPWRITE_AUTH_CHANGED_EVENT, onAuthChange);
    const lifetimeTimer = window.setInterval(() => {
      void enforceTestagramSessionLifetime().then((valid) => {
        if (!valid && mounted) {
          logout();
          window.location.replace('/auth');
        }
      }).catch((error) => {
        if (mounted) console.warn('[Auth] Session lifetime check unavailable:', error);
      });
    }, 30_000);

    return () => {
      mounted = false;
      window.clearInterval(lifetimeTimer);
      window.removeEventListener(APPWRITE_AUTH_CHANGED_EVENT, onAuthChange);
    };
  }, [login, logout, setLoading, setAuthError, clearAuthError]);

  return <>{children}</>;
}
