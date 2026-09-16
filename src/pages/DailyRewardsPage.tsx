import { useState, useEffect, useRef, useCallback } from 'react';
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
function DailyRewardsAdBanner() { return <PageAdBanner />; }

const DAY_REWARDS = [10, 15, 20, 25, 30, 40, 50];
const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
}

function isYesterday(date: Date) {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  return isSameDay(date, yesterday);
}

export default function DailyRewardsPage() {
  const { user } = useAuth();
  useSEO({ noindex: true, title: 'Daily Rewards', url: '/rewards' });
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState(false);
  const [reward, setReward] = useState<any>(null);
  const [walletCredits, setWalletCredits] = useState<number | null>(null);
  const [canClaim, setCanClaim] = useState(false);
  const [nextClaimIn, setNextClaimIn] = useState('');

  const fetchData = useCallback(async () => {
    if (!user) return;
    setLoading(true);

    const [{ data: rewardData }, { data: walletData }] = await Promise.all([
      supabase.from('daily_rewards').select('*').eq('user_id', user.id).maybeSingle(),
      supabase.from('user_wallets').select('credits').eq('user_id', user.id).maybeSingle(),
    ]);

    setReward(rewardData);
    setWalletCredits(walletData?.credits ?? 0);

    if (!rewardData) {
      setCanClaim(true);
    } else {
      const last = new Date(rewardData.last_claimed_at);
      const today = new Date();
      if (isSameDay(last, today)) {
        // Already claimed today — compute time until midnight
        setCanClaim(false);
        updateCountdown();
      } else {
        setCanClaim(true);
      }
    }
    setLoading(false);
  }, [user?.id]);

  const updateCountdown = () => {
    const now = new Date();
    const midnight = new Date();
    midnight.setHours(24, 0, 0, 0);
    const diff = midnight.getTime() - now.getTime();
    const h = Math.floor(diff / 3_600_000);
    const m = Math.floor((diff % 3_600_000) / 60_000);
    setNextClaimIn(`${h}h ${m}m`);
  };

  useEffect(() => {
    if (!user) { navigate('/auth'); return; }
    fetchData();
  }, [user?.id]);

  useEffect(() => {
    if (!canClaim) {
      const iv = setInterval(updateCountdown, 60_000);
      updateCountdown();
      return () => clearInterval(iv);
    }
  }, [canClaim]);

  const handleClaim = async () => {
    if (!user || !canClaim) return;
    setClaiming(true);

    const now = new Date();
    const last = reward ? new Date(reward.last_claimed_at) : null;
    const streakContinued = last && isYesterday(last);
    const currentStreak = reward?.streak_day ?? 0;
    const newStreak = streakContinued ? Math.min(currentStreak + 1, 7) : 1;
    const creditsEarned = DAY_REWARDS[newStreak - 1] ?? 10;

    // Upsert daily_rewards
    const { error: upsertErr } = await supabase.from('daily_rewards').upsert({
      user_id: user.id,
      streak_day: newStreak,
      credits_earned: creditsEarned,
      last_claimed_at: now.toISOString(),
    }, { onConflict: 'user_id' });

    if (upsertErr) {
      toast.error('Failed to claim reward');
      setClaiming(false);
      return;
    }

    // Insert credit transaction
    await supabase.from('credit_transactions').insert({
      user_id: user.id,
      amount: creditsEarned,
      reason: `Daily streak reward — Day ${newStreak}`,
    });

    // Update wallet credits
    await supabase.from('user_wallets').upsert({
      user_id: user.id,
      credits: (walletCredits ?? 0) + creditsEarned,
    }, { onConflict: 'user_id' });

    // Streak milestone notification (3-day and 7-day/max milestones)
    const STREAK_MILESTONES = [3, 7];
    if (STREAK_MILESTONES.includes(newStreak)) {
      const milestoneMsg =
        newStreak === 7
          ? '🏆 Max streak reached! 7 days in a row!'
          : `🔥 ${newStreak}-day streak milestone!`;
      // Insert in-app notification so it appears in Notifications page
      supabase.from('notifications').insert({ recipient_id: user.id, kind: 'streak_milestone', actor_id: user.id,
       }).catch(() => {});
      // Auto-create a 24-hour story to celebrate the milestone
      supabase.from('stories').insert({
        user_id: user.id,
        media_url: 'https://www.testagram.site/tsocial-logo.png',
        media_type: 'image',
        caption: newStreak === 7
          ? '🏆 I just hit a 7-day MAX streak on Testagram! 🔥 Keep going! #DailyStreak #Milestone'
          : `🔥 Day ${newStreak} streak milestone unlocked on Testagram! Come join me! #DailyStreak`,
      }).catch(() => {});
      toast.success(`+${creditsEarned} credits! ${milestoneMsg}`, { duration: 4500 });
    } else {
      toast.success(`+${creditsEarned} credits earned! Day ${newStreak} streak!`);
    }
    await fetchData();
    setClaiming(false);
  };

  if (!user) return null;

  const streakDay = reward?.streak_day ?? 0;
  const nextRewardDay = canClaim
    ? (reward ? Math.min(streakDay + 1, 7) : 1)
    : streakDay;
  const nextCredits = DAY_REWARDS[(nextRewardDay - 1)] ?? 10;

  return (
    <div className="min-h-screen bg-background pb-20 md:pb-0">
      <TopBar title="Daily Rewards" showBack />
      <DailyRewardsAdBanner />

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      ) : (
        <div className="max-w-lg mx-auto p-4 space-y-5">

          {/* Hero card */}
          <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-orange-500/20 via-amber-500/10 to-yellow-500/5 border border-orange-500/20 p-6 text-center">
            <div className="absolute inset-0 opacity-5 pointer-events-none select-none text-[120px] leading-none flex items-center justify-center">🔥</div>
            <Flame className="w-14 h-14 text-orange-500 mx-auto mb-3 drop-shadow-sm" />
            <p className="text-sm text-muted-foreground mb-1">Current Streak</p>
            <p className="text-6xl font-black tracking-tight text-foreground">{streakDay}</p>
            <p className="text-sm font-medium text-muted-foreground mt-1">
              {streakDay === 0 ? 'Start your streak today!' : streakDay === 7 ? 'Max streak reached! 🏆' : `${7 - streakDay} days to max streak`}
            </p>
          </div>

          {/* Wallet balance */}
          <div className="flex items-center justify-between bg-muted/50 rounded-xl px-5 py-4 border border-border">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                <Coins className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Wallet Credits</p>
                <p className="text-2xl font-bold">{formatNumber(walletCredits ?? 0)}</p>
              </div>
            </div>
            <Button variant="ghost" size="sm" onClick={() => navigate('/wallet')} className="text-primary text-xs">
              View Wallet
            </Button>
          </div>

          {/* 7-Day Calendar */}
          <div className="bg-muted/50 rounded-2xl border border-border p-5">
            <h3 className="font-bold mb-4 flex items-center gap-2">
              <Calendar className="w-5 h-5 text-primary" />
              Weekly Streak Calendar
            </h3>
            <div className="grid grid-cols-7 gap-2">
              {DAY_REWARDS.map((credits, i) => {
                const dayNum = i + 1;
                const isPast = dayNum < streakDay;
                const isCurrent = dayNum === streakDay;
                const isNext = dayNum === nextRewardDay && canClaim;
                const isFuture = dayNum > streakDay + (canClaim ? 0 : 0) && !isNext;

                return (
                  <div
                    key={i}
                    className={`flex flex-col items-center gap-1 p-2 rounded-xl transition-all ${
                      isCurrent
                        ? 'bg-primary text-primary-foreground shadow-md shadow-primary/25 scale-105'
                        : isNext
                        ? 'bg-primary/20 border-2 border-primary/50 ring-2 ring-primary/20'
                        : isPast
                        ? 'bg-green-500/10 border border-green-500/20'
                        : 'bg-background border border-border opacity-50'
                    }`}
                  >
                    <span className="text-[10px] font-medium">{DAY_LABELS[i]}</span>
                    <div className={`text-base ${isPast ? 'text-green-500' : isCurrent ? 'text-primary-foreground' : 'text-muted-foreground'}`}>
                      {isPast ? '✓' : isCurrent ? '🔥' : isNext ? '🎁' : dayNum === 7 ? '🏆' : `${credits}`}
                    </div>
                    <span className={`text-[9px] font-semibold ${isCurrent ? 'text-primary-foreground/80' : 'text-muted-foreground'}`}>
                      +{credits}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Claim button */}
          {canClaim ? (
            <div className="rounded-2xl bg-gradient-to-br from-primary/10 to-primary/5 border border-primary/20 p-5 flex flex-col items-center gap-3">
              <div className="flex items-center gap-2">
                <Gift className="w-5 h-5 text-primary" />
                <p className="font-semibold">
                  Day {nextRewardDay} Reward Available!
                </p>
              </div>
              <p className="text-3xl font-black text-primary">+{nextCredits} Credits</p>
              <Button
                onClick={handleClaim}
                disabled={claiming}
                size="lg"
                className="w-full rounded-xl h-12 text-base font-bold shadow-lg shadow-primary/20"
              >
                {claiming ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <>
                    <Zap className="w-5 h-5 mr-2" />
                    Claim Reward
                  </>
                )}
              </Button>
            </div>
          ) : (
            <div className="rounded-2xl bg-muted/50 border border-border p-5 flex flex-col items-center gap-2">
              <Trophy className="w-8 h-8 text-muted-foreground" />
              <p className="font-semibold">Already claimed today!</p>
              <p className="text-sm text-muted-foreground">Come back in <span className="font-bold text-foreground">{nextClaimIn}</span></p>
              <div className="w-full mt-2 bg-muted rounded-full h-2 overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full transition-all"
                  style={{
                    width: (() => {
                      const now = new Date();
                      const startOfDay = new Date(); startOfDay.setHours(0,0,0,0);
                      const endOfDay = new Date(); endOfDay.setHours(24,0,0,0);
                      const pct = ((now.getTime() - startOfDay.getTime()) / (endOfDay.getTime() - startOfDay.getTime())) * 100;
                      return `${Math.min(pct, 100)}%`;
                    })()
                  }}
                />
              </div>
            </div>
          )}

          {/* Streak tips */}
          <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Streak Tips</p>
            <ul className="text-sm text-muted-foreground space-y-1.5">
              <li className="flex items-center gap-2"><Flame className="w-3.5 h-3.5 text-orange-400 shrink-0" /> Claim every day to keep your streak alive</li>
              <li className="flex items-center gap-2"><Trophy className="w-3.5 h-3.5 text-yellow-400 shrink-0" /> Day 7 gives you the max reward: <strong className="text-foreground">50 credits</strong></li>
              <li className="flex items-center gap-2"><Coins className="w-3.5 h-3.5 text-primary shrink-0" /> Use credits to boost posts, unlock features, and more</li>
            </ul>
          </div>

        </div>
      )}
    </div>
  );
}
