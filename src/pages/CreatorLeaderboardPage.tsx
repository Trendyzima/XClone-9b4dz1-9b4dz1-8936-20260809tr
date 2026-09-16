/**
 * Creator Revenue Leaderboard — /leaderboard/creators
 * Shows top 10 earning creators this month from creator_earnings table.
 * Rank badge, avatar, username, total earnings bar, Follow button.
 */
import { useState, useEffect } from 'react';
import { useSEO } from '@/hooks/useSEO';
import { useNavigate } from 'react-router-dom';
import { TopBar } from '@/components/layout/TopBar';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import { Trophy, TrendingUp, BadgeCheck, Loader2, DollarSign, Star, Crown, Zap, Users, RefreshCw } from 'lucide-react';
import { formatNumber } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';

export default function CreatorLeaderboardPage() {
  useSEO({
    title: 'Creator Revenue Leaderboard',
    description: 'Top earning creators on Testagram this month — discover rising stars and powerhouse content creators.',
    url: '/leaderboard/creators',
  });

  const { user } = useAuth();
  const navigate = useNavigate();
  const [leaders, setLeaders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  // follow state — plain arrays (esbuild guard: no Set<string> state)
  const [followingIds, setFollowingIds] = useState<string[]>([]);
  const [followingLoading, setFollowingLoading] = useState<string[]>([]);
  const [period, setPeriod] = useState<'month' | 'week' | 'alltime'>('month');

  useEffect(() => {
    if (user) {
      supabase.from('follows').select('following_id').eq('follower_id', user.id)
        .then(({ data }) => setFollowingIds((data ?? []).map((f: any) => f.following_id)));
    }
  }, [user?.id]);

  const fetchLeaderboard = async () => {
    setRefreshing(true);
    try {
      // Date filter based on period
      const now = new Date();
      let since: string | null = null;
      if (period === 'week') {
        const d = new Date(now); d.setDate(d.getDate() - 7);
        since = d.toISOString();
      } else if (period === 'month') {
        const d = new Date(now); d.setMonth(d.getMonth() - 1);
        since = d.toISOString();
      }

      let query = supabase
        .from('creator_earnings')
        .select('user_id, amount, source')
        .eq('status', 'paid');
      if (since) query = query.gte('created_at', since);

      const { data: earningsData } = await query;

      if (!earningsData || earningsData.length === 0) {
        // Fallback: show creators by total_earnings from user_profiles
        const { data: profileData } = await supabase
          .from('profiles')
          .select('id, username, avatar_url, verified, follower_count, total_earnings, is_creator, creator_tier')
          .eq('is_creator', true)
          .gt('total_earnings', 0)
          .order('total_earnings', { ascending: false })
          .limit(10);

        setLeaders((profileData ?? []).map((p: any) => ({
          userId: p.id,
          username: p.username,
          avatarUrl: p.avatar_url,
          verified: p.verified,
          followersCount: p.follower_count ?? 0,
          totalEarnings: Number(p.total_earnings ?? 0),
          creatorTier: p.creator_tier ?? 'free',
          sourceBreakdown: {},
        })));
      } else {
        // Aggregate earnings by user — parallel arrays (esbuild guard: no Record<string,T>)
        const uids: string[] = [];
        const amounts: number[] = [];
        for (const row of earningsData) {
          const idx = uids.indexOf(row.user_id);
          if (idx >= 0) {
            amounts[idx] += Number(row.amount ?? 0);
          } else {
            uids.push(row.user_id);
            amounts.push(Number(row.amount ?? 0));
          }
        }
        // Sort by earnings descending (top 10)
        const sortedIndices = amounts
          .map((a, i) => ({ a, i }))
          .sort((x, y) => y.a - x.a)
          .slice(0, 10)
          .map(s => s.i);

        const topUids = sortedIndices.map(i => uids[i]);
        const topAmounts = sortedIndices.map(i => amounts[i]);

        if (topUids.length === 0) { setLeaders([]); return; }

        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, username, avatar_url, verified, follower_count, creator_tier')
          .in('id', topUids);

        const enriched = topUids.map((uid, rank) => {
          const prof = (profiles ?? []).find((p: any) => p.id === uid);
          return {
            rank: rank + 1,
            userId: uid,
            username: prof?.username ?? 'Unknown',
            avatarUrl: prof?.avatar_url ?? null,
            verified: prof?.verified ?? false,
            followersCount: prof?.follower_count ?? 0,
            totalEarnings: topAmounts[rank],
            creatorTier: prof?.creator_tier ?? 'free',
          };
        });
        setLeaders(enriched);
      }
      setLastUpdated(new Date());
    } catch (err) {
      console.error('[leaderboard]', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { fetchLeaderboard(); }, [period]);

  const handleFollow = async (targetId: string) => {
    if (!user) { navigate('/auth'); return; }
    setFollowingLoading(prev => [...prev, targetId]);
    if (followingIds.includes(targetId)) {
      await supabase.from('follows').delete().eq('follower_id', user.id).eq('following_id', targetId);
      setFollowingIds(prev => prev.filter(id => id !== targetId));
    } else {
      await supabase.from('follows').insert({ follower_id: user.id, following_id: targetId });
      setFollowingIds(prev => [...prev, targetId]);
    }
    setFollowingLoading(prev => prev.filter(id => id !== targetId));
  };

  // Rank badge colors
  const getRankStyle = (rank: number) => {
    if (rank === 1) return { bg: 'bg-gradient-to-br from-yellow-400 to-amber-500', text: 'text-black', icon: '🥇' };
    if (rank === 2) return { bg: 'bg-gradient-to-br from-slate-300 to-slate-400', text: 'text-black', icon: '🥈' };
    if (rank === 3) return { bg: 'bg-gradient-to-br from-amber-600 to-amber-700', text: 'text-white', icon: '🥉' };
    return { bg: 'bg-muted', text: 'text-muted-foreground', icon: `#${rank}` };
  };

  const getTierColor = (tier: string) => {
    if (tier === 'gold')     return 'text-yellow-600 bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800';
    if (tier === 'silver')   return 'text-slate-500 bg-slate-50 dark:bg-slate-900/20 border-slate-200 dark:border-slate-700';
    if (tier === 'platinum') return 'text-purple-600 bg-purple-50 dark:bg-purple-900/20 border-purple-200 dark:border-purple-800';
    return 'text-green-600 bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800';
  };

  const maxEarnings = leaders.length > 0 ? Math.max(...leaders.map(l => l.totalEarnings), 1) : 1;

  return (
    <div className="min-h-screen bg-background pb-20 md:pb-4">
      <TopBar title="Creator Leaderboard" showBack />

      {/* Hero banner */}
      <div className="bg-gradient-to-br from-primary/10 via-amber-500/5 to-transparent border-b border-border px-4 py-5">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-yellow-400 to-amber-500 flex items-center justify-center shadow-md">
            <Trophy className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="font-black text-xl leading-tight">Top Creators</h1>
            <p className="text-sm text-muted-foreground">Ranked by earnings · updated daily</p>
          </div>
          <button
            onClick={fetchLeaderboard}
            disabled={refreshing}
            className="ml-auto p-2 rounded-full hover:bg-muted transition-colors text-muted-foreground"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {/* Period selector */}
        <div className="flex gap-1 bg-muted/40 rounded-xl p-1">
          {(['week', 'month', 'alltime'] as const).map(p => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all ${
                period === p
                  ? 'bg-background shadow text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {p === 'week' ? 'This Week' : p === 'month' ? 'This Month' : 'All Time'}
            </button>
          ))}
        </div>

        {lastUpdated && (
          <p className="text-[10px] text-muted-foreground mt-2 text-center">
            Updated {formatDistanceToNow(lastUpdated, { addSuffix: true })}
          </p>
        )}
      </div>

      {/* Podium — top 3 */}
      {!loading && leaders.length >= 3 && (
        <div className="px-4 pt-6 pb-2">
          <div className="flex items-end justify-center gap-3">
            {/* 2nd place */}
            {leaders[1] && (
              <div className="flex flex-col items-center flex-1 max-w-[100px]">
                <button onClick={() => navigate(`/profile/${leaders[1].username}`)}>
                  <div className="relative w-16 h-16 rounded-full overflow-hidden border-4 border-slate-300 shadow-md mb-2">
                    {leaders[1].avatarUrl
                      ? <img src={leaders[1].avatarUrl} alt={leaders[1].username} className="w-full h-full object-cover" />
                      : <div className="w-full h-full bg-muted flex items-center justify-center font-black text-lg">{leaders[1].username?.[0]?.toUpperCase()}</div>}
                    <div className="absolute -top-1 -right-1 w-6 h-6 bg-slate-300 rounded-full flex items-center justify-center text-xs font-black text-black border-2 border-background">2</div>
                  </div>
                </button>
                <p className="text-xs font-bold truncate text-center w-full">{leaders[1].username}</p>
                <p className="text-xs text-green-600 font-black">${leaders[1].totalEarnings.toFixed(0)}</p>
                <div className="w-full h-16 bg-gradient-to-t from-slate-300/60 to-transparent rounded-t-lg mt-2" />
              </div>
            )}
            {/* 1st place */}
            {leaders[0] && (
              <div className="flex flex-col items-center flex-1 max-w-[110px]">
                <div className="w-6 h-6 flex items-center justify-center mb-1">
                  <Crown className="w-6 h-6 text-yellow-500" fill="currentColor" />
                </div>
                <button onClick={() => navigate(`/profile/${leaders[0].username}`)}>
                  <div className="relative w-20 h-20 rounded-full overflow-hidden border-4 border-yellow-400 shadow-lg mb-2 ring-2 ring-yellow-400/30">
                    {leaders[0].avatarUrl
                      ? <img src={leaders[0].avatarUrl} alt={leaders[0].username} className="w-full h-full object-cover" />
                      : <div className="w-full h-full bg-muted flex items-center justify-center font-black text-xl">{leaders[0].username?.[0]?.toUpperCase()}</div>}
                    <div className="absolute -top-1 -right-1 w-7 h-7 bg-gradient-to-br from-yellow-400 to-amber-500 rounded-full flex items-center justify-center text-xs font-black text-black border-2 border-background">1</div>
                  </div>
                </button>
                <p className="text-sm font-black truncate text-center w-full">{leaders[0].username}</p>
                <p className="text-sm text-green-600 font-black">${leaders[0].totalEarnings.toFixed(0)}</p>
                <div className="w-full h-24 bg-gradient-to-t from-yellow-400/40 to-transparent rounded-t-lg mt-2" />
              </div>
            )}
            {/* 3rd place */}
            {leaders[2] && (
              <div className="flex flex-col items-center flex-1 max-w-[100px]">
                <button onClick={() => navigate(`/profile/${leaders[2].username}`)}>
                  <div className="relative w-16 h-16 rounded-full overflow-hidden border-4 border-amber-600 shadow-md mb-2">
                    {leaders[2].avatarUrl
                      ? <img src={leaders[2].avatarUrl} alt={leaders[2].username} className="w-full h-full object-cover" />
                      : <div className="w-full h-full bg-muted flex items-center justify-center font-black text-lg">{leaders[2].username?.[0]?.toUpperCase()}</div>}
                    <div className="absolute -top-1 -right-1 w-6 h-6 bg-amber-600 rounded-full flex items-center justify-center text-xs font-black text-white border-2 border-background">3</div>
                  </div>
                </button>
                <p className="text-xs font-bold truncate text-center w-full">{leaders[2].username}</p>
                <p className="text-xs text-green-600 font-black">${leaders[2].totalEarnings.toFixed(0)}</p>
                <div className="w-full h-10 bg-gradient-to-t from-amber-600/40 to-transparent rounded-t-lg mt-2" />
              </div>
            )}
          </div>
        </div>
      )}

      {/* Full leaderboard list */}
      <div className="px-4 py-4 space-y-3">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        ) : leaders.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            <Trophy className="w-12 h-12 mx-auto mb-3 opacity-20" />
            <p className="font-semibold">No earnings data yet</p>
            <p className="text-sm mt-1">Creator earnings will appear here as they accumulate</p>
          </div>
        ) : (
          leaders.map((creator, idx) => {
            const rankStyle = getRankStyle(idx + 1);
            const isFollowing = followingIds.includes(creator.userId);
            const isLoadingFollow = followingLoading.includes(creator.userId);
            const barWidth = Math.max(8, Math.round((creator.totalEarnings / maxEarnings) * 100));
            const isCurrentUser = user?.id === creator.userId;

            return (
              <div
                key={creator.userId}
                className={`bg-card border rounded-2xl overflow-hidden transition-all hover:shadow-sm ${
                  idx === 0 ? 'border-yellow-400/40 ring-1 ring-yellow-400/20' :
                  idx === 1 ? 'border-slate-300/40' :
                  idx === 2 ? 'border-amber-600/40' :
                  'border-border'
                }`}
              >
                <div className="flex items-center gap-3 p-3.5">
                  {/* Rank badge */}
                  <div className={`w-9 h-9 rounded-xl ${rankStyle.bg} flex items-center justify-center shrink-0 font-black text-sm ${rankStyle.text}`}>
                    {typeof rankStyle.icon === 'string' && rankStyle.icon.startsWith('#')
                      ? <span className="text-xs">{rankStyle.icon}</span>
                      : <span>{rankStyle.icon}</span>}
                  </div>

                  {/* Avatar */}
                  <button
                    onClick={() => navigate(`/profile/${creator.username}`)}
                    className="w-11 h-11 rounded-full overflow-hidden bg-muted shrink-0 border border-border"
                  >
                    {creator.avatarUrl
                      ? <img src={creator.avatarUrl} alt={creator.username} className="w-full h-full object-cover" />
                      : <div className="w-full h-full flex items-center justify-center font-bold text-sm">{creator.username?.[0]?.toUpperCase()}</div>}
                  </button>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <button
                        onClick={() => navigate(`/profile/${creator.username}`)}
                        className="font-bold text-sm hover:underline truncate"
                      >
                        {creator.username}
                      </button>
                      {creator.verified && <BadgeCheck className="w-3.5 h-3.5 text-primary shrink-0" fill="currentColor" />}
                      {isCurrentUser && <span className="text-[10px] bg-primary/10 text-primary font-bold px-1.5 py-0.5 rounded-full">You</span>}
                      {creator.creatorTier && creator.creatorTier !== 'free' && (
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full border capitalize ${getTierColor(creator.creatorTier)}`}>
                          {creator.creatorTier}
                        </span>
                      )}
                    </div>
                    {/* Earnings bar */}
                    <div className="mt-1.5">
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-1 text-green-600">
                          <DollarSign className="w-3 h-3" />
                          <span className="text-sm font-black">{creator.totalEarnings.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                        </div>
                        <div className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Users className="w-3 h-3" />
                          {formatNumber(creator.followersCount)}
                        </div>
                      </div>
                      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-700 ${
                            idx === 0 ? 'bg-gradient-to-r from-yellow-400 to-amber-500' :
                            idx === 1 ? 'bg-gradient-to-r from-slate-300 to-slate-400' :
                            idx === 2 ? 'bg-gradient-to-r from-amber-600 to-amber-700' :
                            'bg-gradient-to-r from-primary/80 to-primary'
                          }`}
                          style={{ width: barWidth + '%' }}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Follow button */}
                  {!isCurrentUser && (
                    <button
                      onClick={() => handleFollow(creator.userId)}
                      disabled={isLoadingFollow}
                      className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-bold border transition-all active:scale-95 ${
                        isFollowing
                          ? 'bg-muted border-border text-muted-foreground'
                          : 'bg-primary border-primary text-primary-foreground hover:opacity-90'
                      }`}
                    >
                      {isLoadingFollow
                        ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        : isFollowing ? 'Following' : 'Follow'}
                    </button>
                  )}
                </div>

                {/* Top earning source pills */}
                {idx < 3 && (
                  <div className="px-3.5 pb-3 flex gap-1.5 flex-wrap">
                    {['tips', 'subscriptions', 'ads', 'videos'].map(source => (
                      <div key={source} className="flex items-center gap-0.5 text-[10px] text-muted-foreground bg-muted/60 rounded-full px-2 py-0.5">
                        {source === 'tips' && <Zap className="w-2.5 h-2.5 text-amber-500" />}
                        {source === 'subscriptions' && <Star className="w-2.5 h-2.5 text-purple-500" />}
                        {source === 'ads' && <TrendingUp className="w-2.5 h-2.5 text-blue-500" />}
                        {source === 'videos' && <Trophy className="w-2.5 h-2.5 text-green-500" />}
                        {source}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* CTA to monetize */}
      <div className="mx-4 mt-2 mb-8 p-4 bg-gradient-to-br from-primary/10 to-transparent border border-primary/20 rounded-2xl text-center">
        <TrendingUp className="w-8 h-8 text-primary mx-auto mb-2" />
        <p className="font-bold text-sm">Want to appear here?</p>
        <p className="text-xs text-muted-foreground mt-0.5 mb-3">Enable monetization to start earning from your content</p>
        <button
          onClick={() => navigate('/monetization')}
          className="px-6 py-2 bg-primary text-primary-foreground rounded-full text-sm font-bold hover:opacity-90 transition-opacity"
        >
          Start Monetizing
        </button>
      </div>
    </div>
  );
}
