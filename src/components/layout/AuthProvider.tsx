import { useEffect } from 'react';
import { APPWRITE_AUTH_CHANGED_EVENT, appwriteAuth } from '@/services/appwriteAuth';
import { useAuthStore } from '@/stores/authStore';
import { finalizeAuthenticatedSession, mapAppwriteAuthUser } from '@/lib/auth';
import { TestagramEvent, trackTestagramEvent } from '@/lib/testagram-analytics';
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
}): Promise<void> {
  // Notifications are server-owned. The previous Appwrite-only release already
  // deferred this helper; do not recreate client-side database writes here.
}


export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { login, logout, setLoading, setAuthError, clearAuthError } = useAuthStore();

  useEffect(() => {
    let mounted = true;
    let hydrationInFlight = false;

    const hydrateAppwriteSession = async () => {
      if (hydrationInFlight) return;
      hydrationInFlight = true;
      setLoading(true);
      clearAuthError();
      try {
        const appwriteUser = await appwriteAuth.getCurrentUser();
        if (!mounted) return;
        if (!appwriteUser) {
          clearTestagramSessionLifetime();
          logout();
          setLoading(false);
          return;
        }

        const user = mapAppwriteAuthUser(appwriteUser);
        const valid = await enforceTestagramSessionLifetime();
        if (!mounted) return;
        if (!valid) {
          clearTestagramSessionLifetime();
          logout();
          setLoading(false);
          if (mounted) window.location.replace('/auth');
          return;
        }

        markAuthenticatedSessionStarted(user.id);
        const mappedUser = await finalizeAuthenticatedSession(user);
        if (!mounted) return;
        login(mappedUser);
        setLoading(false);
      } catch (error) {
        if (!mounted) return;
        const message = error instanceof Error ? error.message : 'Appwrite session could not be restored.';
        setAuthError(message);
        setLoading(false);
        console.error('[Auth] Appwrite session hydration failed:', error);
      } finally {
        hydrationInFlight = false;
      }
    };

    const handleAppwriteAuthChange = () => { void hydrateAppwriteSession(); };
    void hydrateAppwriteSession();
    window.addEventListener(APPWRITE_AUTH_CHANGED_EVENT, handleAppwriteAuthChange);

    const lifetimeTimer = window.setInterval(() => {
      void enforceTestagramSessionLifetime().then((valid) => {
        if (!valid && mounted) {
          clearTestagramSessionLifetime();
          logout();
          window.location.replace('/auth');
        }
      }).catch((error) => {
        if (mounted) console.warn('[Auth] Appwrite session validation temporarily failed:', error);
      });
    }, 30_000);

    return () => {
      mounted = false;
      window.clearInterval(lifetimeTimer);
      window.removeEventListener(APPWRITE_AUTH_CHANGED_EVENT, handleAppwriteAuthChange);
    };
  }, [login, logout, setLoading, setAuthError, clearAuthError]);

  return <>{children}</>;
}
