import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ExternalLink, Loader2, CheckCircle2, AlertCircle, Smartphone } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useWallet } from '@/hooks/useWallet';

function errorMessage(error: unknown): string {
  if (error instanceof FunctionsHttpError) return error.message || 'PesaPal request failed';
  return error instanceof Error ? error.message : 'PesaPal request failed';
}

export function PesaPalTopUp() {
  const { wallet, fetchWallet } = useWallet();
  const [searchParams] = useSearchParams();
  const [amount, setAmount] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [creating, setCreating] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [returnHandled, setReturnHandled] = useState(false);

  useEffect(() => {
    if (wallet?.paypal_email && !email) setEmail(wallet.paypal_email);
    if (wallet?.mpesa_phone && !phone) setPhone(wallet.mpesa_phone);
  }, [wallet?.paypal_email, wallet?.mpesa_phone, email, phone]);

  useEffect(() => {
    const state = searchParams.get('pesapal');
    const tracking = searchParams.get('OrderTrackingId') || searchParams.get('orderTrackingId');
    const reference = searchParams.get('OrderMerchantReference') || searchParams.get('orderMerchantReference');
    if (returnHandled || !state) return;

    if (state === 'cancelled') {
      setReturnHandled(true);
      window.history.replaceState({}, '', '/wallet');
      toast.info('PesaPal payment cancelled. Your wallet was not credited.');
      return;
    }

    if (state !== 'callback' || (!tracking && !reference)) return;
    setReturnHandled(true);
    setSyncing(true);

    void (async () => {
      try {
        const { data, error } = await supabase.functions.invoke('pesapal-sync-order', {
          body: { orderTrackingId: tracking || undefined, merchantReference: reference || undefined },
        });
        if (error) throw error;
        if (!data?.ok) throw new Error(data?.error || 'PesaPal payment could not be confirmed');
        await fetchWallet();
        window.history.replaceState({}, '', '/wallet');
        if (data?.settlement?.status === 'COMPLETED') {
          toast.success('PesaPal payment confirmed and your wallet has been credited.');
        } else {
          toast.info('PesaPal returned, but the payment is still pending. We will reconcile it from the provider notification.');
        }
      } catch (error) {
        window.history.replaceState({}, '', '/wallet');
        toast.error(errorMessage(error));
      } finally {
        setSyncing(false);
      }
    })();
  }, [searchParams, returnHandled, fetchWallet]);

  const startPesaPal = async () => {
    const value = Number(amount);
    if (!Number.isFinite(value) || value < 1 || value > 100000) {
      toast.error('Enter an amount between $1 and $100,000.');
      return;
    }
    if (!email.trim() || !/^\S+@\S+\.\S+$/.test(email.trim())) {
      toast.error('Enter a valid email address.');
      return;
    }
    if (phone.replace(/\D/g, '').length < 9) {
      toast.error('Enter a valid mobile money phone number.');
      return;
    }

    setCreating(true);
    try {
      const { data, error } = await supabase.functions.invoke('pesapal-create-order', {
        body: {
          amount: Number(value.toFixed(2)),
          currency: 'USD',
          email: email.trim(),
          phone: phone.trim(),
          description: 'Testagram wallet top-up',
        },
      });
      if (error) throw error;
      if (!data?.redirect_url) throw new Error('PesaPal did not return a payment link');
      window.location.assign(data.redirect_url);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="bg-card border-2 border-[#f58220]/20 rounded-2xl p-6 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-[#f58220]/10">
            <Smartphone className="w-5 h-5 text-[#f58220]" />
          </div>
          <div>
            <h3 className="font-bold">PesaPal</h3>
            <p className="text-xs text-muted-foreground">Secure USD wallet top-up</p>
          </div>
        </div>
        <span className="text-[11px] font-semibold px-2 py-1 rounded-full bg-muted">USD</span>
      </div>

      {syncing ? (
        <div className="flex items-center gap-3 rounded-xl bg-primary/5 border border-primary/10 p-4">
          <Loader2 className="w-5 h-5 animate-spin text-primary" />
          <div>
            <p className="font-semibold text-sm">Confirming PesaPal payment…</p>
            <p className="text-xs text-muted-foreground">The server is checking the provider status before crediting your wallet.</p>
          </div>
        </div>
      ) : (
        <>
          <div className="rounded-xl bg-muted/60 p-3 text-xs text-muted-foreground flex gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0 text-green-600" />
            <span>Wallet credit is server-authoritative and idempotent. Returning to the app never credits the wallet by itself.</span>
          </div>

          <div>
            <label className="text-sm font-medium mb-1 block">Amount (USD)</label>
            <Input type="number" inputMode="decimal" min="1" max="100000" step="0.01" placeholder="10.00" value={amount} onChange={e => setAmount(e.target.value)} className="h-12 text-lg" />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium mb-1 block">Email</label>
              <Input type="email" autoComplete="email" placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} className="h-11" />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Mobile number</label>
              <Input type="tel" autoComplete="tel" placeholder="+254 7XX XXX XXX" value={phone} onChange={e => setPhone(e.target.value)} className="h-11" />
            </div>
          </div>

          <Button onClick={startPesaPal} disabled={creating} className="w-full h-12 bg-[#f58220] hover:bg-[#d96f13] text-white">
            {creating ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <ExternalLink className="w-4 h-4 mr-2" />}
            {creating ? 'Opening PesaPal…' : 'Continue with PesaPal'}
          </Button>

          <div className="flex items-start gap-2 text-[11px] text-muted-foreground">
            <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>PesaPal will present the available payment methods. Its callback and IPN are reconciled against the provider status before wallet credit.</span>
          </div>
        </>
      )}
    </div>
  );
}
