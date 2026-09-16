
import { Button } from '@/components/ui/button';
import { useState, useEffect, useRef } from 'react';
import { useSEO } from '@/hooks/useSEO';
import { useAuth } from '@/hooks/useAuth';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { TopBar } from '@/components/layout/TopBar';
import {
  DollarSign, TrendingUp, Users, BarChart3,
  Loader2, ExternalLink, Lock, CheckCircle2, XCircle, Star,
  Coins, Gift, Zap, Play, Trophy, ArrowRight, RefreshCw
} from 'lucide-react';
import { toast } from 'sonner';
import CreatorMonetizationHub, { VideoRevenueRateCard } from '@/components/features/CreatorMonetizationHub';
import { formatNumber } from '@/lib/utils';
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, PieChart, Pie, Cell
} from 'recharts';

// ── AdSense banner ───────────────────────────────────────────────────────────
import { PageAdBanner } from '@/components/features/AdSenseAd';
function MonetizationAdBanner() { return <PageAdBanner />; }
const MON_MIN_FOLLOWERS = 500;
const MON_MIN_POSTS     = 3000;
const MON_MIN_VIDEOS    = 100;

const CREDIT_PACKAGES = [
  { credits: 500,   price: 4.99,  label: 'Starter', color: 'from-blue-500 to-cyan-500',     popular: false },
  { credits: 2500,  price: 9.99,  label: 'Pro',     color: 'from-purple-500 to-pink-500',    popular: true  },
  { credits: 10000, price: 19.99, label: 'Creator', color: 'from-yellow-500 to-orange-500',  popular: false },
];

const CREDIT_COSTS = {
  'AI Reply': 1, 'AI Image': 5, 'AI Video': 20,
  'Profile Boost': 10, 'Post Promotion': 50, 'Verification': 50,
} as const;

// esbuild guard: module-level creator tier config — no inline objects in render
const CREATOR_TIERS = [
  { key: 'free',    label: 'Free',    emoji: '\uD83C\uDF31', cpm: 0,    followerThreshold: 0,    videoThreshold: 0,   color: 'text-muted-foreground',   bg: 'bg-muted/30 border-border'  },
  { key: 'bronze',  label: 'Bronze',  emoji: '\uD83E\uDD49', cpm: 1.50, followerThreshold: 500,  videoThreshold: 10,  color: 'text-amber-700',          bg: 'bg-amber-700/10 border-amber-700/30'  },
  { key: 'silver',  label: 'Silver',  emoji: '\uD83E\uDD48', cpm: 2.50, followerThreshold: 5000, videoThreshold: 50,  color: 'text-slate-500',          bg: 'bg-slate-400/10 border-slate-400/30'  },
  { key: 'gold',    label: 'Gold',    emoji: '\uD83E\uDD47', cpm: 3.50, followerThreshold: 50000,videoThreshold: 200, color: 'text-amber-500',          bg: 'bg-amber-500/10 border-amber-500/30'  },
];

// esbuild guard: module-level helper — get tier index from tier key string
function getTierIdx(key: string): number {
  const idx = CREATOR_TIERS.findIndex(t => t.key === key);
  return idx >= 0 ? idx : 0;
}

// esbuild guard: module-level helper — format CPM string
function fmtCpm(cpm: number): string {
  return cpm > 0 ? `$${cpm.toFixed(2)}/1K views` : 'Not eligible';
}

export function MonetizationDashboard() {
  const { user } = useAuth();
  useSEO({ noindex: true, title: 'Monetization', url: '/monetization' });
  const navigate = useNavigate();

  const [postCount, setPostCount]   = useState(0);
  const [videoCount, setVideoCount] = useState(0);
  const [stats, setStats] = useState({
    totalEarnings: 0, videoRevenue: 0, subscriptions: 0,
    tips: 0, videoViews: 0, productSales: 0, rewardedAdEarnings: 0,
  });
  // esbuild guard: no explicit generic annotations on useState
  const [earnings, setEarnings]   = useState([]);
  const [chartData, setChartData] = useState([]);
  const [monthlyChartData, setMonthlyChartData] = useState([]);
  const [sourceChartData, setSourceChartData] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [monetizationStatus, setMonetizationStatus] = useState(null);
  const [userProfile, setUserProfile]   = useState(null);
  const [walletData, setWalletData]     = useState(null);
  const [credits, setCredits]           = useState(0);
  const [dailyReward, setDailyReward]   = useState(null);
  const [claimingReward, setClaimingReward] = useState(false);
  const [activeTab, setActiveTab] = useState('overview');
  const [mentionChartData, setMentionChartData] = useState([]);
  const [mentionTotal, setMentionTotal] = useState(0);
  const [rateInfo, setRateInfo] = useState(null);

  // ── Earnings Milestone Alerts ──────────────────────────────────────────────
  const MILESTONES = [1, 10, 50, 100, 500, 1000];
  const checkMilestones = (total: number) => {
    const alerted = JSON.parse(localStorage.getItem('earnings_milestones_alerted') || '[]') as number[];
    for (const m of MILESTONES) {
      if (total >= m && !alerted.includes(m)) {
        toast.success(`🎉 Milestone reached: $${m} earned!`, { duration: 6000, description: 'Keep creating amazing content!' });
        alerted.push(m);
      }
    }
    localStorage.setItem('earnings_milestones_alerted', JSON.stringify(alerted));
  };

  useEffect(() => {
    if (!user) { navigate('/auth'); return; }
    fetchAll();
  }, [user]);

  const fetchAll = async () => {
    if (!user) return;
    try {
      const [monRes, profileRes, earningsRes, subsRes, tipsRes, videosRes, walletRes, dailyRes, postCountRes, videoCountRes, rateRes] = await Promise.all([
        supabase.from('user_monetization').select('*').eq('user_id', user.id).maybeSingle(),
        supabase.from('profiles').select('subscriber_count, follower_count, is_creator, can_monetize').eq('id', user.id).single(),
        supabase.from('creator_earnings').select('*').eq('user_id', user.id).order('created_at', { ascending: false }),
        supabase.from('creator_subscriptions').select('*').eq('creator_id', user.id).eq('status', 'active'),
        supabase.from('tips').select('*').eq('to_user_id', user.id),
        supabase.from('posts').select('views_count').eq('user_id', user.id).eq('is_video', true),
        supabase.from('user_wallets').select('*').eq('user_id', user.id).maybeSingle(),
        supabase.from('daily_rewards').select('*').eq('user_id', user.id).maybeSingle(),
        supabase.from('posts').select('*', { count: 'exact', head: true }).eq('user_id', user.id),
        supabase.from('posts').select('*', { count: 'exact', head: true }).eq('user_id', user.id).eq('is_video', true),
        supabase.from('video_revenue_rates').select('*').eq('user_id', user.id).maybeSingle(),
      ]);

      setMonetizationStatus(monRes.data);
      setUserProfile(profileRes.data);
      setWalletData(walletRes.data);
      setCredits(walletRes.data?.credits || 0);
      setDailyReward(dailyRes.data);
      setPostCount(postCountRes.count ?? 0);
      setVideoCount(videoCountRes.count ?? 0);
      setRateInfo(rateRes.data);

      // Build 30-day mention analytics
      const thirtyDaysAgo = new Date(); thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 29);
      const { data: mentionRows } = await supabase
        .from('notifications')
        .select('created_at')
        .eq('user_id', user.id)
        .eq('type', 'mention')
        .gte('created_at', thirtyDaysAgo.toISOString());
      const last30 = Array.from({ length: 30 }, (_, i) => {
        const d = new Date(); d.setDate(d.getDate() - (29 - i)); return d.toISOString().split('T')[0];
      });
      const mentionByDay: { [k: string]: number } = {};
      last30.forEach(d => { mentionByDay[d] = 0; });
      (mentionRows ?? []).forEach((r: any) => {
        const day = r.created_at?.split('T')[0];
        if (day && mentionByDay[day] !== undefined) mentionByDay[day]++;
      });
      const mentionData = last30.map(d => ({ date: d.slice(5), count: mentionByDay[d] }));
      setMentionChartData(mentionData);
      setMentionTotal((mentionRows ?? []).length);

      const earningsList = earningsRes.data || [];
      setEarnings(earningsList);

      // Build 7-day revenue chart
      const last7 = Array.from({ length: 7 }, (_, i) => {
        const d = new Date(); d.setDate(d.getDate() - (6 - i));
        return d.toISOString().split('T')[0];
      });
      const byDay: Record<string, number> = {};
      last7.forEach(d => { byDay[d] = 0; });
      earningsList.forEach((e: any) => {
        const day = e.created_at?.split('T')[0];
        if (day && byDay[day] !== undefined) byDay[day] += Number(e.amount);
      });
      setChartData(last7.map(d => ({
        date: d.slice(5),
        creator: parseFloat(byDay[d].toFixed(5)),
        platform: parseFloat((byDay[d] * (70 / 30)).toFixed(5)),
      })));

      // Build 6-month chart
      const months6 = Array.from({ length: 6 }, (_, i) => {
        const d = new Date(); d.setMonth(d.getMonth() - (5 - i)); d.setDate(1);
        return { key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, label: d.toLocaleDateString([], { month: 'short' }) };
      });
      const byMonth: Record<string, Record<string, number>> = {};
      months6.forEach(m => { byMonth[m.key] = { tips: 0, subscriptions: 0, video_ads: 0, product_sales: 0, other: 0 }; });
      earningsList.forEach((e: any) => {
        const mo = e.created_at?.slice(0, 7);
        if (mo && byMonth[mo]) {
          const src = ['tips', 'subscriptions', 'video_ads', 'product_sales'].includes(e.source) ? e.source : 'other';
          byMonth[mo][src] = (byMonth[mo][src] || 0) + Number(e.amount);
        }
      });
      setMonthlyChartData(months6.map(m => ({ month: m.label, ...byMonth[m.key] })));

      // Source breakdown for pie
      const srcTotals: { [src: string]: number } = {};
      earningsList.forEach((e: any) => { srcTotals[e.source] = (srcTotals[e.source] || 0) + Number(e.amount); });
      setSourceChartData(Object.entries(srcTotals).map(([name, value]) => ({ name: name.replace(/_/g, ' '), value: parseFloat(value.toFixed(4)) })));

      const total      = earningsList.reduce((s: number, e: any) => s + Number(e.amount), 0);
      const videoRev   = earningsList.filter((e: any) => e.source === 'video_ads').reduce((s: number, e: any) => s + Number(e.amount), 0);
      const productRev = earningsList.filter((e: any) => e.source === 'product_sales').reduce((s: number, e: any) => s + Number(e.amount), 0);
      const rewardedRev = earningsList.filter((e: any) => e.source === 'rewarded_ads').reduce((s: number, e: any) => s + Number(e.amount), 0);
      const subsRevenue = (subsRes.data || []).reduce((s: number, e: any) => s + Number(e.price), 0);
      const tipsRevenue = (tipsRes.data || []).reduce((s: number, e: any) => s + Number(e.amount), 0);
      const totalViews  = (videosRes.data || []).reduce((s: number, e: any) => s + (e.views_count || 0), 0);

      setStats({
        totalEarnings: total + subsRevenue + tipsRevenue,
        videoRevenue: videoRev, subscriptions: subsRevenue, tips: tipsRevenue,
        videoViews: totalViews, productSales: productRev, rewardedAdEarnings: rewardedRev,
      });
      // Fire milestone alerts after stats are computed
      checkMilestones(total + subsRevenue + tipsRevenue);
    } catch (err) {
      console.error(err);
      toast.error('Failed to load monetization data');
    } finally {
      setLoading(false);
    }
  };

  const enableMonetization = async () => {
    if (!user) return;
    const subscriberCount = userProfile?.subscriber_count || userProfile?.follower_count || 0;
    if (subscriberCount < MON_MIN_FOLLOWERS) {
      toast.error(`You need ${MON_MIN_FOLLOWERS.toLocaleString()} followers to monetize`); return;
    }
    if (postCount < MON_MIN_POSTS) {
      toast.error(`You need at least ${MON_MIN_POSTS.toLocaleString()} posts to monetize`); return;
    }
    if (videoCount < MON_MIN_VIDEOS) {
      toast.error(`You need at least ${MON_MIN_VIDEOS} videos to monetize`); return;
    }
    try {
      await supabase.from('user_monetization')
        .upsert({ user_id: user.id, is_monetized: true, eligibility_status: 'approved' }, { onConflict: 'user_id' });
      await supabase.from('profiles')
        .update({ is_creator: true, can_monetize: true, creator_tier: 'basic' }).eq('id', user.id);
      toast.success('Monetization enabled! Start earning from your content.');
      fetchAll();
    } catch (error: any) { toast.error(error.message || 'Failed to enable monetization'); }
  };

  const claimDailyReward = async () => {
    if (!user) return;
    setClaimingReward(true);
    try {
      const now = new Date();
      const lastClaimed = dailyReward?.last_claimed_at ? new Date(dailyReward.last_claimed_at) : null;
      if (lastClaimed && now.toDateString() === lastClaimed.toDateString()) {
        toast.info('Daily reward already claimed! Come back tomorrow.'); return;
      }
      const streak = dailyReward ? Math.min(dailyReward.streak_day + 1, 7) : 1;
      const creditsEarned = streak * 10;

      await supabase.from('daily_rewards').upsert({
        user_id: user.id, streak_day: streak, credits_earned: creditsEarned,
        last_claimed_at: now.toISOString(),
      }, { onConflict: 'user_id' });
      await supabase.from('user_wallets').upsert({
        user_id: user.id, credits: (walletData?.credits || 0) + creditsEarned,
      }, { onConflict: 'user_id' });
      await supabase.from('credit_transactions').insert({
        user_id: user.id, amount: creditsEarned, reason: 'daily_reward',
        metadata: { streak_day: streak },
      });
      setCredits(prev => prev + creditsEarned);
      setDailyReward({ ...dailyReward, streak_day: streak, last_claimed_at: now.toISOString() });
      toast.success(`Day ${streak} reward claimed! +${creditsEarned} credits`);
    } catch (err: any) { toast.error(err.message || 'Failed to claim reward'); }
    finally { setClaimingReward(false); }
  };

  const canClaimDaily = () => {
    if (!dailyReward?.last_claimed_at) return true;
    return new Date().toDateString() !== new Date(dailyReward.last_claimed_at).toDateString();
  };

  const handleExportEarningsPDF = () => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const monthEarnings = earnings.filter(e => e.created_at >= monthStart);

    const groups: Record<string, { rows: any[]; total: number }> = {};
    monthEarnings.forEach(e => {
      const src = e.source ?? 'other';
      if (!groups[src]) groups[src] = { rows: [], total: 0 };
      groups[src].rows.push(e);
      groups[src].total += Number(e.amount);
    });

    const grandTotal = monthEarnings.reduce((s, e) => s + Number(e.amount), 0);
    const tier  = rateInfo?.tier ?? 'standard';
    const cpm   = Number(rateInfo?.cpm_usd ?? 1.50);
    const monthLabel = now.toLocaleDateString('en', { month: 'long', year: 'numeric' });

    const w = window.open('', '_blank', 'width=720,height=940');
    if (!w) { toast.error('Please allow popups to export PDF'); return; }

    const tierEmoji: Record<string, string> = {
      top_creator: '\uD83D\uDC51', premium: '\u2B50', rising: '\uD83D\uDCC8', standard: '\uD83C\uDF31',
    };

    const srcLabel = (src: string) =>
      src.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());

    const groupsHtml = Object.entries(groups).map(([src, g]) => {
      const rowsHtml = g.rows.map((row: any) =>
        `<tr>
          <td>${new Date(row.created_at).toLocaleDateString()}</td>
          <td>${srcLabel(src)}</td>
          <td style="color:#166534;font-weight:700">+$${Number(row.amount).toFixed(4)}</td>
          <td><span class="badge ${row.status === 'completed' ? 'badge-green' : 'badge-orange'}">${row.status}</span></td>
        </tr>`
      ).join('');
      return `<tr class="group-hdr">
        <td colspan="2"><strong>${srcLabel(src)}</strong></td>
        <td colspan="2" style="text-align:right;color:#166534;font-weight:900">Subtotal: $${g.total.toFixed(4)}</td>
      </tr>${rowsHtml}`;
    }).join('');

    const tableHtml = monthEarnings.length === 0
      ? '<p style="text-align:center;color:#888;padding:40px 0">No earnings recorded for this month.</p>'
      : `<table><thead><tr><th>Date</th><th>Source</th><th>Amount</th><th>Status</th></tr></thead><tbody>${groupsHtml}<tr class="total-row"><td colspan="2">Grand Total \u2014 ${monthLabel}</td><td colspan="2">$${grandTotal.toFixed(4)}</td></tr></tbody></table>`;

    w.document.write(`<!DOCTYPE html><html><head>
<title>Earnings Statement \u2014 ${monthLabel}</title>
<meta charset="utf-8">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Arial,sans-serif;color:#111;padding:40px;max-width:700px;margin:0 auto}
h1{font-size:22px;font-weight:900;margin-bottom:4px}
.sub{font-size:13px;color:#666;margin-bottom:24px}
.tier-card{background:#f0fdf4;border:1px solid #86efac;border-radius:12px;padding:16px 20px;margin-bottom:24px;display:flex;align-items:center;gap:16px}
.tier-emoji{font-size:30px}
.tier-label{font-size:17px;font-weight:900;text-transform:capitalize}
.tier-cpm{font-size:13px;color:#16a34a;font-weight:700;margin-top:2px}
.summary{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:24px}
.card{background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:14px;text-align:center}
.card-label{font-size:10px;color:#888;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px}
.card-val{font-size:22px;font-weight:900}
table{width:100%;border-collapse:collapse;margin-bottom:24px;font-size:13px}
th{background:#f3f4f6;padding:10px 12px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:#555;border-bottom:2px solid #e5e7eb}
td{padding:9px 12px;border-bottom:1px solid #f3f4f6;vertical-align:middle}
.group-hdr td{background:#fefce8;font-size:11px;font-weight:700;padding:8px 12px;border-top:2px solid #fde047;color:#854d0e}
.badge{display:inline-block;padding:2px 8px;border-radius:99px;font-size:10px;font-weight:700}
.badge-green{background:#dcfce7;color:#166534}
.badge-orange{background:#fff7ed;color:#c2410c}
.total-row td{border-top:3px solid #111;font-weight:900;background:#f0fdf4;font-size:14px;color:#166534}
.footer{font-size:11px;color:#aaa;text-align:center;margin-top:24px;padding-top:16px;border-top:1px solid #e5e7eb}
.btn{margin-bottom:24px;padding:10px 24px;background:#4f46e5;color:white;border:none;border-radius:8px;cursor:pointer;font-weight:700;font-size:14px}
@media print{.btn{display:none}body{padding:20px}}
</style></head><body>
<button class="btn" onclick="window.print()">&amp;#128424; Print / Save PDF</button>
<h1>Earnings Statement</h1>
<div class="sub">${monthLabel} &middot; Generated ${now.toLocaleString()}</div>
<div class="tier-card">
  <div class="tier-emoji">${tierEmoji[tier] ?? '\uD83C\uDF31'}</div>
  <div>
    <div class="tier-label">${tier.replace(/_/g, ' ')} Creator</div>
    <div class="tier-cpm">CPM Rate: $${ cpm.toFixed(2)} per 1,000 video views</div>
  </div>
</div>
<div class="summary">
  <div class="card"><div class="card-label">Total Earned</div><div class="card-val" style="color:#16a34a">$${ grandTotal.toFixed(2)}</div></div>
  <div class="card"><div class="card-label">Transactions</div><div class="card-val">${monthEarnings.length}</div></div>
  <div class="card"><div class="card-label">Sources</div><div class="card-val">${Object.keys(groups).length}</div></div>
</div>
${tableHtml}
<div class="footer">Testagram Creator Earnings &middot; Confidential &middot; ${ window.location.origin}</div>
</body></html>`);
    w.document.close();
  };

  if (!user) return null;
  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <Loader2 className="w-8 h-8 animate-spin text-primary" />
    </div>
  );

  const subscriberCount = userProfile?.subscriber_count || userProfile?.follower_count || 0;
  const followersMet = subscriberCount >= MON_MIN_FOLLOWERS;
  const postsMet     = postCount >= MON_MIN_POSTS;
  const videosMet    = videoCount >= MON_MIN_VIDEOS;
  const isEligible   = followersMet && postsMet && videosMet;
  const progressPct  = Math.min(100, (subscriberCount / MON_MIN_FOLLOWERS) * 100);

  return (
    <div className="min-h-screen bg-background pb-16 md:pb-0">
      <TopBar title="Monetization" showBack />
      <MonetizationAdBanner />

      <div className="max-w-2xl mx-auto p-4 space-y-6">

        {/* Tabs */}
        <div className="flex bg-muted/30 rounded-xl p-1 gap-1">
          {(['overview', 'credits', 'earnings', 'mentions'] as const).map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              className={`flex-1 py-2 px-3 rounded-lg text-sm font-semibold capitalize transition-all ${
                activeTab === tab ? 'bg-background shadow text-foreground' : 'text-muted-foreground hover:text-foreground'
              }`}>{tab === 'mentions' ? '@Mentions' : tab}</button>
          ))}
        </div>

        {/* ─── OVERVIEW ─── */}
        {activeTab === 'overview' && (
          <>
            {/* Credits */}
            <div className="bg-gradient-to-br from-yellow-500/10 to-orange-500/10 border border-yellow-500/30 rounded-2xl p-5">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Coins className="w-5 h-5 text-yellow-500" />
                  <h3 className="font-bold">Your Credits</h3>
                </div>
                <Button size="sm" variant="outline" onClick={fetchAll}><RefreshCw className="w-3 h-3" /></Button>
              </div>
              <p className="text-4xl font-bold text-yellow-500 mb-1">{formatNumber(credits)}</p>
              <p className="text-xs text-muted-foreground mb-4">Credits power AI features, boosts, and more</p>

              <div className={`rounded-xl p-3 border ${canClaimDaily() ? 'bg-yellow-500/10 border-yellow-500/30' : 'bg-muted/30 border-border'}`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Gift className="w-4 h-4 text-yellow-500" />
                    <div>
                      <p className="text-sm font-semibold">Daily Reward</p>
                      <p className="text-xs text-muted-foreground">
                        {dailyReward ? `Day ${dailyReward.streak_day} streak` : 'Start your streak!'}
                      </p>
                    </div>
                  </div>
                  <Button size="sm" onClick={claimDailyReward}
                    disabled={!canClaimDaily() || claimingReward}
                    className={canClaimDaily() ? 'bg-yellow-500 hover:bg-yellow-600 text-white' : ''}>
                    {claimingReward ? <Loader2 className="w-3 h-3 animate-spin" /> : canClaimDaily() ? 'Claim!' : 'Tomorrow'}
                  </Button>
                </div>
                {dailyReward && (
                  <div className="mt-3 grid grid-cols-7 gap-1">
                    {Array.from({ length: 7 }).map((_, i) => (
                      <div key={i} className={`h-1.5 rounded-full ${i < (dailyReward.streak_day || 0) ? 'bg-yellow-500' : 'bg-muted'}`} />
                    ))}
                  </div>
                )}
              </div>
              <div className="flex gap-2 mt-3">
                <Button size="sm" variant="outline" className="flex-1 gap-1" onClick={() => setActiveTab('credits')}>
                  <Play className="w-3 h-3" /> Get Credits
                </Button>
                <Button size="sm" variant="outline" className="flex-1 gap-1" onClick={() => navigate('/rewards')}>
                  <Zap className="w-3 h-3" /> Watch Ads
                </Button>
              </div>
            </div>

            {/* Eligibility */}
            {!monetizationStatus?.is_monetized && (
              <div className={`border rounded-2xl p-5 ${isEligible ? 'bg-gradient-to-r from-primary/10 to-green-500/10 border-primary/30' : 'bg-card border-border'}`}>
                <div className="flex items-start gap-3 mb-4">
                  <div className={`w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0 ${isEligible ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}>
                    {isEligible ? <CheckCircle2 className="w-6 h-6" /> : <Lock className="w-6 h-6 text-muted-foreground" />}
                  </div>
                  <div>
                    <h2 className="text-lg font-bold">{isEligible ? "You're eligible to monetize!" : 'Unlock Monetization'}</h2>
                    <p className="text-sm text-muted-foreground">
                      {isEligible ? `You've reached ${MON_MIN_FOLLOWERS.toLocaleString()} followers. Start earning!`
                        : `Reach ${MON_MIN_FOLLOWERS.toLocaleString()} followers to unlock monetization`}
                    </p>
                  </div>
                </div>
                {!isEligible && (
                  <div className="mb-4">
                    <div className="flex justify-between text-xs text-muted-foreground mb-1.5">
                      <span>{subscriberCount.toLocaleString()} followers</span>
                      <span>{MON_MIN_FOLLOWERS.toLocaleString()} required</span>
                    </div>
                    <div className="h-2.5 bg-muted rounded-full overflow-hidden">
                      <div className="h-full bg-gradient-to-r from-primary to-green-500 rounded-full transition-all duration-500" style={{ width: `${progressPct}%` }} />
                    </div>
                  </div>
                )}
                <div className="space-y-2 mb-4">
                  {[
                    { label: `${MON_MIN_FOLLOWERS.toLocaleString()}+ followers (${subscriberCount.toLocaleString()} / ${MON_MIN_FOLLOWERS.toLocaleString()})`, met: followersMet },
                    { label: `${MON_MIN_POSTS.toLocaleString()}+ posts (${postCount.toLocaleString()} / ${MON_MIN_POSTS.toLocaleString()})`, met: postsMet },
                    { label: `${MON_MIN_VIDEOS}+ videos (${videoCount} / ${MON_MIN_VIDEOS})`, met: videosMet },
                    { label: 'Active account in good standing', met: true },
                  ].map((req, i) => (
                    <div key={i} className="flex items-center gap-2 text-sm">
                      {req.met ? <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0" /> : <XCircle className="w-4 h-4 text-muted-foreground flex-shrink-0" />}
                      <span className={req.met ? 'text-foreground' : 'text-muted-foreground'}>{req.label}</span>
                    </div>
                  ))}
                </div>
                <button onClick={enableMonetization} disabled={!isEligible}
                  className={`w-full py-3 rounded-full font-semibold transition-all ${isEligible ? 'bg-primary text-primary-foreground hover:opacity-90' : 'bg-muted text-muted-foreground cursor-not-allowed'}`}>
                  {isEligible ? 'Enable Monetization' : !followersMet ? `Need ${(MON_MIN_FOLLOWERS - subscriberCount).toLocaleString()} more followers` : !postsMet ? `Need ${(MON_MIN_POSTS - postCount).toLocaleString()} more posts` : `Need ${MON_MIN_VIDEOS - videoCount} more videos`}
                </button>
              </div>
            )}

            {monetizationStatus?.is_monetized && (
              <>
                {/* ── Creator Tier Progress Bar ── */}
                {(() => {
                  const tierKey = userProfile?.creator_tier ?? 'free';
                  const curIdx  = getTierIdx(tierKey);
                  const cur     = CREATOR_TIERS[curIdx];
                  const next    = CREATOR_TIERS[curIdx + 1] ?? null;
                  const followers = subscriberCount;
                  const videos    = videoCount;
                  // Progress toward next tier (use followers as primary metric)
                  const followerPct = next ? Math.min(Math.round((followers / next.followerThreshold) * 100), 100) : 100;
                  const videoPct    = next ? Math.min(Math.round((videos / next.videoThreshold) * 100), 100) : 100;
                  const overallPct  = next ? Math.round((followerPct + videoPct) / 2) : 100;
                  return (
                    <div className={`border rounded-2xl overflow-hidden ${cur.bg}`}>
                      <div className="px-4 py-3 border-b border-border flex items-center gap-2">
                        <span className="text-lg">{cur.emoji}</span>
                        <div className="flex-1">
                          <p className="font-bold text-sm">{cur.label} Creator</p>
                          <p className="text-[11px] text-muted-foreground">{fmtCpm(cur.cpm)}</p>
                        </div>
                        {next && (
                          <div className="text-right">
                            <p className="text-[10px] text-muted-foreground">Next: {next.emoji} {next.label}</p>
                            <p className={`text-[10px] font-black ${next.color}`}>{fmtCpm(next.cpm)}</p>
                          </div>
                        )}
                        {!next && (
                          <span className="text-[10px] font-black text-amber-500 bg-amber-500/10 px-2 py-0.5 rounded-full border border-amber-500/20">Max Tier</span>
                        )}
                      </div>
                      <div className="px-4 py-3 space-y-3">
                        {next ? (
                          <>
                            <div>
                              <div className="flex justify-between text-xs mb-1">
                                <span className="text-muted-foreground">Followers</span>
                                <span className="font-semibold">{formatNumber(followers)} / {formatNumber(next.followerThreshold)}</span>
                              </div>
                              <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                                <div className={`h-full rounded-full transition-all duration-500 ${cur.color.replace('text-', 'bg-') || 'bg-primary'}`} style={{ width: `${followerPct}%` }} />
                              </div>
                            </div>
                            <div>
                              <div className="flex justify-between text-xs mb-1">
                                <span className="text-muted-foreground">Videos</span>
                                <span className="font-semibold">{videoCount} / {next.videoThreshold}</span>
                              </div>
                              <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                                <div className={`h-full rounded-full transition-all duration-500 ${cur.color.replace('text-', 'bg-') || 'bg-primary'}`} style={{ width: `${videoPct}%` }} />
                              </div>
                            </div>
                            <div className="flex items-center justify-between">
                              <p className="text-xs text-muted-foreground">Overall progress to {next.label}</p>
                              <span className={`text-xs font-black ${cur.color}`}>{overallPct}%</span>
                            </div>
                          </>
                        ) : (
                          <p className="text-xs text-muted-foreground">You've reached the highest creator tier. Earn up to {fmtCpm(cur.cpm)} on every 1,000 video views.</p>
                        )}
                      </div>
                    </div>
                  );
                })()}

                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2 bg-gradient-to-br from-primary/10 to-purple-500/10 border border-primary/20 rounded-2xl p-5">
                    <div className="flex items-center gap-2 mb-1">
                      <DollarSign className="w-5 h-5 text-primary" />
                      <span className="text-sm text-muted-foreground font-medium">Total Earnings</span>
                    </div>
                    <p className="text-4xl font-bold text-primary">${stats.totalEarnings.toFixed(2)}</p>
                    <div className="flex items-center gap-1.5 mt-2">
                      <Star className="w-3.5 h-3.5 text-yellow-500" />
                      <span className="text-xs text-muted-foreground">Creator since {new Date(monetizationStatus.created_at).toLocaleDateString()}</span>
                    </div>
                  </div>
                  {[
                    { label: 'Video Revenue', value: stats.videoRevenue, sub: `${formatNumber(stats.videoViews)} views`, icon: BarChart3, color: 'text-green-500' },
                    { label: 'Subscriptions', value: stats.subscriptions, sub: 'monthly', icon: Users, color: 'text-blue-500' },
                    { label: 'Tips Received', value: stats.tips, sub: 'total', icon: TrendingUp, color: 'text-purple-500' },
                    { label: 'Ad Revenue', value: stats.rewardedAdEarnings, sub: '30% share', icon: Zap, color: 'text-orange-500' },
                  ].map((stat, i) => (
                    <div key={i} className="bg-card border border-border rounded-xl p-4">
                      <div className="flex items-center gap-2 mb-1">
                        <stat.icon className={`w-4 h-4 ${stat.color}`} />
                        <span className="text-xs text-muted-foreground">{stat.label}</span>
                      </div>
                      <p className="text-xl font-bold">${stat.value.toFixed(2)}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{stat.sub}</p>
                    </div>
                  ))}
                </div>
                <div className="flex gap-3">
                  <Button onClick={() => navigate('/payouts')} className="flex-1">Request Payout</Button>
                  <Button onClick={() => navigate('/creator-studio')} variant="outline" className="flex-1">Creator Studio</Button>
                </div>
                {/* Full Creator Monetization Hub */}
                <div className="mt-4">
                  <VideoRevenueRateCard userId={user.id} />
                </div>
                <div className="mt-4">
                  <CreatorMonetizationHub userId={user.id} />
                </div>
              </>
            )}

            {/* Revenue streams */}
            <div className="bg-card border border-border rounded-2xl p-5">
              <h3 className="font-bold mb-3 flex items-center gap-2">
                <Trophy className="w-5 h-5 text-primary" />Revenue Streams
              </h3>
              <div className="space-y-2">
                {[
                  { label: 'Watch Rewarded Ads', desc: '+25 credits per ad, +30% ad revenue', action: () => navigate('/rewards'), icon: Play, color: 'text-green-500' },
                  { label: 'Boost Posts', desc: 'Free boosts via rewarded ads', action: () => navigate('/'), icon: Zap, color: 'text-blue-500' },
                  { label: 'Sell Products', desc: 'List items in the marketplace', action: () => navigate('/products'), icon: ExternalLink, color: 'text-purple-500' },
                  { label: 'Premium Badge', desc: 'Get verified + more reach', action: () => navigate('/premium'), icon: Star, color: 'text-yellow-500' },
                ].map((stream, i) => (
                  <button key={i} onClick={stream.action} className="w-full flex items-center justify-between p-3 rounded-xl hover:bg-muted/50 transition-colors text-left">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center">
                        <stream.icon className={`w-4 h-4 ${stream.color}`} />
                      </div>
                      <div>
                        <p className="font-medium text-sm">{stream.label}</p>
                        <p className="text-xs text-muted-foreground">{stream.desc}</p>
                      </div>
                    </div>
                    <ArrowRight className="w-4 h-4 text-muted-foreground" />
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        {/* ─── CREDITS ─── */}
        {activeTab === 'credits' && (
          <>
            <div className="text-center py-2">
              <div className="inline-flex items-center gap-2 px-4 py-2 bg-yellow-500/10 rounded-full border border-yellow-500/30 mb-2">
                <Coins className="w-5 h-5 text-yellow-500" />
                <span className="text-2xl font-bold text-yellow-500">{formatNumber(credits)} credits</span>
              </div>
              <p className="text-sm text-muted-foreground">Use credits for AI features, boosts & promotions</p>
            </div>

            <div className="bg-card border border-border rounded-2xl p-5">
              <h3 className="font-bold mb-3">Credit Costs</h3>
              <div className="grid grid-cols-2 gap-2">
                {Object.entries(CREDIT_COSTS).map(([action, cost]) => (
                  <div key={action} className="flex items-center justify-between p-2.5 bg-muted/30 rounded-lg">
                    <span className="text-sm">{action}</span>
                    <span className="text-sm font-bold text-yellow-500">{cost} cr</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-card border border-border rounded-2xl p-5">
              <h3 className="font-bold mb-3 flex items-center gap-2"><Gift className="w-5 h-5 text-green-500" />Earn Free Credits</h3>
              <div className="space-y-3">
                {[
                  { label: 'Daily Login', desc: 'Day 1–7 streak: 10–70 credits', icon: Trophy, color: 'text-yellow-500' },
                  { label: 'Watch Rewarded Ad', desc: '+25 credits per ad (10/day max)', icon: Play, color: 'text-blue-500' },
                  { label: 'Refer a Friend', desc: 'Both get 100 credits on signup', icon: Users, color: 'text-purple-500' },
                  { label: 'Post Goes Viral', desc: '+10 credits per 1k views', icon: TrendingUp, color: 'text-green-500' },
                ].map((item, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
                      <item.icon className={`w-4 h-4 ${item.color}`} />
                    </div>
                    <div>
                      <p className="font-medium text-sm">{item.label}</p>
                      <p className="text-xs text-muted-foreground">{item.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-3">
              <h3 className="font-bold flex items-center gap-2"><DollarSign className="w-5 h-5 text-primary" />Buy Credits</h3>
              {CREDIT_PACKAGES.map(pkg => (
                <div key={pkg.label} className={`relative border-2 rounded-2xl p-4 ${pkg.popular ? 'border-primary bg-primary/5' : 'border-border bg-card'}`}>
                  {pkg.popular && <span className="absolute -top-3 left-4 bg-primary text-primary-foreground text-xs font-bold px-3 py-1 rounded-full">MOST POPULAR</span>}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${pkg.color} flex items-center justify-center`}>
                        <Coins className="w-5 h-5 text-white" />
                      </div>
                      <div>
                        <p className="font-bold">{pkg.label} Pack</p>
                        <p className="text-yellow-500 font-semibold">{formatNumber(pkg.credits)} credits</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-xl font-bold">${pkg.price}</p>
                      <Button size="sm" className="mt-1" variant={pkg.popular ? 'default' : 'outline'} onClick={() => navigate('/premium')}>Buy</Button>
                    </div>
                  </div>
                </div>
              ))}
              <p className="text-xs text-center text-muted-foreground">💳 Secure payments via Stripe</p>
            </div>
          </>
        )}

        {/* ─── MENTIONS ─── */}
        {activeTab === 'mentions' && (
          <div className="space-y-4">
            {/* Summary card */}
            <div className="bg-gradient-to-br from-primary/10 to-blue-500/10 border border-primary/20 rounded-2xl p-5">
              <div className="flex items-center gap-3 mb-1">
                <div className="w-10 h-10 rounded-2xl bg-primary/15 flex items-center justify-center">
                  <span className="text-lg font-black text-primary">@</span>
                </div>
                <div>
                  <p className="text-2xl font-black text-primary">{mentionTotal}</p>
                  <p className="text-xs text-muted-foreground">@mentions in the last 30 days</p>
                </div>
              </div>
            </div>
            {/* 30-day bar chart */}
            <div className="bg-card border border-border rounded-2xl p-4">
              <h3 className="font-bold text-sm mb-4 flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-primary" />
                Daily @Mentions — Last 30 Days
              </h3>
              {mentionTotal === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                  <span className="text-4xl font-black opacity-20 mb-2">@</span>
                  <p className="text-sm font-medium">No mentions yet</p>
                  <p className="text-xs mt-1">When someone @mentions you, it appears here</p>
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={mentionChartData} margin={{ top: 4, right: 4, left: -25, bottom: 0 }} barSize={8}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                    <XAxis dataKey="date" tick={{ fontSize: 9 }} interval={4} />
                    <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                    <Tooltip formatter={(v: any) => [v, '@Mentions']} />
                    <Bar dataKey="count" name="@Mentions" fill="var(--primary)" radius={[3, 3, 0, 0]} opacity={0.85} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
            {/* Peak day */}
            {mentionTotal > 0 && (() => {
              const peak = mentionChartData.reduce((a, b) => (a.count >= b.count ? a : b), mentionChartData[0]);
              const avg = (mentionTotal / 30).toFixed(1);
              return (
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-card border border-border rounded-xl p-4 text-center">
                    <p className="text-2xl font-black text-primary">{peak.count}</p>
                    <p className="text-xs text-muted-foreground mt-1">Peak day ({peak.date})</p>
                  </div>
                  <div className="bg-card border border-border rounded-xl p-4 text-center">
                    <p className="text-2xl font-black text-primary">{avg}</p>
                    <p className="text-xs text-muted-foreground mt-1">Daily average</p>
                  </div>
                </div>
              );
            })()}
            <button onClick={() => navigate('/notifications?tab=mentions')}
              className="w-full py-3 border border-primary/30 text-primary font-semibold text-sm rounded-xl hover:bg-primary/5 transition-colors flex items-center justify-center gap-2">
              <span>@</span> View All Mentions
            </button>
          </div>
        )}

        {/* ─── EARNINGS ─── */}
        {activeTab === 'earnings' && (
          <>
            {/* Export button */}
            <button
              onClick={handleExportEarningsPDF}
              className="w-full flex items-center justify-center gap-2 py-3 border border-primary/30 bg-primary/5 hover:bg-primary/10 rounded-xl font-semibold text-sm text-primary transition-colors"
            >
              <BarChart3 className="w-4 h-4" /> Export Monthly PDF Receipt
            </button>

            {/* 6-month earnings by source BarChart */}
            <div className="bg-card border border-border rounded-2xl p-4">
              <h3 className="font-bold mb-4 flex items-center gap-2">
                <BarChart3 className="w-5 h-5 text-primary" />
                Monthly Earnings by Source
              </h3>
              {monthlyChartData.some(d => d.tips > 0 || d.subscriptions > 0 || d.video_ads > 0 || d.product_sales > 0) ? (
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={monthlyChartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                    <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(val: any, name: string) => [`$${Number(val).toFixed(2)}`, name.replace(/_/g, ' ')]} />
                    <Legend />
                    <Bar dataKey="tips" stackId="a" fill="#f59e0b" name="Tips" radius={[0,0,0,0]} />
                    <Bar dataKey="subscriptions" stackId="a" fill="#6366f1" name="Subscriptions" />
                    <Bar dataKey="video_ads" stackId="a" fill="#22c55e" name="Video Ads" />
                    <Bar dataKey="product_sales" stackId="a" fill="#ec4899" name="Products" />
                    <Bar dataKey="other" stackId="a" fill="#94a3b8" name="Other" radius={[4,4,0,0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">No monthly data yet — start earning!</div>
              )}
            </div>

            {/* Revenue split trend — 30/70 */}
            {chartData.some(d => d.creator > 0) && (
              <div className="bg-card border border-border rounded-2xl p-4">
                <h3 className="font-bold mb-4 flex items-center gap-2">
                  <BarChart3 className="w-5 h-5 text-primary" />
                  7-Day Revenue Split (You 30% · Platform 70%)
                </h3>
                <ResponsiveContainer width="100%" height={160}>
                  <LineChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(val: any, name: string) => [`$${Number(val).toFixed(5)}`, name === 'creator' ? 'Your 30%' : 'Platform 70%']} />
                    <Legend formatter={v => v === 'creator' ? 'Your 30%' : 'Platform 70%'} />
                    <Line type="monotone" dataKey="creator" stroke="#22c55e" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="platform" stroke="#6366f1" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Source breakdown pie */}
            {sourceChartData.length > 0 && (
              <div className="bg-card border border-border rounded-2xl p-4">
                <h3 className="font-bold mb-4 flex items-center gap-2">
                  <BarChart3 className="w-5 h-5 text-primary" />
                  Earnings by Source
                </h3>
                <div className="flex items-center gap-4">
                  <ResponsiveContainer width={140} height={140}>
                    <PieChart>
                      <Pie data={sourceChartData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={60} innerRadius={35}>
                        {sourceChartData.map((_, i) => (
                          <Cell key={i} fill={['#f59e0b','#6366f1','#22c55e','#ec4899','#94a3b8'][i % 5]} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(v: any) => `$${Number(v).toFixed(4)}`} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="flex-1 space-y-1">
                    {sourceChartData.map((s, i) => (
                      <div key={s.name} className="flex items-center gap-2">
                        <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: ['#f59e0b','#6366f1','#22c55e','#ec4899','#94a3b8'][i % 5] }} />
                        <span className="text-xs capitalize flex-1">{s.name}</span>
                        <span className="text-xs font-bold">${Number(s.value).toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {earnings.length === 0 ? (
              <div className="text-center py-16 text-muted-foreground">
                <DollarSign className="w-16 h-16 mx-auto mb-4 opacity-30" />
                <p className="font-semibold">No earnings yet</p>
                <p className="text-sm mt-1">Watch ads, create content, and boost posts to earn</p>
                <Button onClick={() => setActiveTab('credits')} className="mt-4" variant="outline">Get Started</Button>
              </div>
            ) : (
              <div className="bg-card border border-border rounded-2xl p-4">
                <h3 className="font-bold mb-3">Earnings History</h3>
                <div className="space-y-2">
                  {earnings.slice(0, 20).map(earning => (
                    <div key={earning.id} className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                      <div>
                        <p className="font-medium text-sm capitalize">{earning.source.replace(/_/g, ' ')}</p>
                        <p className="text-xs text-muted-foreground">{new Date(earning.created_at).toLocaleDateString()}</p>
                      </div>
                      <div className="text-right">
                        <p className="font-bold text-green-600">+${Number(earning.amount).toFixed(4)}</p>
                        <span className={`text-xs px-2 py-0.5 rounded-full ${
                          earning.status === 'pending' ? 'bg-orange-100 text-orange-600 dark:bg-orange-900/20' : 'bg-green-100 text-green-600 dark:bg-green-900/20'
                        }`}>{earning.status}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

            {/* ── Revenue Split Display Card ── */}
            <div className="bg-gradient-to-br from-slate-500/8 to-primary/5 border border-border rounded-2xl overflow-hidden">
              <div className="px-4 py-3 border-b border-border bg-muted/20 flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-primary" />
                <h3 className="font-bold text-sm">Your Revenue Split</h3>
                <span className="ml-auto text-[10px] text-muted-foreground">Platform / Creator</span>
              </div>
              <div className="divide-y divide-border">
                {/* Video CPM */}
                <div className="px-4 py-3">
                  <div className="flex items-center justify-between mb-1.5">
                    <div>
                      <p className="text-sm font-semibold">🎬 Video CPM</p>
                      <p className="text-[10px] text-muted-foreground">$1.50–$3.50/1k views · tier-based</p>
                    </div>
                    <div className="flex items-center gap-1.5 text-xs font-bold">
                      <span className="px-2 py-0.5 bg-muted text-muted-foreground rounded-full">60% platform</span>
                      <span className="px-2 py-0.5 bg-green-500/10 text-green-600 rounded-full">40% you</span>
                    </div>
                  </div>
                  <div className="h-1.5 rounded-full overflow-hidden bg-muted flex">
                    <div className="h-full bg-muted-foreground/30" style={{ width: '60%' }} />
                    <div className="h-full bg-green-500/70" style={{ width: '40%' }} />
                  </div>
                </div>
                {/* Ad Revenue */}
                <div className="px-4 py-3">
                  <div className="flex items-center justify-between mb-1.5">
                    <div>
                      <p className="text-sm font-semibold">📢 Ad Revenue Share</p>
                      <p className="text-[10px] text-muted-foreground">From ad placements pool · monthly</p>
                    </div>
                    <div className="flex items-center gap-1.5 text-xs font-bold">
                      <span className="px-2 py-0.5 bg-muted text-muted-foreground rounded-full">60% platform</span>
                      <span className="px-2 py-0.5 bg-green-500/10 text-green-600 rounded-full">40% you</span>
                    </div>
                  </div>
                  <div className="h-1.5 rounded-full overflow-hidden bg-muted flex">
                    <div className="h-full bg-muted-foreground/30" style={{ width: '60%' }} />
                    <div className="h-full bg-green-500/70" style={{ width: '40%' }} />
                  </div>
                </div>
                {/* Tips */}
                <div className="px-4 py-3">
                  <div className="flex items-center justify-between mb-1.5">
                    <div>
                      <p className="text-sm font-semibold">💝 Fan Tips</p>
                      <p className="text-[10px] text-muted-foreground">Direct supporter tips to creator</p>
                    </div>
                    <div className="flex items-center gap-1.5 text-xs font-bold">
                      <span className="px-2 py-0.5 bg-muted text-muted-foreground rounded-full">15% platform</span>
                      <span className="px-2 py-0.5 bg-green-500/10 text-green-600 rounded-full">85% you</span>
                    </div>
                  </div>
                  <div className="h-1.5 rounded-full overflow-hidden bg-muted flex">
                    <div className="h-full bg-muted-foreground/30" style={{ width: '15%' }} />
                    <div className="h-full bg-green-500/70" style={{ width: '85%' }} />
                  </div>
                </div>
                {/* P2P Transfers */}
                <div className="px-4 py-3">
                  <div className="flex items-center justify-between mb-1.5">
                    <div>
                      <p className="text-sm font-semibold">💸 P2P Transfers</p>
                      <p className="text-[10px] text-muted-foreground">Small 5% transaction fee (receiver gets 95%)</p>
                    </div>
                    <div className="flex items-center gap-1.5 text-xs font-bold">
                      <span className="px-2 py-0.5 bg-muted text-muted-foreground rounded-full">5% fee</span>
                      <span className="px-2 py-0.5 bg-green-500/10 text-green-600 rounded-full">95% arrives</span>
                    </div>
                  </div>
                  <div className="h-1.5 rounded-full overflow-hidden bg-muted flex">
                    <div className="h-full bg-muted-foreground/30" style={{ width: '5%' }} />
                    <div className="h-full bg-green-500/70" style={{ width: '95%' }} />
                  </div>
                </div>
              </div>
            </div>

            {/* Grow tips */}
        <div className="bg-gradient-to-br from-primary/5 to-purple-500/5 border border-primary/20 rounded-2xl p-5">
          <h3 className="font-bold mb-3 flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-primary" />Grow Your Audience
          </h3>
          <ul className="space-y-1.5 text-sm text-muted-foreground">
            <li>• Post consistently — at least once per day</li>
            <li>• Upload short videos for maximum reach</li>
            <li>• Use trending hashtags in your posts</li>
            <li>• Engage with comments on your posts</li>
            <li>• Boost posts via rewarded ads (free!)</li>
            <li>• Host audio Spaces to attract followers</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
