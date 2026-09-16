import { useState, useEffect, useRef, useCallback } from 'react';
import { PageAdBanner } from '@/components/features/AdSenseAd';
import { useParams, useNavigate } from 'react-router-dom';
import { TopBar } from '@/components/layout/TopBar';
import { PostCard } from '@/components/features/PostCard';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import {
  TrendingUp, Hash, Loader2, RefreshCw, CheckCircle,
  MessageCircle, ArrowUpRight,
  Flame, BarChart2, Crown, BadgeCheck
} from 'lucide-react';
import { formatNumber } from '@/lib/utils';
import { toast } from 'sonner';
import { DynamicAd } from '@/components/features/DynamicAd';
import { useSEO } from '@/hooks/useSEO';

// TrendingAdBanner is defined above

const CATEGORY_CONFIG: Record<string, { emoji: string; color: string; bg: string; border: string }> = {
  technology:    { emoji: '💻', color: 'text-blue-600',   bg: 'bg-blue-500/10',   border: 'border-blue-500/20' },
  sports:        { emoji: '⚽', color: 'text-green-600',  bg: 'bg-green-500/10',  border: 'border-green-500/20' },
  politics:      { emoji: '🏛️', color: 'text-red-600',    bg: 'bg-red-500/10',    border: 'border-red-500/20' },
  entertainment: { emoji: '🎭', color: 'text-purple-600', bg: 'bg-purple-500/10', border: 'border-purple-500/20' },
  business:      { emoji: '💼', color: 'text-amber-600',  bg: 'bg-amber-500/10',  border: 'border-amber-500/20' },
  health:        { emoji: '🏃', color: 'text-teal-600',   bg: 'bg-teal-500/10',   border: 'border-teal-500/20' },
  science:       { emoji: '🔬', color: 'text-cyan-600',   bg: 'bg-cyan-500/10',   border: 'border-cyan-500/20' },
  lifestyle:     { emoji: '✨', color: 'text-pink-600',   bg: 'bg-pink-500/10',   border: 'border-pink-500/20' },
};

const DEFAULT_CAT = { emoji: '🔥', color: 'text-primary', bg: 'bg-primary/10', border: 'border-primary/20' };

function TrendingAdBanner() { return <PageAdBanner />; }
export default function TrendingTopicFeedPage() {
  const { topic } = useParams<{ topic: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [posts, setPosts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [topicData, setTopicData] = useState<any>(null);
  const [hashtagData, setHashtagData] = useState<any>(null);
  const [isFollowingHashtag, setIsFollowingHashtag] = useState(false);
  const [followingHashtag, setFollowingHashtag] = useState(false);
  const [postCount, setPostCount] = useState(0);
  const [relatedTopics, setRelatedTopics] = useState<any[]>([]);
  const [topContributors, setTopContributors] = useState<any[]>([]);
  const [activeFilter, setActiveFilter] = useState<'all' | 'verified' | 'media'>('all');

  // Fake sparkline data derived from actual post timestamps (day buckets)
  const [sparklineData, setSparklineData] = useState<number[]>([]);
  const [change24h, setChange24h] = useState<number | null>(null);

  const decodedTopic = decodeURIComponent(topic ?? '');

  useSEO({
    title: decodedTopic ? `${decodedTopic} — Trending on Testagram` : 'Trending',
    description: postCount > 0
      ? `${postCount.toLocaleString()} posts about ${decodedTopic} in the last 7 days. Join the conversation on Testagram.`
      : `See what's trending with ${decodedTopic} on Testagram.`,
    url: `/trending/${encodeURIComponent(decodedTopic)}`,
    type: 'website',
    keywords: `${decodedTopic}, trending, testagram, social media`,
    structuredData: {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Testagram', item: 'https://testagram.site' },
        { '@type': 'ListItem', position: 2, name: 'Trending', item: 'https://testagram.site/explore' },
        { '@type': 'ListItem', position: 3, name: decodedTopic, item: `https://testagram.site/trending/${encodeURIComponent(decodedTopic)}` },
      ],
    },
  });

  const computeSparkline = (rawPosts: any[]) => {
    const now = Date.now();
    const buckets = Array(7).fill(0);
    rawPosts.forEach(p => {
      const age = (now - new Date(p.created_at).getTime()) / (1000 * 60 * 60 * 24);
      const bucket = Math.min(6, Math.floor(age));
      buckets[6 - bucket]++;
    });
    setSparklineData(buckets);
    const today = buckets[6];
    const yesterday = buckets[5];
    if (yesterday > 0) {
      setChange24h(Math.round(((today - yesterday) / yesterday) * 100));
    } else {
      setChange24h(today > 0 ? 100 : 0);
    }
  };

  const computeTopContributors = async (rawPosts: any[]) => {
    const countMap: Record<string, { user: any; count: number }> = {};
    rawPosts.forEach(p => {
      if (!p.user_profiles) return;
      const uid = p.user_id;
      if (!countMap[uid]) countMap[uid] = { user: p.user_profiles, count: 0 };
      countMap[uid].count++;
    });
    const sorted = Object.values(countMap).sort((a, b) => b.count - a.count).slice(0, 5);
    setTopContributors(sorted);
  };

  const fetchTopic = useCallback(async () => {
    if (!decodedTopic) return;

    const { data: td } = await supabase
      .from('trending_topics')
      .select('*')
      .eq('topic', decodedTopic)
      .maybeSingle();
    setTopicData(td ?? null);

    const cleanTag = decodedTopic.replace(/^#/, '');
    const { data: hd } = await supabase
      .from('hashtags')
      .select('*')
      .eq('tag', cleanTag)
      .maybeSingle();
    setHashtagData(hd ?? null);

    if (user && hd) {
      const { data: follow } = await supabase
        .from('hashtag_follows')
        .select('id')
        .eq('user_id', user.id)
        .eq('hashtag_id', hd.id)
        .maybeSingle();
      setIsFollowingHashtag(!!follow);
    }

    // Related topics (same category)
    if (td?.category) {
      const { data: related } = await supabase
        .from('trending_topics')
        .select('*')
        .eq('category', td.category)
        .neq('topic', decodedTopic)
        .order('posts_count', { ascending: false })
        .limit(5);
      setRelatedTopics(related ?? []);
    }
  }, [decodedTopic, user]);

  const fetchPosts = useCallback(async () => {
    if (!decodedTopic) return;
    setRefreshing(true);
    try {
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const { data, count } = await supabase
        .from('posts')
        .select('*, profiles(*)', { count: 'exact' })
        .ilike('content', `%${decodedTopic.replace(/^#/, '')}%`)
        .gte('created_at', sevenDaysAgo)
        .order('likes_count', { ascending: false })
        .limit(60);

      if (data) {
        const sorted = [...data].sort(
          (a, b) => (b.likes_count + b.reposts_count * 2) - (a.likes_count + a.reposts_count * 2)
        );
        setPosts(sorted);
        setPostCount(count ?? data.length);
        computeSparkline(sorted);
        computeTopContributors(sorted);
      }
    } catch (e) {
      console.error('fetchPosts error:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [decodedTopic]);

  useEffect(() => {
    fetchTopic();
    fetchPosts();
  }, [fetchTopic, fetchPosts]);

  const handleFollowHashtag = async () => {
    if (!user) { navigate('/auth'); return; }
    if (!hashtagData) { toast.error('Hashtag not found'); return; }
    setFollowingHashtag(true);
    try {
      if (isFollowingHashtag) {
        await supabase.from('hashtag_follows').delete().eq('user_id', user.id).eq('hashtag_id', hashtagData.id);
        setIsFollowingHashtag(false);
        toast.success(`Unfollowed #${hashtagData.tag}`);
      } else {
        await supabase.from('hashtag_follows').insert({ user_id: user.id, hashtag_id: hashtagData.id });
        setIsFollowingHashtag(true);
        toast.success(`Following #${hashtagData.tag}!`);
      }
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setFollowingHashtag(false);
    }
  };

  const catMeta = topicData?.category ? (CATEGORY_CONFIG[topicData.category] ?? DEFAULT_CAT) : DEFAULT_CAT;

  const filteredPosts = posts.filter(p => {
    if (activeFilter === 'verified') return p.user_profiles?.verified;
    if (activeFilter === 'media') return p.image_url || p.video_url || p.is_video || (p.media_urls && p.media_urls.length > 0);
    return true;
  });

  return (
    <div className="min-h-screen bg-background pb-20">
      <TopBar title="Trending" showBack />
      <TrendingAdBanner />

      {/* Hero header */}
      <div className={`px-4 pt-4 pb-4 border-b border-border bg-gradient-to-br from-primary/5 via-background to-purple-500/5`}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 mb-2">
              <div className={`w-14 h-14 rounded-2xl ${catMeta.bg} border ${catMeta.border} flex items-center justify-center shrink-0 text-2xl shadow-sm`}>
                {catMeta.emoji}
              </div>
              <div className="min-w-0">
                <h1 className="text-xl font-bold truncate">{decodedTopic}</h1>
                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                  {topicData?.category && (
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border capitalize ${catMeta.color} ${catMeta.bg} ${catMeta.border}`}>
                      {catMeta.emoji} {topicData.category}
                    </span>
                  )}
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                    Trending now
                  </span>
                </div>
              </div>
            </div>

            {/* Stats row */}
            <div className="flex items-center gap-5 text-sm flex-wrap">
              <div className="flex flex-col">
                <span className="font-bold text-foreground text-lg leading-tight">{formatNumber(postCount)}</span>
                <span className="text-[10px] text-muted-foreground uppercase tracking-wide">Posts (7d)</span>
              </div>
              {hashtagData?.usage_count != null && (
                <div className="flex flex-col">
                  <span className="font-bold text-foreground text-lg leading-tight">{formatNumber(hashtagData.usage_count)}</span>
                  <span className="text-[10px] text-muted-foreground uppercase tracking-wide">Total uses</span>
                </div>
              )}
              {change24h !== null && (
                <div className="flex flex-col">
                  <span className={`font-bold text-lg leading-tight ${change24h > 0 ? 'text-green-600' : change24h < 0 ? 'text-red-500' : 'text-muted-foreground'}`}>
                    {change24h > 0 ? '+' : ''}{change24h}%
                  </span>
                  <span className="text-[10px] text-muted-foreground uppercase tracking-wide">24h change</span>
                </div>
              )}
            </div>

            {/* Sparkline */}
            {sparklineData.length > 0 && (
              <div className="mt-3 flex items-center gap-3">
                <div className="flex-1">
                  <div className="flex items-end gap-0.5 h-8">
                    {sparklineData.map((v, i) => {
                      const max = Math.max(...sparklineData, 1);
                      const pct = (v / max) * 100;
                      const isToday = i === sparklineData.length - 1;
                      return (
                        <div key={i} className="flex-1 flex flex-col justify-end" title={['Mon','Tue','Wed','Thu','Fri','Sat','Sun'][i]}>
                          <div
                            className={`w-full rounded-t-sm transition-all ${isToday ? 'bg-primary' : 'bg-primary/30'}`}
                            style={{ height: `${Math.max(8, pct)}%` }}
                          />
                        </div>
                      );
                    })}
                  </div>
                  <div className="flex justify-between mt-0.5">
                    <span className="text-[9px] text-muted-foreground">7 days ago</span>
                    <span className="text-[9px] text-primary font-semibold">Today</span>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <BarChart2 className="w-3.5 h-3.5 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">Daily posts</span>
                </div>
              </div>
            )}
          </div>

          {/* Follow + refresh */}
          <div className="flex flex-col items-end gap-2 shrink-0 mt-1">
            <button
              onClick={() => fetchPosts()}
              disabled={refreshing}
              className="p-2 rounded-full border border-border hover:bg-muted transition-colors text-muted-foreground"
              title="Refresh"
            >
              <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
            </button>
            {hashtagData && (
              <button
                onClick={handleFollowHashtag}
                disabled={followingHashtag}
                className={`flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-bold transition-all ${
                  isFollowingHashtag
                    ? 'bg-primary/10 text-primary border border-primary/30 hover:bg-primary/20'
                    : 'bg-primary text-primary-foreground hover:opacity-90 shadow-sm shadow-primary/20'
                }`}
              >
                {followingHashtag
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  : isFollowingHashtag
                    ? <><CheckCircle className="w-3.5 h-3.5" />Following</>
                    : <>+ Follow</>}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Top contributors strip */}
      {topContributors.length > 0 && (
        <div className="px-4 py-3 border-b border-border bg-muted/20">
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2 flex items-center gap-1.5">
            <Crown className="w-3 h-3 text-amber-500" />Top Voices
          </p>
          <div className="flex items-center gap-3">
            {topContributors.map(({ user: u, count }) => (
              <button key={u.id} onClick={() => navigate(`/profile/${u.username}`)}
                className="flex flex-col items-center gap-1 group min-w-0">
                <div className="relative">
                  <div className="w-9 h-9 rounded-full bg-muted overflow-hidden ring-2 ring-offset-1 ring-offset-background ring-border group-hover:ring-primary/50 transition-all">
                    {u.avatar_url
                      ? <img src={u.avatar_url} alt={u.username} className="w-full h-full object-cover" />
                      : <div className="w-full h-full flex items-center justify-center font-bold text-xs">{u.username[0]?.toUpperCase()}</div>}
                  </div>
                  {u.verified && (
                    <div className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-background flex items-center justify-center">
                      <BadgeCheck className="w-3.5 h-3.5 text-primary" fill="currentColor" />
                    </div>
                  )}
                </div>
                <span className="text-[9px] text-muted-foreground font-medium truncate max-w-[44px]">{count} post{count !== 1 ? 's' : ''}</span>
              </button>
            ))}
            <button onClick={() => navigate(`/hashtag/${decodedTopic.replace(/^#/, '')}`)}
              className="flex flex-col items-center gap-1 shrink-0">
              <div className="w-9 h-9 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center">
                <Hash className="w-4 h-4 text-primary" />
              </div>
              <span className="text-[9px] text-primary font-medium">All</span>
            </button>
          </div>
        </div>
      )}

      {/* Filter tabs */}
      <div className="sticky top-14 z-20 bg-background border-b border-border">
        <div className="flex gap-0 overflow-x-auto scrollbar-hide">
          {(['all', 'verified', 'media'] as const).map(f => (
            <button key={f} onClick={() => setActiveFilter(f)}
              className={`shrink-0 px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors flex items-center gap-1.5 ${
                activeFilter === f ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:bg-muted/50'
              }`}>
              {f === 'all' && <><Flame className="w-3.5 h-3.5 text-orange-500" />Top Posts</>}
              {f === 'verified' && <><BadgeCheck className="w-3.5 h-3.5 text-primary" fill="currentColor" />Verified</>}
              {f === 'media' && <><MessageCircle className="w-3.5 h-3.5" />With Media</>}
              {f !== 'all' && posts.filter(p => f === 'verified' ? p.user_profiles?.verified : (p.image_url || p.video_url || p.is_video)).length > 0 && (
                <span className="text-[10px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded-full">
                  {formatNumber(posts.filter(p => f === 'verified' ? p.user_profiles?.verified : (p.image_url || p.video_url || p.is_video)).length)}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Related topics */}
      {relatedTopics.length > 0 && !loading && (
        <div className="px-4 py-3 border-b border-border bg-gradient-to-r from-muted/40 to-background overflow-x-auto scrollbar-hide">
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">Related</p>
          <div className="flex gap-2">
            {relatedTopics.map(rt => {
              const rCat = CATEGORY_CONFIG[rt.category] ?? DEFAULT_CAT;
              return (
                <button key={rt.id}
                  onClick={() => navigate(`/trending/${encodeURIComponent(rt.topic)}`)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border shrink-0 transition-all hover:opacity-80 ${rCat.bg} ${rCat.border} ${rCat.color}`}>
                  <TrendingUp className="w-3 h-3" />
                  {rt.topic}
                  {rt.posts_count > 0 && <span className="opacity-60">{formatNumber(rt.posts_count)}</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* CTA banner */}
      {!loading && posts.length > 0 && (
        <div className="mx-4 mt-3 p-3 bg-gradient-to-r from-primary/8 to-purple-500/5 border border-primary/15 rounded-2xl flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-bold">Join the conversation</p>
            <p className="text-xs text-muted-foreground truncate">Share your take on {decodedTopic}</p>
          </div>
          <button
            onClick={() => navigate('/?compose=1')}
            className="flex items-center gap-1.5 px-4 py-2 bg-primary text-primary-foreground rounded-full text-xs font-bold shrink-0 hover:opacity-90 transition-opacity shadow-sm shadow-primary/20"
          >
            <ArrowUpRight className="w-3.5 h-3.5" />Post
          </button>
        </div>
      )}

      {/* Ad slot */}
      {!loading && posts.length > 3 && (
        <div className="mx-4 mt-3">
          <DynamicAd location="feed_inline" className="rounded-2xl overflow-hidden" />
        </div>
      )}

      {/* Post feed */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      ) : filteredPosts.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground px-6 text-center">
          <Hash className="w-16 h-16 mb-4 opacity-20" />
          <p className="font-bold text-lg mb-1">No posts found</p>
          <p className="text-sm">No {activeFilter !== 'all' ? `${activeFilter} ` : ''}posts for "{decodedTopic}" in the last 7 days.</p>
          {activeFilter !== 'all' && (
            <button onClick={() => setActiveFilter('all')} className="mt-4 px-5 py-2 bg-primary text-primary-foreground rounded-full text-sm font-semibold">Show all posts</button>
          )}
          <button
            onClick={() => navigate('/')}
            className="mt-4 px-6 py-2.5 border border-border rounded-full font-semibold text-sm hover:bg-muted transition-colors"
          >
            Go Home
          </button>
        </div>
      ) : (
        <div className="mt-2">
          {filteredPosts.map((post, idx) => (
            <div key={post.id} className="relative">
              {idx < 3 && (
                <div className="flex items-center gap-2 px-4 pt-2 pb-0 text-xs font-bold">
                  <span className={idx === 0 ? 'text-yellow-500' : idx === 1 ? 'text-slate-400' : 'text-amber-600'}>
                    {idx === 0 ? '🥇' : idx === 1 ? '🥈' : '🥉'} #{idx + 1} most engaged
                  </span>
                  <span className="text-muted-foreground font-normal">
                    · {formatNumber(post.likes_count + post.reposts_count * 2)} reactions
                  </span>
                </div>
              )}
              <PostCard post={post} onUpdate={fetchPosts} />
              {idx === 9 && (
                <div className="px-4 py-2 bg-muted/20 border-b border-border">
                  <DynamicAd location="feed_inline" className="rounded-xl overflow-hidden" />
                </div>
              )}
            </div>
          ))}
          <div className="py-8 text-center text-sm text-muted-foreground">
            Showing top {filteredPosts.length} posts for "{decodedTopic}"
          </div>
        </div>
      )}
    </div>
  );
}
