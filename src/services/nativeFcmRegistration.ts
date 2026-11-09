import { appwriteAuth, APPWRITE_AUTH_CHANGED_EVENT } from '@/services/appwriteAuth';
import { backendCapabilities } from '@/services/testagramCapabilityClient';

const PLATFORM = 'android';
const PROVIDER = 'fcm';

async function saveToken(token: string) {
  const normalized = token.trim();
  if (!normalized) return;
  const user = await appwriteAuth.getCurrentUser().catch(() => null);
  if (!user) return;
  await backendCapabilities.call('testagram.notifications.fcm.register', {
    token: normalized,
    platform: PLATFORM,
    provider: PROVIDER,
  });
}

export function installNativeFcmRegistration() {
  if (typeof window === 'undefined') return () => undefined;
  const onToken = (event: Event) => {
    const detail = (event as CustomEvent<{ token?: string }>).detail;
    if (detail?.token) void saveToken(detail.token).catch(error => console.warn('[push] Backend token registration failed', error));
  };
  const onAuth = () => {
    const token = (window as Window & { __TESTAGRAM_FCM_TOKEN__?: string }).__TESTAGRAM_FCM_TOKEN__;
    if (token) void saveToken(token).catch(error => console.warn('[push] Backend token registration failed', error));
  };
  window.addEventListener('testagram:fcm-token', onToken);
  window.addEventListener(APPWRITE_AUTH_CHANGED_EVENT, onAuth);
  const existing = (window as Window & { __TESTAGRAM_FCM_TOKEN__?: string }).__TESTAGRAM_FCM_TOKEN__;
  if (existing) void saveToken(existing).catch(error => console.warn('[push] Backend token registration failed', error));
  return () => {
    window.removeEventListener('testagram:fcm-token', onToken);
    window.removeEventListener(APPWRITE_AUTH_CHANGED_EVENT, onAuth);
  };
}
