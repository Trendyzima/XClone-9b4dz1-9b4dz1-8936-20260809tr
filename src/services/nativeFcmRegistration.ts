import { supabase } from "@/lib/supabase";

const PLATFORM = "android";
const PROVIDER = "fcm";

async function saveToken(token: string) {
  if (!token) return;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  const { error } = await supabase
    .from("app_push_tokens")
    .upsert(
      {
        user_id: user.id,
        token,
        platform: PLATFORM,
        provider: PROVIDER,
        enabled: true,
        last_seen_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,token" },
    );
  if (error) console.debug("[push] token registration failed", error);
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

  const authListener = supabase.auth.onAuthStateChange((_event, session) => {
    if (session?.user && existing) void saveToken(existing);
  });

  return () => {
    window.removeEventListener("testagram:fcm-token", onToken);
    authListener.data.subscription.unsubscribe();
  };
}
