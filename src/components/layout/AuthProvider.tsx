import { useEffect } from 'react';
import { User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';
import { finalizeAuthenticatedSession } from '@/lib/auth';
import { TestagramEvent, trackTestagramEvent } from '@/lib/testagram-analytics';
import { clearTestagramSessionLifetime, enforceTestagramSessionLifetime, markAuthenticatedSessionStarted } from '@/lib/sessionPolicy';
import { clearPasswordRecoverySession, getPasswordRecoverySessionUserId, hasPasswordRecoveryMarker } from '@/lib/passwordRecovery';

function normalizedPathname() {
  if (typeof window === 'undefined') return '/';
  const pathname = window.location.pathname.replace(/\/+$/, '');
  return pathname || '/';
}

function withBootstrapTimeout<T>(operation: PromiseLike<T> | Promise<T>, label: string, timeoutMs = 7_000): Promise<T> {
  let timeoutId: number | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = window.setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs);
  });
  return Promise.race([Promise.resolve(operation), timeout]).finally(() => {
    if (timeoutId !== undefined) window.clearTimeout(timeoutId);
  });
}

async function triggerKeygenForUser(userId: string) {
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData?.session?.access_token;
    if (!token) return;
    const { data: existing } = await supabase.from('activitypub_keys').select('id').eq('user_id', userId).maybeSingle();
    if (existing) return;
    const backendUrl = import.meta.env.VITE_SUPABASE_URL;
    if (!backendUrl) return;
    await fetch(`${backendUrl}/functions/v1/activitypub-keygen`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ user_id: userId }),
    });
  } catch (err) {
    console.warn('[ActivityPub] Keygen failed (non-fatal):', err);
  }
}

export async function sendActivityNotification({
  recipientUserId,
  title,
  body,
  data,
}: {
  recipientUserId: string;
  title: string;
  body: string;
  data?: any;
}) {
  try {
    const notificationType = data?.type && ['like','repost','follow','reply','mention','verified'].includes(data.type) ? data.type : 'follow';
    const { error: dbError } = await supabase.from('notifications').insert({ recipient_id: recipientUserId, kind: notificationType, actor_id: data?.fromUserId ?? null, post_id: data?.postId ?? null });
    if (dbError) console.warn('[Notification] DB insert failed:', dbError.message);
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData?.session?.access_token;
    if (token) {
      const backendUrl = import.meta.env.VITE_SUPABASE_URL;
      if (backendUrl) {
        fetch(`${backendUrl}/functions/v1/send-push-notification`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ user_id: recipientUserId, title, body, data }),
        }).catch(() => {});
      }
    }
  } catch (error) {
    console.warn('[Notification] Failed to send activity notification:', error);
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { login, logout, setLoading, setAuthError, clearAuthError } = useAuthStore();

  useEffect(() => {
    let mounted = true;

    const lifetimeTimer = window.setInterval(() => {
      void withBootstrapTimeout(enforceTestagramSessionLifetime(), 'Session validation').then((valid) => {
        if (!valid && mounted) {
          logout();
          window.location.replace('/auth');
        }
      });
    }, 30_000);

    const finalizationInFlight = new Map<string, Promise<void>>();

    const hydrateUser = (user: User, requireFreshLegalConsent = false, retryAttempt = 0) => {
      setLoading(true);
      clearAuthError();

      const existing = finalizationInFlight.get(user.id);
      if (existing) return;

      const task = new Promise<void>((resolve) => {
        window.setTimeout(() => {
          if (!mounted) {
            resolve();
            return;
          }
          void enforceTestagramSessionLifetime().then((valid) => {
            if (!valid) throw new Error('SESSION_EXPIRED');
            markAuthenticatedSessionStarted(user.id);
            return finalizeAuthenticatedSession(user, { requireFreshLegalConsent });
          })
            .then(async (mappedUser) => {
              if (!mounted) return;
              login(mappedUser);
              const path = normalizedPathname();
              // Identity verification belongs to account creation and never blocks existing logins.
// Mobile contact is a required post-sign-in profile field, not an auth
              // identifier. Keep it private in profile_contact_methods and gate the
              // application until the signed-in user has supplied a valid number.
              if (path !== '/profile/complete' && path !== '/verify-identity') {
                const mobilePhoneResult = await withBootstrapTimeout(supabase.rpc('has_my_mobile_phone') as unknown as Promise<{ data: boolean | null; error: { message: string } | null }>, 'Mobile contact validation');
                const { data: hasMobilePhone, error: mobilePhoneError } = mobilePhoneResult;
                if (mobilePhoneError) throw mobilePhoneError;
                if (!hasMobilePhone) {
                  window.location.replace('/profile/complete');
                  resolve();
                  return;
                }
              }

              setLoading(false);
              void triggerKeygenForUser(user.id);
              resolve();
            })
            .catch(async (error) => {
              if (!mounted) {
                resolve();
                return;
              }
              const message = error instanceof Error ? error.message : 'Profile provisioning failed';
              const terminalPolicyFailure = [
                'SESSION_EXPIRED',
                'AGE_RESTRICTION',
                'LEGAL_ACCEPTANCE_REQUIRED',
              ].includes(message);

              setAuthError(message);
              console.error('[Auth] Session finalization failed:', error);

              if (terminalPolicyFailure) {
                // Only explicit session/policy failures should end authentication.
                // A failed profile or contact lookup is not proof that the token is
                // invalid; signing out here made transient refresh-time outages look
                // like an unexpected logout and destroyed the valid refresh token.
                logout();
                setLoading(false);
                try { await supabase.auth.signOut(); } catch { /* best effort */ }
              } else if (retryAttempt < 1) {
                // Retry transient profile/RPC/network failures while keeping the
                // existing Supabase session intact. A refresh must not revoke a
                // valid session just because a dependent query failed once.
                window.setTimeout(() => {
                  if (mounted) hydrateUser(user, false, retryAttempt + 1);
                }, 750 * (retryAttempt + 1));
              } else {
                // Preserve the Supabase session even if a dependent service remains
                // unavailable. The next auth event or page load can retry hydration.
                setLoading(false);
                console.error('[Auth] Hydration retries exhausted; preserving auth session.');
              }
              resolve();
            });
        }, 0);
      }).finally(() => {
        finalizationInFlight.delete(user.id);
      });

      finalizationInFlight.set(user.id, task);
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        clearPasswordRecoverySession();
        clearTestagramSessionLifetime();
        trackTestagramEvent(TestagramEvent.LOGGED_OUT, { auth_event: event });
        logout();
        setLoading(false);
        return;
      }

      if (!session?.user) {
        if (event === 'INITIAL_SESSION') setLoading(false);
        return;
      }

      // A password-recovery session proves possession of the reset link, not
      // completion of a normal sign-in. Keep its Supabase session available to
      // updateUser({ password }), but do not hydrate the app store, start the
      // logged-in lifetime, or trigger application redirects until reset succeeds.
      const authCallbackParams = new URLSearchParams(window.location.search);
      const isPasswordResetRoute =
        normalizedPathname() === '/auth' &&
        (authCallbackParams.get('reset') === '1' || authCallbackParams.get('type') === 'recovery');
      const recoveryUserId = getPasswordRecoverySessionUserId();
      const recoveryMarkerPresent = hasPasswordRecoveryMarker();
      const isRecoverySession =
        recoveryMarkerPresent && (!recoveryUserId || recoveryUserId === session.user.id);
      if (isPasswordResetRoute) {
        if (event === 'INITIAL_SESSION') setLoading(false);
        return;
      }
      if (isRecoverySession) {
        // Recovery sessions may be used only to set a new password. If the user
        // leaves the reset route or its short-lived marker expires, do not let a
        // refresh turn that temporary session into a normal application login.
        void supabase.auth.signOut();
        logout();
        setLoading(false);
        return;
      }

      // Identity-first onboarding must never admit anonymous Auth sessions into
      // the application. Even if a hosted Auth setting is misconfigured, an
      // anonymous session is not a Testagram account and cannot bypass KYC.
      if (session.user.is_anonymous) {
        void supabase.auth.signOut();
        logout();
        setLoading(false);
        return;
      }

      if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN' || event === 'USER_UPDATED') {
        if (event === 'SIGNED_IN') {
          trackTestagramEvent(TestagramEvent.LOGGED_IN, { auth_event: event });
        }
        if (event === 'USER_UPDATED') {
          trackTestagramEvent(TestagramEvent.PROFILE_UPDATED, { source: 'auth_user_updated' });
        }
        // AuthPage already performs the legal/account finalization during sign-in.\n        // Re-running it here with requireFreshLegalConsent would reject the newly\n        // authenticated session after the local consent record has been consumed.\n        hydrateUser(session.user, false);
      }
    });

    return () => {
      mounted = false;
      window.clearInterval(lifetimeTimer);
      subscription.unsubscribe();
    };
  }, [login, logout, setLoading, setAuthError, clearAuthError]);

  return <>{children}</>;
}
