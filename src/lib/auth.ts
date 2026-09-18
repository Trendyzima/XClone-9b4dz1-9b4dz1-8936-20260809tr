import { supabase } from './supabase';
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
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw new Error('Enter a valid email address');
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

export async function finalizeAuthenticatedSession(user: User): Promise<AuthUser> {
  // Every authenticated entry point (password, email OTP, phone OTP, and
  // restored sessions) must cross the same canonical profile boundary before
  // the UI treats the session as ready.
  return mapSupabaseUserWithCanonicalProfile(user);
}

export async function mapSupabaseUserWithCanonicalProfile(user: User): Promise<AuthUser> {
  const mapped = mapSupabaseUser(user);
  await ensureCanonicalProfile(user);
  const { data: profile, error } = await supabase.from('profiles').select('id, username, avatar_url, verified_tier').eq('id', user.id).maybeSingle();
  if (error) throw new Error(`Canonical profile lookup failed: ${error.message}`);
  if (!profile?.username) return mapped;
  return { ...mapped, username: profile.username, avatar: profile.avatar_url || mapped.avatar, verified: !!profile.verified_tier && profile.verified_tier !== 'none' };
}

const AUTH_REQUEST_TIMEOUT_MS = 15_000;
async function withAuthTimeout<T>(operation: Promise<T>, label: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => { timeoutId = setTimeout(() => reject(new Error(`${label} timed out. Check your connection and try again.`)), AUTH_REQUEST_TIMEOUT_MS); });
  try { return await Promise.race([operation, timeout]); } finally { if (timeoutId) clearTimeout(timeoutId); }
}

export class AuthService {
  async sendOtp(email: string) {
    const identifier = normalizeIdentifier(email);
    if (identifier.kind !== 'email') throw new Error('Enter an email address for email OTP');
    const { error } = await withAuthTimeout(supabase.auth.signInWithOtp({ email: identifier.value, options: { shouldCreateUser: true } }), 'Email OTP request');
    if (error) throw error;
  }
  async sendPhoneOtp(phoneInput: string) {
    const phone = normalizeKenyaPhone(phoneInput);
    const { error } = await withAuthTimeout(supabase.auth.signInWithOtp({ phone, options: { shouldCreateUser: true } }), 'SMS OTP request');
    if (error) throw error;
    return phone;
  }
  async verifyEmailOtp(email: string, token: string) {
    const identifier = normalizeIdentifier(email); const cleanToken = token.replace(/\D/g, '');
    if (identifier.kind !== 'email') throw new Error('Enter the email used to request the code');
    if (cleanToken.length !== 6) throw new Error('Enter the 6-digit code from your email');
    const { data, error } = await withAuthTimeout(supabase.auth.verifyOtp({ email: identifier.value, token: cleanToken, type: 'email' }), 'Email OTP verification');
    if (error) throw error; if (!data.user) throw new Error('Email verification succeeded but no user session was returned'); return data.user;
  }
  async verifyPhoneOtp(phoneInput: string, token: string) {
    const phone = normalizeKenyaPhone(phoneInput); const cleanToken = token.replace(/\D/g, '');
    if (cleanToken.length !== 6) throw new Error('Enter the 6-digit code from your SMS');
    const { data, error } = await withAuthTimeout(supabase.auth.verifyOtp({ phone, token: cleanToken, type: 'sms' }), 'SMS OTP verification');
    if (error) throw error; if (!data.user) throw new Error('Phone verification succeeded but no user session was returned'); return data.user;
  }
  async signInWithPassword(identifierInput: string, password: string) {
    const identifier = normalizeIdentifier(identifierInput); if (!password) throw new Error('Enter your password');
    const credentials = identifier.kind === 'email' ? { email: identifier.value, password } : { phone: identifier.value, password };
    const { data, error } = await withAuthTimeout(supabase.auth.signInWithPassword(credentials), 'Password sign-in');
    if (error) throw error; if (!data.user) throw new Error('Sign-in succeeded but no user session was returned'); return data.user;
  }
  async signUpWithPassword(identifierInput: string, password: string, username?: string) {
    const identifier = normalizeIdentifier(identifierInput); if (password.length < 8) throw new Error('Password must be at least 8 characters');
    const metadata = username?.trim() ? { username: username.trim() } : {};
    const credentials = identifier.kind === 'email'
      ? { email: identifier.value, password, options: { data: metadata, emailRedirectTo: `${window.location.origin}/auth` } }
      : { phone: identifier.value, password, options: { data: metadata, channel: 'sms' as const } };
    const { data, error } = await withAuthTimeout(supabase.auth.signUp(credentials), 'Account creation');
    if (error) throw error;
    if (!data.user) throw new Error('Account creation succeeded but no user was returned');
    return { user: data.user, session: data.session, requiresConfirmation: !data.session, identifierKind: identifier.kind, identifier: identifier.value };
  }
  async resendSignupPhone(phoneInput: string) {
    const phone = normalizeKenyaPhone(phoneInput);
    const { error } = await withAuthTimeout(supabase.auth.resend({ type: 'sms', phone }), 'Signup SMS confirmation');
    if (error) throw error;
  }
  async resendSignupEmail(email: string) {
    const identifier = normalizeIdentifier(email); if (identifier.kind !== 'email') throw new Error('Enter the signup email address');
    const { error } = await withAuthTimeout(supabase.auth.resend({ type: 'signup', email: identifier.value, options: { emailRedirectTo: `${window.location.origin}/auth` } }), 'Signup confirmation email');
    if (error) throw error;
  }
  async resetPassword(email: string) {
    const identifier = normalizeIdentifier(email); if (identifier.kind !== 'email') throw new Error('Password recovery requires an email address');
    const { error } = await withAuthTimeout(supabase.auth.resetPasswordForEmail(identifier.value, { redirectTo: `${window.location.origin}/auth/reset-password` }), 'Password recovery email');
    if (error) throw error;
  }
  async updatePassword(password: string) {
    if (password.length < 8) throw new Error('Password must be at least 8 characters');
    const { data, error } = await withAuthTimeout(supabase.auth.updateUser({ password }), 'Password update');
    if (error) throw error; if (!data.user) throw new Error('Password update did not return a user'); return data.user;
  }
  async signOut() { const { error } = await supabase.auth.signOut(); if (error) throw error; }
  mapUser(user: User): AuthUser { return mapSupabaseUser(user); }
}
export const authService = new AuthService();
