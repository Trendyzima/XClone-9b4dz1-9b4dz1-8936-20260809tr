import { isFreshAppwriteMode, supabase } from './supabase';
import { appwriteAuth } from '@/services/appwriteAuth';
import type { Models } from 'appwrite';
import { User } from '@supabase/supabase-js';
import { AuthUser } from '@/types/app-types';

export function normalizeKenyaPhone(input: string) {
  const raw = input.trim().replace(/\s+/g, '');
  const digits = raw.replace(/\D/g, '');
  if (/^\+254[17]\d{8}$/.test(raw)) return raw;
  if (/^0[17]\d{8}$/.test(raw)) return `+254${raw.slice(1)}`;
  if (/^254[17]\d{8}$/.test(digits)) return `+${digits}`;
  if (/^[17]\d{8}$/.test(digits)) return `+254${digits}`;
  throw new Error('Enter a valid Kenyan phone number, e.g. 0712345678');
}

function normalizeIdentifier(input: string) {
  const value = input.trim();
  if (!value) throw new Error('Enter your email or phone number');
  if (value.includes('@')) {
    if (!/^\S+@\S+\.\S+$/.test(value)) throw new Error('Enter a valid email address');
    return { kind: 'email' as const, value: value.toLowerCase() };
  }
  return { kind: 'phone' as const, value: normalizeKenyaPhone(value) };
}

function profileCandidate(user: User) {
  const phone = user.phone || '';
  const email = user.email || phone || '';
  const raw = user.user_metadata?.username || user.user_metadata?.preferred_username || user.user_metadata?.user_name || user.user_metadata?.full_name || (phone ? `user_${phone.slice(-9)}` : email.split('@')[0]) || `user_${user.id.replace(/-/g, '').slice(0, 10)}`;
  let username = raw.toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 24);
  if (username.length < 3) username = `user_${user.id.replace(/-/g, '').slice(0, 10)}`;
  const displayName = user.user_metadata?.full_name || user.user_metadata?.name || username;
  const rawAvatar = user.user_metadata?.avatar_url || user.user_metadata?.picture || null;
  const avatar = rawAvatar && rawAvatar.includes('/storage/v1/object/public/tv49-profile-media/avatars/') ? rawAvatar : null;
  return { username, displayName, avatar };
}

export async function ensureCanonicalProfile(user: User): Promise<void> {
  const candidate = profileCandidate(user);
  const { data: existing, error: readError } = await supabase.from('profiles').select('id, username').eq('id', user.id).maybeSingle();
  if (readError) throw new Error(`Profile lookup failed: ${readError.message}`);
  if (existing?.username) return;
  const { error } = await supabase.from('profiles').upsert({ id: user.id, username: candidate.username, display_name: candidate.displayName, avatar_url: candidate.avatar }, { onConflict: 'id' });
  if (!error) return;
  const fallbackUsername = `${candidate.username.slice(0, 15)}_${user.id.replace(/-/g, '').slice(0, 8)}`;
  const retry = await supabase.from('profiles').upsert({ id: user.id, username: fallbackUsername, display_name: candidate.displayName, avatar_url: candidate.avatar }, { onConflict: 'id' });
  if (retry.error) throw new Error(`Canonical profile provisioning failed: ${retry.error.message}`);
}

export function mapSupabaseUser(user: User): AuthUser {
  const phone = user.phone || undefined;
  const email = user.email || phone || '';
  const username = user.user_metadata?.username || user.user_metadata?.full_name || (phone ? `user_${phone.slice(-9)}` : email.split('@')[0]);
  return { id: user.id, email, username, avatar: user.user_metadata?.avatar_url || user.user_metadata?.picture };
}

const LEGAL_POLICY_VERSION = '2026-09';
const LEGAL_CONSENT_STORAGE_KEY = 'testagram-legal-consent';

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

export function mapAppwriteAuthUser(user: Models.User<Models.Preferences>): User {
  return {
    id: user.$id,
    email: user.email ?? "",
    phone: user.phone ?? "",
    user_metadata: {
      ...(user.prefs ?? {}),
      name: user.name ?? "",
      full_name: user.name ?? "",
      username: typeof user.prefs?.username === "string" ? user.prefs.username : undefined,
      avatar_url: typeof user.prefs?.avatar_url === "string" ? user.prefs.avatar_url : undefined,
    },
    app_metadata: { provider: "appwrite", providers: ["appwrite"] },
    aud: "authenticated",
    created_at: user.$createdAt,
    updated_at: user.$updatedAt,
    is_anonymous: false,
  } as unknown as User;
}

const FRESH_BACKEND_API_URL = (import.meta.env.VITE_TESTAGRAM_FRESH_API_URL ?? import.meta.env.VITE_TESTAGRAM_API_URL ?? "").trim();

async function freshBackendRequest<T>(path: string, jwt: string, method = "GET", body?: Record<string, unknown>): Promise<T> {
  if (!FRESH_BACKEND_API_URL) throw new Error("Fresh Appwrite mode requires VITE_TESTAGRAM_API_URL to point to the private Testagram Backend API.");
  let base: URL;
  try { base = new URL(FRESH_BACKEND_API_URL); } catch { throw new Error("VITE_TESTAGRAM_API_URL must be an absolute HTTPS URL."); }
  const localHTTP = base.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname);
  if ((base.protocol !== "https:" && !localHTTP) || base.username || base.password || base.search || base.hash) {
    throw new Error("VITE_TESTAGRAM_API_URL must use HTTPS (HTTP is allowed only for localhost) and must not contain credentials, query or fragment.");
  }
  const response = await fetch(base.toString().replace(/\/$/, "") + path, {
    method,
    headers: { Authorization: "Bearer " + jwt, "Content-Type": "application/json", Accept: "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  const payload = await response.json().catch(() => null) as any;
  if (!response.ok) {
    const message = payload?.error?.message ?? payload?.message ?? ("Backend request failed (" + response.status + ").");
    throw new Error(String(message));
  }
  return payload as T;
}

async function mapFreshAppwriteUserWithCanonicalProfile(user: User, options: { requireFreshLegalConsent?: boolean } = {}): Promise<AuthUser> {
  const jwt = await appwriteAuth.createBackendJWT();
  let profile: any;
  try {
    profile = await freshBackendRequest<any>("/v1/me", jwt);
  } catch (error) {
    if (!(error instanceof Error) || !/profile not found/i.test(error.message)) throw error;
    const candidate = profileCandidate(user);
    const displayName = String(candidate.displayName || candidate.username).slice(0, 80);
    const saveProfile = (handle: string) => freshBackendRequest<any>("/v1/me/profile", jwt, "PUT", { display_name: displayName, handle, bio: "" });
    try {
      profile = await saveProfile(candidate.username);
    } catch {
      const suffix = user.id.replace(/[^a-zA-Z0-9_]/g, "").slice(0, 8);
      const fallbackHandle = (candidate.username.slice(0, 15) + "_" + suffix).toLowerCase();
      profile = await saveProfile(fallbackHandle);
    }
  }

  const consent = readLegalConsent();
  const legal = await freshBackendRequest<any>("/v1/me/legal", jwt);
  const legalData = legal?.data ?? legal;
  const alreadyAccepted = Boolean(
    legalData?.birth_date && legalData?.legal_terms_accepted_at && legalData?.legal_privacy_accepted_at &&
    legalData?.legal_content_policy_accepted_at && legalData?.legal_age_confirmed_at &&
    legalData?.legal_policy_version === LEGAL_POLICY_VERSION
  );
  if (legalData?.birth_date) {
    const birthDate = new Date(legalData.birth_date + "T00:00:00");
    const cutoff = new Date();
    cutoff.setFullYear(cutoff.getFullYear() - 18);
    if (Number.isNaN(birthDate.getTime()) || birthDate > cutoff) throw new Error("AGE_RESTRICTION");
  }
  if (options.requireFreshLegalConsent && !consent) throw new Error("LEGAL_ACCEPTANCE_REQUIRED");
  if (!alreadyAccepted) {
    if (!consent) throw new Error("LEGAL_ACCEPTANCE_REQUIRED");
    await freshBackendRequest<any>("/v1/me/legal", jwt, "PUT", {
      birth_date: consent.birthDate, policy_version: consent.version, terms_accepted: true,
      privacy_accepted: true, content_policy_accepted: true, age_confirmed: true,
    });
    try { window.localStorage.removeItem(LEGAL_CONSENT_STORAGE_KEY); } catch { /* storage is optional */ }
  }

  const username = String(profile?.handle ?? profile?.username ?? user.user_metadata?.username ?? "");
  if (!username) throw new Error("Backend profile response did not include a canonical handle.");
  return {
    id: user.id, email: user.email || "", username,
    avatar: typeof profile?.avatar_url === "string" ? profile.avatar_url : undefined,
    verified: Boolean(profile?.verified_tier && profile.verified_tier !== "none"),
    identityVerificationStatus: profile?.identity_verification_status ?? "pending",
    identityVerifiedAt: profile?.identity_verified_at ?? undefined,
  };
}

async function finalizeAuthenticatedSessionInternal(user: User, options: { requireFreshLegalConsent?: boolean } = {}): Promise<AuthUser> {
  if (isFreshAppwriteMode) return mapFreshAppwriteUserWithCanonicalProfile(user, options);
  const consent = readLegalConsent();
  const { data: legalProfile, error: legalReadError } = await supabase
    .from('profiles')
    .select('birth_date, legal_terms_accepted_at, legal_privacy_accepted_at, legal_content_policy_accepted_at, legal_age_confirmed_at, legal_policy_version')
    .eq('id', user.id)
    .maybeSingle();

  if (legalReadError) throw new Error(`Legal policy status lookup failed: ${legalReadError.message}`);

  const birthDate = legalProfile?.birth_date ? new Date(legalProfile.birth_date + 'T00:00:00') : null;
  const adultCutoff = new Date();
  adultCutoff.setFullYear(adultCutoff.getFullYear() - 18);
  const isAdult = !!birthDate && !Number.isNaN(birthDate.getTime()) && birthDate <= adultCutoff;

  if (legalProfile?.birth_date && !isAdult) throw new Error('AGE_RESTRICTION');

  const alreadyAccepted =
    isAdult &&
    !!legalProfile?.legal_terms_accepted_at &&
    !!legalProfile?.legal_privacy_accepted_at &&
    !!legalProfile?.legal_content_policy_accepted_at &&
    !!legalProfile?.legal_age_confirmed_at &&
    legalProfile?.legal_policy_version === LEGAL_POLICY_VERSION;

  if (options.requireFreshLegalConsent && !consent) throw new Error('LEGAL_ACCEPTANCE_REQUIRED');

  if (!alreadyAccepted || options.requireFreshLegalConsent) {
    if (!consent) throw new Error('LEGAL_ACCEPTANCE_REQUIRED');
    const { error } = await supabase.rpc('accept_testagram_legal', { p_birth_date: consent.birthDate });
    if (error) {
      if (error.message.includes('AGE_RESTRICTION')) throw new Error('AGE_RESTRICTION');
      throw new Error(`Legal acceptance could not be recorded: ${error.message}`);
    }
    try { window.localStorage.removeItem(LEGAL_CONSENT_STORAGE_KEY); } catch {}
  }

  // Legal/age policy has been checked successfully above. Profile hydration is
  // secondary to establishing a valid session, so a transient profile-plane
  // outage must not turn a correct password into a failed login.
  try {
    return await withAuthTimeout(mapSupabaseUserWithCanonicalProfile(user), 'Profile setup', 5_000);
  } catch (error) {
    const message = error instanceof Error ? error.message : String((error as { message?: unknown } | null)?.message || '');
    const transient = /timed? ?out|timeout|failed to fetch|network|connection terminated|statement timeout|gateway timeout|service unavailable|context deadline exceeded|request_timeout|\b(408|500|502|503|504)\b/i.test(message);
    if (!transient) throw error;
    return mapSupabaseUser(user);
  }
}

export async function mapSupabaseUserWithCanonicalProfile(user: User): Promise<AuthUser> {
  if (isFreshAppwriteMode) return mapFreshAppwriteUserWithCanonicalProfile(user);
  const mapped = mapSupabaseUser(user);
  let { data: profile, error } = await supabase.from('profiles').select('id, username, avatar_url, verified_tier, identity_verification_status, identity_verified_at').eq('id', user.id).maybeSingle();
  if (error) throw new Error(`Canonical profile lookup failed: ${error.message}`);
  if (!profile?.username) {
    await ensureCanonicalProfile(user);
    const repaired = await supabase.from('profiles').select('id, username, avatar_url, verified_tier, identity_verification_status, identity_verified_at').eq('id', user.id).maybeSingle();
    profile = repaired.data;
    error = repaired.error;
    if (error) throw new Error(`Canonical profile repair lookup failed: ${error.message}`);
  }
  if (!profile?.username) return mapped;
  return { ...mapped, username: profile.username, avatar: profile.avatar_url || mapped.avatar, verified: !!profile.verified_tier && profile.verified_tier !== 'none', identityVerificationStatus: profile.identity_verification_status ?? 'pending', identityVerifiedAt: profile.identity_verified_at ?? undefined };
}

const AUTH_REQUEST_TIMEOUT_MS = 22_000;
const CANONICAL_AUTH_REDIRECT_URL = 'https://testagram.site/auth';

export async function finalizeAuthenticatedSession(user: User, options: { requireFreshLegalConsent?: boolean } = {}): Promise<AuthUser> {
  // Password auth can succeed while profile/legal provisioning stalls. Bound the
  // entire post-auth transaction so the login UI always receives success or an
  // actionable timeout instead of spinning forever.
  return withAuthTimeout(finalizeAuthenticatedSessionInternal(user, options), 'Account setup');
}

async function withAuthTimeout<T>(operation: PromiseLike<T> | Promise<T>, label: string, timeoutMs = AUTH_REQUEST_TIMEOUT_MS): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => { timeoutId = setTimeout(() => reject(new Error(`${label} timed out while waiting for the authentication service. This may be a temporary server issue; wait a moment before retrying.`)), timeoutMs); });
  try { return await Promise.race([Promise.resolve(operation), timeout]); } finally { if (timeoutId) clearTimeout(timeoutId); }
}

export class AuthService {
  async sendEmailOtp(emailInput: string, shouldCreateUser = false) {
    if (isFreshAppwriteMode) throw new Error("APPWRITE_EMAIL_OTP_NOT_YET_ENABLED");
    const identifier = normalizeIdentifier(emailInput);
    if (identifier.kind !== 'email') throw new Error('Enter an email address for email verification');
    const { error } = await withAuthTimeout(
      supabase.auth.signInWithOtp({
        email: identifier.value,
        options: { shouldCreateUser, emailRedirectTo: CANONICAL_AUTH_REDIRECT_URL },
      }),
      'Email OTP request',
    );
    if (error) throw error;
    return identifier.value;
  }

  async verifyEmailOtp(emailInput: string, token: string, type: 'email' | 'signup' = 'email') {
    if (isFreshAppwriteMode) throw new Error("APPWRITE_EMAIL_OTP_NOT_YET_ENABLED");
    const identifier = normalizeIdentifier(emailInput);
    if (identifier.kind !== 'email') throw new Error('Enter the email used for verification');
    const code = token.trim().replace(/\s+/g, '');
    if (!/^\d{6}$/.test(code)) throw new Error('Enter the 6-digit verification code');
    const { data, error } = await withAuthTimeout(
      supabase.auth.verifyOtp({ email: identifier.value, token: code, type }),
      'Email OTP verification',
    );
    if (error) throw error;
    if (!data.user) throw new Error('Verification succeeded but no user session was returned');
    return data.user;
  }

  async sendMagicLink(emailInput: string) {
    if (isFreshAppwriteMode) throw new Error("APPWRITE_MAGIC_LINK_NOT_YET_ENABLED");
    const identifier = normalizeIdentifier(emailInput);
    if (identifier.kind !== 'email') throw new Error('Enter an email address for your sign-in link');
    const { data, error } = await withAuthTimeout(
      supabase.functions.invoke('testagram-magic-link', {
        body: { email: identifier.value, redirect_to: CANONICAL_AUTH_REDIRECT_URL },
      }),
      'Sign-in link request',
    );
    if (error) {
      const status = Number((error as any)?.context?.status || 0);
      if (status === 429) throw new Error('RATE_LIMITED');
      const message = String((error as any)?.message || '');
      if (/failed to fetch|network|connection/i.test(message)) throw new Error('IDENTITY_NETWORK_ERROR');
      throw new Error('IDENTITY_SERVICE_UNAVAILABLE');
    }
    if ((data as { ok?: boolean } | null)?.ok !== true) throw new Error('IDENTITY_SERVICE_UNAVAILABLE');
    return identifier.value;
  }

  async sendOtp(email: string) {
    return this.sendEmailOtp(email, false);
  }

  async sendPhoneOtp(_phoneInput: string) {
    throw new Error('IDENTITY_VERIFICATION_REQUIRED');
  }

  async signInWithPassword(identifierInput: string, password: string) {
    if (isFreshAppwriteMode) {
      const identifier = normalizeIdentifier(identifierInput);
      if (identifier.kind !== "email") throw new Error("PHONE_OTP_REQUIRED");
      return mapAppwriteAuthUser(await appwriteAuth.signInWithPassword({ email: identifier.value, password }));
    }
    const identifier = normalizeIdentifier(identifierInput);
    if (!password) throw new Error('Enter your password');
    const credentials = identifier.kind === 'email' ? { email: identifier.value, password } : { phone: identifier.value, password };
    const { data, error } = await withAuthTimeout(supabase.auth.signInWithPassword(credentials), 'Password sign-in');
    if (error) throw error;
    if (!data.user) throw new Error('Sign-in succeeded but no user session was returned');
    return data.user;
  }

  async signUpWithPassword(_identifierInput: string, _password: string, _username?: string) {
    throw new Error('IDENTITY_VERIFICATION_REQUIRED');
  }

  async resendSignupPhone(phoneInput: string) {
    const phone = normalizeKenyaPhone(phoneInput);
    const { error } = await withAuthTimeout(supabase.auth.resend({ type: 'sms', phone }), 'Signup SMS confirmation');
    if (error) throw error;
  }

  async resendSignupEmail(email: string) {
    const identifier = normalizeIdentifier(email);
    if (identifier.kind !== 'email') throw new Error('Enter the signup email address');
    const { error } = await withAuthTimeout(supabase.auth.resend({ type: 'signup', email: identifier.value, options: { emailRedirectTo: CANONICAL_AUTH_REDIRECT_URL } }), 'Signup confirmation email');
    if (error) throw error;
  }

  async resetPassword(email: string) {
    if (isFreshAppwriteMode) {
      const identifier = normalizeIdentifier(email);
      if (identifier.kind !== "email") throw new Error("Password recovery requires an email address");
      await appwriteAuth.requestPasswordRecovery(identifier.value);
      return;
    }
    const identifier = normalizeIdentifier(email);
    if (identifier.kind !== 'email') throw new Error('Password recovery requires an email address');
    const { error } = await withAuthTimeout(supabase.auth.resetPasswordForEmail(identifier.value, { redirectTo: `${CANONICAL_AUTH_REDIRECT_URL}?reset=1` }), 'Password recovery email');
    if (error) throw error;
  }

  async updatePassword(password: string) {
    if (password.length < 8) throw new Error('Password must be at least 8 characters');
    if (isFreshAppwriteMode) throw new Error("APPWRITE_RECOVERY_CONTEXT_REQUIRED");
    const { data, error } = await withAuthTimeout(supabase.auth.updateUser({ password }), 'Password update');
    if (error) throw error;
    if (!data.user) throw new Error('Password update did not return a user');
    return data.user;
  }

  async signOut() { if (isFreshAppwriteMode) return appwriteAuth.signOut(); const { error } = await supabase.auth.signOut(); if (error) throw error; }
  mapUser(user: User): AuthUser { return mapSupabaseUser(user); }
}
export const authService = new AuthService();
