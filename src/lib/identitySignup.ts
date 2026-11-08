import { appwriteAuth } from '@/services/appwriteAuth';
import { testagramApiRequest } from '@/services/apiClient';

const ENDPOINT = '/v1/identity/signup';
const VERIFICATION_ENDPOINT = '/v1/identity/verification';
const TOKEN_KEY = 'testagram-identity-registration-token';
const SESSION_KEY = 'testagram-identity-session-token';

export type IdentitySignupStatus = {
  status: 'pending' | 'under_review' | 'approved' | 'rejected' | 'blocked';
  verification_stage?: string;
  email_verified: boolean;
  rejection_reason?: string | null;
};
export type VerificationUpload = { kind: string; path: string; token: string };

async function call<T>(path: string, body: Record<string, unknown>, accessToken?: string): Promise<T> {
  try {
    return await testagramApiRequest<T>(path, {
      method: 'POST', body, accessToken,
      anonymous: !accessToken, timeoutMs: 15000,
    });
  } catch (error) {
    if (error instanceof Error && /404|NOT_FOUND/.test(error.message)) {
      throw new Error('IDENTITY_WORKFLOW_NOT_YET_EXPOSED_BY_BACKEND');
    }
    throw error;
  }
}

export const identitySignup = {
  token(): string | null { try { return window.sessionStorage.getItem(TOKEN_KEY); } catch { return null; } },
  setToken(token: string) { try { window.sessionStorage.setItem(TOKEN_KEY, token); } catch {} },
  sessionToken(): string | null { try { return window.sessionStorage.getItem(SESSION_KEY); } catch { return null; } },
  setSessionToken(token: string) { try { window.sessionStorage.setItem(SESSION_KEY, token); } catch {} },
  clearToken() { try { window.sessionStorage.removeItem(TOKEN_KEY); window.sessionStorage.removeItem(SESSION_KEY); } catch {} },
  async start(input: { email: string; birthDate: string; username?: string; displayName?: string; legalPolicyVersion: string }) {
    const result = await call<{ registration_token: string; email: string }>(ENDPOINT, {
      action: 'start', email: input.email, birth_date: input.birthDate,
      username: input.username || null, display_name: input.displayName || null,
      legal_accepted: true, legal_policy_version: input.legalPolicyVersion,
    });
    this.setToken(result.registration_token);
    return result;
  },
  async verifyEmail(code: string) {
    const token = this.token();
    if (!token) throw new Error('REGISTRATION_TOKEN_REQUIRED');
    return call<{ ok: true; next: 'identity_verification' }>(ENDPOINT, { action: 'verify_email', registration_token: token, code });
  },
  async resendEmail() {
    const token = this.token();
    if (!token) throw new Error('REGISTRATION_TOKEN_REQUIRED');
    return call<{ ok: true }>(ENDPOINT, { action: 'resend_email', registration_token: token });
  },
  async createIdentitySession() {
    const token = this.token();
    if (!token) throw new Error('REGISTRATION_TOKEN_REQUIRED');
    const result = await call<{ session_id: string; session_token: string; url: string; already_approved?: boolean }>(ENDPOINT, { action: 'create_identity_session', registration_token: token });
    if (result.session_token) this.setSessionToken(result.session_token);
    return result;
  },
  async startExisting() {
    const accessToken = await appwriteAuth.createBackendJWT();
    const result = await call<{ registration_token?: string; session_token?: string; url?: string; already_approved?: boolean }>(ENDPOINT, { action: 'start_existing' }, accessToken);
    if (result.registration_token) this.setToken(result.registration_token);
    if (result.session_token) this.setSessionToken(result.session_token);
    return result;
  },
  async status() {
    const token = this.token();
    if (!token) throw new Error('REGISTRATION_TOKEN_REQUIRED');
    return call<IdentitySignupStatus>(ENDPOINT, { action: 'status', registration_token: token });
  },
  async finalize(password: string) {
    const token = this.token();
    if (!token) throw new Error('REGISTRATION_TOKEN_REQUIRED');
    const result = await call<{ user_id: string; email: string }>(ENDPOINT, { action: 'finalize', registration_token: token, password });
    this.clearToken();
    return appwriteAuth.signInWithPassword({ email: result.email, password });
  },
  async verification(action: string, body: Record<string, unknown> = {}) {
    const sessionToken = this.sessionToken();
    if (!sessionToken) throw new Error('VERIFICATION_SESSION_REQUIRED');
    const accessToken = await appwriteAuth.createBackendJWT();
    return call<any>(VERIFICATION_ENDPOINT, { action, session_token: sessionToken, ...body }, accessToken);
  },
  async uploadEvidence(upload: VerificationUpload, file: File) {
    const accessToken = await appwriteAuth.createBackendJWT();
    const intent = await call<{ upload_url: string; object_key: string }>(
      '/v1/identity/verification/evidence/upload-intent',
      { kind: upload.kind, path: upload.path, token: upload.token, file_name: file.name, content_type: file.type, size_bytes: file.size },
      accessToken,
    );
    const response = await fetch(intent.upload_url, { method: 'PUT', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file, credentials: 'omit', cache: 'no-store' });
    if (!response.ok) throw new Error('IDENTITY_EVIDENCE_UPLOAD_FAILED');
    await call('/v1/identity/verification/evidence/complete', { object_key: intent.object_key, kind: upload.kind }, accessToken);
  },
};
