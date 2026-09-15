import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  CreditCard, ExternalLink, Loader2, CheckCircle2, AlertCircle,
  Send, ArrowDownLeft, ArrowUpRight, Users, Smartphone, WalletCards,
  LockKeyhole,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useWallet } from '@/hooks/useWallet';
import { toast } from 'sonner';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PesaPalTopUp } from '@/components/features/PesaPalTopUp';

function errorMessage(error: unknown): string {
  if (error instanceof FunctionsHttpError) return error.message || 'PayPal request failed';
  return error instanceof Error ? error.message : 'PayPal request failed';
}

function openWalletTab(tab: 'send' | 'wallet') {
  const url = `/wallet?tab=${tab}`;
  window.location.assign(url);
}

export function PayPalTopUp() {
  const { wallet, fetchWallet } = useWallet();
  const [searchParams] = useSearchParams();
  const [amount, setAmount] = useState('');
  const [paypalEmail, setPaypalEmail] = useState('');
  const [creating, setCreating] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [returnHandled, setReturnHandled] = useState(false);
  const [moveMode, setMoveMode] = useState<'fund' | 'send' | 'cashout'>('fund');

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
    <div className="space-y-4">
      {/* Unified money movement hub */}
      <div className="bg-card border-2 border-primary/15 rounded-2xl p-5 space-y-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-primary/10">
            <WalletCards className="w-5 h-5 text-primary" />
          </div>
          <div className="flex-1">
            <h3 className="font-bold">Move Money</h3>
            <p className="text-xs text-muted-foreground">Fund your wallet, send to people, or cash out.</p>
          </div>
          <span className="text-xs font-bold">${balance.toFixed(2)}</span>
        </div>

        <div className="grid grid-cols-3 gap-1 bg-muted rounded-xl p-1">
          <button onClick={() => setMoveMode('fund')}
            className={`py-2 rounded-lg text-xs font-bold transition-colors ${moveMode === 'fund' ? 'bg-background shadow-sm' : 'text-muted-foreground'}`}>
            <ArrowDownLeft className="w-3.5 h-3.5 mx-auto mb-1" />Fund
          </button>
          <button onClick={() => setMoveMode('send')}
            className={`py-2 rounded-lg text-xs font-bold transition-colors ${moveMode === 'send' ? 'bg-background shadow-sm' : 'text-muted-foreground'}`}>
            <Send className="w-3.5 h-3.5 mx-auto mb-1" />Send
          </button>
          <button onClick={() => setMoveMode('cashout')}
            className={`py-2 rounded-lg text-xs font-bold transition-colors ${moveMode === 'cashout' ? 'bg-background shadow-sm' : 'text-muted-foreground'}`}>
            <ArrowUpRight className="w-3.5 h-3.5 mx-auto mb-1" />Cash out
          </button>
        </div>

        {moveMode === 'send' && (
          <div className="grid grid-cols-2 gap-3">
            <button onClick={() => openWalletTab('send')}
              className="text-left p-4 rounded-xl border border-primary/20 bg-primary/5 hover:bg-primary/10 transition-colors">
              <Users className="w-5 h-5 text-primary mb-2" />
              <p className="font-bold text-sm">Testagram user</p>
              <p className="text-[11px] text-muted-foreground mt-1">Send from your wallet to another member.</p>
            </button>
            <button onClick={() => openWalletTab('send')}
              className="text-left p-4 rounded-xl border border-green-500/20 bg-green-500/5 hover:bg-green-500/10 transition-colors">
              <Smartphone className="w-5 h-5 text-green-600 mb-2" />
              <p className="font-bold text-sm">M-Pesa</p>
              <p className="text-[11px] text-muted-foreground mt-1">Send directly to a Kenyan M-Pesa number.</p>
            </button>
            <div className="col-span-2 grid grid-cols-2 gap-3">
              <div className="p-3 rounded-xl border border-border bg-muted/30 opacity-70">
                <p className="font-semibold text-xs">PesaPal payout</p>
                <p className="text-[10px] text-muted-foreground mt-1">Outbound PesaPal rail is not enabled yet.</p>
              </div>
              <div className="p-3 rounded-xl border border-border bg-muted/30 opacity-70">
                <p className="font-semibold text-xs">PayPal payout</p>
                <p className="text-[10px] text-muted-foreground mt-1">PayPal is currently connected for wallet funding, not payouts.</p>
              </div>
            </div>
          </div>
        )}

        {moveMode === 'cashout' && (
          <div className="space-y-3">
            <button onClick={() => openWalletTab('send')}
              className="w-full flex items-center gap-3 p-4 rounded-xl border border-green-500/20 bg-green-500/5 hover:bg-green-500/10 text-left transition-colors">
              <Smartphone className="w-5 h-5 text-green-600" />
              <div className="flex-1">
                <p className="font-bold text-sm">M-Pesa cash out</p>
                <p className="text-[11px] text-muted-foreground">Server-authoritative B2C payout with wallet reservation and callback settlement.</p>
              </div>
              <ArrowUpRight className="w-4 h-4 text-green-600" />
            </button>
            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 rounded-xl border border-border bg-muted/30 opacity-70">
                <p className="font-semibold text-xs">PesaPal</p>
                <p className="text-[10px] text-muted-foreground mt-1">Top-up is connected; outbound payout is pending backend support.</p>
              </div>
              <div className="p-3 rounded-xl border border-border bg-muted/30 opacity-70">
                <p className="font-semibold text-xs">PayPal</p>
                <p className="text-[10px] text-muted-foreground mt-1">Wallet funding is connected; outbound payout is pending backend support.</p>
              </div>
            </div>
          </div>
        )}

        {moveMode === 'fund' && (
          <div className="flex items-start gap-2 rounded-xl bg-muted/50 p-3 text-xs text-muted-foreground">
            <LockKeyhole className="w-4 h-4 shrink-0 text-primary" />
            <span>All funding and cash-out operations are finalized by the backend. The browser does not directly credit or debit your balance.</span>
          </div>
        )}
      </div>

      {/* PayPal wallet funding */}
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
              <Input type="number" inputMode="decimal" min="1" max="100000" step="0.01" placeholder="10.00"
                value={amount} onChange={(event) => setAmount(event.target.value)} className="h-12 text-lg" />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">PayPal email <span className="text-muted-foreground font-normal">(optional)</span></label>
              <Input type="email" autoComplete="email" placeholder="you@example.com" value={paypalEmail}
                onChange={(event) => setPaypalEmail(event.target.value)} className="h-11" />
            </div>
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Current balance</span><span className="font-semibold text-foreground">${balance.toFixed(2)}</span>
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

      <PesaPalTopUp />
    </div>
  );
}
