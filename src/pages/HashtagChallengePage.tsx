
import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { TopBar } from '@/components/layout/TopBar';
import { PostCard } from '@/components/features/PostCard';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import {
  Trophy, Hash, Flame, Loader2, Clock, Users, Plus,
  CalendarDays, Gift, CheckCircle, AlertCircle, Heart, MessageCircle,
  TrendingUp, Pencil, ChevronDown,
} from 'lucide-react';
import { formatNumber } from '@/lib/utils';
import { formatDistanceToNow, isPast, format, getHours } from 'date-fns';
import { toast } from 'sonner';
import { useSEO, buildOgImageUrl } from '@/hooks/useSEO';

import { PageAdBanner } from '@/components/features/AdSenseAd';
function HashtagChallengeAdBanner() { return <PageAdBanner />; }

// Module-level constants — esbuild-safe (no as const in render scope)
const CHALLENGE_MEDALS = ['🥇', '🥈', '🥉'] as const;
const FEED_PAGE_SIZE = 10;
const FEED_SORT_OPTIONS = ['engagement', 'newest'] as const;
type FeedSort = typeof FEED_SORT_OPTIONS[number];

// Analytics helpers — module-level to avoid duplicate bindings (esbuild guard)
const HOUR_LABELS = [
  '12a','1a','2a','3a','4a','5a','6a','7a','8a','9a','10a','11a',
  '12p','1p','2p','3p','4p','5p','6p','7p','8p','9p','10p','11p',
] as const;

export default function HashtagChallengePage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [challenge, setChallenge] = useState<any>(null);
  const [posts, setPosts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingPosts, setLoadingPosts] = useState(false);
  const [hasEntered, setHasEntered] = useState(false);
  const [entering, setEntering] = useState(false);
  const [leaderboard, setLeaderboard] = useState<any[]>([]);
  // Analytics panel
  const [showAnalytics, setShowAnalytics] = useState(false);

  // Feed pagination + sort
  const [feedSort, setFeedSort] = useState<FeedSort>('engagement');
  const [feedPage, setFeedPage] = useState(0);
  const [likedIds, setLikedIds] = useState<Set<string>>(() => new Set<string>());
  const [likingId, setLikingId] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  // ── SEO — dynamic challenge hash as OG image + Event JSON-LD ──────────────────────
  const challengeHashtag = challenge?.hashtags?.tag ?? '';
  useSEO({
    title: challenge ? `#${challengeHashtag} Challenge — ${challenge.title}` : 'Hashtag Challenge',
    description: challenge
      ? `${challenge.description || challenge.title} — ${challenge.entry_count ?? 0} entries. ${challenge.prize ? `Prize: ${challenge.prize}.` : ''} Ends ${format(new Date(challenge.end_date ?? Date.now()), 'MMM d, yyyy')}.`
      : 'Join a trending hashtag challenge on Testagram.',
    image: challengeHashtag ? buildOgImageUrl({ tag: challengeHashtag }) : undefined,
    url: id ? `/challenge/${id}` : '/explore',
    type: 'website',
    keywords: challenge ? `#${challengeHashtag}, challenge, contest, testagram, ${challenge.title}` : 'hashtag challenge, testagram',
    structuredData: challenge ? {
      '@context': 'https://schema.org',
      '@type': 'Event',
      name: challenge.title,
      description: challenge.description || challenge.title,
      url: `https://testagram.site/challenge/${id}`,
      startDate: challenge.created_at,
      endDate: challenge.end_date,
      eventStatus: isPast(new Date(challenge.end_date ?? Date.now()))
        ? 'https://schema.org/EventCancelled'
        : 'https://schema.org/EventScheduled',
      eventAttendanceMode: 'https://schema.org/OnlineEventAttendanceMode',
      location: {
        '@type': 'VirtualLocation',
        url: `https://testagram.site/hashtag/${challengeHashtag}`,
      },
      organizer: challenge.user_profiles ? {
        '@type': 'Person',
        name: challenge.user_profiles.username,
        url: `https://testagram.site/profile/${challenge.user_profiles.username}`,
      } : { '@type': 'Organization', name: 'Testagram' },
      offers: challenge.prize ? {
        '@type': 'Offer',
        name: 'Challenge Prize',
        description: challenge.prize,
        price: '0',
        priceCurrency: 'USD',
        url: `https://testagram.site/challenge/${id}`,
      } : undefined,
    } : undefined,
  });

  const fetchChallengePosts = async (tag: string, sort: 'engagement' | 'newest' = 'engagement', page = 0) => {
    if (!tag) return;
    if (page === 0) setLoadingPosts(true); else setLoadingMore(true);
    const orderCol = sort === 'engagement' ? 'likes_count' : 'created_at';
    const { data } = await supabase
      .from('posts')
      .select('*, profiles(*)')
      .ilike('content', `%#${tag}%`)
      .order(orderCol, { ascending: false })
      .range(page * FEED_PAGE_SIZE, (page + 1) * FEED_PAGE_SIZE - 1);
    if (data) {
      if (page === 0) {
        setPosts(data);
        // Build mini leaderboard from top 3 by likes
        const sorted = [...data].sort((a, b) => (b.likes_count ?? 0) - (a.likes_count ?? 0));
        setLeaderboard(sorted.slice(0, 3));
        // Check if current user has entered
        if (user) setHasEntered(data.some((p: any) => p.user_id === user.id));
        // Fetch liked IDs
        if (user) {
          const ids = data.map((p: any) => p.id);
          const { data: liked } = await supabase
            .from('likes').select('post_id')
            .eq('user_id', user.id).in('post_id', ids);
          setLikedIds(new Set((liked ?? []).map((l: any) => l.post_id)));
        }
      } else {
        setPosts(prev => [...prev, ...data]);
      }
      setFeedPage(page);
    }
    if (page === 0) setLoadingPosts(false); else setLoadingMore(false);
  };

  const fetchChallenge = useCallback(async () => {
    if (!id) return;
    const { data, error } = await supabase
      .from('hashtag_challenges')
      .select('*, hashtags(id, tag, usage_count), user_profiles!created_by(username, avatar_url, verified)')
      .eq('id', id)
      .single();
    if (error) { toast.error('Challenge not found'); navigate('/explore'); return; }
    setChallenge(data);
    setLoading(false);
    fetchChallengePosts(data.hashtags?.tag);
  }, [id, navigate]); // Added navigate to dependency array

  const handleLike = async (postId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!user) { navigate('/auth'); return; }
    if (likingId === postId) return;
    setLikingId(postId);
    const isLiked = likedIds.has(postId);
    if (isLiked) {
      await supabase.from('likes').delete().eq('user_id', user.id).eq('post_id', postId);
      setLikedIds(prev => { const s = new Set(prev); s.delete(postId); return s; });
      setPosts(prev => prev.map(p => p.id === postId ? { ...p, likes_count: Math.max(0, (p.likes_count ?? 0) - 1) } : p));
    } else {
      await supabase.from('likes').insert({ user_id: user.id, post_id: postId });
      setLikedIds(prev => new Set([...prev, postId]));
      setPosts(prev => prev.map(p => p.id === postId ? { ...p, likes_count: (p.likes_count ?? 0) + 1 } : p));
    }
    setLikingId(null);
  };

  const changeSortAndFetch = (sort: 'engagement' | 'newest', tag: string) => {
    setFeedSort(sort);
    setFeedPage(0);
    fetchChallengePosts(tag, sort, 0);
  };

  useEffect(() => { fetchChallenge(); }, [fetchChallenge]);
  useEffect(() => {
    if (challenge?.hashtags?.tag) fetchChallengePosts(challenge.hashtags.tag, feedSort, 0);
  }, [challenge?.hashtags?.tag, feedSort, user]); // Added user to dependencies

  const handleEnter = async () => {
    if (!user) { navigate('/auth'); return; }
    if (!challenge?.hashtags?.tag) return;
    setEntering(true);
    try {
      // Increment entry count
      await supabase
        .from('hashtag_challenges')
        .update({ entry_count: (challenge.entry_count ?? 0) + 1 })
        .eq('id', challenge.id);
      setChallenge((prev: any) => ({ ...prev, entry_count: (prev.entry_count ?? 0) + 1 }));
      setHasEntered(true);
      toast.success(`Entered! Post with #${challenge.hashtags.tag} to participate`);
      navigate(`/?compose=true&hashtag=${challenge.hashtags.tag}`);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setEntering(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!challenge) return null;

  const isExpired = isPast(new Date(challenge.end_date));
  const hashtag = challenge.hashtags?.tag ?? '';

  return (
    <div className="min-h-screen bg-background pb-20">
      <TopBar title="Challenge" showBack />
      <HashtagChallengeAdBanner />

      {/* Hero */}
      <div className="px-4 pt-4 pb-5 border-b border-border bg-gradient-to-br from-primary/5 via-background to-purple-500/5">
        <div className="flex items-start gap-3 mb-3">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-primary/20 to-purple-500/20 flex items-center justify-center shrink-0">
            <Trophy className="w-7 h-7 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-bold leading-tight">{challenge.title}</h1>
            {hashtag && (
              <button
                onClick={() => navigate(`/hashtag/${hashtag}`)}
                className="text-primary text-sm font-semibold hover:underline mt-0.5 inline-flex items-center gap-1"
              >
                <Hash className="w-3.5 h-3.5" />#{hashtag}
              </button>
            )}
          </div>
          {/* Status badge */}
          <div className={`shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold ${
            isExpired
              ? 'bg-muted text-muted-foreground'
              : 'bg-green-500/10 text-green-600 border border-green-500/20'
          }`}>
            {isExpired
              ? <><AlertCircle className="w-3 h-3" />Ended</>
              : <><span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />Active</>}
          </div>
        </div>

        {challenge.description && (
          <p className="text-sm text-muted-foreground leading-relaxed mb-3">{challenge.description}</p>
        )}

        {/* Stats row */}
        <div className="grid grid-cols-3 gap-2 mb-4">
          <div className="bg-muted/40 rounded-xl p-2.5 text-center">
            <div className="flex items-center justify-center gap-1 mb-0.5">
              <Users className="w-3.5 h-3.5 text-primary" />
            </div>
            <p className="text-lg font-black">{formatNumber(challenge.entry_count ?? 0)}</p>
            <p className="text-[10px] text-muted-foreground">Entries</p>
          </div>
          <div className="bg-muted/40 rounded-xl p-2.5 text-center">
            <div className="flex items-center justify-center gap-1 mb-0.5">
              <Flame className="w-3.5 h-3.5 text-orange-500" />
            </div>
            <p className="text-lg font-black">{formatNumber(posts.length)}</p>
            <p className="text-[10px] text-muted-foreground">Posts</p>
          </div>
          <div className="bg-muted/40 rounded-xl p-2.5 text-center">
            <div className="flex items-center justify-center gap-1 mb-0.5">
              <Clock className="w-3.5 h-3.5 text-blue-500" />
            </div>
            <p className="text-[11px] font-black leading-tight">
              {isExpired ? 'Ended' : formatDistanceToNow(new Date(challenge.end_date), { addSuffix: false })}
            </p>
            <p className="text-[10px] text-muted-foreground">{isExpired ? '' : 'left'}</p>
          </div>
        </div>

        {/* Prize */}
        {challenge.prize && (
          <div className="flex items-center gap-2 px-3 py-2 bg-amber-500/10 border border-amber-500/20 rounded-xl mb-3">
            <Gift className="w-4 h-4 text-amber-500 shrink-0" />
            <div>
              <p className="text-xs font-bold text-amber-700 dark:text-amber-400">Prize</p>
              <p className="text-sm text-amber-800 dark:text-amber-300">{challenge.prize}</p>
            </div>
          </div>
        )}

        {/* End date */}
        <div className="flex items-center gap-2 text-xs text-muted-foreground mb-4">
          <CalendarDays className="w-3.5 h-3.5" />
          <span>
            {isExpired ? 'Ended' : 'Ends'} {format(new Date(challenge.end_date), 'MMM d, yyyy')}
          </span>
        </div>

        {/* Enter / Join button */}
        <div className="flex gap-2">
          {!isExpired && (
            <button
              onClick={handleEnter}
              disabled={entering || hasEntered}
              className={`flex-1 py-3 rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2 ${
                hasEntered
                  ? 'bg-green-500/10 text-green-600 border border-green-500/20'
                  : 'bg-primary text-primary-foreground hover:opacity-90'
              }`}
            >
              {entering
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : hasEntered
                  ? <><CheckCircle className="w-4 h-4" />You're In!</>
                  : <><Plus className="w-4 h-4" />Join Challenge</>}
            </button>
          )}
          {/* Quick compose button — pre-fills hashtag */}
          <button
            onClick={() => navigate(`/?compose=true&hashtag=${hashtag}`)}
            className="flex items-center gap-1.5 px-4 py-3 rounded-xl border border-primary/30 text-primary font-bold text-sm hover:bg-primary/5 transition-colors"
          >
            <Pencil className="w-4 h-4" /> Post
          </button>
        </div>
      </div>

      {/* ── Analytics Panel toggle button ── */}
      <div className="px-4 py-2 border-b border-border">
        <button
          onClick={() => setShowAnalytics(v => !v)}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold border-2 transition-all w-full justify-center ${
            showAnalytics
              ? 'border-primary bg-primary/10 text-primary'
              : 'border-border hover:border-primary/30 text-muted-foreground hover:text-primary'
          }`}
        >
          <TrendingUp className="w-3.5 h-3.5" />
          {showAnalytics ? 'Hide Analytics' : 'View Challenge Analytics'}
        </button>
      </div>

      {/* ── Analytics Panel ── */}
      {showAnalytics && (() => {
        // Build 7-day submissions chart from post timestamps
        const now = Date.now();
        const days7: { label: string; count: number }[] = Array.from({ length: 7 }, (_, i) => {
          const d = new Date(now - (6 - i) * 86400000);
          return { label: d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }).slice(0, 6), count: 0 };
        });
        posts.forEach(p => {
          const daysAgo = Math.floor((now - new Date(p.created_at).getTime()) / 86400000);
          if (daysAgo >= 0 && daysAgo < 7) days7[6 - daysAgo].count++;
        });
        const maxDay = Math.max(...days7.map(d => d.count), 1);

        // Build 24-hour heatmap from post timestamps
        const hourCounts: number[] = Array(24).fill(0);
        posts.forEach(p => { hourCounts[getHours(new Date(p.created_at))]++; });
        const maxHour = Math.max(...hourCounts, 1);
        const peakHour = hourCounts.indexOf(Math.max(...hourCounts));

        // Top 3 by engagement score
        const top3 = [...posts]
          .sort((a, b) => ((b.likes_count ?? 0) + (b.replies_count ?? 0) * 2) - ((a.likes_count ?? 0) + (a.replies_count ?? 0) * 2))
          .slice(0, 3);

        const totalLikes = posts.reduce((s, p) => s + (p.likes_count ?? 0), 0);
        const totalReplies = posts.reduce((s, p) => s + (p.replies_count ?? 0), 0);
        const avgEngagement = posts.length > 0 ? ((totalLikes + totalReplies) / posts.length).toFixed(1) : '0';

        return (
          <div className="px-4 py-5 border-b border-border space-y-5 bg-gradient-to-br from-primary/3 to-purple-500/3">
            {/* Summary row */}
            <div className="grid grid-cols-3 gap-2">
              {[
                { label: 'Avg Engagement', value: avgEngagement, sub: 'likes + replies' },
                { label: 'Total Likes', value: formatNumber(totalLikes), sub: 'across entries' },
                { label: 'Replies', value: formatNumber(totalReplies), sub: 'across entries' },
              ].map(s => (
                <div key={s.label} className="bg-card border border-border rounded-xl p-3 text-center">
                  <p className="text-lg font-black text-primary">{s.value}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">{s.label}</p>
                  <p className="text-[9px] text-muted-foreground">{s.sub}</p>
                </div>
              ))}
            </div>

            {/* 7-day submissions bar chart */}
            <div className="bg-card border border-border rounded-xl p-4">
              <p className="font-bold text-xs mb-3 flex items-center gap-1.5">
                <TrendingUp className="w-3.5 h-3.5 text-primary" />Submissions — Last 7 Days
              </p>
              <div className="flex items-end gap-1 h-20">
                {days7.map((d, i) => (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1">
                    <span className="text-[9px] font-bold text-primary">{d.count > 0 ? d.count : ''}</span>
                    <div
                      className="w-full rounded-t-md bg-gradient-to-t from-primary to-primary/60 transition-all duration-500"
                      style={{ height: `${Math.max(4, (d.count / maxDay) * 60)}px`, minHeight: '4px' }}
                    />
                    <span className="text-[8px] text-muted-foreground truncate w-full text-center">{d.label}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Peak hour heatmap */}
            {posts.length > 0 && (
              <div className="bg-card border border-border rounded-xl p-4">
                <p className="font-bold text-xs mb-2 flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-orange-500" />
                  Peak Engagement Hour
                  <span className="ml-auto text-[10px] text-orange-500 font-bold">{HOUR_LABELS[peakHour]} ({hourCounts[peakHour]} posts)</span>
                </p>
                <div className="flex gap-px">
                  {hourCounts.map((c, h) => (
                    <div key={h} title={`${HOUR_LABELS[h]}: ${c} posts`}
                      className={`flex-1 rounded-sm transition-all ${
                        h === peakHour ? 'bg-orange-500' :
                        c > maxHour * 0.66 ? 'bg-primary/70' :
                        c > maxHour * 0.33 ? 'bg-primary/40' :
                        c > 0 ? 'bg-primary/20' : 'bg-muted'
                      }`}
                      style={{ height: '20px' }}
                    />
                  ))}
                </div>
                <div className="flex justify-between text-[8px] text-muted-foreground mt-1">
                  <span>12am</span><span>6am</span><span>12pm</span><span>6pm</span><span>11pm</span>
                </div>
              </div>
            )}

            {/* Top 3 contributors */}
            {top3.length > 0 && (
              <div className="bg-card border border-border rounded-xl p-4">
                <p className="font-bold text-xs mb-3 flex items-center gap-1.5">
                  <Trophy className="w-3.5 h-3.5 text-yellow-500" />Top Contributors
                </p>
                <div className="space-y-2">
                  {top3.map((post, i) => (
                    <div key={post.id}
                      onClick={() => navigate(`/post/${post.id}`)}
                      className="flex items-center gap-3 p-2.5 rounded-xl bg-muted/30 hover:bg-muted/50 cursor-pointer transition-colors"
                    >
                      <span className="text-xl shrink-0">{CHALLENGE_MEDALS[i]}</span>
                      <div className="w-8 h-8 rounded-full bg-muted overflow-hidden shrink-0">
                        {post.user_profiles?.avatar_url
                          ? <img src={post.user_profiles.avatar_url} className="w-full h-full object-cover" alt="" />
                          : <div className="w-full h-full flex items-center justify-center text-xs font-bold">{post.user_profiles?.username?.[0]?.toUpperCase()}</div>}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-bold truncate">@{post.user_profiles?.username}</p>
                        <p className="text-[10px] text-muted-foreground truncate">{post.content?.slice(0, 40)}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-xs font-bold text-pink-600">{formatNumber((post.likes_count ?? 0) + (post.replies_count ?? 0) * 2)} pts</p>
                        <p className="text-[9px] text-muted-foreground">{post.likes_count ?? 0}♥ {post.replies_count ?? 0}💬</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {/* Top 3 leaderboard */}
      {leaderboard.length > 0 && (
        <div className="px-4 py-4 border-b border-border">
          <h2 className="font-bold text-base mb-3 flex items-center gap-2">
            <Trophy className="w-4 h-4 text-yellow-500" /> Leaderboard
          </h2>
          <div className="space-y-2">
            {leaderboard.map((post, i) => (
              <div
                key={post.id}
                className="flex items-center gap-3 p-3 rounded-xl bg-muted/30 border border-border cursor-pointer hover:bg-muted/50 transition-colors"
                onClick={() => navigate(`/post/${post.id}`)}
              >
                <span className="text-2xl leading-none">{CHALLENGE_MEDALS[i]}</span>
                <div className="w-9 h-9 rounded-full bg-muted overflow-hidden shrink-0">
                  {post.user_profiles?.avatar_url
                    ? <img src={post.user_profiles.avatar_url} className="w-full h-full object-cover" alt="" />
                    : <div className="w-full h-full flex items-center justify-center text-xs font-bold">{post.user_profiles?.username?.[0]?.toUpperCase()}</div>}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate">@{post.user_profiles?.username}</p>
                  <p className="text-xs text-muted-foreground line-clamp-1">{post.content}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-bold text-pink-600 flex items-center gap-1">
                    <Heart className="w-3.5 h-3.5 fill-pink-600" />{formatNumber(post.likes_count ?? 0)}
                  </p>
                  <p className="text-[10px] text-muted-foreground">{post.replies_count ?? 0} replies</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Entry Feed ── */}
      <div className="border-t border-border">
        {/* Feed header with sort controls */}
        <div className="flex items-center justify-between px-4 py-3 bg-muted/20 border-b border-border">
          <p className="text-sm font-semibold text-muted-foreground">
            {posts.length > 0 ? `${posts.length}+ entries` : 'Entries'}
          </p>
          <div className="flex items-center gap-1 bg-muted rounded-xl p-0.5">
            {FEED_SORT_OPTIONS.map(s => (
              <button key={s} onClick={() => changeSortAndFetch(s, hashtag)}
                className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                  feedSort === s ? 'bg-background shadow text-foreground' : 'text-muted-foreground hover:text-foreground'
                }`}>
                {s === 'engagement' ? '🔥 Top' : '🕐 New'}
              </button>
            ))}
          </div>
        </div>

        {loadingPosts ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-7 h-7 animate-spin text-primary" />
          </div>
        ) : posts.length === 0 ? (
          <div className="flex flex-col items-center py-16 text-muted-foreground text-center px-6">
            <Hash className="w-14 h-14 opacity-20 mb-3" />
            <p className="font-semibold">No entries yet</p>
            <p className="text-sm mt-1">Be the first to post with #{hashtag}!</p>
            <button onClick={() => navigate(`/?compose=true&hashtag=${hashtag}`)}
              className="mt-4 flex items-center gap-1.5 px-4 py-2 bg-primary text-primary-foreground rounded-full text-sm font-bold hover:opacity-90">
              <Pencil className="w-3.5 h-3.5" /> Enter Challenge
            </button>
          </div>
        ) : (
          <>
            {posts.map(post => (
              <div key={post.id} className="border-b border-border">
                {/* Engagement stats bar above the card */}
                <div className="flex items-center gap-4 px-4 pt-3 pb-1">
                  <button onClick={e => handleLike(post.id, e)}
                    disabled={likingId === post.id}
                    className={`flex items-center gap-1.5 text-xs font-bold transition-colors ${
                      likedIds.has(post.id) ? 'text-pink-600' : 'text-muted-foreground hover:text-pink-600'
                    }`}>
                    {likingId === post.id
                      ? <Loader2 className="w-4 h-4 animate-spin" />
                      : <Heart className={`w-4 h-4 ${likedIds.has(post.id) ? 'fill-pink-600' : ''}`} />}
                    {formatNumber(post.likes_count ?? 0)}
                  </button>
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <MessageCircle className="w-4 h-4" />{formatNumber(post.replies_count ?? 0)}
                  </span>
                  <span className="ml-auto text-[10px] text-muted-foreground">
                    {formatDistanceToNow(new Date(post.created_at), { addSuffix: true })}
                  </span>
                  {post.user_id === user?.id && (
                    <span className="text-[10px] font-bold text-primary bg-primary/10 px-2 py-0.5 rounded-full">Your entry</span>
                  )}
                </div>
                <PostCard post={post} onUpdate={() => fetchChallengePosts(hashtag, feedSort, 0)} />
              </div>
            ))}
            {/* Load more button */}
            {posts.length >= FEED_PAGE_SIZE && (
              <div className="flex justify-center py-6">
                <button
                  onClick={() => fetchChallengePosts(hashtag, feedSort, feedPage + 1)}
                  disabled={loadingMore}
                  className="flex items-center gap-2 px-5 py-2.5 border border-border rounded-full text-sm font-semibold hover:bg-muted transition-colors disabled:opacity-50"
                >
                  {loadingMore ? <Loader2 className="w-4 h-4 animate-spin" /> : <ChevronDown className="w-4 h-4" />}
                  {loadingMore ? 'Loading…' : 'Load more entries'}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
