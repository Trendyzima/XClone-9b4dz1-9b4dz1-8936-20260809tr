import { supabase, supabasePublishableKey, supabaseUrl } from '@/lib/supabase';
import { appwriteAuth } from '@/services/appwriteAuth';

const ENDPOINT = `${supabaseUrl}/functions/v1/identity-signup`;
const VERIFICATION_ENDPOINT = `${supabaseUrl}/functions/v1/identity-verification`;
const TOKEN_KEY = 'testagram-identity-registration-token';
const SESSION_KEY = 'testagram-identity-session-token';

const REQUEST_TIMEOUT_MS = 15_000;

async function call<T>(endpoint: string, body: Record<string, unknown>, accessToken?: string): Promise<T> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { apikey: supabasePublishableKey, 'Content-Type': 'application/json', ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.ok === false) {
      const rawError = String(payload?.error || '');
      // Edge Functions can return upstream/database error text. Only expose
      // stable machine-readable codes to the browser; never render internals.
      const code = /^[A-Z][A-Z0-9_]{1,79}$/.test(rawError) ? rawError : '';
      if (code) throw new Error(code);
      if (response.status === 429) throw new Error('RATE_LIMITED');
      if (response.status >= 500) throw new Error('IDENTITY_SERVICE_UNAVAILABLE');
      throw new Error('IDENTITY_REQUEST_FAILED');
    }
    return payload as T;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw new Error('IDENTITY_REQUEST_TIMEOUT');
    if (error instanceof Error && error.message) throw error;
    throw new Error('IDENTITY_NETWORK_ERROR');
  } finally {
    window.clearTimeout(timeoutId);
  }
}

export type IdentitySignupStatus = {
  status: 'pending' | 'under_review' | 'approved' | 'rejected' | 'blocked';
  verification_stage?: string;
  email_verified: boolean;
  rejection_reason?: string | null;
};

export type VerificationUpload = { kind: string; path: string; token: string };

export const identitySignup = {
  token(): string | null { try { return window.sessionStorage.getItem(TOKEN_KEY); } catch { return null; } },
  setToken(token: string) { try { window.sessionStorage.setItem(TOKEN_KEY, token); } catch {} },
  sessionToken(): string | null { try { return window.sessionStorage.getItem(SESSION_KEY); } catch { return null; } },
  setSessionToken(token: string) { try { window.sessionStorage.setItem(SESSION_KEY, token); } catch {} },
  clearToken() { try { window.sessionStorage.removeItem(TOKEN_KEY); window.sessionStorage.removeItem(SESSION_KEY); } catch {} },
  async start(input: { email: string; birthDate: string; username?: string; displayName?: string; legalPolicyVersion: string }) {
    const result = await call<{ registration_token: string; email: string }>(ENDPOINT, {
      action: 'start', email: input.email, birth_date: input.birthDate, username: input.username || null,
      display_name: input.displayName || null, legal_accepted: true, legal_policy_version: input.legalPolicyVersion,
    });
    this.setToken(result.registration_token); return result;
  },
  async verifyEmail(code: string) {
    const token = this.token(); if (!token) throw new Error('REGISTRATION_TOKEN_REQUIRED');
    return call<{ ok: true; next: 'identity_verification' }>(ENDPOINT, { action: 'verify_email', registration_token: token, code });
  },
  async resendEmail() {
    const token = this.token(); if (!token) throw new Error('REGISTRATION_TOKEN_REQUIRED');
    return call<{ ok: true }>(ENDPOINT, { action: 'resend_email', registration_token: token });
  },
  async createIdentitySession() {
    const token = this.token(); if (!token) throw new Error('REGISTRATION_TOKEN_REQUIRED');
    const result = await call<{ session_id: string; session_token: string; url: string; already_approved?: boolean }>(ENDPOINT, { action: 'create_identity_session', registration_token: token });
    if (result.session_token) this.setSessionToken(result.session_token);
    return result;
  },
  async startExisting() {
    const { data } = await supabase.auth.getSession();
    if (!data.session?.access_token) throw new Error('AUTH_REQUIRED');
    const result = await call<{ registration_token?: string; session_token?: string; url?: string; already_approved?: boolean }>(ENDPOINT, { action: 'start_existing' }, data.session.access_token);
    if (result.registration_token) this.setToken(result.registration_token);
    if (result.session_token) this.setSessionToken(result.session_token);
    return result;
  },
  async status() {
    const token = this.token(); if (!token) throw new Error('REGISTRATION_TOKEN_REQUIRED');
    return call<IdentitySignupStatus>(ENDPOINT, { action: 'status', registration_token: token });
  },
  async finalize(password: string) {
    const token = this.token(); if (!token) throw new Error('REGISTRATION_TOKEN_REQUIRED');
    const result = await call<{ email: string; username: string; display_name: string; identity_approval_token: string }>(
      ENDPOINT,
      { action: 'finalize', registration_token: token, password },
    );
    const backendURL = (import.meta.env.VITE_TESTAGRAM_FRESH_API_URL ?? import.meta.env.VITE_TESTAGRAM_API_URL ?? '').trim();
    if (!backendURL) throw new Error('IDENTITY_SERVICE_UNAVAILABLE');
    const base = new URL(backendURL);
    if ((base.protocol !== 'https:' && !(base.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname))) || base.username || base.password || base.pathname !== '/' || base.search || base.hash) {
      throw new Error('IDENTITY_SERVICE_UNAVAILABLE');
    }
    const response = await fetch(base.toString().replace(/\/$/, '') + '/v1/identity/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ identity_approval_token: result.identity_approval_token, password }),
      credentials: 'omit',
      cache: 'no-store',
    });
    const payload = await response.json().catch(() => null) as any;
    if (!response.ok) {
      const message = String(payload?.error?.message ?? payload?.message ?? 'IDENTITY_SERVICE_UNAVAILABLE');
      throw new Error(message);
    }
    const user = await appwriteAuth.signInWithPassword({ email: result.email, password });
    this.clearToken();
    return user;
  },
  async verification(action: string, body: Record<string, unknown> = {}) {
    const sessionToken = this.sessionToken(); if (!sessionToken) throw new Error('VERIFICATION_SESSION_REQUIRED');
    return call<any>(VERIFICATION_ENDPOINT, { action, session_token: sessionToken, ...body });
  },
  async uploadEvidence(upload: VerificationUpload, file: File) {
    const { error } = await supabase.storage.from('identity-evidence').uploadToSignedUrl(upload.path, upload.token, file, { contentType: file.type || undefined });
    if (error) throw error;
  },
};
