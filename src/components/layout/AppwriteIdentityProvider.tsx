import { useCallback, useEffect, useRef } from 'react';
import { appwriteAuth } from '@/services/appwriteAuth';
import { useAuthStore } from '@/stores/authStore';
import type { AuthUser } from '@/types/app-types';

export function AppwriteIdentityProvider({ children }: { children: React.ReactNode }) {
  const { login, logout, setLoading, setAuthError, clearAuthError } = useAuthStore();
  const inFlight = useRef(false);

  const restore = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const account = await appwriteAuth.getCurrentUser();
      if (!account.emailVerification) {
        logout();
        setAuthError('EMAIL_NOT_VERIFIED');
        return;
      }
      const identity = await appwriteAuth.getCanonicalIdentity();
      if (identity.account_status !== 'active') {
        logout();
        setAuthError('ACCOUNT_NOT_ACTIVE');
        return;
      }
      const user: AuthUser = {
        id: identity.canonical_user_id,
        email: identity.email,
        username: identity.username,
        avatar: undefined,
      };
      login(user);
      clearAuthError();
    } catch (error) {
      const failure = error as { status?: number; code?: string; message?: string };
      if (failure.status === 401 || /session.*(invalid|expired|not found)|user.*not found/i.test(failure.message || '')) {
        logout();
      } else if (failure.code === 'IDENTITY_NOT_PROVISIONED') {
        logout();
        setAuthError('IDENTITY_NOT_PROVISIONED');
      } else if (!useAuthStore.getState().user) {
        logout();
        setAuthError(failure.code || failure.message || 'IDENTITY_SERVICE_UNAVAILABLE');
      }
      // A transient API outage must not erase an already restored, valid session.
    } finally {
      setLoading(false);
      inFlight.current = false;
    }
  }, [login, logout, setLoading, setAuthError, clearAuthError]);

  useEffect(() => {
    setLoading(true);
    void restore();
    const interval = window.setInterval(() => void restore(), 60_000);
    const onFocus = () => void restore();
    window.addEventListener('focus', onFocus);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', onFocus);
    };
  }, [restore, setLoading]);

  return <>{children}</>;
}
