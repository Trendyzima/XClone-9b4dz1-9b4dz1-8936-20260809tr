import { useCallback, useEffect, useState } from 'react';
import { useSEO } from '@/hooks/useSEO';
import { TopBar } from '@/components/layout/TopBar';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Loader2, Flame, Coins, Calendar, Trophy, Zap, Gift } from 'lucide-react';
import { formatNumber } from '@/lib/utils';
import { PageAdBanner } from '@/components/features/AdSenseAd';

const DAY_REWARDS = [10, 15, 20, 25, 30, 40, 50];
const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

type Reward = {
  user_id: string;
  streak_day: number;
  credits_earned: number;
  last_claimed_at: string | null;
};

type ClaimResult = {
  ok: boolean;
  streak_day: number;
  credits_earned: number;
  wallet_credits: number;
  claimed_at: string;
};

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error.trim()) return error;
  if (error && typeof error === 'object') {
    const value = error as Record<string, unknown>;
    if (typeof value.message === 'string' && value.message.trim()) return value.message;
    if (typeof value.error === 'string' && value.error.trim()) return value.error;
    if (typeof value.details === 'string' && value.details.trim()) return value.details;
    if (typeof value.hint === 'string' && value.hint.trim()) return value.hint;
    try {
      const serialized = JSON.stringify(error);
      if (serialized && serialized !== '{}') return serialized;
    } catch {
      // Fall through to the stable user-facing fallback.
    }
  }
  return fallback;
}

function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function updateMidnightCountdown(setValue: (value: string) => void) {
  const now = new Date();
  const midnight = new Date();
  midnight.setHours(24, 0, 0, 0);
  const diff = Math.max(0, midnight.getTime() - now.getTime());
  const h = Math.floor(diff / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  setValue(`${h}h ${m}m`);
}

export default function DailyRewardsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  useSEO({ noindex: true, title: 'Daily Rewards', url: '/rewards' });

  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState(false);
  const [reward, setReward] = useState<Reward | null>(null);
  const [walletCredits, setWalletCredits] = useState(0);
  const [canClaim, setCanClaim] = useState(false);
  const [nextClaimIn, setNextClaimIn] = useState('');

  const fetchData = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const [{ data: rewardData, error: rewardError }, { data: walletData, error: walletError }] = await Promise.all([
      supabase.from('daily_rewards').select('user_id,streak_day,credits_earned,last_claimed_at').eq('user_id', user.id).maybeSingle(),
      supabase.from('user_wallets').select('credits').eq('user_id', user.id).maybeSingle(),
    ]);

    if (rewardError || walletError) {
      toast.error('Failed to load rewards');
    }

    const currentReward = rewardData as Reward | null;
    setReward(currentReward);
    setWalletCredits(walletData?.credits ?? 0);

    if (!currentReward?.last_claimed_at) {
      setCanClaim(true);
    } else if (isSameDay(new Date(currentReward.last_claimed_at), new Date())) {
      setCanClaim(false);
      updateMidnightCountdown(setNextClaimIn);
    } else {
      setCanClaim(true);
    }
    setLoading(false);
  }, [user?.id]);

  useEffect(() => {
    if (!user) {
      navigate('/auth');
      return;
    }
    void fetchData();
  }, [user?.id, fetchData, navigate]);

  useEffect(() => {
    if (canClaim) return;
    const timer = setInterval(() => updateMidnightCountdown(setNextClaimIn), 60_000);
    updateMidnightCountdown(setNextClaimIn);
    return () => clearInterval(timer);
  }, [canClaim]);

  const handleClaim = async () => {
    if (!user || !canClaim || claiming) return;
    setClaiming(true);
    try {
      // The database owns streak calculation, duplicate-day protection,
      // wallet mutation and credit-ledger insertion atomically. Do not
      // reproduce those writes in the browser.
      const { data, error } = await supabase.rpc('claim_daily_reward');
      if (error) throw error;

      const result = data as ClaimResult;
      if (!result?.ok) throw new Error('Reward claim was not accepted');

      toast.success(`+${result.credits_earned} credits earned! Day ${result.streak_day} streak!`);
      await fetchData();
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to claim reward'));
    } finally {
      setClaiming(false);
    }
  };

  if (!user) return null;

  const streakDay = reward?.streak_day ?? 0;
  const nextRewardDay = canClaim ? (reward ? Math.min(streakDay + 1, 7) : 1) : streakDay;
  const nextCredits = DAY_REWARDS[Math.max(0, nextRewardDay - 1)] ?? 10;

  return (
    <div className="min-h-screen bg-background pb-20 md:pb-0">
      <TopBar title="Daily Rewards" showBack />
      <PageAdBanner />
      {loading ? (
        <div className="flex items-center justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
      ) : (
        <div className="mx-auto max-w-lg space-y-5 p-4">
          <div className="relative overflow-hidden rounded-2xl border border-orange-500/20 bg-gradient-to-br from-orange-500/20 via-amber-500/10 to-yellow-500/5 p-6 text-center">
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-[120px] leading-none opacity-5">🔥</div>
            <Flame className="mx-auto mb-3 h-14 w-14 text-orange-500" />
            <p className="mb-1 text-sm text-muted-foreground">Current Streak</p>
            <p className="text-6xl font-black tracking-tight">{streakDay}</p>
            <p className="mt-1 text-sm font-medium text-muted-foreground">
              {streakDay === 0 ? 'Start your streak today!' : streakDay === 7 ? 'Max streak reached! 🏆' : `${7 - streakDay} days to max streak`}
            </p>
          </div>

          <div className="flex items-center justify-between rounded-xl border border-border bg-muted/50 px-5 py-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10"><Coins className="h-5 w-5 text-primary" /></div>
              <div><p className="text-xs text-muted-foreground">Wallet Credits</p><p className="text-2xl font-bold">{formatNumber(walletCredits)}</p></div>
            </div>
            <Button variant="ghost" size="sm" onClick={() => navigate('/wallet')} className="text-xs text-primary">View Wallet</Button>
          </div>

          <div className="rounded-2xl border border-border bg-muted/50 p-5">
            <h3 className="mb-4 flex items-center gap-2 font-bold"><Calendar className="h-5 w-5 text-primary" />Weekly Streak Calendar</h3>
            <div className="grid grid-cols-7 gap-2">
              {DAY_REWARDS.map((credits, i) => {
                const dayNum = i + 1;
                const isPast = dayNum < streakDay;
                const isCurrent = dayNum === streakDay;
                const isNext = dayNum === nextRewardDay && canClaim;
                return (
                  <div key={dayNum} className={`flex flex-col items-center gap-1 rounded-xl p-2 ${isCurrent ? 'scale-105 bg-primary text-primary-foreground shadow-md' : isNext ? 'border-2 border-primary/50 bg-primary/20' : isPast ? 'border border-green-500/20 bg-green-500/10' : 'border border-border bg-background opacity-50'}`}>
                    <span className="text-[10px] font-medium">{DAY_LABELS[i]}</span>
                    <span className={`text-base ${isPast ? 'text-green-500' : isCurrent ? 'text-primary-foreground' : 'text-muted-foreground'}`}>{isPast ? '✓' : isCurrent ? '🔥' : isNext ? '🎁' : dayNum === 7 ? '🏆' : credits}</span>
                    <span className={`text-[9px] font-semibold ${isCurrent ? 'text-primary-foreground/80' : 'text-muted-foreground'}`}>+{credits}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {canClaim ? (
            <div className="flex flex-col items-center gap-3 rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/10 to-primary/5 p-5">
              <div className="flex items-center gap-2"><Gift className="h-5 w-5 text-primary" /><p className="font-semibold">Day {nextRewardDay} Reward Available!</p></div>
              <p className="text-3xl font-black text-primary">+{nextCredits} Credits</p>
              <Button onClick={handleClaim} disabled={claiming} size="lg" className="h-12 w-full rounded-xl text-base font-bold shadow-lg shadow-primary/20">
                {claiming ? <Loader2 className="h-5 w-5 animate-spin" /> : <><Zap className="mr-2 h-5 w-5" />Claim Reward</>}
              </Button>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2 rounded-2xl border border-border bg-muted/50 p-5">
              <Trophy className="h-8 w-8 text-muted-foreground" />
              <p className="font-semibold">Already claimed today!</p>
              <p className="text-sm text-muted-foreground">Come back in <span className="font-bold text-foreground">{nextClaimIn}</span></p>
            </div>
          )}

          <div className="space-y-2 rounded-xl border border-border bg-muted/30 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Streak Tips</p>
            <ul className="space-y-1.5 text-sm text-muted-foreground">
              <li className="flex items-center gap-2"><Flame className="h-3.5 w-3.5 shrink-0 text-orange-400" />Claim every day to keep your streak alive</li>
              <li className="flex items-center gap-2"><Trophy className="h-3.5 w-3.5 shrink-0 text-yellow-400" />Day 7 gives you the max reward: <strong className="text-foreground">50 credits</strong></li>
              <li className="flex items-center gap-2"><Coins className="h-3.5 w-3.5 shrink-0 text-primary" />Use credits to boost posts, unlock features, and more</li>
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
