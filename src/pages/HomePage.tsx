import { useState, useEffect, useRef, useCallback } from 'react';
import { buildFollowingFeed } from '@/services/recommendations';
import { useNavigate } from 'react-router-dom';
import { ComposePost } from '@/components/features/ComposePost';
import { PostCard } from '@/components/features/PostCard';
import { TopBar } from '@/components/layout/TopBar';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useInfiniteScroll } from '@/hooks/useInfiniteScroll';
import {
  Loader2, Sparkles, Globe, Users, Rss, RefreshCw, BarChart3,
  MessageCircle, Repeat2, Heart, Languages, ChevronUp,
  TrendingUp, Hash, BookOpen, Flame, Eye, Play, ShoppingBag,
  SlidersHorizontal, X as XIcon, Star, BadgeCheck,
} from 'lucide-react';
import { TrendingVideosSection } from '@/components/features/TrendingVideosSection';
import { CommunitySpotlightStrip } from '@/components/features/CommunitySpotlightStrip';
import { formatDistanceToNow } from 'date-fns';
import { formatNumber } from '@/lib/utils';
import { DynamicAd } from '@/components/features/DynamicAd';
import { NativeAdCard } from '@/components/features/NativeAdCard';
import { useSEO } from '@/hooks/useSEO';
import { SponsoredPostCard } from '@/components/features/SponsoredPostCard';
import { UserAdCard } from '@/components/features/UserAdCard';
import { FeedAdCard } from '@/components/features/FeedAdCard';
import { StoriesStrip } from '@/components/features/StoriesStrip';
import * as federation from '@/api/federation';

const PAGE_SIZE = 20;
const RECO_INJECT_INTERVAL = 8; // inject a recommendation card every N items

// ── Feed Prefetch Cache (SWR-style) ──────────────────────────────────────────
// Caches the first page of each tab so switching is instant on second visit
const feedCache: { tab: string; items: FeedItem[]; ts: number }[] = [];
const CACHE_TTL_MS = 3 * 60 * 1000; // 3 minutes
function getCachedFeed(tab: string): FeedItem[] | null {
  const entry = feedCache.find(e => e.tab === tab);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL_MS) return null;
  return entry.items;
}
function setCachedFeed(tab: string, items: FeedItem[]) {
  const idx = feedCache.findIndex(e => e.tab === tab);
  if (idx >= 0) feedCache.splice(idx, 1);
  feedCache.push({ tab, items, ts: Date.now() });
}

// esbuild guard: rank badge colors for Trending Now rail — must be module-level (not inside .map())
const TRENDING_NOW_RANK_COLORS = ['text-yellow-400','text-slate-300','text-amber-600','text-white/70','text-white/70'];

// Module-level helpers — esbuild guard: no IIFEs in render
function extractHostname(url: string): string {
  try { return new URL(url).hostname; } catch { return ''; }
}
function seriesProgressBadge(seriesId: string, getProgress: (id: string) => any) {
  const prog = getProgress(seriesId);
  if (!prog) return null;
  return (
    <span className="text-[9px] font-bold text-primary bg-primary/10 px-1.5 py-0.5 rounded-full">
      Part {prog.currentPart}/{prog.totalParts}
    </span>
  );
}

type Tab = 'foryou' | 'following' | 'hashtags' | 'federated' | 'popular' | 'tech' | 'science';

type FeedItem =
  | { type: 'post'; data: any }
  | { type: 'thread'; data: any }
  | { type: 'fedpost'; data: any }
  | { type: 'sponsored'; data: any }
  | { type: 'user-ad'; data: any }
  | { type: 'user-suggestions'; data: null }
  | { type: 'recommended'; data: any }
  | { type: 'product-spotlight'; data: any[] }
  | { type: 'series-widget'; data: any[] };

const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: 'foryou',    label: 'For you',   icon: Sparkles   },
  { id: 'following', label: 'Following', icon: Users      },
  { id: 'hashtags',  label: 'Hashtags',  icon: Hash       },
  { id: 'popular',   label: 'Popular',   icon: TrendingUp },
  { id: 'tech',      label: 'Tech',      icon: Hash       },
  { id: 'science',   label: 'Science',   icon: BookOpen   },
  { id: 'federated', label: 'Federated', icon: Globe      },
];

export default function HomePage() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [feedItems, setFeedItems] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>('foryou');
  const [page, setPage] = useState(0);
  // Cursor for pagination — tracks oldest post created_at seen
  const [feedCursor, setFeedCursor] = useState<string | null>(null);
  const [feedHasMore, setFeedHasMore] = useState(true);
  const [federatedCursor, setFederatedCursor] = useState<string | null>(null);
  const [federatedHasMore, setFederatedHasMore] = useState(true);
  const [sponsoredPosts, setSponsoredPosts] = useState<any[]>([]);
  const [userAds, setUserAds] = useState<any[]>([]);
  // blocked user ids — plain array (esbuild guard: no Set<string> state)
  const [blockedUserIds, setBlockedUserIds] = useState<string[]>([]);
  const [trendingHashtags, setTrendingHashtags] = useState<any[]>([]);
  const [recommendedPosts, setRecommendedPosts] = useState<any[]>([]);
  const [spotlightProducts, setSpotlightProducts] = useState<any[]>([]);
  const [publicSeries, setPublicSeries] = useState<any[]>([]);
  const [hashtagFeedItems, setHashtagFeedItems] = useState<FeedItem[]>([]);
  const [hashtagFeedLoading, setHashtagFeedLoading] = useState(false);
  // Real-time new posts banner
  const [hasNewPosts, setHasNewPosts] = useState(false);
  const [newPostCount, setNewPostCount] = useState(0);
  const realtimeChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  // ── Feed Diversity Slider ─────────────────────────────────────────────────
  const [showDiversityPanel, setShowDiversityPanel] = useState(false);
  // sliders persisted in localStorage — plain numbers (esbuild guard)
  const [discoverMix, setDiscoverMix] = useState<number>(() => {
    try { return Number(localStorage.getItem('ts-feed-discover-mix') ?? '30'); } catch { return 30; }
  });
  const [videoWeight, setVideoWeight] = useState<number>(() => {
    try { return Number(localStorage.getItem('ts-feed-video-weight') ?? '50'); } catch { return 50; }
  });
  const [minEngagement, setMinEngagement] = useState<number>(() => {
    try { return Number(localStorage.getItem('ts-feed-min-engagement') ?? '0'); } catch { return 0; }
  });

  // Persist slider values on change
  useEffect(() => { try { localStorage.setItem('ts-feed-discover-mix', String(discoverMix)); } catch {} }, [discoverMix]);
  useEffect(() => { try { localStorage.setItem('ts-feed-video-weight', String(videoWeight)); } catch {} }, [videoWeight]);
  useEffect(() => { try { localStorage.setItem('ts-feed-min-engagement', String(minEngagement)); } catch {} }, [minEngagement]);

  // ── Feed Tab Prefetch on Hover (50ms debounce) ────────────────────────────
  const prefetchHoverRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prefetchedTabs = useRef<string[]>([]);

  const handleTabHover = useCallback((tabId: Tab) => {
    // Skip foryou (already loaded), federated (different path), active tab, already prefetched
    if (tabId === 'foryou' || tabId === 'federated' || tabId === activeTab) return;
    if (prefetchedTabs.current.includes(tabId)) return;
    if (prefetchHoverRef.current) clearTimeout(prefetchHoverRef.current);
    prefetchHoverRef.current = setTimeout(async () => {
      if (prefetchedTabs.current.includes(tabId)) return;
      prefetchedTabs.current.push(tabId);
      // Quick prefetch: query posts for the tab and store in cache
      try {
        const prevTab = activeTab;
        // Temporarily set tab context for fetchFeed to use correct query
        // We replicate the core query here to avoid mutating activeTab state
        let query = supabase
          .from('posts')
          .select('*, user_profiles:profiles!posts_user_id_fkey(id,username,display_name,avatar_url,bio,verified_tier,follower_count,following_count,protected_account,cover_url,website,location,social_links,created_at)')
          .is('community_id', null)
          .range(0, PAGE_SIZE - 1);
        if (tabId === 'following' && user) {
          const { data: followingData } = await supabase
            .from('follows').select('following_id').eq('follower_id', user.id);
          const ids = (followingData ?? []).map((f: any) => f.following_id);
          if (ids.length === 0) return;
          query = supabase.from('posts').select('*, user_profiles:profiles!posts_user_id_fkey(id,username,display_name,avatar_url,bio,verified_tier,follower_count,following_count,protected_account,cover_url,website,location,social_links,created_at)')
            .is('community_id', null).in('user_id', ids)
            .order('created_at', { ascending: false }).range(0, PAGE_SIZE - 1);
        } else if (tabId === 'popular') {
          query = query.order('likes_count', { ascending: false }).order('views_count', { ascending: false });
        } else {
          query = query.order('created_at', { ascending: false });
        }
        const { data: posts } = await query;
        if (posts && posts.length > 0) {
          const items = posts.map((p: any) => ({ type: 'post' as const, data: p }));
          setCachedFeed(tabId, items);
          console.log(`[prefetch] cached ${items.length} posts for tab:${tabId}`);
        }
      } catch (err) {
        console.warn('[prefetch] failed for', tabId, err);
        // Remove from prefetched so it can retry
        prefetchedTabs.current = prefetchedTabs.current.filter(t => t !== tabId);
      }
    }, 50);
  }, [activeTab, user?.id]);

  const handleTabHoverEnd = useCallback(() => {
    if (prefetchHoverRef.current) clearTimeout(prefetchHoverRef.current);
  }, []);

  // ── Debounced feed refresh on slider change (500ms) ───────────────────────
  const sliderMountedRef = useRef(false);
  const sliderDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [sliderRefreshing, setSliderRefreshing] = useState(false);
  useEffect(() => {
    if (!sliderMountedRef.current) { sliderMountedRef.current = true; return; }
    if (activeTab !== 'foryou') return;
    if (sliderDebounceRef.current) clearTimeout(sliderDebounceRef.current);
    setSliderRefreshing(true);
    sliderDebounceRef.current = setTimeout(async () => {
      await fetchInitialFeed();
      setSliderRefreshing(false);
    }, 500);
    return () => { if (sliderDebounceRef.current) clearTimeout(sliderDebounceRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [discoverMix, videoWeight, minEngagement]);

  // ── Trending Now rail state ────────────────────────────────────────────────
  const [trendingNowPosts, setTrendingNowPosts] = useState<any[]>([]);

  const fetchTrendingNow = async () => {
    const since24h = new Date(Date.now() - 24 * 3600000).toISOString();
    const { data } = await supabase
      .from('posts')
      .select('id, content, image_url, video_url, is_video, views_count, likes_count, user_profiles:profiles!posts_user_id_fkey(id, username, avatar_url, verified_tier)')
      .is('community_id', null)
      .gte('created_at', since24h)
      .order('views_count', { ascending: false })
      .limit(5);
    setTrendingNowPosts(data ?? []);
  };

  useEffect(() => {
    if (activeTab === 'foryou') fetchTrendingNow();
  }, [activeTab]);

  const abortRef = useRef<AbortController | null>(null);
  // Keep ref for latest reco/product state so fetchFeed closure can read them
  const recoRef = useRef<any[]>([]);
  const productRef = useRef<any[]>([]);
  const seriesRef = useRef<any[]>([]);
  useEffect(() => { recoRef.current = recommendedPosts; }, [recommendedPosts]);
  useEffect(() => { productRef.current = spotlightProducts; }, [spotlightProducts]);
  useEffect(() => { seriesRef.current = publicSeries; }, [publicSeries]);

  // Fetch blocked user IDs to filter from feed
  useEffect(() => {
    if (!user) { setBlockedUserIds([]); return; }
    supabase.from('user_blocks').select('blocked_id').eq('blocker_id', user.id)
      .then(({ data }) => {
        setBlockedUserIds((data ?? []).map((r: any) => r.blocked_id));
      });
  }, [user?.id]);

  // Dynamic SEO — shows top 3 trending topics in description when available
  const [trendingTopics, setTrendingTopics] = useState<string[]>([]);
  useEffect(() => {
    supabase
      .from('trending_topics')
      .select('topic')
      .order('posts_count', { ascending: false })
      .limit(3)
      .then(({ data }) => { if (data) setTrendingTopics(data.map((t: any) => t.topic)); });
  }, []);

  useSEO({
    title: trendingTopics.length > 0
      ? `Trending: ${trendingTopics.join(', ')}`
      : 'Social Media, Videos & Communities',
    description: 'Discover posts, short videos, live spaces, and communities. Follow creators, earn from your content, and connect with people worldwide on Testagram.',
    url: '/',
    type: 'website',
    keywords: 'social media, short videos, communities, creators, testagram, live spaces, trending',
    structuredData: [
      {
        '@context': 'https://schema.org',
        '@type': 'WebSite',
        name: 'Testagram',
        url: 'https://testagram.site',
        description: 'Social media platform with short videos, communities, and creator monetization.',
        potentialAction: {
          '@type': 'SearchAction',
          target: { '@type': 'EntryPoint', urlTemplate: 'https://testagram.site/search?q={search_term_string}' },
          'query-input': 'required name=search_term_string',
        },
      },
      {
        '@context': 'https://schema.org',
        '@type': 'Organization',
        name: 'Testagram',
        url: 'https://testagram.site',
        logo: {
          '@type': 'ImageObject',
          url: 'https://testagram.site/tsocial-logo.png',
          width: 512,
          height: 512,
        },
        sameAs: [
          'https://testagram.site/fediverse',
          'https://testagram.site/spaces',
          'https://testagram.site/threads',
        ],
        description: 'Testagram is a social media platform for short videos, creator monetization, communities, and federated social networking.',
        contactPoint: {
          '@type': 'ContactPoint',
          contactType: 'customer support',
          url: 'https://testagram.site/help',
        },
      },
      {
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        mainEntity: [
          {
            '@type': 'Question',
            name: 'What is Testagram?',
            acceptedAnswer: {
              '@type': 'Answer',
              text: 'Testagram is a social media platform where creators can share short videos, long-form articles, host live audio spaces, and earn from their content through tips, subscriptions, and ads.',
            },
          },
          {
            '@type': 'Question',
            name: 'How do creators earn money on Testagram?',
            acceptedAnswer: {
              '@type': 'Answer',
              text: 'Creators on Testagram can earn through multiple channels: tips from followers, paid subscriptions, ad revenue sharing, product sales in the marketplace, and wallet top-ups via M-Pesa.',
            },
          },
          {
            '@type': 'Question',
            name: 'Is Testagram available as a mobile app?',
            acceptedAnswer: {
              '@type': 'Answer',
              text: 'Testagram is a Progressive Web App (PWA) accessible on any device via browser. It also supports cross-platform deployment via Capacitor for native iOS and Android experiences.',
            },
          },
        ],
      },
    ],
  });

  // ── Fetch personalized recommendations ──────────────────────────────────
  const fetchRecommendations = useCallback(async () => {
    if (!user) return;
    try {
      // 1️⃣ Trigger server-side recommendation generation (Twitter-style interest graph)
      supabase.rpc('generate_content_recommendations', { p_user_id: user.id }).catch(() => {});

      // 2️⃣ Read freshly-generated recommendations
      const { data: recs } = await supabase
        .from('content_recommendations')
        .select('recommended_post_id, score, reason')
        .eq('user_id', user.id)
        .eq('shown', false)
        .order('score', { ascending: false })
        .limit(10);

      if (recs && recs.length > 0) {
        const postIds = recs.map((r: any) => r.recommended_post_id);
        const { data: posts } = await supabase
          .from('posts')
          .select('*, user_profiles:profiles!posts_user_id_fkey(id,username,display_name,avatar_url,bio,verified_tier,follower_count,following_count,protected_account,cover_url,website,location,social_links,created_at)')
          .in('id', postIds)
          .is('community_id', null);
        if (posts && posts.length > 0) {
          const pIds: string[] = posts.map((p: any) => p.id);
          const enriched = recs
            .map((r: any) => {
              const pi = pIds.indexOf(r.recommended_post_id);
              return pi >= 0 ? { ...(posts[pi] as any), _reason: r.reason, _score: r.score } : null;
            })
            .filter((p: any) => p?.id);
          setRecommendedPosts(enriched);
          supabase.from('content_recommendations').update({ shown: true }).in('recommended_post_id', postIds).eq('user_id', user.id).catch(() => {});
          return;
        }
      }

      // 3️⃣ Fallback A: interest-based via user_interests hashtag graph
      const { data: interests } = await supabase
        .from('user_interests')
        .select('interest_score, hashtags(tag)')
        .eq('user_id', user.id)
        .order('interest_score', { ascending: false })
        .limit(8);

      const tags = ((interests ?? []) as any[]).map((i: any) => i.hashtags?.tag).filter(Boolean);

      if (tags.length > 0) {
        const { data: hashtagRows } = await supabase.from('hashtags').select('id').in('tag', tags);
        const tagIds = (hashtagRows ?? []).map((t: any) => t.id);
        if (tagIds.length > 0) {
          const { data: phs } = await supabase.from('post_hashtags').select('post_id').in('hashtag_id', tagIds).limit(50);
          const pids = [...new Set((phs ?? []).map((ph: any) => ph.post_id))] as string[];
          if (pids.length > 0) {
            const { data: intPosts } = await supabase
              .from('posts').select('*, user_profiles:profiles!posts_user_id_fkey(id,username,display_name,avatar_url,bio,verified_tier,follower_count,following_count,protected_account,cover_url,website,location,social_links,created_at)')
              .in('id', pids.slice(0, 10))
              .is('community_id', null)
              .neq('user_id', user.id);
            if (intPosts && intPosts.length > 0) {
              // Sort by engagement score (Twitter-style)
              const scored = [...intPosts].sort((a: any, b: any) =>
                ((b.likes_count ?? 0) * 2 + (b.reposts_count ?? 0) * 3 + (b.views_count ?? 0) * 0.05) -
                ((a.likes_count ?? 0) * 2 + (a.reposts_count ?? 0) * 3 + (a.views_count ?? 0) * 0.05)
              );
              setRecommendedPosts(scored.map((p: any) => ({ ...p, _reason: 'Based on your interests' })));
              return;
            }
          }
        }
      }

      // 4️⃣ Fallback B: popular posts from followed users (social proof)
      const { data: followingData } = await supabase
        .from('follows').select('following_id').eq('follower_id', user.id).limit(20);
      const followIds = (followingData ?? []).map((f: any) => f.following_id);
      if (followIds.length > 0) {
        const { data: followPosts } = await supabase
          .from('posts').select('*, user_profiles:profiles!posts_user_id_fkey(id,username,display_name,avatar_url,bio,verified_tier,follower_count,following_count,protected_account,cover_url,website,location,social_links,created_at)')
          .in('user_id', followIds)
          .is('community_id', null)
          .order('likes_count', { ascending: false })
          .limit(6);
        if (followPosts && followPosts.length > 0) {
          setRecommendedPosts(followPosts.map((p: any) => ({ ...p, _reason: 'Popular from people you follow' })));
        }
      }
    } catch (err) {
      console.warn('[feed] recommendations failed:', err);
    }
  }, [user?.id]);

  // ── Fetch product spotlight (from creators user follows) ─────────────────
  const fetchProductSpotlight = useCallback(async () => {
    if (!user) return;
    try {
      const { data: followingData } = await supabase
        .from('follows').select('following_id').eq('follower_id', user.id).limit(30);
      const followIds = (followingData ?? []).map((f: any) => f.following_id);
      if (followIds.length === 0) return;
      const { data: products } = await supabase
        .from('products')
        .select('*, user_profiles:profiles!posts_user_id_fkey(id, username, avatar_url, verified_tier)')
        .in('user_id', followIds)
        .eq('is_active', true)
        .order('created_at', { ascending: false })
        .limit(6);
      setSpotlightProducts(products ?? []);
    } catch { setSpotlightProducts([]); }
  }, [user?.id]);

  // ── Fetch public series for widget ─────────────────────────────────────────
  const fetchPublicSeries = useCallback(async () => {
    const { data } = await supabase
      .from('post_series')
      .select('*, user_profiles!post_series_user_id_fkey(username, avatar_url, verified)')
      .eq('is_public', true)
      .gt('item_count', 0)
      .order('item_count', { ascending: false })
      .limit(8);
    setPublicSeries(data ?? []);
  }, []);

  // Fetch user-created ads (approved, paid) for inline feed injection
  const fetchUserAds = async () => {
    try {
      const { data } = await supabase
        .from('user_ads')
        .select('*, user_profiles!user_ads_user_id_fkey(id, username, avatar_url, verified)')
        .eq('status', 'active')
        .eq('payment_status', 'paid')
        .order('created_at', { ascending: false })
        .limit(5);
      setUserAds(data ?? []);
    } catch { setUserAds([]); }
  };

  // Only show ads that users actually created AND admin approved (status=active, payment=paid)
  const fetchSponsoredContent = async () => {
    try {
      // Personalized ads via RPC when user is logged in
      if (user?.id) {
        const { data: personalizedAds } = await supabase.rpc('get_personalized_ads', {
          p_user_id: user.id,
          p_limit: 5
        });
        if (personalizedAds && personalizedAds.length > 0) {
          setSponsoredPosts(personalizedAds.map((a: any) => ({
            ...a,
            id: a.ad_id, // normalize
          })));
          return;
        }
      }
      // Fallback: most recent active ads
      const { data } = await supabase
        .from('user_ads')
        .select('*, user_profiles!user_ads_user_id_fkey(id, username, avatar_url, verified)')
        .eq('status', 'active')
        .eq('payment_status', 'paid')
        .order('created_at', { ascending: false })
        .limit(3);
      setSponsoredPosts(data && data.length > 0 ? data : []);
    } catch { setSponsoredPosts([]); }
  };

  // ── Cache federated posts to remote_posts table ───────────────────────────
  const cacheFederatedPosts = async (posts: any[]) => {
    if (posts.length === 0) return;
    const rows = posts
      .filter((p: any) => p.uri ?? p.url ?? p.id)
      .map((p: any) => {
        const actorUrl =
          p.actor?.id ?? p.actor?.url ??
          p.account?.url ?? p.account?.id ??
          p.actor_url ?? '';
        return {
          object_url: p.uri ?? p.url ?? p.id ?? '',
          actor_url: actorUrl,
          content: p.content ?? p.text ?? '',
          summary: p.spoiler_text ?? p.summary ?? null,
          media_urls: p.media_attachments ?? p.media_urls ?? [],
          likes_count: p.favourites_count ?? p.likes_count ?? 0,
          replies_count: p.replies_count ?? 0,
          boosts_count: p.reblogs_count ?? p.boosts_count ?? 0,
          published_at: p.created_at ?? p.published ?? new Date().toISOString(),
          raw_object: p,
        };
      })
      .filter((r: any) => r.object_url);

    if (rows.length === 0) return;
    try {
      await supabase
        .from('remote_posts')
        .upsert(rows, { onConflict: 'object_url', ignoreDuplicates: false });
    } catch (cacheErr) {
      console.warn('[feed] Failed to cache federated posts:', cacheErr);
    }
  };

  // ── Federated timeline via Gateway ──────────────────────────────────────────
  const normalizeFederatedPosts = (posts: any[]): any[] => posts.map((p: any) => {
    // federated-feed resolves ActivityPub actors into remote_account; preserve
    // that canonical profile so homepage cards match the Fediverse page.
    const actor = p.remote_account ?? p.actor ?? p.account ?? {};
    const actorUri = actor.actor_uri ?? actor.id ?? p.actor_uri ?? '';
    let domain = actor.domain ?? '';
    if (!domain && actorUri) {
      try { domain = new URL(actorUri).hostname; } catch {}
    }
    return {
      ...p,
      id: p.id ?? p.uri ?? p.url ?? ('fed-' + (p.created_at ?? p.published_at ?? '') + '-' + (p.content?.slice(0, 8) ?? '')),
      content: p.content ?? p.text ?? '',
      created_at: p.created_at ?? p.published_at ?? p.published ?? new Date().toISOString(),
      actor: { ...actor, actor_uri: actorUri, domain },
      user_profiles: actor,
      remote_status_uri: typeof p.uri === 'string' && /^https:\/\//i.test(p.uri) ? p.uri : undefined,
      likes_count: p.likes_count ?? p.like_count ?? 0,
      reposts_count: p.reposts_count ?? p.announce_count ?? 0,
      replies_count: p.replies_count ?? p.reply_count ?? 0,
    };
  });
  const fetchFederatedPage = async (before?: string | null): Promise<{ posts: any[]; nextCursor: string | null; hasMore: boolean }> => {
    try {
      const page = await federation.getFederatedTimelinePage({ limit: 12, before: before ?? undefined });
      const posts = normalizeFederatedPosts(page.items ?? []);
      cacheFederatedPosts(posts).catch(() => {});
      return { posts, nextCursor: page.pagination?.nextCursor ?? null, hasMore: page.pagination?.hasMore ?? posts.length >= 12 };
    } catch (err) {
      console.warn('[feed] federated page unavailable:', err);
      if (before) return { posts: [], nextCursor: null, hasMore: false };
      try {
        const { data } = await supabase.from('remote_posts').select('*, remote_accounts(username, domain, display_name, avatar_url)').order('published_at', { ascending: false }).limit(12);
        const posts = (data ?? []).map((p: any) => ({ ...p, id: p.id, content: p.content ?? '', created_at: p.published_at ?? p.created_at, actor: p.remote_accounts ?? {} }));
        return { posts, nextCursor: null, hasMore: false };
      } catch { return { posts: [], nextCursor: null, hasMore: false }; }
    }
  };

  const fetchFederatedPosts = async (): Promise<any[]> => (await fetchFederatedPage(null)).posts;

  const mixHomeDiscovery = (localItems: FeedItem[], federatedPosts: any[], pageNum: number): FeedItem[] => {
    const result = [...localItems];
    const seedBase = `${user?.id ?? 'anonymous'}:${pageNum}:${result.length}:${federatedPosts.length}`;
    let seed = 2166136261;
    for (let i = 0; i < seedBase.length; i++) seed = Math.imul(seed ^ seedBase.charCodeAt(i), 16777619);
    const random = () => { seed += 0x6D2B79F5; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const fed = [...federatedPosts].sort(() => random() - 0.5).map((post: any) => ({ type: 'fedpost' as const, data: post }));
    const fedTarget = Math.min(fed.length, Math.max(1, Math.round(Math.min(0.16, 0.08 + random() * 0.08) * Math.max(result.length, 1))));
    const usedPositions: number[] = [];
    for (let i = 0; i < fedTarget; i++) {
      if (!fed[i]) break;
      const min = Math.min(4, Math.max(1, result.length));
      const max = Math.max(min, result.length - 1);
      let pos = min + Math.floor(random() * (max - min + 1));
      while (usedPositions.includes(pos) && pos < max) pos++;
      usedPositions.push(pos); result.splice(Math.min(pos, result.length), 0, fed[i]);
    }
    const shouldSuggest = pageNum == 0 ? result.length >= 4 : random() < 0.35;
    if (shouldSuggest && result.length >= 4) {
      const min = 3, max = Math.max(min, result.length - 2);
      const pos = min + Math.floor(random() * (max - min + 1));
      result.splice(pos, 0, { type: 'user-suggestions', data: null });
    }
    return result;
  };

  // ── Local posts feed ────────────────────────────────────────────────────────
  const fetchFeed = async (pageNum: number): Promise<FeedItem[]> => {
    try {
      let postsQuery = supabase
        .from('posts')
        .select('*, user_profiles:profiles!posts_user_id_fkey(id,username,display_name,avatar_url,bio,verified_tier,follower_count,following_count,protected_account,cover_url,website,location,social_links,created_at)')
        .is('community_id', null)
        .range(pageNum * PAGE_SIZE, (pageNum + 1) * PAGE_SIZE - 1);

      let threadsQuery = supabase
        .from('threads')
        .select('*, user_profiles:profiles!posts_user_id_fkey(id,username,display_name,avatar_url,bio,verified_tier,follower_count,following_count,protected_account,cover_url,website,location,social_links,created_at)')
        .eq('is_published', true)
        .order('created_at', { ascending: false })
        .range(pageNum * 5, (pageNum + 1) * 5 - 1);

      if (activeTab === 'following' && user) {
        const { data: followingData } = await supabase
          .from('follows')
          .select('following_id')
          .eq('follower_id', user.id);

        const ids = followingData?.map(f => f.following_id) ?? [];
        if (ids.length === 0) return [];

        postsQuery = postsQuery.in('user_id', ids).order('created_at', { ascending: false });
        threadsQuery = threadsQuery.in('user_id', ids);
      } else if (activeTab === 'popular') {
        postsQuery = postsQuery
          .order('likes_count', { ascending: false })
          .order('views_count', { ascending: false });
      } else if (activeTab === 'tech' || activeTab === 'science') {
        const keywords = activeTab === 'tech'
          ? ['tech', 'technology', 'programming', 'coding', 'javascript', 'python', 'ai', 'software', 'developer', 'web']
          : ['science', 'research', 'biology', 'physics', 'chemistry', 'math', 'space', 'medicine', 'climate'];
        const { data: tags } = await supabase.from('hashtags').select('id').in('tag', keywords);
        const tagIds = (tags ?? []).map((t: any) => t.id);
        if (!tagIds.length) return [];
        const { data: phs } = await supabase
          .from('post_hashtags').select('post_id').in('hashtag_id', tagIds).limit(200);
        const allIds = [...new Set((phs ?? []).map((ph: any) => ph.post_id))] as string[];
        const pagedIds = allIds.slice(pageNum * PAGE_SIZE, (pageNum + 1) * PAGE_SIZE);
        if (!pagedIds.length) return [];
        postsQuery = supabase
          .from('posts').select('*, user_profiles:profiles!posts_user_id_fkey(id,username,display_name,avatar_url,bio,verified_tier,follower_count,following_count,protected_account,cover_url,website,location,social_links,created_at)').is('community_id', null)
          .in('id', pagedIds).order('likes_count', { ascending: false });
      } else {
        postsQuery = postsQuery.order('created_at', { ascending: false });
      }

      const [postsRes, threadsRes] = await Promise.all([postsQuery, threadsQuery]);

      // Boosted — parallel arrays (esbuild guard: no Record<string,T> type annotation)
      const postIds = (postsRes.data ?? []).map((p: any) => p.id);
      const boostedIds: string[] = [];
      const boostedTypes: string[] = [];
      if (postIds.length > 0) {
        const { data: bd } = await supabase
          .from('boosted_posts')
          .select('post_id, boost_type, budget')
          .in('post_id', postIds)
          .eq('is_active', true);
        (bd ?? []).forEach((b: any) => {
          boostedIds.push(b.post_id);
          boostedTypes.push(b.budget > 0 ? 'paid' : 'rewarded_ad');
        });
      }
      const getBoostedType = (pid: string): string | null => {
        const i = boostedIds.indexOf(pid); return i >= 0 ? boostedTypes[i] : null;
      };

      // Enhanced scoring: engagement + recency + boost bonus + diversity weights
      const scorePost = (p: any) => {
        const ageHours = (Date.now() - new Date(p.created_at).getTime()) / 3_600_000;
        const boostBonus = getBoostedType(p.id) ? 50 : 0;
        // Twitter-style relevance: engagement-weighted + recency decay + type bonus
        const engagementScore =
          (p.likes_count ?? 0) * 2.0 +
          (p.reposts_count ?? 0) * 3.0 +
          (p.replies_count ?? 0) * 1.5 +
          (p.views_count ?? 0) * 0.05;
        // Recency decay: score halves every 12h (Twitter-like freshness bias)
        const decayFactor = Math.pow(0.5, ageHours / 12);
        // Apply video weight from diversity slider (0–100 → 0–16 bonus range)
        const videoBonus = p.is_video ? (videoWeight / 100) * 16 : (p.image_url || (p.media_urls?.length > 0)) ? 4 : 0;
        const typeBonus = videoBonus;
        const verifiedBonus = p.user_profiles?.verified ? 5 : 0;
        return (engagementScore * decayFactor) + typeBonus + verifiedBonus + boostBonus;
      };

      // Filter by min engagement threshold from diversity slider
      const minEngScore = (minEngagement / 100) * 20; // 0–20 raw engagement score floor
      const posts = (postsRes.data ?? []).map((p: any) => ({
        type: 'post' as const,
        data: { ...p, is_boosted: !!getBoostedType(p.id), boost_type: getBoostedType(p.id) ?? undefined },
        _score: scorePost(p),
        _ts: new Date(p.created_at).getTime(),
      })).filter((p: any) => {
        if (activeTab !== 'foryou' || minEngScore === 0) return true;
        const raw = ((p.data.likes_count ?? 0) * 2) + ((p.data.reposts_count ?? 0) * 3) + ((p.data.views_count ?? 0) * 0.05);
        return raw >= minEngScore;
      });

      const threads = (threadsRes.data ?? []).map((t: any) => ({
        type: 'thread' as const,
        data: t,
        _score: 0,
        _ts: new Date(t.created_at).getTime(),
      }));

      let combined = [...posts, ...threads];
      if (activeTab === 'foryou') {
        combined.sort((a, b) => b._score - a._score);
      } else {
        combined.sort((a, b) => b._ts - a._ts);
      }

      // Read recs/products from refs (stable across render cycles)
      const currentRecos = recoRef.current;
      const currentProducts = productRef.current;
      const currentSeries = seriesRef.current;

      const withExtras: FeedItem[] = [];
      let sponsoredIdx = 0;
      let userAdIdx = 0;
      let recoIdx = 0;
      let productSpotlightInserted = false;
      let seriesWidgetInserted = false;

      for (let i = 0; i < combined.length; i++) {
        withExtras.push({ type: combined[i].type, data: combined[i].data } as FeedItem);

        // Personalized recommendation injection (frequency modulated by discoverMix slider)
        // discoverMix 0 = inject rarely (every 12), 100 = inject often (every 4)
        const recoInterval = Math.round(12 - (discoverMix / 100) * 8);
        if (pageNum === 0 && (i + 1) % recoInterval === 0 && recoIdx < currentRecos.length) {
          withExtras.push({ type: 'recommended', data: currentRecos[recoIdx++] });
        }

        // Product spotlight from followed creators — once around position 12
        if (pageNum === 0 && i === 12 && !productSpotlightInserted && currentProducts.length > 0) {
          withExtras.push({ type: 'product-spotlight', data: currentProducts });
          productSpotlightInserted = true;
        }

        // Series Discovery Widget — once around position 15
        if (pageNum === 0 && i === 15 && !seriesWidgetInserted && currentSeries.length > 0) {
          withExtras.push({ type: 'series-widget', data: currentSeries });
          seriesWidgetInserted = true;
        }

        // User-created ads — inject every 7 posts (non-random for determinism)
        if ((i + 1) % 7 === 0 && userAdIdx < userAds.length) {
          withExtras.push({ type: 'user-ad', data: userAds[userAdIdx++] });
        } else if ((i + 1) % 10 === 0 && sponsoredIdx < sponsoredPosts.length) {
          withExtras.push({ type: 'sponsored', data: sponsoredPosts[sponsoredIdx++] });
        }
      }

      return withExtras;
    } catch (err) {
      console.error('[feed] fetchFeed error:', err);
      return [];
    }
  };

  const fetchInitialFeed = async (skipCache = false) => {
    // ── Serve from prefetch cache when available (tab switch) ──────────────
    if (!skipCache && activeTab !== 'federated' && activeTab !== 'foryou') {
      const cached = getCachedFeed(activeTab);
      if (cached && cached.length > 0) {
        setFeedItems(cached);
        setLoading(false);
        setPage(0);
        setFeedCursor(null);
        setFeedHasMore(true);
        // Refresh in background without showing spinner
        setTimeout(async () => {
          await fetchSponsoredContent();
          await fetchRecommendations();
          // silent background refresh — don't block UI
          const fresh = await fetchFeed(0);
          if (fresh.length > 0) {
            setFeedItems(fresh);
            setCachedFeed(activeTab, fresh);
          }
        }, 800);
        return;
      }
    }
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    setLoading(true);
    setFeedItems([]);
    setPage(0);
    setFeedCursor(null);
    setFeedHasMore(true);
    setFederatedCursor(null);
    setFederatedHasMore(true);

    if (activeTab === 'federated') {
      const fedPosts = await fetchFederatedPosts();
      setFeedItems(fedPosts.map(p => ({ type: 'fedpost' as const, data: p })));
    } else if (activeTab === 'following' && user) {
      // ── Twitter-style Following Feed: 80% following + 20% 2nd-degree viral ──
      const { data: followingData } = await supabase
        .from('follows')
        .select('following_id')
        .eq('follower_id', user.id);
      const followIds = (followingData ?? []).map((f: any) => f.following_id);

      const [scoredResult, gatewayResult] = await Promise.allSettled([
        buildFollowingFeed(user.id, followIds, 0, PAGE_SIZE),
        fetchFederatedPosts(),
      ]);

      const localScored = scoredResult.status === 'fulfilled' ? scoredResult.value : [];
      const local: FeedItem[] = localScored.map((s: any) => (
        s.source === 'viral'
          ? { type: 'recommended' as const, data: { ...s.post, _reason: s.reason } }
          : { type: 'post' as const, data: s.post }
      ));

      const gateway =
        gatewayResult.status === 'fulfilled'
          ? gatewayResult.value.map((p: any) => ({ type: 'fedpost' as const, data: p }))
          : [];
      const merged: FeedItem[] = [...local];
      gateway.slice(0, 4).forEach((item: FeedItem, i: number) => {
        const insertAt = Math.min(merged.length, (i + 1) * 5);
        merged.splice(insertAt, 0, item);
      });
      const filtered = merged.filter((item: any) => {
        const uid = item.data?.user_id ?? item.data?.user_profiles?.id;
        return !uid || !blockedUserIds.includes(uid);
      });
      setFeedItems(filtered);
      // Set cursor from last local post
      const lastPost = filtered.filter((i: any) => i.type === 'post').slice(-1)[0];
      if (lastPost) setFeedCursor((lastPost.data as any).created_at ?? null);
    } else if (activeTab === 'foryou') {
      const [localItems, federatedPage] = await Promise.all([fetchFeed(0), fetchFederatedPage(null)]);
      const mixed = mixHomeDiscovery(localItems, federatedPage.posts, 0);
      setFeedItems(mixed);
      const localPosts = localItems.filter((i: any) => i.type === 'post');
      const lastPost = localPosts.slice(-1)[0];
      if (lastPost) setFeedCursor((lastPost.data as any).created_at ?? null);
      setFederatedCursor(federatedPage.nextCursor);
      setFederatedHasMore(federatedPage.hasMore);
      setFeedHasMore(localPosts.length >= PAGE_SIZE || federatedPage.hasMore || federatedPage.posts.length > 0);
      if (mixed.length > 0) setCachedFeed(activeTab, mixed);
    } else {
      const items = await fetchFeed(0);
      setFeedItems(items);
      const lastPost = items.filter((i: any) => i.type === 'post').slice(-1)[0];
      if (lastPost) setFeedCursor((lastPost.data as any).created_at ?? null);
      setFeedHasMore(items.filter((i: any) => i.type === 'post').length >= PAGE_SIZE);
      if (items.length > 0) setCachedFeed(activeTab, items);
    }
    setLoading(false);
  };

  // ── Fetch hashtag-followed posts ────────────────────────────────────────
  const fetchHashtagFeed = useCallback(async () => {
    if (!user) return;
    setHashtagFeedLoading(true);
    try {
      const { data: follows } = await supabase
        .from('hashtag_follows')
        .select('hashtag_id, hashtags(id, tag)')
        .eq('user_id', user.id)
        .limit(30);
      const tagIds = (follows ?? []).map((f: any) => f.hashtag_id).filter(Boolean);
      const tagNames = (follows ?? []).map((f: any) => String(f.hashtags?.tag ?? '').toLowerCase().replace(/[^a-z0-9_]/g, '')).filter(Boolean);
      if (tagIds.length === 0 && tagNames.length === 0) { setHashtagFeedItems([]); setHashtagFeedLoading(false); return; }
      const { data: phs } = await supabase
        .from('post_hashtags')
        .select('post_id, hashtag_id, hashtags(tag)')
        .in('hashtag_id', tagIds)
        .limit(200);
      const postIds = [...new Set((phs ?? []).map((ph: any) => ph.post_id))] as string[];
      const remoteFilter = tagNames.map((tag: string) => `content.ilike.%#${tag}%`).join(',');
      const { data: remoteRows } = remoteFilter
        ? await supabase.from('federated_objects')
            .select('id,uri,actor_uri,content,summary,published_at,updated_at,attachments,tags,like_count,announce_count,reply_count,remote_account,object_type,url')
            .is('deleted_at', null).or(remoteFilter).order('published_at', { ascending: false }).limit(50)
        : { data: [] as any[] };
      if (postIds.length === 0 && !(remoteRows ?? []).length) { setHashtagFeedItems([]); setHashtagFeedLoading(false); return; }
      const { data: posts } = await supabase
        .from('posts')
        .select('*, user_profiles:profiles!posts_user_id_fkey(id,username,display_name,avatar_url,bio,verified_tier,follower_count,following_count,protected_account,cover_url,website,location,social_links,created_at)')
        .in('id', postIds.slice(0, 50))
        .is('community_id', null)
        .order('created_at', { ascending: false });
      // Build tag map for badge display
      // postTagMap as parallel arrays (esbuild guard: no index-sig type annotations)
      const tagPostIds: string[] = [];
      const tagPostTags: string[][] = [];
      (phs ?? []).forEach((ph: any) => {
        const idx = tagPostIds.indexOf(ph.post_id);
        if (idx >= 0) { if (ph.hashtags?.tag) tagPostTags[idx].push(ph.hashtags.tag); }
        else { tagPostIds.push(ph.post_id); tagPostTags.push(ph.hashtags?.tag ? [ph.hashtags.tag] : []); }
      });
      const getPostTags = (pid: string): string[] => {
        const i = tagPostIds.indexOf(pid); return i >= 0 ? tagPostTags[i] : [];
      };
      const localItems = (posts ?? []).map((p: any) => ({
        type: 'post' as const,
        data: { ...p, _hashtag_tags: getPostTags(p.id), _source_label: 'Testagram' },
      }));
      const remoteItems = (remoteRows ?? []).map((p: any) => ({
        type: 'fedpost' as const,
        data: {
          ...p,
          id: p.id ?? p.uri,
          uri: p.uri,
          user_id: p.actor_uri,
          author_id: p.actor_uri,
          created_at: p.published_at ?? p.updated_at,
          content: p.content ?? p.summary ?? '',
          remote_status_uri: p.uri,
          user_profiles: p.remote_account ?? { actor_uri: p.actor_uri, username: 'unknown', display_name: 'Fediverse account', avatar_url: null },
          is_federated: true,
          _source_label: 'Fediverse',
          _hashtag_tags: tagNames.filter((tag: string) => String(p.content ?? '').toLowerCase().includes('#' + tag)),
        },
      }));
      setHashtagFeedItems([...localItems, ...remoteItems].sort((a: any, b: any) =>
        new Date(b.data.created_at ?? b.data.published_at ?? 0).getTime() - new Date(a.data.created_at ?? a.data.published_at ?? 0).getTime()
      ));
    } catch (err) {
      console.warn('[hashtagFeed]', err);
    } finally {
      setHashtagFeedLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    if (activeTab === 'hashtags') { fetchHashtagFeed(); return; }
    fetchInitialFeed();
    fetchSponsoredContent();
    fetchRecommendations();
    fetchProductSpotlight();
    fetchPublicSeries();
    fetchUserAds();
  }, [activeTab, user?.id]);

  // ── Realtime new-post subscription (For You tab only) ─────────────────────
  useEffect(() => {
    // Only subscribe on the foryou tab; clean up on tab switch or unmount
    if (activeTab !== 'foryou') {
      if (realtimeChannelRef.current) {
        supabase.removeChannel(realtimeChannelRef.current);
        realtimeChannelRef.current = null;
      }
      return;
    }
    const ch = supabase
      .channel('feed-new-posts-banner')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'posts' },
        (payload: any) => {
          const newPost = payload.new;
          // Ignore own posts and community-only posts
          if (newPost?.community_id) return;
          if (user && newPost?.user_id === user.id) return;
          setHasNewPosts(true);
          setNewPostCount(prev => prev + 1);
        }
      )
      .subscribe();
    realtimeChannelRef.current = ch;
    return () => {
      supabase.removeChannel(ch);
      realtimeChannelRef.current = null;
    };
  }, [activeTab, user?.id]);

  // Trending hashtags — refresh every 2 minutes
  useEffect(() => {
    const load = async () => {
      const { data } = await supabase
        .from('trending_hashtags')
        .select('trend_score, hashtags(tag, usage_count)')
        .order('trend_score', { ascending: false })
        .limit(12);
      if (data) setTrendingHashtags(data.filter((r: any) => r.hashtags).map((r: any) => r.hashtags));
    };
    load();
    const t = setInterval(load, 120_000);
    return () => clearInterval(t);
  }, []);

  const handleRefresh = async () => {
    setRefreshing(true);
    setHasNewPosts(false);
    setNewPostCount(0);
    await Promise.all([fetchRecommendations(), fetchProductSpotlight()]);
    await fetchInitialFeed();
    setRefreshing(false);
  };

  const loadMoreFeed = async (): Promise<boolean> => {
    if (!feedHasMore) return false;
    const nextPage = page + 1;
    if (activeTab === 'federated') {
      const fedPage = await fetchFederatedPage(federatedCursor);
      const incoming = fedPage.posts.map((post: any) => ({ type: 'fedpost' as const, data: post }));
      if (incoming.length > 0) setFeedItems(prev => { const ids = new Set(prev.filter(i => i.type === 'fedpost').map(i => (i.data as any).id)); return [...prev, ...incoming.filter(i => !ids.has((i.data as any).id))]; });
      setFederatedCursor(fedPage.nextCursor); setFederatedHasMore(fedPage.hasMore); setFeedHasMore(fedPage.hasMore); setPage(nextPage); return fedPage.hasMore;
    }
    if (activeTab === 'foryou') {
      const [localItems, federatedPage] = await Promise.all([fetchFeed(nextPage), fetchFederatedPage(federatedCursor)]);
      const mixed = mixHomeDiscovery(localItems, federatedPage.posts, nextPage);
      const incomingLocalPosts = localItems.filter((i: any) => i.type === 'post');
      const incomingFedPosts = mixed.filter((i: any) => i.type === 'fedpost');
      if (mixed.length > 0) setFeedItems(prev => {
        const localIds = new Set(prev.filter(i => i.type === 'post').map(i => (i.data as any).id));
        const fedIds = new Set(prev.filter(i => i.type === 'fedpost').map(i => (i.data as any).id));
        return [...prev, ...mixed.filter(i => i.type === 'post' ? !localIds.has((i.data as any).id) : i.type === 'fedpost' ? !fedIds.has((i.data as any).id) : true)];
      });
      if (incomingLocalPosts.length > 0) setFeedCursor((incomingLocalPosts.slice(-1)[0].data as any).created_at ?? null);
      setFederatedCursor(federatedPage.nextCursor); setFederatedHasMore(federatedPage.hasMore);
      const hasMore = incomingLocalPosts.length >= PAGE_SIZE || federatedPage.hasMore || incomingFedPosts.length > 0;
      setPage(nextPage); setFeedHasMore(hasMore); return hasMore;
    }
    const newItems = await fetchFeed(nextPage);
    const newPosts = newItems.filter((i: any) => i.type === 'post');
    if (newPosts.length > 0) {
      setFeedItems(prev => { const ids = new Set(prev.filter((i: any) => i.type === 'post').map((i: any) => (i.data as any).id)); return [...prev, ...newItems.filter((i: any) => i.type !== 'post' || !ids.has((i.data as any).id))]; });
      setPage(nextPage); setFeedCursor((newPosts.slice(-1)[0].data as any).created_at ?? null);
      const hasMore = newPosts.length >= PAGE_SIZE; setFeedHasMore(hasMore); return hasMore;
    }
    setFeedHasMore(false); return false;
  };


  const { lastElementRef, loading: loadingMore } = useInfiniteScroll(loadMoreFeed);

  return (
    <div className="min-h-screen bg-background pb-16 lg:pb-0">
      <TopBar title="Home" />
      <div className="px-3 py-2 border-b border-border bg-background/95">
        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => navigate('/shop')} className="flex items-center justify-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-xs font-bold hover:bg-muted transition-colors">
            <ShoppingBag className="w-4 h-4 text-primary" /> Shopping Mall
          </button>
          <button onClick={() => navigate('/polls')} className="flex items-center justify-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-xs font-bold hover:bg-muted transition-colors">
            <BarChart3 className="w-4 h-4 text-primary" /> Community Polls
          </button>
        </div>
      </div>

      {/* Bluesky-style Tabs */}
      <div className="sticky top-14 z-30 bg-background/95 backdrop-blur-sm border-b border-border">
        <div className="flex overflow-x-auto scrollbar-hide">
          {TABS.map(tab => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                onMouseEnter={() => handleTabHover(tab.id)}
                onMouseLeave={handleTabHoverEnd}
                className={`flex-1 min-w-[90px] py-3.5 font-semibold transition-colors border-b-2 text-sm flex items-center justify-center gap-1.5 whitespace-nowrap ${
                  active
                    ? 'border-primary text-foreground'
                    : 'border-transparent text-muted-foreground hover:bg-muted/40'
                }`}
              >
                <Icon className={`w-3.5 h-3.5 ${active ? 'text-primary' : ''}`} />
                {tab.label}
              </button>
            );
          })}
        </div>
        {/* Feed Diversity Slider button — For You tab only */}
        {activeTab === 'foryou' && (
          <div className="absolute right-2 top-1/2 -translate-y-1/2">
            <button
              onClick={() => setShowDiversityPanel(p => !p)}
              className={`flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold transition-colors border ${
                sliderRefreshing ? 'bg-primary/10 border-primary/60 text-primary animate-pulse' :
                showDiversityPanel
                  ? 'bg-primary/10 border-primary/30 text-primary'
                  : 'border-border text-muted-foreground hover:text-primary hover:border-primary/30'
              }`}
              title="Tune your feed"
            >
              <SlidersHorizontal className={`w-3.5 h-3.5 ${sliderRefreshing ? 'animate-spin' : ''}`} />
              {sliderRefreshing ? <span className="hidden sm:inline">Applying…</span> : <span className="hidden sm:inline">Tune</span>}
            </button>
          </div>
        )}
      </div>

      {/* ── Feed Diversity Panel ── */}
      {showDiversityPanel && activeTab === 'foryou' && (
        <div className="border-b border-border bg-muted/10 px-4 py-4 space-y-4 animate-in slide-in-from-top duration-200">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2">
              <SlidersHorizontal className="w-4 h-4 text-primary" />
              <span className="font-bold text-sm">Tune Your Feed</span>
            </div>
            <button onClick={() => setShowDiversityPanel(false)} className="p-1 rounded-full hover:bg-muted text-muted-foreground">
              <XIcon className="w-4 h-4" />
            </button>
          </div>
          {/* Discovery vs Following mix */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-semibold text-foreground">Discovery Mix</span>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>Following</span>
                <span className="font-bold text-primary">{discoverMix}%</span>
                <span>Explore</span>
              </div>
            </div>
            <input type="range" min={0} max={100} step={5}
              value={discoverMix}
              onChange={e => setDiscoverMix(Number(e.target.value))}
              className="w-full h-2 rounded-full appearance-none bg-muted accent-primary cursor-pointer" />
            <p className="text-[10px] text-muted-foreground mt-1">
              {discoverMix < 20 ? 'Mostly people you follow' : discoverMix > 70 ? 'Heavy discovery mode' : 'Balanced mix'}
            </p>
          </div>
          {/* Video weight */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-semibold text-foreground">Video Preference</span>
              <span className="text-xs font-bold text-primary">{videoWeight}%</span>
            </div>
            <input type="range" min={0} max={100} step={10}
              value={videoWeight}
              onChange={e => setVideoWeight(Number(e.target.value))}
              className="w-full h-2 rounded-full appearance-none bg-muted accent-primary cursor-pointer" />
            <p className="text-[10px] text-muted-foreground mt-1">
              {videoWeight < 30 ? 'Prefer text posts' : videoWeight > 70 ? 'Video-first feed' : 'Mixed media'}
            </p>
          </div>
          {/* Min engagement */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-semibold text-foreground">Minimum Engagement</span>
              <span className="text-xs font-bold text-primary">{minEngagement > 0 ? `Top ${100 - minEngagement}%` : 'All posts'}</span>
            </div>
            <input type="range" min={0} max={80} step={10}
              value={minEngagement}
              onChange={e => setMinEngagement(Number(e.target.value))}
              className="w-full h-2 rounded-full appearance-none bg-muted accent-primary cursor-pointer" />
            <p className="text-[10px] text-muted-foreground mt-1">
              {minEngagement === 0 ? 'Show all posts including new ones' : `Only posts with meaningful engagement`}
            </p>
          </div>
          <button
            onClick={() => { setDiscoverMix(30); setVideoWeight(50); setMinEngagement(0); }}
            className="text-xs text-muted-foreground hover:text-primary transition-colors underline-offset-2 hover:underline"
          >
            Reset to defaults
          </button>
        </div>
      )}

      {/* ── Real-time New Posts Banner ── */}
      {hasNewPosts && activeTab === 'foryou' && !loading && (
        <div className="sticky top-[112px] z-40 flex justify-center pointer-events-none">
          <button
            onClick={() => { setHasNewPosts(false); setNewPostCount(0); handleRefresh(); }}
            className="pointer-events-auto flex items-center gap-2 px-4 py-2.5 bg-primary text-primary-foreground rounded-full shadow-lg shadow-primary/30 text-sm font-bold hover:opacity-90 active:scale-95 transition-all animate-in slide-in-from-top duration-300"
          >
            <Sparkles className="w-4 h-4" />
            {newPostCount > 0 ? `${newPostCount} new post${newPostCount !== 1 ? 's' : ''} — tap to refresh` : 'New posts available — tap to refresh'}
          </button>
        </div>
      )}

      {/* Stories — only visible on the For You tab */}
      {activeTab === 'foryou' && <StoriesStrip />}

      {/* ── Trending Now Rail ── shows top 5 posts from last 24h */}
      {activeTab === 'foryou' && trendingNowPosts.length > 0 && (
        <div className="border-b border-border py-3 bg-gradient-to-r from-orange-500/5 to-background">
          <div className="px-4 flex items-center justify-between mb-2.5">
            <div className="flex items-center gap-1.5">
              <Flame className="w-3.5 h-3.5 text-orange-500" />
              <span className="text-xs font-bold text-foreground">Trending Now</span>
              <span className="text-[10px] text-muted-foreground">· last 24h</span>
            </div>
            <button onClick={() => navigate('/explore')} className="text-xs text-primary font-semibold hover:underline">Explore →</button>
          </div>
          <div className="flex gap-2.5 overflow-x-auto scrollbar-hide px-4 pb-1">
            {trendingNowPosts.map((post: any, idx: number) => {
              const thumb = post.image_url ?? null;
              const isVid = !!(post.is_video || post.video_url);
              const uname = post.user_profiles?.username ?? '';
              // esbuild guard: use module-level array for rank colors (no array literal inside .map())
              const rankColor = TRENDING_NOW_RANK_COLORS[idx] ?? 'text-white/70';
              return (
                <button
                  key={post.id}
                  onClick={() => navigate(`/post/${post.id}`)}
                  className="shrink-0 w-32 rounded-2xl overflow-hidden bg-zinc-900 relative hover:scale-[1.04] active:scale-[0.97] transition-transform focus:outline-none"
                  style={{ height: 160 }}
                >
                  {thumb
                    ? <img src={thumb} alt="" className="absolute inset-0 w-full h-full object-cover" loading="lazy" />
                    : isVid && post.video_url
                      ? <video src={`${post.video_url}#t=0.5`} className="absolute inset-0 w-full h-full object-cover" muted preload="metadata" />
                      : <div className="absolute inset-0 bg-gradient-to-br from-primary/20 to-purple-500/20" />}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-transparent to-black/10" />
                  {/* Rank badge */}
                  <div className="absolute top-2 left-2 w-5 h-5 rounded-full bg-black/60 backdrop-blur-sm flex items-center justify-center">
                    <span className={`text-[9px] font-black ${rankColor}`}>#{idx+1}</span>
                  </div>
                  {isVid && (
                    <div className="absolute top-2 right-2 w-5 h-5 rounded-full bg-black/50 flex items-center justify-center">
                      <Play className="w-2.5 h-2.5 text-white fill-white" />
                    </div>
                  )}
                  {post.user_profiles?.verified && (
                    <div className="absolute top-2 right-2">
                      <BadgeCheck className="w-3 h-3 text-primary" fill="currentColor" />
                    </div>
                  )}
                  <div className="absolute bottom-0 left-0 right-0 p-2">
                    <span className="text-white/70 text-[9px] font-semibold truncate block">@{uname}</span>
                    <p className="text-white text-[10px] font-medium line-clamp-2 leading-tight mt-0.5">{(post.content ?? '').slice(0, 45)}</p>
                    <div className="flex items-center gap-1.5 mt-1">
                      <span className="flex items-center gap-0.5 text-white/60 text-[9px]"><Eye className="w-2 h-2" />{formatNumber(post.views_count ?? 0)}</span>
                      <span className="flex items-center gap-0.5 text-white/60 text-[9px]"><Star className="w-2 h-2" />{formatNumber(post.likes_count ?? 0)}</span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Hashtag Feed ── */}
      {activeTab === 'hashtags' && (
        <div className="min-h-[60vh]">
          {hashtagFeedLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
          ) : !user ? (
            <div className="text-center py-16 text-muted-foreground px-6">
              <Hash className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p className="font-semibold">Sign in to see your hashtag feed</p>
              <button onClick={() => navigate('/auth')} className="mt-4 px-4 py-2 bg-primary text-primary-foreground rounded-full text-sm font-medium">Sign in</button>
            </div>
          ) : hashtagFeedItems.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground px-6">
              <Hash className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p className="font-semibold mb-1">No hashtag posts yet</p>
              <p className="text-sm mb-4">Follow hashtags from the Explore or trending section to populate this feed</p>
              <button onClick={() => navigate('/explore')} className="px-4 py-2 bg-primary text-primary-foreground rounded-full text-sm font-medium">Explore Hashtags</button>
            </div>
          ) : (
            hashtagFeedItems.map((item, idx) => (
              <div key={`ht-${(item.data as any)?.id ?? idx}`}>
                <div className="px-4 pt-2">
                  <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold ${(item.data as any)?._source_label === 'Fediverse' ? 'border-sky-500/20 bg-sky-500/5 text-sky-600 dark:text-sky-400' : 'border-primary/20 bg-primary/5 text-primary'}`}>
                    {(item.data as any)?._source_label ?? 'Testagram'}
                  </span>
                </div>
                {/* Tag badges above card */}
                {(item.data as any)?._hashtag_tags?.length > 0 && (
                  <div className="flex items-center gap-1.5 px-4 pt-2 pb-0 flex-wrap">
                    {((item.data as any)._hashtag_tags as string[]).slice(0, 3).map((tag: string) => (
                      <button key={tag} onClick={() => navigate(`/hashtag/${tag}`)}
                        className="flex items-center gap-1 px-2 py-0.5 bg-primary/8 border border-primary/15 rounded-full text-[10px] font-bold text-primary hover:bg-primary/15 transition-colors">
                        <Hash className="w-2.5 h-2.5" />#{tag}
                      </button>
                    ))}
                  </div>
                )}
                <PostCard post={item.data as any} onUpdate={fetchHashtagFeed} />
                {(idx + 1) % 5 === 0 && <FeedAdCard />}
              </div>
            ))
          )}
        </div>
      )}

      {/* Trending Videos Rail */}
      {activeTab === 'foryou' && <TrendingVideosSection variant="compact" />}

      {/* Community Spotlight Strip */}
      {activeTab === 'foryou' && <CommunitySpotlightStrip />}

      <ComposePost onSuccess={fetchInitialFeed} />

      {/* Trending Hashtags Chips */}
      {trendingHashtags.length > 0 && (
        <div className="border-b border-border py-2.5 px-4 bg-muted/20">
          <div className="flex items-center gap-2 mb-2">
            <Flame className="w-3.5 h-3.5 text-orange-500" />
            <span className="text-xs font-bold text-muted-foreground uppercase tracking-wide">Trending</span>
          </div>
          <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-0.5">
            {trendingHashtags.map((ht: any) => (
              <button
                key={ht.tag}
                onClick={() => navigate(`/hashtag/${ht.tag}`)}
                className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 bg-primary/8 hover:bg-primary/15 border border-primary/15 rounded-full text-xs font-semibold text-primary transition-colors whitespace-nowrap"
              >
                <Hash className="w-3 h-3" />#{ht.tag}
                {ht.usage_count > 0 && (
                  <span className="text-primary/50 font-normal">{ht.usage_count > 999 ? `${(ht.usage_count/1000).toFixed(1)}k` : ht.usage_count}</span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Top ad */}
      <DynamicAd location="feed_top" className="border-b border-border p-4" />

      {/* Refresh */}
      {!loading && (
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="w-full flex items-center justify-center gap-2 py-2 text-xs text-muted-foreground hover:bg-muted/30 transition-colors border-b border-border"
        >
          <RefreshCw className={`w-3 h-3 ${refreshing ? 'animate-spin' : ''}`} />
          {refreshing ? 'Refreshing…' : 'Refresh feed'}
        </button>
      )}

      {/* Feed content */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      ) : feedItems.length === 0 ? (
        <EmptyState tab={activeTab} navigate={navigate} />
      ) : (
        <>
          {/* ── Featured 2-col mosaic grid — first 2 image/video posts on For You ── */}
          {/* esbuild guard: pre-computed, no IIFE */}
          {activeTab === 'foryou' && feedItems.filter(i => i.type === 'post' && ((i.data as any)?.image_url || ((i.data as any)?.media_urls?.length > 0) || (i.data as any)?.is_video)).slice(0, 2).length >= 2 && (
            <div className="grid grid-cols-2 gap-1.5 p-1.5 border-b border-border bg-muted/10">
              {feedItems
                .filter(i => i.type === 'post' && ((i.data as any)?.image_url || ((i.data as any)?.media_urls?.length > 0) || (i.data as any)?.is_video))
                .slice(0, 2)
                .map(item => {
                  const p = item.data as any;
                  const thumb = p.image_url || (p.media_urls?.[0]) || null;
                  return (
                    <button
                      key={p.id}
                      onClick={() => navigate(`/post/${p.id}`)}
                      className="relative rounded-xl overflow-hidden bg-muted text-left hover:scale-[1.02] active:scale-[0.98] transition-transform focus:outline-none"
                      style={{ height: 160 }}
                    >
                      {thumb ? (
                        <img src={thumb} alt="" className="w-full h-full object-cover" loading="lazy" />
                      ) : p.is_video && p.video_url ? (
                        <div className="w-full h-full bg-black flex items-center justify-center">
                          <video src={`${p.video_url}#t=0.5`} className="w-full h-full object-cover" muted preload="metadata" />
                        </div>
                      ) : null}
                      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />
                      {p.is_video && (
                        <div className="absolute top-2 right-2 w-7 h-7 bg-black/40 backdrop-blur-sm rounded-full flex items-center justify-center">
                          <Play className="w-3.5 h-3.5 text-white fill-white ml-0.5" />
                        </div>
                      )}
                      <div className="absolute bottom-2 left-2 right-2">
                        <p className="text-[10px] text-white/70 truncate">@{p.user_profiles?.username}</p>
                        <p className="text-white text-xs font-semibold line-clamp-1 mt-0.5">
                          {p.content?.replace(/<[^>]*>/g, '').slice(0, 60)}
                        </p>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="flex items-center gap-0.5 text-white/60 text-[9px]"><Heart className="w-2.5 h-2.5" />{p.likes_count || 0}</span>
                          <span className="flex items-center gap-0.5 text-white/60 text-[9px]"><Eye className="w-2.5 h-2.5" />{p.views_count || 0}</span>
                        </div>
                      </div>
                    </button>
                  );
                })}
            </div>
          )}

          {feedItems.map((item, index) => (
            <div
              key={`${item.type}-${item.type === 'user-suggestions' ? 'sug' : item.type === 'product-spotlight' ? 'products' : item.type === 'series-widget' ? 'series' : (item.data as any)?.id ?? index}-${index}`}
              ref={index === feedItems.length - 1 ? lastElementRef : null}
              className="animate-slide-in"
            >
              {item.type === 'post' ? (
                <PostCard post={item.data} onUpdate={fetchInitialFeed} />
              ) : item.type === 'fedpost' ? (
                <PostCard post={item.data} onUpdate={fetchInitialFeed} />
              ) : item.type === 'sponsored' ? (
                <SponsoredPostCard post={item.data} />
              ) : item.type === 'user-ad' ? (
                <UserAdCard ad={item.data} />
              ) : item.type === 'user-suggestions' ? (
                <InlineSuggestions />
              ) : item.type === 'recommended' ? (
                <RecommendedPostCard post={item.data} onNavigate={(p: string) => navigate(p)} />
              ) : item.type === 'product-spotlight' ? (
                <ProductSpotlightRail products={item.data} onNavigate={(p: string) => navigate(p)} />
              ) : item.type === 'series-widget' ? (
                <SeriesDiscoveryWidget series={item.data} onNavigate={(p: string) => navigate(p)} />
              ) : (
                <ThreadCard thread={item.data} />
              )}

              {/* AdSense every 5th post-type item — esbuild guard: counter pre-computed outside IIFE */}
              {item.type === 'post' && feedItems.slice(0, index + 1).filter(i => i.type === 'post').length % 5 === 0 && feedItems.slice(0, index + 1).filter(i => i.type === 'post').length > 0 && <FeedAdCard />}
              {(index + 1) % 6 === 0 && index !== feedItems.length - 1 && (
                <NativeAdCard className="mx-0 rounded-none border-x-0 border-b border-border" />
              )}
              {(index + 1) % 8 === 0 && (
                <DynamicAd location="feed_inline" className="border-b border-border px-4 py-3" />
              )}
            </div>
          ))}

          {loadingMore && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-primary" />
            </div>
          )}
          {!loadingMore && !feedHasMore && feedItems.length > 0 && activeTab !== 'federated' && (
            <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
              <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center mb-3">
                <Sparkles className="w-5 h-5 text-primary" />
              </div>
              <p className="text-sm font-semibold">You’re all caught up!</p>
              <p className="text-xs mt-1">Check back later for new posts</p>
              <button
                onClick={handleRefresh}
                className="mt-3 flex items-center gap-1.5 px-4 py-2 border border-border rounded-full text-xs font-semibold hover:bg-muted transition-colors"
              >
                <RefreshCw className="w-3.5 h-3.5" />Refresh
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Empty State ───────────────────────────────────────────────────────────────
function EmptyState({ tab, navigate }: { tab: Tab; navigate: (p: string) => void }) {
  if (tab === 'federated') {
    return (
      <div className="text-center py-16 text-muted-foreground px-6">
        <Globe className="w-12 h-12 mx-auto mb-3 opacity-30" />
        <p className="text-lg font-semibold mb-1">No federated posts yet</p>
        <p className="text-sm mb-4">The gateway is connected — follow people on Mastodon to populate this feed</p>
        <button
          onClick={() => navigate('/fediverse')}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-full text-sm font-medium"
        >
          Open Fediverse
        </button>
      </div>
    );
  }
  if (tab === 'following') {
    return (
      <div className="text-center py-16 text-muted-foreground">
        <Users className="w-12 h-12 mx-auto mb-3 opacity-30" />
        <p className="text-lg font-semibold mb-1">Nothing here yet</p>
        <p className="text-sm">Follow users to see their posts</p>
      </div>
    );
  }
  if (tab === 'tech' || tab === 'science') {
    return (
      <div className="text-center py-16 text-muted-foreground px-6">
        <Hash className="w-12 h-12 mx-auto mb-3 opacity-30" />
        <p className="text-lg font-semibold mb-1">No {tab === 'tech' ? 'tech' : 'science'} posts yet</p>
        <p className="text-sm">Posts with #{tab}-related hashtags will appear here</p>
      </div>
    );
  }
  return (
    <div className="text-center py-16 text-muted-foreground">
      <Rss className="w-12 h-12 mx-auto mb-3 opacity-30" />
      <p className="text-lg font-semibold mb-1">No posts yet</p>
      <p className="text-sm">Be the first to post!</p>
    </div>
  );
}

// ── Recommended Post Card ─────────────────────────────────────────────────────
function RecommendedPostCard({ post, onNavigate }: { post: any; onNavigate: (p: string) => void }) {
  if (!post?.id) return null;
  return (
    <div className="border-b border-border bg-primary/[0.02]">
      <div className="px-4 pt-2.5 pb-0 flex items-center gap-1.5">
        <Sparkles className="w-3 h-3 text-primary" />
        <span className="text-[11px] font-bold text-primary uppercase tracking-wide">Recommended for you</span>
        {post._reason && (
          <span className="text-[10px] text-muted-foreground">· {post._reason}</span>
        )}
      </div>
      <PostCard post={post} onUpdate={() => {}} />
    </div>
  );
}

// ── Product Spotlight Rail ────────────────────────────────────────────────────
function ProductSpotlightRail({ products, onNavigate }: { products: any[]; onNavigate: (p: string) => void }) {
  if (!products || products.length === 0) return null;
  return (
    <div className="border-b border-border py-3">
      <div className="px-4 flex items-center justify-between mb-2.5">
        <div className="flex items-center gap-1.5">
          <ShoppingBag className="w-3.5 h-3.5 text-primary" />
          <span className="text-xs font-bold text-foreground">From creators you follow</span>
        </div>
        <button
          onClick={() => onNavigate('/products')}
          className="text-xs text-primary font-semibold hover:underline"
        >
          See all
        </button>
      </div>
      <div className="flex gap-3 overflow-x-auto scrollbar-hide px-4 pb-1">
        {products.map((p: any) => (
          <div key={p.id} className="shrink-0 w-36 rounded-xl border border-border bg-card overflow-hidden hover:shadow-md transition-shadow">
            <div className="w-full h-24 bg-muted overflow-hidden">
              {p.image_url
                ? <img src={p.image_url} alt={p.name} className="w-full h-full object-cover" loading="lazy" />
                : <div className="w-full h-full flex items-center justify-center"><ShoppingBag className="w-8 h-8 text-muted-foreground" /></div>
              }
            </div>
            <div className="p-2">
              <p className="text-xs font-semibold line-clamp-1">{p.name}</p>
              <p className="text-sm font-black text-primary">${Number(p.price).toFixed(2)}</p>
              <div className="flex items-center gap-1 mt-1">
                {p.user_profiles?.avatar_url
                  ? <img src={p.user_profiles.avatar_url} alt="" className="w-3.5 h-3.5 rounded-full" />
                  : <div className="w-3.5 h-3.5 rounded-full bg-muted" />
                }
                <span className="text-[10px] text-muted-foreground truncate">{p.user_profiles?.username}</span>
              </div>
              {p.external_link && (
                <a
                  href={p.external_link} target="_blank" rel="noopener noreferrer"
                  className="mt-1.5 flex items-center justify-center gap-1 w-full py-1 bg-primary text-primary-foreground text-[10px] font-bold rounded-lg hover:opacity-90 transition-opacity"
                >
                  Buy
                </a>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Federated Post Card ───────────────────────────────────────────────────────
function FederatedPostCard({ post }: { post: any }) {
  // This card is rendered outside HomePage, so it must own its router hook.
  // Without this, author clicks throw at runtime because `navigate` is undefined.
  const navigate = useNavigate();
  const actor = post.actor ?? post.account ?? {};
  const username =
    actor.preferredUsername ?? actor.username ?? actor.acct ?? 'unknown';
  const domain = actor.url ? extractHostname(actor.url) : (actor.domain ?? '');
  const avatarUrl = actor.icon?.url ?? actor.avatar ?? actor.avatar_url;
  const displayName = actor.name ?? actor.display_name ?? username;
  const createdAt = post.created_at ?? post.published ?? '';

  const [translation, setTranslation] = useState<string | null>(null);
  const [translating, setTranslating] = useState(false);
  const [showTranslation, setShowTranslation] = useState(false);

  const handleTranslate = async () => {
    if (translation) { setShowTranslation(prev => !prev); return; }
    const rawText = (post.content ?? post.text ?? '').replace(/<[^>]*>/g, '').trim();
    if (!rawText) return;
    setTranslating(true);
    try {
      const { data, error } = await supabase.functions.invoke('ai-chat', {
        body: {
          messages: [{ role: 'user', content: `Translate the following text to English. Return only the translation, nothing else:\n\n${rawText}` }],
          model: 'gemini-2.0-flash',
        },
      });
      if (error) throw error;
      const result = data?.choices?.[0]?.message?.content ?? data?.content ?? data?.text ?? data?.response ?? '';
      setTranslation(result.trim());
      setShowTranslation(true);
    } catch (err) {
      setTranslation('Translation failed. Please try again.');
      setShowTranslation(true);
    } finally {
      setTranslating(false);
    }
  };

  const openProfile = () => {
    const actorUri = post.actor_uri ?? actor.actor_uri ?? actor.uri ?? actor.id ?? '';
    const acct = String(actor.acct ?? actor.preferredUsername ?? actor.username ?? username ?? '').replace(/^@/, '');
    const profileHandle = acct.includes('@') ? acct : (acct && domain ? `${acct}@${domain}` : acct);
    const query = new URLSearchParams();
    if (actorUri) query.set('actor', actorUri);
    if (profileHandle) query.set('handle', profileHandle);
    navigate(`/fediverse/profile?${query.toString()}`);
  };

  return (
    <div className="border-b border-border p-4 hover:bg-muted/5 transition-colors">
      <div className="flex gap-3">
        <button type="button" onClick={openProfile} className="w-10 h-10 rounded-full bg-muted overflow-hidden flex-shrink-0 cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary" aria-label={`Open ${displayName} profile`}>
          {avatarUrl ? <img src={avatarUrl} alt={username} className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center font-bold text-sm">{username[0]?.toUpperCase()}</div>}
        </button>
        <div className="flex-1 min-w-0">
          <button type="button" onClick={openProfile} className="text-left flex items-center gap-2 mb-0.5 flex-wrap cursor-pointer hover:underline">
            <span className="font-semibold text-sm">{displayName}</span>
            <span className="flex items-center gap-1 text-xs text-purple-500"><Globe className="w-3 h-3" />{domain}</span>
            {createdAt && <span className="text-muted-foreground text-xs">· {formatDistanceToNow(new Date(createdAt), { addSuffix: true })}</span>}
          </button>
          <button type="button" onClick={openProfile} className="text-xs text-muted-foreground mb-1.5 hover:underline cursor-pointer">@{username}{domain ? `@${domain}` : ''}</button>
          <div className="text-sm leading-relaxed" dangerouslySetInnerHTML={{ __html: post.content ?? post.text ?? '' }} />
          {showTranslation && translation && <div className="mt-2 p-3 bg-blue-500/5 border border-blue-500/15 rounded-xl"><p className="text-xs font-semibold text-blue-500 mb-1 flex items-center gap-1"><Languages className="w-3 h-3" /> Translated to English</p><p className="text-sm leading-relaxed text-foreground">{translation}</p></div>}
          {Array.isArray(post.media_attachments) && post.media_attachments.length > 0 && <div className="mt-2 grid grid-cols-2 gap-1 rounded-xl overflow-hidden">{post.media_attachments.slice(0, 4).map((m: any, i: number) => m.type === 'image' ? <img key={i} src={m.url ?? m.preview_url} alt={m.description ?? ''} className="w-full h-32 object-cover" loading="lazy" /> : null)}</div>}
          <div className="flex items-center gap-4 mt-2.5 text-muted-foreground text-xs">
            <span className="flex items-center gap-1"><MessageCircle className="w-3.5 h-3.5" />{formatNumber(post.replies_count ?? 0)}</span>
            <span className="flex items-center gap-1"><Repeat2 className="w-3.5 h-3.5" />{formatNumber(post.reblogs_count ?? post.boosts_count ?? 0)}</span>
            <span className="flex items-center gap-1"><Heart className="w-3.5 h-3.5" />{formatNumber(post.favourites_count ?? post.likes_count ?? 0)}</span>
            <button onClick={e => { e.stopPropagation(); handleTranslate(); }} disabled={translating} className="ml-auto flex items-center gap-1 text-xs text-blue-500 hover:text-blue-700 transition-colors disabled:opacity-50">
              {translating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : showTranslation ? <ChevronUp className="w-3.5 h-3.5" /> : <Languages className="w-3.5 h-3.5" />}
              {translating ? 'Translating…' : showTranslation ? 'Hide' : 'Translate'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Inline Suggestions ────────────────────────────────────────────────────────
function InlineSuggestions() {
  const [suggestions, setSuggestions] = useState<any[]>([]);
  // following ids — plain array (esbuild guard: no Set<string> state)
  const [followingIds, setFollowingIds] = useState<string[]>([]);
  const { user } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data: followData } = await supabase
        .from('follows')
        .select('following_id')
        .eq('follower_id', user.id);

      const followed = followData?.map((f: any) => f.following_id) ?? [];
      setFollowingIds(followed);

      // Try user_suggestions table first
      const { data: sugData } = await supabase
        .from('user_suggestions')
        .select('suggested_user_id, score, reason, user_profiles!user_suggestions_suggested_user_id_fkey(id, username, avatar_url, follower_count, verified)')
        .eq('user_id', user.id)
        .order('score', { ascending: false })
        .limit(5);

      if (sugData && sugData.length > 0) {
        const sugProfiles = sugData
          .map((s: any) => s.user_profiles)
          .filter((p: any) => p && !followed.includes(p.id));
        if (sugProfiles.length > 0) {
          setSuggestions(sugProfiles.slice(0, 3));
          return;
        }
      }

      // Fallback: popular users not yet followed
      const { data } = await supabase
        .from('profiles')
        .select('id, username, avatar_url, follower_count, verified')
        .neq('id', user.id)
        .order('follower_count', { ascending: false })
        .limit(10);

      if (data) setSuggestions(data.filter((u: any) => !followed.includes(u.id)).slice(0, 3));
    })();
  }, [user]);

  const handleFollow = async (targetId: string) => {
    if (!user) return;
    await supabase.from('follows').insert({ follower_id: user.id, following_id: targetId });
    setFollowingIds(prev => [...prev, targetId]);
  };

  if (suggestions.length === 0) return null;

  return (
    <div className="border-b border-border p-4 bg-muted/20">
      <h3 className="font-bold text-sm mb-3 text-muted-foreground uppercase tracking-wide flex items-center gap-2">
        <Sparkles className="w-3.5 h-3.5 text-primary" />
        Who to follow
      </h3>
      <div className="space-y-3">
        {suggestions.map((sug: any) => (
          <div key={sug.id} className="flex items-center justify-between">
            <button
              onClick={() => navigate(`/profile/${sug.username}`)}
              className="flex items-center gap-2.5 flex-1 min-w-0 text-left"
            >
              <div className="w-9 h-9 rounded-full bg-muted overflow-hidden flex-shrink-0">
                {sug.avatar_url ? (
                  <img src={sug.avatar_url} className="w-full h-full object-cover" alt="" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center font-bold text-sm">
                    {sug.username?.[0]?.toUpperCase()}
                  </div>
                )}
              </div>
              <div className="min-w-0">
                <p className="font-semibold text-sm truncate">{sug.username}</p>
                <p className="text-xs text-muted-foreground">
                  {formatNumber(sug.follower_count ?? 0)} followers
                </p>
              </div>
            </button>
            <button
              onClick={() => handleFollow(sug.id)}
              disabled={followingIds.includes(sug.id)}
              className={`text-xs font-semibold px-3 py-1.5 rounded-full border transition-colors flex-shrink-0 ${
                followingIds.includes(sug.id)
                  ? 'bg-muted text-muted-foreground border-border'
                  : 'border-foreground hover:bg-muted'
              }`}
            >
              {followingIds.includes(sug.id) ? 'Following' : 'Follow'}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Series Discovery Widget ──────────────────────────────────────────────────
function SeriesDiscoveryWidget({ series, onNavigate }: { series: any[]; onNavigate: (p: string) => void }) {
  if (!series || series.length === 0) return null;

  // Load progress from localStorage
  const getProgress = (seriesId: string) => {
    try {
      const raw = localStorage.getItem('series_progress');
      if (!raw) return null;
      const all = JSON.parse(raw);
      return all[seriesId] ?? null;
    } catch { return null; }
  };
  return (
    <div className="border-b border-border py-3 bg-gradient-to-br from-primary/[0.03] to-transparent">
      <div className="px-4 flex items-center justify-between mb-2.5">
        <div className="flex items-center gap-1.5">
          <BookOpen className="w-3.5 h-3.5 text-primary" />
          <span className="text-xs font-bold text-foreground">Trending Series</span>
        </div>
        <button onClick={() => onNavigate('/series')} className="text-xs text-primary font-semibold hover:underline">Browse all</button>
      </div>
      <div className="flex gap-3 overflow-x-auto scrollbar-hide px-4 pb-1">
        {series.slice(0, 6).map((s: any) => (
          <button key={s.id} onClick={() => onNavigate('/series')}
            className="shrink-0 w-40 text-left rounded-xl border border-border bg-card hover:border-primary/30 hover:shadow-sm transition-all overflow-hidden">
            <div className="w-full h-20 bg-gradient-to-br from-primary/20 to-purple-500/10 flex items-center justify-center">
              {s.cover_image
                ? <img src={s.cover_image} alt={s.name} className="w-full h-full object-cover" />
                : <BookOpen className="w-8 h-8 text-primary/40" />}
            </div>
            <div className="p-2.5">
              <p className="text-xs font-bold line-clamp-1">{s.name}</p>
              {/* esbuild guard: progress pre-computed in a map callback variable, no IIFE */}
              {seriesProgressBadge(s.id, getProgress)}
              {s.user_profiles && (
                <div className="flex items-center gap-1 mt-1.5">
                  {s.user_profiles.avatar_url
                    ? <img src={s.user_profiles.avatar_url} alt="" className="w-4 h-4 rounded-full" />
                    : <div className="w-4 h-4 rounded-full bg-muted" />}
                  <span className="text-[10px] text-muted-foreground truncate">@{s.user_profiles.username}</span>
                </div>
              )}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Thread Card ───────────────────────────────────────────────────────────────
function ThreadCard({ thread }: { thread: any }) {
  const navigate = useNavigate();
  return (
    <div
      onClick={() => navigate(`/thread/${thread.id}`)}
      className="border-b border-border p-4 hover:bg-muted/5 cursor-pointer transition-colors"
    >
      <div className="flex gap-3">
        <div className="w-10 h-10 rounded-full bg-muted overflow-hidden flex-shrink-0">
          {thread.user_profiles?.avatar_url ? (
            <img src={thread.user_profiles.avatar_url} alt="" className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center font-bold text-sm">
              {thread.user_profiles?.username?.[0]?.toUpperCase()}
            </div>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="font-semibold text-sm">{thread.user_profiles?.username}</span>
            <span className="text-muted-foreground text-xs">
              · {formatDistanceToNow(new Date(thread.created_at), { addSuffix: true })}
            </span>
          </div>
          <h3 className="font-bold text-base mb-1">{thread.title}</h3>
          <p className="text-sm text-muted-foreground line-clamp-2">{thread.content}</p>
          {thread.cover_image && (
            <div className="mt-2 rounded-xl overflow-hidden border border-border">
              <img src={thread.cover_image} alt={thread.title} className="w-full max-h-48 object-cover" loading="lazy" />
            </div>
          )}
          <div className="flex items-center gap-5 mt-2 text-muted-foreground">
            <span className="flex items-center gap-1.5 text-xs">
              <MessageCircle className="w-3.5 h-3.5" />
              {formatNumber(thread.replies_count ?? 0)}
            </span>
            <span className="flex items-center gap-1.5 text-xs">
              <Repeat2 className="w-3.5 h-3.5" />
              {formatNumber(thread.reposts_count ?? 0)}
            </span>
            <span className="flex items-center gap-1.5 text-xs">
              <Heart className="w-3.5 h-3.5" />
              {formatNumber(thread.likes_count ?? 0)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
