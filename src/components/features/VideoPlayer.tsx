import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Heart, MessageCircle, Repeat2, Share, Volume2, VolumeX,
  Play, DollarSign, Crown, BadgeCheck, X, Send, Loader2,
  UserPlus, UserCheck, Quote, Copy, Check, Bookmark, BookmarkCheck, Layers, Download,
} from 'lucide-react';
import { Post } from '@/types/app-types';
import { formatNumber } from '@/lib/utils';
import { useAuth } from '@/hooks/useAuth';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';
import { VideoMonetizationAd } from './VideoMonetizationAd';
import { usePremium } from '@/hooks/usePremium';

interface VideoPlayerProps {
  post: Post;
  isActive: boolean;
  onUpdate?: () => void;
  shouldPreload?: boolean;
  cancelPreload?: boolean;
}

interface Reply {
  id: string;
  content: string;
  created_at: string;
  user_profiles: { username: string; avatar_url: string | null } | null;
}

function normalizeVideoReplies(rows: any[] | null | undefined): Reply[] {
  return (rows ?? []).map((row) => ({ ...row, user_profiles: Array.isArray(row?.user_profiles) ? row.user_profiles[0] ?? null : row?.user_profiles ?? null }));
}

// @__PURE__ annotation prevents esbuild non-determinism on module-level Map construction
const authorPremiumCache: Map<string, boolean> = /* @__PURE__ */ new Map();

export function VideoPlayer({ post, isActive, onUpdate, shouldPreload, cancelPreload }: VideoPlayerProps) {
  const videoRef       = useRef<HTMLVideoElement>(null);
  const viewCounterRef = useRef(0); // per-page view counter — replaces module-level _counter
  const progressRef    = useRef<HTMLDivElement>(null);
  const lastTapRef     = useRef<{ time: number; x: number; y: number } | null>(null);
  const heartTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const swipeStartRef  = useRef<{ y: number; time: number } | null>(null);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { user }                = useAuth();
  const { isActive: isPremium } = usePremium();
  const navigate                = useNavigate();
  const { toast }               = useToast();

  const [isPlaying, setIsPlaying]               = useState(false);
  const [isMuted, setIsMuted]                   = useState(true);
  const [isLiked, setIsLiked]                   = useState(false);
  const [isReposted, setIsReposted]             = useState(false);
  const [isFollowing, setIsFollowing]           = useState(false);
  const [followLoading, setFollowLoading]       = useState(false);
  const [likesCount, setLikesCount]             = useState(post.likes_count ?? 0);
  const [repostsCount, setRepostsCount]         = useState(post.reposts_count ?? 0);
  const [repliesCount, setRepliesCount]         = useState(post.replies_count ?? 0);

  // Ads
  const [showPrerollAd, setShowPrerollAd]       = useState(false);
  const [showMidrollAd, setShowMidrollAd]       = useState(false);
  const [adDoneForThisPost, setAdDoneForThisPost] = useState(false);
  const [midrollDone, setMidrollDone]           = useState(false);

  // Progress bar
  const [videoProgress, setVideoProgress]       = useState(0);
  const [isDragging, setIsDragging]             = useState(false);

  // Double-tap heart burst
  const [heartPos, setHeartPos]                 = useState<{ x: number; y: number } | null>(null);

  // Author premium badge
  const [isAuthorPremium, setIsAuthorPremium]   = useState(false);

  // Comment sheet
  const [showComments, setShowComments]         = useState(false);
  const [comments, setComments]                 = useState<Reply[]>([]);
  const [commentsLoading, setCommentsLoading]   = useState(false);
  const [newComment, setNewComment]             = useState('');
  const [posting, setPosting]                   = useState(false);

  // Repost sheet
  const [showRepostSheet, setShowRepostSheet]   = useState(false);

  // Share sheet
  const [showShareSheet, setShowShareSheet]     = useState(false);
  const [linkCopied, setLinkCopied]             = useState(false);

  // Bookmark
  const [isBookmarked, setIsBookmarked]         = useState(false);

  // Caption expand/collapse
  const [captionExpanded, setCaptionExpanded]   = useState(false);

  /* ── Load initial like / repost / follow state ──────────────────────── */
  useEffect(() => {
    if (!user) return;
    const uid = user.id;
    // Check like
    supabase.from('likes').select('id').eq('user_id', uid).eq('post_id', post.id).maybeSingle()
      .then(({ data }) => { if (data) setIsLiked(true); });
    // Check repost
    supabase.from('reposts').select('id').eq('user_id', uid).eq('post_id', post.id).maybeSingle()
      .then(({ data }) => { if (data) setIsReposted(true); });
    // Check bookmark
    supabase.from('bookmarks').select('id').eq('user_id', uid).eq('post_id', post.id).maybeSingle()
      .then(({ data }) => { if (data) setIsBookmarked(true); });
    // Check follow (skip own posts)
    if (post.user_id !== uid) {
      supabase.from('follows').select('id').eq('follower_id', uid).eq('following_id', post.user_id).maybeSingle()
        .then(({ data }) => { if (data) setIsFollowing(true); });
    }
  }, [user?.id, post.id, post.user_id]);

  /* ── Author premium cache ────────────────────────────────────────────── */
  useEffect(() => {
    const uid = post.user_id;
    if (authorPremiumCache.has(uid)) {
      setIsAuthorPremium(authorPremiumCache.get(uid)!);
      return;
    }
    supabase
      .from('premium_subscriptions')
      .select('id')
      .eq('user_id', uid)
      .eq('status', 'active')
      .gt('expires_at', new Date().toISOString())
      .maybeSingle()
      .then(({ data }) => {
        const has = !!data;
        authorPremiumCache.set(uid, has);
        setIsAuthorPremium(has);
      });
  }, [post.user_id]);

  /* ── Play / pause on active change ──────────────────────────────────── */
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (isActive) {
      trackView();
      viewCounterRef.current++;
      const shouldShowAd = !isPremium && !adDoneForThisPost &&
        (post.is_monetized || viewCounterRef.current % 3 === 0);
      if (shouldShowAd) {
        setShowPrerollAd(true);
        setAdDoneForThisPost(true);
      } else {
        video.play().then(() => setIsPlaying(true)).catch(() => {});
      }
    } else {
      // Mute and pause when scrolling away
      video.pause();
      video.muted = true;
      setIsMuted(true);
      setIsPlaying(false);
      setShowComments(false);
      setShowRepostSheet(false);
      setShowShareSheet(false);
    }
  }, [isActive]);

  /* ── Ad complete ─────────────────────────────────────────────────────── */
  const handleAdComplete = () => {
    setShowPrerollAd(false);
    setShowMidrollAd(false);
    const video = videoRef.current;
    if (video) video.play().then(() => setIsPlaying(true)).catch(() => {});
  };

  /* ── Time update → progress + mid-roll trigger ───────────────────────── */
  const handleTimeUpdate = () => {
    const video = videoRef.current;
    if (!video || isDragging) return;
    const pct = video.currentTime / (video.duration || 1);
    setVideoProgress(pct * 100);
    if (midrollDone || !post.is_monetized || isPremium) return;
    if (pct >= 0.5) {
      setMidrollDone(true);
      video.pause();
      setShowMidrollAd(true);
    }
  };

  /* ── Track view — one per user per session (dedup via browsing_history) ── */
  const viewTrackedRef = useRef(false);
  const trackView = async () => {
    if (viewTrackedRef.current) return; // already tracked this session
    viewTrackedRef.current = true;
    try {
      // Deduplicate: only insert if this user hasn't viewed this post in the last 24h
      const since24h = new Date(Date.now() - 24 * 3600000).toISOString();
      if (user?.id) {
        const { count } = await supabase
          .from('browsing_history')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', user.id)
          .eq('post_id', post.id)
          .gte('created_at', since24h);
        if ((count ?? 0) > 0) return; // already viewed today — do not increment
        await supabase.from('browsing_history').insert({ user_id: user.id, post_id: post.id, view_type: 'post' }).catch(() => {});
      }
      // Increment the view counter in posts table (always, anonymous users included)
      await supabase.rpc('increment_post_view', { post_id_param: post.id });
    } catch (_) {}
  };

  /* ── Toggle play ─────────────────────────────────────────────────────── */
  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) { video.play(); setIsPlaying(true); }
    else              { video.pause(); setIsPlaying(false); }
  };

  /* ── Toggle mute ─────────────────────────────────────────────────────── */
  const toggleMute = () => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    setIsMuted(video.muted);
  };

  /* ── Like — one-time only (no unlike) ───────────────────────────────── */
  const triggerLike = useCallback(async () => {
    if (!user) { navigate('/auth'); return; }
    if (isLiked) return; // already liked — prevent duplicate
    const newCount = likesCount + 1;
    setIsLiked(true);
    setLikesCount(newCount);
    try {
      await supabase.from('likes').insert({ user_id: user.id, post_id: post.id });
      await supabase.from('posts').update({ likes_count: newCount }).eq('id', post.id);
      if (post.user_id !== user.id) {
        await supabase.from('notifications').insert({ recipient_id: post.user_id, kind: 'like', actor_id: user.id, post_id: post.id,
         });
      }
      onUpdate?.();
    } catch (_) {
      setIsLiked(false);
      setLikesCount(likesCount);
    }
  }, [user, isLiked, likesCount, post.id, post.user_id]);

  /* ── Follow / Unfollow ──────────────────────────────────────────────── */
  const handleFollow = async () => {
    if (!user) { navigate('/auth'); return; }
    if (post.user_id === user.id) return; // can't follow self
    setFollowLoading(true);
    const nowFollowing = !isFollowing;
    setIsFollowing(nowFollowing);
    try {
      if (nowFollowing) {
        await supabase.from('follows').insert({ follower_id: user.id, following_id: post.user_id });
        await supabase.from('notifications').insert({ recipient_id: post.user_id, kind: 'follow', actor_id: user.id  });
      } else {
        await supabase.from('follows').delete().match({ follower_id: user.id, following_id: post.user_id });
      }
    } catch (_) {
      setIsFollowing(!nowFollowing);
    } finally {
      setFollowLoading(false);
    }
  };

  /* ── Repost ──────────────────────────────────────────────────────────── */
  const handleRepost = async () => {
    if (!user) { navigate('/auth'); return; }
    setShowRepostSheet(false);
    const nowReposted = !isReposted;
    const newCount    = nowReposted ? repostsCount + 1 : Math.max(0, repostsCount - 1);
    setIsReposted(nowReposted);
    setRepostsCount(newCount);
    try {
      if (nowReposted) {
        await supabase.from('reposts').insert({ user_id: user.id, post_id: post.id });
        await supabase.from('posts').update({ reposts_count: newCount }).eq('id', post.id);
        if (post.user_id !== user.id)
          await supabase.from('notifications').insert({ recipient_id: post.user_id, kind: 'repost', actor_id: user.id, post_id: post.id  });
        toast({ title: 'Reposted' });
      } else {
        await supabase.from('reposts').delete().match({ user_id: user.id, post_id: post.id });
        await supabase.from('posts').update({ reposts_count: newCount }).eq('id', post.id);
        toast({ title: 'Repost removed' });
      }
      onUpdate?.();
    } catch (_) {
      setIsReposted(!nowReposted);
      setRepostsCount(repostsCount);
    }
  };

  /* ── Quote repost → navigate to compose ─────────────────────────────── */
  const handleQuote = () => {
    setShowRepostSheet(false);
    const quoteText = encodeURIComponent(
      `"${(post.content ?? '').slice(0, 100)}" — @${post.user_profiles?.username ?? 'user'}`
    );
    navigate(`/?quote=${quoteText}&quote_post_id=${post.id}`);
  };

  /* ── Duet / Stitch → navigate to compose with original video ────────── */
  const handleDuet = () => {
    setShowRepostSheet(false);
    if (!post.video_url) { return; }
    const duetUrl  = encodeURIComponent(post.video_url);
    const duetMeta = encodeURIComponent(`Duet with @${post.user_profiles?.username ?? 'creator'}`);
    navigate(`/?duet_url=${duetUrl}&duet_post_id=${post.id}&duet_meta=${duetMeta}`);
  };

  /* ── Double-tap detection ────────────────────────────────────────────── */
  const handleVideoTap = (e: React.MouseEvent<HTMLVideoElement> | React.TouchEvent<HTMLVideoElement>) => {
    const target = e.currentTarget.getBoundingClientRect();
    let clientX: number, clientY: number;
    if ('touches' in e) {
      clientX = e.changedTouches[0].clientX;
      clientY = e.changedTouches[0].clientY;
    } else {
      clientX = (e as React.MouseEvent).clientX;
      clientY = (e as React.MouseEvent).clientY;
    }
    const relX = clientX - target.left;
    const relY = clientY - target.top;
    if (relX > target.width - 80) return; // skip right controls zone

    const now  = Date.now();
    const last = lastTapRef.current;
    if (last && now - last.time < 300) {
      lastTapRef.current = null;
      const pctX = (relX / target.width) * 100;
      const pctY = (relY / target.height) * 100;
      setHeartPos({ x: pctX, y: pctY });
      if (heartTimerRef.current) clearTimeout(heartTimerRef.current);
      heartTimerRef.current = setTimeout(() => setHeartPos(null), 900);
      triggerLike();
    } else {
      lastTapRef.current = { time: now, x: relX, y: relY };
      setTimeout(() => {
        if (lastTapRef.current && Date.now() - lastTapRef.current.time >= 290) {
          lastTapRef.current = null;
          togglePlay();
        }
      }, 310);
    }
  };

  /* ── Swipe-up to open post ───────────────────────────────────────────── */
  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    swipeStartRef.current = { y: e.touches[0].clientY, time: Date.now() };
  };
  const handleTouchEndSwipe = (e: React.TouchEvent<HTMLDivElement>) => {
    if (!swipeStartRef.current) return;
    const dy = swipeStartRef.current.y - e.changedTouches[0].clientY;
    const dt = Date.now() - swipeStartRef.current.time;
    swipeStartRef.current = null;
    // Fast upward swipe (>100px, <350ms) → open post
    if (dy > 100 && dt < 350 && !showComments && !showRepostSheet && !showShareSheet) {
      navigate(`/post/${post.id}`);
    }
  };

  /* ── Seek bar scrub ──────────────────────────────────────────────────── */
  const seekTo = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    const bar   = progressRef.current;
    const video = videoRef.current;
    if (!bar || !video || !video.duration) return;
    const rect   = bar.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0].clientX : (e as React.MouseEvent).clientX;
    const pct    = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    video.currentTime = pct * video.duration;
    setVideoProgress(pct * 100);
  }, []);

  const handleProgressMouseDown = (e: React.MouseEvent) => { setIsDragging(true); seekTo(e); };
  const handleProgressMouseMove = (e: React.MouseEvent) => { if (isDragging) seekTo(e); };
  const handleProgressMouseUp   = () => setIsDragging(false);
  const handleProgressTouchStart = (e: React.TouchEvent) => { setIsDragging(true); seekTo(e); };
  const handleProgressTouchMove  = (e: React.TouchEvent) => { if (isDragging) seekTo(e); };
  const handleProgressTouchEnd   = () => setIsDragging(false);

  /* ── Comments ────────────────────────────────────────────────────────── */
  const openComments = async () => {
    setShowComments(true);
    if (comments.length > 0) return;
    setCommentsLoading(true);
    const { data } = await supabase
      .from('replies')
      .select('id, content, created_at, profiles(username, avatar_url)')
      .eq('post_id', post.id)
      .order('created_at', { ascending: false })
      .limit(50);
    setComments(normalizeVideoReplies(data));
    setCommentsLoading(false);
  };

  const submitComment = async () => {
    if (!user) { navigate('/auth'); return; }
    if (!newComment.trim()) return;
    setPosting(true);
    const text = newComment.trim();
    setNewComment('');
    const { data: inserted } = await supabase
      .from('replies')
      .insert({ post_id: post.id, user_id: user.id, content: text })
      .select('id, content, created_at, profiles(username, avatar_url)')
      .single();
    if (inserted) {
      setComments(prev => [normalizeVideoReplies([inserted])[0], ...prev]);
      setRepliesCount(c => c + 1);
    }
    setPosting(false);
  };

  /* ── Bookmark ────────────────────────────────────────────────────────── */
  const handleBookmark = useCallback(async () => {
    if (!user) { navigate('/auth'); return; }
    const nowBookmarked = !isBookmarked;
    setIsBookmarked(nowBookmarked);
    try {
      if (nowBookmarked) {
        await supabase.from('bookmarks').insert({ user_id: user.id, post_id: post.id });
        toast({ title: 'Saved to bookmarks' });
      } else {
        await supabase.from('bookmarks').delete().match({ user_id: user.id, post_id: post.id });
        toast({ title: 'Removed from bookmarks' });
      }
    } catch (_) {
      setIsBookmarked(!nowBookmarked);
    }
  }, [user, isBookmarked, post.id]);

  /* ── Caption renderer — parses #hashtags and @mentions ──────────────── */
  const renderCaption = (content: string) => {
    if (!content) return null;
    const parts = content.split(/(#[\w\u00C0-\u024F]+|@[\w]+)/g);
    return parts.map((part, i) => {
      if (part.startsWith('#')) {
        const tag = part.slice(1);
        return (
          <span
            key={i}
            className="text-sky-400 cursor-pointer hover:underline"
            onClick={e => { e.stopPropagation(); navigate(`/hashtag/${tag}`); }}
          >
            {part}
          </span>
        );
      }
      if (part.startsWith('@')) {
        const username = part.slice(1);
        return (
          <span
            key={i}
            className="text-sky-400 cursor-pointer hover:underline"
            onClick={e => { e.stopPropagation(); navigate(`/profile/${username}`); }}
          >
            {part}
          </span>
        );
      }
      return <span key={i}>{part}</span>;
    });
  };

  /* ── Truncated caption (first 120 chars) for collapsed view ─────────── */
  const renderShortCaption = (content: string) => {
    if (!content) return null;
    const limit = 120;
    if (content.length <= limit) return renderCaption(content);
    return (
      <>
        {renderCaption(content.slice(0, limit))}
        {'… '}
        <span
          className="text-white/60 font-semibold cursor-pointer active:text-white"
          onClick={e => { e.stopPropagation(); setCaptionExpanded(true); }}
        >
          more
        </span>
      </>
    );
  };

  /* ── Long-press 2× speed gesture ──────────────────────────────────────── */
  // esbuild guard: plain ref + state (no Record/Set)
  const [longPressSpeed, setLongPressSpeed] = useState(false);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressActiveRef = useRef(false);

  const handleLongPressStart = () => {
    if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = setTimeout(() => {
      const video = videoRef.current;
      if (!video) return;
      longPressActiveRef.current = true;
      setLongPressSpeed(true);
      video.playbackRate = 2;
    }, 500);
  };

  const handleLongPressEnd = () => {
    if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
    if (!longPressActiveRef.current) return;
    longPressActiveRef.current = false;
    setLongPressSpeed(false);
    const video = videoRef.current;
    if (video) video.playbackRate = 1;
  };

  useEffect(() => {
    return () => { if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current); };
  }, []);

  /* ── Video download ──────────────────────────────────────────────────── */
  const [downloading, setDownloading] = useState(false);

  const handleDownload = async () => {
    if (!post.video_url) return;
    // Blob downloads are blocked on iOS Safari — detect and skip
    const isIosSafari = /iphone|ipad|ipod/i.test(navigator.userAgent) && !/chrome|crios|fxios/i.test(navigator.userAgent);
    if (isIosSafari) {
      // On iOS, open the URL directly — Safari will offer a save option
      window.open(post.video_url, '_blank');
      return;
    }
    setDownloading(true);
    try {
      const res = await fetch(post.video_url);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `video-${post.id}.mp4`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(url); document.body.removeChild(a); }, 1000);
    } catch {
      toast({ title: 'Download failed', description: 'Could not download this video' });
    } finally {
      setDownloading(false);
      setShowShareSheet(false);
    }
  };

  /* ── Share ───────────────────────────────────────────────────────────── */
  // Build URL lazily inside callbacks — avoids window.location at render scope
  const getPostUrl = () => `${window.location.origin}/post/${post.id}`;

  const handleCopyLink = () => {
    const postUrl = getPostUrl();
    navigator.clipboard.writeText(postUrl).then(() => {
      setLinkCopied(true);
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = setTimeout(() => setLinkCopied(false), 2000);
    });
  };

  const handleNativeShare = () => {
    const postUrl = getPostUrl();
    if (navigator.share) {
      navigator.share({ url: postUrl, title: post.content?.slice(0, 80) ?? 'Video' }).catch(() => {});
    } else {
      handleCopyLink();
    }
    setShowShareSheet(false);
  };

  /* ── Render ──────────────────────────────────────────────────────────── */
  const isOwnPost = user?.id === post.user_id;

  return (
    <div
      className="relative h-screen w-full max-w-full bg-black snap-start snap-always overflow-hidden"
      onTouchStart={e => { handleTouchStart(e); handleLongPressStart(); }}
      onTouchEnd={e => { handleTouchEndSwipe(e); handleLongPressEnd(); }}
      onMouseDown={handleLongPressStart}
      onMouseUp={handleLongPressEnd}
      onMouseLeave={handleLongPressEnd}
    >
      {/* Pre-roll ad */}
      {showPrerollAd && (
        <VideoMonetizationAd
          postId={post.id}
          creatorUserId={post.user_id}
          onAdComplete={handleAdComplete}
          skipAfterSeconds={5}
        />
      )}

      {/* Mid-roll ad */}
      {showMidrollAd && (
        <div className="absolute inset-0 z-50 flex flex-col">
          <div className="absolute top-2 right-2 z-10 bg-black/60 text-white/70 text-[10px] font-bold px-2 py-0.5 rounded-full">
            Mid-roll
          </div>
          <VideoMonetizationAd
            postId={post.id}
            creatorUserId={post.user_id}
            onAdComplete={handleAdComplete}
            skipAfterSeconds={5}
          />
        </div>
      )}

      {/* ── Video element ────────────────────────────────────────────────── */}
      <video
        ref={videoRef}
        src={cancelPreload ? '' : (post.video_url || '')}
        loop
        playsInline
        muted={isMuted}
        preload={shouldPreload ? 'auto' : 'metadata'}
        className="h-full w-full object-cover"
        style={{ maxWidth: '100vw' }}
        onTimeUpdate={handleTimeUpdate}
        onClick={handleVideoTap}
        onTouchEnd={handleVideoTap}
      />

      {/* ── Long-press 2× speed overlay ────────────────────────────────── */}
      {longPressSpeed && (
        <div className="absolute inset-0 z-40 pointer-events-none flex items-center justify-center">
          <div className="bg-black/60 backdrop-blur-sm border border-white/20 rounded-2xl px-6 py-3 flex items-center gap-2 shadow-xl">
            <span className="text-white text-2xl font-black">2×</span>
            <span className="text-white/80 text-sm font-semibold">Speed</span>
          </div>
        </div>
      )}

      {/* ── Double-tap heart burst ────────────────────────────────────────── */}
      {heartPos && (
        <div
          className="absolute pointer-events-none z-50"
          style={{ left: `${heartPos.x}%`, top: `${heartPos.y}%`, transform: 'translate(-50%, -50%)' }}
        >
          <Heart className="w-20 h-20 text-pink-500 fill-pink-500 animate-ping"
            style={{ animationDuration: '0.6s', animationIterationCount: 1 }} />
          <Heart className="absolute inset-0 w-20 h-20 text-white fill-white opacity-60"
            style={{ animation: 'scale-up 0.9s ease-out forwards' }} />
        </div>
      )}

      {/* ── Mute button — top-right, always tappable ─────────────────────── */}
      <button
        onClick={toggleMute}
        className="absolute top-4 right-4 z-30 p-3 bg-black/60 backdrop-blur-sm rounded-full hover:bg-black/80 active:scale-95 transition-all shadow-lg"
        style={{ touchAction: 'manipulation' }}
      >
        {isMuted ? <VolumeX className="w-5 h-5 text-white" /> : <Volume2 className="w-5 h-5 text-white" />}
      </button>

      {/* ── Seek / progress bar ───────────────────────────────────────────── */}
      {!showPrerollAd && !showMidrollAd && (
        <div
          ref={progressRef}
          className="absolute left-0 right-0 z-30 cursor-pointer"
          style={{ bottom: showComments ? '70vh' : '88px', touchAction: 'none' }}
          onMouseDown={handleProgressMouseDown}
          onMouseMove={handleProgressMouseMove}
          onMouseUp={handleProgressMouseUp}
          onMouseLeave={handleProgressMouseUp}
          onTouchStart={handleProgressTouchStart}
          onTouchMove={handleProgressTouchMove}
          onTouchEnd={handleProgressTouchEnd}
        >
          <div className="py-3 px-0">
            <div className="relative h-1 bg-white/20 rounded-full mx-0">
              <div className="absolute left-0 top-0 h-full bg-white rounded-full transition-none"
                style={{ width: `${videoProgress}%` }} />
              <div className="absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 bg-white rounded-full shadow-md shadow-black/50 -ml-1.5 transition-opacity"
                style={{ left: `${videoProgress}%`, opacity: isDragging ? 1 : 0.85 }} />
              {post.is_monetized && !isPremium && !midrollDone && (
                <div className="absolute top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-amber-400 border border-black/40"
                  style={{ left: '50%', marginLeft: '-4px' }} title="Ad at 50%" />
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Main overlay: author info + action buttons ────────────────────── */}
      <div
        className="absolute inset-0 flex flex-col justify-between p-4 pointer-events-none"
        style={{ maxWidth: '100vw' }}
      >
        {/* Top: author info + follow button */}
        <div className="flex items-center justify-between text-white pointer-events-auto">
          <button
            className="flex items-center space-x-2"
            onClick={() => navigate(`/profile/${post.user_profiles?.username}`)}
          >
            <div className="w-10 h-10 rounded-full bg-muted overflow-hidden border-2 border-white/20">
              {post.user_profiles?.avatar_url ? (
                <img src={post.user_profiles.avatar_url} alt={post.user_profiles.username} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-sm font-bold bg-white/20">
                  {post.user_profiles?.username?.[0]?.toUpperCase()}
                </div>
              )}
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="font-bold text-sm">{post.user_profiles?.username}</span>
                {post.user_profiles?.verified && (
                  <BadgeCheck className="w-3.5 h-3.5 text-primary" fill="currentColor" />
                )}
                {isAuthorPremium && (
                  <Crown className="w-3.5 h-3.5 text-amber-400" fill="currentColor" title="Premium" />
                )}
              </div>
              {post.is_monetized && (
                <div className="flex items-center gap-0.5 text-xs text-green-400">
                  <DollarSign className="w-3 h-3" />
                  <span>Monetized</span>
                </div>
              )}
            </div>
          </button>

          {/* Follow button — hidden for own posts */}
          {!isOwnPost && (
            <button
              onClick={handleFollow}
              disabled={followLoading}
              style={{ touchAction: 'manipulation', minWidth: 44, minHeight: 44 }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full font-bold text-xs transition-all active:scale-95 ${
                isFollowing
                  ? 'bg-white/20 text-white border border-white/40'
                  : 'bg-white text-black hover:bg-white/90'
              }`}
            >
              {followLoading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : isFollowing ? (
                <><UserCheck className="w-3.5 h-3.5" /> Following</>
              ) : (
                <><UserPlus className="w-3.5 h-3.5" /> Follow</>
              )}
            </button>
          )}
        </div>

        {/* Center: play icon when paused */}
        {!isPlaying && !showPrerollAd && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-16 h-16 bg-black/50 rounded-full flex items-center justify-center">
              <Play className="w-8 h-8 text-white ml-1" fill="currentColor" />
            </div>
          </div>
        )}

        {/* Bottom: caption + action buttons */}
        <div className="flex justify-between items-end text-white pointer-events-auto pb-14">
          <div className="flex-1 pr-4">
            <div className="pointer-events-auto">
              <p className="text-sm leading-snug font-semibold">
                {captionExpanded
                  ? renderCaption(post.content ?? '')
                  : renderShortCaption(post.content ?? '')}
              </p>
              {captionExpanded && (post.content ?? '').length > 120 && (
                <button
                  className="text-white/50 text-xs mt-0.5 active:text-white"
                  onClick={e => { e.stopPropagation(); setCaptionExpanded(false); }}
                >
                  less
                </button>
              )}
            </div>
          </div>

          <div className="flex flex-col space-y-4">
            {/* Like — one-time only */}
            <button
              onClick={triggerLike}
              style={{ touchAction: 'manipulation' }}
              className="flex flex-col items-center space-y-1 text-white hover:scale-110 active:scale-95 transition-transform"
            >
              <div className={`w-12 h-12 rounded-full flex items-center justify-center ${isLiked ? 'bg-pink-600' : 'bg-black/50'}`}>
                <Heart className={`w-6 h-6 ${isLiked ? 'fill-current' : ''}`} />
              </div>
              <span className="text-sm font-semibold">{formatNumber(likesCount)}</span>
            </button>

            {/* Comments */}
            <button
              onClick={openComments}
              style={{ touchAction: 'manipulation' }}
              className="flex flex-col items-center space-y-1 text-white hover:scale-110 active:scale-95 transition-transform"
            >
              <div className="w-12 h-12 rounded-full bg-black/50 flex items-center justify-center">
                <MessageCircle className="w-6 h-6" />
              </div>
              <span className="text-sm font-semibold">{formatNumber(repliesCount)}</span>
            </button>

            {/* Repost — opens sheet */}
            <button
              onClick={() => setShowRepostSheet(true)}
              style={{ touchAction: 'manipulation' }}
              className="flex flex-col items-center space-y-1 text-white hover:scale-110 active:scale-95 transition-transform"
            >
              <div className={`w-12 h-12 rounded-full flex items-center justify-center ${isReposted ? 'bg-green-600' : 'bg-black/50'}`}>
                <Repeat2 className="w-6 h-6" />
              </div>
              <span className="text-sm font-semibold">{formatNumber(repostsCount)}</span>
            </button>

            {/* Share */}
            <button
              onClick={() => setShowShareSheet(true)}
              style={{ touchAction: 'manipulation' }}
              className="flex flex-col items-center space-y-1 text-white hover:scale-110 active:scale-95 transition-transform"
            >
              <div className="w-12 h-12 rounded-full bg-black/50 flex items-center justify-center">
                <Share className="w-6 h-6" />
              </div>
            </button>

            {/* Bookmark */}
            <button
              onClick={handleBookmark}
              style={{ touchAction: 'manipulation' }}
              className="flex flex-col items-center space-y-1 text-white hover:scale-110 active:scale-95 transition-transform"
            >
              <div className={`w-12 h-12 rounded-full flex items-center justify-center ${
                isBookmarked ? 'bg-yellow-500' : 'bg-black/50'
              }`}>
                {isBookmarked
                  ? <BookmarkCheck className="w-6 h-6 fill-current" />
                  : <Bookmark className="w-6 h-6" />}
              </div>
            </button>
          </div>
        </div>
      </div>

      {/* ── Comment sheet — sits ABOVE the bottom nav bar ───────────────────── */}
      {showComments && (
        <div
          className="absolute inset-x-0 z-40 flex flex-col"
          style={{
            bottom: 'calc(64px + env(safe-area-inset-bottom, 0px))',
            height: 'calc(70vh - 64px - env(safe-area-inset-bottom, 0px))',
          }}
        >
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowComments(false)} style={{ zIndex: -1 }} />
          <div className="relative flex flex-col h-full bg-[#111] rounded-t-2xl overflow-hidden border-t border-white/10">
            {/* Header */}
            <div className="flex items-center justify-between px-4 pt-3 pb-2 border-b border-white/10 shrink-0">
              <span className="text-white font-bold text-sm">{repliesCount} Comment{repliesCount !== 1 ? 's' : ''}</span>
              <button onClick={() => setShowComments(false)} className="p-1.5 rounded-full text-white/60 hover:text-white hover:bg-white/10">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Comment list */}
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
              {commentsLoading ? (
                <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-white/40" /></div>
              ) : comments.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 gap-2 text-white/40">
                  <MessageCircle className="w-8 h-8" />
                  <p className="text-sm">No comments yet. Be the first!</p>
                </div>
              ) : comments.map(c => (
                <div key={c.id} className="flex gap-3">
                  <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center shrink-0 overflow-hidden">
                    {c.user_profiles?.avatar_url
                      ? <img src={c.user_profiles.avatar_url} alt={c.user_profiles.username} className="w-full h-full object-cover" />
                      : <span className="text-xs font-bold text-white/60">{c.user_profiles?.username?.[0]?.toUpperCase() ?? '?'}</span>}
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="text-white/80 font-semibold text-xs mr-2">{c.user_profiles?.username ?? 'User'}</span>
                    <span className="text-white text-sm break-words">{c.content}</span>
                  </div>
                </div>
              ))}
            </div>

            {/* Reply input */}
            <div className="shrink-0 flex items-center gap-2 px-4 py-3 border-t border-white/10 bg-[#0a0a0a]">
              <input
                value={newComment}
                onChange={e => setNewComment(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitComment(); } }}
                placeholder="Add a comment…"
                className="flex-1 bg-white/10 text-white placeholder-white/30 rounded-full px-4 py-2 text-sm outline-none focus:ring-1 focus:ring-white/30"
              />
              <button
                onClick={submitComment}
                disabled={!newComment.trim() || posting}
                className="w-9 h-9 flex items-center justify-center rounded-full bg-white text-black disabled:opacity-40 active:scale-95 transition-all"
              >
                {posting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Repost sheet ─────────────────────────────────────────────────── */}
      {showRepostSheet && (
        <div className="absolute inset-x-0 bottom-0 z-40">
          <div className="absolute inset-x-0 bottom-0 top-[-100vh] bg-black/40 backdrop-blur-sm" onClick={() => setShowRepostSheet(false)} />
          <div
            className="relative bg-[#111] rounded-t-2xl border-t border-white/10 px-4 pt-4 pb-6"
            style={{ paddingBottom: 'calc(24px + env(safe-area-inset-bottom, 0px))' }}
          >
            <div className="w-10 h-1 bg-white/20 rounded-full mx-auto mb-4" />
            <h3 className="text-white font-bold text-base mb-4">Repost</h3>
            <div className="space-y-2">
              <button
                onClick={handleRepost}
                className="w-full flex items-center gap-4 p-4 rounded-2xl bg-white/5 hover:bg-white/10 active:bg-white/15 transition-colors text-left"
              >
                <div className={`w-10 h-10 rounded-full flex items-center justify-center ${isReposted ? 'bg-green-600' : 'bg-white/10'}`}>
                  <Repeat2 className="w-5 h-5 text-white" />
                </div>
                <div>
                  <p className="text-white font-semibold text-sm">{isReposted ? 'Undo Repost' : 'Repost'}</p>
                  <p className="text-white/50 text-xs">{isReposted ? 'Remove from your profile' : 'Share instantly to your followers'}</p>
                </div>
              </button>
              <button
                onClick={handleQuote}
                className="w-full flex items-center gap-4 p-4 rounded-2xl bg-white/5 hover:bg-white/10 active:bg-white/15 transition-colors text-left"
              >
                <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center">
                  <Quote className="w-5 h-5 text-white" />
                </div>
                <div>
                  <p className="text-white font-semibold text-sm">Quote</p>
                  <p className="text-white/50 text-xs">Add your own thoughts to this post</p>
                </div>
              </button>
              {post.is_video && post.video_url && (
                <button
                  onClick={handleDuet}
                  className="w-full flex items-center gap-4 p-4 rounded-2xl bg-white/5 hover:bg-white/10 active:bg-white/15 transition-colors text-left"
                >
                  <div className="w-10 h-10 rounded-full bg-sky-500/20 flex items-center justify-center">
                    <Layers className="w-5 h-5 text-sky-400" />
                  </div>
                  <div>
                    <p className="text-white font-semibold text-sm">Duet / Stitch</p>
                    <p className="text-white/50 text-xs">Record your reaction alongside this video</p>
                  </div>
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Share sheet ───────────────────────────────────────────────────── */}
      {showShareSheet && (
        <div className="absolute inset-x-0 bottom-0 z-40">
          <div className="absolute inset-x-0 bottom-0 top-[-100vh] bg-black/40 backdrop-blur-sm" onClick={() => setShowShareSheet(false)} />
          <div
            className="relative bg-[#111] rounded-t-2xl border-t border-white/10 px-4 pt-4"
            style={{ paddingBottom: 'calc(24px + env(safe-area-inset-bottom, 0px))' }}
          >
            <div className="w-10 h-1 bg-white/20 rounded-full mx-auto mb-4" />
            <h3 className="text-white font-bold text-base mb-4">Share</h3>
            <div className="space-y-2">
              <button
                onClick={handleCopyLink}
                className="w-full flex items-center gap-4 p-4 rounded-2xl bg-white/5 hover:bg-white/10 active:bg-white/15 transition-colors text-left"
              >
                <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center">
                  {linkCopied ? <Check className="w-5 h-5 text-green-400" /> : <Copy className="w-5 h-5 text-white" />}
                </div>
                <div>
                  <p className="text-white font-semibold text-sm">{linkCopied ? 'Link Copied!' : 'Copy Link'}</p>
                  <p className="text-white/50 text-xs truncate max-w-[240px]">{`/post/${post.id}`}</p>
                </div>
              </button>
              {typeof navigator !== 'undefined' && 'share' in navigator && (
                <button
                  onClick={handleNativeShare}
                  className="w-full flex items-center gap-4 p-4 rounded-2xl bg-white/5 hover:bg-white/10 active:bg-white/15 transition-colors text-left"
                >
                  <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center">
                    <Share className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <p className="text-white font-semibold text-sm">Share via…</p>
                    <p className="text-white/50 text-xs">WhatsApp, Telegram, Messages…</p>
                  </div>
                </button>
              )}
              <button
                onClick={() => { setShowShareSheet(false); navigate(`/messages?share_url=${encodeURIComponent(getPostUrl())}`); }}
                className="w-full flex items-center gap-4 p-4 rounded-2xl bg-white/5 hover:bg-white/10 active:bg-white/15 transition-colors text-left"
              >
                <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center">
                  <MessageCircle className="w-5 h-5 text-white" />
                </div>
                <div>
                  <p className="text-white font-semibold text-sm">Send to DM</p>
                  <p className="text-white/50 text-xs">Share privately with a follower</p>
                </div>
              </button>
              {/* Download video — hidden on iOS Safari where blob download is blocked */}
              {post.is_video && post.video_url && (
                <button
                  onClick={handleDownload}
                  disabled={downloading}
                  className="w-full flex items-center gap-4 p-4 rounded-2xl bg-white/5 hover:bg-white/10 active:bg-white/15 transition-colors text-left disabled:opacity-60"
                >
                  <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center">
                    {downloading ? <Loader2 className="w-5 h-5 text-white animate-spin" /> : <Download className="w-5 h-5 text-white" />}
                  </div>
                  <div>
                    <p className="text-white font-semibold text-sm">{downloading ? 'Downloading…' : 'Download Video'}</p>
                    <p className="text-white/50 text-xs">Save to your device</p>
                  </div>
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Keyframe for heart scale-up animation */}
      <style>{`
        @keyframes scale-up {
          0%   { transform: scale(0.5); opacity: 0.8; }
          60%  { transform: scale(1.4); opacity: 0.6; }
          100% { transform: scale(1.8); opacity: 0; }
        }
      `}</style>
    </div>
  );
}
