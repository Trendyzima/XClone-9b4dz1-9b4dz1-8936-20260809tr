import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSEO } from '@/hooks/useSEO';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { TopBar } from '@/components/layout/TopBar';
import { PageAdBanner } from '@/components/features/AdSenseAd';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  ArrowUpRight, BarChart3, CalendarDays, CheckCircle2, ChevronRight,
  Clock3, Coins, Flame, Gift, History, Loader2, Play, RefreshCw,
  ShieldCheck, Sparkles, WalletCards,
} from 'lucide-react';
import { format, isToday } from 'date-fns';

const MAX_ADS_PER_DAY = 10;
const BASE_CREDITS = 25;
const STREAK_BONUS = 15;

type RewardEvent = {
  id: string;
  reward_type: string;
  amount_minor: number;
  currency: string;
  source: string;
  created_at: string;
};

type DailyReward = {
  streak_day: number;
  last_claimed_at: string | null;
};

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message;
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message) return message;
  }
  return fallback;
}

function makeIdempotencyKey() {
  return 'rewarded-ad-' + crypto.randomUUID();
}

function showRewardedContent(): Promise<boolean> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.style.cssText =
      'position:fixed;inset:0;z-index:99999;background:rgba(8,10,18,.96);display:flex;align-items:center;justify-content:center;padding:20px;font-family:system-ui,sans-serif;color:white;';
    let remaining = 6;
    overlay.innerHTML = `
      <div style="width:min(420px,100%);border:1px solid rgba(255,255,255,.12);border-radius:24px;background:#111522;padding:22px;box-shadow:0 24px 80px rgba(0,0,0,.45)">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:18px">
          <div style="width:46px;height:46px;border-radius:15px;background:linear-gradient(135deg,#6366f1,#8b5cf6);display:grid;place-items:center;font-size:23px">🎁</div>
          <div><div style="font-size:16px;font-weight:800">Rewarded content</div><div style="font-size:12px;color:#9ca3af">Stay here until the reward becomes available</div></div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:18px">
          <div style="border:1px solid rgba(255,255,255,.08);border-radius:14px;padding:13px;text-align:center;background:rgba(255,255,255,.03)">
            <div style="font-size:20px">🪙</div><strong style="font-size:17px">+25</strong><div style="font-size:10px;color:#9ca3af">credits</div>
          </div>
          <div style="border:1px solid rgba(255,255,255,.08);border-radius:14px;padding:13px;text-align:center;background:rgba(255,255,255,.03)">
            <div style="font-size:20px">🔥</div><strong style="font-size:17px">+15</strong><div style="font-size:10px;color:#9ca3af">3rd-session bonus</div>
          </div>
        </div>
        <div id="reward-countdown" style="text-align:center;color:#a5b4fc;font-size:13px;font-weight:700;margin-bottom:14px">Reward available in ${remaining}s</div>
        <button id="reward-claim" disabled style="width:100%;height:48px;border:0;border-radius:14px;background:linear-gradient(135deg,#6366f1,#8b5cf6);color:white;font-weight:800;opacity:.45;cursor:not-allowed">Collect reward</button>
        <div style="font-size:10px;color:#6b7280;text-align:center;margin-top:10px">Up to 10 rewarded sessions per day</div>
      </div>`;
    document.body.appendChild(overlay);

    const timer = overlay.querySelector('#reward-countdown') as HTMLElement | null;
    const button = overlay.querySelector('#reward-claim') as HTMLButtonElement | null;
    const interval = window.setInterval(() => {
      remaining -= 1;
      if (timer) timer.textContent = remaining > 0 ? 'Reward available in ' + remaining + 's' : 'Reward is ready';
      if (remaining <= 0) {
        window.clearInterval(interval);
        if (button) {
          button.disabled = false;
          button.style.opacity = '1';
          button.style.cursor = 'pointer';
        }
      }
    }, 1000);

    button?.addEventListener('click', () => {
      window.clearInterval(interval);
      overlay.remove();
      resolve(true);
    });
  });
}

export default function RewardedAdHistory() {
  useSEO({ noindex: true, title: 'Rewards & Earnings', url: '/rewards' });
  const { user } = useAuth();
  const navigate = useNavigate();

  const [events, setEvents] = useState<RewardEvent[]>([]);
  const [walletCredits, setWalletCredits] = useState(0);
  const [dailyReward, setDailyReward] = useState<DailyReward | null>(null);
  const [loading, setLoading] = useState(true);
  const [watching, setWatching] = useState(false);

  const loadData = useCallback(async () => {
    if (!user) return;
    setLoading(true);

    const [eventsRes, walletRes, dailyRes] = await Promise.all([
      supabase.from('reward_events')
        .select('id,reward_type,amount_minor,currency,source,created_at')
        .eq('user_id', user.id)
        .eq('source', 'rewarded_ads')
        .order('created_at', { ascending: false })
        .limit(100),
      supabase.from('user_wallets').select('credits').eq('user_id', user.id).maybeSingle(),
      supabase.from('daily_rewards').select('streak_day,last_claimed_at').eq('user_id', user.id).maybeSingle(),
    ]);

    if (eventsRes.error) throw eventsRes.error;
    if (walletRes.error) throw walletRes.error;
    if (dailyRes.error) throw dailyRes.error;

    setEvents((eventsRes.data ?? []) as RewardEvent[]);
    setWalletCredits(Number(walletRes.data?.credits ?? 0));
    setDailyReward((dailyRes.data ?? null) as DailyReward | null);
    setLoading(false);
  }, [user?.id]);

  useEffect(() => {
    if (!user) {
      navigate('/auth');
      return;
    }
    void loadData().catch((error) => {
      console.error('[Rewards] load failed', error);
      toast.error(getErrorMessage(error, 'Could not load rewards'));
      setLoading(false);
    });
  }, [user?.id, loadData, navigate]);

  const todayEvents = useMemo(() => events.filter((event) => isToday(new Date(event.created_at))), [events]);
  const todayCredits = useMemo(() => todayEvents.reduce((sum, event) => sum + Number(event.amount_minor || 0), 0), [todayEvents]);
  const adCreditsLifetime = useMemo(() => events.reduce((sum, event) => sum + Number(event.amount_minor || 0), 0), [events]);
  const adsRemaining = Math.max(0, MAX_ADS_PER_DAY - todayEvents.length);
  const progress = Math.min(100, Math.round((todayEvents.length / MAX_ADS_PER_DAY) * 100));
  const adStreak = todayEvents.length;
  const nextReward = todayEvents.length >= 2 ? BASE_CREDITS + STREAK_BONUS : BASE_CREDITS;

  const handleWatchAd = async () => {
    if (!user || watching || adsRemaining <= 0) return;
    setWatching(true);
    try {
      const completed = await showRewardedContent();
      if (!completed) return;

      const { data, error } = await supabase.rpc('claim_rewarded_ad', {
        p_idempotency_key: makeIdempotencyKey(),
      });
      if (error) throw error;

      const result = Array.isArray(data) ? data[0] : data;
      const earned = Number(result?.credits_earned ?? nextReward);
      setWalletCredits(Number(result?.wallet_credits ?? walletCredits + earned));

      toast.success('+' + earned + ' credits added', {
        description: earned > BASE_CREDITS ? '3-session streak bonus included.' : 'Keep going to unlock the streak bonus.',
      });

      await loadData();
    } catch (error) {
      const message = getErrorMessage(error, 'Could not process the reward');
      if (message.includes('REWARDED_AD_DAILY_LIMIT')) {
        toast.error('Daily reward limit reached');
      } else {
        console.error('[Rewards] claim failed', error);
        toast.error('Could not process the reward');
      }
    } finally {
      setWatching(false);
    }
  };

  if (!user) return null;

  if (loading) {
    return (
      <div className="min-h-screen bg-background">
        <TopBar title="Rewards" showBack />
        <div className="flex min-h-[60vh] items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-24">
      <TopBar title="Rewards & Earnings" showBack />
      <PageAdBanner />

      <main className="mx-auto w-full max-w-2xl space-y-4 px-4 py-4">
        <section className="relative overflow-hidden rounded-3xl border border-primary/20 bg-gradient-to-br from-primary/15 via-background to-purple-500/10 p-5">
          <div className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-primary/15 blur-3xl" />
          <div className="relative">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Available credits</p>
                <div className="mt-1 flex items-center gap-2"><Coins className="h-6 w-6 text-amber-500" /><span className="text-4xl font-black tracking-tight">{walletCredits.toLocaleString()}</span></div>
              </div>
              <button onClick={() => navigate('/wallet')} className="rounded-xl border border-border bg-background/80 px-3 py-2 text-xs font-bold hover:bg-muted">Wallet</button>
            </div>
            <div className="mt-5 grid grid-cols-3 gap-2">
              <div className="rounded-2xl border border-border/70 bg-background/60 p-3"><p className="text-[10px] text-muted-foreground">Ads today</p><p className="mt-1 text-xl font-black">{todayEvents.length}/{MAX_ADS_PER_DAY}</p></div>
              <div className="rounded-2xl border border-border/70 bg-background/60 p-3"><p className="text-[10px] text-muted-foreground">Ad credits</p><p className="mt-1 text-xl font-black">{adCreditsLifetime.toLocaleString()}</p></div>
              <div className="rounded-2xl border border-border/70 bg-background/60 p-3"><p className="text-[10px] text-muted-foreground">Ad streak</p><p className="mt-1 text-xl font-black">{adStreak}<span className="text-sm">🔥</span></p></div>
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-border bg-card p-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2"><BarChart3 className="h-4 w-4 text-primary" /><span className="text-sm font-bold">Today's rewarded sessions</span></div>
            <span className="text-xs font-semibold text-muted-foreground">{adsRemaining} left</span>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary transition-all duration-500" style={{ width: progress + '%' }} /></div>
          <div className="mt-3 flex items-center justify-between text-[10px] text-muted-foreground"><span>{todayCredits} credits earned today</span><span className="font-semibold text-amber-500">3rd session: +{STREAK_BONUS} bonus</span></div>
        </section>

        <section className="overflow-hidden rounded-3xl border border-primary/20 bg-card">
          <div className="border-b border-border bg-gradient-to-r from-primary/10 via-purple-500/10 to-transparent p-5">
            <div className="flex items-start gap-3">
              <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/20"><Gift className="h-6 w-6" /></div>
              <div className="min-w-0">
                <div className="flex items-center gap-2"><h2 className="text-lg font-black">Watch & earn</h2><Sparkles className="h-4 w-4 text-amber-500" /></div>
                <p className="mt-1 text-sm text-muted-foreground">Earn Testagram credits through opt-in rewarded content.</p>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 p-5">
            <div className="rounded-2xl border border-border bg-muted/30 p-4"><Coins className="h-5 w-5 text-amber-500" /><p className="mt-2 text-xl font-black">+{BASE_CREDITS}</p><p className="text-xs text-muted-foreground">credits per session</p></div>
            <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4"><Flame className="h-5 w-5 text-orange-500" /><p className="mt-2 text-xl font-black">+{STREAK_BONUS}</p><p className="text-xs text-muted-foreground">from the 3rd session onward</p></div>
          </div>
          <div className="px-5 pb-5">
            <Button onClick={handleWatchAd} disabled={watching || adsRemaining === 0} className="h-12 w-full rounded-xl text-sm font-black">
              {watching ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Loading rewarded content…</> : adsRemaining === 0 ? <><ShieldCheck className="mr-2 h-4 w-4" />Daily limit reached</> : <><Play className="mr-2 h-4 w-4" />Watch & earn +{nextReward}</>}
            </Button>
            <p className="mt-2 text-center text-[10px] text-muted-foreground">{adsRemaining === 0 ? 'Your limit resets with the next UTC day.' : adsRemaining + ' rewarded sessions remaining today'}</p>
          </div>
        </section>

        <button onClick={() => navigate('/daily-rewards')} className="flex w-full items-center gap-3 rounded-2xl border border-border bg-card p-4 text-left transition-colors hover:bg-muted/40">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-orange-500/10"><CalendarDays className="h-5 w-5 text-orange-500" /></div>
          <div className="min-w-0 flex-1"><p className="text-sm font-bold">Daily check-in rewards</p><p className="mt-0.5 text-xs text-muted-foreground">{dailyReward?.streak_day ? dailyReward.streak_day + '-day streak · keep it going' : 'Claim your first daily reward'}</p></div>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </button>

        <section className="rounded-2xl border border-border bg-muted/20 p-4">
          <div className="flex items-start gap-3"><WalletCards className="mt-0.5 h-5 w-5 shrink-0 text-primary" /><div><h3 className="text-sm font-bold">About earnings</h3><p className="mt-1 text-xs leading-5 text-muted-foreground">Your Testagram credit balance is tracked here. Cash revenue is shown only when a supported ad-monetization source reports verified earnings; no estimated cash value is added to your balance.</p></div></div>
        </section>

        <section>
          <div className="mb-3 flex items-center gap-2"><History className="h-5 w-5 text-muted-foreground" /><h3 className="font-bold">Reward history</h3><button onClick={() => void loadData()} className="ml-auto rounded-full p-2 hover:bg-muted" aria-label="Refresh rewards"><RefreshCw className="h-4 w-4 text-muted-foreground" /></button></div>
          {events.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border px-5 py-12 text-center"><Gift className="mx-auto h-10 w-10 text-muted-foreground/40" /><p className="mt-3 text-sm font-bold">No rewarded sessions yet</p><p className="mt-1 text-xs text-muted-foreground">Your rewarded activity will appear here.</p></div>
          ) : (
            <div className="space-y-2">
              {events.map((event) => (
                <div key={event.id} className="flex items-center gap-3 rounded-2xl border border-border bg-card p-3.5">
                  <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/10"><CheckCircle2 className="h-4 w-4 text-primary" /></div>
                  <div className="min-w-0 flex-1"><p className="truncate text-sm font-bold">Rewarded content</p><p className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground"><Clock3 className="h-3 w-3" />{format(new Date(event.created_at), 'MMM d, h:mm a')}</p></div>
                  <div className="text-right"><p className="text-sm font-black text-primary">+{Number(event.amount_minor).toLocaleString()}</p><p className="text-[10px] text-muted-foreground">{event.currency}</p></div>
                </div>
              ))}
            </div>
          )}
        </section>

        <button onClick={() => navigate('/wallet')} className="flex w-full items-center justify-between rounded-2xl border border-border bg-card p-4 text-left hover:bg-muted/40">
          <div><p className="text-sm font-bold">Manage your credits</p><p className="mt-0.5 text-xs text-muted-foreground">Open your Testagram wallet and transaction history.</p></div>
          <ArrowUpRight className="h-5 w-5 text-primary" />
        </button>

        <div className="flex items-center justify-center gap-1.5 pb-2 text-[10px] text-muted-foreground"><ShieldCheck className="h-3 w-3" />Rewards are subject to Testagram's content and monetization policies.</div>
      </main>
    </div>
  );
}
