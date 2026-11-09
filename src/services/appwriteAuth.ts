import { ID, type Models } from 'appwrite';
import {
  appwriteAccount,
  assertAppwriteAuthConfigured,
} from '@/lib/appwrite';

const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 256;
export const APPWRITE_AUTH_CHANGED_EVENT = 'testagram:appwrite-auth-changed';
const BACKEND_JWT_CACHE_MS = 10 * 60 * 1000;
export type AppwriteRecoveryContext = { userId: string; secret: string; email: string };

// Recovery links contain a short-lived, single-use secret. Keep it only in
// module memory while the reset screen is mounted; never persist it in
// localStorage, sessionStorage, cookies, or another browser storage surface.
// A reload intentionally requires the user to reopen the original email link.
let recoveryContext: AppwriteRecoveryContext | null = null;

function saveRecoveryContext(input: AppwriteRecoveryContext): void {
  if (!input.userId.trim() || !input.secret.trim()) {
    throw new Error('Password recovery details are missing or expired.');
  }
  recoveryContext = { userId: input.userId, secret: input.secret, email: input.email };
}

function getRecoveryContext(): AppwriteRecoveryContext | null {
  return recoveryContext ? { ...recoveryContext } : null;
}

function clearRecoveryContext(): void {
  recoveryContext = null;
}


let cachedBackendJWT: string | null = null;
let backendJWTExpiresAt = 0;

function normalizeEmail(value: string): string {
  const email = value.trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email) || email.length > 254) {
    throw new Error('Enter a valid email address.');
  }
  return email;
}

function validatePassword(value: string): void {
  if (value.length < MIN_PASSWORD_LENGTH || value.length > MAX_PASSWORD_LENGTH) {
    throw new Error('Password must contain between 8 and 256 characters.');
  }
}

function clearBackendJWT(): void {
  cachedBackendJWT = null;
  backendJWTExpiresAt = 0;
}

export const appwriteAuth = {
  async signUpWithPassword(input: {
    email: string;
    password: string;
    name: string;
  }): Promise<Models.User<Models.Preferences>> {
    assertAppwriteAuthConfigured();
    const email = normalizeEmail(input.email);
    validatePassword(input.password);
    const name = input.name.trim();
    if (!name || name.length > 128) {
      throw new Error('Enter a name up to 128 characters.');
    }

    await appwriteAccount.create({
      userId: ID.unique(),
      email,
      password: input.password,
      name,
    });
    await appwriteAccount.createEmailPasswordSession({ email, password: input.password });
    clearBackendJWT();
    if (typeof window !== 'undefined') window.dispatchEvent(new Event(APPWRITE_AUTH_CHANGED_EVENT));
    return appwriteAccount.get();
  },

  async signInWithPassword(input: {
    email: string;
    password: string;
  }): Promise<Models.User<Models.Preferences>> {
    assertAppwriteAuthConfigured();
    await appwriteAccount.createEmailPasswordSession({
      email: normalizeEmail(input.email),
      password: input.password,
    });
    clearBackendJWT();
    if (typeof window !== 'undefined') window.dispatchEvent(new Event(APPWRITE_AUTH_CHANGED_EVENT));
    return appwriteAccount.get();
  },

  async listSessions() {
    assertAppwriteAuthConfigured();
    return appwriteAccount.listSessions();
  },

  async signOutAllSessions(): Promise<void> {
    assertAppwriteAuthConfigured();
    try {
      await appwriteAccount.deleteSessions();
    } finally {
      clearBackendJWT();
      if (typeof window !== 'undefined') window.dispatchEvent(new Event(APPWRITE_AUTH_CHANGED_EVENT));
    }
  },

  async updatePreferences(prefs: Models.Preferences): Promise<Models.User<Models.Preferences>> {
    assertAppwriteAuthConfigured();
    const user = await appwriteAccount.updatePrefs({ prefs });
    clearBackendJWT();
    if (typeof window !== 'undefined') window.dispatchEvent(new Event(APPWRITE_AUTH_CHANGED_EVENT));
    return user;
  },

  async getCurrentUser(): Promise<Models.User<Models.Preferences> | null> {
    assertAppwriteAuthConfigured();
    try {
      return await appwriteAccount.get();
    } catch (error) {
      const code = Number((error as { code?: unknown } | null)?.code ?? 0);
      if (code === 401 || code === 404) return null;
      throw error;
    }
  },

  async createBackendJWT(forceRefresh = false): Promise<string> {
    assertAppwriteAuthConfigured();
    if (!forceRefresh && cachedBackendJWT && Date.now() < backendJWTExpiresAt) {
      return cachedBackendJWT;
    }
    const result = await appwriteAccount.createJWT();
    if (!result.jwt) throw new Error('Appwrite did not return a backend session token.');
    cachedBackendJWT = result.jwt;
    // Appwrite JWTs are short-lived; cache only in memory and below their
    // documented lifetime. Never persist this JWT in browser storage.
    backendJWTExpiresAt = Date.now() + BACKEND_JWT_CACHE_MS;
    return result.jwt;
  },

  async getBackendAuthorizationHeader(): Promise<Record<string, string>> {
    return { Authorization: `Bearer ${await this.createBackendJWT()}` };
  },

  async sendEmailVerification(): Promise<void> {
    assertAppwriteAuthConfigured();
    await appwriteAccount.createVerification({
      url: `${window.location.origin}/auth/verify`,
    });
  },

  async completeEmailVerification(userId: string, secret: string): Promise<void> {
    assertAppwriteAuthConfigured();
    if (!userId.trim() || !secret.trim()) {
      throw new Error('Verification details are missing or expired.');
    }
    await appwriteAccount.updateVerification({ userId, secret });
  },

  async requestPasswordRecovery(emailInput: string): Promise<void> {
    assertAppwriteAuthConfigured();
    await appwriteAccount.createRecovery({
      email: normalizeEmail(emailInput),
      url: `${window.location.origin}/auth?reset=1`,
    });
  },

  saveRecoveryContext,
  getRecoveryContext,
  clearRecoveryContext,

  async completePasswordRecoveryAndSignIn(input: {
    userId: string;
    secret: string;
    email: string;
    password: string;
  }): Promise<Models.User<Models.Preferences>> {
    await this.completePasswordRecovery({ userId: input.userId, secret: input.secret, password: input.password });
    await appwriteAccount.createEmailPasswordSession({ email: normalizeEmail(input.email), password: input.password });
    clearBackendJWT();
    clearRecoveryContext();
    return appwriteAccount.get();
  },

  async completePasswordRecovery(input: {
    userId: string;
    secret: string;
    password: string;
  }): Promise<void> {
    assertAppwriteAuthConfigured();
    validatePassword(input.password);
    if (!input.userId.trim() || !input.secret.trim()) {
      throw new Error('Password recovery details are missing or expired.');
    }
    await appwriteAccount.updateRecovery({
      userId: input.userId,
      secret: input.secret,
      password: input.password,
    });
    clearBackendJWT();
  },

  async signOut(): Promise<void> {
    assertAppwriteAuthConfigured();
    try {
      await appwriteAccount.deleteSession({ sessionId: 'current' });
    } finally {
      clearBackendJWT();
      if (typeof window !== 'undefined') window.dispatchEvent(new Event(APPWRITE_AUTH_CHANGED_EVENT));
    }
  },
};
