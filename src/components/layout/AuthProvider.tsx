import { useEffect } from 'react';
import { User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';
import { mapSupabaseUser, mapSupabaseUserWithCanonicalProfile } from '@/lib/auth';
import { Capacitor, PushNotifications } from '@/lib/capacitor-stub';
import { TestagramEvent, trackTestagramEvent } from '@/lib/testagram-analytics';

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

async function registerPushNotifications(userId: string) {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const permResult = await PushNotifications.requestPermissions();
    if (permResult.receive !== 'granted') return;
    await PushNotifications.register();
    PushNotifications.addListener('registration', async (token) => {
      await supabase.from('fcm_tokens').upsert({ user_id: userId, token: token.value, platform: Capacitor.getPlatform(), updated_at: new Date().toISOString() }, { onConflict: 'user_id,token' });
    });
    PushNotifications.addListener('registrationError', (error) => console.error('[Push] Registration error:', error));
    PushNotifications.addListener('pushNotificationReceived', (notification) => console.log('[Push] Received:', notification));
    PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
      const routeData = action.notification.data;
      if (routeData?.route) window.location.href = routeData.route;
    });
  } catch (err) {
    console.error('[Push] Setup error:', err);
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { login, logout, setLoading } = useAuthStore();

  useEffect(() => {
    let mounted = true;

    const hydrateUser = (user: User) => {
      // Keep auth state changes synchronous and cheap. Supabase warns that async
      // calls made directly inside onAuthStateChange can deadlock the client.
      login(mapSupabaseUser(user));
      setLoading(false);

      window.setTimeout(() => {
        if (!mounted) return;
        void mapSupabaseUserWithCanonicalProfile(user).then((mappedUser) => {
          if (!mounted) return;
          login(mappedUser);
        }).catch((error) => {
          console.warn('[Auth] Background profile hydration failed:', error);
        });
      }, 0);

      window.setTimeout(() => {
        if (!mounted) return;
        void registerPushNotifications(user.id);
        void triggerKeygenForUser(user.id);
      }, 0);
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        trackTestagramEvent(TestagramEvent.LOGGED_OUT, { auth_event: event });
        logout();
        setLoading(false);
        return;
      }

      if (!session?.user) {
        if (event === 'INITIAL_SESSION') setLoading(false);
        return;
      }

      if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
        if (event === 'SIGNED_IN') {
          trackTestagramEvent(TestagramEvent.LOGGED_IN, { auth_event: event });
        }
        if (event === 'USER_UPDATED') {
          trackTestagramEvent(TestagramEvent.PROFILE_UPDATED, { source: 'auth_user_updated' });
        }
        hydrateUser(session.user);
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [login, logout, setLoading]);

  return <>{children}</>;
}
