import { useEffect } from 'react';
import { User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';
import { finalizeAuthenticatedSession } from '@/lib/auth';
import { TestagramEvent, trackTestagramEvent } from '@/lib/testagram-analytics';
import { clearTestagramSessionLifetime, enforceTestagramSessionLifetime, markAuthenticatedSessionStarted } from '@/lib/sessionPolicy';

function normalizedPathname() {
  if (typeof window === 'undefined') return '/';
  const pathname = window.location.pathname.replace(/\/+$/, '');
  return pathname || '/';
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
      void enforceTestagramSessionLifetime().then((valid) => {
        if (!valid && mounted) {
          logout();
          window.location.replace('/auth');
        }
      });
    }, 30_000);

    const finalizationInFlight = new Map<string, Promise<void>>();

    const hydrateUser = (user: User, requireFreshLegalConsent = false) => {
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
            markAuthenticatedSessionStarted();
            return finalizeAuthenticatedSession(user, { requireFreshLegalConsent });
          })
            .then(async (mappedUser) => {
              if (!mounted) return;
              login(mappedUser);

              // Identity verification is a hard account gate. Normalize the path
              // before comparing it so /verify-identity and /verify-identity/
              // cannot trigger a full-document redirect loop.
              const path = normalizedPathname();
              const identityRequired =
                mappedUser.identityVerificationStatus &&
                !['not_required', 'approved'].includes(mappedUser.identityVerificationStatus);

              if (identityRequired && path !== '/verify-identity') {
                window.location.replace('/verify-identity');
                resolve();
                return;
              }

              // Mobile contact is a required post-sign-in profile field, not an auth
              // identifier. Keep it private in profile_contact_methods and gate the
              // application until the signed-in user has supplied a valid number.
              if (path !== '/profile/complete' && path !== '/verify-identity') {
                const { data: hasMobilePhone, error: mobilePhoneError } = await supabase.rpc('has_my_mobile_phone');
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
              setAuthError(message);
              logout();
              setLoading(false);
              try { await supabase.auth.signOut(); } catch { /* best effort */ }
              console.error('[Auth] Session finalization failed:', error);
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
        trackTestagramEvent(TestagramEvent.LOGGED_OUT, { auth_event: event });
        clearTestagramSessionLifetime();
        logout();
        setLoading(false);
        return;
      }

      if (!session?.user) {
        if (event === 'INITIAL_SESSION') setLoading(false);
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
        hydrateUser(session.user, event === 'SIGNED_IN');
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
