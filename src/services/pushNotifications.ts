import { backendCapabilities } from '@/services/backendClient';

const SERVICE_WORKER_PATH = '/sw.js';

function base64UrlToArrayBuffer(value: string): ArrayBuffer {
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  const normalized = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(normalized);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes.buffer;
}

function supported(): boolean {
  return typeof window !== 'undefined'
    && 'serviceWorker' in navigator
    && 'PushManager' in window
    && 'Notification' in window;
}

export async function enableLocalPushNotifications(): Promise<{ enabled: boolean; reason?: string }> {
  if (!supported()) return { enabled: false, reason: 'PUSH_UNSUPPORTED' };
  if (!window.isSecureContext) return { enabled: false, reason: 'PUSH_REQUIRES_HTTPS' };

  const permission = Notification.permission === 'granted'
    ? 'granted'
    : await Notification.requestPermission();
  if (permission !== 'granted') return { enabled: false, reason: 'PUSH_PERMISSION_DENIED' };

  const config = await backendCapabilities.getPushConfig();
  if (!config.public_key) return { enabled: false, reason: 'PUSH_NOT_CONFIGURED' };

  const registration = await navigator.serviceWorker.register(SERVICE_WORKER_PATH, { scope: '/' });
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64UrlToArrayBuffer(config.public_key),
    });
  }

  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
    return { enabled: false, reason: 'PUSH_SUBSCRIPTION_INVALID' };
  }

  await backendCapabilities.subscribePush({
    endpoint: json.endpoint,
    p256dh: json.keys.p256dh,
    auth_key: json.keys.auth,
    platform: navigator.userAgent.slice(0, 120),
  });
  return { enabled: true };
}

export async function disableLocalPushNotifications(): Promise<void> {
  if (!supported()) return;
  const registration = await navigator.serviceWorker.getRegistration(SERVICE_WORKER_PATH);
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return;
  const endpoint = subscription.endpoint;
  await subscription.unsubscribe();
  await backendCapabilities.unsubscribePush(endpoint);
}

export async function getLocalPushStatus(): Promise<NotificationPermission | 'unsupported'> {
  if (!supported()) return 'unsupported';
  return Notification.permission;
}
