import { supabase, supabasePublishableKey, supabaseUrl } from '@/lib/supabase';

const ENDPOINT = `${supabaseUrl}/functions/v1/identity-signup`;
const TOKEN_KEY = 'testagram-identity-registration-token';

async function call<T>(body: Record<string, unknown>, accessToken?: string): Promise<T> {
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { apikey: supabasePublishableKey, 'Content-Type': 'application/json', ...(accessToken ? { Authorization: \`Bearer \${accessToken}\` } : {}) },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.ok === false) {
    throw new Error(String(payload?.error || 'Identity onboarding request failed'));
  }
  return payload as T;
}

export type IdentitySignupStatus = {
  status: 'pending' | 'under_review' | 'approved' | 'rejected' | 'blocked';
  didit_status?: string;
  email_verified: boolean;
  rejection_reason?: string | null;
};

export const identitySignup = {
  token(): string | null {
    try { return window.sessionStorage.getItem(TOKEN_KEY); } catch { return null; }
  },
  setToken(token: string) {
    try { window.sessionStorage.setItem(TOKEN_KEY, token); } catch {}
  },
  clearToken() {
    try { window.sessionStorage.removeItem(TOKEN_KEY); } catch {}
  },
  async start(input: { email: string; birthDate: string; username?: string; displayName?: string; legalPolicyVersion: string }) {
    const result = await call<{ registration_token: string; email: string }>({
      action: 'start',
      email: input.email,
      birth_date: input.birthDate,
      username: input.username || null,
      display_name: input.displayName || null,
      legal_accepted: true,
      legal_policy_version: input.legalPolicyVersion,
    });
    this.setToken(result.registration_token);
    return result;
  },
  async verifyEmail(code: string) {
    const token = this.token();
    if (!token) throw new Error('REGISTRATION_TOKEN_REQUIRED');
    return call<{ ok: true; next: 'identity_verification' }>({ action: 'verify_email', registration_token: token, code });
  },
  async resendEmail() {
    const token = this.token();
    if (!token) throw new Error('REGISTRATION_TOKEN_REQUIRED');
    return call<{ ok: true }>({ action: 'resend_email', registration_token: token });
  },
  async createIdentitySession() {
    const token = this.token();
    if (!token) throw new Error('REGISTRATION_TOKEN_REQUIRED');
    return call<{ session_id: string; url: string }>({ action: 'create_identity_session', registration_token: token });
  },
  async startExisting() {
    const { data } = await supabase.auth.getSession();
    if (!data.session?.access_token) throw new Error('AUTH_REQUIRED');
    const result = await call<{ registration_token?: string; url?: string; already_approved?: boolean }>({ action: 'start_existing' }, data.session.access_token);
    if (result.registration_token) this.setToken(result.registration_token);
    return result;
  },
  async status() {
    const token = this.token();
    if (!token) throw new Error('REGISTRATION_TOKEN_REQUIRED');
    return call<IdentitySignupStatus>({ action: 'status', registration_token: token });
  },
  async finalize(password: string) {
    const token = this.token();
    if (!token) throw new Error('REGISTRATION_TOKEN_REQUIRED');
    const result = await call<{ user_id: string; email: string }>({ action: 'finalize', registration_token: token, password });
    this.clearToken();
    const { data, error } = await supabase.auth.signInWithPassword({ email: result.email, password });
    if (error || !data.user) throw error || new Error('ACCOUNT_SIGN_IN_FAILED');
    return data.user;
  },
};
