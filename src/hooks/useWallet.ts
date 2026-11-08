import { useCallback, useEffect, useState } from 'react';
import { backendCapabilities } from '@/services/backendClient';
import type { WalletPhoneIdentity } from '@/services/walletPhoneAuthService';
import { useAuth } from './useAuth';

export interface Wallet {
  id: string;
  user_id: string;
  balance: number;
  currency: string;
  status: 'active' | 'frozen' | 'closed';
  total_deposited: number;
  total_withdrawn: number;
  mpesa_phone: string | null;
  paypal_email: string | null;
  created_at: string;
  updated_at: string;
  preferred_currency?: string | null;
  savings_balance?: number;
  spend_limit_enabled?: boolean;
  daily_spend_limit?: number | null;
  spending_enabled?: boolean;
  withdrawals_enabled?: boolean;
}

export function useWallet() {
  const { user } = useAuth();
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchWallet = useCallback(async () => {
    if (!user) { setWallet(null); setLoading(false); return; }
    try {
      setLoading(true);
      setError(null);
      const result = await backendCapabilities.call<any>('testagram.wallet.balance', { currency: 'KES' });
      setWallet({
        id: String(result.id ?? result.user_id ?? user.id),
        user_id: String(result.user_id ?? user.id),
        balance: Number(result.balance ?? 0),
        currency: String(result.currency ?? 'KES'),
        status: result.status ?? 'active',
        total_deposited: 0,
        total_withdrawn: 0,
        mpesa_phone: null,
        paypal_email: null,
        created_at: result.created_at ?? new Date(0).toISOString(),
        updated_at: result.updated_at ?? new Date(0).toISOString(),
        savings_balance: 0,
        spending_enabled: true,
        withdrawals_enabled: false,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load wallet');
      setWallet(null);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { void fetchWallet(); }, [fetchWallet]);

  const requestPhoneOtp = async (_phone: string): Promise<never> => {
    throw new Error('Wallet phone verification is not available in the new Backend wallet yet.');
  };
  const verifyPhoneOtp = async (_phone: string, _token: string): Promise<never> => {
    throw new Error('Wallet phone verification is not available in the new Backend wallet yet.');
  };
  const updatePaymentMethods = async (_mpesaPhone: string, _paypalEmail: string) => ({
    success: false,
    error: 'Payment method editing is not available in the new Backend wallet yet.',
  });

  return {
    wallet,
    loading,
    error,
    phoneIdentity: null as WalletPhoneIdentity | null,
    phoneVerified: false,
    walletSecurity: null as { pin_set: boolean; biometric_credential_id: string | null; biometric_enabled: boolean } | null,
    requestPhoneOtp,
    verifyPhoneOtp,
    fetchWallet,
    updatePaymentMethods,
  };
}
