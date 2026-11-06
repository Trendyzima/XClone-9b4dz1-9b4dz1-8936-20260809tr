import { ID, type Models } from 'appwrite';
import {
  appwriteAccount,
  assertAppwriteAuthConfigured,
} from '@/lib/appwrite';

const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 256;
const BACKEND_JWT_CACHE_MS = 10 * 60 * 1000;

type CanonicalIdentity = {
  canonical_user_id: string;
  appwrite_user_id: string;
  email: string;
  email_verified: boolean;
  username: string;
  display_name: string;
  account_status: 'active' | 'deactivated' | 'suspended';
};

type IdentityEnvelope = {
  ok: boolean;
  data?: CanonicalIdentity;
  error?: { code?: string; message?: string };
  request_id?: string;
};

type IdentityLinkResponse = {
  ok: boolean;
  data?: { canonical_user_id: string; linked: boolean; already_linked: boolean };
  error?: { code?: string; message?: string };
  request_id?: string;
};

function testagramAPIOrigin(): string {
  const raw = (import.meta.env.VITE_TESTAGRAM_API_URL ?? '').trim();
  if (!raw) throw new Error('Testagram independent API URL is not configured.');
  let parsed: URL;
  try { parsed = new URL(raw); } catch { throw new Error('Testagram API URL must be an absolute HTTPS origin.'); }
  const localHTTP = parsed.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]', '::1'].includes(parsed.hostname);
  if ((parsed.protocol !== 'https:' && !localHTTP) || parsed.username || parsed.password ||
      parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new Error('Testagram API URL must be an HTTPS origin (HTTP only on localhost), without credentials, path, query, or fragment.');
  }
  return parsed.origin;
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
    const user = await appwriteAccount.get();
    await this.sendEmailVerification();
    return user;
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
    return appwriteAccount.get();
  },

  /**
   * Explicitly links the current verified Appwrite identity to an existing
   * Supabase account. The legacy access token is used once as proof of control;
   * neither token is persisted by this method. This does not switch the global
   * application session or migrate account data.
   */
  async linkLegacyAccount(legacyAccessToken: string): Promise<{
    canonicalUserId: string;
    alreadyLinked: boolean;
  }> {
    assertAppwriteAuthConfigured();
    const legacyToken = legacyAccessToken.trim();
    if (!legacyToken || legacyToken.length > 8192 || /[\r\n]/.test(legacyToken)) {
      throw new Error('Sign in to your existing Testagram account before linking.');
    }
    const response = await fetch(testagramAPIOrigin() + '/api/identity/link', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + await this.createBackendJWT(true),
        'X-Testagram-Legacy-Authorization': 'Bearer ' + legacyToken,
      },
      cache: 'no-store',
      credentials: 'omit',
    });
    let payload: IdentityLinkResponse | null = null;
    try { payload = await response.json() as IdentityLinkResponse; } catch { /* handled below */ }
    if (!response.ok || !payload?.ok || !payload.data?.canonical_user_id) {
      throw new Error(payload?.error?.message || 'Account linking failed (HTTP ' + response.status + ').');
    }
    return {
      canonicalUserId: payload.data.canonical_user_id,
      alreadyLinked: payload.data.already_linked,
    };
  },

  async getCanonicalIdentity(): Promise<CanonicalIdentity> {
    assertAppwriteAuthConfigured();
    const response = await fetch(testagramAPIOrigin() + '/api/identity/session', {
      method: 'GET',
      headers: { Authorization: 'Bearer ' + await this.createBackendJWT(), Accept: 'application/json' },
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
    });
    let payload: IdentityEnvelope | null = null;
    try { payload = await response.json() as IdentityEnvelope; } catch { /* handled below */ }
    if (!response.ok || !payload?.ok || !payload.data?.canonical_user_id) {
      const code = payload?.error?.code || 'IDENTITY_SESSION_FAILED';
      const message = payload?.error?.message || 'Testagram could not resolve this account.';
      throw Object.assign(new Error(message), { code, status: response.status, requestId: payload?.request_id });
    }
    return payload.data;
  },

  async provisionCanonicalIdentity(input: { username: string; displayName: string; birthDate: string; policyVersion: string }): Promise<CanonicalIdentity> {
    assertAppwriteAuthConfigured();
    const response = await fetch(testagramAPIOrigin() + '/api/identity/provision', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + await this.createBackendJWT(true),
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ username: input.username.trim(), display_name: input.displayName.trim(), birth_date: input.birthDate, policy_version: input.policyVersion, terms_accepted: true, privacy_accepted: true, content_policy_accepted: true, age_confirmed: true }),
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
    });
    let payload: IdentityEnvelope | null = null;
    try { payload = await response.json() as IdentityEnvelope; } catch { /* handled below */ }
    if (!response.ok || !payload?.ok || !payload.data?.canonical_user_id) {
      const code = payload?.error?.code || 'IDENTITY_PROVISION_FAILED';
      const message = payload?.error?.message || 'Testagram could not create the account profile.';
      throw Object.assign(new Error(message), { code, status: response.status, requestId: payload?.request_id });
    }
    return payload.data;
  },

  async getCurrentUser(): Promise<Models.User<Models.Preferences>> {
    assertAppwriteAuthConfigured();
    return appwriteAccount.get();
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
      url: `${window.location.origin}/auth?appwrite_verify=1`,
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
      url: `${window.location.origin}/auth?appwrite_recovery=1`,
    });
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
    try { await appwriteAccount.deleteSession({ sessionId: 'current' }); }
    finally { clearBackendJWT(); }
  },

  async signOutAll(): Promise<void> {
    assertAppwriteAuthConfigured();
    try { await appwriteAccount.deleteSessions(); }
    finally { clearBackendJWT(); }
  },
};
