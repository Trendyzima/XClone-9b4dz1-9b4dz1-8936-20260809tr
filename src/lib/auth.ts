import { supabase } from './supabase';
import { User } from '@supabase/supabase-js';
import { AuthUser } from '@/types/app-types';

function normalizeKenyaPhone(input: string) {
  const raw = input.trim().replace(/\s+/g, '');
  const digits = raw.replace(/\D/g, '');
  if (/^\+254[17]\d{8}$/.test(raw)) return raw;
  if (/^0[17]\d{8}$/.test(raw)) return `+254${raw.slice(1)}`;
  if (/^254[17]\d{8}$/.test(digits)) return `+${digits}`;
  if (/^[17]\d{8}$/.test(digits)) return `+254${digits}`;
  throw new Error('Enter a valid Kenyan phone number, e.g. 0712345678');
}

/**
 * Map the Supabase authentication identity only.
 * Username is presentation data here; AuthProvider resolves the canonical
 * profile username from public.user_profiles using the authenticated UUID.
 */
export function mapSupabaseUser(user: User): AuthUser {
  const phone = user.phone || undefined;
  const email = user.email || phone || '';
  const username = user.user_metadata?.username || user.user_metadata?.full_name || (phone ? `user_${phone.slice(-9)}` : email.split('@')[0]);
  return {
    id: user.id,
    email,
    username,
    avatar: user.user_metadata?.avatar_url || user.user_metadata?.picture,
  };
}

/**
 * Resolve the application's canonical profile identity from the authenticated
 * Supabase UUID. The UUID is the stable identity boundary; username is a
 * profile attribute and may differ from editable Auth metadata.
 */
export async function mapSupabaseUserWithCanonicalProfile(user: User): Promise<AuthUser> {
  const mapped = mapSupabaseUser(user);

  try {
    const { data: profile, error } = await supabase
      .from('user_profiles')
      .select('username, avatar_url, verified')
      .eq('id', user.id)
      .maybeSingle();

    if (error) {
      console.warn('[Auth] Canonical profile lookup failed; using auth fallback:', error.message);
      return mapped;
    }

    if (!profile?.username) {
      console.warn('[Auth] Authenticated user has no canonical profile username:', user.id);
      return mapped;
    }

    return {
      ...mapped,
      username: profile.username,
      avatar: profile.avatar_url || mapped.avatar,
      verified: profile.verified ?? mapped.verified,
    };
  } catch (error) {
    console.warn('[Auth] Canonical profile resolver failed; using auth fallback:', error);
    return mapped;
  }
}

export class AuthService {
  async sendOtp(email: string) {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: true },
    });
    if (error) throw error;
  }

  async sendPhoneOtp(phoneInput: string) {
    const phone = normalizeKenyaPhone(phoneInput);
    const { error } = await supabase.auth.signInWithOtp({
      phone,
      options: { shouldCreateUser: true },
    });
    if (error) throw error;
    return phone;
  }

  async verifyOtpAndSetPassword(email: string, token: string, password: string) {
    const { data, error } = await supabase.auth.verifyOtp({
      email,
      token,
      type: 'email',
    });
    if (error) throw error;

    const username = email.split('@')[0];
    const { data: updateData, error: updateError } = await supabase.auth.updateUser({
      password,
      data: { username },
    });
    if (updateError) throw updateError;

    return updateData.user;
  }

  async verifyPhoneOtp(phoneInput: string, token: string) {
    const phone = normalizeKenyaPhone(phoneInput);
    const { data, error } = await supabase.auth.verifyOtp({
      phone,
      token,
      type: 'sms',
    });
    if (error) throw error;

    // Phone OTP is a complete authentication factor. No password is required.
    // Store only non-sensitive presentation metadata after Supabase verifies the OTP.
    const currentUser = data.user;
    if (!currentUser) throw new Error('Phone verification succeeded but no user session was returned');

    if (!currentUser.user_metadata?.username) {
      const { data: updateData, error: updateError } = await supabase.auth.updateUser({
        data: { username: `user_${phone.slice(-9)}` },
      });
      if (updateError) throw updateError;
      return updateData.user;
    }

    return currentUser;
  }

  async signInWithPassword(email: string, password: string) {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) throw error;
    return data.user;
  }

  async signOut() {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  }

  mapUser(user: User): AuthUser {
    return mapSupabaseUser(user);
  }
}

export const authService = new AuthService();
