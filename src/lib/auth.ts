import type { Models } from 'appwrite';
import { appwriteAuth } from '@/services/appwriteAuth';
import { testagramApi } from '@/services/testagramApi';
import { TestagramApiError } from '@/services/testagramApiClient';
import type { AuthUser } from '@/types/app-types';

export type AuthIdentity = {
  id: string;
  email?: string;
  phone?: string;
  user_metadata?: Record<string, unknown>;
};

const LEGAL_POLICY_VERSION = '2026-09';
const LEGAL_CONSENT_STORAGE_KEY = 'testagram-legal-consent';
const AUTH_REQUEST_TIMEOUT_MS = 22_000;

export function normalizeKenyaPhone(input: string): string {
  const raw = input.trim().replace(/\\s+/g, '');
  const digits = raw.replace(/\\D/g, '');
  if (/^\\+254[17]\\d{8}$/.test(raw)) return raw;
  if (/^0[17]\\d{8}$/.test(raw)) return `+254${raw.slice(1)}`;
  if (/^254[17]\\d{8}$/.test(digits)) return `+${digits}`;
  if (/^[17]\\d{8}$/.test(digits)) return `+254${digits}`;
  throw new Error('Enter a valid Kenyan phone number, e.g. 0712345678');
}

function normalizeIdentifier(input: string) {
  const value = input.trim();
  if (!value) throw new Error('Enter your email or phone number');
  if (value.includes('@')) {
    if (!/^\\S+@\\S+\\.\\S+$/.test(value) || value.length > 254) throw new Error('Enter a valid email address');
    return { kind: 'email' as const, value: value.toLowerCase() };
  }
  return { kind: 'phone' as const, value: normalizeKenyaPhone(value) };
}

function profileCandidate(user: AuthIdentity) {
  const metadata = user.user_metadata ?? {};
  const phone = user.phone || '';
  const email = user.email || phone;
  const preferred = metadata.username ?? metadata.preferred_username ?? metadata.user_name ?? metadata.full_name;
  const raw = typeof preferred === 'string' && preferred.trim()
    ? preferred.trim()
    : phone ? `user_${phone.slice(-9)}` : email.split('@')[0] || `user_${user.id.replace(/-/g, '').slice(0, 10)}`;
  let handle = raw.toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 24);
  if (handle.length < 3) handle = `user_${user.id.replace(/[^a-zA-Z0-9]/g, '').slice(0, 10).toLowerCase()}`;
  const displayNameValue = metadata.full_name ?? metadata.name;
  const displayName = typeof displayNameValue === 'string' && displayNameValue.trim()
    ? displayNameValue.trim().slice(0, 80)
    : handle;
  const avatarValue = metadata.avatar_url ?? metadata.picture;
  const avatar = typeof avatarValue === 'string' && /^https:\/\//i.test(avatarValue) ? avatarValue : null;
  return { handle, displayName, avatar };
}

function readLegalConsent(): { birthDate: string; version: string; acceptedAt: string } | null {
  try {
    const raw = window.localStorage.getItem(LEGAL_CONSENT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { birthDate: string; version: string; acceptedAt: string };
    return parsed?.version === LEGAL_POLICY_VERSION && parsed?.birthDate ? parsed : null;
  } catch {
    return null;
  }
}

export function mapAppwriteAuthUser(user: Models.User<Models.Preferences>): AuthIdentity {
  const prefs = user.prefs as Record<string, unknown> | undefined;
  return {
    id: user.$id,
    email: user.email ?? '',
    phone: user.phone ?? '',
    user_metadata: {
      ...(prefs ?? {}),
      name: user.name ?? '',
      full_name: user.name ?? '',
      username: typeof prefs?.username === 'string' ? prefs.username : undefined,
      avatar_url: typeof prefs?.avatar_url === 'string' ? prefs.avatar_url : undefined,
    },
  };
}

async function freshBackendRequest<T>(
  path: string,
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' = 'GET',
  body?: Record<string, unknown>,
): Promise<T> {
  return testagramApi.request<T>(path, { method, body });
}

async function hydrateAppwriteProfile(
  user: AuthIdentity,
  options: { requireFreshLegalConsent?: boolean } = {},
): Promise<AuthUser> {
  let profile: any;
  try {
    profile = await freshBackendRequest<any>('/v1/me');
  } catch (error) {
    const profileMissing = error instanceof TestagramApiError
      ? error.status === 404 || error.code === 'PROFILE_NOT_FOUND'
      : error instanceof Error && /profile not found/i.test(error.message);
    if (!profileMissing) throw error;

    const candidate = profileCandidate(user);
    const saveProfile = (handle: string) => freshBackendRequest<any>('/v1/me/profile', 'PUT', {
      display_name: candidate.displayName,
      handle,
      bio: '',
    });
    try {
      profile = await saveProfile(candidate.handle);
    } catch (createError) {
      const isHandleConflict = createError instanceof TestagramApiError &&
        (createError.status === 409 || createError.code === 'HANDLE_TAKEN');
      if (!isHandleConflict) throw createError;
      const suffix = user.id.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8).toLowerCase();
      profile = await saveProfile(`${candidate.handle.slice(0, 15)}_${suffix}`);
    }
  }

  const consent = readLegalConsent();
  const legal = await freshBackendRequest<any>('/v1/me/legal');
  const legalData = legal?.data ?? legal;
  const alreadyAccepted = Boolean(
    legalData?.birth_date &&
    legalData?.legal_terms_accepted_at &&
    legalData?.legal_privacy_accepted_at &&
    legalData?.legal_content_policy_accepted_at &&
    legalData?.legal_age_confirmed_at &&
    legalData?.legal_policy_version === LEGAL_POLICY_VERSION
  );

  if (legalData?.birth_date) {
    const birthDate = new Date(`${legalData.birth_date}T00:00:00`);
    const cutoff = new Date();
    cutoff.setFullYear(cutoff.getFullYear() - 18);
    if (Number.isNaN(birthDate.getTime()) || birthDate > cutoff) throw new Error('AGE_RESTRICTION');
  }

  if (options.requireFreshLegalConsent && !consent) throw new Error('LEGAL_ACCEPTANCE_REQUIRED');
  if (!alreadyAccepted) {
    if (!consent) throw new Error('LEGAL_ACCEPTANCE_REQUIRED');
    await freshBackendRequest('/v1/me/legal', 'PUT', {
      birth_date: consent.birthDate,
      policy_version: consent.version,
      terms_accepted: true,
      privacy_accepted: true,
      content_policy_accepted: true,
      age_confirmed: true,
    });
    try { window.localStorage.removeItem(LEGAL_CONSENT_STORAGE_KEY); } catch { /* storage is optional */ }
  }

  const handle = String(profile?.handle ?? profile?.username ?? user.user_metadata?.username ?? '');
  if (!handle) throw new Error('Backend profile response did not include a canonical handle.');
  return {
    id: user.id,
    email: user.email || '',
    username: handle,
    avatar: typeof profile?.avatar_url === 'string' ? profile.avatar_url : undefined,
    verified: Boolean(profile?.verified_tier && profile.verified_tier !== 'none'),
    identityVerificationStatus: profile?.identity_verification_status ?? 'pending',
    identityVerifiedAt: profile?.identity_verified_at ?? undefined,
  };
}

export async function ensureCanonicalProfile(user: AuthIdentity): Promise<void> {
  const candidate = profileCandidate(user);
  await freshBackendRequest('/v1/me/profile', 'PUT', {
    display_name: candidate.displayName,
    handle: candidate.handle,
    bio: '',
  });
}

export async function mapAppwriteUserWithCanonicalProfile(user: AuthIdentity): Promise<AuthUser> {
  return hydrateAppwriteProfile(user);
}

export async function finalizeAuthenticatedSession(
  user: AuthIdentity,
  options: { requireFreshLegalConsent?: boolean } = {},
): Promise<AuthUser> {
  return withAuthTimeout(
    hydrateAppwriteProfile(user, options),
    'Account setup',
  );
}

async function withAuthTimeout<T>(operation: PromiseLike<T> | Promise<T>, label: string, timeoutMs = AUTH_REQUEST_TIMEOUT_MS): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`${label} timed out while waiting for the authentication service. This may be a temporary server issue; wait a moment before retrying.`)), timeoutMs);
  });
  try {
    return await Promise.race([Promise.resolve(operation), timeout]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

export class AuthService {
  async sendEmailOtp(_emailInput: string, _shouldCreateUser = false): Promise<string> {
    throw new Error('APPWRITE_EMAIL_OTP_NOT_YET_ENABLED');
  }

  async verifyEmailOtp(_emailInput: string, _token: string, _type: 'email' | 'signup' = 'email'): Promise<AuthIdentity> {
    throw new Error('APPWRITE_EMAIL_OTP_NOT_YET_ENABLED');
  }

  async sendMagicLink(_emailInput: string): Promise<string> {
    throw new Error('APPWRITE_MAGIC_LINK_NOT_YET_ENABLED');
  }

  async sendOtp(email: string): Promise<string> {
    return this.sendEmailOtp(email, false);
  }

  async sendPhoneOtp(_phoneInput: string): Promise<never> {
    throw new Error('IDENTITY_VERIFICATION_REQUIRED');
  }

  async signInWithPassword(identifierInput: string, password: string): Promise<AuthIdentity> {
    const identifier = normalizeIdentifier(identifierInput);
    if (identifier.kind !== 'email') throw new Error('PHONE_OTP_REQUIRED');
    if (!password) throw new Error('Enter your password');
    return mapAppwriteAuthUser(await appwriteAuth.signInWithPassword({ email: identifier.value, password }));
  }

  async signUpWithPassword(_identifierInput: string, _password: string, _username?: string): Promise<never> {
    throw new Error('APPWRITE_SIGNUP_MIGRATION_PENDING');
  }

  async resendSignupPhone(_phoneInput: string): Promise<never> {
    throw new Error('IDENTITY_VERIFICATION_REQUIRED');
  }

  async resendSignupEmail(_email: string): Promise<void> {
    await appwriteAuth.sendEmailVerification();
  }

  async resetPassword(email: string): Promise<void> {
    const identifier = normalizeIdentifier(email);
    if (identifier.kind !== 'email') throw new Error('Password recovery requires an email address');
    await appwriteAuth.requestPasswordRecovery(identifier.value);
  }

  async updatePassword(password: string): Promise<AuthIdentity> {
    const recovery = appwriteAuth.getRecoveryContext();
    if (!recovery?.email) throw new Error('APPWRITE_RECOVERY_CONTEXT_REQUIRED');
    const user = await appwriteAuth.completePasswordRecoveryAndSignIn({
      userId: recovery.userId,
      secret: recovery.secret,
      email: recovery.email,
      password,
    });
    return mapAppwriteAuthUser(user);
  }

  async signOut(): Promise<void> {
    await appwriteAuth.signOut();
  }

  mapUser(user: AuthIdentity): AuthUser {
    const candidate = profileCandidate(user);
    return {
      id: user.id,
      email: user.email || '',
      username: candidate.handle,
      avatar: candidate.avatar ?? undefined,
    };
  }
}

export const authService = new AuthService();
