import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { VideoPlayer } from '@/components/features/VideoPlayer';
import { VideoAdSlide } from '@/components/features/VideoAdSlide';
import { supabase } from '@/lib/supabase';
import { Post } from '@/types/app-types';
import { Loader2, Gift, X, Zap, Play, Search, Bookmark, Share, MessageCircle, Eye, Heart, BadgeCheck, Send as SendIcon, Gauge } from 'lucide-react';
import { useSEO } from '@/hooks/useSEO';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { formatDistanceToNow } from 'date-fns';
import { formatNumber } from '@/lib/utils';
import { toast } from 'sonner';

// esbuild-safe module-level constants
// esbuild guard: no 'as const' on module-level arrays used in .map() render
const VIDEO_SPEED_OPTIONS: number[] = [0.5, 0.75, 1, 1.25, 1.5, 2];
const VIDEO_SEARCH_DEBOUNCE_MS = 400;

const PRELOAD_AHEAD = 3;
// PRELOAD_CANCEL_BEHIND: release buffering for videos more than this many slots behind current
const PRELOAD_CANCEL_BEHIND = 2;
const PAGE_SIZE = 20;
// Inject a video ad every AD_INTERVAL videos
const AD_INTERVAL = 5;

type FeedTab = 'foryou' | 'following' | 'watchlater' | 'duets';

// Comment drawer for video feed
function VideoCommentDrawer({ post, onClose }: { post: Post; onClose: () => void }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [replies, setReplies] = useState<any[]>([]);
  const [replyText, setReplyText] = useState('');
  const [loading, setLoading] = useState(true);
  const [posting, setPosting] = useState(false);

  useEffect(() => {
    supabase.from('replies')
      .select('*, profiles(id,username,avatar_url,verified)')
      .eq('post_id', post.id)
      .order('created_at', { ascending: false })
      .limit(50)
      .then(({ data }) => { setReplies(data ?? []); setLoading(false); });
  }, [post.id]);

  const postReply = async () => {
    if (!user) { navigate('/auth'); return; }
    if (!replyText.trim()) return;
    setPosting(true);
    const { error } = await supabase.from('replies').insert({ post_id: post.id, user_id: user.id, content: replyText.trim() });
    if (!error) {
      setReplies(prev => [{ id: Date.now().toString(), content: replyText.trim(), created_at: new Date().toISOString(), user_profiles: { username: user.username, avatar_url: user.avatar, verified: false } }, ...prev]);
      setReplyText('');
      toast.success('Comment posted!');
    }
    setPosting(false);
  };

  return (
    <div className="fixed inset-0 z-[200] flex flex-col justify-end" onClick={onClose}>
      <div className="bg-background rounded-t-3xl border-t border-border max-h-[70vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <div>
            <h3 className="font-bold text-base">{formatNumber(post.replies_count ?? 0)} Comments</h3>
            <p className="text-xs text-muted-foreground line-clamp-1">{post.content?.slice(0, 60)}</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-full hover:bg-muted transition-colors"><X className="w-5 h-5" /></button>
        </div>
        <div className="flex-1 overflow-y-auto divide-y divide-border">
          {loading ? (
            <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
          ) : replies.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground">
              <MessageCircle className="w-10 h-10 mx-auto mb-2 opacity-30" />
              <p className="text-sm">No comments yet. Be the first!</p>
            </div>
          ) : (
            replies.map(r => (
              <div key={r.id} className="flex gap-3 px-4 py-3">
                <div className="w-9 h-9 rounded-full bg-muted overflow-hidden shrink-0">
                  {r.user_profiles?.avatar_url
                    ? <img src={r.user_profiles.avatar_url} alt="" className="w-full h-full object-cover" />
                    : <div className="w-full h-full flex items-center justify-center text-xs font-bold">{r.user_profiles?.username?.[0]?.toUpperCase()}</div>}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span className="font-semibold text-sm">{r.user_profiles?.username}</span>
                    {r.user_profiles?.verified && <BadgeCheck className="w-3.5 h-3.5 text-primary" fill="currentColor" />}
                    <span className="text-[10px] text-muted-foreground">{formatDistanceToNow(new Date(r.created_at), { addSuffix: true })}</span>
                  </div>
                  <p className="text-sm leading-relaxed break-words">{r.content}</p>
                </div>
              </div>
            ))
          )}
        </div>
        {user ? (
          <div className="px-4 py-3 border-t border-border flex items-center gap-3 shrink-0">
            <div className="w-8 h-8 rounded-full bg-muted overflow-hidden shrink-0">
              {user.avatar ? <img src={user.avatar} alt="" className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-xs font-bold">{user.username?.[0]?.toUpperCase()}</div>}
            </div>
            <input type="text" value={replyText} onChange={e => setReplyText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); postReply(); } }}
              placeholder="Add a comment…" maxLength={280}
              className="flex-1 bg-muted/50 border border-border rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/30" />
            <button onClick={postReply} disabled={!replyText.trim() || posting}
              className="text-primary disabled:opacity-30 transition-opacity">
              {posting ? <Loader2 className="w-5 h-5 animate-spin" /> : <SendIcon className="w-5 h-5" />}
            </button>
          </div>
        ) : (
          <div className="px-4 py-3 border-t border-border shrink-0">
            <button onClick={() => navigate('/auth')} className="w-full py-2.5 bg-primary text-primary-foreground rounded-xl font-bold text-sm hover:opacity-90">Sign in to comment</button>
          </div>
        )}
      </div>
    </div>
  );
}

// Video share card
function VideoShareCard({ post, onClose }: { post: Post; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const url = `${window.location.origin}/videos?id=${post.id}`;
  const copy = () => { navigator.clipboard.writeText(url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }); };
  const share = async () => {
    try {
      await navigator.share({ title: post.content?.slice(0, 60), url });
    } catch {
      copy();
    }
  };
  return (
    <div className="fixed inset-0 z-[200] flex items-end justify-center" onClick={onClose}>
      <div className="bg-background rounded-t-3xl border-t border-border w-full max-w-sm p-5 space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="font-bold">Share Video</h3>
          <button onClick={onClose} className="p-1.5 rounded-full hover:bg-muted"><X className="w-4 h-4" /></button>
        </div>
        <div className="flex items-center gap-2 bg-muted/50 border border-border rounded-xl px-3 py-2.5">
          <span className="text-xs font-mono text-muted-foreground truncate flex-1">{url}</span>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <button onClick={copy} className={`flex items-center justify-center gap-2 py-3 rounded-xl border font-semibold text-sm transition-all ${copied ? 'bg-green-500/10 border-green-500/30 text-green-600' : 'border-border hover:bg-muted'}`}>
            {copied ? '✓ Copied!' : '🔗 Copy Link'}
          </button>
          <button onClick={share} className="flex items-center justify-center gap-2 py-3 rounded-xl bg-primary text-primary-foreground font-bold text-sm hover:opacity-90">
            <Share className="w-4 h-4" /> Share
          </button>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {[{ label: '💬 Reply', action: () => { copy(); onClose(); } }, { label: '📖 Thread', action: () => { window.open(`/post/${post.id}`, '_blank'); onClose(); } }, { label: '🔥 Challenge', action: () => { navigator.clipboard.writeText(`${url}&challenge=1`).then(() => toast.success('Challenge link copied!')); onClose(); } }].map(btn => (
            <button key={btn.label} onClick={btn.action} className="py-2.5 border border-border rounded-xl text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">{btn.label}</button>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function VideosPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const deepLinkProcessed = useRef(false);
  const [videos, setVideos] = useState<Post[]>([]);
  const [activeTab, setActiveTab] = useState<FeedTab>('foryou');
  const [followingIds, setFollowingIds] = useState<string[]>([]);
  // Search
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Post[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const searchDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Comment drawer
  const [commentPost, setCommentPost] = useState<Post | null>(null);
  // Share card
  const [sharePost, setSharePost] = useState<Post | null>(null);
  // Watch later — plain array (esbuild guard: no Set<string> state)
  const [watchLaterIds, setWatchLaterIds] = useState<string[]>([]);
  // Speed overlay
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  // Duets feed — posts that contain 'Duet with @' in content
  const [duetVideos, setDuetVideos] = useState<Post[]>([]);
  const [duetsLoading, setDuetsLoading] = useState(false);
  // Video ads fetched once and injected every AD_INTERVAL slots
  const [videoAds, setVideoAds] = useState<any[]>([]);

  // Top 5 videos for SEO ItemList JSON-LD
  const topVideos = videos.slice(0, 5);
  const videosJsonLd = topVideos.length > 0 ? {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: 'Trending Videos on Testagram',
    description: 'Top short videos from creators around the world on Testagram.',
    url: 'https://testagram.site/videos',
    numberOfItems: topVideos.length,
    itemListElement: topVideos.map((v: any, i: number) => ({
      '@type': 'ListItem',
      position: i + 1,
      item: {
        '@type': 'VideoObject',
        name: v.content?.replace(/<[^>]*>/g, '').slice(0, 80) || 'Video on Testagram',
        description: v.content?.replace(/<[^>]*>/g, '').slice(0, 200) || 'Watch this video on Testagram',
        thumbnailUrl: v.image_url || 'https://testagram.site/app-icon.jpg',
        uploadDate: v.created_at,
        contentUrl: v.video_url,
        author: {
          '@type': 'Person',
          name: v.user_profiles?.username ?? 'Creator',
          url: `https://testagram.site/profile/${v.user_profiles?.username}`,
        },
        interactionStatistic: [
          { '@type': 'InteractionCounter', interactionType: 'https://schema.org/WatchAction', userInteractionCount: v.views_count ?? 0 },
          { '@type': 'InteractionCounter', interactionType: 'https://schema.org/LikeAction', userInteractionCount: v.likes_count ?? 0 },
        ],
      },
    })),
  } : undefined;

  useSEO({
    title: 'Trending Videos',
    description: 'Watch short videos from creators around the world on Testagram. Discover trending clips, go viral, and earn from your content.',
    url: '/videos',
    type: 'website',
    keywords: 'short videos, trending clips, viral videos, creators, testagram, tiktok-style, video feed',
    structuredData: videosJsonLd,
  });

  const [loading, setLoading] = useState(true);
  const [activeIndex, setActiveIndex] = useState(0);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);
  const activeIndexRef = useRef(0);

  // Rewarded ad state
  const [showRewardPrompt, setShowRewardPrompt] = useState(false);
  const [rewardPending, setRewardPending] = useState(false);
  const [rewardMessage, setRewardMessage] = useState('');
  const lastRewardedAt = useRef(0);

  // Preload map: index → shouldPreload — plain untyped object (esbuild guard: no Record<N,T> annotation)
  // Smart preloading: eagerly buffer next PRELOAD_AHEAD slots, cancel stale ones behind
  const [preloadMap, setPreloadMap] = useState<any>({});
  // Track indices whose <video> src should be set to '' to cancel buffering
  const [cancelMap, setCancelMap] = useState<any>({});

  // Fetch active user-created video/image ads for injection
  useEffect(() => {
    supabase
      .from('user_ads')
      .select('*, user_profiles!user_ads_user_id_fkey(id, username, avatar_url, verified)')
      .eq('status', 'active')
      .eq('payment_status', 'paid')
      .order('created_at', { ascending: false })
      .limit(6)
      .then(({ data }) => setVideoAds(data ?? []));
  }, []);

  // Fetch following IDs + watch later when user logs in
  useEffect(() => {
    if (!user) { setFollowingIds([]); setWatchLaterIds([]); return; }
    supabase.from('follows').select('following_id').eq('follower_id', user.id)
      .then(({ data }) => setFollowingIds((data ?? []).map((f: any) => f.following_id)));
    // Load watch-later from localStorage (persists across sessions)
    const wl = localStorage.getItem(`ts-watchlater-${user.id}`);
    if (wl) { try { setWatchLaterIds(JSON.parse(wl) ?? []); } catch { setWatchLaterIds([]); } }
  }, [user?.id]);

  const toggleWatchLater = (e: React.MouseEvent, videoId: string) => {
    e.stopPropagation();
    if (!user) { navigate('/auth'); return; }
    setWatchLaterIds(prev => {
      const next = prev.includes(videoId)
        ? prev.filter(id => id !== videoId)
        : [...prev, videoId];
      if (prev.includes(videoId)) toast.success('Removed from Watch Later');
      else toast.success('Saved to Watch Later');
      localStorage.setItem(`ts-watchlater-${user.id}`, JSON.stringify(next));
      return next;
    });
  };

  // Search videos
  const handleSearch = useCallback((q: string) => {
    setSearchQuery(q);
    if (searchDebounce.current) clearTimeout(searchDebounce.current);
    if (!q.trim()) { setSearchResults([]); return; }
    searchDebounce.current = setTimeout(async () => {
      setSearchLoading(true);
      const { data } = await supabase.from('posts').select('*, profiles(*)')
        .eq('is_video', true).ilike('content', `%${q}%`).order('views_count', { ascending: false }).limit(20);
      setSearchResults(data ?? []);
      setSearchLoading(false);
    }, VIDEO_SEARCH_DEBOUNCE_MS);
  }, []);

  // Watch Later tab: filter from loaded videos by id
  const watchLaterVideos = useMemo(() => videos.filter(v => watchLaterIds.includes(v.id)), [videos, watchLaterIds]);

  // Fetch duet videos when duets tab is first opened
  useEffect(() => {
    if (activeTab !== 'duets') return;
    if (duetVideos.length > 0) return; // already fetched
    setDuetsLoading(true);
    supabase
      .from('posts')
      .select('*, profiles(*)')
      .eq('is_video', true)
      .ilike('content', '%Duet with @%')
      .order('created_at', { ascending: false })
      .limit(50)
      .then(({ data }) => { setDuetVideos(data ?? []); setDuetsLoading(false); });
  }, [activeTab]);

  // Re-fetch when tab changes (skip watch-later + duets — they use separate data sources)
  useEffect(() => {
    if (activeTab === 'watchlater' || activeTab === 'duets') return;
    setVideos([]);
    setPage(0);
    setHasMore(true);
    setActiveIndex(0);
    activeIndexRef.current = 0;
    deepLinkProcessed.current = false;
    setPreloadMap({});
    if (containerRef.current) containerRef.current.scrollTo({ top: 0 });
    setLoading(true);
    fetchVideos(0);
  }, [activeTab]);

  // Deep link: scroll to specific video on load (?id=postId)
  useEffect(() => {
    if (deepLinkProcessed.current || videos.length === 0) return;
    const deepId = searchParams.get('id');
    if (!deepId) return;
    const targetIdx = videos.findIndex(v => v.id === deepId);
    if (targetIdx === -1) return;
    deepLinkProcessed.current = true;
    setTimeout(() => {
      const container = containerRef.current;
      if (!container) return;
      container.scrollTo({ top: targetIdx * window.innerHeight });
      activeIndexRef.current = targetIdx;
      setActiveIndex(targetIdx);
      setPreloadMap(prev => {
        const map = { ...prev };
        for (let i = Math.max(0, targetIdx - 1); i <= targetIdx + PRELOAD_AHEAD && i < videos.length; i++) {
          map[i] = true;
        }
        return map;
      });
    }, 200);
  }, [videos]);

  // Sync shareable URL as user scrolls
  useEffect(() => {
    const vid = videos[activeIndex];
    if (vid?.id) {
      setSearchParams({ id: vid.id }, { replace: true });
    }
  }, [activeIndex]);

  const fetchVideos = async (pageNum: number) => {
    try {
      let query = supabase
        .from('posts')
        .select('*, profiles (*)')
        .eq('is_video', true)
        .order('created_at', { ascending: false })
        .range(pageNum * PAGE_SIZE, (pageNum + 1) * PAGE_SIZE - 1);

      // Following tab: filter to videos from followed users
      if (activeTab === 'following') {
        if (followingIds.length === 0) {
          setLoading(false);
          return;
        }
        query = supabase
          .from('posts')
          .select('*, profiles (*)')
          .eq('is_video', true)
          .in('user_id', followingIds)
          .order('created_at', { ascending: false })
          .range(pageNum * PAGE_SIZE, (pageNum + 1) * PAGE_SIZE - 1);
      }

      const { data, error } = await query;
      if (error) throw error;

      const newVideos = data || [];
      if (newVideos.length < PAGE_SIZE) setHasMore(false);

      if (pageNum === 0) {
        setVideos(newVideos);
        // esbuild guard: plain untyped object (no Record<N,T> annotation)
        const init: any = {};
        for (let i = 0; i < Math.min(4, newVideos.length); i++) init[i] = true;
        setPreloadMap(init);
        setCancelMap({});
      } else {
        setVideos(prev => [...prev, ...newVideos]);
      }
      setPage(pageNum);
    } catch (err) {
      console.error('fetchVideos error:', err);
    } finally {
      setLoading(false);
    }
  };

  // Throttled scroll handler using requestAnimationFrame
  const ticking = useRef(false);
  const handleScroll = useCallback(() => {
    if (ticking.current) return;
    ticking.current = true;

    requestAnimationFrame(() => {
      const container = containerRef.current;
      if (!container) { ticking.current = false; return; }

      const viewportH = window.innerHeight;
      const idx = Math.round(container.scrollTop / viewportH);

      if (idx !== activeIndexRef.current && idx < videos.length) {
        activeIndexRef.current = idx;
        setActiveIndex(idx);

        // Preload ahead
        setPreloadMap(prev => {
          const map = { ...prev };
          for (let i = idx; i <= idx + PRELOAD_AHEAD && i < videos.length; i++) {
            map[i] = true;
          }
          return map;
        });
        // Cancel buffering for slots too far behind (release memory)
        setCancelMap(prev => {
          const map = { ...prev };
          for (let i = 0; i < idx - PRELOAD_CANCEL_BEHIND; i++) {
            if (!map[i]) map[i] = true;
          }
          return map;
        });

        // Rewarded ad prompt every 8 videos, throttled 30s
        if (idx > 0 && idx % 8 === 0 && Date.now() - lastRewardedAt.current > 30_000) {
          setShowRewardPrompt(true);
        }

        // Load more pages
        if (idx >= videos.length - 3 && hasMore) {
          fetchVideos(page + 1);
        }
      }
      ticking.current = false;
    });
  }, [videos.length, hasMore, page]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => container.removeEventListener('scroll', handleScroll);
  }, [handleScroll]);

  const handleWatchRewardedAd = async () => {
    setRewardPending(true);
    try {
      lastRewardedAt.current = Date.now();
      setRewardMessage('🎉 You unlocked 2× reach boost on your next post!');
      setTimeout(() => { setShowRewardPrompt(false); setRewardMessage(''); }, 3500);
    } finally {
      setRewardPending(false);
    }
  };

  // Pre-compute current video for speed menu + share/comment drawers (esbuild guard: no IIFE)
  const currentFeedVideos = activeTab === 'watchlater' ? watchLaterVideos : activeTab === 'duets' ? duetVideos : videos;
  const currentVideo = currentFeedVideos[activeIndex] ?? null;
  // Watch-later status is tracked in VideoPlayer via bookmark — currentIsWatchLater kept for potential future use
  // const currentIsWatchLater = currentVideo ? watchLaterIds.includes(currentVideo.id) : false;

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center bg-black">
        <Loader2 className="w-8 h-8 animate-spin text-white" />
      </div>
    );
  }

  if (videos.length === 0) {
    return (
      <div className="h-screen flex flex-col items-center justify-center bg-black text-white gap-4">
        {/* Tab switcher even on empty state */}
        <div className="absolute top-4 left-1/2 -translate-x-1/2 flex items-center gap-1 bg-black/50 backdrop-blur-sm rounded-full px-1.5 py-1 border border-white/10">
          {(['foryou', 'following', 'duets'] as FeedTab[]).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-3 py-1.5 rounded-full text-sm font-bold transition-all ${
                activeTab === tab ? 'bg-white text-black' : 'text-white/70 hover:text-white'
              }`}
            >
              {tab === 'foryou' ? 'For You' : tab === 'following' ? 'Following' : '🎭 Duets'}
            </button>
          ))}
        </div>
        <div className="w-20 h-20 bg-white/10 rounded-full flex items-center justify-center">
          <Play className="w-10 h-10" />
        </div>
        <p className="text-xl font-bold">
          {activeTab === 'following' && user
            ? "No videos from people you follow yet"
            : "No videos yet"}
        </p>
        <p className="text-white/60 text-center px-8">
          {activeTab === 'following' && user
            ? "Follow some creators to see their videos here"
            : "Be the first to share a video!"}
        </p>
        <button
          onClick={() => navigate('/')}
          className="mt-2 px-6 py-2 bg-white/10 rounded-full text-sm font-medium hover:bg-white/20 transition-colors"
        >
          Go to Home Feed
        </button>
      </div>
    );
  }

  return (
    <div className="relative bg-black" style={{ height: '100svh' }}>
      {/* Comment drawer */}
      {commentPost && <VideoCommentDrawer post={commentPost} onClose={() => setCommentPost(null)} />}
      {/* Share card */}
      {sharePost && <VideoShareCard post={sharePost} onClose={() => setSharePost(null)} />}

      {/* Speed overlay */}
      {showSpeedMenu && (
        <div className="fixed inset-0 z-[150] flex items-end justify-center" onClick={() => setShowSpeedMenu(false)}>
          <div className="bg-background/95 backdrop-blur-xl rounded-t-3xl border-t border-border w-full max-w-sm p-4 space-y-2" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2"><Gauge className="w-4 h-4 text-primary" /><h3 className="font-bold text-sm">Playback Speed</h3></div>
              <button onClick={() => setShowSpeedMenu(false)} className="p-1 rounded-full hover:bg-muted"><X className="w-4 h-4" /></button>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {VIDEO_SPEED_OPTIONS.map(spd => (
                <button key={spd} onClick={() => { setPlaybackSpeed(spd); setShowSpeedMenu(false); toast.success(`Speed: ${spd}×`); }}
                  className={`py-3 rounded-xl font-bold text-sm border-2 transition-all ${
                    playbackSpeed === spd ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:border-primary/30 text-muted-foreground'
                  }`}>{spd}×</button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Search panel */}
      {showSearch && (
        <div className="absolute inset-0 z-[100] bg-black/95 flex flex-col">
          <div className="flex items-center gap-3 px-4 pt-12 pb-3 border-b border-white/10">
            <Search className="w-4 h-4 text-white/60 shrink-0" />
            <input autoFocus type="text" value={searchQuery} onChange={e => handleSearch(e.target.value)}
              placeholder="Search videos…" className="flex-1 bg-transparent text-white text-sm focus:outline-none placeholder:text-white/40" />
            {searchQuery && <button onClick={() => { setSearchQuery(''); setSearchResults([]); }} className="text-white/60"><X className="w-4 h-4" /></button>}
            <button onClick={() => { setShowSearch(false); setSearchQuery(''); setSearchResults([]); }} className="text-white/70 text-sm font-semibold">Cancel</button>
          </div>
          <div className="flex-1 overflow-y-auto">
            {searchLoading ? (
              <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-white/40" /></div>
            ) : searchResults.length === 0 && searchQuery ? (
              <div className="text-center py-16 text-white/40">
                <Play className="w-10 h-10 mx-auto mb-2" />
                <p className="text-sm">No videos found for "{searchQuery}"</p>
              </div>
            ) : (
              searchResults.map((v, i) => (
                <div key={v.id} className="flex gap-3 px-4 py-3 border-b border-white/5 cursor-pointer hover:bg-white/5 transition-colors"
                  onClick={() => { setVideos(searchResults); setActiveIndex(i); setShowSearch(false); setSearchQuery(''); setSearchResults([]); }}>
                  <div className="relative w-16 h-24 bg-white/10 rounded-xl overflow-hidden shrink-0">
                    <video src={`${v.video_url}#t=0.5`} className="w-full h-full object-cover" muted preload="metadata" />
                    <div className="absolute inset-0 flex items-center justify-center"><Play className="w-5 h-5 text-white" fill="white" /></div>
                  </div>
                  <div className="flex-1 min-w-0 py-1">
                    <p className="text-white text-sm font-semibold line-clamp-2 mb-1">{v.content?.slice(0, 100)}</p>
                    <p className="text-white/50 text-xs">@{(v as any).user_profiles?.username}</p>
                    <div className="flex items-center gap-3 mt-2 text-white/40 text-xs">
                      <span className="flex items-center gap-1"><Eye className="w-3 h-3" />{formatNumber(v.views_count ?? 0)}</span>
                      <span className="flex items-center gap-1"><Heart className="w-3 h-3" />{formatNumber(v.likes_count ?? 0)}</span>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* For You / Following / Watch Later tab bar — overlaid at top of screen */}
      <div className="absolute top-0 left-0 right-0 z-30 flex items-center justify-between px-3 pt-3 pointer-events-none">
        <button onClick={() => setShowSearch(true)} className="w-8 h-8 flex items-center justify-center text-white/70 hover:text-white transition-colors pointer-events-auto">
          <Search className="w-5 h-5" />
        </button>
        <div className="flex items-center gap-1 bg-black/40 backdrop-blur-sm rounded-full px-1.5 py-1 border border-white/10 pointer-events-auto">
          {(['foryou', 'following', 'duets', 'watchlater'] as FeedTab[]).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-3 py-1.5 rounded-full text-xs font-bold transition-all active:scale-95 ${
                activeTab === tab
                  ? 'bg-white text-black shadow-sm'
                  : 'text-white/70 hover:text-white'
              }`}
            >
              {tab === 'foryou' ? 'For You' : tab === 'following' ? 'Following' : tab === 'duets' ? '🎭 Duets' : '🔖'}
            </button>
          ))}
        </div>
        <button onClick={() => setShowSpeedMenu(true)} className="w-8 h-8 flex items-center justify-center text-white/70 hover:text-white transition-colors pointer-events-auto" title={`Speed: ${playbackSpeed}×`}>
          <span className="text-[10px] font-black">{playbackSpeed}×</span>
        </button>
      </div>

      {/* Duets tab — loading / empty states */}
      {activeTab === 'duets' && duetsLoading && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-black gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-white/60" />
          <p className="text-white/50 text-sm">Loading duets…</p>
        </div>
      )}
      {/* Duet Challenge launcher — shown on duets tab */}
      {activeTab === 'duets' && !duetsLoading && duetVideos.length > 0 && currentVideo && (
        <div className="absolute bottom-28 left-4 right-4 z-50 pointer-events-auto">
          <div className="bg-black/80 backdrop-blur-md border border-white/15 rounded-2xl p-4 flex items-center gap-4">
            <div className="w-11 h-11 rounded-full bg-sky-500/20 border border-sky-400/30 flex items-center justify-center shrink-0">
              <span className="text-xl">🎭</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-white font-bold text-sm">Start Duet Challenge</p>
              <p className="text-white/60 text-xs">Launch a challenge on this duet</p>
            </div>
            <button
              onClick={async () => {
                if (!user) { navigate('/auth'); return; }
                const tag = `duet${Date.now().toString(36)}`;
                const { data: htag } = await import('@/lib/supabase').then(m =>
                  m.supabase.from('hashtags').upsert({ tag }, { onConflict: 'tag' }).select('id').single()
                );
                if (htag?.id) {
                  await import('@/lib/supabase').then(m =>
                    m.supabase.from('hashtag_challenges').insert({
                      hashtag_id: htag.id,
                      created_by: user.id,
                      title: 'Duet Challenge',
                      description: `Record your duet reaction to join! Tag #${tag} in your video.`,
                      end_date: new Date(Date.now() + 7 * 86400000).toISOString(),
                      is_active: true,
                    })
                  );
                }
                toast.success(`🎭 Duet Challenge launched! #${tag}`);
                navigate(`/videos?duet_url=${encodeURIComponent(currentVideo.video_url ?? '')}&duet_meta=${encodeURIComponent('Duet Challenge 🎭')}`);
              }}
              className="flex-shrink-0 flex items-center gap-1.5 px-3 py-2 bg-sky-500 hover:bg-sky-400 active:scale-95 transition-all rounded-xl text-white text-xs font-bold"
            >
              <span>🚀</span> Launch
            </button>
          </div>
        </div>
      )}
      {activeTab === 'duets' && !duetsLoading && duetVideos.length === 0 && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-black gap-4 px-8 text-center">
          <span className="text-6xl">🎭</span>
          <p className="text-white font-bold text-xl">No Duets Yet</p>
          <p className="text-white/60 text-sm">Creators who record side-by-side duets will appear here</p>
          <button onClick={() => setActiveTab('foryou')}
            className="mt-2 px-5 py-2.5 bg-white/10 hover:bg-white/20 rounded-full text-white text-sm font-semibold transition-colors">
            Browse For You
          </button>
        </div>
      )}

      {/* TikTok-style vertical scroll feed */}
      <div
        ref={containerRef}
        className="video-feed-container w-full"
        style={{
          height: '100svh',
          overflowY: 'scroll',
          scrollSnapType: 'y mandatory',
          WebkitOverflowScrolling: 'touch',
        }}
      >
        {videos.map((video, index) => {
          // Calculate the true rendered-slot index including injected ad slots
          // Every AD_INTERVAL real videos, one ad slot appears before the next video
          const adsBefore = Math.floor(index / AD_INTERVAL);
          const slotIndex = index + adsBefore;
          // Determine if an ad slot appears immediately before this video
          const showAdBeforeThis = index > 0 && index % AD_INTERVAL === 0 && videoAds.length > 0;
          const adForSlot = showAdBeforeThis ? videoAds[(Math.floor(index / AD_INTERVAL) - 1) % videoAds.length] : null;
          return (
            <React.Fragment key={`slot-${video.id}`}>
              {/* Inject ad slide before every AD_INTERVAL-th video */}
              {adForSlot && (
                <div
                  key={`ad-${adForSlot.id}-${index}`}
                  style={{
                    height: '100svh',
                    scrollSnapAlign: 'start',
                    scrollSnapStop: 'always',
                    position: 'relative',
                    flexShrink: 0,
                  }}
                >
                  <VideoAdSlide
                    ad={adForSlot}
                    isActive={slotIndex - 1 === activeIndex}
                  />
                </div>
              )}
              <div
                key={video.id}
                className="video-feed-item"
                style={{
                  height: '100svh',
                  scrollSnapAlign: 'start',
                  scrollSnapStop: 'always',
                  position: 'relative',
                }}
              >
                {/* Thumbnail shimmer while video is loading (shown before preload activates) */}
                {!preloadMap[index] && video.image_url && (
                  <div className="absolute inset-0 bg-black">
                    <img
                      src={video.image_url}
                      alt=""
                      className="w-full h-full object-cover opacity-60"
                      loading="lazy"
                    />
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="w-16 h-16 rounded-full bg-black/40 border border-white/20 flex items-center justify-center animate-pulse">
                        <Play className="w-7 h-7 text-white fill-white ml-1" />
                      </div>
                    </div>
                  </div>
                )}
                <VideoPlayer
                  post={video}
                  isActive={slotIndex === activeIndex}
                  onUpdate={() => fetchVideos(0)}
                  shouldPreload={!!preloadMap[index]}
                  cancelPreload={!!cancelMap[index]}
                />
              </div>
            </React.Fragment>
          );
        })}

        {/* Loading more indicator */}
        {hasMore && (
          <div className="flex items-center justify-center py-8 bg-black">
            <Loader2 className="w-6 h-6 animate-spin text-white/40" />
          </div>
        )}
      </div>

      {/* Video index indicator */}
      <div className="absolute top-14 left-1/2 -translate-x-1/2 z-20 pointer-events-none">
        <div className="bg-black/40 backdrop-blur-sm rounded-full px-3 py-1">
          <p className="text-white/70 text-xs font-medium">
            {activeIndex + 1} / {currentFeedVideos.length}{hasMore ? '+' : ''}
          </p>
        </div>
      </div>
      {/* esbuild guard: floating overlay removed — VideoPlayer already has Like/Comment/Repost/Share/Bookmark built-in; duplicate removed to fix double-button issue */}

      {/* Rewarded Ad Prompt */}
      {showRewardPrompt && !rewardMessage && (
        <div className="absolute bottom-24 left-4 right-4 z-50 animate-slide-in">
          <div className="bg-black/85 backdrop-blur-md border border-white/20 rounded-2xl p-4 flex items-center gap-4">
            <div className="w-12 h-12 bg-gradient-to-br from-amber-400 to-orange-500 rounded-xl flex items-center justify-center shrink-0">
              <Gift className="w-6 h-6 text-white" />
            </div>
            <div className="flex-1">
              <p className="text-white font-bold text-sm">Watch an ad</p>
              <p className="text-white/70 text-xs">Unlock 2× reach boost on your next post</p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setShowRewardPrompt(false)}
                className="p-2 text-white/60 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
              <button
                onClick={handleWatchRewardedAd}
                disabled={rewardPending}
                className="flex items-center gap-1.5 bg-gradient-to-r from-amber-400 to-orange-500 text-black font-bold text-sm px-4 py-2 rounded-xl hover:opacity-90 transition-opacity disabled:opacity-60"
              >
                {rewardPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
                Watch
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reward success toast */}
      {rewardMessage && (
        <div className="absolute bottom-28 left-4 right-4 z-50">
          <div className="bg-gradient-to-r from-amber-400 to-orange-500 text-black font-bold text-sm px-5 py-3.5 rounded-2xl text-center shadow-lg">
            {rewardMessage}
          </div>
        </div>
      )}
    </div>
  );
}
