import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { formatNumber } from '@/lib/utils';
import { toast } from 'sonner';
import {
  Coins, Flame, Gift, ArrowRight, WalletCards, Sparkles, Users,
  RefreshCw, Loader2, ShieldCheck, CircleDollarSign, UserRound,
} from 'lucide-react';

type Profile = { username: string | null; display_name: string | null; avatar_url: string | null };
type RewardState = { streak_day: number; last_claimed_at: string | null };

const EARN_ACTIONS = [
  { title: 'Keep your daily streak', text: 'Claim the next daily reward without breaking your streak.', icon: Flame, href: '/daily-rewards', tone: 'orange' },
  { title: 'Invite your people', text: 'Grow the community through your referral link.', icon: Users, href: '/referrals', tone: 'blue' },
  { title: 'Create & participate', text: 'Use Testagram normally: publish, join conversations and build your audience.', icon: Sparkles, href: '/discover', tone: 'primary' },
] as const;

export default function CreditsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState(false);
  const [credits, setCredits] = useState(0);
  const [cashCents, setCashCents] = useState(0);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [reward, setReward] = useState<RewardState | null>(null);
  const [redeemAmount, setRedeemAmount] = useState('5000');
  const [redeeming, setRedeeming] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const [{ data: wallet }, { data: cash }, { data: rewardData }, { data: profileData }] = await Promise.all([
      supabase.from('user_wallets').select('credits').eq('user_id', user.id).maybeSingle(),
      supabase.from('reward_cash_balances').select('balance_cents,currency').eq('user_id', user.id).maybeSingle(),
      supabase.from('daily_rewards').select('streak_day,last_claimed_at').eq('user_id', user.id).maybeSingle(),
      supabase.from('profiles').select('username,display_name,avatar_url').eq('id', user.id).maybeSingle(),
    ]);
    setCredits(Number(wallet?.credits ?? 0));
    setCashCents(Number(cash?.balance_cents ?? 0));
    setReward(rewardData as RewardState | null);
    setProfile(profileData as Profile | null);
    setLoading(false);
  }, [user?.id]);

  useEffect(() => {
    if (!user) {
      navigate('/auth');
      return;
    }
    void load();
  }, [user?.id, load, navigate]);

  const canClaim = useMemo(() => {
    const last = reward?.last_claimed_at;
    if (!last) return true;
    const d = new Date(last);
    const n = new Date();
    return d.getUTCFullYear() !== n.getUTCFullYear() || d.getUTCMonth() !== n.getUTCMonth() || d.getUTCDate() !== n.getUTCDate();
  }, [reward?.last_claimed_at]);

  const nextReward = [10, 15, 20, 25, 30, 40, 50][Math.max(0, Math.min((reward?.streak_day ?? 0), 6))] ?? 10;
  const maxRedeem = Math.floor(credits / 100) * 100;
  const previewKes = Math.floor((Number(redeemAmount) || 0) / 100);

  const claimDaily = async () => {
    if (!user || !canClaim || claiming) return;
    setClaiming(true);
    try {
      const { data, error } = await supabase.rpc('claim_daily_reward');
      if (error) throw error;
      if (!data?.ok) throw new Error('Reward claim was not accepted');
      toast.success(`+${data.credits_earned} credits added to your balance`);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Unable to claim reward');
    } finally {
      setClaiming(false);
    }
  };

  const redeem = async () => {
    const amount = Number(redeemAmount);
    if (!Number.isSafeInteger(amount) || amount < 5000 || amount % 100 !== 0) {
      toast.error('Use at least 5,000 credits in 100-credit increments.');
      return;
    }
    if (amount > credits) {
      toast.error('Not enough credits.');
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
      toast.success(`${amount.toLocaleString()} credits redeemed for KES ${kes.toLocaleString()}`);
      setRedeemAmount('5000');
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Redemption failed');
    } finally {
      setRedeeming(false);
    }
  };

  if (!user) return null;

  return (
    <div className="min-h-screen bg-background pb-20 md:pb-0">
      <div className="sticky top-0 z-20 border-b border-border/70 bg-background/95 px-4 py-4 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-primary">Testagram Credits</p>
            <h1 className="text-2xl font-black tracking-tight">Your people. Your moments. Your rewards.</h1>
          </div>
          <button onClick={() => void load()} className="rounded-full p-2 hover:bg-muted" aria-label="Refresh credits">
            <RefreshCw className={`h-5 w-5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      <main className="mx-auto max-w-2xl space-y-4 p-4">
        <section className="overflow-hidden rounded-3xl border border-primary/20 bg-gradient-to-br from-primary/15 via-background to-amber-500/10 p-5 shadow-sm">
          <div className="flex items-start gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-primary/15">
              <Coins className="h-7 w-7 text-primary" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-muted-foreground">Available credits</p>
              <p className="mt-1 text-4xl font-black tracking-tight">{loading ? '—' : formatNumber(credits)}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                <span className="rounded-full bg-background/80 px-2.5 py-1 font-bold">@{profile?.username ?? 'you'}</span>
                <span className="rounded-full bg-background/80 px-2.5 py-1 text-muted-foreground">100 credits = KES 1</span>
              </div>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <div className="rounded-2xl border border-border/70 bg-background/70 p-3">
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Cash redeemed</p>
              <p className="mt-1 text-lg font-black">KES {formatNumber(cashCents / 100)}</p>
            </div>
            <div className="rounded-2xl border border-border/70 bg-background/70 p-3">
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Streak</p>
              <p className="mt-1 flex items-center gap-1 text-lg font-black"><Flame className="h-4 w-4 text-orange-500" />Day {reward?.streak_day ?? 0}</p>
            </div>
          </div>
        </section>

        <section className="rounded-3xl border border-border bg-card p-5">
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-green-600" />
            <div>
              <h2 className="font-black">One credits balance, clear boundaries</h2>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                Credits are Testagram rewards. Your cash wallet remains the canonical money balance. Credits can be redeemed through the server-controlled rewards flow and are never changed by the browser directly.
              </p>
            </div>
          </div>
        </section>

        <section className="rounded-3xl border border-border bg-card p-5">
          <div className="mb-4 flex items-center justify-between">
            <div><h2 className="font-black">Earn credits</h2><p className="text-xs text-muted-foreground">Real actions, visible rewards.</p></div>
            <Gift className="h-5 w-5 text-primary" />
          </div>
          <div className="space-y-2">
            {EARN_ACTIONS.map(action => {
              const Icon = action.icon;
              return (
                <button key={action.title} onClick={() => navigate(action.href)} className="flex w-full items-center gap-3 rounded-2xl border border-border p-3 text-left transition hover:border-primary/30 hover:bg-primary/5">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted"><Icon className="h-5 w-5" /></div>
                  <div className="min-w-0 flex-1"><p className="font-bold text-sm">{action.title}</p><p className="text-xs text-muted-foreground">{action.text}</p></div>
                  <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </button>
              );
            })}
          </div>
        </section>

        <section className="rounded-3xl border border-border bg-card p-5">
          <div className="mb-3 flex items-center gap-3">
            <Gift className="h-5 w-5 text-pink-500" />
            <div><h2 className="font-black">Support creators</h2><p className="text-xs text-muted-foreground">Keep the social layer human.</p></div>
          </div>
          <p className="text-sm text-muted-foreground">Open any creator profile to use the existing Tips and Gifts flows. Credits remain separate from the canonical cash wallet until an explicit redemption occurs.</p>
          <Button onClick={() => navigate('/discover')} className="mt-4 h-11 w-full rounded-xl font-bold"><UserRound className="mr-2 h-4 w-4" />Discover people</Button>
        </section>

        <section className="rounded-3xl border border-primary/20 bg-primary/5 p-5">
          <div className="flex items-center gap-3">
            <WalletCards className="h-5 w-5 text-primary" />
            <div><h2 className="font-black">Redeem to cash</h2><p className="text-xs text-muted-foreground">Server-validated conversion</p></div>
          </div>
          <div className="mt-4 grid grid-cols-[1fr_auto] gap-2">
            <input value={redeemAmount} onChange={e => setRedeemAmount(e.target.value.replace(/\D/g, ''))} inputMode="numeric" min={5000} step={100} max={maxRedeem || undefined} className="h-11 min-w-0 rounded-xl border border-border bg-background px-3 text-sm font-bold outline-none focus:ring-2 focus:ring-primary/30" aria-label="Credits to redeem" />
            <Button onClick={redeem} disabled={redeeming || loading || credits < 5000} className="h-11 rounded-xl px-4 font-bold">{redeeming ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Redeem'}</Button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">{previewKes > 0 ? `${Number(redeemAmount || 0).toLocaleString()} credits → KES ${previewKes.toLocaleString()}` : 'Minimum redemption: 5,000 credits'}</p>
          <div className="mt-4 flex items-center justify-between rounded-2xl border border-border bg-background/70 p-3">
            <div><p className="text-xs font-bold">Daily reward</p><p className="text-xs text-muted-foreground">Day {Math.min((reward?.streak_day ?? 0) + (canClaim ? 1 : 0), 7)} · +{nextReward} credits</p></div>
            <Button variant="outline" size="sm" onClick={claimDaily} disabled={!canClaim || claiming}>{claiming ? <Loader2 className="h-4 w-4 animate-spin" /> : canClaim ? 'Claim' : 'Claimed'}</Button>
          </div>
        </section>

        <section className="grid grid-cols-2 gap-2">
          <Button variant="outline" onClick={() => navigate('/wallet')} className="h-11 rounded-xl font-bold"><CircleDollarSign className="mr-2 h-4 w-4" />Cash Wallet</Button>
          <Button variant="outline" onClick={() => navigate(profile?.username ? `/profile/${profile.username}` : '/profile-features')} className="h-11 rounded-xl font-bold"><UserRound className="mr-2 h-4 w-4" />My profile</Button>
        </section>
      </main>
    </div>
  );
}
