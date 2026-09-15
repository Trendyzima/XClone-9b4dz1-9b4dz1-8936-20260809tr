import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CreditCard, ExternalLink, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useWallet } from '@/hooks/useWallet';
import { toast } from 'sonner';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

function errorMessage(error: unknown): string {
  if (error instanceof FunctionsHttpError) {
    return error.message || 'PayPal request failed';
  }
  return error instanceof Error ? error.message : 'PayPal request failed';
}

export function PayPalTopUp() {
  const { wallet, fetchWallet } = useWallet();
  const [searchParams] = useSearchParams();
  const [amount, setAmount] = useState('');
  const [paypalEmail, setPaypalEmail] = useState('');
  const [creating, setCreating] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [returnHandled, setReturnHandled] = useState(false);

  useEffect(() => {
    const saved = wallet?.paypal_email;
    if (saved && !paypalEmail) setPaypalEmail(saved);
  }, [wallet?.paypal_email]);

  useEffect(() => {
    const state = searchParams.get('paypal');
    const orderId = searchParams.get('token') || searchParams.get('orderID');
    if (returnHandled || !state) return;

    if (state === 'cancelled') {
      setReturnHandled(true);
      window.history.replaceState({}, '', '/wallet');
      toast.info('PayPal payment cancelled. Your wallet was not credited.');
      return;
    }

    if (state !== 'return' || !orderId) return;

    setReturnHandled(true);
    window.history.replaceState({}, '', '/wallet');
    setCapturing(true);

    void (async () => {
      try {
        const { data, error } = await supabase.functions.invoke('paypal-capture-order', {
          body: { orderId },
        });
        if (error) throw error;
        if (!data?.ok) throw new Error('PayPal payment could not be completed');
        await fetchWallet();
        toast.success('PayPal payment confirmed and your wallet has been credited.');
      } catch (error) {
        toast.error(errorMessage(error));
      } finally {
        setCapturing(false);
      }
    })();
  }, [searchParams, returnHandled, fetchWallet]);

  const startPayPal = async () => {
    const value = Number(amount);
    if (!Number.isFinite(value) || value < 1 || value > 100000) {
      toast.error('Enter an amount between $1 and $100,000.');
      return;
    }
    if (paypalEmail && !/^\S+@\S+\.\S+$/.test(paypalEmail.trim())) {
      toast.error('Enter a valid PayPal email address.');
      return;
    }

    setCreating(true);
    try {
      const { data, error } = await supabase.functions.invoke('paypal-create-order', {
        body: {
          amount: Number(value.toFixed(2)),
          currency: 'USD',
          paypal_email: paypalEmail.trim() || undefined,
        },
      });
      if (error) throw error;
      if (!data?.approvalUrl) throw new Error('PayPal did not return an approval link');
      window.location.assign(data.approvalUrl);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setCreating(false);
    }
  };

  const balance = Number(wallet?.balance || 0);

  return (
    <div className="bg-card border-2 border-[#0070ba]/20 rounded-2xl p-6 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-[#0070ba]/10">
            <CreditCard className="w-5 h-5 text-[#0070ba]" />
          </div>
          <div>
            <h3 className="font-bold">PayPal</h3>
            <p className="text-xs text-muted-foreground">Secure USD wallet top-up</p>
          </div>
        </div>
        <span className="text-[11px] font-semibold px-2 py-1 rounded-full bg-muted">USD</span>
      </div>

      {capturing ? (
        <div className="flex items-center gap-3 rounded-xl bg-primary/5 border border-primary/10 p-4">
          <Loader2 className="w-5 h-5 animate-spin text-primary" />
          <div>
            <p className="font-semibold text-sm">Confirming PayPal payment…</p>
            <p className="text-xs text-muted-foreground">We verify the capture before crediting your wallet.</p>
          </div>
        </div>
      ) : (
        <>
          <div className="rounded-xl bg-muted/60 p-3 text-xs text-muted-foreground flex gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0 text-green-600" />
            <span>Payment is credited only after the server verifies the PayPal capture.</span>
          </div>

          <div>
            <label className="text-sm font-medium mb-1 block">Amount (USD)</label>
            <Input
              type="number"
              inputMode="decimal"
              min="1"
              max="100000"
              step="0.01"
              placeholder="10.00"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              className="h-12 text-lg"
            />
          </div>

          <div>
            <label className="text-sm font-medium mb-1 block">PayPal email <span className="text-muted-foreground font-normal">(optional)</span></label>
            <Input
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={paypalEmail}
              onChange={(event) => setPaypalEmail(event.target.value)}
              className="h-11"
            />
          </div>

          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Current balance</span>
            <span className="font-semibold text-foreground">${balance.toFixed(2)}</span>
          </div>

          <Button onClick={startPayPal} disabled={creating} className="w-full h-12 bg-[#0070ba] hover:bg-[#005ea6]">
            {creating ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <ExternalLink className="w-4 h-4 mr-2" />}
            {creating ? 'Opening PayPal…' : 'Continue with PayPal'}
          </Button>

          <div className="flex items-start gap-2 text-[11px] text-muted-foreground">
            <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>You will leave Testagram to approve the payment on PayPal, then return here for final capture.</span>
          </div>
        </>
      )}
    </div>
  );
}
