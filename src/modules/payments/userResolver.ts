import { backendCapabilities } from '@/services/testagramCapabilityClient';
import { normalizeKenyaPhone } from '@/services/walletPhoneAuthService';

export type ResolvedWalletUser = {
  user_id: string;
  wallet_id: string;
  phone_e164: string;
};

/**
 * Resolve an M-Pesa phone to the canonical Testagram wallet identity.
 * The old implementation queried a non-existent wallets.phone column and
 * depended on a global DB object. Verified wallet phone identities are now
 * the only browser-readable phone -> wallet mapping.
 */
export async function resolveUserByPhone(phone: string): Promise<ResolvedWalletUser> {
  const phoneE164 = normalizeKenyaPhone(phone);

  const result = await backendCapabilities.call<ResolvedWalletUser>('testagram.wallet.resolve_phone', { phone_e164: phoneE164 });
  if (!result?.user_id || !result?.wallet_id) throw new Error('Verified wallet identity not found for phone.');
  return result;
}
