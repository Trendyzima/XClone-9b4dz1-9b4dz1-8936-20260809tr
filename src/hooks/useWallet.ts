import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from './useAuth';
import {
  walletPhoneAuthService,
  type WalletPhoneIdentity,
} from '@/services/walletPhoneAuthService';

export interface Wallet {
  id: string;
  user_id: string;
  balance: number;
  total_deposited: number;
  total_withdrawn: number;
  mpesa_phone: string | null;
  paypal_email: string | null;
  created_at: string;
  updated_at: string;
  preferred_currency?: string | null;
  wallet_pin_hash?: string | null;
  biometric_credential_id?: string | null;
  savings_balance?: number;
  spend_limit_enabled?: boolean;
  daily_spend_limit?: number | null;
  currency?: string | null;
  status?: string;
  spending_enabled?: boolean;
  withdrawals_enabled?: boolean;
}

export function useWallet() {
  const { user } = useAuth();
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [phoneIdentity, setPhoneIdentity] = useState<WalletPhoneIdentity | null>(null);
  const [walletSecurity, setWalletSecurity] = useState<{ pin_hash: string | null; biometric_credential_id: string | null; biometric_enabled: boolean } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) {
      setWallet(null);
      setPhoneIdentity(null);
      setWalletSecurity(null);
      setLoading(false);
      return;
    }
    void fetchWallet();
  }, [user]);

  const fetchWallet = async () => {
    if (!user) return;

    try {
      setLoading(true);
      setError(null);

      // The payment gateway wallet is the sole source of monetary truth.
      // Do not hydrate balances from the legacy user_wallets credits table.
      const { data: gatewayWallet, error: walletError } = await supabase
        .rpc('get_my_wallet')
        .maybeSingle();

      if (walletError) throw walletError;
      if (!gatewayWallet) throw new Error('Payment wallet is not provisioned for this account');

      const resolvedWallet = gatewayWallet as Wallet;

      const { data: security, error: securityError } = await supabase
        .from('wallet_security')
        .select('pin_hash,biometric_credential_id,biometric_enabled')
        .eq('user_id', user.id)
        .maybeSingle();

      if (securityError) throw securityError;
      setWalletSecurity(security as typeof walletSecurity);

      const { data: identity, error: identityError } = await supabase
        .from('wallet_phone_identities')
        .select('*')
        .eq('wallet_id', resolvedWallet.id)
        .maybeSingle();

      if (identityError) throw identityError;

      setPhoneIdentity(identity as WalletPhoneIdentity | null);
      setWallet({
        ...resolvedWallet,
        id: resolvedWallet.id,
        user_id: user.id,
        balance: Number(resolvedWallet.balance ?? 0),
        total_deposited: Number(resolvedWallet.total_deposited ?? 0),
        total_withdrawn: Number(resolvedWallet.total_withdrawn ?? 0),
      });
    } catch (err: any) {
      console.error('Wallet error:', err);
      setError(err?.message || 'Unable to load wallet');
      setWallet(null);
      setPhoneIdentity(null);
    } finally {
      setLoading(false);
    }
  };

  const requestPhoneOtp = async (phone: string) => {
    return walletPhoneAuthService.requestWalletPhoneOtp(phone);
  };

  const verifyPhoneOtp = async (phone: string, token: string) => {
    if (!wallet?.id) throw new Error('Payment wallet is not provisioned for this account');
    const verified = await walletPhoneAuthService.verifyWalletPhoneOtp(phone, token);
    const identity = await walletPhoneAuthService.linkVerifiedPhoneToWallet(wallet.id, verified.phone);
    setPhoneIdentity(identity);
    setWallet(prev => prev ? { ...prev, mpesa_phone: verified.phone } : prev);
    return identity;
  };

  const updatePaymentMethods = async (_mpesaPhone: string, paypalEmail: string) => {
    if (!user || !wallet) return { success: false, error: 'No wallet found' };

    try {
      // Phone is intentionally sourced only from the verified wallet identity.
      // The caller cannot turn an arbitrary browser-entered number into a
      // verified M-Pesa payout destination.
      const { data, error: updateError } = await supabase.rpc('update_wallet_payment_methods', {
        p_mpesa_phone: phoneIdentity?.phone_e164 ?? null,
        p_paypal_email: paypalEmail || null,
      });

      if (updateError) throw updateError;

      const updated = data as Wallet;
      setWallet(prev => prev ? {
        ...prev,
        mpesa_phone: updated?.mpesa_phone ?? prev.mpesa_phone,
        paypal_email: updated?.paypal_email ?? null,
        updated_at: updated?.updated_at ?? prev.updated_at,
      } : prev);
      return { success: true };
    } catch (err: any) {
      console.error('Update payment methods error:', err);
      return { success: false, error: err?.message || 'Failed to update payment methods' };
    }
  };

  return {
    wallet,
    loading,
    error,
    phoneIdentity,
    phoneVerified: !!phoneIdentity?.verified_at,
    walletSecurity,
    requestPhoneOtp,
    verifyPhoneOtp,
    fetchWallet,
    updatePaymentMethods,
  };
}
