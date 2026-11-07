import type { User } from "@supabase/supabase-js";
import { appwriteAccount, assertAppwriteAuthConfigured } from "@/lib/appwrite";

const AUTH_CHANGED_EVENT = "testagram:appwrite-auth-changed";
const RECOVERY_USER_ID_KEY = "testagram-appwrite-recovery-user";
const RECOVERY_SECRET_KEY = "testagram-appwrite-recovery-secret";
const RECOVERY_EMAIL_KEY = "testagram-appwrite-recovery-email";

type AppwriteAccountUser = {
  $id: string;
  $createdAt?: string;
  $updatedAt?: string;
  name?: string;
  email?: string;
  phone?: string;
  prefs?: Record<string, unknown>;
  isAnonymous?: boolean;
};

export function toCompatibleAuthUser(user: AppwriteAccountUser): User {
  const prefs = user.prefs ?? {};
  return {
    id: user.$id,
    email: user.email ?? "",
    phone: user.phone ?? "",
    user_metadata: {
      ...prefs,
      name: user.name ?? "",
      full_name: user.name ?? "",
      username: typeof prefs.username === "string" ? prefs.username : undefined,
      avatar_url: typeof prefs.avatar_url === "string" ? prefs.avatar_url : undefined,
    },
    app_metadata: { provider: "appwrite", providers: ["appwrite"] },
    aud: "authenticated",
    created_at: user.$createdAt ?? new Date().toISOString(),
    updated_at: user.$updatedAt ?? new Date().toISOString(),
    is_anonymous: user.isAnonymous ?? false,
  } as unknown as User;
}

export async function getAppwriteAuthUser(): Promise<User | null> {
  assertAppwriteAuthConfigured();
  try {
    const user = await appwriteAccount.get();
    return toCompatibleAuthUser(user as unknown as AppwriteAccountUser);
  } catch (error) {
    const code = Number((error as { code?: unknown } | null)?.code ?? 0);
    if (code === 401 || code === 404) return null;
    throw error;
  }
}

export async function appwriteSignInWithPassword(email: string, password: string): Promise<User> {
  assertAppwriteAuthConfigured();
  await appwriteAccount.createEmailPasswordSession({ email, password });
  const user = await getAppwriteAuthUser();
  if (!user) throw new Error("Appwrite session was created but the account could not be loaded.");
  window.dispatchEvent(new Event(AUTH_CHANGED_EVENT));
  return user;
}

export async function appwriteSignOut(): Promise<void> {
  assertAppwriteAuthConfigured();
  try {
    await appwriteAccount.deleteSession({ sessionId: "current" });
  } finally {
    window.dispatchEvent(new Event(AUTH_CHANGED_EVENT));
  }
}

export async function appwriteCreatePasswordRecovery(email: string, url: string): Promise<void> {
  assertAppwriteAuthConfigured();
  await appwriteAccount.createRecovery({ email, url });
}

export function saveAppwriteRecovery(userId: string, secret: string, email: string): void {
  window.sessionStorage.setItem(RECOVERY_USER_ID_KEY, userId);
  window.sessionStorage.setItem(RECOVERY_SECRET_KEY, secret);
  if (email) window.sessionStorage.setItem(RECOVERY_EMAIL_KEY, email);
}

export function clearAppwriteRecovery(): void {
  window.sessionStorage.removeItem(RECOVERY_USER_ID_KEY);
  window.sessionStorage.removeItem(RECOVERY_SECRET_KEY);
  window.sessionStorage.removeItem(RECOVERY_EMAIL_KEY);
}

export function hasAppwriteRecovery(): boolean {
  return Boolean(window.sessionStorage.getItem(RECOVERY_USER_ID_KEY) && window.sessionStorage.getItem(RECOVERY_SECRET_KEY));
}

export async function appwriteCompletePasswordRecovery(password: string): Promise<User> {
  assertAppwriteAuthConfigured();
  const userId = window.sessionStorage.getItem(RECOVERY_USER_ID_KEY) ?? "";
  const secret = window.sessionStorage.getItem(RECOVERY_SECRET_KEY) ?? "";
  const email = window.sessionStorage.getItem(RECOVERY_EMAIL_KEY) ?? "";
  if (!userId || !secret || !email) throw new Error("Recovery link is missing required account details.");
  await appwriteAccount.updateRecovery({ userId, secret, password });
  clearAppwriteRecovery();
  return appwriteSignInWithPassword(email, password);
}

export async function createAppwriteUserJWT(): Promise<string> {
  assertAppwriteAuthConfigured();
  const result = await appwriteAccount.createJWT();
  if (!result.jwt) throw new Error("Appwrite did not return a user JWT.");
  return result.jwt;
}

export { AUTH_CHANGED_EVENT };
