
import { useState, useEffect, useRef } from 'react';
import { PageAdBanner } from '@/components/features/AdSenseAd';
import { useNavigate } from 'react-router-dom';
import { TopBar } from '@/components/layout/TopBar';
import { Input } from '@/components/ui/input';
import { Search, TrendingUp, Globe, BadgeCheck, Settings, X, Check, Trophy, Gift, Clock, Hash, ChevronRight, Loader2, BookOpen, Eye, Play, ChevronLeft, ChevronRight as ChevronRightIcon, Flame, Users as UsersIcon, Star } from 'lucide-react';
import { TrendingVideosSection } from '@/components/features/TrendingVideosSection';
import { formatDistanceToNow } from 'date-fns';
import { supabase } from '@/lib/supabase';
import { formatNumber } from '@/lib/utils';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import { useSEO } from '@/hooks/useSEO';
import { backendCapabilities } from '@/services/testagramCapabilityClient';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { ShoppingBag, Star as StarIcon, Heart as HeartIcon, MapPin as MapPinIcon, BadgeCheck as BadgeCheckIcon, ExternalLink as ExtLinkIcon } from 'lucide-react';

// ── Explore Marketplace Tab ──────────────────────────────────────────────────
const EXP_MKT_CATS = [
  { id: 'all', emoji: '🛍️', label: 'All' },
  { id: 'digital', emoji: '💻', label: 'Digital' },
  { id: 'handmade', emoji: '🧵', label: 'Handmade' },
  { id: 'fashion', emoji: '👗', label: 'Fashion' },
  { id: 'art', emoji: '🎨', label: 'Art' },
  { id: 'food', emoji: '🍜', label: 'Food' },
  { id: 'electronics', emoji: '📱', label: 'Electronics' },
  { id: 'other', emoji: '📦', label: 'Other' },
];

function ExploreMarketplace({ searchQuery, navigate }: { searchQuery: string; navigate: (p: string) => void }) {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [catFilter, setCatFilter] = useState('all');
  const [wishlistIds, setWishlistIds] = useState([] as string[]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem('mkt_wishlist_v2');
      if (raw) setWishlistIds(JSON.parse(raw) as string[]);
    } catch { /* ignore */ }
  }, []);

  const toggleWishlist = (id: string) => {
    setWishlistIds(prev => {
      const next = prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id];
      try { localStorage.setItem('mkt_wishlist_v2', JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      let query = supabase
        .from('products')
        .select('*, user_profiles:profiles!products_user_id_fkey(id, username, avatar_url, verified_tier)')
        .eq('is_active', true)
        .order('views_count', { ascending: false })
        .limit(60);
      if (catFilter !== 'all') query = query.eq('category', catFilter);
      const { data } = await query;
      if (!cancelled) { setProducts(data ?? []); setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [catFilter]);

  const filtered = (products as any[]).filter(p => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (p.name ?? '').toLowerCase().includes(q) || (p.description ?? '').toLowerCase().includes(q);
  });

  return (
    <div className="pb-4">
      {/* Header */}
      <div className="px-4 pt-4 pb-3 flex items-center gap-3 border-b border-border bg-gradient-to-r from-primary/5 to-background">
        <span className="text-3xl">🛍️</span>
        <div className="flex-1 min-w-0">
          <h2 className="font-black text-xl">Marketplace</h2>
          <p className="text-xs text-muted-foreground">{filtered.length} products • tap to explore</p>
        </div>
        <button onClick={() => navigate('/marketplace')}
          className="flex items-center gap-1 text-xs text-primary font-bold hover:underline">
          See all <ExtLinkIcon className="w-3 h-3" />
        </button>
      </div>

      {/* Category pills */}
      <div className="flex gap-2 overflow-x-auto scrollbar-hide px-4 py-3 border-b border-border">
        {EXP_MKT_CATS.map(cat => (
          <button key={cat.id} onClick={() => setCatFilter(cat.id)}
            className={`shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-full border text-xs font-semibold transition-all ${
              catFilter === cat.id
                ? 'border-primary bg-primary text-primary-foreground shadow-sm'
                : 'border-border bg-muted/30 text-muted-foreground hover:border-primary/40'
            }`}>
            <span>{cat.emoji}</span>{cat.label}
          </button>
        ))}
      </div>

      {/* Products grid */}
      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-7 h-7 animate-spin text-primary" /></div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16">
          <ShoppingBag className="w-14 h-14 text-muted-foreground/20 mx-auto mb-3" />
          <p className="font-bold text-sm">No products found</p>
          <button onClick={() => { setCatFilter('all'); }} className="mt-2 text-xs text-primary hover:underline">Clear filters</button>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 p-4">
          {filtered.map((p: any) => (
            <div key={p.id}
              className="rounded-2xl overflow-hidden border border-border bg-card hover:shadow-lg hover:-translate-y-0.5 transition-all group cursor-pointer"
              onClick={() => navigate('/marketplace')}>
              <div className="relative w-full aspect-square bg-muted overflow-hidden">
                {p.image_url
                  ? <img src={p.image_url} alt={p.name} loading="lazy" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                  : <div className="w-full h-full flex items-center justify-center"><ShoppingBag className="w-8 h-8 text-muted-foreground/30" /></div>}
                <button onClick={e => { e.stopPropagation(); toggleWishlist(p.id); }}
                  className={`absolute top-2 right-2 w-7 h-7 rounded-full flex items-center justify-center transition-all ${
                    wishlistIds.includes(p.id) ? 'bg-red-500 text-white' : 'bg-black/40 text-white hover:bg-red-500'
                  }`}>
                  <HeartIcon className={`w-3.5 h-3.5 ${wishlistIds.includes(p.id) ? 'fill-white' : ''}`} />
                </button>
                {p.is_featured && (
                  <div className="absolute top-2 left-2 px-1.5 py-0.5 bg-yellow-400/90 text-yellow-900 rounded-full text-[9px] font-bold flex items-center gap-0.5">
                    <StarIcon className="w-2 h-2 fill-current" /> Featured
                  </div>
                )}
              </div>
              <div className="p-2.5">
                <p className="font-semibold text-xs line-clamp-2 leading-tight mb-1">{p.name}</p>
                <p className="text-sm font-black text-primary">${Number(p.price).toFixed(2)}</p>
                <div className="flex items-center gap-1 mt-1.5">
                  <div className="w-4 h-4 rounded-full bg-muted overflow-hidden shrink-0">
                    {p.user_profiles?.avatar_url
                      ? <img src={p.user_profiles.avatar_url} alt="" className="w-full h-full object-cover" />
                      : <div className="w-full h-full flex items-center justify-center text-[7px] font-bold">{p.user_profiles?.username?.[0]?.toUpperCase()}</div>}
                  </div>
                  <span className="text-[10px] text-muted-foreground truncate">@{p.user_profiles?.username}</span>
                  {p.user_profiles?.verified && <BadgeCheckIcon className="w-2.5 h-2.5 text-primary shrink-0" />}
                </div>
                {p.external_link ? (
                  <a href={p.external_link} target="_blank" rel="noopener noreferrer"
                    onClick={e => e.stopPropagation()}
                    className="mt-2 flex items-center justify-center gap-1 py-1 bg-primary/10 hover:bg-primary/20 text-primary text-[10px] font-bold rounded-lg transition-colors">
                    Buy <ExtLinkIcon className="w-2.5 h-2.5" />
                  </a>
                ) : (
                  <button onClick={e => { e.stopPropagation(); navigate('/marketplace'); }}
                    className="mt-2 w-full py-1 bg-muted/60 hover:bg-muted text-muted-foreground text-[10px] font-bold rounded-lg transition-colors">
                    View
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* CTA */}
      <div className="px-4 pb-2">
        <button onClick={() => navigate('/marketplace')}
          className="w-full py-3 border border-primary/30 rounded-2xl text-sm font-bold text-primary hover:bg-primary/5 transition-colors flex items-center justify-center gap-2">
          <ShoppingBag className="w-4 h-4" /> Browse Full Marketplace
        </button>
      </div>
    </div>
  );
}

// ── Module-level trending filter categories (esbuild guard: no as-const in render)
// esbuild guard: no 'as const' on module-level arrays used in .map() render
const TRENDING_FILTER_CATS: string[] = ['All', 'Tech', 'Sports', 'Entertainment', 'Music', 'Politics'];
// Plain object — no index-sig type annotation (esbuild guard)
const TRENDING_FILTER_KEYWORDS = {
  Tech:          ['tech', 'ai', 'code', 'dev', 'app', 'crypto', 'web', 'data', 'software', 'digital', 'robot', 'cloud'],
  Sports:        ['sport', 'football', 'soccer', 'basketball', 'tennis', 'cricket', 'nba', 'epl', 'run', 'athlete', 'game', 'champion'],
  Entertainment: ['movie', 'music', 'film', 'actor', 'show', 'drama', 'celebr', 'netflix', 'concert', 'dance', 'art', 'vibe'],
  Music:         ['music', 'song', 'artist', 'album', 'rap', 'pop', 'hiphop', 'afro', 'rnb', 'bongo', 'gengetone'],
  Politics:      ['politic', 'election', 'vote', 'govern', 'president', 'parliament', 'policy', 'law', 'kenya', 'nairobi'],
};

type ExploreTab = 'Explore' | 'Trending' | 'News' | 'Sports' | 'Entertainment' | 'Marketplace';
// ── Search history storage key (module-level — esbuild guard) ─────────────
const SEARCH_HISTORY_KEY = 'ts-explore-search-history';

function ExploreAdBanner() { return <PageAdBanner />; }

// ── Category keywords for post-based feeds (esbuild guard: no type annotation on module-level array)
const CAT_KEYWORDS_MAP = [
  ['news','breaking','update','today','report','announce','latest','story','headlines','press','journalist'],
  ['sport','football','soccer','basketball','nba','nfl','tennis','cricket','athletics','run','goal','match','score','champion'],
  ['movie','music','film','actor','drama','show','tv','series','netflix','concert','dance','art','celebrity','vibe','entertainment','festival'],
];
const CAT_NAMES = ['News', 'Sports', 'Entertainment'];
const CAT_EMOJIS = ['📰', '⚽', '🎬'];
const RANK_MEDAL = ['🥇','🥈','🥉'];

// Rank badge colors pre-computed (esbuild guard: plain arrays, no inline ternary chains in render)
const RANK_COLORS = ['text-yellow-400','text-slate-300','text-amber-600','text-muted-foreground'];

// Reaction emojis — module-level (esbuild guard)
const REACTION_EMOJIS = ['❤️', '🔥', '😮', '👏'];

// ── PostReactionBar: extracted as module-level component (esbuild guard: no IIFE in render)
function PostReactionBar({
  postId, myEmoji, rxSummary, onReact,
}: {
  postId: string;
  myEmoji: string | null;
  rxSummary: { top2: string[]; total: number };
  onReact: (postId: string, emoji: string) => void;
}) {
  const top2Str = rxSummary.top2.join('');
  const hasCount = rxSummary.total > 0;
  return (
    <div className="flex items-center gap-1.5 px-4 pb-2.5 pt-0.5">
      {REACTION_EMOJIS.map(emoji => {
        const isActive = myEmoji === emoji;
        return (
          <button
            key={emoji}
            onClick={() => onReact(postId, emoji)}
            className={`w-9 h-8 flex items-center justify-center rounded-full text-base transition-all active:scale-125 ${
              isActive ? 'bg-primary/15 ring-1 ring-primary/30' : 'hover:bg-muted/60'
            }`}
          >{emoji}</button>
        );
      })}
      {hasCount && (
        <span className="ml-1 text-[11px] text-muted-foreground flex items-center gap-0.5">
          {top2Str} {formatNumber(rxSummary.total)}
        </span>
      )}
    </div>
  );
}

function CategoryTabContent({
  activeTab, trendingTopics, navigateTopic, navigate,
}: {
  activeTab: string;
  trendingTopics: any[];
  navigateTopic: (t: string) => void;
  navigate: (path: string) => void;
}) {
  const { user } = useAuth();
  const [posts, setPosts] = useState([] as any[]);
  const [loading, setLoading] = useState(true);
  // Reactions: parallel arrays — postId → emoji (user's own reaction)
  // esbuild guard: plain useState([]) — no typed generics
  const [rxPostIds, setRxPostIds] = useState([]);
  const [rxEmojis, setRxEmojis] = useState([]);
  // Reaction counts: postId → parallel arrays of emoji + count
  const [rxCountPostIds, setRxCountPostIds] = useState([]);
  const [rxCountEmojis, setRxCountEmojis] = useState([]);
  const [rxCounts, setRxCounts] = useState([]);

  // esbuild guard: no typed ternary — use plain indexed access with fallback
  const catIdx = CAT_NAMES.indexOf(activeTab);
  const keywords = CAT_KEYWORDS_MAP[catIdx] ?? [];
  const catEmoji = CAT_EMOJIS[catIdx] ?? '🔍';

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setPosts([]);
    setRxPostIds([]);
    setRxEmojis([]);
    setRxCountPostIds([]);
    setRxCountEmojis([]);
    setRxCounts([]);
    (async () => {
      const since7d = new Date(Date.now() - 7 * 86400000).toISOString();
      // Build OR filter from keywords
      const orFilter = keywords.map(k => `content.ilike.%${k}%`).join(',');
      const { data } = await supabase
        .from('posts')
        .select('id, content, image_url, video_url, is_video, views_count, likes_count, reposts_count, replies_count, created_at, user_profiles:profiles!posts_author_id_fkey(id, username, avatar_url, verified_tier)')
        .or(orFilter)
        .is('community_id', null)
        .gte('created_at', since7d)
        .order('views_count', { ascending: false })
        .limit(30);
      if (!cancelled) {
        let finalPosts = data ?? [];
        // Also fetch general trending posts if no category matches
        if (finalPosts.length < 5) {
          const { data: fallback } = await supabase
            .from('posts')
            .select('id, content, image_url, video_url, is_video, views_count, likes_count, reposts_count, replies_count, created_at, user_profiles:profiles!posts_author_id_fkey(id, username, avatar_url, verified_tier)')
            .is('community_id', null)
            .gte('created_at', since7d)
            .order('views_count', { ascending: false })
            .limit(30);
          finalPosts = fallback ?? [];
        }
        setPosts(finalPosts);
        setLoading(false);
        // Fetch reactions for these posts
        if (finalPosts.length > 0) {
          const pids = finalPosts.map((p: any) => p.id);
          const { data: rxData } = await supabase
            .from('post_reactions')
            .select('post_id, user_id, emoji')
            .in('post_id', pids);
          if (!cancelled && rxData) {
            // Build count map using parallel arrays (esbuild guard: no Record)
            // esbuild guard: no typed array declarations in async closure — use plain untyped
            const cPostIds = [];
            const cEmojis = [];
            const cCounts = [];
            for (const r of rxData) {
              // find existing entry
              let found = false;
              for (let i = 0; i < cPostIds.length; i++) {
                if (cPostIds[i] === r.post_id && cEmojis[i] === r.emoji) {
                  cCounts[i] += 1;
                  found = true;
                  break;
                }
              }
              if (!found) { cPostIds.push(r.post_id); cEmojis.push(r.emoji); cCounts.push(1); }
            }
            setRxCountPostIds(cPostIds as any);
            setRxCountEmojis(cEmojis as any);
            setRxCounts(cCounts as any);
            // User's own reactions
            if (user) {
              const myRx = rxData.filter((r: any) => r.user_id === user.id);
              setRxPostIds(myRx.map((r: any) => r.post_id) as any);
              setRxEmojis(myRx.map((r: any) => r.emoji) as any);
            }
          }
        }
      }
    })();
    return () => { cancelled = true; };
  }, [activeTab, user?.id]);

  const handleReaction = async (postId: string, emoji: string) => {
    if (!user) { navigate('/auth'); return; }
    // esbuild guard: plain array cast — typed operations before state update
    const curPostIds = rxPostIds as any[];
    const curEmojis = rxEmojis as any[];
    const existIdx = curPostIds.indexOf(postId);
    const curEmoji = existIdx >= 0 ? curEmojis[existIdx] : null;
    if (curEmoji === emoji) {
      // Remove reaction
      await supabase.from('post_reactions').delete().eq('post_id', postId).eq('user_id', user.id);
      const newIds = curPostIds.filter((_: any, i: number) => i !== existIdx);
      const newEmojis = curEmojis.filter((_: any, i: number) => i !== existIdx);
      setRxPostIds(newIds as any);
      setRxEmojis(newEmojis as any);
      // Decrement count
      const cids = rxCountPostIds as any[];
      const cems = rxCountEmojis as any[];
      const cts = rxCounts as any[];
      const ci = cids.findIndex((pid: any, i: number) => pid === postId && cems[i] === emoji);
      if (ci >= 0) {
        const newCts = [...cts];
        newCts[ci] = Math.max(0, newCts[ci] - 1);
        setRxCounts(newCts as any);
      }
    } else {
      // Upsert reaction
      await supabase.from('post_reactions').upsert({ post_id: postId, user_id: user.id, emoji }, { onConflict: 'post_id,user_id' });
      const newIds = existIdx >= 0 ? curPostIds.map((id: any, i: number) => i === existIdx ? postId : id) : [...curPostIds, postId];
      const newEmojis = existIdx >= 0 ? curEmojis.map((e: any, i: number) => i === existIdx ? emoji : e) : [...curEmojis, emoji];
      setRxPostIds(newIds as any);
      setRxEmojis(newEmojis as any);
      // Update count
      const cids = rxCountPostIds as any[];
      const cems = rxCountEmojis as any[];
      const cts = rxCounts as any[];
      // Remove old emoji count if switching
      const oldEmojiIdx = cids.findIndex((pid: any, i: number) => pid === postId && cems[i] === curEmoji);
      const newCts = [...cts];
      if (oldEmojiIdx >= 0 && curEmoji) newCts[oldEmojiIdx] = Math.max(0, newCts[oldEmojiIdx] - 1);
      const newEmojiIdx = cids.findIndex((pid: any, i: number) => pid === postId && cems[i] === emoji);
      if (newEmojiIdx >= 0) { newCts[newEmojiIdx] += 1; setRxCounts(newCts as any); }
      else { setRxCountPostIds([...cids, postId] as any); setRxCountEmojis([...cems, emoji] as any); setRxCounts([...newCts, 1] as any); }
    }
  };

  // Helper: get top 2 emojis + total count for a post (pre-computed per-post)
  const getPostReactionSummary = (postId: string) => {
    const cids = rxCountPostIds as any[];
    const cems = rxCountEmojis as any[];
    const cts = rxCounts as any[];
    const emojiTotals: any[] = [];
    const emojiNames: any[] = [];
    for (let i = 0; i < cids.length; i++) {
      if (cids[i] !== postId) continue;
      const ei = emojiNames.indexOf(cems[i]);
      if (ei >= 0) emojiTotals[ei] += cts[i];
      else { emojiNames.push(cems[i]); emojiTotals.push(cts[i]); }
    }
    const total = emojiTotals.reduce((s: number, n: number) => s + n, 0);
    // Sort by count descending, take top 2
    const sorted = emojiNames.map((e: any, i: number) => ({ e, c: emojiTotals[i] })).sort((a: any, b: any) => b.c - a.c);
    const top2 = sorted.slice(0, 2).map((x: any) => x.e);
    return { top2, total };
  };

  const hasTrends = trendingTopics.length > 0;

  return (
    <div>
      {/* Header hero strip */}
      <div className="px-4 pt-4 pb-3 flex items-center gap-3 border-b border-border bg-gradient-to-r from-primary/5 to-background">
        <span className="text-3xl">{catEmoji}</span>
        <div>
          <h2 className="font-black text-xl">{activeTab}</h2>
          <p className="text-xs text-muted-foreground">Ranked posts · last 7 days</p>
        </div>
      </div>

      {/* Trending topics (if any) */}
      {hasTrends && (
        <div className="border-b border-border">
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest px-4 pt-3 pb-1">Trending Topics</p>
          <div className="divide-y divide-border">
            {trendingTopics.map((topic, i) => (
              <button key={topic.id} onClick={() => navigateTopic(topic.topic)}
                className="w-full text-left px-4 py-3 hover:bg-muted/30 transition-colors flex items-center gap-3">
                <span className={`text-sm font-black w-6 shrink-0 ${RANK_COLORS[Math.min(i, 3)]}`}>
                  {i < 3 ? RANK_MEDAL[i] : `#${i + 1}`}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-sm">{topic.topic}</p>
                  <p className="text-xs text-muted-foreground">{formatNumber(topic.posts_count)} posts</p>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Ranked post feed */}
      <div>
        <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest px-4 pt-3 pb-1">
          {posts.length > 0 ? `Top ${posts.length} Posts` : 'Posts'}
        </p>
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-7 h-7 animate-spin text-primary" />
          </div>
        ) : posts.length === 0 ? (
          <div className="py-16 text-center text-muted-foreground space-y-2">
            <span className="text-5xl">{catEmoji}</span>
            <p className="font-semibold">No {activeTab} posts yet</p>
            <p className="text-sm">Be the first to post about {activeTab.toLowerCase()}!</p>
            <button onClick={() => navigate('/')}
              className="mt-3 px-5 py-2.5 bg-primary text-primary-foreground rounded-full text-sm font-semibold hover:opacity-90">
              Write a post
            </button>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {posts.map((post: any, idx: number) => {
              // esbuild guard: no typed const declarations inside .map()
              const uname = post.user_profiles?.username ?? '';
              const isVid = !!(post.is_video || post.video_url);
              const thumb = post.image_url ?? '';
              // esbuild guard: pre-compute rank values without ternary chain
              const rankColorIdx = idx < 3 ? idx : 3;
              const rankColor = RANK_COLORS[rankColorIdx];
              const hasMedal = idx < 3;
              const medal = RANK_MEDAL[idx] ?? null;
              // esbuild guard: pre-compute reaction props before return
              const rxCurPostIds = rxPostIds as any[];
              const rxCurEmojis = rxEmojis as any[];
              const myRxIdx = rxCurPostIds.indexOf(post.id);
              const myEmoji = myRxIdx >= 0 ? rxCurEmojis[myRxIdx] : null;
              const rxSummary = getPostReactionSummary(post.id);
              return (
                <div key={post.id} className="border-b border-border last:border-b-0">
                <button onClick={() => navigate(`/post/${post.id}`)}
                  className="w-full flex items-start gap-3 px-4 py-3.5 hover:bg-muted/30 transition-colors text-left">
                  {/* Rank badge */}
                  <div className="w-8 shrink-0 flex flex-col items-center pt-1">
                    {hasMedal
                      ? <span className="text-xl">{medal}</span>
                      : <span className={`text-sm font-black ${rankColor}`}>#{idx + 1}</span>}
                  </div>
                  {/* Thumbnail */}
                  {(thumb || isVid) && (
                    <div className="w-16 h-16 rounded-xl overflow-hidden bg-muted shrink-0 relative">
                      {thumb
                        ? <img src={thumb} alt="" className="w-full h-full object-cover" loading="lazy" />
                        : isVid && post.video_url
                          ? <video src={`${post.video_url}#t=0.5`} className="w-full h-full object-cover" muted preload="metadata" />
                          : null}
                      {isVid && (
                        <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                          <Play className="w-5 h-5 text-white fill-white" />
                        </div>
                      )}
                    </div>
                  )}
                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1 mb-0.5">
                      <div className="w-5 h-5 rounded-full bg-muted overflow-hidden shrink-0">
                        {post.user_profiles?.avatar_url
                          ? <img src={post.user_profiles.avatar_url} alt="" className="w-full h-full object-cover" />
                          : <div className="w-full h-full flex items-center justify-center text-[8px] font-bold">{uname[0]?.toUpperCase()}</div>}
                      </div>
                      <span className="text-xs font-semibold text-muted-foreground truncate">@{uname}</span>
                      {post.user_profiles?.verified && <BadgeCheck className="w-3 h-3 text-primary shrink-0" fill="currentColor" />}
                    </div>
                    <p className="text-sm font-medium line-clamp-2 leading-snug">{post.content ?? ''}</p>
                    {/* Engagement stats */}
                    <div className="flex items-center gap-3 mt-1.5">
                      <span className="flex items-center gap-0.5 text-[11px] text-muted-foreground">
                        <Eye className="w-3 h-3" />{formatNumber(post.views_count ?? 0)}
                      </span>
                      <span className="flex items-center gap-0.5 text-[11px] text-muted-foreground">
                        <Star className="w-3 h-3" />{formatNumber(post.likes_count ?? 0)}
                      </span>
                      {post.reposts_count > 0 && (
                        <span className="flex items-center gap-0.5 text-[11px] text-muted-foreground">
                          <TrendingUp className="w-3 h-3" />{formatNumber(post.reposts_count)}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
                <PostReactionBar
                  postId={post.id}
                  myEmoji={myEmoji}
                  rxSummary={rxSummary}
                  onReact={handleReaction}
                />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export default function ExplorePage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState('Explore' as ExploreTab);
  // ── In-page Search Results (mixed: users + posts + hashtags) ────────────
  const [inlineSearchResults, setInlineSearchResults] = useState(null as {
    users: any[]; hashtags: any[]; posts: any[];
  } | null);
  const [inlineSearchLoading, setInlineSearchLoading] = useState(false);
  const inlineSearchTimer = useRef(null as ReturnType<typeof setTimeout> | null);
  const [trending, setTrending] = useState([] as any[]);
  const [trendingHashtags, setTrendingHashtags] = useState([] as any[]);
  const [whoToFollow, setWhoToFollow] = useState([] as any[]);
  // followingIds — parallel arrays (esbuild guard: no Set<string> in state)
  const [followingIdArr, setFollowingIdArr] = useState([] as string[]);
  const isFollowingId = (id: string) => followingIdArr.indexOf(id) >= 0;
  const [loading, setLoading] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [prefCategories, setPrefCategories] = useState(['News', 'Sports', 'Entertainment', 'Politics', 'Technology'] as string[]);
  // esbuild guard: remove unused init slot

  const [prefCountry, setPrefCountry] = useState('Kenya');
  const [showWhoToFollow, setShowWhoToFollow] = useState(true);
  const [activeChallenges, setActiveChallenges] = useState([] as any[]);
  const [exploreStories, setExploreStories] = useState([] as any[]);
  const [storiesLoading, setStoriesLoading] = useState(false);
  const [activeStoryIdx, setActiveStoryIdx] = useState(null as number | null);
  const [storyProgress, setStoryProgress] = useState(0);
  const storyTimerRef = useRef(null as ReturnType<typeof setInterval> | null);
  const [showCreateChallenge, setShowCreateChallenge] = useState(false);
  const [challengeForm, setChallengeForm] = useState({ title: '', description: '', prize: '', end_date: '', hashtag: '' });
  const [creatingChallenge, setCreatingChallenge] = useState(false);
  // Trending tab — category filter
  const [trendingTagFilter, setTrendingTagFilter] = useState('All');
  // ── Trending Posts Feed (top views in last 48h) ──
  const [trendingPosts, setTrendingPosts] = useState([] as any[]);
  const [trendingPostsLoading, setTrendingPostsLoading] = useState(false);
  // Fresh local fallback keeps Explore useful when live trend tables have no current rows.
  const [freshExplorePosts, setFreshExplorePosts] = useState([] as any[]);
  // ── Category post counts for tab badges ──
  // esbuild guard: plain number array, not Record<string,number>
  const [catPostCounts, setCatPostCounts] = useState([0, 0, 0]);
  // ── Search History (localStorage, max 8) ─────────────────────────────────
  const [searchHistory, setSearchHistory] = useState([] as string[]);
  const [showSearchHistory, setShowSearchHistory] = useState(false);
  // ── Live user autocomplete (debounced 250ms) — esbuild guard: plain arrays ──
  const [searchSuggestions, setSearchSuggestions] = useState([] as any[]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const suggestTimerRef = useRef(null as ReturnType<typeof setTimeout> | null);

  // Fetch user suggestions with debounce
  const fetchUserSuggestions = (q: string) => {
    if (suggestTimerRef.current) clearTimeout(suggestTimerRef.current);
    if (!q.trim() || q.trim().length < 2) { setSearchSuggestions([]); setShowSuggestions(false); return; }
    suggestTimerRef.current = setTimeout(async () => {
      const { data } = await supabase
        .from('profiles')
        .select('id, username, avatar_url, verified, follower_count')
        .ilike('username', `%${q.trim()}%`)
        .order('follower_count', { ascending: false })
        .limit(5);
      if (data && data.length > 0) { setSearchSuggestions(data); setShowSuggestions(true); }
      else { setSearchSuggestions([]); setShowSuggestions(false); }
    }, 250);
  };

  // ── Inline mixed search (users + hashtags + posts) ──────────────────────
  const doInlineSearch = (q: string) => {
    if (inlineSearchTimer.current) clearTimeout(inlineSearchTimer.current);
    if (!q.trim() || q.trim().length < 2) { setInlineSearchResults(null); return; }
    inlineSearchTimer.current = setTimeout(async () => {
      setInlineSearchLoading(true);
      const clean = q.trim();
      const [usersRes, hashtagsRes, postsRes] = await Promise.all([
        supabase.from('profiles').select('id, username, avatar_url, verified, follower_count, bio')
          .ilike('username', `%${clean}%`).order('follower_count', { ascending: false }).limit(5),
        supabase.from('hashtags').select('id, tag, usage_count')
          .ilike('tag', `${clean.replace(/^#/, '')}%`).order('usage_count', { ascending: false }).limit(5),
        supabase.from('posts').select('id, content, image_url, is_video, views_count, likes_count, user_profiles:profiles!posts_author_id_fkey(id, username, avatar_url, verified_tier)')
          .ilike('content', `%${clean}%`).is('community_id', null).order('likes_count', { ascending: false }).limit(5),
      ]);
      setInlineSearchResults({
        users: usersRes.data ?? [],
        hashtags: hashtagsRes.data ?? [],
        posts: postsRes.data ?? [],
      });
      setInlineSearchLoading(false);
    }, 350);
  };

  useEffect(() => {
    try { const raw = localStorage.getItem(SEARCH_HISTORY_KEY); if (raw) setSearchHistory(JSON.parse(raw)); } catch { /* ignore */ }
  }, []);

  const addToSearchHistory = (q: string) => {
    if (!q.trim()) return;
    setSearchHistory(prev => {
      const next = [q.trim(), ...prev.filter(h => h !== q.trim())].slice(0, 8);
      try { localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  };

  const clearSearchHistory = () => {
    setSearchHistory([]);
    try { localStorage.removeItem(SEARCH_HISTORY_KEY); } catch { /* ignore */ }
  };

  const removeHistoryItem = (i: number) => {
    setSearchHistory(prev => {
      const next = prev.filter((_, j) => j !== i);
      try { localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  };

  // SEO — dynamic title from top 3 trending hashtags
  const topHashtagNames = trendingHashtags.slice(0, 3).map((h: any) => `#${h.tag}`);
  useSEO({
    title: topHashtagNames.length > 0
      ? `Explore: ${topHashtagNames.join(', ')} — Testagram`
      : 'Explore — Trending Topics, Challenges & Creators',
    description: topHashtagNames.length > 0
      ? `Discover what's trending: ${topHashtagNames.join(', ')}. Explore viral videos, hashtag challenges, and creators on Testagram.`
      : 'Explore trending topics, hashtag challenges, viral videos, and top creators on Testagram.',
    url: '/explore',
    type: 'website',
    keywords: 'explore, trending, hashtag challenges, viral videos, creators, testagram, discover',
  });

  const ALL_CATEGORIES = ['News', 'Sports', 'Entertainment', 'Politics', 'Technology', 'Music', 'Science', 'Business'];
  const COUNTRIES = ['Kenya', 'Nigeria', 'USA', 'UK', 'India', 'South Africa', 'Tanzania', 'Uganda'];
  const tabs: ExploreTab[] = ['Explore', 'Trending', 'News', 'Sports', 'Entertainment', 'Marketplace'];

  useEffect(() => {
    fetchData();
    fetchActiveChallenges();
    fetchExploreStories();
    fetchTrendingPosts();
    fetchFreshExplorePosts();
    fetchCategoryPostCounts();
  }, [activeTab, user?.id]);

  const fetchCategoryPostCounts = async () => {
    // Fetch counts for News, Sports, Entertainment in parallel (esbuild guard: Promise.all with index)
    const since7d = new Date(Date.now() - 7 * 86400000).toISOString();
    const results = await Promise.all(
      CAT_KEYWORDS_MAP.map(async kws => {
        const orFilter = kws.map(k => `content.ilike.%${k}%`).join(',');
        const { count } = await supabase
          .from('posts')
          .select('id', { count: 'exact', head: true })
          .or(orFilter)
          .is('community_id', null)
          .gte('created_at', since7d);
        return count ?? 0;
      })
    );
    setCatPostCounts(results);
  };

  const fetchTrendingPosts = async () => {
    setTrendingPostsLoading(true);
    const since48h = new Date(Date.now() - 48 * 3600000).toISOString();
    const { data } = await supabase
      .from('posts')
      .select('id, content, image_url, video_url, media_urls, is_video, views_count, likes_count, user_profiles:profiles!posts_author_id_fkey(id, username, avatar_url, verified_tier)')
      .is('community_id', null)
      .gte('created_at', since48h)
      .order('views_count', { ascending: false })
      .limit(10);
    setTrendingPosts(data ?? []);
    setTrendingPostsLoading(false);
  };

  const fetchFreshExplorePosts = async () => {
    const { data } = await supabase
      .from('posts')
      .select('id, content, image_url, video_url, media_urls, is_video, views_count, likes_count, reposts_count, replies_count, created_at, user_profiles:profiles!posts_author_id_fkey(id, username, avatar_url, verified_tier)')
      .is('community_id', null)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(12);
    setFreshExplorePosts(data ?? []);
  };

  // Story progress timer
  useEffect(() => {
    if (activeStoryIdx === null) {
      if (storyTimerRef.current) clearInterval(storyTimerRef.current);
      setStoryProgress(0);
      return;
    }
    setStoryProgress(0);
    if (storyTimerRef.current) clearInterval(storyTimerRef.current);
    storyTimerRef.current = setInterval(() => {
      setStoryProgress(prev => {
        if (prev >= 100) {
          setActiveStoryIdx(idx => {
            if (idx === null) return null;
            return idx + 1 < exploreStories.length ? idx + 1 : null;
          });
          return 0;
        }
        return prev + 2;
      });
    }, 60);
    return () => { if (storyTimerRef.current) clearInterval(storyTimerRef.current); };
  }, [activeStoryIdx, exploreStories.length]);

  const fetchExploreStories = async () => {
    setStoriesLoading(true);
    try {
      const { data: stories } = await supabase
        .from('stories')
        .select('id, media_url, media_type, caption, views_count, user_id, expires_at, created_at')
        .gt('expires_at', new Date().toISOString())
        .order('views_count', { ascending: false })
        .limit(30);
      if (!stories) { setStoriesLoading(false); return; }
      let filtered = stories;
      if (user) filtered = stories.filter((s: any) => s.user_id !== user.id);
      setExploreStories(filtered);
    } catch (err) {
      console.warn('[explore-stories]', err);
    } finally {
      setStoriesLoading(false);
    }
  };

  const openStory = async (idx: number) => {
    setActiveStoryIdx(idx);
    const story = exploreStories[idx];
    if (story && user) {
      await supabase.from('story_views').upsert(
        { story_id: story.id, viewer_id: user.id },
        { onConflict: 'story_id,viewer_id' }
      ).catch(() => {});
      await supabase.from('stories').update({ views_count: (story.views_count || 0) + 1 }).eq('id', story.id).catch(() => {});
    }
  };

  const fetchData = async () => {
    setLoading(true);
    const [trendingData, hashtagRes, whoRes] = await Promise.allSettled([
      backendCapabilities.getTrends(50),
      supabase.from('hashtags').select('id, tag, usage_count, post_count, federated_post_count, last_used_at').order('federated_post_count', { ascending: false }).order('usage_count', { ascending: false }).order('last_used_at', { ascending: false }).limit(20),
      supabase.from('profiles').select('*').order('follower_count', { ascending: false }).limit(10),
    ]);
    setTrending(trendingData.status === 'fulfilled' ? (trendingData.value?.items ?? []) : []);
    if (hashtagRes.status === 'fulfilled' && hashtagRes.value.data) {
      setTrendingHashtags((hashtagRes.value.data as any[]).map((h: any) => ({ ...h, daily_posts: Number(h.federated_post_count ?? 0) + Number(h.post_count ?? h.usage_count ?? 0) })));
    }
    if (whoRes.status === 'fulfilled' && whoRes.value.data) {
      let suggestions = whoRes.value.data;
      if (user) suggestions = suggestions.filter((u: any) => u.id !== user.id);
      setWhoToFollow(suggestions.slice(0, 5));
    }
    if (user) {
      const { data: follows } = await supabase.from('follows').select('following_id').eq('follower_id', user.id);
      if (follows) setFollowingIdArr(follows.map((f: any) => f.following_id));
    }
    setLoading(false);
  };

  const handleFollow = async (profileId: string, username: string) => {
    if (!user) { navigate('/auth'); return; }
    const isFollowing = isFollowingId(profileId);
    if (isFollowing) {
      await supabase.from('follows').delete().eq('follower_id', user.id).eq('following_id', profileId);
      setFollowingIdArr(prev => prev.filter(id => id !== profileId));
    } else {
      await supabase.from('follows').insert({ follower_id: user.id, following_id: profileId });
      setFollowingIdArr(prev => [...prev, profileId]);
      await supabase.from('notifications').insert({ recipient_id: profileId, kind: 'follow', actor_id: user.id  }).catch(() => {});
      toast.success(`Following @${username}!`);
    }
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      addToSearchHistory(searchQuery.trim());
      setShowSearchHistory(false);
      setShowSuggestions(false);
      setSearchSuggestions([]);
      navigate(`/search?q=${encodeURIComponent(searchQuery.trim())}`);
    }
  };

  const handleHistorySelect = (q: string) => {
    setSearchQuery(q);
    setShowSearchHistory(false);
    setShowSuggestions(false);
    addToSearchHistory(q);
    navigate(`/search?q=${encodeURIComponent(q)}`);
  };

  const fetchActiveChallenges = async () => {
    const { data } = await supabase
      .from('hashtag_challenges')
      .select('*, hashtags(tag)')
      .eq('is_active', true)
      .gte('end_date', new Date().toISOString())
      .order('entry_count', { ascending: false })
      .limit(5);
    setActiveChallenges(data ?? []);
  };

  const handleCreateChallenge = async () => {
    if (!user) { navigate('/auth'); return; }
    if (!challengeForm.title || !challengeForm.end_date || !challengeForm.hashtag) {
      toast.error('Please fill in title, hashtag, and end date');
      return;
    }
    setCreatingChallenge(true);
    try {
      const cleanTag = challengeForm.hashtag.replace(/^#/, '');
      let hashtagId: string | null = null;
      const { data: existingTag } = await supabase.from('hashtags').select('id').eq('tag', cleanTag).maybeSingle();
      if (existingTag) { hashtagId = existingTag.id; }
      else {
        const { data: newTag } = await supabase.from('hashtags').insert({ tag: cleanTag, usage_count: 0 }).select('id').single();
        hashtagId = newTag?.id ?? null;
      }
      if (!hashtagId) throw new Error('Could not create hashtag');
      await supabase.from('hashtag_challenges').insert({
        title: challengeForm.title,
        description: challengeForm.description || null,
        prize: challengeForm.prize || null,
        end_date: new Date(challengeForm.end_date).toISOString(),
        hashtag_id: hashtagId,
        created_by: user.id,
        entry_count: 0,
        is_active: true,
      });
      toast.success('Challenge created!');
      setShowCreateChallenge(false);
      setChallengeForm({ title: '', description: '', prize: '', end_date: '', hashtag: '' });
      fetchActiveChallenges();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setCreatingChallenge(false);
    }
  };

  const navigateTopic = (topic: string) =>
    topic.startsWith('#') ? navigate(`/hashtag/${topic.slice(1)}`) : navigate(`/trending/${encodeURIComponent(topic)}`);

  const getFilteredTrending = () => {
    if (activeTab === 'Explore' || activeTab === 'Trending') return trending;
    return trending.filter(t => t.category?.toLowerCase() === activeTab.toLowerCase());
  };

  // Pre-compute trending tag filter results (esbuild guard: no IIFE in render)
  const trendingKws = TRENDING_FILTER_KEYWORDS[trendingTagFilter] ?? [];
  const filteredTrendingHashtags = trendingTagFilter === 'All'
    ? trendingHashtags.slice(0, 20)
    : trendingHashtags.filter((h: any) => trendingKws.some((k: string) => (h.tag ?? '').toLowerCase().includes(k))).slice(0, 20);
  const filteredTrendingCount = trendingTagFilter === 'All' ? 0 : filteredTrendingHashtags.length;

  const newsItems = trending
    .filter(t => ['news', 'entertainment', 'sports', 'politics'].includes((t.category ?? '').toLowerCase()))
    .slice(0, 5);

  // Pre-compute active story viewer data — esbuild guard: no IIFE in render
  const activeStory = activeStoryIdx !== null ? (exploreStories[activeStoryIdx] ?? null) : null;
  const activeStoryProfile = activeStory?.user_profiles ?? null;

  return (
    <div className="min-h-screen bg-background pb-20 md:pb-0">
      <TopBar title="Explore" showProfile={false} />

      {showSettings && (
        <div className="fixed inset-0 z-[110] bg-black/50" onClick={() => setShowSettings(false)}>
          <div className="absolute bottom-0 left-0 right-0 bg-background rounded-t-3xl p-5 space-y-5 max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="font-bold text-lg">Explore Settings</h2>
              <button onClick={() => setShowSettings(false)} className="p-2 rounded-full hover:bg-muted transition-colors"><X className="w-5 h-5" /></button>
            </div>
            <div>
              <p className="text-sm font-semibold mb-2">Trending Region</p>
              <div className="flex flex-wrap gap-2">
                {COUNTRIES.map(c => (
                  <button key={c} onClick={() => setPrefCountry(c)} className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${prefCountry === c ? 'bg-primary text-primary-foreground border-primary' : 'border-border hover:bg-muted'}`}>{c}</button>
                ))}
              </div>
            </div>
            <div>
              <p className="text-sm font-semibold mb-2">Show Categories</p>
              <div className="flex flex-wrap gap-2">
                {ALL_CATEGORIES.map(cat => {
                  const active = prefCategories.includes(cat);
                  return (
                    <button key={cat} onClick={() => setPrefCategories(prev => active ? prev.filter(c => c !== cat) : [...prev, cat])}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${active ? 'bg-primary/10 text-primary border-primary/30' : 'border-border text-muted-foreground hover:bg-muted'}`}>
                      {active && <Check className="w-3 h-3" />}{cat}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="flex items-center justify-between py-3 border-t border-border">
              <div>
                <p className="text-sm font-semibold">Show Who to Follow</p>
                <p className="text-xs text-muted-foreground">Display user suggestions in feed</p>
              </div>
              <button onClick={() => setShowWhoToFollow(v => !v)} className={`w-12 h-6 rounded-full transition-colors relative ${showWhoToFollow ? 'bg-primary' : 'bg-muted-foreground/30'}`}>
                <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${showWhoToFollow ? 'translate-x-7' : 'translate-x-1'}`} />
              </button>
            </div>
            <button onClick={() => { setShowSettings(false); fetchData(); }} className="w-full py-3 bg-primary text-primary-foreground rounded-xl font-semibold">Save & Refresh</button>
          </div>
        </div>
      )}

      <div className="sticky top-14 z-30 bg-background border-b border-border">
        <div className="flex items-center gap-2 px-3 pt-3 pb-2">
          <form onSubmit={handleSearch} className="flex-1">
            <div className="relative">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                type="text"
                placeholder="Search Tsocial"
                value={searchQuery}
                onChange={e => { setSearchQuery(e.target.value); fetchUserSuggestions(e.target.value); doInlineSearch(e.target.value); if (!e.target.value.trim()) setInlineSearchResults(null); }}
                onFocus={() => { setShowSearchHistory(true); if (searchQuery.trim().length >= 2) setShowSuggestions(true); }}
                onBlur={() => setTimeout(() => { setShowSearchHistory(false); setShowSuggestions(false); }, 200)}
                className="pl-10 h-10 rounded-full bg-muted/80 border-0 focus-visible:ring-1 focus-visible:ring-primary text-sm"
              />
              {/* Live user autocomplete — shown while typing 2+ chars */}
              {showSuggestions && searchSuggestions.length > 0 && (
                <div className="absolute top-full left-0 right-0 mt-1.5 bg-background border border-border rounded-2xl shadow-xl z-50 overflow-hidden">
                  <div className="px-4 py-2 border-b border-border flex items-center justify-between">
                    <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide">People</span>
                    <button type="button" onClick={() => { setShowSuggestions(false); setSearchSuggestions([]); }} className="text-[10px] text-muted-foreground hover:text-foreground">✕</button>
                  </div>
                  {searchSuggestions.map((u: any) => (
                    <button
                      key={u.id}
                      type="button"
                      onMouseDown={() => { navigate(`/profile/${u.username}`); setShowSuggestions(false); }}
                      className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-muted transition-colors text-left"
                    >
                      <div className="w-8 h-8 rounded-full bg-muted overflow-hidden shrink-0 flex items-center justify-center font-bold text-xs">
                        {u.avatar_url ? <img src={u.avatar_url} alt={u.username} className="w-full h-full object-cover" /> : u.username[0]?.toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1">
                          <span className="text-sm font-semibold truncate">@{u.username}</span>
                          {u.verified && <BadgeCheck className="w-3 h-3 text-primary shrink-0" fill="currentColor" />}
                        </div>
                        <p className="text-[10px] text-muted-foreground">{(u.follower_count ?? 0).toLocaleString()} followers</p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
              {/* Search history dropdown — shown on focus when no active suggestions */}
              {showSearchHistory && !showSuggestions && searchHistory.length > 0 && (
                <div className="absolute top-full left-0 right-0 mt-1.5 bg-background border border-border rounded-2xl shadow-xl z-50 overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-2 border-b border-border">
                    <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide">Recent Searches</span>
                    <button
                      type="button"
                      onClick={() => clearSearchHistory()}
                      className="text-[10px] text-primary font-semibold hover:underline"
                    >Clear all</button>
                  </div>
                  {searchHistory.map((q, i) => (
                    <div key={i} className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted transition-colors">
                      <Clock className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                      <button
                        type="button"
                        className="flex-1 text-sm text-foreground text-left truncate"
                        onMouseDown={() => handleHistorySelect(q)}
                      >{q}</button>
                      <button
                        type="button"
                        onMouseDown={() => removeHistoryItem(i)}
                        className="text-muted-foreground/50 hover:text-muted-foreground p-1 shrink-0"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </form>
          <button onClick={() => setShowSettings(true)} className="shrink-0 w-10 h-10 rounded-full bg-muted/80 flex items-center justify-center hover:bg-muted transition-colors">
            <Settings className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>
        <div className="flex overflow-x-auto scrollbar-hide">
          {tabs.map((tab) => {
            const catBadgeIdx = CAT_NAMES.indexOf(tab);
            const catBadgeCount = catBadgeIdx >= 0 ? catPostCounts[catBadgeIdx] : 0;
            return (
              <button key={tab} onClick={() => setActiveTab(tab)}
                className={`flex-shrink-0 px-5 py-3 font-semibold transition-colors border-b-2 whitespace-nowrap text-sm relative ${activeTab === tab ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:bg-muted/50'}`}>
                {tab}
                {catBadgeCount > 0 && (
                  <span className={`ml-1 text-[10px] font-black px-1 py-0.5 rounded-full ${
                    activeTab === tab ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
                  }`}>
                    {catBadgeCount > 999 ? `${Math.round(catBadgeCount / 1000)}k` : catBadgeCount}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Discovery destinations: each surface has a distinct job and remains one tap away. */}
      <div className="border-b border-border bg-background">
        <div className="px-3 py-2 flex gap-2 overflow-x-auto scrollbar-hide">
          {[
            { label: 'Search', icon: Search, path: '/search' },
            { label: 'Hashtags', icon: Hash, path: '/hashtags' },
            { label: 'Creators', icon: UsersIcon, path: '/discover' },
            { label: 'Threads', icon: BookOpen, path: '/threads' },
            { label: 'Marketplace', icon: ShoppingBag, path: '/marketplace' },
          ].map(({ label, icon: Icon, path }) => (
            <button key={path} onClick={() => navigate(path)}
              className="shrink-0 inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-semibold hover:border-primary/40 hover:bg-primary/5 transition-colors">
              <Icon className="w-3.5 h-3.5 text-primary" />{label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Inline Mixed Search Results ──────────────────────────── */}
      {(inlineSearchLoading || inlineSearchResults) && searchQuery.trim().length >= 2 && (
        <div className="border-b border-border bg-background">
          {inlineSearchLoading && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          )}
          {inlineSearchResults && !inlineSearchLoading && (
            <div className="max-w-2xl mx-auto">
              {/* Creators */}
              {inlineSearchResults.users.length > 0 && (
                <div>
                  <div className="flex items-center justify-between px-4 pt-3 pb-1">
                    <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide">People</p>
                    <button onClick={() => navigate(`/search?q=${encodeURIComponent(searchQuery)}&type=users`)}
                      className="text-[10px] text-primary font-bold hover:underline">See all</button>
                  </div>
                  {inlineSearchResults.users.map((u: any) => (
                    <button key={u.id} onClick={() => { addToSearchHistory(searchQuery); navigate(`/profile/${u.username}`); }}
                      className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-muted/40 transition-colors text-left">
                      <div className="w-10 h-10 rounded-full bg-muted overflow-hidden shrink-0">
                        {u.avatar_url ? <img src={u.avatar_url} alt={u.username} className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center font-bold text-sm">{u.username[0]?.toUpperCase()}</div>}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1">
                          <span className="font-bold text-sm truncate">@{u.username}</span>
                          {u.verified && <BadgeCheck className="w-3.5 h-3.5 text-primary shrink-0" fill="currentColor" />}
                        </div>
                        {u.bio && <p className="text-xs text-muted-foreground truncate">{u.bio.slice(0, 50)}</p>}
                        <p className="text-[10px] text-muted-foreground">{(u.follower_count ?? 0).toLocaleString()} followers</p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
              {/* Hashtags */}
              {inlineSearchResults.hashtags.length > 0 && (
                <div>
                  <div className="flex items-center justify-between px-4 pt-3 pb-1">
                    <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide">Hashtags</p>
                    <button onClick={() => navigate(`/hashtags?q=${encodeURIComponent(searchQuery)}`)}
                      className="text-[10px] text-primary font-bold hover:underline">See all</button>
                  </div>
                  <div className="flex flex-wrap gap-2 px-4 pb-3">
                    {inlineSearchResults.hashtags.map((h: any) => (
                      <button key={h.id} onClick={() => { addToSearchHistory(searchQuery); navigate(`/hashtag/${h.tag}`); }}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-primary/8 border border-primary/20 rounded-full hover:bg-primary/15 transition-colors">
                        <Hash className="w-3 h-3 text-primary" />
                        <span className="text-sm font-bold text-primary">#{h.tag}</span>
                        <span className="text-[10px] text-muted-foreground">{formatNumber(h.usage_count ?? 0)}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {/* Posts */}
              {inlineSearchResults.posts.length > 0 && (
                <div>
                  <div className="flex items-center justify-between px-4 pt-1 pb-1">
                    <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide">Posts</p>
                    <button onClick={() => { addToSearchHistory(searchQuery); navigate(`/search?q=${encodeURIComponent(searchQuery)}`); }}
                      className="text-[10px] text-primary font-bold hover:underline">See all</button>
                  </div>
                  {inlineSearchResults.posts.map((post: any) => (
                    <button key={post.id} onClick={() => { addToSearchHistory(searchQuery); navigate(`/post/${post.id}`); }}
                      className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-muted/40 transition-colors text-left">
                      {post.image_url && (
                        <div className="w-12 h-12 rounded-xl overflow-hidden bg-muted shrink-0">
                          <img src={post.image_url} alt="" className="w-full h-full object-cover" loading="lazy" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1 mb-0.5">
                          <span className="text-[10px] font-bold text-muted-foreground">@{post.user_profiles?.username}</span>
                          {post.user_profiles?.verified && <BadgeCheck className="w-3 h-3 text-primary" fill="currentColor" />}
                          {post.is_video && <Play className="w-3 h-3 text-primary" />}
                        </div>
                        <p className="text-sm line-clamp-2 leading-snug">{post.content?.slice(0, 100)}</p>
                        <div className="flex items-center gap-2 mt-0.5 text-[10px] text-muted-foreground">
                          <span>{formatNumber(post.likes_count ?? 0)} likes</span>
                          <span>{formatNumber(post.views_count ?? 0)} views</span>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
              {/* No results */}
              {inlineSearchResults.users.length === 0 && inlineSearchResults.hashtags.length === 0 && inlineSearchResults.posts.length === 0 && (
                <div className="flex flex-col items-center justify-center py-10 text-muted-foreground gap-2">
                  <Search className="w-8 h-8 opacity-20" />
                  <p className="text-sm font-medium">No results for "{searchQuery}"</p>
                  <button onClick={() => navigate(`/search?q=${encodeURIComponent(searchQuery)}`)}
                    className="text-xs text-primary font-semibold hover:underline">Full search →</button>
                </div>
              )}
              {/* Full search CTA */}
              {(inlineSearchResults.users.length > 0 || inlineSearchResults.hashtags.length > 0 || inlineSearchResults.posts.length > 0) && (
                <div className="px-4 py-3 border-t border-border">
                  <button onClick={() => { addToSearchHistory(searchQuery); navigate(`/search?q=${encodeURIComponent(searchQuery)}`); }}
                    className="w-full py-2.5 bg-primary/8 hover:bg-primary/15 text-primary text-sm font-bold rounded-xl transition-colors flex items-center justify-center gap-2">
                    <Search className="w-4 h-4" />Full search for "{searchQuery}"
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {activeTab === 'Explore' && !inlineSearchResults && (
        <div>
          {(storiesLoading || exploreStories.length > 0) && (
            <section className="border-b border-border">
              <div className="px-4 pt-4 pb-2 flex items-center justify-between">
                <h2 className="font-bold text-xl flex items-center gap-2"><BookOpen className="w-5 h-5 text-pink-500" />Stories For You</h2>
                <button
                  onClick={() => navigate('/home?tab=stories')}
                  className="text-xs text-primary font-bold hover:underline"
                >
                  View all →
                </button>
              </div>
              {storiesLoading ? (
                <div className="grid grid-cols-3 gap-1.5 px-4 pb-4">
                  {[0,1,2,3,4,5].map(i => <div key={i} className="rounded-2xl bg-muted animate-pulse" style={{ aspectRatio: '9/16' }} />)}
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-1.5 px-4 pb-4">
                  {exploreStories.slice(0, 12).map((story: any, idx: number) => (
                    <button key={story.id} onClick={() => openStory(idx)}
                      className="relative rounded-2xl overflow-hidden bg-zinc-900 hover:scale-[1.03] active:scale-[0.97] transition-transform focus:outline-none" style={{ aspectRatio: '9/16' }}>
                      {story.media_type === 'video'
                        ? <video src={`${story.media_url}#t=0.5`} className="absolute inset-0 w-full h-full object-cover" muted preload="metadata" playsInline />
                        : <img src={story.media_url} alt="" className="absolute inset-0 w-full h-full object-cover" loading="lazy" />}
                      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/20" />
                      {story.media_type === 'video' && <div className="absolute top-2 right-2"><Play className="w-3.5 h-3.5 text-white fill-white drop-shadow" /></div>}
                      {story.views_count > 0 && (
                        <div className="absolute top-2 left-2 flex items-center gap-0.5 bg-black/40 backdrop-blur-sm rounded-full px-1.5 py-0.5">
                          <Eye className="w-2.5 h-2.5 text-white/80" /><span className="text-[9px] text-white/80 font-semibold">{formatNumber(story.views_count)}</span>
                        </div>
                      )}
                      <div className="absolute bottom-0 left-0 right-0 p-2">
                        <div className="flex items-center gap-1.5">
                          <div className="w-5 h-5 rounded-full border-2 border-primary overflow-hidden shrink-0 bg-muted">
                            {story.user_profiles?.avatar_url
                              ? <img src={story.user_profiles.avatar_url} alt="" className="w-full h-full object-cover" />
                              : <div className="w-full h-full flex items-center justify-center bg-primary"><span className="text-[6px] font-black text-primary-foreground">{story.user_profiles?.username?.[0]?.toUpperCase()}</span></div>}
                          </div>
                          <p className="text-white text-[9px] font-semibold truncate">@{story.user_profiles?.username}</p>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </section>
          )}

          {/* Trending Posts Feed — top 10 by views in last 48h */}
          {(trendingPostsLoading || trendingPosts.length > 0) && (
            <section className="border-b border-border">
              <div className="px-4 pt-4 pb-2 flex items-center justify-between">
                <h2 className="font-bold text-xl flex items-center gap-2"><Flame className="w-5 h-5 text-orange-500" />Trending Posts</h2>
                <span className="text-xs text-muted-foreground">Last 48h</span>
              </div>
              {trendingPostsLoading ? (
                <div className="flex gap-3 px-4 pb-4 overflow-x-auto scrollbar-hide">
                  {[0,1,2].map(i => <div key={i} className="shrink-0 w-48 h-64 rounded-2xl bg-muted animate-pulse" />)}
                </div>
              ) : (
                <div className="flex gap-3 px-4 pb-4 overflow-x-auto scrollbar-hide">
                  {trendingPosts.map((post: any, idx: number) => {
                    const thumb = post.image_url || (post.media_urls?.[0]) || null;
                    const uname = post.user_profiles?.username ?? '';
                    const isVid = post.is_video || !!post.video_url;
                    return (
                      <button
                        key={post.id}
                        onClick={() => navigate(`/post/${post.id}`)}
                        className="shrink-0 w-48 rounded-2xl overflow-hidden bg-zinc-900 relative hover:scale-[1.03] active:scale-[0.97] transition-transform focus:outline-none"
                        style={{ height: 200 }}
                      >
                        {thumb
                          ? <img src={thumb} alt="" className="absolute inset-0 w-full h-full object-cover" loading="lazy" />
                          : isVid && post.video_url
                            ? <video src={`${post.video_url}#t=0.5`} className="absolute inset-0 w-full h-full object-cover" muted preload="metadata" />
                            : <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-primary/20 to-purple-500/20" />}
                        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-transparent to-black/20" />
                        {/* Rank badge */}
                        <div className="absolute top-2 left-2 w-6 h-6 rounded-full bg-black/60 backdrop-blur-sm flex items-center justify-center">
                          <span className={`text-[10px] font-black ${idx === 0 ? 'text-yellow-400' : idx === 1 ? 'text-slate-300' : idx === 2 ? 'text-amber-600' : 'text-white/70'}`}>#{idx+1}</span>
                        </div>
                        {isVid && (
                          <div className="absolute top-2 right-2 w-6 h-6 rounded-full bg-black/50 flex items-center justify-center">
                            <Play className="w-3 h-3 text-white fill-white" />
                          </div>
                        )}
                        <div className="absolute bottom-0 left-0 right-0 p-2.5">
                          <div className="flex items-center gap-1.5 mb-1">
                            <div className="w-5 h-5 rounded-full bg-muted overflow-hidden shrink-0">
                              {post.user_profiles?.avatar_url
                                ? <img src={post.user_profiles.avatar_url} alt="" className="w-full h-full object-cover" />
                                : <div className="w-full h-full bg-primary/20 flex items-center justify-center text-[8px] font-bold text-primary">{uname[0]?.toUpperCase()}</div>}
                            </div>
                            <span className="text-white text-[10px] font-semibold truncate">@{uname}</span>
                            {post.user_profiles?.verified && <BadgeCheck className="w-3 h-3 text-primary shrink-0" fill="currentColor" />}
                          </div>
                          <p className="text-white text-[11px] font-medium line-clamp-2 leading-tight mb-1.5">{(post.content ?? '').slice(0, 60)}</p>
                          <div className="flex items-center gap-2">
                            <span className="flex items-center gap-0.5 text-white/70 text-[10px]"><Eye className="w-2.5 h-2.5" />{formatNumber(post.views_count ?? 0)}</span>
                            <span className="flex items-center gap-0.5 text-white/70 text-[10px]"><Star className="w-2.5 h-2.5" />{formatNumber(post.likes_count ?? 0)}</span>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </section>
          )}

          {trendingPosts.length === 0 && !trendingPostsLoading && freshExplorePosts.length > 0 && (
            <section className="border-b border-border">
              <div className="px-4 pt-4 pb-2 flex items-center justify-between">
                <div>
                  <h2 className="font-bold text-xl flex items-center gap-2"><Globe className="w-5 h-5 text-primary" />Fresh on Testagram</h2>
                  <p className="text-xs text-muted-foreground mt-0.5">Recent public posts while trends build up</p>
                </div>
                <button onClick={() => navigate('/')} className="text-xs text-primary font-bold hover:underline">Home →</button>
              </div>
              <div className="divide-y divide-border">
                {freshExplorePosts.slice(0, 8).map((post: any) => (
                  <button key={post.id} onClick={() => navigate(`/post/${post.id}`)}
                    className="w-full text-left px-4 py-3.5 hover:bg-muted/30 transition-colors flex gap-3">
                    <div className="w-9 h-9 rounded-full bg-muted overflow-hidden shrink-0">
                      {post.user_profiles?.avatar_url
                        ? <img src={post.user_profiles.avatar_url} alt="" className="w-full h-full object-cover" loading="lazy" />
                        : <div className="w-full h-full flex items-center justify-center text-xs font-bold">{post.user_profiles?.username?.[0]?.toUpperCase() ?? '?'}</div>}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1 mb-0.5">
                        <span className="text-xs font-bold truncate">@{post.user_profiles?.username ?? 'user'}</span>
                        {post.user_profiles?.verified && <BadgeCheck className="w-3 h-3 text-primary shrink-0" fill="currentColor" />}
                        <span className="text-[10px] text-muted-foreground ml-auto shrink-0">{formatDistanceToNow(new Date(post.created_at), { addSuffix: true })}</span>
                      </div>
                      <p className="text-sm line-clamp-2 leading-snug">{post.content ?? ''}</p>
                      <div className="flex items-center gap-3 mt-1.5 text-[10px] text-muted-foreground">
                        <span>{formatNumber(post.likes_count ?? 0)} likes</span>
                        <span>{formatNumber(post.views_count ?? 0)} views</span>
                        <span>{formatNumber(post.replies_count ?? 0)} replies</span>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </section>
          )}

          {/* Story viewer — pre-computed vars, no IIFE (esbuild guard) */}
          {activeStoryIdx !== null && activeStory && (
            <div className="fixed inset-0 z-[500] bg-black flex items-center justify-center" onClick={() => setActiveStoryIdx(null)}>
              <div className="relative w-full max-w-sm h-full" onClick={e => e.stopPropagation()}>
                {activeStory.media_type === 'video'
                  ? <video key={activeStory.id} src={activeStory.media_url} autoPlay muted={false} playsInline className="absolute inset-0 w-full h-full object-cover" />
                  : <img key={activeStory.id} src={activeStory.media_url} alt="" className="absolute inset-0 w-full h-full object-cover" />}
                <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-transparent to-black/50 pointer-events-none" />
                <div className="absolute top-3 left-3 right-3 flex gap-1 z-10 pointer-events-none">
                  {exploreStories.slice(0, Math.min(exploreStories.length, 8)).map((_: any, pIdx: number) => (
                    <div key={pIdx} className="flex-1 h-0.5 bg-white/30 rounded-full overflow-hidden">
                      <div className="h-full bg-white rounded-full" style={{ width: pIdx < activeStoryIdx ? '100%' : pIdx === activeStoryIdx ? `${storyProgress}%` : '0%' }} />
                    </div>
                  ))}
                </div>
                <div className="absolute top-8 left-3 right-3 flex items-center justify-between z-10">
                  <div className="flex items-center gap-2">
                    <div className="w-9 h-9 rounded-full border-2 border-white overflow-hidden bg-muted">
                      {activeStoryProfile?.avatar_url ? <img src={activeStoryProfile.avatar_url} alt="" className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center bg-primary"><span className="text-xs font-black text-primary-foreground">{activeStoryProfile?.username?.[0]?.toUpperCase()}</span></div>}
                    </div>
                    <div>
                      <p className="text-white text-sm font-bold">@{activeStoryProfile?.username}</p>
                      <p className="text-white/60 text-[10px]">{activeStory.views_count} views</p>
                    </div>
                  </div>
                  <button onClick={() => setActiveStoryIdx(null)} className="w-9 h-9 flex items-center justify-center bg-black/40 backdrop-blur-sm rounded-full"><X className="w-4 h-4 text-white" /></button>
                </div>
                {activeStory.caption && <div className="absolute bottom-16 left-4 right-4 z-10"><p className="text-white text-sm leading-relaxed drop-shadow-lg">{activeStory.caption}</p></div>}
                <button className="absolute left-0 top-0 bottom-0 w-1/3 z-20" onClick={() => setActiveStoryIdx(i => (i !== null && i > 0) ? i - 1 : null)} />
                <button className="absolute right-0 top-0 bottom-0 w-1/3 z-20" onClick={() => setActiveStoryIdx(i => { if (i === null) return null; return i + 1 < exploreStories.length ? i + 1 : null; })} />
                <div className="absolute inset-0 flex items-center justify-between px-2 z-20 pointer-events-none">
                  {activeStoryIdx > 0 && <button className="pointer-events-auto w-9 h-9 flex items-center justify-center bg-black/40 backdrop-blur-sm rounded-full" onClick={() => setActiveStoryIdx(i => (i !== null && i > 0) ? i - 1 : null)}><ChevronLeft className="w-4 h-4 text-white" /></button>}
                  <div className="flex-1" />
                  {activeStoryIdx < exploreStories.length - 1 && <button className="pointer-events-auto w-9 h-9 flex items-center justify-center bg-black/40 backdrop-blur-sm rounded-full" onClick={() => setActiveStoryIdx(i => (i !== null && i + 1 < exploreStories.length) ? i + 1 : null)}><ChevronRightIcon className="w-4 h-4 text-white" /></button>}
                </div>
                {/* Quick emoji reactions */}
                <div className="absolute bottom-16 left-0 right-0 flex justify-center gap-2 z-10 px-4">
                  {['❤️', '🔥', '😮', '👏', '😍'].map(emoji => (
                    <button
                      key={emoji}
                      onClick={async () => {
                        if (!user || !activeStory || activeStory.user_id === user.id) return;
                        const { data: existing } = await supabase.from('conversations').select('id')
                          .or(`and(participant_1.eq.${user.id},participant_2.eq.${activeStory.user_id}),and(participant_1.eq.${activeStory.user_id},participant_2.eq.${user.id})`)
                          .maybeSingle();
                        let convId = existing?.id;
                        if (!convId) {
                          const { data: nc } = await supabase.from('conversations')
                            .insert({ participant_1: user.id, participant_2: activeStory.user_id }).select('id').single();
                          convId = nc?.id;
                        }
                        if (convId) {
                          await supabase.from('direct_messages').insert({ conversation_id: convId, sender_id: user.id, content: `${emoji} Reacted to your story` });
                          toast.success(`${emoji} Sent!`, { duration: 1500 });
                        }
                      }}
                      className="w-11 h-11 text-2xl rounded-full bg-black/40 backdrop-blur-sm border border-white/20 flex items-center justify-center hover:bg-black/60 active:scale-125 transition-all duration-150"
                    >{emoji}</button>
                  ))}
                </div>
                <div className="absolute bottom-4 left-0 right-0 flex justify-center z-10">
                  <button onClick={() => { setActiveStoryIdx(null); navigate(`/profile/${activeStoryProfile?.username}`); }} className="px-5 py-2 bg-white/20 backdrop-blur-sm border border-white/30 text-white text-sm font-semibold rounded-full hover:bg-white/30 transition-colors">View @{activeStoryProfile?.username}'s profile</button>
                </div>
              </div>
            </div>
          )}

          <ExploreAdBanner />
          <section className="border-b border-border"><TrendingVideosSection variant="full" /></section>

          {(activeChallenges.length > 0 || user?.verified) && (
            <section className="border-b border-border">
              <div className="px-4 pt-4 pb-2 flex items-center justify-between">
                <h2 className="font-bold text-xl flex items-center gap-2"><Trophy className="w-5 h-5 text-yellow-500" />Challenges</h2>
                {user?.verified && <button onClick={() => setShowCreateChallenge(true)} className="flex items-center gap-1 text-xs font-semibold text-primary hover:underline">+ Create</button>}
              </div>
              {activeChallenges.length === 0 ? (
                <div className="px-4 pb-4"><p className="text-sm text-muted-foreground">No active challenges. {user?.verified ? 'Create one!' : 'Only verified users can create challenges.'}</p></div>
              ) : (
                <div className="divide-y divide-border">
                  {activeChallenges.map(challenge => (
                    <button key={challenge.id} onClick={() => navigate(`/challenge/${challenge.id}`)} className="w-full text-left px-4 py-3 hover:bg-muted/30 transition-colors flex items-start gap-3">
                      <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0"><Trophy className="w-5 h-5 text-primary" /></div>
                      <div className="flex-1 min-w-0">
                        <p className="font-bold text-sm leading-snug">{challenge.title}</p>
                        {challenge.hashtags?.tag && <p className="text-xs text-primary mt-0.5">#{challenge.hashtags.tag}</p>}
                        <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1"><Hash className="w-3 h-3" />{challenge.entry_count ?? 0} entries</span>
                          <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{formatDistanceToNow(new Date(challenge.end_date), { addSuffix: true })}</span>
                          {challenge.prize && <span className="flex items-center gap-1"><Gift className="w-3 h-3 text-amber-500" />{challenge.prize.slice(0, 30)}</span>}
                        </div>
                      </div>
                      <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0 mt-1" />
                    </button>
                  ))}
                </div>
              )}
            </section>
          )}

          {showCreateChallenge && (
            <div className="fixed inset-0 z-[300] bg-black/60 flex items-end" onClick={() => setShowCreateChallenge(false)}>
              <div className="w-full bg-background rounded-t-3xl p-5 space-y-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between">
                  <h2 className="font-bold text-lg">Create Challenge</h2>
                  <button onClick={() => setShowCreateChallenge(false)} className="p-2 rounded-full hover:bg-muted"><X className="w-5 h-5" /></button>
                </div>
                <div className="space-y-3">
                  <div><label className="text-xs font-semibold text-muted-foreground mb-1 block">Title *</label><input value={challengeForm.title} onChange={e => setChallengeForm(p => ({ ...p, title: e.target.value }))} placeholder="Challenge title" className="w-full px-3 py-2.5 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" /></div>
                  <div><label className="text-xs font-semibold text-muted-foreground mb-1 block">Hashtag * (without #)</label><input value={challengeForm.hashtag} onChange={e => setChallengeForm(p => ({ ...p, hashtag: e.target.value.replace(/^#/, '') }))} placeholder="mychallenge" className="w-full px-3 py-2.5 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" /></div>
                  <div><label className="text-xs font-semibold text-muted-foreground mb-1 block">Description</label><textarea value={challengeForm.description} onChange={e => setChallengeForm(p => ({ ...p, description: e.target.value }))} placeholder="What's the challenge about?" rows={2} className="w-full px-3 py-2.5 rounded-xl border border-border bg-background text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/30" /></div>
                  <div><label className="text-xs font-semibold text-muted-foreground mb-1 block">Prize (optional)</label><input value={challengeForm.prize} onChange={e => setChallengeForm(p => ({ ...p, prize: e.target.value }))} placeholder="e.g. $50 gift card" className="w-full px-3 py-2.5 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" /></div>
                  <div><label className="text-xs font-semibold text-muted-foreground mb-1 block">End Date *</label><input type="date" value={challengeForm.end_date} onChange={e => setChallengeForm(p => ({ ...p, end_date: e.target.value }))} min={new Date().toISOString().split('T')[0]} className="w-full px-3 py-2.5 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" /></div>
                  <button onClick={handleCreateChallenge} disabled={creatingChallenge} className="w-full py-3 bg-primary text-primary-foreground rounded-xl font-bold text-sm disabled:opacity-50 flex items-center justify-center gap-2">
                    {creatingChallenge ? <><Loader2 className="w-4 h-4 animate-spin" />Creating…</> : <><Trophy className="w-4 h-4" />Launch Challenge</>}
                  </button>
                </div>
              </div>
            </div>
          )}

          {newsItems.length > 0 && (
            <section className="border-b border-border">
              <div className="px-4 pt-4 pb-2"><h2 className="font-bold text-xl">Today's News</h2></div>
              <div className="divide-y divide-border">
                {newsItems.map((item) => (
                  <button key={item.id} onClick={() => navigateTopic(item.topic)} className="w-full text-left px-4 py-3 hover:bg-muted/30 transition-colors">
                    <h3 className="font-bold text-base leading-snug">{item.topic}</h3>
                    <p className="text-xs text-muted-foreground mt-1">· {item.category} · {formatNumber(item.posts_count)} posts</p>
                  </button>
                ))}
              </div>
            </section>
          )}

          {trending.length > 0 && (
            <section className="border-b border-border">
              <div className="px-4 pt-4 pb-2 flex items-center justify-between"><h2 className="font-bold text-xl">Trending</h2></div>
              <div className="divide-y divide-border">
                {trending.slice(0, 10).map((topic, i) => (
                  <button key={topic.id} onClick={() => navigateTopic(topic.topic)} className="w-full text-left px-4 py-3.5 hover:bg-muted/30 transition-colors flex items-start justify-between group">
                    <div>
                      <p className="text-xs text-muted-foreground">{i + 1} · Trending · {topic.category}</p>
                      <p className="font-bold text-base mt-0.5">{topic.topic}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{formatNumber(topic.posts_count)} posts</p>
                    </div>
                    <span className="text-muted-foreground/50 text-lg leading-none mt-1 group-hover:text-muted-foreground transition-colors">···</span>
                  </button>
                ))}
              </div>
            </section>
          )}

          {showWhoToFollow && whoToFollow.length > 0 && (
            <section className="border-b border-border">
              <div className="px-4 pt-4 pb-2"><h2 className="font-bold text-xl">Who to follow</h2></div>
              <div className="divide-y divide-border">
                {whoToFollow.map((profile) => (
                  <div key={profile.id} className="px-4 py-3 flex items-center gap-3">
                    <div className="w-11 h-11 rounded-full bg-muted overflow-hidden flex-shrink-0 cursor-pointer" onClick={() => navigate(`/profile/${profile.username}`)}>
                      {profile.avatar_url ? <img src={profile.avatar_url} alt={profile.username} className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center font-bold text-sm">{profile.username[0]?.toUpperCase()}</div>}
                    </div>
                    <div className="flex-1 min-w-0 cursor-pointer" onClick={() => navigate(`/profile/${profile.username}`)}>
                      <div className="flex items-center gap-1">
                        <p className="font-bold text-sm truncate">{profile.username}</p>
                        {profile.verified && <BadgeCheck className="w-3.5 h-3.5 text-primary shrink-0" fill="currentColor" />}
                      </div>
                      <p className="text-xs text-muted-foreground truncate">{profile.bio ? profile.bio.slice(0, 50) : `@${profile.username}`}</p>
                    </div>
                    <button onClick={() => handleFollow(profile.id, profile.username)} className={`shrink-0 px-4 py-1.5 rounded-full text-sm font-semibold transition-colors ${isFollowingId(profile.id) ? 'border border-border hover:bg-muted' : 'bg-foreground text-background hover:opacity-90'}`}>
                      {isFollowingId(profile.id) ? 'Following' : 'Follow'}
                    </button>
                  </div>
                ))}
              </div>
              <button onClick={() => navigate('/discover')} className="w-full px-4 py-3.5 text-sm text-primary hover:bg-muted/30 transition-colors text-left font-medium">Show more</button>
            </section>
          )}

          {trendingHashtags.length > 0 && (
            <section className="border-b border-border p-4">
              <h2 className="font-bold text-xl mb-3">Trending Hashtags</h2>
              <div className="grid grid-cols-2 gap-2">
                {trendingHashtags.slice(0, 8).map((tag: any) => (
                  <button key={tag.id} onClick={() => navigate(`/hashtag/${tag.tag}`)} className="p-3 border border-border rounded-xl hover:bg-muted/50 text-left transition-colors">
                    <p className="font-bold text-primary text-sm">#{tag.tag}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{formatNumber(tag.usage_count)} posts</p>
                  </button>
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {activeTab === 'Trending' && !inlineSearchResults && (
        <div>
          <div className="relative overflow-hidden border-b border-border mx-4 my-4 rounded-2xl">
            <div className="absolute inset-0 bg-gradient-to-br from-blue-950 via-indigo-900 to-purple-900" />
            <div className="relative px-5 py-8 flex items-end justify-between">
              <div>
                <h2 className="text-white text-2xl font-bold leading-tight">What's Trending</h2>
                <p className="text-white/70 text-sm mt-1 mb-3">Top hashtags in the last 24 hours</p>
                <button onClick={() => navigate('/hashtags')} className="px-5 py-2 border border-white/60 text-white text-sm font-semibold rounded-full hover:bg-white/15 transition-colors">Discover Hashtags</button>
              </div>
              <Flame className="w-20 h-20 text-orange-400/20 flex-shrink-0" />
            </div>
          </div>

          {trendingHashtags.length > 0 && (
            <div className="mx-4 mb-4 bg-card border border-border rounded-2xl overflow-hidden">
              <div className="px-4 pt-4 pb-2 flex items-center justify-between">
                <div>
                  <p className="font-bold text-sm">Top Trending Hashtags</p>
                  <p className="text-xs text-muted-foreground">24-hour post volume</p>
                </div>
                <span className="text-[10px] font-bold text-primary bg-primary/10 px-2 py-0.5 rounded-full">{trendingHashtags.length} trending</span>
              </div>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart
                  data={trendingHashtags.slice(0, 10).map((h: any) => ({ tag: `#${h.tag}`, posts: h.daily_posts ?? h.usage_count ?? 0 }))}
                  margin={{ top: 4, right: 16, left: -16, bottom: 32 }}
                >
                  <XAxis dataKey="tag" tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }} angle={-35} textAnchor="end" interval={0} />
                  <YAxis hide />
                  <Tooltip formatter={(v: any) => [v, 'posts']} contentStyle={{ fontSize: 11, borderRadius: 10, padding: '4px 10px', border: '1px solid hsl(var(--border))', background: 'hsl(var(--background))' }} cursor={{ fill: 'hsl(var(--muted))', opacity: 0.5 }} />
                  <Bar dataKey="posts" radius={[4, 4, 0, 0]}>
                    {trendingHashtags.slice(0, 10).map((_: any, i: number) => (
                      <Cell key={i} fill={i < 3 ? '#f97316' : i < 6 ? '#6366f1' : '#94a3b8'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          <div className="px-4 mb-4">
            <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-2 mb-3">
              {TRENDING_FILTER_CATS.map(cat => (
                <button key={cat} onClick={() => setTrendingTagFilter(cat)}
                  className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-bold border-2 transition-all ${trendingTagFilter === cat ? 'bg-primary text-primary-foreground border-primary shadow-sm' : 'border-border text-muted-foreground hover:border-primary/40 hover:text-foreground'}`}>
                  {cat === 'All' ? '🌐 All' : cat === 'Tech' ? '💻 Tech' : cat === 'Sports' ? '⚽ Sports' : cat === 'Entertainment' ? '🎥 Entertainment' : cat === 'Music' ? '🎵 Music' : '🗳️ Politics'}
                </button>
              ))}
            </div>
            <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-2">
              {trendingTagFilter === 'All' ? 'Top 20 Trending' : `${trendingTagFilter} Hashtags`}
              {trendingTagFilter !== 'All' && filteredTrendingCount > 0 && (
                <span className="ml-2 text-[10px] font-bold text-primary bg-primary/10 px-1.5 py-0.5 rounded-full">{filteredTrendingCount} found</span>
              )}
            </p>
            <div className="grid grid-cols-2 gap-2">
              {filteredTrendingHashtags.length === 0 ? (
                <div className="col-span-2 py-8 text-center text-muted-foreground">
                  <p className="font-semibold text-sm">No {trendingTagFilter} hashtags trending</p>
                  <p className="text-xs mt-1">Try a different category or check back later</p>
                </div>
              ) : filteredTrendingHashtags.map((tag: any, i: number) => (
                <button key={tag.id} onClick={() => navigate(`/hashtag/${tag.tag}`)}
                  className="flex items-center gap-2 p-3 border border-border rounded-xl hover:bg-muted/50 transition-all text-left group active:scale-95">
                  <span className={`text-xs font-black w-5 shrink-0 ${i === 0 ? 'text-orange-500' : i === 1 ? 'text-slate-400' : i === 2 ? 'text-amber-600' : 'text-muted-foreground'}`}>{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-sm text-primary truncate">#{tag.tag}</p>
                    <p className="text-[10px] text-muted-foreground">{formatNumber(tag.usage_count)} posts</p>
                  </div>
                  {i < 3 && <Flame className="w-3.5 h-3.5 text-orange-500 shrink-0" />}
                </button>
              ))}
            </div>
          </div>

          {trending.length > 0 && (
            <div className="border-t border-border">
              <div className="px-4 pt-4 pb-2"><p className="font-bold text-sm">Trending Topics</p></div>
              <div className="divide-y divide-border">
                {trending.slice(0, 20).map((topic, i) => (
                  <button key={topic.id} onClick={() => navigateTopic(topic.topic)} className="w-full text-left px-4 py-3 hover:bg-muted/30 transition-colors flex items-start justify-between group">
                    <div>
                      <p className="text-xs text-muted-foreground">{i + 1} · Trending in {topic.category}</p>
                      <p className="font-bold text-sm mt-0.5">{topic.topic}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{formatNumber(topic.posts_count)} posts</p>
                    </div>
                    <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0 mt-2 opacity-0 group-hover:opacity-100 transition-opacity" />
                  </button>
                ))}
              </div>
            </div>
          )}

          {whoToFollow.length > 0 && (
            <div className="border-t border-border mt-4">
              <div className="px-4 pt-4 pb-2 flex items-center justify-between">
                <div className="flex items-center gap-2"><Star className="w-4 h-4 text-primary" /><p className="font-bold text-sm">Rising Creators</p></div>
                <button onClick={() => navigate('/discover')} className="text-xs text-primary hover:underline font-semibold">See all</button>
              </div>
              <div className="divide-y divide-border">
                {whoToFollow.slice(0, 5).map((profile: any) => (
                  <div key={profile.id} className="px-4 py-3 flex items-center gap-3">
                    <div className="w-11 h-11 rounded-full bg-muted overflow-hidden shrink-0 cursor-pointer" onClick={() => navigate(`/profile/${profile.username}`)}>
                      {profile.avatar_url ? <img src={profile.avatar_url} alt={profile.username} className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center font-bold text-sm">{profile.username[0]?.toUpperCase()}</div>}
                    </div>
                    <div className="flex-1 min-w-0 cursor-pointer" onClick={() => navigate(`/profile/${profile.username}`)}>
                      <div className="flex items-center gap-1">
                        <p className="font-bold text-sm truncate">{profile.username}</p>
                        {profile.verified && <BadgeCheck className="w-3.5 h-3.5 text-primary shrink-0" fill="currentColor" />}
                        {profile.is_creator && <span className="text-[9px] bg-purple-500/10 text-purple-600 font-bold px-1.5 py-0.5 rounded-full border border-purple-500/20">Creator</span>}
                      </div>
                      <div className="flex items-center gap-2 text-[10px] text-muted-foreground mt-0.5">
                        <span className="flex items-center gap-0.5"><UsersIcon className="w-2.5 h-2.5" />{formatNumber(profile.follower_count)} followers</span>
                      </div>
                    </div>
                    <button onClick={() => handleFollow(profile.id, profile.username)}
                      className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${isFollowingId(profile.id) ? 'border border-border hover:bg-muted' : 'bg-foreground text-background hover:opacity-90'}`}>
                      {isFollowingId(profile.id) ? 'Following' : 'Follow'}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === 'Marketplace' && !inlineSearchResults && (
        <ExploreMarketplace searchQuery={searchQuery} navigate={navigate} />
      )}

      {(['News', 'Sports', 'Entertainment'] as ExploreTab[]).includes(activeTab) && !inlineSearchResults && (
        <CategoryTabContent
          activeTab={activeTab}
          trendingTopics={getFilteredTrending()}
          navigateTopic={navigateTopic}
          navigate={navigate}
        />
      )}
    </div>
  );
}
