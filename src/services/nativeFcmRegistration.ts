import { APPWRITE_AUTH_CHANGED_EVENT, appwriteAuth } from "@/services/appwriteAuth";
import { backendCapabilities } from "@/services/testagramCapabilityClient";

const PLATFORM = "android";
const PROVIDER = "fcm";

async function saveToken(token: string) {
  if (!token) return;
  const user = await appwriteAuth.getCurrentUser();
  if (!user) return;
  try {
    await backendCapabilities.call('testagram.notifications.fcm.register', {
      token,
      platform: PLATFORM,
      provider: PROVIDER,
    });
  } catch (error) {
    console.debug('[push] token registration failed', error);
  }
}

export function installNativeFcmRegistration() {
  if (typeof window === "undefined") return () => undefined;

  const onToken = (event: Event) => {
    const detail = (event as CustomEvent<{ token?: string }>).detail;
    if (detail?.token) void saveToken(detail.token);
  };

  window.addEventListener("testagram:fcm-token", onToken);
  const existing = (window as Window & { __TESTAGRAM_FCM_TOKEN__?: string }).__TESTAGRAM_FCM_TOKEN__;
  if (existing) void saveToken(existing);

  const authListener = () => { if (existing) void saveToken(existing); };
  window.addEventListener(APPWRITE_AUTH_CHANGED_EVENT, authListener);

  return () => {
    window.removeEventListener("testagram:fcm-token", onToken);
    window.removeEventListener(APPWRITE_AUTH_CHANGED_EVENT, authListener);
  };
}
