import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from './useAuth';

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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (user) {
      fetchWallet();
    }
  }, [user]);

  const fetchWallet = async () => {
    if (!user) return;

    try {
      setLoading(true);
      setError(null);

      // user_wallets contains the app's legacy/display wallet fields.
      // wallets contains the payment-gateway wallet ID consumed by mpesa-stk-push.
      // They are separate tables in this project, so never assume user_wallets.id exists.
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

      // Preserve the existing UI contract while exposing the real gateway wallet ID.
      // The M-Pesa Edge Function authorizes metadata.wallet_id against this `wallets.id`.
      if (userWallet) {
        setWallet({
          ...userWallet,
          id: gatewayWallet?.id ?? '',
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

      // Keep the previous self-healing behavior for the legacy table, but only
      // if the gateway wallet already exists. This avoids creating an unusable
      // wallet object with no payment-gateway ID.
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
    } finally {
      setLoading(false);
    }
  };

  const updatePaymentMethods = async (mpesaPhone: string, paypalEmail: string) => {
    if (!user || !wallet) return { success: false, error: 'No wallet found' };

    try {
      const [legacyUpdate, gatewayUpdate] = await Promise.all([
        supabase
          .from('user_wallets')
          .update({
            mpesa_phone: mpesaPhone || null,
            paypal_email: paypalEmail || null,
          })
          .eq('user_id', user.id),
        supabase
          .from('wallets')
          .update({
            mpesa_phone: mpesaPhone || null,
            paypal_email: paypalEmail || null,
          })
          .eq('id', wallet.id)
          .eq('user_id', user.id),
      ]);

      if (legacyUpdate.error) throw legacyUpdate.error;
      if (gatewayUpdate.error) throw gatewayUpdate.error;

      setWallet(prev => prev ? { ...prev, mpesa_phone: mpesaPhone || null, paypal_email: paypalEmail || null } : null);
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
    fetchWallet,
    updatePaymentMethods,
  };
}
