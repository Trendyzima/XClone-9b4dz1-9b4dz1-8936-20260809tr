import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { TopBar } from '@/components/layout/TopBar';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import {
  Hash, Search, TrendingUp, Check, Plus, Loader2, X, Flame, Users,
  BookOpen, BadgeCheck, Play, Eye, Heart, Star, Sparkles, FileText,
} from 'lucide-react';
import { toast } from 'sonner';
import { formatNumber } from '@/lib/utils';
import { useSEO } from '@/hooks/useSEO';
import { PageAdBanner } from '@/components/features/AdSenseAd';
import { formatDistanceToNow } from 'date-fns';

function HashtagDiscoveryAdBanner() { return <PageAdBanner />; }

const SEARCH_DEBOUNCE_MS = 350;
// Explore tab list — module-level plain array (esbuild guard: no 'as const' used in .map())
const EXPLORE_TABS_LIST: string[] = ['Hashtags', 'Posts', 'Videos', 'Creators', 'Threads'];

export default function HashtagDiscoveryPage() {
  useSEO({ title: 'Explore & Discover', url: '/hashtags', noindex: true });
  const { user } = useAuth();
  const navigate = useNavigate();

  // Hashtag state
  const [followedHashtags, setFollowedHashtags] = useState<any[]>([]);
  const [trendingHashtags, setTrendingHashtags] = useState<any[]>([]);
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [query, setQuery] = useState('');
  const [followedIds, setFollowedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [actionLoading, setActionLoading] = useState('');

  // Explore tabs
  const [activeExploreTab, setActiveExploreTab] = useState('Hashtags');
  const [tabLoading, setTabLoading] = useState(false);

  // Content per tab
  const [recommendedPosts, setRecommendedPosts] = useState<any[]>([]);
  const [recommendedVideos, setRecommendedVideos] = useState<any[]>([]);
  const [recommendedCreators, setRecommendedCreators] = useState<any[]>([]);
  const [recommendedThreads, setRecommendedThreads] = useState<any[]>([]);
  // Creators follow state — parallel arrays (esbuild guard: no Set<string>)
  const [followingCreatorIds, setFollowingCreatorIds] = useState<string[]>([]);
  const [followCreatorLoading, setFollowCreatorLoading] = useState('');

  // ── Fetch recommended content per tab ────────────────────────────────
  const fetchTabContent = useCallback(async (tab: string) => {
    if (tab === 'Hashtags') return;
    setTabLoading(true);
    try {
      if (tab === 'Posts') {
        const since48h = new Date(Date.now() - 48 * 3600000).toISOString();
        const { data } = await supabase
          .from('posts')
          .select('*, user_profiles:profiles!posts_user_id_fkey(id, username, avatar_url, verified_tier)')
          .is('community_id', null)
          .eq('is_video', false)
          .gte('created_at', since48h)
          .order('likes_count', { ascending: false })
          .limit(30);
        // Engagement score: likes×2 + reposts×3 + replies×1.5 + views×0.05
        const scored = (data ?? []).map((p: any) => ({
          ...p,
          _score: (p.likes_count ?? 0) * 2 + (p.reposts_count ?? 0) * 3 + (p.replies_count ?? 0) * 1.5 + (p.views_count ?? 0) * 0.05,
        })).sort((a: any, b: any) => b._score - a._score);
        setRecommendedPosts(scored.slice(0, 20));
      } else if (tab === 'Videos') {
        const since48h = new Date(Date.now() - 48 * 3600000).toISOString();
        const { data } = await supabase
          .from('posts')
          .select('*, user_profiles:profiles!posts_user_id_fkey(id, username, avatar_url, verified_tier)')
          .eq('is_video', true)
          .gte('created_at', since48h)
          .order('views_count', { ascending: false })
          .limit(20);
        setRecommendedVideos(data ?? []);
      } else if (tab === 'Creators') {
        const { data } = await supabase
          .from('profiles')
          .select('id, username, avatar_url, verified, follower_count, bio, is_creator, creator_tier')
          .order('follower_count', { ascending: false })
          .limit(30);
        setRecommendedCreators((data ?? []).filter((u: any) => u.id !== user?.id));
        if (user) {
          const { data: follows } = await supabase.from('follows').select('following_id').eq('follower_id', user.id);
          setFollowingCreatorIds((follows ?? []).map((f: any) => f.following_id));
        }
      } else if (tab === 'Threads') {
        const { data } = await supabase
          .from('threads')
          .select('*, user_profiles:profiles!posts_user_id_fkey(id, username, avatar_url, verified_tier)')
          .eq('is_published', true)
          .order('likes_count', { ascending: false })
          .limit(20);
        setRecommendedThreads(data ?? []);
      }
    } catch (err) {
      console.error('[fetchTabContent]', err);
    } finally {
      setTabLoading(false);
    }
  }, [user?.id]);

  useEffect(() => { fetchTabContent(activeExploreTab); }, [activeExploreTab, fetchTabContent]);

  const handleFollowCreator = async (profileId: string, username: string) => {
    if (!user) { navigate('/auth'); return; }
    setFollowCreatorLoading(profileId);
    const isFollowing = followingCreatorIds.includes(profileId);
    if (isFollowing) {
      await supabase.from('follows').delete().eq('follower_id', user.id).eq('following_id', profileId);
      setFollowingCreatorIds(prev => prev.filter(id => id !== profileId));
    } else {
      await supabase.from('follows').insert({ follower_id: user.id, following_id: profileId });
      setFollowingCreatorIds(prev => [...prev, profileId]);
      toast.success(`Following @${username}!`);
    }
    setFollowCreatorLoading('');
  };

  // ── Load followed hashtags + trending ───────────────────────────────
  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const [followRes, trendRes] = await Promise.all([
        user
          ? supabase.from('hashtag_follows')
              .select('hashtag_id, hashtags(id, tag, usage_count)')
              .eq('user_id', user.id)
              .order('created_at', { ascending: false })
              .limit(100)
          : Promise.resolve({ data: [] }),
        supabase.from('trending_hashtags')
          .select('trend_score, hourly_posts, daily_posts, hashtags(id, tag, usage_count)')
          .order('trend_score', { ascending: false })
          .limit(30),
      ]);
      const followed = ((followRes as any).data ?? []).map((f: any) => f.hashtags).filter(Boolean);
      setFollowedHashtags(followed);
      setFollowedIds(followed.map((h: any) => h.id));
      setTrendingHashtags(
        ((trendRes.data ?? []) as any[])
          .filter((r: any) => r.hashtags)
          .map((r: any) => ({ ...r.hashtags, trend_score: r.trend_score, hourly_posts: r.hourly_posts, daily_posts: r.daily_posts }))
      );
      setLoading(false);
    };
    load();
  }, [user?.id]);

  // ── Debounced search ─────────────────────────────────────────────────
  const doSearch = useCallback(async (q: string) => {
    if (!q.trim()) { setSearchResults([]); return; }
    setSearching(true);
    const clean = q.replace(/^#/, '').toLowerCase();
    const { data } = await supabase.from('hashtags')
      .select('id, tag, usage_count')
      .ilike('tag', `${clean}%`)
      .order('usage_count', { ascending: false })
      .limit(20);
    setSearchResults(data ?? []);
    setSearching(false);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => doSearch(query), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query, doSearch]);

  const toggleFollow = async (tag: string, hashtagId: string) => {
    if (!user) { navigate('/auth'); return; }
    setActionLoading(hashtagId);
    const isFollowing = followedIds.includes(hashtagId);
    if (isFollowing) {
      await supabase.from('hashtag_follows').delete().eq('user_id', user.id).eq('hashtag_id', hashtagId);
      setFollowedIds(prev => prev.filter(id => id !== hashtagId));
      setFollowedHashtags(prev => prev.filter(h => h.id !== hashtagId));
      toast.success(`Unfollowed #${tag}`);
    } else {
      await supabase.from('hashtag_follows').insert({ user_id: user.id, hashtag_id: hashtagId });
      setFollowedIds(prev => [...prev, hashtagId]);
      const htData = trendingHashtags.find(h => h.id === hashtagId)
        ?? searchResults.find(h => h.id === hashtagId)
        ?? { id: hashtagId, tag, usage_count: 0 };
      setFollowedHashtags(prev => [htData, ...prev]);
      toast.success(`Following #${tag}!`);
    }
    setActionLoading('');
  };

  const unfollowAll = async () => {
    if (!user || followedHashtags.length === 0) return;
    if (!window.confirm(`Unfollow all ${followedHashtags.length} hashtags?`)) return;
    await supabase.from('hashtag_follows').delete().eq('user_id', user.id);
    setFollowedHashtags([]);
    setFollowedIds([]);
    toast.success('Unfollowed all hashtags');
  };

  const displayList = query.trim() ? searchResults : trendingHashtags;

  return (
    <div className="min-h-screen bg-background pb-16 md:pb-0">
      <TopBar title="Explore & Discover" showBack />
      <HashtagDiscoveryAdBanner />

      {/* Search bar + tab switcher */}
      <div className="sticky top-14 z-20 bg-background border-b border-border px-4 py-3">
        <div className="relative mb-3">
          {searching
            ? <Loader2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground animate-spin" />
            : <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />}
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search hashtags, creators, topics…"
            className="w-full pl-10 pr-10 py-2.5 bg-muted/50 border border-border rounded-full text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:bg-background transition-colors"
          />
          {query && (
            <button onClick={() => { setQuery(''); setSearchResults([]); }}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
        {/* Explore tabs */}
        <div className="flex gap-1.5 overflow-x-auto scrollbar-hide pb-0.5">
          {EXPLORE_TABS_LIST.map(tab => (
            <button key={tab} onClick={() => setActiveExploreTab(tab)}
              className={`flex-shrink-0 px-3.5 py-1.5 rounded-full text-xs font-bold border-2 transition-all ${
                activeExploreTab === tab
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'border-border text-muted-foreground hover:border-primary/40 hover:text-foreground'
              }`}>
              {tab}
            </button>
          ))}
        </div>
      </div>

      <div className="max-w-2xl mx-auto">

        {/* ── POSTS TAB ── */}
        {activeExploreTab === 'Posts' && !query && (
          <section>
            <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
              <Sparkles className="w-4 h-4 text-primary" />
              <h2 className="font-bold text-sm">Recommended Posts</h2>
              <span className="text-xs text-muted-foreground ml-auto">AI-ranked · last 48h</span>
            </div>
            {tabLoading ? (
              <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
            ) : recommendedPosts.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground"><FileText className="w-10 h-10 mx-auto mb-2 opacity-20" /><p className="text-sm">No posts yet</p></div>
            ) : (
              <div className="divide-y divide-border">
                {recommendedPosts.map((post: any, idx: number) => (
                  <button key={post.id} onClick={() => navigate(`/post/${post.id}`)} className="w-full text-left px-4 py-3.5 hover:bg-muted/20 transition-colors flex gap-3">
                    <div className="w-8 h-8 rounded-full bg-muted overflow-hidden shrink-0">
                      {post.user_profiles?.avatar_url
                        ? <img src={post.user_profiles.avatar_url} alt="" className="w-full h-full object-cover" />
                        : <div className="w-full h-full flex items-center justify-center text-xs font-bold">{post.user_profiles?.username?.[0]?.toUpperCase()}</div>}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1 mb-0.5">
                        <span className="text-xs font-bold truncate">@{post.user_profiles?.username}</span>
                        {post.user_profiles?.verified && <BadgeCheck className="w-3 h-3 text-primary shrink-0" fill="currentColor" />}
                        <span className="text-[10px] text-muted-foreground ml-auto shrink-0">{formatDistanceToNow(new Date(post.created_at), { addSuffix: true })}</span>
                      </div>
                      <p className="text-sm line-clamp-2 text-foreground/90 leading-snug">{post.content?.slice(0, 140)}</p>
                      {post.image_url && <div className="mt-2 w-full h-28 rounded-xl overflow-hidden bg-muted"><img src={post.image_url} alt="" className="w-full h-full object-cover" loading="lazy" /></div>}
                      <div className="flex items-center gap-3 mt-1.5 text-[10px] text-muted-foreground">
                        <span className="flex items-center gap-0.5"><Heart className="w-3 h-3" />{formatNumber(post.likes_count ?? 0)}</span>
                        <span className="flex items-center gap-0.5"><Eye className="w-3 h-3" />{formatNumber(post.views_count ?? 0)}</span>
                        {idx === 0 && <span className="text-[9px] font-black bg-orange-500/15 text-orange-600 px-1.5 py-0.5 rounded-full">🔥 Top</span>}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </section>
        )}

        {/* ── VIDEOS TAB ── */}
        {activeExploreTab === 'Videos' && !query && (
          <section>
            <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
              <Play className="w-4 h-4 text-primary" />
              <h2 className="font-bold text-sm">Trending Videos</h2>
              <button onClick={() => navigate('/videos')} className="ml-auto text-xs text-primary font-bold hover:underline">Open feed →</button>
            </div>
            {tabLoading ? (
              <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
            ) : (
              <div className="grid grid-cols-2 gap-2 p-3">
                {recommendedVideos.map((v: any, idx: number) => (
                  <button key={v.id} onClick={() => navigate(`/videos?id=${v.id}`)} className="relative rounded-2xl overflow-hidden bg-zinc-900 hover:scale-[1.02] active:scale-[0.98] transition-transform" style={{ aspectRatio: '9/16' }}>
                    {v.image_url
                      ? <img src={v.image_url} alt="" className="absolute inset-0 w-full h-full object-cover" loading="lazy" />
                      : <video src={`${v.video_url}#t=0.5`} className="absolute inset-0 w-full h-full object-cover" muted preload="metadata" playsInline />}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-transparent to-black/20" />
                    {idx < 3 && (
                      <div className="absolute top-2 left-2 w-6 h-6 rounded-full bg-black/60 flex items-center justify-center">
                        <span className={`text-[9px] font-black ${idx === 0 ? 'text-yellow-400' : idx === 1 ? 'text-slate-300' : 'text-amber-600'}`}>#{idx+1}</span>
                      </div>
                    )}
                    <div className="absolute top-2 right-2 w-5 h-5 rounded-full bg-black/50 flex items-center justify-center">
                      <Play className="w-3 h-3 text-white fill-white" />
                    </div>
                    <div className="absolute bottom-0 left-0 right-0 p-2.5">
                      <div className="flex items-center gap-1 mb-1">
                        <div className="w-4 h-4 rounded-full overflow-hidden bg-muted shrink-0">
                          {v.user_profiles?.avatar_url ? <img src={v.user_profiles.avatar_url} alt="" className="w-full h-full object-cover" /> : null}
                        </div>
                        <span className="text-white text-[9px] font-semibold truncate">@{v.user_profiles?.username}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="flex items-center gap-0.5 text-white/70 text-[9px]"><Eye className="w-2.5 h-2.5" />{formatNumber(v.views_count ?? 0)}</span>
                        <span className="flex items-center gap-0.5 text-white/70 text-[9px]"><Heart className="w-2.5 h-2.5" />{formatNumber(v.likes_count ?? 0)}</span>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </section>
        )}

        {/* ── CREATORS TAB ── */}
        {activeExploreTab === 'Creators' && !query && (
          <section>
            <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
              <Star className="w-4 h-4 text-amber-500" />
              <h2 className="font-bold text-sm">Suggested Creators</h2>
              <span className="text-xs text-muted-foreground ml-auto">AI-matched for you</span>
            </div>
            {tabLoading ? (
              <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
            ) : (
              <div className="divide-y divide-border">
                {recommendedCreators.map((creator: any) => {
                  const isFollowing = followingCreatorIds.includes(creator.id);
                  return (
                    <div key={creator.id} className="flex items-center gap-3 px-4 py-3.5">
                      <button onClick={() => navigate(`/profile/${creator.username}`)} className="w-12 h-12 rounded-full bg-muted overflow-hidden shrink-0">
                        {creator.avatar_url ? <img src={creator.avatar_url} alt={creator.username} className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center font-bold">{creator.username[0]?.toUpperCase()}</div>}
                      </button>
                      <div className="flex-1 min-w-0 cursor-pointer" onClick={() => navigate(`/profile/${creator.username}`)}>
                        <div className="flex items-center gap-1 flex-wrap">
                          <span className="font-bold text-sm truncate">{creator.username}</span>
                          {creator.verified && <BadgeCheck className="w-3.5 h-3.5 text-primary shrink-0" fill="currentColor" />}
                          {creator.is_creator && <span className="text-[9px] bg-purple-500/10 text-purple-600 font-bold px-1.5 py-0.5 rounded-full border border-purple-500/20">Creator</span>}
                        </div>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                          <span className="flex items-center gap-0.5"><Users className="w-3 h-3" />{formatNumber(creator.follower_count ?? 0)}</span>
                          {creator.bio && <span className="truncate max-w-[120px]">{creator.bio.slice(0, 50)}</span>}
                        </div>
                      </div>
                      <button
                        onClick={() => handleFollowCreator(creator.id, creator.username)}
                        disabled={followCreatorLoading === creator.id}
                        className={`shrink-0 px-3.5 py-1.5 rounded-full text-xs font-bold border-2 transition-all disabled:opacity-50 ${
                          isFollowing
                            ? 'bg-primary/10 border-primary/30 text-primary hover:bg-primary/20'
                            : 'border-primary text-primary hover:bg-primary hover:text-primary-foreground'
                        }`}>
                        {followCreatorLoading === creator.id
                          ? <Loader2 className="w-3 h-3 animate-spin" />
                          : isFollowing ? <><Check className="w-3 h-3 inline mr-0.5" />Following</> : <><Plus className="w-3 h-3 inline mr-0.5" />Follow</>}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {/* ── THREADS TAB ── */}
        {activeExploreTab === 'Threads' && !query && (
          <section>
            <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
              <BookOpen className="w-4 h-4 text-primary" />
              <h2 className="font-bold text-sm">Top Threads</h2>
              <button onClick={() => navigate('/threads')} className="ml-auto text-xs text-primary font-bold hover:underline">All threads →</button>
            </div>
            {tabLoading ? (
              <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
            ) : (
              <div className="divide-y divide-border">
                {recommendedThreads.map((thread: any) => (
                  <button key={thread.id} onClick={() => navigate(`/thread/${thread.id}`)} className="w-full text-left px-4 py-4 hover:bg-muted/20 transition-colors">
                    <div className="flex items-center gap-2 mb-1.5">
                      <div className="w-7 h-7 rounded-full bg-muted overflow-hidden shrink-0">
                        {thread.user_profiles?.avatar_url ? <img src={thread.user_profiles.avatar_url} alt="" className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-[10px] font-bold">{thread.user_profiles?.username?.[0]?.toUpperCase()}</div>}
                      </div>
                      <span className="text-xs font-semibold">@{thread.user_profiles?.username}</span>
                      {thread.user_profiles?.verified && <BadgeCheck className="w-3 h-3 text-primary" fill="currentColor" />}
                      <span className="text-[10px] text-muted-foreground ml-auto">{formatDistanceToNow(new Date(thread.created_at), { addSuffix: true })}</span>
                    </div>
                    <h3 className="font-bold text-sm leading-snug mb-1">{thread.title}</h3>
                    <p className="text-xs text-muted-foreground line-clamp-2">{thread.content?.replace(/<[^>]*>/g, '').slice(0, 100)}</p>
                    <div className="flex items-center gap-3 mt-2 text-[10px] text-muted-foreground">
                      <span className="flex items-center gap-0.5"><Heart className="w-3 h-3" />{formatNumber(thread.likes_count ?? 0)}</span>
                      <span className="flex items-center gap-0.5"><Eye className="w-3 h-3" />{formatNumber(thread.views_count ?? 0)}</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </section>
        )}

        {/* ── HASHTAGS TAB ── */}
        {(activeExploreTab === 'Hashtags' || query) && (
          <>
            {/* Followed Hashtags section */}
            {!query && (
              <section className="border-b border-border">
                <div className="flex items-center justify-between px-4 py-3">
                  <div className="flex items-center gap-2">
                    <BookOpen className="w-4 h-4 text-primary" />
                    <h2 className="font-bold text-sm">
                      Following
                      {followedHashtags.length > 0 && (
                        <span className="ml-1.5 text-xs font-semibold text-primary bg-primary/10 px-1.5 py-0.5 rounded-full">
                          {followedHashtags.length}
                        </span>
                      )}
                    </h2>
                  </div>
                  {followedHashtags.length > 0 && (
                    <button onClick={unfollowAll} className="text-xs text-muted-foreground hover:text-destructive transition-colors font-medium">
                      Unfollow all
                    </button>
                  )}
                </div>

                {loading ? (
                  <div className="flex justify-center py-8">
                    <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                  </div>
                ) : followedHashtags.length === 0 ? (
                  <div className="text-center py-8 px-6 text-muted-foreground">
                    <Hash className="w-10 h-10 mx-auto mb-2 opacity-20" />
                    <p className="text-sm font-medium">No hashtags followed yet</p>
                    <p className="text-xs mt-1">Follow hashtags below to see posts from them in your feed</p>
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2 px-4 pb-4">
                    {followedHashtags.map((h: any) => (
                      <div key={h.id} className="group flex items-center gap-1 pl-3 pr-1 py-1.5 rounded-full bg-primary/10 border border-primary/25 hover:border-primary/40 transition-colors">
                        <button onClick={() => navigate(`/hashtag/${h.tag}`)}
                          className="flex items-center gap-1 text-primary text-sm font-bold hover:underline">
                          <Hash className="w-3.5 h-3.5" />{h.tag}
                          {h.usage_count > 0 && <span className="text-[10px] text-primary/60 font-normal">{formatNumber(h.usage_count)}</span>}
                        </button>
                        <button onClick={() => toggleFollow(h.tag, h.id)} disabled={actionLoading === h.id}
                          className="w-6 h-6 rounded-full bg-primary/15 hover:bg-destructive/20 hover:text-destructive text-primary flex items-center justify-center transition-colors ml-1">
                          {actionLoading === h.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <X className="w-3 h-3" />}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            )}

            {/* Trending / Search results */}
            <section>
              <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
                {query ? <Search className="w-4 h-4 text-primary" /> : <Flame className="w-4 h-4 text-orange-500" />}
                <h2 className="font-bold text-sm">{query ? `Results for "${query}"` : 'Trending Hashtags'}</h2>
                {searching && <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground ml-auto" />}
              </div>

              {displayList.length === 0 && !loading && !searching ? (
                <div className="text-center py-12 text-muted-foreground">
                  <Hash className="w-10 h-10 mx-auto mb-2 opacity-20" />
                  <p className="text-sm">{query ? 'No hashtags found' : 'No trending hashtags yet'}</p>
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {displayList.map((h: any, idx: number) => {
                    const isFollowing = followedIds.includes(h.id);
                    return (
                      <div key={h.id}
                        className="flex items-center gap-3 px-4 py-3.5 hover:bg-muted/20 transition-colors">
                        {/* Rank */}
                        {!query && (
                          <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 font-black text-sm ${
                            idx === 0 ? 'bg-orange-500 text-white' :
                            idx === 1 ? 'bg-amber-400 text-white' :
                            idx === 2 ? 'bg-yellow-300 text-yellow-900' :
                            'bg-muted text-muted-foreground'
                          }`}>{idx + 1}</div>
                        )}
                        {/* Hashtag info */}
                        <div className="flex-1 min-w-0 cursor-pointer" onClick={() => navigate(`/hashtag/${h.tag}`)}>
                          <div className="flex items-center gap-1.5">
                            <Hash className="w-4 h-4 text-primary shrink-0" />
                            <span className="font-bold text-sm">{h.tag}</span>
                            {!query && h.trend_score > 50 && (
                              <TrendingUp className="w-3.5 h-3.5 text-orange-500 shrink-0" />
                            )}
                          </div>
                          <div className="flex items-center gap-3 mt-0.5">
                            <span className="text-xs text-muted-foreground flex items-center gap-1">
                              <Users className="w-3 h-3" />{formatNumber(h.usage_count ?? 0)} posts
                            </span>
                            {h.daily_posts > 0 && (
                              <span className="text-xs text-orange-500 font-semibold">
                                +{formatNumber(h.daily_posts)}/day
                              </span>
                            )}
                          </div>
                        </div>
                        {/* Follow / Unfollow button */}
                        {user && (
                          <button
                            onClick={() => toggleFollow(h.tag, h.id)}
                            disabled={actionLoading === h.id}
                            className={`flex items-center gap-1 px-3.5 py-1.5 rounded-full text-xs font-bold border-2 transition-all shrink-0 disabled:opacity-50 ${
                              isFollowing
                                ? 'bg-primary/10 border-primary/30 text-primary hover:bg-primary/20'
                                : 'border-primary text-primary hover:bg-primary hover:text-primary-foreground'
                            }`}
                          >
                            {actionLoading === h.id
                              ? <Loader2 className="w-3 h-3 animate-spin" />
                              : isFollowing ? <><Check className="w-3 h-3" />Following</> : <><Plus className="w-3 h-3" />Follow</>}
                          </button>
                        )}
                        {!user && (
                          <button onClick={() => navigate('/auth')}
                            className="flex items-center gap-1 px-3.5 py-1.5 rounded-full text-xs font-bold border-2 border-primary text-primary hover:bg-primary hover:text-primary-foreground transition-colors shrink-0">
                            <Plus className="w-3 h-3" />Follow
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}
