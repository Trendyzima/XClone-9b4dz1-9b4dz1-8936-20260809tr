import { supabase } from '@/lib/supabase';
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

  const { data, error } = await supabase
    .from('wallet_phone_identities')
    .select('user_id,wallet_id,phone_e164')
    .eq('phone_e164', phoneE164)
    .not('verified_at', 'is', null)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error('Verified wallet identity not found for phone.');

  return data as ResolvedWalletUser;
}
