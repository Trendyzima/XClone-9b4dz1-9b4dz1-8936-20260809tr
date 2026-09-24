
import { useState, useEffect, useCallback } from 'react';

function runWhenIdle(task: () => void, timeout = 1400) {
  if (typeof window === 'undefined') return;
  const ric = (window as any).requestIdleCallback;
  if (typeof ric === 'function') { const id = ric(task, { timeout }); return () => (window as any).cancelIdleCallback?.(id); }
  const id = window.setTimeout(task, 80); return () => window.clearTimeout(id);
}

import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { TrendingUp, Users, Hash, Radio, Sparkles, Plus, Check, RefreshCw, Trophy, Loader2, X, DollarSign } from 'lucide-react';
import { formatNumber } from '@/lib/utils';
import { UserSuggestionsWidget } from '../features/UserSuggestionsWidget';
import { ContentSuggestionsWidget } from '../features/ContentSuggestionsWidget';
import { toast } from 'sonner';

interface TrendingHashtag {
  id: string;
  tag: string;
  usage_count: number;
  daily_posts: number;
  trend_score: number;
}

interface TrendingTopic {
  id: string;
  topic: string;
  category: string;
  posts_count: number;
}

interface Community {
  id: string;
  name: string;
  display_name: string;
  icon_url?: string;
  member_count: number;
  description?: string; // Added missing property
}

interface Space {
  id: string;
  title: string;
  host_id: string;
  listener_count: number;
  is_live: boolean;
  user_profiles: {
    username: string;
    avatar_url?: string;
  };
}

interface LeaderboardEntry {
  user_id: string;
  username: string;
  avatar_url: string | null;
  verified: boolean;
  weekly_earnings: number;
}

// ── Creator Earnings Widget ────────────────────────────────────────────────────
function CreatorEarningsWidget() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [monthEarnings, setMonthEarnings] = useState(0);
  const [pendingPayout, setPendingPayout] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);
    const cancel = runWhenIdle(() => Promise.all([
      supabase.from('creator_earnings').select('amount').eq('user_id', user.id).gte('created_at', startOfMonth.toISOString()),
      supabase.from('user_monetization').select('pending_user_payout').eq('user_id', user.id).maybeSingle(),
    ]).then(([earningsRes, monRes]) => {
      const total = (earningsRes.data ?? []).reduce((s: number, r: any) => s + Number(r.amount ?? 0), 0);
      setMonthEarnings(total);
      setPendingPayout(Number(monRes.data?.pending_user_payout ?? 0));
      setLoading(false);
    }));
    return () => cancel?.();
  }, [user?.id]);

  if (!user || loading || (monthEarnings === 0 && pendingPayout === 0)) return null;

  return (
    <div className="bg-gradient-to-br from-green-500/8 to-emerald-500/4 rounded-2xl p-4 border border-green-500/20 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <DollarSign className="w-4 h-4 text-green-600" />
          <h3 className="font-bold text-sm">My Earnings</h3>
        </div>
        <button
          onClick={() => navigate('/payouts')}
          className="text-[11px] font-bold text-green-700 hover:text-green-800 hover:underline transition-colors"
        >
          Withdraw →
        </button>
      </div>
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[10px] text-muted-foreground">This month</p>
            <p className="text-2xl font-black text-green-600 leading-none">${monthEarnings.toFixed(2)}</p>
          </div>
          {pendingPayout > 0 && (
            <div className="text-right">
              <p className="text-[10px] text-muted-foreground">Pending payout</p>
              <p className="text-base font-black text-amber-600">${pendingPayout.toFixed(2)}</p>
            </div>
          )}
        </div>
        <div className="h-1.5 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-green-400 to-emerald-500 rounded-full transition-all duration-500"
            style={{ width: '100%' }}
          />
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => navigate('/monetization')}
            className="flex-1 py-2 bg-green-500/10 hover:bg-green-500/20 text-green-700 dark:text-green-400 text-xs font-bold rounded-xl transition-colors flex items-center justify-center gap-1"
          >
            <TrendingUp className="w-3.5 h-3.5" />Analytics
          </button>
          <button
            onClick={() => navigate('/payouts')}
            className="flex-1 py-2 bg-green-600 hover:bg-green-700 text-white text-xs font-bold rounded-xl transition-colors flex items-center justify-center gap-1.5"
          >
            <DollarSign className="w-3.5 h-3.5" />Withdraw
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Creator Leaderboard Widget (compact podium) ────────────────────────────────
function CreatorLeaderboardWidget() {
  const navigate = useNavigate();
  const [leaders, setLeaders] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchLeaders = useCallback(async () => {
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();
    const { data } = await supabase
      .from('creator_earnings')
      .select('user_id, amount')
      .gte('created_at', sevenDaysAgo)
      .eq('status', 'paid');

    // Aggregate by user — parallel arrays (esbuild guard: no index-sig object)
    const uids: string[] = [];
    const amounts: number[] = [];
    for (const row of data ?? []) {
      const idx = uids.indexOf(row.user_id);
      if (idx >= 0) amounts[idx] += Number(row.amount ?? 0);
      else { uids.push(row.user_id); amounts.push(Number(row.amount ?? 0)); }
    }
    const sorted = amounts
      .map((a, i) => ({ a, i }))
      .sort((x, y) => y.a - x.a)
      .slice(0, 3);
    const topIds = sorted.map(s => uids[s.i]);
    const topAmounts = sorted.map(s => s.a);

    if (topIds.length === 0) { setLoading(false); return; }

    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, username, avatar_url, verified')
      .in('id', topIds);

    const merged: LeaderboardEntry[] = topIds.map((uid, rank) => {
      const p = (profiles ?? []).find((pr: any) => pr.id === uid);
      return {
        user_id: uid,
        username: p?.username ?? 'Unknown',
        avatar_url: p?.avatar_url ?? null,
        verified: p?.verified ?? false,
        weekly_earnings: topAmounts[rank],
      };
    });
    setLeaders(merged);
    setLoading(false);
  }, []);

  useEffect(() => {
    const cancel = runWhenIdle(fetchLeaders);
    const iv = setInterval(fetchLeaders, 60_000);
    return () => { cancel?.(); clearInterval(iv); };
  }, [fetchLeaders]);

  if (loading || leaders.length === 0) return null;

  const maxEarnings = Math.max(...leaders.map(l => l.weekly_earnings), 1);
  const podiumBorders = ['border-yellow-400/60', 'border-slate-300/60', 'border-amber-600/60'];
  const podiumRings  = ['ring-yellow-400/30', 'ring-slate-300/30', 'ring-amber-600/30'];
  const rankEmojis   = ['🥇', '🥈', '🥉'];

  return (
    <div className="bg-gradient-to-br from-amber-500/8 to-orange-500/4 rounded-2xl p-4 border border-amber-500/20 shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Trophy className="w-4 h-4 text-amber-500" />
          <h3 className="font-bold text-sm">Top Creators This Week</h3>
        </div>
        <button
          onClick={() => navigate('/leaderboard/creators')}
          className="text-[11px] font-bold text-amber-600 hover:text-amber-700 hover:underline transition-colors"
        >
          Full board →
        </button>
      </div>

      {/* Compact podium strip */}
      <div className="flex items-end justify-center gap-2 mb-4">
        {/* 2nd place (left) */}
        {leaders[1] && (
          <div className="flex flex-col items-center gap-1 flex-1">
            <button
              onClick={() => navigate(`/profile/${leaders[1].username}`)}
              className={`relative w-10 h-10 rounded-full overflow-hidden border-2 ${podiumBorders[1]} ring-1 ${podiumRings[1]}`}
            >
              {leaders[1].avatar_url
                ? <img src={leaders[1].avatar_url} alt={leaders[1].username} className="w-full h-full object-cover" />
                : <div className="w-full h-full bg-muted flex items-center justify-center text-xs font-black">{leaders[1].username[0]?.toUpperCase()}</div>}
              <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-slate-300 rounded-full flex items-center justify-center text-[8px] font-black text-black border border-background">2</div>
            </button>
            <p className="text-[10px] font-bold truncate text-center w-full">{leaders[1].username}</p>
            <p className="text-[10px] text-green-600 font-black">${leaders[1].weekly_earnings.toFixed(0)}</p>
            <div className="w-full h-8 bg-slate-200/40 dark:bg-slate-500/20 rounded-t-lg" />
          </div>
        )}
        {/* 1st place (center, taller) */}
        {leaders[0] && (
          <div className="flex flex-col items-center gap-1 flex-1">
            <span className="text-base leading-none">👑</span>
            <button
              onClick={() => navigate(`/profile/${leaders[0].username}`)}
              className={`relative w-12 h-12 rounded-full overflow-hidden border-2 ${podiumBorders[0]} ring-2 ${podiumRings[0]} shadow-md`}
            >
              {leaders[0].avatar_url
                ? <img src={leaders[0].avatar_url} alt={leaders[0].username} className="w-full h-full object-cover" />
                : <div className="w-full h-full bg-muted flex items-center justify-center font-black">{leaders[0].username[0]?.toUpperCase()}</div>}
              <div className="absolute -bottom-1 -right-1 w-5 h-5 bg-gradient-to-br from-yellow-400 to-amber-500 rounded-full flex items-center justify-center text-[8px] font-black text-black border border-background">1</div>
            </button>
            <p className="text-[11px] font-black truncate text-center w-full">{leaders[0].username}</p>
            <p className="text-[11px] text-green-600 font-black">${leaders[0].weekly_earnings.toFixed(0)}</p>
            <div className="w-full h-12 bg-gradient-to-t from-yellow-400/30 to-transparent rounded-t-lg" />
          </div>
        )}
        {/* 3rd place (right) */}
        {leaders[2] && (
          <div className="flex flex-col items-center gap-1 flex-1">
            <button
              onClick={() => navigate(`/profile/${leaders[2].username}`)}
              className={`relative w-10 h-10 rounded-full overflow-hidden border-2 ${podiumBorders[2]} ring-1 ${podiumRings[2]}`}
            >
              {leaders[2].avatar_url
                ? <img src={leaders[2].avatar_url} alt={leaders[2].username} className="w-full h-full object-cover" />
                : <div className="w-full h-full bg-muted flex items-center justify-center text-xs font-black">{leaders[2].username[0]?.toUpperCase()}</div>}
              <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-amber-600 rounded-full flex items-center justify-center text-[8px] font-black text-white border border-background">3</div>
            </button>
            <p className="text-[10px] font-bold truncate text-center w-full">{leaders[2].username}</p>
            <p className="text-[10px] text-green-600 font-black">${leaders[2].weekly_earnings.toFixed(0)}</p>
            <div className="w-full h-5 bg-amber-600/20 rounded-t-lg" />
          </div>
        )}
      </div>

      {/* Earnings bars */}
      <div className="space-y-2">
        {leaders.map((entry, idx) => {
          const barWidth = Math.max(10, Math.round((entry.weekly_earnings / maxEarnings) * 100));
          return (
            <button
              key={entry.user_id}
              onClick={() => navigate(`/profile/${entry.username}`)}
              className="w-full flex items-center gap-2 hover:bg-muted/40 rounded-xl px-2 py-1.5 transition-colors text-left"
            >
              <span className="text-sm w-5 shrink-0 text-center">{rankEmojis[idx]}</span>
              <span className="text-xs font-bold truncate flex-1">@{entry.username}</span>
              <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden shrink-0">
                <div
                  className={`h-full rounded-full ${
                    idx === 0 ? 'bg-gradient-to-r from-yellow-400 to-amber-500' :
                    idx === 1 ? 'bg-gradient-to-r from-slate-300 to-slate-400' :
                    'bg-gradient-to-r from-amber-600 to-amber-700'
                  }`}
                  style={{ width: barWidth + '%' }}
                />
              </div>
              <span className="text-[10px] font-black text-green-600 w-12 text-right shrink-0">${entry.weekly_earnings.toFixed(0)}</span>
            </button>
          );
        })}
      </div>

      <button
        onClick={() => navigate('/leaderboard/creators')}
        className="mt-3 w-full py-2 text-xs font-bold text-amber-700 bg-amber-500/10 hover:bg-amber-500/15 rounded-xl transition-colors flex items-center justify-center gap-1.5"
      >
        <Trophy className="w-3.5 h-3.5" />View Full Leaderboard
      </button>
    </div>
  );
}

export function RightSidebar() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [trending, setTrending] = useState<TrendingTopic[]>([]);
  const [trendingHashtags, setTrendingHashtags] = useState<TrendingHashtag[]>([]);
  const [communities, setCommunities] = useState<Community[]>([]);
  const [liveSpaces, setLiveSpaces] = useState<Space[]>([]);
  // followedTags — plain array (esbuild guard: no Set<string> state)
  const [followedTagIds, setFollowedTagIds] = useState<string[]>([]);
  const [suggestedCommunity, setSuggestedCommunity] = useState<Community | null>(null);
  const [suggestedSpace, setSuggestedSpace] = useState<Space | null>(null);
  const [followedHashtags, setFollowedHashtags] = useState<any[]>([]);
  const [followedHashtagsLoading, setFollowedHashtagsLoading] = useState(false);

  // Define fetch functions before useCallback to ensure they are available
  const fetchTrending = useCallback(async () => {
    // Refresh trending from real posts
    await supabase.rpc('refresh_trending_topics');
    
    const { data } = await supabase
      .from('trending_topics')
      .select('*')
      .order('posts_count', { ascending: false })
      .limit(5);

    if (data) setTrending(data);
  }, []); // Added useCallback wrapper and empty dependency array

  const fetchTrendingHashtags = useCallback(async () => {
    const { data } = await supabase
      .from('trending_hashtags')
      .select('hashtag_id, trend_score, daily_posts, hashtags(id, tag, usage_count)')
      .order('trend_score', { ascending: false })
      .limit(8);
    if (data) {
      const tags = data
        .filter((row: any) => row.hashtags)
        .map((row: any) => ({
          id: row.hashtags.id,
          tag: row.hashtags.tag,
          usage_count: row.hashtags.usage_count ?? 0,
          daily_posts: row.daily_posts ?? 0,
          trend_score: row.trend_score ?? 0,
        }));
      setTrendingHashtags(tags);
    }
  }, []); // Added useCallback wrapper and empty dependency array

  const fetchCommunities = useCallback(async () => {
    const { data } = await supabase
      .from('communities')
      .select('*')
      .order('member_count', { ascending: false })
      .limit(10);
    if (data) {
      setCommunities(data);
      // Initialize suggested community here
      if (data.length > 0) setSuggestedCommunity(data[Math.floor(Math.random() * data.length)]);
    }
  }, []); // Added useCallback wrapper and empty dependency array

  const fetchLiveSpaces = useCallback(async () => {
    const { data } = await supabase
      .from('spaces')
      .select(`*, profiles (username, avatar_url)`)
      .eq('is_live', true)
      .order('listener_count', { ascending: false })
      .limit(5);
    if (data) {
      setLiveSpaces(data);
      // Initialize suggested space here
      if (data.length > 0) setSuggestedSpace(data[Math.floor(Math.random() * data.length)]);
    }
  }, []); // Added useCallback wrapper and empty dependency array

  const fetchFollowedTags = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from('hashtag_follows')
      .select('hashtag_id')
      .eq('user_id', user.id);
    if (data) setFollowedTagIds(data.map((r: any) => r.hashtag_id));
  }, [user]); // Added useCallback wrapper and user to dependency array

  const fetchFollowedHashtagsPanel = useCallback(async () => {
    if (!user) return;
    setFollowedHashtagsLoading(true);
    const { data } = await supabase
      .from('hashtag_follows')
      .select('hashtag_id, hashtags(id, tag, usage_count)')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(5);
    setFollowedHashtags((data ?? []).map((d: any) => d.hashtags).filter(Boolean));
    setFollowedHashtagsLoading(false);
  }, [user]); // Added useCallback wrapper and user to dependency array


  const pickRandomSuggestions = useCallback((comms: Community[], spaces: Space[]) => {
    if (comms.length > 0) setSuggestedCommunity(comms[Math.floor(Math.random() * comms.length)]);
    if (spaces.length > 0) setSuggestedSpace(spaces[Math.floor(Math.random() * spaces.length)]);
  }, []); // Dependencies are now explicit empty array, because comms and spaces are passed as arguments

  useEffect(() => {
    const cancel = runWhenIdle(() => {
      void fetchTrending();
      void fetchTrendingHashtags();
      void fetchCommunities();
      void fetchLiveSpaces();
      if (user) { void fetchFollowedTags(); void fetchFollowedHashtagsPanel(); }
    });
    const iv = setInterval(fetchTrendingHashtags, 60_000);
    return () => { cancel?.(); clearInterval(iv); };
  }, [user, fetchTrending, fetchTrendingHashtags, fetchCommunities, fetchLiveSpaces, fetchFollowedTags, fetchFollowedHashtagsPanel]);

  const unfollowHashtag = async (hashtagId: string, _tag: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!user) return;
    await supabase.from('hashtag_follows').delete().eq('user_id', user.id).eq('hashtag_id', hashtagId);
    setFollowedHashtags(prev => prev.filter(h => h.id !== hashtagId));
    setFollowedTagIds(prev => prev.filter(id => id !== hashtagId));
  };

  const toggleTagFollow = async (tag: TrendingHashtag, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!user) { navigate('/auth'); return; }
    const isFollowing = (followedTagIds ?? []).includes(tag.id);
    if (isFollowing) {
      await supabase.from('hashtag_follows').delete().eq('user_id', user.id).eq('hashtag_id', tag.id);
      setFollowedTagIds(prev => prev.filter(id => id !== tag.id));
      toast.success(`Unfollowed #${tag.tag}`);
    } else {
      await supabase.from('hashtag_follows').insert({ user_id: user.id, hashtag_id: tag.id });
      setFollowedTagIds(prev => [...prev, tag.id]);
      toast.success(`Following #${tag.tag}`);
    }
  };
  
  return (
    <aside className="hidden xl:block w-80 h-screen sticky top-0 p-4 space-y-4 overflow-y-auto">
      {/* Create Community */}
      <div className="bg-muted/50 rounded-xl p-4 border border-border">
        <h3 className="font-bold text-lg mb-3 flex items-center">
          <Users className="w-5 h-5 mr-2 text-primary" />
          Communities
        </h3>
        <p className="text-sm text-muted-foreground mb-4">
          Create your own community to connect with like-minded people
        </p>
        <Button
          onClick={() => navigate('/communities')}
          className="w-full rounded-full"
          variant="outline"
        >
          <Plus className="w-4 h-4 mr-2" />
          Browse Communities
        </Button>
      </div>

      {/* ── Spotlight: Random Community Suggestion ── */}
      {suggestedCommunity && (
        <div className="bg-gradient-to-br from-blue-500/8 to-primary/5 rounded-xl p-4 border border-primary/15">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-bold text-sm flex items-center gap-1.5">
              <Users className="w-4 h-4 text-primary" /> Community Spotlight
            </h3>
            <button onClick={() => setSuggestedCommunity(communities[Math.floor(Math.random() * communities.length)])}
              className="p-1 rounded-full hover:bg-muted transition-colors text-muted-foreground">
              <RefreshCw className="w-3 h-3" />
            </button>
          </div>
          <button onClick={() => navigate(`/c/${suggestedCommunity.name}`)}
            className="w-full text-left flex items-center gap-3 p-2 rounded-xl hover:bg-muted/50 transition-colors">
            <div className="w-12 h-12 rounded-xl bg-primary/20 flex items-center justify-center overflow-hidden shrink-0">
              {suggestedCommunity.icon_url
                ? <img src={suggestedCommunity.icon_url} alt={suggestedCommunity.display_name} className="w-full h-full object-cover" />
                : <span className="text-lg font-bold">{suggestedCommunity.display_name[0]}</span>}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-bold text-sm truncate">{suggestedCommunity.display_name}</p>
              <p className="text-xs text-muted-foreground">{suggestedCommunity.member_count?.toLocaleString()} members</p>
              {suggestedCommunity.description && (
                <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{suggestedCommunity.description}</p>
              )}
            </div>
          </button>
          <button onClick={() => navigate(`/c/${suggestedCommunity.name}`)}
            className="mt-2 w-full py-2 bg-primary/10 hover:bg-primary/20 text-primary text-xs font-bold rounded-xl transition-colors">
            Join Community →
          </button>
        </div>
      )}

      {/* ── Spotlight: Random Space Suggestion ── */}
      {suggestedSpace && (
        <div className="bg-gradient-to-br from-red-500/8 to-orange-500/5 rounded-xl p-4 border border-red-500/15">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-bold text-sm flex items-center gap-1.5">
              <Radio className="w-4 h-4 text-red-500 animate-pulse" /> Space Spotlight
            </h3>
            <button onClick={() => liveSpaces.length > 0 && setSuggestedSpace(liveSpaces[Math.floor(Math.random() * liveSpaces.length)])}
              className="p-1 rounded-full hover:bg-muted transition-colors text-muted-foreground">
              <RefreshCw className="w-3 h-3" />
            </button>
          </div>
          <button onClick={() => navigate('/spaces')}
            className="w-full text-left flex items-center gap-3 p-2 rounded-xl hover:bg-muted/50 transition-colors">
            <div className="w-12 h-12 rounded-xl bg-red-500/20 flex items-center justify-center shrink-0">
              {suggestedSpace.user_profiles?.avatar_url
                ? <img src={suggestedSpace.user_profiles.avatar_url} alt="" className="w-full h-full rounded-xl object-cover" />
                : <Radio className="w-6 h-6 text-red-500" />}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-bold text-sm truncate">{suggestedSpace.title}</p>
              <p className="text-xs text-muted-foreground">by @{suggestedSpace.user_profiles?.username}</p>
              <div className="flex items-center gap-1 mt-0.5">
                <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                <span className="text-[10px] text-red-500 font-bold">{suggestedSpace.listener_count} listening live</span>
              </div>
            </div>
          </button>
          <button onClick={() => navigate('/spaces')}
            className="mt-2 w-full py-2 bg-red-500/10 hover:bg-red-500/20 text-red-600 text-xs font-bold rounded-xl transition-colors">
            Join Space →
          </button>
        </div>
      )}

      {/* Live Audio Spaces */}
      {liveSpaces.length > 0 && (
        <div className="bg-muted/50 rounded-xl p-4 border border-border">
          <h3 className="font-bold text-lg mb-3 flex items-center">
            <Radio className="w-5 h-5 mr-2 text-red-500 animate-pulse" />
            Live Spaces
          </h3>
          <div className="space-y-3">
            {liveSpaces.map((space) => (
              <button
                key={space.id}
                onClick={() => navigate('/spaces')}
                className="w-full text-left p-3 hover:bg-muted rounded-lg transition-colors"
              >
                <div className="flex items-start space-x-3">
                  <div className="w-10 h-10 rounded-full bg-red-500/20 flex items-center justify-center flex-shrink-0">
                    <Radio className="w-5 h-5 text-red-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm truncate">{space.title}</p>
                    <p className="text-xs text-muted-foreground">
                      @{space.user_profiles.username}
                    </p>
                    <p className="text-xs text-red-500 font-medium mt-1">
                      🔴 {space.listener_count} listening
                    </p>
                  </div>
                </div>
              </button>
            ))}
          </div>
          <Button
            onClick={() => navigate('/spaces')}
            variant="outline"
            className="w-full mt-3 rounded-full"
          >
            View All Spaces
          </Button>
        </div>
      )}

      {/* ── Followed Hashtags Panel ── */}
      {user && (
        <div className="bg-gradient-to-br from-primary/8 to-primary/3 rounded-xl p-4 border border-primary/20">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-bold text-sm flex items-center gap-1.5">
              <Hash className="w-4 h-4 text-primary" />
              Followed Hashtags
            </h3>
            <button onClick={() => navigate('/hashtags')}
              className="text-xs text-primary font-semibold hover:underline transition-colors">
              Manage
            </button>
          </div>
          {followedHashtagsLoading ? (
            <div className="flex justify-center py-3">
              <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
            </div>
          ) : followedHashtags.length === 0 ? (
            <div className="text-center py-4">
              <p className="text-xs text-muted-foreground mb-2">No hashtags followed yet</p>
              <button onClick={() => navigate('/hashtags')}
                className="flex items-center justify-center gap-1 w-full py-2 border border-dashed border-primary/30 rounded-xl text-xs font-semibold text-primary hover:bg-primary/5 transition-colors">
                <Plus className="w-3 h-3" /> Discover hashtags
              </button>
            </div>
          ) : (
            <div className="space-y-1.5">
              {followedHashtags.map(h => (
                <div key={h.id} className="group flex items-center gap-2">
                  <button
                    onClick={() => navigate(`/hashtag/${h.tag}`)}
                    className="flex-1 flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-muted/60 transition-colors text-left min-w-0">
                    <Hash className="w-3 h-3 text-primary shrink-0" />
                    <span className="text-sm font-semibold text-primary truncate">#{h.tag}</span>
                    {h.usage_count > 0 && (
                      <span className="text-[10px] text-muted-foreground ml-auto shrink-0">
                        {formatNumber(h.usage_count)}
                      </span>
                    )}
                  </button>
                  <button
                    onClick={e => unfollowHashtag(h.id, h.tag, e)}
                    className="p-1 rounded-full text-muted-foreground hover:text-destructive hover:bg-destructive/10 opacity-0 group-hover:opacity-100 transition-all shrink-0"
                    title="Unfollow">
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
              <button onClick={() => navigate('/hashtags')}
                className="w-full mt-1 py-1.5 text-xs text-primary font-semibold hover:bg-primary/5 rounded-lg transition-colors">
                + Discover more →
              </button>
            </div>
          )}
        </div>
      )}

      {/* Trending Hashtags */}
      {trendingHashtags.length > 0 && (
        <div className="bg-muted/50 rounded-xl p-4 border border-border">
          <h3 className="font-bold text-lg mb-3 flex items-center justify-between">
            <span className="flex items-center">
              <Hash className="w-5 h-5 mr-2 text-primary" />
              Trending Tags
            </span>
            <span className="text-[10px] font-normal text-muted-foreground bg-muted px-2 py-0.5 rounded-full">Live</span>
          </h3>
          <div className="space-y-1">
            {trendingHashtags.map((tag, i) => (
              <button
                key={tag.id}
                onClick={() => navigate(`/hashtag/${tag.tag}`)}
                className="w-full flex items-center justify-between px-3 py-2 rounded-lg hover:bg-muted transition-colors group"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-xs font-bold text-muted-foreground w-4 shrink-0">{i + 1}</span>
                  <span className="text-sm font-semibold text-primary truncate">#{tag.tag}</span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0 ml-2">
                  <span className="text-[10px] text-muted-foreground">
                    {formatNumber(tag.usage_count > 0 ? tag.usage_count : tag.daily_posts)} posts
                  </span>
                  <button
                    onClick={(e) => toggleTagFollow(tag, e)}
                    className={`p-1 rounded-full transition-colors ${
                      (followedTagIds ?? []).includes(tag.id)
                        ? 'bg-primary/10 text-primary'
                        : 'opacity-0 group-hover:opacity-100 hover:bg-muted text-muted-foreground'
                    }`}
                    title={(followedTagIds ?? []).includes(tag.id) ? 'Unfollow' : 'Follow'}
                  >
                    {(followedTagIds ?? []).includes(tag.id)
                      ? <Check className="w-3 h-3" />
                      : <Plus className="w-3 h-3" />
                    }
                  </button>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Trending Topics */}
      <div className="bg-muted/50 rounded-xl p-4 border border-border">
        <h3 className="font-bold text-lg mb-3 flex items-center">
          <TrendingUp className="w-5 h-5 mr-2 text-primary" />
          Trending
        </h3>
        <div className="space-y-3">
          {trending.map((topic, index) => (
            <button
              key={topic.id}
              onClick={() => {
                if (topic.topic.startsWith('#')) {
                  navigate(`/hashtag/${topic.topic.substring(1)}`);
                } else {
                  navigate(`/trending/${encodeURIComponent(topic.topic)}`);
                }
              }}
              className="w-full text-left p-3 hover:bg-muted rounded-lg transition-colors"
            >
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <div className="flex items-center space-x-2 text-xs text-muted-foreground mb-1">
                    <span className="font-bold">{index + 1}</span>
                    <span>·</span>
                    <span>{topic.category}</span>
                  </div>
                  <p className="font-bold text-sm">{topic.topic}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {formatNumber(topic.posts_count)} posts
                  </p>
                </div>
                <TrendingUp className="w-4 h-4 text-primary flex-shrink-0" />
              </div>
            </button>
          ))}
        </div>
        <Button
          onClick={() => navigate('/explore')}
          variant="ghost"
          className="w-full mt-3"
        >
          Show more
        </Button>
      </div>

      {/* Suggested Communities */}
      <div className="bg-muted/50 rounded-xl p-4 border border-border">
        <h3 className="font-bold text-lg mb-3 flex items-center">
          <Users className="w-5 h-5 mr-2 text-primary" />
          Popular Communities
        </h3>
        <div className="space-y-3">
          {communities.map((community) => (
            <button
              key={community.id}
              onClick={() => navigate(`/c/${community.name}`)}
              className="w-full text-left p-3 hover:bg-muted rounded-lg transition-colors"
            >
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0 overflow-hidden">
                  {community.icon_url ? (
                    <img
                      src={community.icon_url}
                      alt={community.display_name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <span className="text-sm font-bold">{community.display_name[0]}</span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm truncate">{community.display_name}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatNumber(community.member_count)} members
                  </p>
                </div>
              </div>
            </button>
          ))}
        </div>
        <Button
          onClick={() => navigate('/communities')}
          variant="ghost"
          className="w-full mt-3"
        >
          Show more
        </Button>
      </div>

      {/* User Suggestions */}
      <UserSuggestionsWidget />

      {/* Creator Earnings */}
      <CreatorEarningsWidget />

      {/* Creator Leaderboard */}
      <CreatorLeaderboardWidget />

      {/* Content Suggestions */}
      <ContentSuggestionsWidget />

      {/* AI Features */}
      <div className="bg-gradient-to-br from-purple-500/10 to-pink-500/10 rounded-xl p-4 border border-purple-500/20">
        <h3 className="font-bold text-lg mb-2 flex items-center">
          <Sparkles className="w-5 h-5 mr-2 text-purple-500" />
          AI-Powered
        </h3>
        <p className="text-sm text-muted-foreground mb-4">
          Discover personalized content, trending topics, and smart recommendations
        </p>
        <Button
          onClick={() => navigate('/ai')}
          className="w-full rounded-full bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600"
        >
          <Sparkles className="w-4 h-4 mr-2" />
          Explore AI
        </Button>
      </div>

      {/* Footer Links */}
      <div className="text-xs text-muted-foreground px-4 space-y-2 pb-4">
        <div className="flex flex-wrap gap-2">
          <a href="#" className="hover:underline">Terms</a>
          <span>·</span>
          <a href="#" className="hover:underline">Privacy</a>
          <span>·</span>
          <a href="#" className="hover:underline">Help</a>
          <span>·</span>
          <a href="#" className="hover:underline">About</a>
        </div>
        <p>© 2025 T Social</p>
      </div>
    </aside>
  );
}
