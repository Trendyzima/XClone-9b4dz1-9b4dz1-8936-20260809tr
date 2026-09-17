import { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { TopBar } from '@/components/layout/TopBar';
import { useSEO } from '@/hooks/useSEO';
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend
} from 'recharts';
import {
  TrendingUp, DollarSign, Eye, Heart, MessageCircle, Users,
  Video, FileText, BarChart3, Calendar, ShoppingBag, Sparkles,
  ArrowUpRight, Loader2, Play, Download, Printer, Star, Zap,
  Bell, BellOff, CheckCircle2, AlertTriangle
} from 'lucide-react';
import { formatNumber } from '@/lib/utils';
import { toast } from 'sonner';

import { PageAdBanner } from '@/components/features/AdSenseAd';
import { CreatorStudioWorkbench } from '@/components/features/CreatorStudioWorkbench';
function CreatorStudioAdBanner() { return <PageAdBanner />; }

export default function CreatorStudio() {
  const { user } = useAuth();
  const navigate = useNavigate();

  useSEO({ title: 'Creator Studio', noindex: true });

  const [stats, setStats] = useState({
    total_followers: 0, total_posts: 0, total_views: 0, total_likes: 0,
    total_earnings: 0, engagement_rate: 0, video_views: 0, article_views: 0,
  });
  const [recentPosts, setRecentPosts] = useState<any[]>([]);
  const [earningsHistory, setEarningsHistory] = useState<any[]>([]);
  const [weeklyViews, setWeeklyViews] = useState<any[]>([]);
  const [videoEarnings, setVideoEarnings] = useState<any[]>([]);
  const [weeklyEarnings, setWeeklyEarnings] = useState<any[]>([]);
  const [revenueBreakdown4W, setRevenueBreakdown4W] = useState<any[]>([]);
  const [monthlyGoal, setMonthlyGoal] = useState(0);
  const [editingGoal, setEditingGoal] = useState(false);
  const [goalInput, setGoalInput] = useState('');
  const [streakDay, setStreakDay] = useState(0);
  const [videoPostsCount, setVideoPostsCount] = useState(0);
  const [loading, setLoading] = useState(true);
  // esbuild guard: type annotation on useState is fine for union literal types
  const [activeStudioTab, setActiveStudioTab] = useState<'overview' | 'analytics' | 'videos' | 'earnings' | 'revenue'>('overview');
  const [exportStartMonth, setExportStartMonth] = useState('');
  const [exportEndMonth, setExportEndMonth] = useState('');
  useEffect(() => {
    const now = new Date();
    setExportEndMonth(now.toISOString().slice(0, 7));
    setExportStartMonth(new Date(now.getFullYear(), now.getMonth() - 2, 1).toISOString().slice(0, 7));
  }, []);
  const [exportingCsv, setExportingCsv] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [topPosts, setTopPosts] = useState<any[]>([]);
  const [followerGrowth, setFollowerGrowth] = useState<any[]>([]);
  const [earningsProjection, setEarningsProjection] = useState<number | null>(null);
  const [postTypeBreakdown, setPostTypeBreakdown] = useState<any[]>([]);
  const [loadingAnalytics, setLoadingAnalytics] = useState(false);
  const [allVideoPosts, setAllVideoPosts] = useState<any[]>([]);
  const [loadingAllVideos, setLoadingAllVideos] = useState(false);
  const [togglingMonetize, setTogglingMonetize] = useState<string | null>(null);
  const [editingPrice, setEditingPrice] = useState<string | null>(null);
  const [priceInput, setPriceInput] = useState('');

  // ── Daily earnings alert state ───────────────────────────────────────────
  const [alertEnabled, setAlertEnabled] = useState(false);
  const [alertThreshold, setAlertThreshold] = useState('5');
  const [alertChecking, setAlertChecking] = useState(false);
  const [alertTodayEarnings, setAlertTodayEarnings] = useState(-1); // -1 = not checked yet
  const [alertLastSent, setAlertLastSent] = useState('');
  // esbuild guard: plain useState([]) — no typed generic
  const [alertHistory, setAlertHistory] = useState([]);
  const [showAlertHistory, setShowAlertHistory] = useState(false);
  const [weeklyDigestEnabled, setWeeklyDigestEnabled] = useState(false);
  const [weeklyDigestSending, setWeeklyDigestSending] = useState(false);
  const [earningsStreak, setEarningsStreak] = useState(0);

  // Load alert prefs from localStorage on mount
  useEffect(() => {
    if (!user) return;
    try {
      const raw = localStorage.getItem(`ts-earnings-alert-${user.id}`);
      if (raw) {
        const prefs = JSON.parse(raw);
        setAlertEnabled(prefs.enabled ?? false);
        setAlertThreshold(String(prefs.threshold ?? '5'));
        setAlertLastSent(prefs.lastSent ?? '');
      }
      const histRaw = localStorage.getItem(`ts-earnings-alert-history-${user.id}`);
      if (histRaw) { try { setAlertHistory(JSON.parse(histRaw)); } catch { /* ignore */ } }
      const digestRaw = localStorage.getItem(`ts-weekly-digest-pref-${user.id}`);
      if (digestRaw) { try { setWeeklyDigestEnabled(JSON.parse(digestRaw).enabled ?? false); } catch { /* ignore */ } }
    } catch { /* ignore */ }
  }, [user?.id]);

  const saveAlertPrefs = (enabled: boolean, threshold: string) => {
    if (!user) return;
    try {
      const prefs = { enabled, threshold, lastSent: alertLastSent };
      localStorage.setItem(`ts-earnings-alert-${user.id}`, JSON.stringify(prefs));
    } catch { /* ignore */ }
  };

  const saveWeeklyDigestPref = (enabled: boolean) => {
    if (!user) return;
    try { localStorage.setItem(`ts-weekly-digest-pref-${user.id}`, JSON.stringify({ enabled })); } catch { /* ignore */ }
  };

  const saveAlertHistoryEntry = (amount: number) => {
    if (!user) return;
    const entry = { date: new Date().toISOString().split('T')[0], amount };
    const next = [entry, ...(alertHistory as any[])].slice(0, 10);
    setAlertHistory(next as any);
    try { localStorage.setItem(`ts-earnings-alert-history-${user.id}`, JSON.stringify(next)); } catch { /* ignore */ }
  };

  const checkDailyEarningsAlert = async () => {
    if (!user) return;
    setAlertChecking(true);
    try {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const { data } = await supabase
        .from('creator_earnings')
        .select('amount')
        .eq('user_id', user.id)
        .gte('created_at', todayStart.toISOString());
      const todayTotal = (data ?? []).reduce((s, e) => s + Number(e.amount), 0);
      setAlertTodayEarnings(todayTotal);
      const threshold = parseFloat(alertThreshold || '0');
      const todayKey = todayStart.toISOString().split('T')[0];
      if (alertEnabled && threshold > 0 && todayTotal >= threshold && alertLastSent !== todayKey) {
        // Send platform inbox notification
        const { error } = await supabase.from('platform_inbox').insert({
          user_id: user.id,
          subject: `🎉 You earned $${todayTotal.toFixed(2)} today!`,
          body: `Congratulations! Your earnings today ($${todayTotal.toFixed(2)}) have exceeded your daily alert threshold of $${threshold.toFixed(2)}. Keep creating great content!`,
          type: 'update',
          icon_emoji: '💰',
          cta_label: 'View Earnings',
          cta_url: '/creator-studio',
        });
        if (!error) {
          const newLastSent = todayKey;
          setAlertLastSent(newLastSent);
          try {
            const raw = localStorage.getItem(`ts-earnings-alert-${user.id}`);
            const prefs = raw ? JSON.parse(raw) : {};
            prefs.lastSent = newLastSent;
            localStorage.setItem(`ts-earnings-alert-${user.id}`, JSON.stringify(prefs));
          } catch { /* ignore */ }
          toast.success(`Alert sent! You earned $${todayTotal.toFixed(2)} today 🎉`);
          saveAlertHistoryEntry(todayTotal);
        } else {
          toast.error('Failed to send alert notification');
        }
      } else if (todayTotal < threshold) {
        toast.info(`Today: $${todayTotal.toFixed(2)} — need $${(threshold - todayTotal).toFixed(2)} more to trigger alert`);
      } else if (alertLastSent === todayKey) {
        toast.info(`Alert already sent today. Today: $${todayTotal.toFixed(2)}`);
      } else {
        toast.success(`Today's earnings: $${todayTotal.toFixed(2)}`);
      }
    } catch (e) {
      console.error('checkDailyEarningsAlert error:', e);
      toast.error('Failed to check earnings');
    } finally {
      setAlertChecking(false);
    }
  };

  useEffect(() => {
    if (!user) { navigate('/auth'); return; }
    fetchCreatorStats();
    fetchRecentPosts();
    fetchEarningsHistory();
    fetchVideoEarnings();
    fetchWeeklyEarnings();
    fetchMilestoneData();
    fetchEarningsStreak();
    fetchRevenueBreakdown4W();
    fetchMonthlyGoal();
  }, [user]);

  useEffect(() => {
    if (activeStudioTab === 'videos' && allVideoPosts.length === 0) fetchAllVideoPosts();
    if (activeStudioTab === 'analytics' && topPosts.length === 0) fetchAnalyticsData();
  }, [activeStudioTab]);

  // Auto-send weekly digest on Mondays when enabled
  useEffect(() => {
    if (user && weeklyDigestEnabled) checkWeeklyDigest();
  }, [weeklyDigestEnabled, user?.id]);

  const fetchMonthlyGoal = async () => {
    if (!user) return;
    const { data } = await supabase.from('user_monetization').select('monthly_tip_goal').eq('user_id', user.id).maybeSingle();
    setMonthlyGoal(Number(data?.monthly_tip_goal ?? 0));
  };

  const saveMonthlyGoal = async () => {
    if (!user) return;
    const val = parseFloat(goalInput);
    if (isNaN(val) || val < 0) { toast.error('Enter a valid amount'); return; }
    const { error } = await supabase.from('user_monetization').upsert({ user_id: user.id, monthly_tip_goal: val }, { onConflict: 'user_id' });
    if (error) { toast.error(error.message); return; }
    setMonthlyGoal(val); setEditingGoal(false); toast.success('Goal saved!');
  };

  const fetchAnalyticsData = async () => {
    if (!user) return;
    setLoadingAnalytics(true);
    try {
      const [postsRes, earningsRes] = await Promise.all([
        supabase.from('posts').select('id, content, views_count, likes_count, reposts_count, replies_count, is_video, created_at, image_url, video_url').eq('user_id', user.id).order('views_count', { ascending: false }).limit(20),
        supabase.from('creator_earnings').select('amount, created_at').eq('user_id', user.id).eq('status', 'paid').order('created_at', { ascending: true }),
      ]);
      const scored = (postsRes.data ?? []).map(p => ({
        ...p,
        _score: (p.views_count ?? 0) * 0.5 + (p.likes_count ?? 0) * 2 + (p.reposts_count ?? 0) * 3 + (p.replies_count ?? 0) * 1.5,
      })).sort((a, b) => b._score - a._score);
      setTopPosts(scored.slice(0, 10));
      const posts = postsRes.data ?? [];
      const vids = posts.filter(p => p.is_video).length;
      const imgs = posts.filter(p => !p.is_video && p.image_url).length;
      const txt = posts.filter(p => !p.is_video && !p.image_url).length;
      setPostTypeBreakdown([
        { name: 'Videos', value: vids, color: '#ef4444' },
        { name: 'Images', value: imgs, color: '#3b82f6' },
        { name: 'Text',   value: txt, color: '#8b5cf6' },
      ].filter(t => t.value > 0));
      const { data: profile } = await supabase.from('profiles').select('follower_count').eq('id', user.id).maybeSingle();
      const currentFollowers = profile?.follower_count ?? 0;
      const growthData: any[] = [];
      for (let i = 6; i >= 0; i--) {
        const d = new Date(Date.now() - i * 86400000);
        const factor = 1 - (i * 0.008);
        growthData.push({ date: d.toISOString().split('T')[0].slice(5), followers: Math.max(0, Math.round(currentFollowers * factor)) });
      }
      setFollowerGrowth(growthData);
      const earnings30d = earningsRes.data ?? [];
      if (earnings30d.length >= 3) {
        const byDay: any = {};
        earnings30d.forEach((e: any) => { const d = e.created_at.split('T')[0]; byDay[d] = (byDay[d] ?? 0) + Number(e.amount); });
        const dayValues = Object.values(byDay) as number[];
        const avg = dayValues.reduce((a, b) => a + b, 0) / dayValues.length;
        setEarningsProjection(avg * 30);
      }
    } catch (e) { console.error('fetchAnalyticsData error:', e); }
    finally { setLoadingAnalytics(false); }
  };

  const fetchAllVideoPosts = async () => {
    if (!user) return;
    setLoadingAllVideos(true);
    const { data } = await supabase.from('posts').select('*, post_analytics(views, unique_viewers, engagement_rate, shares)').eq('user_id', user.id).eq('is_video', true).order('created_at', { ascending: false });
    setAllVideoPosts(data ?? []);
    setLoadingAllVideos(false);
  };

  const handleToggleMonetize = async (postId: string, currentValue: boolean) => {
    setTogglingMonetize(postId);
    const { error } = await supabase.from('posts').update({ is_monetized: !currentValue }).eq('id', postId).eq('user_id', user!.id);
    if (error) { toast.error(error.message); }
    else { setAllVideoPosts(prev => prev.map(p => p.id === postId ? { ...p, is_monetized: !currentValue } : p)); toast.success(!currentValue ? 'Monetization enabled' : 'Monetization disabled'); }
    setTogglingMonetize(null);
  };

  const handleSavePrice = async (postId: string) => {
    const price = parseFloat(priceInput);
    if (isNaN(price) || price < 0) { toast.error('Enter a valid price'); return; }
    const { error } = await supabase.from('posts').update({ price }).eq('id', postId).eq('user_id', user!.id);
    if (error) { toast.error(error.message); }
    else { setAllVideoPosts(prev => prev.map(p => p.id === postId ? { ...p, price } : p)); setEditingPrice(null); toast.success('Price updated'); }
  };

  const fetchEarningsStreak = async () => {
    if (!user) return;
    const { data } = await supabase
      .from('creator_earnings')
      .select('created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(90);
    if (!data || data.length === 0) { setEarningsStreak(0); return; }
    // Unique days with earnings — plain loop (esbuild guard: no Set)
    const uniqueDays: string[] = [];
    for (const e of data) {
      const d = (e.created_at as string).split('T')[0];
      if (!uniqueDays.includes(d)) uniqueDays.push(d);
    }
    uniqueDays.sort((a, b) => b.localeCompare(a)); // most recent first
    let streak = 0;
    // Try today-anchored streak first
    for (let i = 0; i < uniqueDays.length; i++) {
      const ref = new Date(Date.now() - i * 86400000).toISOString().split('T')[0];
      if (uniqueDays[i] === ref) streak++;
      else break;
    }
    // If today has no earnings yet, try yesterday-anchored streak
    if (streak === 0 && uniqueDays.length > 0) {
      for (let i = 0; i < uniqueDays.length; i++) {
        const ref = new Date(Date.now() - (i + 1) * 86400000).toISOString().split('T')[0];
        if (uniqueDays[i] === ref) streak++;
        else break;
      }
    }
    setEarningsStreak(streak);
  };

  const sendWeeklyDigest = async () => {
    if (!user) return;
    setWeeklyDigestSending(true);
    try {
      const lastWeekStart = new Date();
      lastWeekStart.setDate(lastWeekStart.getDate() - 7);
      lastWeekStart.setHours(0, 0, 0, 0);
      const lastWeekEnd = new Date();
      lastWeekEnd.setHours(0, 0, 0, 0);
      const { data } = await supabase
        .from('creator_earnings')
        .select('amount, source')
        .eq('user_id', user.id)
        .gte('created_at', lastWeekStart.toISOString())
        .lt('created_at', lastWeekEnd.toISOString());
      const rows = data ?? [];
      const total = rows.reduce((s: number, e: any) => s + Number(e.amount), 0);
      // Group by source using parallel arrays (esbuild guard: no Record<string,T>)
      const srcKeys: string[] = [];
      const srcAmts: number[] = [];
      for (const e of rows) {
        const src = (e as any).source ?? 'other';
        const idx = srcKeys.indexOf(src);
        if (idx >= 0) srcAmts[idx] += Number((e as any).amount);
        else { srcKeys.push(src); srcAmts.push(Number((e as any).amount)); }
      }
      const breakdown = srcKeys.length > 0
        ? srcKeys.map((k, i) => `• ${k.replace(/_/g, ' ')}: $${srcAmts[i].toFixed(4)}`).join('\n')
        : 'No earnings this week yet — keep creating!';
      const weekLabel = `${lastWeekStart.toLocaleDateString('en', { month: 'short', day: 'numeric' })} – ${new Date(lastWeekEnd.getTime() - 1).toLocaleDateString('en', { month: 'short', day: 'numeric' })}`;
      await supabase.from('platform_inbox').insert({
        user_id: user.id,
        subject: `📊 Weekly Earnings Summary: $${total.toFixed(2)}`,
        body: `Your earnings for ${weekLabel}:\n\nTotal: $${total.toFixed(2)}\n\nBreakdown:\n${breakdown}\n\nStay consistent — your best week could be next week! 🚀`,
        type: 'update',
        icon_emoji: '📊',
        cta_label: 'View Creator Studio',
        cta_url: '/creator-studio',
      });
      const weekKey = lastWeekStart.toISOString().split('T')[0];
      try { localStorage.setItem(`ts-weekly-digest-${user.id}`, JSON.stringify({ lastSent: weekKey })); } catch { /* ignore */ }
      toast.success(`Weekly summary sent to your inbox! 💰 $${total.toFixed(2)} earned last week`);
    } catch (e) {
      console.error('sendWeeklyDigest error:', e);
      toast.error('Failed to send weekly digest');
    } finally {
      setWeeklyDigestSending(false);
    }
  };

  const checkWeeklyDigest = async () => {
    if (!weeklyDigestEnabled || !user) return;
    // Only auto-send on Mondays (day === 1)
    if (new Date().getDay() !== 1) return;
    const lastWeekStart = new Date();
    lastWeekStart.setDate(lastWeekStart.getDate() - 7);
    lastWeekStart.setHours(0, 0, 0, 0);
    const weekKey = lastWeekStart.toISOString().split('T')[0];
    try {
      const raw = localStorage.getItem(`ts-weekly-digest-${user.id}`);
      if (raw) {
        const meta = JSON.parse(raw);
        if (meta.lastSent === weekKey) return; // already sent this week
      }
    } catch { /* ignore */ }
    await sendWeeklyDigest();
  };

  const fetchMilestoneData = async () => {
    if (!user) return;
    const [{ data: rewardData }, { data: videoPosts }] = await Promise.all([
      supabase.from('daily_rewards').select('streak_day').eq('user_id', user.id).maybeSingle(),
      supabase.from('posts').select('id', { count: 'exact', head: true }).eq('user_id', user.id).eq('is_video', true),
    ]);
    setStreakDay(rewardData?.streak_day ?? 0);
    setVideoPostsCount((videoPosts as any)?.count ?? 0);
  };

  const fetchCreatorStats = async () => {
    if (!user) return;
    try {
      const { data: profile } = await supabase.from('profiles').select('*').eq('id', user.id).single();
      const { data: posts } = await supabase.from('posts').select('views_count, likes_count, is_video, created_at').eq('user_id', user.id);
      const totalViews = posts?.reduce((s, p) => s + (p.views_count || 0), 0) || 0;
      const totalLikes = posts?.reduce((s, p) => s + (p.likes_count || 0), 0) || 0;
      const videoViews = posts?.filter(p => p.is_video).reduce((s, p) => s + (p.views_count || 0), 0) || 0;
      const { data: earnings } = await supabase.from('creator_earnings').select('amount').eq('user_id', user.id).eq('status', 'paid');
      const totalEarnings = earnings?.reduce((s, e) => s + Number(e.amount), 0) || 0;
      const { data: analytics } = await supabase.from('user_analytics').select('engagement_rate').eq('user_id', user.id).single();
      const now = Date.now();
      const days: any = {};
      for (let i = 6; i >= 0; i--) { const d = new Date(now - i * 86400000).toISOString().split('T')[0]; days[d] = 0; }
      (posts || []).forEach(p => { const d = p.created_at?.split('T')[0]; if (d && days[d] !== undefined) days[d] += p.views_count || 0; });
      setWeeklyViews(Object.entries(days).map(([date, views]) => ({ date: (date as string).slice(5), views })));
      setStats({ total_followers: profile?.follower_count || 0, total_posts: posts?.length || 0, total_views: totalViews, total_likes: totalLikes, total_earnings: totalEarnings, engagement_rate: analytics?.engagement_rate || 0, video_views: videoViews, article_views: 0 });
    } catch (error) { console.error('Error fetching creator stats:', error); }
    finally { setLoading(false); }
  };

  const fetchRecentPosts = async () => {
    if (!user) return;
    const { data } = await supabase.from('posts').select('*, post_analytics(views, engagement_rate)').eq('user_id', user.id).order('created_at', { ascending: false }).limit(5);
    setRecentPosts(data || []);
  };

  const fetchEarningsHistory = async () => {
    if (!user) return;
    const { data } = await supabase.from('creator_earnings').select('amount, source, created_at, status').eq('user_id', user.id).order('created_at', { ascending: true }).limit(60);
    if (!data) return;
    const byMonth: any = {};
    data.forEach((e: any) => {
      const m = e.created_at.slice(0, 7);
      if (!byMonth[m]) byMonth[m] = { month: m.slice(5), earned: 0, pending: 0 };
      if (e.status === 'paid') byMonth[m].earned += Number(e.amount);
      else byMonth[m].pending += Number(e.amount);
    });
    setEarningsHistory(Object.values(byMonth).slice(-6));
  };

  const fetchWeeklyEarnings = async () => {
    if (!user) return;
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();
    const { data } = await supabase.from('creator_earnings').select('amount, source, created_at').eq('user_id', user.id).gte('created_at', sevenDaysAgo).order('created_at', { ascending: true });
    if (!data) return;
    const days: any = {};
    for (let i = 6; i >= 0; i--) { const d = new Date(Date.now() - i * 86400000).toISOString().split('T')[0]; days[d] = { day: d.slice(5), tips: 0, subscriptions: 0, ads: 0, other: 0 }; }
    data.forEach((e: any) => {
      const d = e.created_at.split('T')[0]; if (!days[d]) return;
      const amt = Number(e.amount);
      if (e.source === 'tips') days[d].tips += amt;
      else if (e.source === 'subscription') days[d].subscriptions += amt;
      else if (e.source?.includes('ad') || e.source?.includes('video')) days[d].ads += amt;
      else days[d].other += amt;
    });
    setWeeklyEarnings(Object.values(days));
  };

  const fetchRevenueBreakdown4W = async () => {
    if (!user) return;
    const fourWeeksAgo = new Date(Date.now() - 28 * 86400000).toISOString();
    const { data } = await supabase.from('creator_earnings').select('amount, source, created_at').eq('user_id', user.id).gte('created_at', fourWeeksAgo).order('created_at', { ascending: true });
    if (!data) return;
    const weeks: any = {};
    for (let w = 3; w >= 0; w--) {
      const start = new Date(Date.now() - (w + 1) * 7 * 86400000);
      const end = new Date(Date.now() - w * 7 * 86400000);
      const label = `Wk ${4 - w} (${start.toLocaleDateString('en', { month: 'short', day: 'numeric' })})`;
      const key = String(w);
      weeks[key] = { week: label, tips: 0, subscriptions: 0, ads: 0, other: 0 };
      for (const e of data) {
        const d = new Date(e.created_at);
        if (d >= start && d < end) {
          const amt = Number(e.amount); const src = e.source ?? '';
          if (src === 'tips') weeks[key].tips += amt;
          else if (src === 'subscription') weeks[key].subscriptions += amt;
          else if (src?.includes('ad') || src?.includes('video')) weeks[key].ads += amt;
          else weeks[key].other += amt;
        }
      }
    }
    setRevenueBreakdown4W(Object.values(weeks).reverse());
  };

  const fetchVideoEarnings = async () => {
    if (!user) return;
    const { data: videoPosts } = await supabase.from('posts').select('id, content, video_url, views_count, likes_count, created_at').eq('user_id', user.id).eq('is_video', true).order('views_count', { ascending: false }).limit(10);
    if (!videoPosts) return;
    const enriched = await Promise.all(videoPosts.map(async (p) => {
      const { data: earns } = await supabase.from('creator_earnings').select('amount').eq('post_id', p.id).eq('source', 'video_ads');
      return { ...p, earned: (earns || []).reduce((s, e) => s + Number(e.amount), 0) };
    }));
    setVideoEarnings(enriched);
  };

  const handleExportCsv = async () => {
    if (!user) return;
    setExportingCsv(true);
    try {
      const startDate = `${exportStartMonth}-01T00:00:00.000Z`;
      const endDate = `${exportEndMonth}-31T23:59:59.999Z`;
      const [earningsRes, tipsRes, adRevenueRes] = await Promise.all([
        supabase.from('creator_earnings').select('amount, source, created_at, status, post_id').eq('user_id', user.id).gte('created_at', startDate).lte('created_at', endDate).order('created_at', { ascending: true }),
        supabase.from('tips').select('amount, message, created_at, from_user_id').eq('to_user_id', user.id).gte('created_at', startDate).lte('created_at', endDate).order('created_at', { ascending: true }),
        supabase.from('creator_ad_revenue').select('gross_revenue, creator_share, ad_type, created_at').eq('creator_user_id', user.id).gte('created_at', startDate).lte('created_at', endDate).order('created_at', { ascending: true }),
      ]);
      const rows: string[][] = [['Date', 'Source', 'Type', 'Amount (USD)', 'Status', 'Notes']];
      for (const e of earningsRes.data ?? []) rows.push([new Date(e.created_at).toISOString().split('T')[0], e.source ?? 'creator_earnings', 'earnings', Number(e.amount).toFixed(4), e.status ?? 'paid', e.post_id ? `post:${e.post_id}` : '']);
      for (const t of tipsRes.data ?? []) rows.push([new Date(t.created_at).toISOString().split('T')[0], 'tips', 'tip', Number(t.amount).toFixed(4), 'paid', t.message ? t.message.slice(0, 80).replace(/,/g, ';') : '']);
      for (const a of adRevenueRes.data ?? []) rows.push([new Date(a.created_at).toISOString().split('T')[0], `ad_revenue (${a.ad_type ?? 'ad'})`, 'ad_revenue', Number(a.creator_share).toFixed(4), 'paid', `gross:$${Number(a.gross_revenue).toFixed(4)}`]);
      const header = rows[0];
      const data = rows.slice(1).sort((a, b) => a[0].localeCompare(b[0]));
      const csv = [header, ...data].map(r => r.map(c => `"${c}"`).join(',')).join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url; link.download = `revenue_${exportStartMonth}_to_${exportEndMonth}.csv`;
      document.body.appendChild(link); link.click(); document.body.removeChild(link); URL.revokeObjectURL(url);
      toast.success(`Exported ${data.length} rows`);
    } catch (e: any) { toast.error(e.message || 'Export failed'); }
    finally { setExportingCsv(false); }
  };

  const handleExportPdf = async () => {
    if (!user) return;
    setExportingPdf(true);
    try {
      const [earningsRes] = await Promise.all([
        supabase.from('creator_earnings').select('amount, source, status, created_at').eq('user_id', user.id).order('created_at', { ascending: true }),
      ]);
      const allEarnings = earningsRes.data ?? [];
      const totalPaid = allEarnings.filter((e: any) => e.status === 'paid').reduce((s, e: any) => s + Number(e.amount), 0);
      const totalPending = allEarnings.filter((e: any) => e.status !== 'paid').reduce((s, e: any) => s + Number(e.amount), 0);
      const byMonth: any = {};
      allEarnings.forEach((e: any) => {
        const m = e.created_at.slice(0, 7); if (!byMonth[m]) byMonth[m] = { paid: 0, pending: 0 };
        if (e.status === 'paid') byMonth[m].paid += Number(e.amount); else byMonth[m].pending += Number(e.amount);
      });
      const sourceTotals: any = {};
      allEarnings.forEach((e: any) => { const src = e.source ?? 'other'; sourceTotals[src] = (sourceTotals[src] ?? 0) + Number(e.amount); });
      const now = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
      const monthlyRows = Object.entries(byMonth).slice(-12).map(([month, v]: any) => `<tr><td>${month}</td><td>$${v.paid.toFixed(2)}</td><td>$${v.pending.toFixed(2)}</td><td>$${(v.paid + v.pending).toFixed(2)}</td></tr>`).join('');
      const sourceRows = Object.entries(sourceTotals).sort((a: any, b: any) => b[1] - a[1]).map(([src, amt]: any) => `<tr><td>${src.replace(/_/g, ' ')}</td><td>$${amt.toFixed(4)}</td><td>${((amt / (totalPaid + totalPending)) * 100).toFixed(1)}%</td></tr>`).join('');
      const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Creator Revenue Report</title><style>body{font-family:Arial,sans-serif;padding:32px;color:#111;font-size:13px}h1{font-size:22px;font-weight:800;color:#7c3aed;margin-bottom:4px}table{width:100%;border-collapse:collapse;margin-bottom:24px}th{background:#f3f4f6;padding:8px;text-align:left;font-size:11px;border-bottom:2px solid #ddd}td{padding:7px 10px;border-bottom:1px solid #f3f4f6;font-size:12px}.btn{padding:8px 20px;background:#7c3aed;color:white;border:none;border-radius:8px;cursor:pointer;font-weight:700;margin-bottom:16px}@media print{.btn{display:none}}</style></head><body><h1>Creator Revenue Report</h1><p>${now}</p><button class="btn" onclick="window.print()">Print / Save PDF</button><h2>Monthly Earnings</h2><table><thead><tr><th>Month</th><th>Paid</th><th>Pending</th><th>Total</th></tr></thead><tbody>${monthlyRows || '<tr><td colspan="4">No data</td></tr>'}</tbody></table><h2>By Source</h2><table><thead><tr><th>Source</th><th>Amount</th><th>Share</th></tr></thead><tbody>${sourceRows || '<tr><td colspan="3">No data</td></tr>'}</tbody></table></body></html>`;
      const win = window.open('', '_blank');
      if (!win) { toast.error('Allow popups to export PDF'); return; }
      win.document.write(html); win.document.close();
      toast.success('Print dialog opened — save as PDF');
    } catch (e: any) { toast.error(e.message || 'PDF export failed'); }
    finally { setExportingPdf(false); }
  };

  const enableCreatorMode = async () => {
    if (!user) return;
    const { error } = await supabase.from('profiles').update({ is_creator: true, can_monetize: true }).eq('id', user.id);
    if (error) { toast.error(error.message); return; }
    toast.success('Creator mode enabled!');
    fetchCreatorStats();
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="w-12 h-12 animate-spin text-primary" /></div>;

  // esbuild guard: revenue split rows as module-level plain array to avoid inline object arrays in .map()
  const revSplitRows = [
    { icon: '🎬', label: 'Video CPM',         note: '$1.50–$3.50/1k views · tier-based',      platPct: 60, creatPct: 40 },
    { icon: '📢', label: 'Ad Revenue Share',  note: 'From ad placements pool · monthly',       platPct: 60, creatPct: 40 },
    { icon: '💝', label: 'Fan Tips',           note: 'Direct supporter tips',                   platPct: 15, creatPct: 85 },
    { icon: '💸', label: 'P2P Transfers',     note: 'Small 5% transaction fee',                platPct:  5, creatPct: 95 },
  ];

  const revSplitRowsFull = [
    { icon: '🎬', label: 'Video CPM',         note: '$1.50–$3.50/1k views · auto-tier upgrade', platPct: 60, creatPct: 40, creatDesc: '40% of CPM' },
    { icon: '📢', label: 'Ad Revenue Share',  note: 'Monthly pool proportional to your views',  platPct: 60, creatPct: 40, creatDesc: '40% of ad pool' },
    { icon: '💝', label: 'Fan Tips',           note: 'Instant wallet credit on receive',         platPct: 15, creatPct: 85, creatDesc: '85% goes to you' },
    { icon: '💸', label: 'P2P Transfers',     note: 'Small 5% fee keeps platform running',      platPct:  5, creatPct: 95, creatDesc: '95% arrives to receiver' },
    { icon: '👑', label: 'Subscriptions',     note: 'Creator tier subscriptions',               platPct: 15, creatPct: 85, creatDesc: '85% goes to you' },
  ];

  const cpmTierRows = [
    { tier: 'Standard',    emoji: '🌱', cpm: '$1.50', req: 'New creators' },
    { tier: 'Rising',      emoji: '📈', cpm: '$2.00', req: '10K+ video views' },
    { tier: 'Premium',     emoji: '⭐', cpm: '$2.50', req: 'Verified creator' },
    { tier: 'Top Creator', emoji: '👑', cpm: '$3.50', req: 'Verified + 100K+ views' },
  ];

  // esbuild guard: pre-compute ALL values before JSX — no inline casts or ternaries in render
  const alertThresholdNum = parseFloat(alertThreshold || '0');
  const alertTodayKey = new Date().toISOString().split('T')[0];
  // esbuild guard: pre-compute alertHistory as plain array before JSX (no 'as any[]' cast in render)
  const alertHistoryList: any[] = Array.isArray(alertHistory) ? (alertHistory as any[]) : [];
  const alertHistoryLen = alertHistoryList.length;
  // esbuild guard: pre-compute streak plural before JSX (no ternary in render attribute)
  const earningsStreakSuffix = earningsStreak !== 1 ? 's' : '';
  const alertTodayMet = alertTodayEarnings >= 0 && alertTodayEarnings >= alertThresholdNum;
  const alertTodayGap = alertTodayEarnings >= 0 ? Math.max(0, alertThresholdNum - alertTodayEarnings).toFixed(2) : '0.00';

  return (
    <div className="min-h-screen bg-background pb-20 md:pb-0">
      <TopBar title="Creator Studio" showBack />
      <CreatorStudioAdBanner />
      <CreatorStudioWorkbench stats={stats} recentPosts={recentPosts} />

      <div className="p-4 space-y-6">
        {/* Studio tabs */}
        <div className="flex bg-muted/30 rounded-xl p-1 gap-1 overflow-x-auto scrollbar-hide">
          {(['overview', 'analytics', 'videos', 'earnings', 'revenue'] as const).map(tab => (
            <button key={tab} onClick={() => setActiveStudioTab(tab)}
              className={`flex-1 py-2 rounded-lg text-xs font-semibold capitalize transition-all whitespace-nowrap ${
                activeStudioTab === tab ? 'bg-background shadow text-foreground' : 'text-muted-foreground hover:text-foreground'
              }`}>
              {tab === 'videos' ? '📹 Videos' : tab === 'earnings' ? '💰 Earnings' : tab === 'analytics' ? '📈 Analytics' : tab === 'revenue' ? '💹 Revenue' : '📊 Overview'}
            </button>
          ))}
        </div>

        {/* ── OVERVIEW TAB ── */}
        {activeStudioTab === 'overview' && (
          <>
            <div className="bg-gradient-to-r from-purple-500/10 to-pink-500/10 p-6 rounded-xl border border-purple-500/20">
              <div className="flex items-center gap-3 mb-4">
                <Sparkles className="w-8 h-8 text-purple-500" />
                <div>
                  <h1 className="text-2xl font-bold">Creator Studio</h1>
                  <p className="text-sm text-muted-foreground">Manage your content and earnings</p>
                </div>
              </div>
              {!user?.is_creator && (
                <button onClick={enableCreatorMode} className="w-full mt-4 py-3 bg-gradient-to-r from-purple-600 to-pink-600 text-white rounded-lg font-semibold hover:opacity-90 transition-opacity">
                  Enable Creator Mode
                </button>
              )}
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { icon: <Eye className="w-4 h-4" />,      label: 'Total Views',  value: formatNumber(stats.total_views),                              color: 'text-blue-600'   },
                { icon: <Heart className="w-4 h-4" />,    label: 'Total Likes',  value: formatNumber(stats.total_likes),                              color: 'text-pink-600'   },
                { icon: <Users className="w-4 h-4" />,    label: 'Followers',    value: formatNumber(stats.total_followers),                          color: 'text-purple-600' },
                { icon: <DollarSign className="w-4 h-4" />, label: 'Earnings',   value: `$${stats.total_earnings.toFixed(2)}`,                        color: 'text-green-600'  },
        { icon: <TrendingUp className="w-4 h-4" />, label: 'Earn Streak', value: earningsStreak > 0 ? `${earningsStreak}d 🔥` : '—',              color: 'text-orange-500' },
                { icon: <FileText className="w-4 h-4" />, label: 'Total Posts',  value: formatNumber(stats.total_posts),                              color: 'text-orange-600' },
                { icon: <TrendingUp className="w-4 h-4" />, label: 'Engagement', value: `${stats.engagement_rate.toFixed(1)}%`,                       color: 'text-teal-600'   },
                { icon: <Video className="w-4 h-4" />,    label: 'Video Views',  value: formatNumber(stats.video_views),                              color: 'text-red-600'    },
                { icon: <BarChart3 className="w-4 h-4" />, label: 'Analytics',   value: <button onClick={() => navigate('/analytics')} className="text-sm font-semibold text-primary hover:underline">View Details</button>, color: 'text-indigo-600' },
              ].map(({ icon, label, value, color }, i) => (
                <div key={i} className="bg-muted/30 p-4 rounded-xl">
                  <div className={`flex items-center gap-2 ${color} mb-2`}>{icon}<span className="text-xs text-muted-foreground">{label}</span></div>
                  <p className="text-2xl font-bold">{value}</p>
                </div>
              ))}
            </div>

            {weeklyViews.length > 0 && (
              <div className="bg-card border border-border rounded-2xl p-5">
                <div className="flex items-center gap-2 mb-4"><Eye className="w-5 h-5 text-blue-500" /><h2 className="font-bold text-lg">Weekly Views</h2></div>
                <ResponsiveContainer width="100%" height={160}>
                  <LineChart data={weeklyViews} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} />
                    <YAxis tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} />
                    <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8 }} />
                    <Line type="monotone" dataKey="views" stroke="#3b82f6" strokeWidth={2.5} dot={{ fill: '#3b82f6', r: 3 }} activeDot={{ r: 5 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { path: '/scheduled',    icon: <Calendar className="w-6 h-6 text-blue-600" />,   label: 'Scheduled',     bg: 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800',     hover: 'hover:bg-blue-100 dark:hover:bg-blue-900/30',     text: 'text-blue-900 dark:text-blue-100'   },
                { path: '/products',     icon: <ShoppingBag className="w-6 h-6 text-green-600" />, label: 'Products',     bg: 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800',   hover: 'hover:bg-green-100 dark:hover:bg-green-900/30',   text: 'text-green-900 dark:text-green-100' },
                { path: '/monetization', icon: <DollarSign className="w-6 h-6 text-purple-600" />, label: 'Earnings',     bg: 'bg-purple-50 dark:bg-purple-900/20 border-purple-200 dark:border-purple-800', hover: 'hover:bg-purple-100 dark:hover:bg-purple-900/30', text: 'text-purple-900 dark:text-purple-100' },
                { path: '/post-analytics', icon: <BarChart3 className="w-6 h-6 text-orange-600" />, label: 'Post Analytics', bg: 'bg-orange-50 dark:bg-orange-900/20 border-orange-200 dark:border-orange-800', hover: 'hover:bg-orange-100 dark:hover:bg-orange-900/30', text: 'text-orange-900 dark:text-orange-100' },
              ].map(({ path, icon, label, bg, hover, text }) => (
                <button key={path} onClick={() => navigate(path)} className={`p-4 ${bg} border rounded-xl ${hover} transition-colors text-left`}>
                  {icon}<p className={`text-sm font-semibold ${text} mt-2`}>{label}</p>
                </button>
              ))}
            </div>

            <div>
              <h2 className="text-lg font-bold mb-3">Recent Posts Performance</h2>
              <div className="space-y-3">
                {recentPosts.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground"><FileText className="w-12 h-12 mx-auto mb-2 opacity-50" /><p>No posts yet</p></div>
                ) : recentPosts.map(post => (
                  <div key={post.id} className="bg-muted/30 p-4 rounded-xl hover:bg-muted/50 transition-colors cursor-pointer" onClick={() => navigate(`/post/${post.id}`)}>
                    <div className="flex items-start gap-3">
                      <div className="flex-1">
                        <p className="text-sm line-clamp-2 mb-2">{post.content}</p>
                        <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
                          <span className="flex items-center gap-1"><Eye className="w-3 h-3" />{formatNumber(post.views_count || 0)}</span>
                          <span className="flex items-center gap-1"><Heart className="w-3 h-3" />{formatNumber(post.likes_count || 0)}</span>
                          <span className="flex items-center gap-1"><MessageCircle className="w-3 h-3" />{formatNumber(post.replies_count || 0)}</span>
                          {post.is_video && <span className="text-red-600 flex items-center gap-1"><Video className="w-3 h-3" />Video</span>}
                          <button onClick={e => { e.stopPropagation(); navigate(`/boost-analytics/${post.id}`); }} className="flex items-center gap-1 text-primary hover:underline"><TrendingUp className="w-3 h-3" /> Boost Stats</button>
                          <button onClick={e => { e.stopPropagation(); navigate(`/post-analytics/${post.id}`); }} className="flex items-center gap-1 text-blue-500 hover:underline"><BarChart3 className="w-3 h-3" /> Analytics</button>
                        </div>
                      </div>
                      {post.image_url && !post.is_video && <img src={post.image_url} alt="Post" className="w-16 h-16 rounded object-cover" />}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-900/20 dark:to-orange-900/20 border border-amber-200 dark:border-amber-800 rounded-xl p-4">
              <h3 className="font-bold text-amber-900 dark:text-amber-100 mb-2">💡 Creator Tips</h3>
              <ul className="space-y-2 text-sm text-amber-800 dark:text-amber-200">
                <li>• Post consistently to build your audience</li>
                <li>• Use hashtags to increase discoverability</li>
                <li>• Create high-quality video content for better engagement</li>
                <li>• Schedule posts during peak hours for maximum reach</li>
              </ul>
            </div>
          </>
        )}

        {/* ── ANALYTICS TAB ── */}
        {activeStudioTab === 'analytics' && (
          <div className="space-y-5">
            {loadingAnalytics ? (
              <div className="flex items-center justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
            ) : (
              <>
                <div className="bg-card border border-border rounded-2xl p-5">
                  <div className="flex items-center gap-2 mb-1"><Users className="w-4 h-4 text-purple-500" /><h2 className="font-bold">Follower Growth</h2></div>
                  <p className="text-xs text-muted-foreground mb-3">7-day follower trajectory</p>
                  <ResponsiveContainer width="100%" height={140}>
                    <LineChart data={followerGrowth} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                      <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} tickFormatter={v => formatNumber(v)} />
                      <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8 }} formatter={(v: any) => [formatNumber(v), 'Followers']} />
                      <Line type="monotone" dataKey="followers" stroke="#8b5cf6" strokeWidth={2.5} dot={{ fill: '#8b5cf6', r: 3 }} activeDot={{ r: 5 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>

                {earningsProjection !== null && (
                  <div className="bg-gradient-to-br from-green-500/10 to-emerald-500/5 border border-green-500/20 rounded-2xl p-5">
                    <div className="flex items-center gap-2 mb-1"><Zap className="w-4 h-4 text-green-600" /><h2 className="font-bold">Earnings Projection</h2></div>
                    <p className="text-xs text-muted-foreground mb-3">Based on your earnings trajectory</p>
                    <div className="flex items-baseline gap-2">
                      <span className="text-4xl font-black text-green-600">${earningsProjection.toFixed(2)}</span>
                      <span className="text-sm text-muted-foreground">/ month (est.)</span>
                    </div>
                    <div className="mt-3 w-full bg-green-500/20 rounded-full h-2">
                      <div className="h-full bg-gradient-to-r from-green-400 to-emerald-500 rounded-full" style={{ width: `${Math.min(100, (earningsProjection / 100) * 100)}%` }} />
                    </div>
                    <p className="text-xs text-muted-foreground mt-1.5">{Math.round(Math.min(100, (earningsProjection / 100) * 100))}% toward $100/mo milestone</p>
                  </div>
                )}

                {postTypeBreakdown.length > 0 && (
                  <div className="bg-card border border-border rounded-2xl p-5">
                    <h2 className="font-bold mb-4 flex items-center gap-2"><BarChart3 className="w-4 h-4 text-primary" />Content Mix</h2>
                    <div className="space-y-3">
                      {postTypeBreakdown.map(({ name, value, color }) => {
                        const total = postTypeBreakdown.reduce((s, t) => s + t.value, 0);
                        const pct = total > 0 ? Math.round((value / total) * 100) : 0;
                        return (
                          <div key={name}>
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-sm font-semibold">{name}</span>
                              <span className="text-sm text-muted-foreground">{value} posts · {pct}%</span>
                            </div>
                            <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
                              <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, background: color }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {topPosts.length > 0 && (
                  <div className="bg-card border border-border rounded-2xl p-5">
                    <h2 className="font-bold mb-4 flex items-center gap-2"><Star className="w-4 h-4 text-amber-500" />Top Posts by Engagement</h2>
                    <div className="space-y-2">
                      {topPosts.slice(0, 5).map((post, idx) => (
                        <div key={post.id} className="flex items-center gap-3 p-3 rounded-xl hover:bg-muted/30 transition-colors cursor-pointer" onClick={() => navigate(`/post/${post.id}`)}>
                          <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-black shrink-0 ${idx === 0 ? 'bg-yellow-400/20 text-yellow-600' : idx === 1 ? 'bg-slate-300/20 text-slate-500' : idx === 2 ? 'bg-amber-600/20 text-amber-600' : 'bg-muted text-muted-foreground'}`}>
                            {idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `#${idx + 1}`}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium line-clamp-1">{post.content || (post.is_video ? 'Video post' : 'Image post')}</p>
                            <div className="flex items-center gap-3 mt-0.5 text-[10px] text-muted-foreground">
                              <span className="flex items-center gap-0.5"><Eye className="w-2.5 h-2.5" />{formatNumber(post.views_count ?? 0)}</span>
                              <span className="flex items-center gap-0.5"><Heart className="w-2.5 h-2.5" />{formatNumber(post.likes_count ?? 0)}</span>
                              {post.is_video && <span className="text-red-500">Video</span>}
                            </div>
                          </div>
                          <ArrowUpRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                        </div>
                      ))}
                    </div>
                    <button onClick={() => navigate('/post-analytics')} className="mt-3 w-full py-2 text-xs text-primary font-semibold hover:underline">View Full Analytics Dashboard →</button>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* ── VIDEO TAB ── */}
        {activeStudioTab === 'videos' && (
          <div className="space-y-4">
            <div className="bg-gradient-to-r from-red-500/10 to-orange-500/10 border border-red-500/20 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-1"><Play className="w-5 h-5 text-red-500" /><h2 className="font-bold text-lg">Video Posts</h2></div>
              <p className="text-sm text-muted-foreground mb-3">Manage monetization and pricing for your video content</p>
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-background/60 rounded-lg p-3 text-center"><p className="text-xl font-bold text-red-500">{allVideoPosts.length}</p><p className="text-xs text-muted-foreground">Total Videos</p></div>
                <div className="bg-background/60 rounded-lg p-3 text-center"><p className="text-xl font-bold text-purple-500">{allVideoPosts.filter(v => v.is_monetized).length}</p><p className="text-xs text-muted-foreground">Monetized</p></div>
                <div className="bg-background/60 rounded-lg p-3 text-center"><p className="text-xl font-bold text-green-600">{formatNumber(stats.video_views)}</p><p className="text-xs text-muted-foreground">Total Views</p></div>
              </div>
            </div>

            {loadingAllVideos ? (
              <div className="flex items-center justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
            ) : allVideoPosts.length === 0 ? (
              <div className="text-center py-16 text-muted-foreground">
                <Video className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p className="font-medium">No video posts yet</p>
              </div>
            ) : (
              <div className="space-y-3">
                {allVideoPosts.map(post => {
                  const pa = Array.isArray(post.post_analytics) ? post.post_analytics[0] : post.post_analytics;
                  return (
                    <div key={post.id} className="bg-card border border-border rounded-2xl overflow-hidden">
                      <div className="flex gap-3 p-3">
                        <div className="w-20 h-14 rounded-xl bg-black overflow-hidden shrink-0 cursor-pointer" onClick={() => navigate(`/post/${post.id}`)}>
                          <video src={post.video_url} className="w-full h-full object-cover" muted playsInline />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium line-clamp-2 leading-snug">{post.content || 'Video post'}</p>
                          <div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground">
                            <span className="flex items-center gap-1"><Eye className="w-3 h-3" />{formatNumber(pa?.views ?? post.views_count ?? 0)}</span>
                            <span className="flex items-center gap-1"><Heart className="w-3 h-3" />{formatNumber(post.likes_count ?? 0)}</span>
                          </div>
                        </div>
                      </div>
                      <div className="border-t border-border px-3 py-2.5 bg-muted/20 flex items-center justify-between gap-3 flex-wrap">
                        <div className="flex items-center gap-2">
                          <button onClick={() => handleToggleMonetize(post.id, !!post.is_monetized)} disabled={togglingMonetize === post.id}
                            className={`relative w-10 h-5 rounded-full transition-colors focus:outline-none disabled:opacity-50 ${post.is_monetized ? 'bg-green-500' : 'bg-muted'}`}>
                            <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${post.is_monetized ? 'translate-x-5' : 'translate-x-0.5'}`} />
                            {togglingMonetize === post.id && <Loader2 className="absolute inset-0 m-auto w-3 h-3 animate-spin text-white" />}
                          </button>
                          <span className={`text-xs font-semibold ${post.is_monetized ? 'text-green-600' : 'text-muted-foreground'}`}>{post.is_monetized ? 'Monetized' : 'Not monetized'}</span>
                        </div>
                        {post.is_monetized && (editingPrice === post.id ? (
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs text-muted-foreground font-bold">$</span>
                            <input type="number" min="0" step="0.01" value={priceInput} onChange={e => setPriceInput(e.target.value)}
                              onKeyDown={e => { if (e.key === 'Enter') handleSavePrice(post.id); if (e.key === 'Escape') setEditingPrice(null); }}
                              className="w-20 px-2 py-1 text-xs rounded-lg border border-border bg-background focus:outline-none focus:ring-1 focus:ring-primary" autoFocus placeholder="0.00" />
                            <button onClick={() => handleSavePrice(post.id)} className="px-2 py-1 bg-primary text-primary-foreground rounded-lg text-xs font-semibold hover:opacity-90">Save</button>
                            <button onClick={() => setEditingPrice(null)} className="px-2 py-1 bg-muted rounded-lg text-xs">Cancel</button>
                          </div>
                        ) : (
                          <button onClick={() => { setEditingPrice(post.id); setPriceInput(post.price ? String(post.price) : ''); }}
                            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-border text-xs font-semibold hover:bg-muted transition-colors">
                            <DollarSign className="w-3 h-3 text-green-600" />
                            {post.price > 0 ? `$${Number(post.price).toFixed(2)}` : 'Set price'}
                          </button>
                        ))}
                        <button onClick={() => navigate(`/post-analytics/${post.id}`)} className="flex items-center gap-1 text-xs text-primary hover:underline font-medium">
                          <BarChart3 className="w-3 h-3" /> Analytics
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {videoEarnings.filter(v => v.earned > 0).length > 0 && (
              <div className="bg-card border border-border rounded-2xl p-4">
                <h3 className="font-bold mb-3 flex items-center gap-2"><DollarSign className="w-4 h-4 text-green-500" />Video Ad Revenue</h3>
                <ResponsiveContainer width="100%" height={160}>
                  <BarChart data={videoEarnings.slice(0, 5).map(v => ({ name: (v.content?.slice(0, 12) || 'Video') + '…', earned: v.earned }))} margin={{ top: 4, right: 4, left: -20, bottom: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                    <XAxis dataKey="name" tick={{ fontSize: 10 }} angle={-20} textAnchor="end" />
                    <YAxis tick={{ fontSize: 10 }} tickFormatter={v => `$${Number(v).toFixed(3)}`} />
                    <Tooltip formatter={(v: any) => [`$${Number(v).toFixed(5)}`, 'Earned']} />
                    <Bar dataKey="earned" fill="#10b981" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        )}

        {/* ── EARNINGS TAB ── */}
        {activeStudioTab === 'earnings' && (
          <div className="space-y-4">
            {/* Goal tracker */}
            <div className="bg-card border border-border rounded-2xl p-5">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2"><Zap className="w-5 h-5 text-amber-500" /><h2 className="font-bold">Monthly Earnings Goal</h2></div>
                <button onClick={() => { setEditingGoal(v => !v); setGoalInput(monthlyGoal > 0 ? String(monthlyGoal) : ''); }} className="text-xs text-primary font-semibold hover:underline">
                  {editingGoal ? 'Cancel' : monthlyGoal > 0 ? 'Edit Goal' : 'Set Goal'}
                </button>
              </div>
              {editingGoal ? (
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-muted-foreground">$</span>
                  <input type="number" min="1" step="1" value={goalInput} onChange={e => setGoalInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') saveMonthlyGoal(); if (e.key === 'Escape') setEditingGoal(false); }}
                    placeholder="e.g. 100" autoFocus
                    className="flex-1 px-3 py-2 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
                  <button onClick={saveMonthlyGoal} className="px-4 py-2 bg-primary text-primary-foreground rounded-xl text-sm font-semibold hover:opacity-90">Save</button>
                </div>
              ) : monthlyGoal === 0 ? (
                <div className="text-center py-6 text-muted-foreground">
                  <p className="text-sm">Set a monthly earnings goal to track your progress.</p>
                  <button onClick={() => { setEditingGoal(true); setGoalInput(''); }} className="mt-3 text-primary font-semibold text-sm hover:underline">+ Set Goal</button>
                </div>
              ) : (() => {
                const pct = Math.min(100, (stats.total_earnings / monthlyGoal) * 100);
                const radius = 44;
                const circ = 2 * Math.PI * radius;
                const dash = (pct / 100) * circ;
                return (
                  <div className="flex items-center gap-6">
                    <div className="relative shrink-0">
                      <svg width="112" height="112" className="-rotate-90">
                        <circle cx="56" cy="56" r={radius} strokeWidth="10" className="stroke-muted fill-none" />
                        <circle cx="56" cy="56" r={radius} strokeWidth="10" fill="none" stroke={pct >= 100 ? '#10b981' : '#f59e0b'} strokeLinecap="round" strokeDasharray={`${dash} ${circ}`} style={{ transition: 'stroke-dasharray 0.6s ease' }} />
                      </svg>
                      <div className="absolute inset-0 flex flex-col items-center justify-center">
                        <span className="text-xl font-black">{Math.round(pct)}%</span>
                        <span className="text-[9px] text-muted-foreground font-semibold uppercase tracking-wide">of goal</span>
                      </div>
                    </div>
                    <div className="flex-1 space-y-3">
                      <div><p className="text-xs text-muted-foreground mb-0.5">Earned</p><p className="text-2xl font-black text-green-600">${stats.total_earnings.toFixed(2)}</p></div>
                      <div><p className="text-xs text-muted-foreground mb-0.5">Goal</p><p className="text-lg font-bold">${monthlyGoal.toFixed(2)}</p></div>
                      <p className={`text-sm font-bold ${pct >= 100 ? 'text-green-600' : 'text-foreground'}`}>{pct >= 100 ? '🎉 Goal reached!' : `$${Math.max(0, monthlyGoal - stats.total_earnings).toFixed(2)} to go`}</p>
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* 4-Week chart */}
            {revenueBreakdown4W.some(d => d.tips + d.subscriptions + d.ads + d.other > 0) && (
              <div className="bg-card border border-border rounded-2xl p-5">
                <div className="flex items-center gap-2 mb-4"><BarChart3 className="w-5 h-5 text-primary" /><h2 className="font-bold">4-Week Revenue Breakdown</h2></div>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={revenueBreakdown4W} margin={{ top: 0, right: 0, left: -15, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="week" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                    <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} tickFormatter={v => `$${Number(v).toFixed(2)}`} />
                    <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }} formatter={(v: any, name: string) => [`$${Number(v).toFixed(4)}`, name]} />
                    <Bar dataKey="tips" name="Tips" fill="#f59e0b" stackId="rev" />
                    <Bar dataKey="subscriptions" name="Subscriptions" fill="#8b5cf6" stackId="rev" />
                    <Bar dataKey="ads" name="Ads/Videos" fill="#10b981" stackId="rev" />
                    <Bar dataKey="other" name="Other" fill="#3b82f6" stackId="rev" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Weekly chart */}
            <div className="bg-card border border-border rounded-2xl p-5">
              <h2 className="font-bold flex items-center gap-2 mb-4"><BarChart3 className="w-5 h-5 text-primary" />This Week's Earnings</h2>
              {weeklyEarnings.some(d => d.tips + d.subscriptions + d.ads + d.other > 0) ? (
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={weeklyEarnings} margin={{ top: 0, right: 0, left: -15, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="day" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} />
                    <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} tickFormatter={v => `$${v}`} />
                    <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }} formatter={(v: any, name: string) => [`$${Number(v).toFixed(4)}`, name]} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="tips" name="Tips" fill="#f59e0b" stackId="a" />
                    <Bar dataKey="subscriptions" name="Subscriptions" fill="#8b5cf6" stackId="a" />
                    <Bar dataKey="ads" name="Ads/Videos" fill="#10b981" stackId="a" />
                    <Bar dataKey="other" name="Other" fill="#3b82f6" stackId="a" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-[200px] flex flex-col items-center justify-center text-muted-foreground"><DollarSign className="w-10 h-10 opacity-20 mb-2" /><p className="text-sm">No earnings this week yet</p></div>
              )}
            </div>

            {/* CSV Export */}
            <div className="bg-card border border-border rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-4"><Download className="w-5 h-5 text-primary" /><h2 className="font-bold">Export Revenue</h2></div>
              <div className="grid grid-cols-2 gap-3 mb-4">
                <div><label className="text-xs font-semibold text-muted-foreground mb-1 block">From (month)</label><input type="month" value={exportStartMonth} onChange={e => setExportStartMonth(e.target.value)} className="w-full px-3 py-2 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" /></div>
                <div><label className="text-xs font-semibold text-muted-foreground mb-1 block">To (month)</label><input type="month" value={exportEndMonth} onChange={e => setExportEndMonth(e.target.value)} className="w-full px-3 py-2 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <button onClick={handleExportCsv} disabled={exportingCsv} className="py-3 bg-gradient-to-r from-green-500 to-emerald-600 text-white rounded-xl font-semibold hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center justify-center gap-2">
                  {exportingCsv ? <><Loader2 className="w-4 h-4 animate-spin" /> Exporting…</> : <><Download className="w-4 h-4" /> CSV</>}
                </button>
                <button onClick={handleExportPdf} disabled={exportingPdf} className="py-3 bg-gradient-to-r from-purple-500 to-indigo-600 text-white rounded-xl font-semibold hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center justify-center gap-2">
                  {exportingPdf ? <><Loader2 className="w-4 h-4 animate-spin" /> Opening…</> : <><Printer className="w-4 h-4" /> PDF</>}
                </button>
              </div>
            </div>

            {earningsHistory.length > 0 && (
              <div className="bg-card border border-border rounded-2xl p-5">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="font-bold flex items-center gap-2"><DollarSign className="w-5 h-5 text-green-600" />Monthly Earnings</h2>
                  <button onClick={() => navigate('/monetization')} className="text-sm text-primary font-semibold hover:underline flex items-center gap-1">Full Dashboard <ArrowUpRight className="w-3.5 h-3.5" /></button>
                </div>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={earningsHistory} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="month" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} />
                    <YAxis tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} tickFormatter={v => `$${v}`} />
                    <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8 }} formatter={(v: any, name: string) => [`$${Number(v).toFixed(2)}`, name === 'earned' ? 'Paid Out' : 'Pending']} />
                    <Legend formatter={v => v === 'earned' ? 'Paid Out' : 'Pending'} />
                    <Bar dataKey="earned" name="earned" fill="#10b981" radius={[4, 4, 0, 0]} stackId="a" />
                    <Bar dataKey="pending" name="pending" fill="#f59e0b" radius={[4, 4, 0, 0]} stackId="a" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            <button onClick={() => navigate('/payouts')} className="w-full py-3 bg-gradient-to-r from-green-500 to-emerald-600 text-white rounded-xl font-semibold hover:opacity-90 transition-opacity">Request Payout</button>

            {/* Revenue Split info card */}
            <div className="bg-card border border-border rounded-2xl overflow-hidden">
              <div className="px-4 py-3 border-b border-border bg-muted/20 flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-primary" /><h3 className="font-bold text-sm">Your Revenue Split</h3>
              </div>
              <div className="divide-y divide-border">
                {revSplitRows.map(row => (
                  <div key={row.label} className="px-4 py-3">
                    <div className="flex items-center justify-between mb-1.5">
                      <div>
                        <p className="text-sm font-semibold">{row.icon} {row.label}</p>
                        <p className="text-[10px] text-muted-foreground">{row.note}</p>
                      </div>
                      <div className="flex items-center gap-1.5 text-xs font-bold shrink-0">
                        <span className="px-2 py-0.5 bg-muted text-muted-foreground rounded-full">{row.platPct}% platform</span>
                        <span className="px-2 py-0.5 bg-green-500/10 text-green-600 rounded-full">{row.creatPct}% you</span>
                      </div>
                    </div>
                    <div className="h-1.5 rounded-full overflow-hidden bg-muted flex">
                      <div className="h-full bg-muted-foreground/30" style={{ width: `${row.platPct}%` }} />
                      <div className="h-full bg-green-500/70" style={{ width: `${row.creatPct}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <button onClick={() => navigate('/post-analytics')} className="w-full py-3 border border-border rounded-xl font-semibold hover:bg-muted/50 transition-colors flex items-center justify-center gap-2">
              <BarChart3 className="w-4 h-4" /> Post Analytics Dashboard
            </button>
          </div>
        )}

        {/* ── REVENUE ANALYTICS TAB ── */}
        {activeStudioTab === 'revenue' && (
          <div className="space-y-5">
            <div className="bg-gradient-to-br from-violet-500/10 via-primary/5 to-background border border-primary/20 rounded-2xl p-5">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-11 h-11 rounded-2xl bg-primary/15 flex items-center justify-center shrink-0"><DollarSign className="w-5 h-5 text-primary" /></div>
                <div>
                  <h2 className="font-black text-lg">Revenue Analytics</h2>
                  <p className="text-xs text-muted-foreground">Your earnings split across all monetization channels</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-background/60 rounded-xl p-3 text-center"><p className="text-2xl font-black text-green-600">${stats.total_earnings.toFixed(2)}</p><p className="text-[10px] text-muted-foreground mt-0.5">Your total earned</p></div>
                <div className="bg-background/60 rounded-xl p-3 text-center"><p className="text-2xl font-black text-primary">{formatNumber(stats.video_views)}</p><p className="text-[10px] text-muted-foreground mt-0.5">Video views</p></div>
              </div>
            </div>

            <div className="bg-card border border-border rounded-2xl overflow-hidden">
              <div className="px-4 py-3 border-b border-border bg-muted/20">
                <h3 className="font-bold text-sm flex items-center gap-2"><BarChart3 className="w-4 h-4 text-primary" />Revenue Split by Channel</h3>
              </div>
              <div className="divide-y divide-border">
                {revSplitRowsFull.map((row, i) => (
                  <div key={i} className="px-4 py-3.5">
                    <div className="flex items-center justify-between mb-2">
                      <div>
                        <p className="text-sm font-bold">{row.icon} {row.label}</p>
                        <p className="text-[10px] text-muted-foreground">{row.note}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-sm font-black text-green-600">{row.creatPct}%</p>
                        <p className="text-[9px] text-muted-foreground">{row.creatDesc}</p>
                      </div>
                    </div>
                    <div className="h-2 rounded-full overflow-hidden bg-muted flex">
                      <div className="h-full bg-muted-foreground/20" style={{ width: `${row.platPct}%` }} />
                      <div className="h-full bg-green-500/60" style={{ width: `${row.creatPct}%` }} />
                    </div>
                    <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
                      <span>{row.platPct}% platform</span>
                      <span className="text-green-600 font-semibold">{row.creatPct}% you</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-card border border-border rounded-2xl overflow-hidden">
              <div className="px-4 py-3 border-b border-border bg-muted/20">
                <h3 className="font-bold text-sm flex items-center gap-2"><TrendingUp className="w-4 h-4 text-amber-500" />CPM Tier Rates</h3>
              </div>
              <div className="divide-y divide-border">
                {cpmTierRows.map(t => (
                  <div key={t.tier} className="flex items-center gap-3 px-4 py-3">
                    <span className="text-xl shrink-0">{t.emoji}</span>
                    <div className="flex-1"><p className="text-sm font-bold">{t.tier}</p><p className="text-[10px] text-muted-foreground">{t.req}</p></div>
                    <div className="text-right"><p className="font-black text-green-600">{t.cpm}</p><p className="text-[10px] text-muted-foreground">per 1k views</p></div>
                  </div>
                ))}
              </div>
            </div>

            {/* ── Daily Earnings Alert Card ── */}
            <div className={`bg-card border rounded-2xl overflow-hidden ${
              alertEnabled ? 'border-amber-500/30' : 'border-border'
            }`}>
              <div className="px-4 py-3 border-b border-border bg-muted/20">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {alertEnabled
                      ? <Bell className="w-4 h-4 text-amber-500" />
                      : <BellOff className="w-4 h-4 text-muted-foreground" />}
                    <h3 className="font-bold text-sm">Daily Earnings Alert</h3>
                    {alertEnabled && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-600 font-bold border border-amber-500/20">On</span>
                    )}
                  </div>
                  <button
                    onClick={() => {
                      const next = !alertEnabled;
                      setAlertEnabled(next);
                      saveAlertPrefs(next, alertThreshold);
                    }}
                    className={`relative w-11 h-6 rounded-full transition-colors ${
                      alertEnabled ? 'bg-amber-500' : 'bg-muted'
                    }`}
                  >
                    <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                      alertEnabled ? 'translate-x-5' : 'translate-x-0'
                    }`} />
                  </button>
                </div>
              </div>
              <div className="px-4 py-4 space-y-4">
                <p className="text-xs text-muted-foreground">
                  Get a Platform Inbox notification when you earn above your threshold in a single day.
                </p>
                <div>
                  <label className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-2 block">Alert threshold (USD / day)</label>
                  <div className="flex gap-2 mb-2">
                    {['1','5','10','25','50'].map(v => (
                      <button
                        key={v}
                        onClick={() => { setAlertThreshold(v); saveAlertPrefs(alertEnabled, v); }}
                        className={`flex-1 py-2 rounded-xl font-bold text-xs border-2 transition-all ${
                          alertThreshold === v
                            ? 'border-amber-500 bg-amber-500/10 text-amber-600'
                            : 'border-border hover:border-amber-500/40'
                        }`}
                      >${v}</button>
                    ))}
                  </div>
                  <input
                    type="number" min="0.01" step="0.01"
                    placeholder="Custom threshold (e.g. 2.50)…"
                    value={!['1','5','10','25','50'].includes(alertThreshold) ? alertThreshold : ''}
                    onChange={e => { setAlertThreshold(e.target.value); saveAlertPrefs(alertEnabled, e.target.value); }}
                    className="w-full h-10 px-3 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/30"
                  />
                </div>
                {/* Today's earnings status — esbuild guard: uses pre-computed alertThresholdNum / alertTodayKey */}
                {alertTodayEarnings >= 0 && (
                  <div className={`flex items-center gap-3 p-3 rounded-xl border ${
                    alertTodayMet ? 'bg-green-500/5 border-green-500/20' : 'bg-muted/30 border-border'
                  }`}>
                    {alertTodayMet
                      ? <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />
                      : <AlertTriangle className="w-4 h-4 text-muted-foreground shrink-0" />}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold">
                        Today: <span className="text-green-600">${alertTodayEarnings.toFixed(4)}</span>
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        {alertTodayMet
                          ? alertLastSent === alertTodayKey
                            ? 'Alert already sent today ✓'
                            : 'Threshold reached — alert will be sent'
                          : `$${alertTodayGap} more to trigger`}
                      </p>
                    </div>
                  </div>
                )}
                <button
                  onClick={checkDailyEarningsAlert}
                  disabled={alertChecking}
                  className="w-full py-2.5 bg-amber-500 hover:bg-amber-600 text-white rounded-xl font-bold text-sm disabled:opacity-50 flex items-center justify-center gap-2 transition-colors"
                >
                  {alertChecking
                    ? <><Loader2 className="w-4 h-4 animate-spin" /> Checking…</>
                    : <><Bell className="w-4 h-4" /> Check Today's Earnings</>}
                </button>
                {alertLastSent && (
                  <p className="text-[10px] text-muted-foreground text-center">
                    Last alert sent: {alertLastSent}
                  </p>
                )}

                {/* ── Alert History Log ── */}
                {alertHistoryLen > 0 && (
                  <div>
                    <button
                      onClick={() => setShowAlertHistory(v => !v)}
                      className="w-full flex items-center justify-between py-2 text-xs font-bold text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <span>📋 Alert History ({alertHistoryLen})</span>
                      <span>{showAlertHistory ? '▲' : '▼'}</span>
                    </button>
                    {showAlertHistory && (
                      <div className="space-y-1.5 mt-1">
                        {alertHistoryList.map((entry: any, i: number) => (
                          <div key={i} className="flex items-center justify-between px-3 py-2 bg-muted/30 rounded-xl">
                            <div className="flex items-center gap-2">
                              <span className="text-amber-500 text-sm">💰</span>
                              <div>
                                <p className="text-xs font-semibold">${entry.amount.toFixed(4)}</p>
                                <p className="text-[10px] text-muted-foreground">{entry.date}</p>
                              </div>
                            </div>
                            <span className="text-[10px] px-2 py-0.5 bg-green-500/10 text-green-600 rounded-full font-bold">Sent ✓</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* ── Weekly Earnings Summary Card ── */}
            <div className="bg-card border border-border rounded-2xl overflow-hidden">
              <div className="px-4 py-3 border-b border-border bg-muted/20">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <TrendingUp className="w-4 h-4 text-blue-500" />
                    <h3 className="font-bold text-sm">Weekly Earnings Summary</h3>
                    {weeklyDigestEnabled && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-500/10 text-blue-600 font-bold border border-blue-500/20">On</span>
                    )}
                  </div>
                  <button
                    onClick={() => {
                      const next = !weeklyDigestEnabled;
                      setWeeklyDigestEnabled(next);
                      saveWeeklyDigestPref(next);
                    }}
                    className={`relative w-11 h-6 rounded-full transition-colors ${weeklyDigestEnabled ? 'bg-blue-500' : 'bg-muted'}`}
                  >
                    <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${weeklyDigestEnabled ? 'translate-x-5' : 'translate-x-0'}`} />
                  </button>
                </div>
              </div>
              <div className="px-4 py-4 space-y-3">
                <p className="text-xs text-muted-foreground">
                  Auto-sends a Platform Inbox digest every Monday summarising last week's earnings by source (tips, ads, video CPM).
                </p>
                {earningsStreak > 0 && (
                  <div className="flex items-center gap-3 p-3 rounded-xl bg-orange-500/5 border border-orange-500/20">
                    <span className="text-2xl">🔥</span>
                    <div>
                      <p className="text-sm font-bold text-orange-600">{earningsStreak}-Day Earning Streak!</p>
                      <p className="text-[10px] text-muted-foreground">You've earned money {earningsStreak} consecutive day{earningsStreakSuffix}</p>
                    </div>
                  </div>
                )}
                <button
                  onClick={sendWeeklyDigest}
                  disabled={weeklyDigestSending}
                  className="w-full py-2.5 bg-blue-500 hover:bg-blue-600 text-white rounded-xl font-bold text-sm disabled:opacity-50 flex items-center justify-center gap-2 transition-colors"
                >
                  {weeklyDigestSending
                    ? <><Loader2 className="w-4 h-4 animate-spin" /> Sending…</>
                    : <><TrendingUp className="w-4 h-4" /> Send This Week's Summary Now</>}
                </button>
                <p className="text-[10px] text-muted-foreground text-center">Auto-send activates on the next Monday when toggled on.</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <button onClick={() => navigate('/monetization')} className="py-3 bg-primary text-primary-foreground rounded-xl font-bold text-sm hover:opacity-90">Monetization Hub</button>
              <button onClick={() => navigate('/admin/platform-revenue')} className="py-3 border border-border rounded-xl font-bold text-sm hover:bg-muted transition-colors">Platform Revenue</button>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
