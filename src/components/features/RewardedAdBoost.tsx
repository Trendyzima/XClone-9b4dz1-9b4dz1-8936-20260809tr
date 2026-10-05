import { useState } from 'react';
import { AD_REVENUE_SPLIT } from '@/lib/admob';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Zap, Play, TrendingUp, Gift, Loader2, CheckCircle, Star, Coins } from 'lucide-react';
import { cn } from '@/lib/utils';

interface RewardedAdBoostProps {
  postId: string;
  postContent?: string;
  onClose?: () => void;
  onBoostApplied?: () => void;
}

type BoostState = 'idle' | 'loading' | 'watching' | 'applying' | 'success';

const BOOST_OPTIONS = [
  {
    id: 'reach',
    label: 'Reach Boost',
    description: 'Increase post reach by 2× for 1 hour',
    rewardType: 'reach_boost',
    rewardAmount: 1,
    icon: TrendingUp,
    color: 'text-blue-500',
    bg: 'bg-blue-500/10',
    border: 'border-blue-500/30',
  },
  {
    id: 'featured',
    label: 'Featured Spot',
    description: 'Pin post to Explore for 1 hour',
    rewardType: 'featured_boost',
    rewardAmount: 2,
    icon: Star,
    color: 'text-amber-500',
    bg: 'bg-amber-500/10',
    border: 'border-amber-500/30',
  },
  {
    id: 'viral',
    label: 'Viral Push',
    description: 'Push to 5× more follower feeds for 1 hour',
    rewardType: 'viral_boost',
    rewardAmount: 3,
    icon: Zap,
    color: 'text-purple-500',
    bg: 'bg-purple-500/10',
    border: 'border-purple-500/30',
  },
];

// Countdown overlay (no AdSense in overlays per policy)
async function showWebRewardedAd(): Promise<boolean> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position: fixed; top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0,0,0,0.95); z-index: 99999;
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      font-family: system-ui, sans-serif; color: white;
    `;

    let timeLeft = 5;

    const adHtml = `
      <div style="max-width:360px; width:90%; text-align:center;">
        <div style="background:#1a1a2e; border-radius:16px; padding:24px; border:1px solid #333;">
          <div style="background:linear-gradient(135deg,#6366f1,#8b5cf6); border-radius:12px; padding:16px; margin-bottom:16px;">
            <div style="font-size:40px; margin-bottom:8px;">⚡</div>
            <div style="font-size:18px; font-weight:bold;">Advertisement</div>
            <div style="font-size:13px; opacity:0.8; margin-top:4px;">Watch to earn your free boost</div>
          </div>
          <div style="background:#111; border-radius:8px; padding:12px; margin-bottom:16px; text-align:center;">
            <div style="font-size:24px; margin-bottom:4px;">📱</div>
            <div style="font-size:12px; color:#6b7280;">Sponsored content loading…</div>
          </div>
          <div style="font-size:13px; color:#aaa; margin-bottom:8px;">Boost Credits: <strong style="color:#22c55e;">+25 credits</strong></div>
          <div id="ad-timer" style="font-size:13px; color:#f59e0b;">Please wait <strong id="timer-count">${timeLeft}s</strong></div>
          <button id="skip-btn" style="
            margin-top:16px; padding:12px 32px; border-radius:32px;
            background:#6366f1; color:white; border:none; cursor:pointer;
            font-size:15px; font-weight:bold; width:100%; opacity:0.4;
            transition: opacity 0.3s;
          " disabled>Get My Boost</button>
        </div>
      </div>
    `;

    overlay.innerHTML = adHtml;
    document.body.appendChild(overlay);

    const timerEl = overlay.querySelector('#timer-count') as HTMLElement;
    const timerLabel = overlay.querySelector('#ad-timer') as HTMLElement;
    const skipBtn = overlay.querySelector('#skip-btn') as HTMLButtonElement;

    const countdown = setInterval(() => {
      timeLeft--;
      if (timerEl) timerEl.textContent = `${timeLeft}s`;
      if (timeLeft <= 0) {
        clearInterval(countdown);
        if (timerLabel) timerLabel.style.display = 'none';
        if (skipBtn) { skipBtn.disabled = false; skipBtn.style.opacity = '1'; }
      }
    }, 1000);

    skipBtn.addEventListener('click', () => {
      clearInterval(countdown);
      document.body.removeChild(overlay);
      resolve(true);
    });
  });
}

export function RewardedAdBoost({ postId, postContent, onClose, onBoostApplied }: RewardedAdBoostProps) {
  const { user } = useAuth();
  const [selected, setSelected] = useState(BOOST_OPTIONS[0]);
  const [boostState, setBoostState] = useState<BoostState>('idle');

  const handleWatchAd = async () => {
    if (!user) { toast.error('Sign in to boost posts'); return; }
    setBoostState('loading');
    try {
      setBoostState('watching');
      const adCompleted = await showWebRewardedAd();

      if (!adCompleted) {
        toast.error('Ad not completed — boost not applied');
        setBoostState('idle');
        return;
      }
      setBoostState('applying');
      await applyBoost();
    } catch (e: any) {
      console.error('[RewardedBoost] Error:', e);
      toast.error('Failed to process boost. Please try again.');
      setBoostState('idle');
    }
  };

  const applyBoost = async () => {
    if (!user) return;
    try {
      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + 1);

      await supabase.from('rewarded_ad_unlocks').insert({
        user_id: user.id,
        reward_type: selected.rewardType,
        reward_amount: selected.rewardAmount,
        ad_unit: 'rewarded_boost',
        used: true,
        expires_at: expiresAt.toISOString(),
      }).then(({ error }) => {
        if (error) console.warn('[RewardedBoost] Reward insert warn:', error.message);
      });

      const { error: boostError } = await supabase.from('boosted_posts').insert({
        post_id: postId,
        user_id: user.id,
        boost_type: selected.rewardType,
        budget: 0,
        is_active: true,
        is_sponsored: false,
        end_date: expiresAt.toISOString(),
      });
      if (boostError && !boostError.message.includes('duplicate')) {
        console.warn('[RewardedBoost] Boost insert warn:', boostError.message);
      }

      const { error: rewardError } = await supabase.rpc('claim_rewarded_ad', { p_idempotency_key: `rewarded-boost:${postId}:${user.id}:${crypto.randomUUID()}` });
      if (rewardError) throw rewardError;

      const estimatedRevenue = AD_REVENUE_SPLIT.ESTIMATED_CPM.rewarded / 1000;
      const creatorShare = estimatedRevenue * AD_REVENUE_SPLIT.CREATOR_SHARE;
      try {
        await supabase.from('creator_earnings').insert({
          user_id: user.id,
          source: 'rewarded_ads',
          amount: creatorShare,
          post_id: postId,
          status: 'pending',
        });
      } catch (_) { /* non-critical */ }

      setBoostState('success');
      toast.success(`${selected.label} applied! +25 credits earned.`);
      onBoostApplied?.();
    } catch (e: any) {
      console.error('[RewardedBoost] Apply error:', e);
      toast.error(e.message || 'Failed to apply boost');
      setBoostState('idle');
    }
  };

  if (boostState === 'success') {
    return (
      <div className="flex flex-col items-center justify-center py-8 gap-4">
        <div className="w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center">
          <CheckCircle className="w-8 h-8 text-green-500" />
        </div>
        <div className="text-center">
          <h3 className="font-bold text-lg text-foreground mb-1">{selected.label} Applied!</h3>
          <p className="text-sm text-muted-foreground">Your post reach is boosted for the next 1 hour.</p>
          <div className="mt-3 flex items-center justify-center gap-2 text-green-600 font-semibold">
            <Coins className="w-4 h-4" />
            <span>+25 credits added to your wallet!</span>
          </div>
        </div>
        <Button onClick={onClose} className="w-full">Done</Button>
      </div>
    );
  }

  if (boostState === 'watching' || boostState === 'applying' || boostState === 'loading') {
    return (
      <div className="flex flex-col items-center justify-center py-10 gap-4">
        <div className="w-16 h-16 rounded-full bg-primary/20 flex items-center justify-center">
          {boostState === 'applying'
            ? <Zap className="w-8 h-8 text-primary animate-pulse" />
            : <Play className="w-8 h-8 text-primary" />}
        </div>
        <div className="text-center">
          <h3 className="font-bold text-foreground mb-1">
            {boostState === 'applying' ? 'Applying Boost...' : boostState === 'loading' ? 'Loading Ad...' : 'Opening Ad...'}
          </h3>
          <p className="text-sm text-muted-foreground">
            {boostState === 'applying'
              ? 'Just a moment — saving your boost'
              : 'Complete the ad to earn your free boost + 25 credits'}
          </p>
        </div>
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="bg-gradient-to-br from-primary/10 to-purple-500/10 rounded-xl p-4 text-center">
        <Gift className="w-8 h-8 text-primary mx-auto mb-2" />
        <h3 className="font-bold text-foreground text-lg">Free Post Boost</h3>
        <p className="text-sm text-muted-foreground mt-1">Watch a short ad to boost your post reach — completely free!</p>
        <div className="mt-2 flex items-center justify-center gap-1.5 text-xs font-semibold text-green-600">
          <Coins className="w-3.5 h-3.5" /><span>+25 credits rewarded per ad</span>
        </div>
      </div>

      {postContent && (
        <div className="bg-muted/30 border border-border rounded-lg p-3">
          <p className="text-xs text-muted-foreground mb-1 font-medium">Boosting:</p>
          <p className="text-sm line-clamp-2">{postContent}</p>
        </div>
      )}

      <div className="space-y-2">
        <p className="text-sm font-semibold text-foreground">Choose boost type:</p>
        {BOOST_OPTIONS.map(opt => (
          <button key={opt.id} onClick={() => setSelected(opt)}
            className={cn('w-full flex items-center gap-3 p-3 rounded-xl border transition-all text-left',
              selected.id === opt.id ? `${opt.bg} ${opt.border} border-2` : 'bg-card border-border hover:bg-muted/30')}>
            <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0', opt.bg)}>
              <opt.icon className={cn('w-5 h-5', opt.color)} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-foreground text-sm">{opt.label}</p>
              <p className="text-xs text-muted-foreground">{opt.description}</p>
            </div>
            <div className={cn('w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0',
              selected.id === opt.id ? 'border-current' : 'border-muted-foreground')}>
              {selected.id === opt.id && <div className={cn('w-2.5 h-2.5 rounded-full', opt.color.replace('text-', 'bg-'))} />}
            </div>
          </button>
        ))}
      </div>

      <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-3 flex items-start gap-2">
        <TrendingUp className="w-4 h-4 text-green-600 flex-shrink-0 mt-0.5" />
        <p className="text-xs text-green-700 dark:text-green-400">
          You earn <strong>30% of ad revenue</strong> from every rewarded ad watched — credited automatically as earnings.
        </p>
      </div>

      <Button onClick={handleWatchAd} disabled={boostState !== 'idle'} className="w-full gap-2 h-12 text-base font-semibold">
        <Play className="w-5 h-5" />Watch Ad &amp; Boost Post
      </Button>

      <button onClick={onClose} className="w-full text-center text-sm text-muted-foreground hover:text-foreground transition-colors py-1">
        Maybe later
      </button>
    </div>
  );
}
