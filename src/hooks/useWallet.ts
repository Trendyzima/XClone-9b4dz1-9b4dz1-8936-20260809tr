import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from './useAuth';
import {
  walletPhoneAuthService,
  type WalletPhoneIdentity,
} from '@/services/walletPhoneAuthService';

export interface Wallet {
  // `id` must come from public.wallets (the payment gateway wallet), not user_wallets.
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
}

export function useWallet() {
  const { user } = useAuth();
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [phoneIdentity, setPhoneIdentity] = useState<WalletPhoneIdentity | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (user) fetchWallet();
  }, [user]);

  const fetchWallet = async () => {
    if (!user) return;

    try {
      setLoading(true);
      setError(null);

      const [{ data: userWallet, error: userWalletError }, { data: gatewayWallet, error: gatewayWalletError }] = await Promise.all([
        supabase
          .from('user_wallets')
          .select('*')
          .eq('user_id', user.id)
          .maybeSingle(),
        supabase
          .from('wallets')
          .select('id,user_id,balance,total_deposited,total_withdrawn,mpesa_phone,paypal_email,created_at,updated_at,status,spending_enabled,currency')
          .eq('user_id', user.id)
          .maybeSingle(),
      ]);

      if (userWalletError) throw userWalletError;
      if (gatewayWalletError) throw gatewayWalletError;

      const resolvedWalletId = gatewayWallet?.id ?? '';
      if (resolvedWalletId) {
        const { data: identity, error: identityError } = await supabase
          .from('wallet_phone_identities')
          .select('*')
          .eq('wallet_id', resolvedWalletId)
          .maybeSingle();
        if (identityError) throw identityError;
        setPhoneIdentity(identity as WalletPhoneIdentity | null);
      } else {
        setPhoneIdentity(null);
      }

      if (userWallet) {
        setWallet({
          ...userWallet,
          id: resolvedWalletId,
          user_id: user.id,
          balance: Number((userWallet as any).balance ?? gatewayWallet?.balance ?? 0),
          total_deposited: Number((userWallet as any).total_deposited ?? gatewayWallet?.total_deposited ?? 0),
          total_withdrawn: Number((userWallet as any).total_withdrawn ?? gatewayWallet?.total_withdrawn ?? 0),
          mpesa_phone: (userWallet as any).mpesa_phone ?? gatewayWallet?.mpesa_phone ?? null,
          paypal_email: (userWallet as any).paypal_email ?? gatewayWallet?.paypal_email ?? null,
          created_at: (userWallet as any).created_at ?? gatewayWallet?.created_at ?? new Date().toISOString(),
          updated_at: (userWallet as any).updated_at ?? gatewayWallet?.updated_at ?? new Date().toISOString(),
        } as Wallet);
        return;
      }

      if (gatewayWallet) {
        const { data: newWallet, error: createError } = await supabase
          .from('user_wallets')
          .insert({ user_id: user.id, balance: Number(gatewayWallet.balance ?? 0) })
          .select()
          .single();

        if (createError) throw createError;
        setWallet({
          ...newWallet,
          id: gatewayWallet.id,
          user_id: user.id,
          balance: Number((newWallet as any).balance ?? gatewayWallet.balance ?? 0),
          total_deposited: Number((newWallet as any).total_deposited ?? gatewayWallet.total_deposited ?? 0),
          total_withdrawn: Number((newWallet as any).total_withdrawn ?? gatewayWallet.total_withdrawn ?? 0),
          mpesa_phone: (newWallet as any).mpesa_phone ?? gatewayWallet.mpesa_phone ?? null,
          paypal_email: (newWallet as any).paypal_email ?? gatewayWallet.paypal_email ?? null,
          created_at: (newWallet as any).created_at ?? gatewayWallet.created_at ?? new Date().toISOString(),
          updated_at: (newWallet as any).updated_at ?? gatewayWallet.updated_at ?? new Date().toISOString(),
        } as Wallet);
        return;
      }

      throw new Error('Payment wallet is not provisioned for this account');
    } catch (err: any) {
      console.error('Wallet error:', err);
      setError(err.message);
      setWallet(null);
      setPhoneIdentity(null);
    } finally {
      setLoading(false);
    }
  };

  const requestPhoneOtp = async (phone: string) => {
    const result = await walletPhoneAuthService.requestWalletPhoneOtp(phone);
    return result;
  };

  const verifyPhoneOtp = async (phone: string, token: string) => {
    if (!wallet?.id) throw new Error('Payment wallet is not provisioned for this account');
    const verified = await walletPhoneAuthService.verifyWalletPhoneOtp(phone, token);
    const identity = await walletPhoneAuthService.linkVerifiedPhoneToWallet(wallet.id, verified.phone);
    setPhoneIdentity(identity);
    setWallet(prev => prev ? { ...prev, mpesa_phone: verified.phone } : prev);
    return identity;
  };

  const updatePaymentMethods = async (mpesaPhone: string, paypalEmail: string) => {
    if (!user || !wallet) return { success: false, error: 'No wallet found' };

    try {
      const [legacyUpdate, gatewayUpdate] = await Promise.all([
        supabase
          .from('user_wallets')
          .update({
            // Do not treat an arbitrary browser-supplied phone as verified.
            // Verified wallet phone linking is handled by verifyPhoneOtp().
            mpesa_phone: phoneIdentity?.phone_e164 ?? null,
            paypal_email: paypalEmail || null,
          })
          .eq('user_id', user.id),
        supabase
          .from('wallets')
          .update({
            mpesa_phone: phoneIdentity?.phone_e164 ?? null,
            paypal_email: paypalEmail || null,
          })
          .eq('id', wallet.id)
          .eq('user_id', user.id),
      ]);

      if (legacyUpdate.error) throw legacyUpdate.error;
      if (gatewayUpdate.error) throw gatewayUpdate.error;

      setWallet(prev => prev ? { ...prev, mpesa_phone: phoneIdentity?.phone_e164 ?? null, paypal_email: paypalEmail || null } : null);
      return { success: true };
    } catch (err: any) {
      console.error('Update payment methods error:', err);
      return { success: false, error: err.message };
    }
  };

  return {
    wallet,
    loading,
    error,
    phoneIdentity,
    phoneVerified: !!phoneIdentity?.verified_at,
    requestPhoneOtp,
    verifyPhoneOtp,
    fetchWallet,
    updatePaymentMethods,
  };
}
