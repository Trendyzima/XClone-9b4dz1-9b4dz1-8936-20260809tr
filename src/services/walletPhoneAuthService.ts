import { appwriteAuth } from '@/services/appwriteAuth';
import { backendCapabilities } from '@/services/testagramCapabilityClient';

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
 * Normalize Kenyan mobile numbers before requesting Backend-managed phone verification.
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

/** Phone OTP is delivered and verified by Backend; Appwrite remains the account identity. */
export async function requestWalletPhoneOtp(phoneInput: string) {
  const phone = normalizeKenyaPhone(phoneInput);
  const user = await appwriteAuth.getCurrentUser();
  if (!user) throw new Error('Authentication required.');
  await backendCapabilities.call('testagram.wallet.phone.request_otp', { phone });
  return { phone };
}

export async function verifyWalletPhoneOtp(phoneInput: string, token: string) {
  const phone = normalizeKenyaPhone(phoneInput);
  const cleanToken = token.replace(/\D/g, '');
  if (!/^\d{6}$/.test(cleanToken)) throw new Error('Enter the 6-digit OTP.');
  const result = await backendCapabilities.call<{ verified: boolean }>('testagram.wallet.phone.verify_otp', { phone, otp: cleanToken });
  if (!result.verified) throw new Error('Phone verification could not be confirmed.');
  const user = await appwriteAuth.getCurrentUser();
  if (!user) throw new Error('Authentication required.');
  return { phone, userId: user.$id, user };
}

export async function linkVerifiedPhoneToWallet(walletId: string, phoneInput: string) {
  const phone = normalizeKenyaPhone(phoneInput);
  return backendCapabilities.call<WalletPhoneIdentity>('testagram.wallet.phone.link', { wallet_id: walletId, phone_e164: phone });
}

export async function getWalletPhoneIdentity(walletId: string) {
  return backendCapabilities.call<WalletPhoneIdentity | null>('testagram.wallet.phone.read', { wallet_id: walletId });
}

export const walletPhoneAuthService = {
  normalizeKenyaPhone,
  requestWalletPhoneOtp,
  verifyWalletPhoneOtp,
  linkVerifiedPhoneToWallet,
  getWalletPhoneIdentity,
};
