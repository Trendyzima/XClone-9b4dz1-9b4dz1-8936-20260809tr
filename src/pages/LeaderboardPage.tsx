import { useState, useEffect, useRef, useCallback } from 'react';
import { PageAdBanner } from '@/components/features/AdSenseAd';
import { TopBar } from '@/components/layout/TopBar';
import { supabase } from '@/lib/supabase';
import { useNavigate } from 'react-router-dom';
import {
  Loader2, Trophy, Flame, Users, BadgeCheck, Share2, Check,
  DollarSign, Calendar, ChevronLeft, ChevronRight, Crown, Clock, Star, Zap
} from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { formatNumber } from '@/lib/utils';
import { useSEO } from '@/hooks/useSEO';
import { toast } from 'sonner';
import { format, startOfWeek, endOfWeek, startOfMonth, endOfMonth, subWeeks, subMonths } from 'date-fns';

type Tab = 'followers' | 'earners' | 'streaks' | 'tippers' | 'video' | 'creators';
type SeasonType = 'current' | 'weekly' | 'monthly';

interface LeaderboardEntry {
  id: string;
  username: string;
  avatar_url?: string;
  verified: boolean;
  value: number;
}

interface Season {
  key: string;
  label: string;
  start: Date;
  end: Date;
  type: 'weekly' | 'monthly';
}

const RANK_EMOJI = ['🥇', '🥈', '🥉'];
const TOP3_CARD = [
  'from-yellow-400/20 via-amber-300/10 to-transparent border-yellow-400/30',
  'from-slate-400/20 via-slate-300/10 to-transparent border-slate-300/30',
  'from-amber-700/20 via-amber-600/10 to-transparent border-amber-600/30',
];
const TOP3_RING = ['ring-yellow-400/50', 'ring-slate-300/50', 'ring-amber-600/50'];
const WINNER_CROWN = ['text-yellow-500', 'text-slate-400', 'text-amber-600'];

function buildSeasons(): Season[] {
  const seasons: Season[] = [];
  const now = new Date();
  for (let i = 1; i <= 4; i++) {
    const ref = subWeeks(now, i);
    const start = startOfWeek(ref, { weekStartsOn: 1 });
    const end = endOfWeek(ref, { weekStartsOn: 1 });
    seasons.push({ key: `week-${format(start, 'yyyy-ww')}`, label: `Week of ${format(start, 'MMM d')}`, start, end, type: 'weekly' });
  }
  for (let i = 1; i <= 3; i++) {
    const ref = subMonths(now, i);
    const start = startOfMonth(ref);
    const end = endOfMonth(ref);
    seasons.push({ key: `month-${format(start, 'yyyy-MM')}`, label: format(start, 'MMMM yyyy'), start, end, type: 'monthly' });
  }
  return seasons;
}

export default function LeaderboardPage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('followers');
  const [data, setData] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [leaderboardShared, setLeaderboardShared] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const topCreators = data.slice(0, 3).map(e => `@${e.username}`);
  const seoMetricLabel = tab === 'streaks' ? 'streak days' : tab === 'earners' ? 'earnings' : tab === 'tippers' ? 'tips sent' : tab === 'video' ? 'video views' : 'followers';
  const seoFormatValue = (val: number) => tab === 'earners' || tab === 'tippers' ? `$${val.toFixed(2)}` : tab === 'streaks' ? `Day ${val}` : formatNumber(val);
  useSEO({
    title: topCreators.length > 0 ? `Leaderboard — ${topCreators.join(', ')}` : 'Top Creator Leaderboard',
    description: data.length > 0
      ? `Top creators on Testagram ranked by ${seoMetricLabel}. Leading: ${topCreators.join(', ')}. Join the creator economy and get discovered.`
      : 'See the top-earning creators on Testagram ranked by followers, earnings, and engagement.',
    url: '/leaderboard',
    type: 'website',
    keywords: 'leaderboard, top creators, testagram, creator earnings, followers ranking, viral creators',
    structuredData: data.length > 0 ? {
      '@context': 'https://schema.org',
      '@type': 'ItemList',
      name: `Testagram Creator Leaderboard — Top ${seoMetricLabel}`,
      description: `Top creators on Testagram ranked by ${seoMetricLabel}`,
      url: 'https://testagram.site/leaderboard',
      numberOfItems: Math.min(data.length, 5),
      itemListElement: data.slice(0, 5).map((entry, i) => ({
        '@type': 'ListItem', position: i + 1, name: entry.username,
        url: `https://testagram.site/profile/${entry.username}`,
        description: seoFormatValue(entry.value) + ' ' + seoMetricLabel,
      })),
    } : undefined,
  });

  const [seasonView, setSeasonView] = useState<SeasonType>('current');
  const [seasons] = useState<Season[]>(buildSeasons);
  const [selectedSeasonIdx, setSelectedSeasonIdx] = useState(0);
  const [seasonData, setSeasonData] = useState<LeaderboardEntry[]>([]);
  const [loadingSeason, setLoadingSeason] = useState(false);
  const [seasonSnapshots, setSeasonSnapshots] = useState<Record<string, LeaderboardEntry[]>>({});

  const [countdown, setCountdown] = useState('');
  useEffect(() => {
    const tick = () => {
      const now = new Date();
      const nextMonday = startOfWeek(new Date(now.getTime() + 7 * 86400000), { weekStartsOn: 1 });
      const diff = nextMonday.getTime() - now.getTime();
      const d = Math.floor(diff / 86400000);
      const h = Math.floor((diff % 86400000) / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      setCountdown(`${d}d ${h}h ${m}m`);
    };
    tick();
    const iv = setInterval(tick, 60000);
    return () => clearInterval(iv);
  }, []);

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'followers', label: 'Followers',   icon: <Users className="w-3.5 h-3.5" /> },
    { id: 'earners',   label: 'Earners',     icon: <span className="font-bold text-xs leading-none">$</span> },
    { id: 'streaks',   label: 'Streaks',     icon: <Flame className="w-3.5 h-3.5 text-orange-400" /> },
    { id: 'tippers',   label: 'Top Tippers', icon: <DollarSign className="w-3.5 h-3.5 text-yellow-500" /> },
    { id: 'video',     label: 'Video',       icon: <span className="text-xs">🎬</span> },
    { id: 'creators',  label: 'Creators',    icon: <Star className="w-3.5 h-3.5 text-amber-500" /> },
  ];

  const [creatorsData, setCreatorsData] = useState<any[]>([]);
  const [creatorsLoading, setCreatorsLoading] = useState(false);
  const [creatorsTimeframe, setCreatorsTimeframe] = useState<'monthly' | 'alltime'>('monthly');

  useEffect(() => {
    if (seasonView === 'current') fetchLeaderboard(tab);
  }, [tab, seasonView]);

  useEffect(() => {
    if (tab === 'creators' && seasonView === 'current') fetchCreatorsLeaderboard(creatorsTimeframe);
  }, [tab, creatorsTimeframe, seasonView]);

  const fetchCreatorsLeaderboard = async (timeframe: 'monthly' | 'alltime') => {
    setCreatorsLoading(true);
    try {
      let q = supabase.from('creator_earnings').select('user_id, amount');
      if (timeframe === 'monthly') q = (q as any).gte('created_at', startOfMonth(new Date()).toISOString());
      const { data: earnings } = await q;
      if (earnings && earnings.length > 0) {
        const totals: Record<string, number> = {};
        earnings.forEach((e: any) => { totals[e.user_id] = (totals[e.user_id] ?? 0) + Number(e.amount); });
        const sorted = Object.entries(totals).sort(([, a], [, b]) => b - a).slice(0, 5);
        const uids = sorted.map(([id]) => id);
        const { data: profiles } = await supabase.from('profiles').select('id, username, avatar_url, verified, creator_tier, follower_count').in('id', uids);
        const profileMap: Record<string, any> = {};
        (profiles ?? []).forEach((p: any) => { profileMap[p.id] = p; });
        setCreatorsData(sorted.filter(([id]) => profileMap[id]).map(([id, total]) => ({ ...profileMap[id], total_earnings: total })));
      } else { setCreatorsData([]); }
    } catch (e) { console.error('fetchCreatorsLeaderboard error:', e); setCreatorsData([]); }
    finally { setCreatorsLoading(false); }
  };

  useEffect(() => {
    if (seasonView !== 'current' && seasons[selectedSeasonIdx]) fetchSeasonData(seasons[selectedSeasonIdx]);
  }, [seasonView, selectedSeasonIdx]);

  const fetchSeasonData = async (season: Season) => {
    if (seasonSnapshots[season.key]) { setSeasonData(seasonSnapshots[season.key]); return; }
    setLoadingSeason(true);
    try {
      const { data: snap } = await supabase.from('leaderboard_seasons').select('snapshots').eq('season_key', season.key).maybeSingle();
      if (snap?.snapshots?.length > 0) {
        const parsed = snap.snapshots as LeaderboardEntry[];
        setSeasonData(parsed);
        setSeasonSnapshots(prev => ({ ...prev, [season.key]: parsed }));
      } else {
        const { data: posts } = await supabase.from('posts').select('user_id, likes_count, views_count').gte('created_at', season.start.toISOString()).lte('created_at', season.end.toISOString());
        if (posts && posts.length > 0) {
          const totals: Record<string, number> = {};
          posts.forEach((p: any) => { totals[p.user_id] = (totals[p.user_id] ?? 0) + (p.likes_count ?? 0); });
          const sorted = Object.entries(totals).sort(([, a], [, b]) => b - a).slice(0, 50);
          const uids = sorted.map(([id]) => id);
          const { data: profiles } = await supabase.from('profiles').select('id, username, avatar_url, verified').in('id', uids);
          const profileMap: Record<string, any> = {};
          (profiles ?? []).forEach((p: any) => { profileMap[p.id] = p; });
          const result = sorted.filter(([id]) => profileMap[id]).map(([id, val]) => ({ ...profileMap[id], value: val }));
          setSeasonData(result);
          setSeasonSnapshots(prev => ({ ...prev, [season.key]: result }));
          await supabase.from('leaderboard_seasons').upsert({ season_type: season.type, season_key: season.key, start_date: season.start.toISOString(), end_date: season.end.toISOString(), snapshots: result }, { onConflict: 'season_type,season_key' }).catch(() => {});
        } else { setSeasonData([]); }
      }
    } catch (e) { console.error('fetchSeasonData error:', e); setSeasonData([]); }
    finally { setLoadingSeason(false); }
  };

  const fetchLeaderboard = async (activeTab: Tab) => {
    setLoading(true);
    if (activeTab === 'video') {
      const { data: videoPosts } = await supabase.from('posts').select('user_id, views_count').eq('is_video', true);
      if (videoPosts && videoPosts.length > 0) {
        const totals: Record<string, number> = {};
        videoPosts.forEach((p: any) => { totals[p.user_id] = (totals[p.user_id] ?? 0) + (p.views_count ?? 0); });
        const sorted = Object.entries(totals).sort(([, a], [, b]) => b - a).slice(0, 50);
        const uids = sorted.map(([id]) => id);
        const { data: profiles } = await supabase.from('profiles').select('id, username, avatar_url, verified').in('id', uids);
        const profileMap: Record<string, any> = {};
        (profiles ?? []).forEach((p: any) => { profileMap[p.id] = p; });
        setData(sorted.filter(([id]) => profileMap[id]).map(([id, total]) => ({ ...profileMap[id], value: total })));
      } else { setData([]); }
      setLoading(false);
      return;
    }
    if (activeTab === 'tippers') {
      const { data: tips } = await supabase.from('tips').select('from_user_id, amount');
      if (tips && tips.length > 0) {
        const totals: Record<string, number> = {};
        tips.forEach((t: any) => { totals[t.from_user_id] = (totals[t.from_user_id] ?? 0) + Number(t.amount); });
        const sorted = Object.entries(totals).sort(([, a], [, b]) => b - a).slice(0, 50);
        const uids = sorted.map(([id]) => id);
        const { data: profiles } = await supabase.from('profiles').select('id, username, avatar_url, verified').in('id', uids);
        const profileMap: Record<string, any> = {};
        (profiles ?? []).forEach((p: any) => { profileMap[p.id] = p; });
        setData(sorted.filter(([id]) => profileMap[id]).map(([id, total]) => ({ ...profileMap[id], value: total })));
      } else { setData([]); }
      setLoading(false);
      return;
    }
    if (activeTab === 'followers') {
      const { data: users } = await supabase.from('profiles').select('id, username, avatar_url, verified, follower_count').order('follower_count', { ascending: false }).limit(50);
      setData((users || []).map((u: any) => ({ ...u, value: u.follower_count ?? 0 })));
    } else if (activeTab === 'earners') {
      const { data: users } = await supabase.from('profiles').select('id, username, avatar_url, verified, total_earnings').gt('total_earnings', 0).order('total_earnings', { ascending: false }).limit(50);
      setData((users || []).map((u: any) => ({ ...u, value: Number(u.total_earnings ?? 0) })));
    } else {
      const { data: rewards } = await supabase.from('daily_rewards').select('streak_day, profiles(id, username, avatar_url, verified)').order('streak_day', { ascending: false }).limit(50);
      setData((rewards || []).filter((r: any) => r.user_profiles).map((r: any) => ({ ...(r.user_profiles as any), value: r.streak_day ?? 0 })));
    }
    setLoading(false);
  };

  const formatValue = (val: number) => {
    if (tab === 'earners') return `$${val.toFixed(2)}`;
    if (tab === 'streaks') return `Day ${val}`;
    if (tab === 'tippers') return `$${val.toFixed(2)}`;
    if (tab === 'video') return formatNumber(val) + ' views';
    return formatNumber(val);
  };

  const metricLabel = () => {
    if (tab === 'streaks') return '🔥 streak';
    if (tab === 'earners') return 'earned';
    if (tab === 'tippers') return '💰 tipped';
    if (tab === 'video') return '🎬 views';
    return 'followers';
  };

  const handleShare = async (entry: LeaderboardEntry, rank: number) => {
    setCopiedId(entry.id);
    const rankLabel = rank === 1 ? '🥇' : rank === 2 ? '🥈' : '🥉';
    const metricText = tab === 'followers' ? `${formatNumber(entry.value)} followers` : tab === 'earners' ? `$${entry.value.toFixed(2)} earned` : `Day ${entry.value} streak`;
    const text = `${rankLabel} I'm ranked #${rank} on Tsocial's Leaderboard with ${metricText}! 🚀`;
    if (navigator.share) navigator.share({ title: 'Tsocial Leaderboard', text }).catch(() => {});
    else { navigator.clipboard.writeText(text); toast.success('Copied!'); }
    setTimeout(() => setCopiedId(null), 2000);
  };

  const displayData = seasonView === 'current' ? data : seasonData;
  const isSeasonLoading = seasonView !== 'current' ? loadingSeason : loading;
  const top3 = displayData.slice(0, 3);
  const rest = displayData.slice(3);
  const selectedSeason = seasons[selectedSeasonIdx];

  const renderPodium = (entries: LeaderboardEntry[], isSeason: boolean) => (
    <>
      {entries.slice(0, 3).map((entry, i) => (
        <div key={entry.id} className={`w-full flex items-center gap-4 p-4 rounded-2xl border bg-gradient-to-r ${TOP3_CARD[i]} relative overflow-hidden`}>
          {isSeason && i === 0 && (
            <div className="absolute top-2 right-3 flex items-center gap-1 bg-yellow-400/20 border border-yellow-400/30 px-2 py-0.5 rounded-full">
              <Crown className="w-3 h-3 text-yellow-500" />
              <span className="text-[10px] font-bold text-yellow-600">Season Winner</span>
            </div>
          )}
          <button onClick={() => navigate(`/profile/${entry.username}`)} className="flex items-center gap-4 flex-1 min-w-0 text-left">
            <span className="text-4xl leading-none">{RANK_EMOJI[i]}</span>
            <div className={`w-14 h-14 rounded-full bg-muted overflow-hidden shrink-0 ring-2 ${TOP3_RING[i]}`}>
              {entry.avatar_url
                ? <img src={entry.avatar_url} alt={entry.username} className="w-full h-full object-cover" />
                : <div className="w-full h-full flex items-center justify-center text-xl font-bold">{entry.username[0]?.toUpperCase()}</div>}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <p className="font-bold text-base truncate">{entry.username}</p>
                {entry.verified && <BadgeCheck className="w-4 h-4 text-primary shrink-0" fill="currentColor" />}
                {isSeason && i < 3 && <Crown className={`w-3.5 h-3.5 shrink-0 ${WINNER_CROWN[i]}`} />}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">@{entry.username}</p>
            </div>
          </button>
          <div className="flex flex-col items-end shrink-0 gap-1">
            <p className="text-2xl font-black">{isSeason ? formatNumber(entry.value) : formatValue(entry.value)}</p>
            <p className="text-xs font-medium text-muted-foreground">{isSeason ? 'likes' : metricLabel()}</p>
            {!isSeason && (
              <button onClick={() => handleShare(entry, i + 1)} className="p-1.5 rounded-full hover:bg-background/50 text-muted-foreground mt-1">
                {copiedId === entry.id ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Share2 className="w-3.5 h-3.5" />}
              </button>
            )}
          </div>
        </div>
      ))}
    </>
  );

  return (
    <div className="min-h-screen bg-background pb-20 md:pb-0">
      <TopBar title="Leaderboard" showBack />
      <LeaderboardAdBanner />

      <div className="px-4 py-5 bg-gradient-to-br from-yellow-500/10 to-amber-500/5 border-b border-border flex items-center gap-4">
        <div className="w-12 h-12 rounded-xl bg-yellow-500/20 flex items-center justify-center shrink-0">
          <Trophy className="w-7 h-7 text-yellow-500" />
        </div>
        <div className="flex-1">
          <h1 className="text-xl font-bold">Leaderboard</h1>
          <div className="flex items-center gap-2 mt-0.5">
            <Clock className="w-3 h-3 text-muted-foreground" />
            <p className="text-xs text-muted-foreground">Resets in <span className="font-semibold text-foreground">{countdown}</span></p>
          </div>
        </div>
        <button
          onClick={async () => {
            const url = `${window.location.origin}/leaderboard`;
            const text = `🏆 Check out the Tsocial Leaderboard! → ${url}`;
            if (navigator.share) navigator.share({ title: 'Tsocial Leaderboard', text, url }).catch(() => {});
            else { await navigator.clipboard.writeText(text); toast.success('Copied!'); }
            setLeaderboardShared(true);
            setTimeout(() => setLeaderboardShared(false), 2000);
          }}
          className="p-2 rounded-full hover:bg-muted transition-colors text-muted-foreground"
        >
          {leaderboardShared ? <Check className="w-5 h-5 text-green-500" /> : <Share2 className="w-5 h-5" />}
        </button>
      </div>

      <div className="px-4 pt-3 pb-1 flex gap-2 border-b border-border bg-background">
        {(['current','weekly','monthly'] as const).map(sv => (
          <button key={sv} onClick={() => setSeasonView(sv)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-colors capitalize ${
              seasonView === sv
                ? sv === 'current' ? 'bg-primary text-primary-foreground' : sv === 'weekly' ? 'bg-blue-500 text-white' : 'bg-purple-500 text-white'
                : 'bg-muted text-muted-foreground hover:bg-muted/80'
            }`}>
            {sv === 'current' ? <><Trophy className="w-3 h-3" /> Current</> : <><Calendar className="w-3 h-3" /> {sv.charAt(0).toUpperCase() + sv.slice(1)}</>}
          </button>
        ))}
      </div>

      {seasonView !== 'current' && (
        <div className="px-4 py-2 bg-muted/30 border-b border-border">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setSelectedSeasonIdx(i => Math.min(i + 1, seasons.filter(s => s.type === (seasonView === 'weekly' ? 'weekly' : 'monthly')).length - 1))}
              disabled={selectedSeasonIdx >= seasons.filter(s => s.type === (seasonView === 'weekly' ? 'weekly' : 'monthly')).length - 1}
              className="p-1.5 rounded-full hover:bg-muted transition-colors disabled:opacity-30"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <div className="flex-1 overflow-x-auto flex gap-1.5 scrollbar-hide py-0.5">
              {seasons.map((s, i) => ({ s, i })).filter(({ s }) => s.type === (seasonView === 'weekly' ? 'weekly' : 'monthly')).map(({ s, i }) => (
                <button key={s.key} onClick={() => setSelectedSeasonIdx(i)}
                  className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold transition-colors whitespace-nowrap ${
                    selectedSeasonIdx === i
                      ? seasonView === 'weekly' ? 'bg-blue-500 text-white' : 'bg-purple-500 text-white'
                      : 'bg-background border border-border text-muted-foreground hover:bg-muted'
                  }`}>
                  {s.label}
                </button>
              ))}
            </div>
            <button onClick={() => setSelectedSeasonIdx(i => Math.max(i - 1, 0))} disabled={selectedSeasonIdx === 0} className="p-1.5 rounded-full hover:bg-muted transition-colors disabled:opacity-30">
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
          {selectedSeason && (
            <p className="text-[10px] text-center text-muted-foreground mt-1">
              {format(selectedSeason.start, 'MMM d')} – {format(selectedSeason.end, 'MMM d, yyyy')} · ranked by likes
            </p>
          )}
        </div>
      )}

      {seasonView === 'current' && (
        <div className="sticky top-14 z-30 bg-background/95 backdrop-blur-sm border-b border-border">
          <div className="flex">
            {tabs.map((t) => (
              <button key={t.id} onClick={() => setTab(t.id)}
                className={`flex-1 px-3 py-3.5 font-semibold transition-colors border-b-2 flex items-center justify-center gap-1.5 text-sm ${
                  tab === t.id ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:bg-muted/50'
                }`}>
                {t.icon}<span>{t.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {tab === 'creators' && seasonView === 'current' && (
        <CreatorLeaderboard data={creatorsData} loading={creatorsLoading} timeframe={creatorsTimeframe} onTimeframeChange={setCreatorsTimeframe} onNavigate={(p) => navigate(p)} />
      )}

      {(tab !== 'creators' || seasonView !== 'current') && isSeasonLoading ? (
        <div className="flex items-center justify-center py-24"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
      ) : (tab !== 'creators' || seasonView !== 'current') && displayData.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-muted-foreground">
          <Trophy className="w-16 h-16 mb-4 opacity-20" />
          <p className="font-semibold text-lg">No entries</p>
          <p className="text-sm mt-1">{seasonView !== 'current' ? 'No data for this season yet' : 'Be the first on the leaderboard!'}</p>
        </div>
      ) : (tab !== 'creators' || seasonView !== 'current') && (
        <>
          {top3.length > 0 && (
            <div className="p-4 space-y-3">
              {seasonView !== 'current' && (
                <div className="flex items-center gap-2 px-1 mb-1">
                  <Crown className="w-4 h-4 text-yellow-500" />
                  <span className="text-sm font-bold">Season Winners</span>
                  <span className="text-xs text-muted-foreground">· {selectedSeason?.label}</span>
                </div>
              )}
              {renderPodium(top3, seasonView !== 'current')}
              {/* Badge Awards Strip — current leaderboard only */}
              {seasonView === 'current' && <BadgeAwardsStrip />}
            </div>
          )}

          {rest.length > 0 && (
            <div className="flex items-center gap-3 px-4 pb-1">
              <div className="flex-1 h-px bg-border" />
              <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Ranks 4 – {displayData.length}</span>
              <div className="flex-1 h-px bg-border" />
            </div>
          )}

          <div className="divide-y divide-border border-t border-border">
            {rest.map((entry, i) => (
              <button key={entry.id} onClick={() => navigate(`/profile/${entry.username}`)}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/40 transition-colors text-left">
                <span className="w-8 text-center text-sm font-bold text-muted-foreground shrink-0">{i + 4}</span>
                <div className="w-10 h-10 rounded-full bg-muted overflow-hidden shrink-0">
                  {entry.avatar_url
                    ? <img src={entry.avatar_url} alt={entry.username} className="w-full h-full object-cover" />
                    : <div className="w-full h-full flex items-center justify-center font-bold text-sm">{entry.username[0]?.toUpperCase()}</div>}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1">
                    <p className="font-semibold text-sm truncate">{entry.username}</p>
                    {entry.verified && <BadgeCheck className="w-3.5 h-3.5 text-primary shrink-0" fill="currentColor" />}
                  </div>
                  <p className="text-xs text-muted-foreground">@{entry.username}</p>
                </div>
                <p className="font-bold text-sm shrink-0">
                  {seasonView !== 'current' ? formatNumber(entry.value) : (tab === 'streaks' ? `🔥 ${formatValue(entry.value)}` : formatValue(entry.value))}
                </p>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ── AdSense banner ────────────────────────────────────────────────────────────
function LeaderboardAdBanner() { return <PageAdBanner />; }

// ── Badge Awards Strip ────────────────────────────────────────────────────────
function BadgeAwardsStrip() {
  const navigate = useNavigate();
  const [badges, setBadges] = useState<{ label: string; emoji: string; user: any; value: string; color: string }[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchBadges = useCallback(async () => {
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();
    try {
      const [earningsRes, postsRes, videosRes] = await Promise.all([
        supabase.from('creator_earnings').select('user_id, amount').gte('created_at', sevenDaysAgo).eq('status', 'paid'),
        supabase.from('posts').select('user_id, likes_count, reposts_count').gte('created_at', sevenDaysAgo),
        supabase.from('posts').select('user_id, views_count').eq('is_video', true).gte('created_at', sevenDaysAgo),
      ]);

      const earningTotals: Record<string, number> = {};
      (earningsRes.data ?? []).forEach((e: any) => { earningTotals[e.user_id] = (earningTotals[e.user_id] ?? 0) + Number(e.amount); });
      const topEarnerId = Object.entries(earningTotals).sort((a, b) => b[1] - a[1])[0]?.[0];
      const topEarnerAmt = topEarnerId ? earningTotals[topEarnerId] : 0;

      const viralTotals: Record<string, number> = {};
      (postsRes.data ?? []).forEach((p: any) => { viralTotals[p.user_id] = (viralTotals[p.user_id] ?? 0) + (p.likes_count ?? 0) + (p.reposts_count ?? 0) * 2; });
      const topViralId = Object.entries(viralTotals).sort((a, b) => b[1] - a[1])[0]?.[0];
      const topViralScore = topViralId ? viralTotals[topViralId] : 0;

      const videoTotals: Record<string, number> = {};
      (videosRes.data ?? []).forEach((p: any) => { videoTotals[p.user_id] = (videoTotals[p.user_id] ?? 0) + (p.views_count ?? 0); });
      const topVideoId = Object.entries(videoTotals).sort((a, b) => b[1] - a[1])[0]?.[0];
      const topVideoViews = topVideoId ? videoTotals[topVideoId] : 0;

      const uids = [...new Set([topEarnerId, topViralId, topVideoId].filter(Boolean))];
      if (uids.length === 0) { setLoading(false); return; }

      const { data: profiles } = await supabase.from('profiles').select('id, username, avatar_url, verified').in('id', uids);
      const pm: Record<string, any> = {};
      (profiles ?? []).forEach((p: any) => { pm[p.id] = p; });

      const result = [
        topEarnerId && topEarnerAmt > 0 && {
          label: 'Top Earner', emoji: '💰', user: pm[topEarnerId],
          value: `$${topEarnerAmt.toFixed(2)}`,
          color: 'from-yellow-500/20 to-amber-400/10 border-yellow-400/40 text-yellow-700 dark:text-yellow-400',
        },
        topViralId && topViralScore > 0 && {
          label: 'Most Viral', emoji: '🔥', user: pm[topViralId],
          value: `${topViralScore.toLocaleString()} engagements`,
          color: 'from-orange-500/20 to-red-400/10 border-orange-400/40 text-orange-700 dark:text-orange-400',
        },
        topVideoId && topVideoViews > 0 && {
          label: 'Video King', emoji: '🎬', user: pm[topVideoId],
          value: `${formatNumber(topVideoViews)} views`,
          color: 'from-blue-500/20 to-cyan-400/10 border-blue-400/40 text-blue-700 dark:text-blue-400',
        },
      ].filter(Boolean) as any[];

      setBadges(result);
    } catch (e) {
      console.error('BadgeAwardsStrip error:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchBadges(); }, [fetchBadges]);

  if (loading || badges.length === 0) return null;

  return (
    <div className="mt-4">
      <div className="flex items-center gap-2 mb-2">
        <Zap className="w-4 h-4 text-primary" />
        <h3 className="text-sm font-bold">This Week's Badge Awards</h3>
      </div>
      <div className="grid grid-cols-1 gap-2">
        {badges.map((badge) => (
          <button
            key={badge.label}
            onClick={() => badge.user && navigate(`/profile/${badge.user.username}`)}
            className={`flex items-center gap-3 p-3 rounded-2xl border bg-gradient-to-r ${badge.color} text-left hover:scale-[1.01] transition-transform`}
          >
            <span className="text-2xl shrink-0">{badge.emoji}</span>
            <div className="flex-1 min-w-0">
              <span className="text-xs font-black uppercase tracking-wide opacity-70">{badge.label}</span>
              {badge.user && (
                <div className="flex items-center gap-1.5 mt-0.5">
                  <div className="w-5 h-5 rounded-full bg-muted/60 overflow-hidden shrink-0">
                    {badge.user.avatar_url
                      ? <img src={badge.user.avatar_url} alt={badge.user.username} className="w-full h-full object-cover" />
                      : <div className="w-full h-full flex items-center justify-center text-[8px] font-black">{badge.user.username?.[0]?.toUpperCase()}</div>}
                  </div>
                  <span className="text-sm font-bold truncate">@{badge.user.username}</span>
                  {badge.user.verified && <BadgeCheck className="w-3.5 h-3.5 text-primary shrink-0" fill="currentColor" />}
                </div>
              )}
            </div>
            <span className="text-xs font-bold shrink-0">{badge.value}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Creator Leaderboard Panel ─────────────────────────────────────────────────
function CreatorLeaderboard({ data, loading, timeframe, onTimeframeChange, onNavigate }: {
  data: any[]; loading: boolean; timeframe: 'monthly' | 'alltime';
  onTimeframeChange: (t: 'monthly' | 'alltime') => void; onNavigate: (p: string) => void;
}) {
  const TIER_CFG: Record<string, { icon: string; color: string }> = {
    gold:   { icon: '🥇', color: 'text-yellow-600' },
    silver: { icon: '🥈', color: 'text-slate-500' },
    bronze: { icon: '🥉', color: 'text-amber-700' },
    free:   { icon: '⭐', color: 'text-muted-foreground' },
  };

  const chartData = data.slice(0, 10).map(c => ({
    name: '@' + (c.username?.slice(0, 8) ?? ''),
    earnings: parseFloat(c.total_earnings?.toFixed(2) ?? '0'),
  }));

  return (
    <div className="pb-20">
      <div className="px-4 py-4 bg-gradient-to-br from-amber-500/10 via-yellow-400/5 to-transparent border-b border-border">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 rounded-xl bg-amber-500/20 flex items-center justify-center shrink-0">
            <Star className="w-5 h-5 text-amber-600" />
          </div>
          <div>
            <h2 className="font-bold text-base">Creator Leaderboard</h2>
            <p className="text-xs text-muted-foreground">Top creators by earnings</p>
          </div>
        </div>
        <div className="flex gap-2">
          {(['monthly', 'alltime'] as const).map(t => (
            <button key={t} onClick={() => onTimeframeChange(t)}
              className={`px-4 py-1.5 rounded-full text-xs font-bold transition-colors ${timeframe === t ? 'bg-amber-500 text-white' : 'bg-muted text-muted-foreground hover:bg-muted/80'}`}>
              {t === 'monthly' ? '📅 This Month' : '🏆 All Time'}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-amber-500" /></div>
      ) : data.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
          <Star className="w-16 h-16 mb-4 opacity-20" />
          <p className="font-semibold">No creator earnings yet</p>
          <p className="text-sm mt-1">Start earning from tips, subscriptions and ad revenue</p>
          <button onClick={() => onNavigate('/monetization')} className="mt-4 px-5 py-2.5 bg-amber-500 text-white rounded-full text-sm font-bold hover:bg-amber-600 transition-colors">Enable Monetization</button>
        </div>
      ) : (
        <>
          <div className="px-4 py-4 border-b border-border">
            <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-3">Top 10 Earnings Chart</p>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={chartData} margin={{ top: 4, right: 4, left: -24, bottom: 4 }}>
                <XAxis dataKey="name" tick={{ fontSize: 9 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 9 }} axisLine={false} tickLine={false} />
                <Tooltip formatter={(val: number) => [`$${val.toFixed(2)}`, 'Earnings']} contentStyle={{ fontSize: 11, borderRadius: 8 }} />
                <Bar dataKey="earnings" fill="#f59e0b" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="p-4 space-y-3">
            {data.slice(0, 3).map((creator, i) => {
              const tier = creator.creator_tier ?? 'free';
              const cfg = TIER_CFG[tier] ?? TIER_CFG['free'];
              const rankEmojis = ['🥇', '🥈', '🥉'];
              return (
                <button key={creator.id} onClick={() => onNavigate(`/profile/${creator.username}`)}
                  className={`w-full flex items-center gap-4 p-4 rounded-2xl border bg-gradient-to-r text-left transition-all hover:scale-[1.01] ${
                    i === 0 ? 'from-yellow-400/20 to-amber-300/10 border-yellow-400/30' :
                    i === 1 ? 'from-slate-400/20 to-slate-300/10 border-slate-300/30' :
                    'from-amber-700/20 to-amber-600/10 border-amber-600/30'
                  }`}>
                  <span className="text-3xl shrink-0">{rankEmojis[i]}</span>
                  <div className={`w-12 h-12 rounded-full bg-muted overflow-hidden shrink-0 ring-2 ${i === 0 ? 'ring-yellow-400/50' : i === 1 ? 'ring-slate-300/50' : 'ring-amber-600/50'}`}>
                    {creator.avatar_url
                      ? <img src={creator.avatar_url} alt={creator.username} className="w-full h-full object-cover" />
                      : <div className="w-full h-full flex items-center justify-center font-bold text-lg">{creator.username[0]?.toUpperCase()}</div>}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <p className="font-bold text-base truncate">{creator.username}</p>
                      {creator.verified && <BadgeCheck className="w-4 h-4 text-primary shrink-0" fill="currentColor" />}
                      <span className="text-sm shrink-0">{cfg.icon}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">{(creator.follower_count ?? 0).toLocaleString()} followers</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-2xl font-black text-amber-600">${creator.total_earnings?.toFixed(2)}</p>
                    <p className="text-[10px] text-muted-foreground font-medium">earned</p>
                  </div>
                </button>
              );
            })}
          </div>
          {data.length > 3 && (
            <div className="divide-y divide-border border-t border-border">
              {data.slice(3).map((creator, i) => {
                const tier = creator.creator_tier ?? 'free';
                const cfg = TIER_CFG[tier] ?? TIER_CFG['free'];
                return (
                  <button key={creator.id} onClick={() => onNavigate(`/profile/${creator.username}`)} className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/40 transition-colors text-left">
                    <span className="w-8 text-center text-sm font-bold text-muted-foreground shrink-0">{i + 4}</span>
                    <div className="w-10 h-10 rounded-full bg-muted overflow-hidden shrink-0">
                      {creator.avatar_url
                        ? <img src={creator.avatar_url} alt={creator.username} className="w-full h-full object-cover" />
                        : <div className="w-full h-full flex items-center justify-center font-bold text-sm">{creator.username[0]?.toUpperCase()}</div>}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1">
                        <p className="font-semibold text-sm truncate">{creator.username}</p>
                        {creator.verified && <BadgeCheck className="w-3.5 h-3.5 text-primary shrink-0" fill="currentColor" />}
                        <span className="text-xs shrink-0">{cfg.icon}</span>
                      </div>
                      <p className="text-xs text-muted-foreground">{(creator.follower_count ?? 0).toLocaleString()} followers</p>
                    </div>
                    <p className="font-bold text-sm shrink-0 text-amber-600">${creator.total_earnings?.toFixed(2)}</p>
                  </button>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
