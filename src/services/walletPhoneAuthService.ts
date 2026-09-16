import { supabase } from '@/lib/supabase';

export type WalletPhoneIdentity = {
  id: string;
  user_id: string;
  wallet_id: string;
  phone_e164: string;
  verified_at: string;
  auth_provider: string;
  provider_subject: string | null;
  created_at: string;
  updated_at: string;
};

/**
 * Normalize Kenyan mobile numbers before handing them to Supabase Auth.
 * The wallet stores the E.164 representation so M-Pesa and wallet lookups
 * have one canonical address.
 */
export function normalizeKenyaPhone(input: string): string {
  const compact = input.trim().replace(/[\s().-]/g, '');
  if (/^07\d{8}$/.test(compact) || /^01\d{8}$/.test(compact)) return `+254${compact.slice(1)}`;
  if (/^254\d{9}$/.test(compact)) return `+${compact}`;
  if (/^\+254\d{9}$/.test(compact)) return compact;
  throw new Error('Enter a valid Kenyan mobile number, e.g. 0712345678.');
}

/**
 * Starts phone verification for an already authenticated Testagram account.
 * This is deliberately updateUser(), not signInWithOtp(): the existing
 * Supabase identity remains authoritative and the phone becomes a verified
 * credential attached to that identity rather than a second user account.
 */
export async function requestWalletPhoneOtp(phoneInput: string) {
  const phone = normalizeKenyaPhone(phoneInput);
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session?.user) throw new Error('Authentication required.');

  const { error } = await supabase.auth.updateUser({ phone });
  if (error) throw error;
  return { phone };
}

/**
 * Verifies the SMS code issued by updateUser({ phone }). Supabase uses the
 * phone_change OTP type for this flow; successful verification refreshes the
 * authenticated session with the verified phone claim.
 */
export async function verifyWalletPhoneOtp(phoneInput: string, token: string) {
  const phone = normalizeKenyaPhone(phoneInput);
  const cleanToken = token.replace(/\D/g, '');
  if (cleanToken.length < 6) throw new Error('Enter the 6-digit OTP.');

  const { data, error } = await supabase.auth.verifyOtp({
    phone,
    token: cleanToken,
    type: 'phone_change',
  });
  if (error) throw error;
  if (!data.user) throw new Error('Phone verification did not return a user.');

  return { phone, userId: data.user.id, user: data.user, session: data.session };
}

/**
 * Makes the verified phone the wallet's canonical address. The database RLS
 * policy requires the phone to match the verified phone claim in the current
 * Supabase JWT, so an unverified number cannot be attached by the browser.
 */
export async function linkVerifiedPhoneToWallet(walletId: string, phoneInput: string) {
  const phone = normalizeKenyaPhone(phoneInput);
  const { data, error } = await supabase.rpc('link_verified_phone_to_wallet', {
    p_wallet_id: walletId,
    p_phone_e164: phone,
  });
  if (error) throw error;
  return data as WalletPhoneIdentity;
}

export async function getWalletPhoneIdentity(walletId: string) {
  const { data, error } = await supabase
    .from('wallet_phone_identities')
    .select('*')
    .eq('wallet_id', walletId)
    .maybeSingle();
  if (error) throw error;
  return data as WalletPhoneIdentity | null;
}

export const walletPhoneAuthService = {
  normalizeKenyaPhone,
  requestWalletPhoneOtp,
  verifyWalletPhoneOtp,
  linkVerifiedPhoneToWallet,
  getWalletPhoneIdentity,
};
