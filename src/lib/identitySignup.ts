import { supabase, supabasePublishableKey, supabaseUrl } from '@/lib/supabase';

const ENDPOINT = `${supabaseUrl}/functions/v1/identity-signup`;
const VERIFICATION_ENDPOINT = `${supabaseUrl}/functions/v1/identity-verification`;
const TOKEN_KEY = 'testagram-identity-registration-token';
const SESSION_KEY = 'testagram-identity-session-token';

async function call<T>(endpoint: string, body: Record<string, unknown>, accessToken?: string): Promise<T> {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { apikey: supabasePublishableKey, 'Content-Type': 'application/json', ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.ok === false) throw new Error(String(payload?.error || 'Identity onboarding request failed'));
  return payload as T;
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
    const result = await call<{ user_id: string; email: string }>(ENDPOINT, { action: 'finalize', registration_token: token, password });
    this.clearToken();
    const { data, error } = await supabase.auth.signInWithPassword({ email: result.email, password });
    if (error || !data.user) throw error || new Error('ACCOUNT_SIGN_IN_FAILED');
    return data.user;
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
