import { useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';
import { mapSupabaseUserWithCanonicalProfile } from '@/lib/auth';
import { Capacitor, PushNotifications } from '@/lib/capacitor-stub';

/** Trigger RSA key generation via the activitypub-keygen edge function */
async function triggerKeygenForUser(userId: string) {
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData?.session?.access_token;
    if (!token) return;

    const { data: existing } = await supabase
      .from('activitypub_keys')
      .select('id')
      .eq('user_id', userId)
      .maybeSingle();
    if (existing) return;

    const backendUrl = import.meta.env.VITE_SUPABASE_URL;
    if (!backendUrl) return;
    await fetch(`${backendUrl}/functions/v1/activitypub-keygen`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ user_id: userId }),
    });
    console.log('[ActivityPub] RSA keys generated for', userId);
  } catch (err) {
    console.warn('[ActivityPub] Keygen failed (non-fatal):', err);
  }
}

/**
 * Send an in-app notification and optionally a push notification.
 *
 * Only inserts columns that actually exist in the notifications table:
 *   user_id, type, from_user_id, post_id, read, created_at
 *
 * Push delivery is attempted via the send-push-notification edge function
 * (non-fatal — the in-app notification is always attempted first).
 */
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
    const notificationType = data?.type && ['like','repost','follow','reply','mention','verified'].includes(data.type)
      ? data.type
      : 'follow';

    const { error: dbError } = await supabase.from('notifications').insert({
      user_id: recipientUserId,
      type: notificationType,
      from_user_id: data?.fromUserId ?? null,
      post_id: data?.postId ?? null,
    });

    if (dbError) {
      console.warn('[Notification] DB insert failed:', dbError.message);
    }

    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData?.session?.access_token;
    if (token) {
      const backendUrl = import.meta.env.VITE_SUPABASE_URL;
      if (backendUrl) {
        fetch(`${backendUrl}/functions/v1/send-push-notification`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            user_id: recipientUserId,
            title,
            body,
            data,
          }),
        }).catch(() => {});
      }
    }
  } catch (error) {
    console.warn('[Notification] Failed to send activity notification:', error);
  }
}

async function registerPushNotifications(userId: string) {
  if (!Capacitor.isNativePlatform()) return;

  try {
    const permResult = await PushNotifications.requestPermissions();
    if (permResult.receive !== 'granted') {
      console.log('[Push] Permission denied');
      return;
    }

    await PushNotifications.register();

    PushNotifications.addListener('registration', async (token) => {
      console.log('[Push] FCM token:', token.value);
      await supabase.from('fcm_tokens').upsert(
        {
          user_id: userId,
          token: token.value,
          platform: Capacitor.getPlatform(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,token' }
      );
    });

    PushNotifications.addListener('registrationError', (error) => {
      console.error('[Push] Registration error:', error);
    });

    PushNotifications.addListener('pushNotificationReceived', (notification) => {
      console.log('[Push] Received:', notification);
    });

    PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
      console.log('[Push] Action performed:', action);
      const routeData = action.notification.data;
      if (routeData?.route) {
        window.location.href = routeData.route;
      }
    });
  } catch (err) {
    console.error('[Push] Setup error:', err);
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { login, logout, setLoading } = useAuthStore();

  useEffect(() => {
    let mounted = true;

    const applyAuthenticatedUser = async (user: NonNullable<Awaited<ReturnType<typeof supabase.auth.getUser>>['data']['user']>) => {
      const mappedUser = await mapSupabaseUserWithCanonicalProfile(user);
      if (!mounted) return;
      login(mappedUser);
    };

    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (mounted && session?.user) {
        await applyAuthenticatedUser(session.user);
        if (!mounted) return;
        registerPushNotifications(session.user.id);
        triggerKeygenForUser(session.user.id);
      }
      if (mounted) setLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (!mounted) return;

      if (event === 'SIGNED_IN' && session?.user) {
        await applyAuthenticatedUser(session.user);
        if (!mounted) return;
        setLoading(false);
        registerPushNotifications(session.user.id);
        triggerKeygenForUser(session.user.id);
      } else if (event === 'SIGNED_OUT') {
        logout();
        setLoading(false);
      } else if (event === 'TOKEN_REFRESHED' && session?.user) {
        await applyAuthenticatedUser(session.user);
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [login, logout, setLoading]);

  return <>{children}</>;
}
