import { useCallback, useEffect, useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import { Coins, Loader2, WalletCards, ArrowRight, RefreshCw } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { formatNumber } from '@/lib/utils';

type RewardCashBalance = {
  balance_cents: number;
  currency: string;
};

export function ProfileRewardsRedemptionCard() {
  const { user } = useAuth();
  const { username } = useParams();
  const location = useLocation();
  const [isOwnProfile, setIsOwnProfile] = useState(false);
  const [credits, setCredits] = useState(0);
  const [cashBalanceCents, setCashBalanceCents] = useState(0);
  const [redeemAmount, setRedeemAmount] = useState('5000');
  const [loading, setLoading] = useState(true);
  const [redeeming, setRedeeming] = useState(false);

  const visible = location.pathname.startsWith('/profile/') && !!user && !!username;

  const load = useCallback(async () => {
    if (!user || !username) return;
    setLoading(true);
    const [{ data: profile }, { data: wallet }, { data: cash }] = await Promise.all([
      supabase.from('profiles').select('id').eq('username', username).maybeSingle(),
      supabase.from('user_wallets').select('credits').eq('user_id', user.id).maybeSingle(),
      supabase.from('reward_cash_balances').select('balance_cents,currency').eq('user_id', user.id).maybeSingle(),
    ]);
    const own = profile?.id === user.id;
    setIsOwnProfile(own);
    if (own) {
      setCredits(Number(wallet?.credits ?? 0));
      setCashBalanceCents(Number((cash as RewardCashBalance | null)?.balance_cents ?? 0));
    }
    setLoading(false);
  }, [user?.id, username]);

  useEffect(() => {
    if (visible) void load();
    else setLoading(false);
  }, [visible, load]);

  const handleRedeem = async () => {
    const amount = Number(redeemAmount);
    if (!Number.isSafeInteger(amount) || amount < 5000 || amount % 100 !== 0) {
      toast.error('Enter at least 5,000 credits in 100-credit increments.');
      return;
    }
    if (amount > credits) {
      toast.error('You do not have enough credits.');
      return;
    }

    setRedeeming(true);
    try {
      const { data, error } = await supabase.functions.invoke('redeem-credits', {
        body: { credits: amount, idempotency_key: crypto.randomUUID() },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      const kes = Number(data?.cash_amount_kes ?? Number(data?.cash_amount_cents ?? 0) / 100);
      toast.success(`${amount.toLocaleString()} credits redeemed for KES ${kes.toLocaleString()}.`);
      setRedeemAmount('5000');
      await load();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(message || 'Redemption failed');
    } finally {
      setRedeeming(false);
    }
  };

  if (!visible || !isOwnProfile) return null;

  const maxRedeem = Math.floor(credits / 100) * 100;
  const previewKes = Math.floor((Number(redeemAmount) || 0) / 100);

  return (
    <section className="mx-4 mt-3 mb-2 rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/10 via-background to-amber-500/5 p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary/10">
          <WalletCards className="h-5 w-5 text-primary" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="font-black">Rewards → Cash</p>
              <p className="text-xs text-muted-foreground">100 credits = KES 1</p>
            </div>
            <button onClick={() => void load()} className="rounded-full p-2 text-muted-foreground hover:bg-muted" aria-label="Refresh rewards">
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2">
            <div className="rounded-xl border border-border bg-background/70 p-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Credits</p>
              <p className="mt-1 flex items-center gap-1 text-xl font-black"><Coins className="h-4 w-4 text-primary" />{formatNumber(credits)}</p>
            </div>
            <div className="rounded-xl border border-border bg-background/70 p-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Redeemed cash</p>
              <p className="mt-1 text-xl font-black">KES {formatNumber(cashBalanceCents / 100)}</p>
            </div>
          </div>

          <div className="mt-3 flex gap-2">
            <input
              value={redeemAmount}
              onChange={e => setRedeemAmount(e.target.value.replace(/\D/g, ''))}
              inputMode="numeric"
              min={5000}
              step={100}
              max={maxRedeem || undefined}
              aria-label="Credits to redeem"
              className="h-11 min-w-0 flex-1 rounded-xl border border-border bg-background px-3 text-sm font-bold outline-none focus:ring-2 focus:ring-primary/30"
            />
            <Button onClick={handleRedeem} disabled={redeeming || loading || credits < 5000} className="h-11 rounded-xl px-4 font-bold">
              {redeeming ? <Loader2 className="h-4 w-4 animate-spin" /> : <>Redeem <ArrowRight className="ml-1 h-4 w-4" /></>}
            </Button>
          </div>
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            {previewKes > 0 ? `${Number(redeemAmount || 0).toLocaleString()} credits → KES ${previewKes.toLocaleString()}` : 'Minimum redemption: 5,000 credits'}
          </p>
        </div>
      </div>
    </section>
  );
}
