import type { Models } from 'appwrite';
import { appwriteAuth } from '@/services/appwriteAuth';
import { testagramApi } from '@/services/testagramApi';
import type { AuthUser } from '@/types/app-types';
import { LEGAL_CONSENT_STORAGE_KEY, LEGAL_POLICY_VERSION, readLegalConsent } from '@/components/auth/LegalAcceptanceGate';

export function normalizeKenyaPhone(input: string): string {
  const raw = input.trim().replace(/\s+/g, '');
  const digits = raw.replace(/\D/g, '');
  if (/^\+254[17]\d{8}$/.test(raw)) return raw;
  if (/^0[17]\d{8}$/.test(raw)) return '+254' + raw.slice(1);
  if (/^254[17]\d{8}$/.test(digits)) return '+' + digits;
  if (/^[17]\d{8}$/.test(digits)) return '+254' + digits;
  throw new Error('Enter a valid Kenyan phone number, e.g. 0712345678');
}

export function mapAppwriteAuthUser(user: Models.User<Models.Preferences>): Models.User<Models.Preferences> {
  return user;
}

const REQUEST_TIMEOUT_MS = 15_000;

async function backendRequest<T>(
  path: string,
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' = 'GET',
  body?: Record<string, unknown>,
): Promise<T> {
  return testagramApi.request<T>(path, { method, body });
}

async function provisionProfile(_user: Models.User<Models.Preferences>) {
  // Only Backend-approved identities may have a canonical profile. A browser
  // session must never create or self-approve a missing profile.
  const profile = await backendRequest<any>('/v1/me');
  if (profile?.identity_verification_status !== 'approved') {
    throw new Error('IDENTITY_VERIFICATION_REQUIRED');
  }
  return profile;
}

export async function ensureCanonicalProfile(user: Models.User<Models.Preferences>): Promise<void> {
  await provisionProfile(user);
}

async function finalizeAuthenticatedSessionInternal(user: Models.User<Models.Preferences>, options: { requireFreshLegalConsent?: boolean } = {}): Promise<AuthUser> {
  if (!user.emailVerification) throw new Error('EMAIL_NOT_VERIFIED');
  const profile = await provisionProfile(user);
  const legalResponse = await backendRequest<any>('/v1/me/legal');
  const legal = legalResponse?.data ?? legalResponse;
  const accepted = Boolean(legal?.birth_date && legal?.legal_terms_accepted_at && legal?.legal_privacy_accepted_at &&
    legal?.legal_content_policy_accepted_at && legal?.legal_age_confirmed_at && legal?.legal_policy_version === LEGAL_POLICY_VERSION);
  if (legal?.birth_date) {
    const birthDate = new Date(legal.birth_date + 'T00:00:00');
    const cutoff = new Date();
    cutoff.setFullYear(cutoff.getFullYear() - 18);
    if (Number.isNaN(birthDate.getTime()) || birthDate > cutoff) throw new Error('AGE_RESTRICTION');
  }
  const consent = readLegalConsent();
  if ((options.requireFreshLegalConsent || !accepted) && !consent) throw new Error('LEGAL_ACCEPTANCE_REQUIRED');
  if (!accepted || options.requireFreshLegalConsent) {
    if (!consent) throw new Error('LEGAL_ACCEPTANCE_REQUIRED');
    await backendRequest('/v1/me/legal', 'PUT', {
      birth_date: consent.birthDate,
      policy_version: consent.version,
      terms_accepted: true,
      privacy_accepted: true,
      content_policy_accepted: true,
      age_confirmed: true,
    });
    try { window.localStorage.removeItem(LEGAL_CONSENT_STORAGE_KEY); } catch { /* browser storage is optional */ }
  }
  const identityStatus = String(profile?.identity_verification_status ?? '');
  if (identityStatus && identityStatus !== 'approved') throw new Error('IDENTITY_VERIFICATION_REQUIRED');
  const prefs = (user.prefs ?? {}) as Record<string, unknown>;
  const username = String(profile?.handle ?? profile?.username ?? prefs.username ?? '');
  if (!username) throw new Error('Backend profile response did not include a canonical handle.');
  return {
    id: user.$id,
    email: user.email || '',
    username,
    avatar: typeof profile?.avatar_url === 'string' ? profile.avatar_url : undefined,
    verified: Boolean(profile?.verified_tier && profile.verified_tier !== 'none'),
    identityVerificationStatus: profile?.identity_verification_status ?? 'pending',
    identityVerifiedAt: profile?.identity_verified_at ?? undefined,
  };
}

export async function finalizeAuthenticatedSession(user: Models.User<Models.Preferences>, options: { requireFreshLegalConsent?: boolean } = {}): Promise<AuthUser> {
  let timer: number | undefined;
  try {
    return await Promise.race([
      finalizeAuthenticatedSessionInternal(user, options),
      new Promise<never>((_, reject) => { timer = window.setTimeout(() => reject(new Error('Account setup timed out. Please retry.')), REQUEST_TIMEOUT_MS * 2); }),
    ]);
  } finally {
    if (timer !== undefined) window.clearTimeout(timer);
  }
}

export class AuthService {
  async signInWithPassword(email: string, password: string) {
    return appwriteAuth.signInWithPassword({ email, password });
  }
  async signUpWithPassword(_email: string, _password: string, _username?: string): Promise<never> {
    // Backend must provision accounts only after identity approval. Do not
    // allow callers to bypass that gate by creating Appwrite users in-browser.
    throw new Error('IDENTITY_VERIFICATION_REQUIRED');
  }
  async sendEmailVerification() { await appwriteAuth.sendEmailVerification(); }
  async sendEmailOtp(_email: string, _shouldCreateUser = false): Promise<never> {
    throw new Error('Use the Appwrite email verification link sent to your inbox.');
  }
  async verifyEmailOtp(_email: string, _token: string, _type: 'email' | 'signup' = 'email'): Promise<never> {
    throw new Error('Use the Appwrite email verification link sent to your inbox.');
  }
  async sendMagicLink(_email: string): Promise<never> {
    throw new Error('Email-link sign-in is not enabled. Use your email and password.');
  }
  async sendPhoneOtp(_phone: string): Promise<never> {
    throw new Error('Phone OTP sign-in is not enabled. Use your verified email and password.');
  }
  async resendSignupEmail(_email?: string) { await appwriteAuth.sendEmailVerification(); }
  async resetPassword(email: string) { await appwriteAuth.requestPasswordRecovery(email); }
  async updatePassword(password: string) {
    const recovery = appwriteAuth.getRecoveryContext();
    if (!recovery) throw new Error('APPWRITE_RECOVERY_CONTEXT_REQUIRED');
    return appwriteAuth.completePasswordRecoveryAndSignIn({ userId: recovery.userId, secret: recovery.secret, email: recovery.email, password });
  }
  async signOut() { await appwriteAuth.signOut(); }
}
export const authService = new AuthService();
