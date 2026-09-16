import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useIsRegulator } from '@/hooks/useFeatureUnlock';
import { TopBar } from '@/components/layout/TopBar';
import { PostCard } from '@/components/features/PostCard';
import { EditProfileDialog } from '@/components/features/EditProfileDialog';
import { RevenueAnalyticsWidget } from '@/components/features/RevenueAnalyticsWidget';
import { StoryHighlights } from '@/components/features/StoryHighlights';
import CreatorMonetizationHub, { SubscriptionTiersDisplay, TipGoalWidget, SubscriberBadge } from '@/components/features/CreatorMonetizationHub';
import { Calendar, MapPin, Link as LinkIcon, BadgeCheck, Loader2, Twitter, Instagram, Linkedin, MessageCircle, Globe, ShieldCheck, X, Trophy, Flame, DollarSign, Gift, Check, Share2, Copy, Plus, Star, Eye, Crown, Sparkles, MoreHorizontal, Ban, VolumeX, Volume2, Flag, Send, Rss, Play, Heart, BookOpen, ChevronRight, Headphones, Clock, Users, Pencil, ExternalLink } from 'lucide-react';
import { sendActivityNotification } from '@/components/layout/AuthProvider';
import { toast } from 'sonner';
import { useSEO, buildProfileLD, buildOgImageUrl } from '@/hooks/useSEO';
import { usePremium } from '@/hooks/usePremium';
import { formatDistanceToNow } from 'date-fns';
import { formatNumber } from '@/lib/utils';
import { Post } from '@/types/app-types';
import { PageAdBanner } from '@/components/features/AdSenseAd';
import { AreaChart, Area, XAxis, Tooltip, ResponsiveContainer } from 'recharts';

function ProfileAdBanner() { return <PageAdBanner />; }

function ProfileSkeleton() {
  return (
    <div className="min-h-screen bg-background pb-16 md:pb-0">
      <div className="h-12 border-b border-border flex items-center px-4 gap-3">
        <div className="w-8 h-8 rounded-full bg-muted animate-pulse" />
        <div className="w-28 h-4 bg-muted rounded-lg animate-pulse" />
      </div>
      <div className="border-b border-border animate-pulse">
        <div className="h-36 bg-muted" />
        <div className="px-4 pb-4">
          <div className="flex justify-between items-start -mt-12 mb-4">
            <div className="w-24 h-24 rounded-full bg-muted border-4 border-background shrink-0" />
            <div className="flex gap-2 mt-6">
              <div className="w-24 h-9 bg-muted rounded-full" />
              <div className="w-9 h-9 bg-muted rounded-full" />
            </div>
          </div>
          <div className="space-y-2.5 mb-4">
            <div className="h-6 w-36 bg-muted rounded-lg" />
            <div className="h-3.5 w-24 bg-muted rounded-lg" />
            <div className="h-3.5 w-full bg-muted rounded-lg" />
            <div className="h-3.5 w-3/4 bg-muted rounded-lg" />
          </div>
          <div className="flex gap-4 mt-3">
            <div className="h-3.5 w-24 bg-muted rounded-lg" />
            <div className="h-3.5 w-24 bg-muted rounded-lg" />
          </div>
        </div>
      </div>
      <div className="flex border-b border-border overflow-x-auto">
        {['Posts','Threads','Media','Videos','Likes'].map(t => (
          <div key={t} className="shrink-0 px-4 py-4 animate-pulse">
            <div className="h-3 w-10 bg-muted rounded" />
          </div>
        ))}
      </div>
      <div className="divide-y divide-border">
        {[1,2,3].map(i => (
          <div key={i} className="p-4 animate-pulse flex gap-3">
            <div className="w-10 h-10 rounded-full bg-muted shrink-0" />
            <div className="flex-1 space-y-2 pt-1">
              <div className="flex gap-2">
                <div className="h-3 w-24 bg-muted rounded" />
                <div className="h-3 w-16 bg-muted/60 rounded" />
              </div>
              <div className="h-3.5 w-full bg-muted rounded" />
              <div className="h-3.5 w-5/6 bg-muted rounded" />
              <div className="flex gap-6 pt-1">
                {[1,2,3,4].map(j => <div key={j} className="h-3 w-8 bg-muted/60 rounded" />)}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Module-level helpers — esbuild guard (no index-sig objects, no IIFEs in render) ──
function fmtRecDuration(secs: number): string | null {
  if (!secs || secs < 1) return null;
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
function fmtPodTotalDur(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
function getPodcastRssUrl(username: string) {
  return `${import.meta.env.VITE_SUPABASE_URL?.replace('/v1', '')}/functions/v1/podcast-rss?username=${username}`;
}

// Pure helpers replacing Record<string,T> index-sig objects in render (esbuild guard)
function getCreatorTierBg(tier: string): string {
  if (tier === 'gold') return 'from-yellow-500/20 to-amber-400/10';
  if (tier === 'silver') return 'from-slate-400/20 to-gray-300/10';
  return 'from-amber-600/20 to-orange-400/10';
}
function getCreatorTierBorder(tier: string): string {
  if (tier === 'gold') return 'border-yellow-400/40';
  if (tier === 'silver') return 'border-slate-400/40';
  return 'border-amber-500/40';
}
function getCreatorTierText(tier: string): string {
  if (tier === 'gold') return 'text-yellow-600 dark:text-yellow-400';
  if (tier === 'silver') return 'text-slate-600 dark:text-slate-300';
  return 'text-amber-700 dark:text-amber-400';
}
function getCreatorTierIcon(tier: string): string {
  if (tier === 'gold') return '🥇';
  if (tier === 'silver') return '🥈';
  return '🥉';
}
function getCreatorTierLabel(tier: string): string {
  if (tier === 'gold') return 'Gold';
  if (tier === 'silver') return 'Silver';
  if (tier === 'bronze') return 'Bronze';
  return '';
}

// ── Inline Social Links Editor ────────────────────────────────────────────────
// esbuild guard: module-level component — no inline objects in render
function SocialLinksEditor({
  userId,
  twitterHandle,
  instagramHandle,
  linkedinUrl,
  onSaved,
}: {
  userId: string;
  twitterHandle: string | null;
  instagramHandle: string | null;
  linkedinUrl: string | null;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [tw, setTw] = useState(twitterHandle ?? '');
  const [ig, setIg] = useState(instagramHandle ?? '');
  const [li, setLi] = useState(linkedinUrl ?? '');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    const cleanTw = tw.trim().replace(/^@/, '') || null;
    const cleanIg = ig.trim().replace(/^@/, '') || null;
    const cleanLi = li.trim() || null;
    const { error } = await supabase.from('profiles').update({ social_links: { twitter: cleanTw, instagram: cleanIg, linkedin: cleanLi } }).eq('id', userId);
    setSaving(false);
    if (error) { toast.error('Failed to save social links'); return; }
    toast.success('Social links updated!');
    setOpen(false);
    onSaved();
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-dashed border-primary/30 bg-primary/5 hover:bg-primary/10 text-primary text-xs font-semibold transition-colors"
      >
        <Pencil className="w-3 h-3" /> Edit Social Links
      </button>
    );
  }

  return (
    <div className="rounded-2xl border border-primary/20 bg-primary/5 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-bold">Social Links</p>
        <button onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
      </div>
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Twitter className="w-4 h-4 text-sky-500 shrink-0" />
          <input
            type="text"
            value={tw}
            onChange={e => setTw(e.target.value)}
            placeholder="Twitter / X handle (without @)"
            className="flex-1 h-9 px-3 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>
        <div className="flex items-center gap-2">
          <Instagram className="w-4 h-4 text-pink-500 shrink-0" />
          <input
            type="text"
            value={ig}
            onChange={e => setIg(e.target.value)}
            placeholder="Instagram handle (without @)"
            className="flex-1 h-9 px-3 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>
        <div className="flex items-center gap-2">
          <Linkedin className="w-4 h-4 text-blue-600 shrink-0" />
          <input
            type="url"
            value={li}
            onChange={e => setLi(e.target.value)}
            placeholder="https://linkedin.com/in/yourname"
            className="flex-1 h-9 px-3 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>
      </div>
      <button
        onClick={handleSave}
        disabled={saving}
        className="w-full py-2 bg-primary text-primary-foreground rounded-xl font-semibold text-sm disabled:opacity-50 hover:opacity-90 transition-opacity"
      >
        {saving ? 'Saving…' : 'Save Social Links'}
      </button>
    </div>
  );
}

export default function ProfilePage() {
  const { username } = useParams();
  const { user: currentUser } = useAuth();
  const navigate = useNavigate();
  // ── CRITICAL: All hooks must be at top level — never after conditional returns ──
  const isRegulator = useIsRegulator();
  const { isActive: isPremiumUser } = usePremium();

  const [profile, setProfile] = useState(null as any);

  // ── CRITICAL: isOwnProfile must be at top level (before any useEffect/useCallback)
  // because it's referenced in dependency arrays. Using optional chaining since
  // profile is null initially — this avoids TDZ ReferenceError (blank screen).
  // DO NOT move this below any conditional return.
  const isOwnProfile = !!currentUser && !!profile && currentUser.id === profile.id;
  const [posts, setPosts] = useState([] as Post[]);
  const [threads, setThreads] = useState([]);
  const [replies, setReplies] = useState([]);
  const [media, setMedia] = useState([]);
  const [likedPosts, setLikedPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('Posts');
  const [isFollowing, setIsFollowing] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [verifyBannerDismissed, setVerifyBannerDismissed] = useState(false);
  const [followers, setFollowers] = useState([]);
  const [following, setFollowing] = useState([]);
  const [streakDay, setStreakDay] = useState(0);
  const [followerRank, setFollowerRank] = useState(null as number | null);
  const [referralCopied, setReferralCopied] = useState(false);
  const [profileShared, setProfileShared] = useState(false);
  const [fedHandleCopied, setFedHandleCopied] = useState(false);
  const [hasActorRecord, setHasActorRecord] = useState(false);
  const [isBlocked, setIsBlocked] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [showGiftPremiumDialog, setShowGiftPremiumDialog] = useState(false);
  const [giftingPremium, setGiftingPremium] = useState(false);
  const [showTipDialog, setShowTipDialog] = useState(false);
  const [tipAmount, setTipAmount] = useState(null as number | null);
  const [customTipAmount, setCustomTipAmount] = useState('');
  const [sendingTip, setSendingTip] = useState(false);
  const [tipSent, setTipSent] = useState(false);
  const [highlights, setHighlights] = useState([]);
  // highlights view counts — plain number array to avoid index-sig type (esbuild guard)
  const [highlightIds, setHighlightIds] = useState([] as string[]);
  const [highlightCounts, setHighlightCounts] = useState([] as number[]);
  const [showCreateHighlight, setShowCreateHighlight] = useState(false);
  const [highlightTitle, setHighlightTitle] = useState('');
  const [draggingHighlightIdx, setDraggingHighlightIdx] = useState(null as number | null);
  const [dragOverHighlightIdx, setDragOverHighlightIdx] = useState(null as number | null);
  const [highlightCoverUrl, setHighlightCoverUrl] = useState(null as string | null);
  const [availableStories, setAvailableStories] = useState([]);
  const [creatingHighlight, setCreatingHighlight] = useState(false);
  const [selectedStoryIds, setSelectedStoryIds] = useState([] as string[]);
  const [viewingHighlight, setViewingHighlight] = useState(null);
  const [highlightStories, setHighlightStories] = useState([]);
  const [highlightStoryIdx, setHighlightStoryIdx] = useState(0);
  const [highlightProgress, setHighlightProgress] = useState(0);
  const [loadingHighlightStories, setLoadingHighlightStories] = useState(false);
  const [tipHistory, setTipHistory] = useState([]);
  const [loadingTips, setLoadingTips] = useState(false);
  const [profileViews7d, setProfileViews7d] = useState(0);
  const [showSubscribeDialog, setShowSubscribeDialog] = useState(false);
  const [subscribing, setSubscribing] = useState(false);
  const [activeSubscription, setActiveSubscription] = useState(null);
  const [tipGoal, setTipGoal] = useState(null as number | null);
  const [currentMonthTips, setCurrentMonthTips] = useState(0);
  const [editingGoal, setEditingGoal] = useState(false);
  const [goalInput, setGoalInput] = useState('');
  const [topTippers, setTopTippers] = useState([] as { rank: number; amount: number }[]);
  const [giftHistory, setGiftHistory] = useState([]);
  const [loadingGifts, setLoadingGifts] = useState(false);
  const [profilePodcasts, setProfilePodcasts] = useState([]);
  const [loadingPodcasts, setLoadingPodcasts] = useState(false);
  const [podcastsFetched, setPodcastsFetched] = useState(false);
  const [profileSeries, setProfileSeries] = useState([]);
  const [loadingProfileSeries, setLoadingProfileSeries] = useState(false);
  const [profileSeriesFetched, setProfileSeriesFetched] = useState(false);
  const [postImpressionsChart, setPostImpressionsChart] = useState([] as { date: string; views: number }[]);
  const [pinnedPostId, setPinnedPostId] = useState(null as string | null);

  // ── Pull-to-Refresh ──────────────────────────────────────────────────────
  const [pullDistance, setPullDistance] = useState(0);
  const [isPulling, setIsPulling] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const touchStartYRef = useRef(0);
  const PULL_THRESHOLD = 64;

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const scrollTop = window.scrollY || document.documentElement.scrollTop;
    if (scrollTop > 0) return;
    touchStartYRef.current = e.touches[0].clientY;
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    const scrollTop = window.scrollY || document.documentElement.scrollTop;
    if (scrollTop > 0) { setPullDistance(0); setIsPulling(false); return; }
    const delta = e.touches[0].clientY - touchStartYRef.current;
    if (delta <= 0) { setPullDistance(0); setIsPulling(false); return; }
    const clamped = Math.min(delta * 0.45, PULL_THRESHOLD + 20);
    setPullDistance(clamped);
    setIsPulling(clamped >= PULL_THRESHOLD);
  }, []);

  const handleTouchEnd = useCallback(async () => {
    if (!isPulling || isRefreshing) { setPullDistance(0); setIsPulling(false); return; }
    setIsRefreshing(true);
    setPullDistance(PULL_THRESHOLD);
    setIsPulling(false);
    await fetchProfile();
    setIsRefreshing(false);
    setPullDistance(0);
  }, [isPulling, isRefreshing]);

  // Pure helper to get highlight view count by id (avoids index-sig map) — esbuild guard
  const getHighlightCount = (id: string): number => {
    const idx = highlightIds.indexOf(id);
    return idx >= 0 ? (highlightCounts[idx] ?? 0) : 0;
  };

  // ── Story Ring ─────────────────────────────────────────────────────────
  const [profileHasStories, setProfileHasStories] = useState(false);
  const [profileStoryGroupIdx, setProfileStoryGroupIdx] = useState(null as number | null);
  const [showProfileStories, setShowProfileStories] = useState(false);

  useEffect(() => {
    if (!profile?.id) return;
    // Check if this user has active (non-expired) stories
    supabase
      .from('stories')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', profile.id)
      .gt('expires_at', new Date().toISOString())
      .then(({ count }) => setProfileHasStories((count ?? 0) > 0));
  }, [profile?.id]);

  const checkBlockMuteStatus = async (profileId: string) => {
    if (!currentUser) return;
    const [{ data: blockRow }, { data: muteRow }] = await Promise.all([
      supabase.from('user_blocks').select('id').eq('blocker_id', currentUser.id).eq('blocked_id', profileId).maybeSingle(),
      supabase.from('user_mutes').select('id').eq('muter_id', currentUser.id).eq('muted_id', profileId).maybeSingle(),
    ]);
    setIsBlocked(!!blockRow);
    setIsMuted(!!muteRow);
  };

  const handleBlock = async () => {
    if (!currentUser || !profile) return;
    setShowMoreMenu(false);
    if (isBlocked) {
      await supabase.from('user_blocks').delete().eq('blocker_id', currentUser.id).eq('blocked_id', profile.id);
      setIsBlocked(false);
      toast.success(`@${profile.username} unblocked`);
    } else {
      await supabase.from('user_blocks').insert({ blocker_id: currentUser.id, blocked_id: profile.id });
      if (isFollowing) {
        await supabase.from('follows').delete().eq('follower_id', currentUser.id).eq('following_id', profile.id);
        setIsFollowing(false);
      }
      setIsBlocked(true);
      toast.success(`@${profile.username} blocked`);
    }
  };

  const handleMute = async () => {
    if (!currentUser || !profile) return;
    setShowMoreMenu(false);
    if (isMuted) {
      await supabase.from('user_mutes').delete().eq('muter_id', currentUser.id).eq('muted_id', profile.id);
      setIsMuted(false);
      toast.success(`@${profile.username} unmuted`);
    } else {
      await supabase.from('user_mutes').insert({ muter_id: currentUser.id, muted_id: profile.id });
      setIsMuted(true);
      toast.success(`@${profile.username} muted — their posts won't appear in your feed`);
    }
  };

  const handleGiftPremium = async () => {
    if (!currentUser || !profile) return;
    const GIFT_PRICE = 4.99;
    setGiftingPremium(true);
    try {
      const { error: deductErr } = await supabase.rpc('deduct_from_wallet', { p_user_id: currentUser.id, p_amount: GIFT_PRICE });
      if (deductErr) { toast.error(`Insufficient wallet balance. You need $${GIFT_PRICE} to gift premium.`); return; }
      const expiresAt = new Date();
      expiresAt.setMonth(expiresAt.getMonth() + 1);
      const { error } = await supabase.from('premium_subscriptions').upsert({
        user_id: profile.id, plan: 'monthly', status: 'active', price: GIFT_PRICE,
        started_at: new Date().toISOString(), expires_at: expiresAt.toISOString(),
      }, { onConflict: 'user_id' });
      if (error) throw error;
      await supabase.from('platform_inbox').insert({
        user_id: profile.id, subject: '🎁 Someone gifted you Premium!',
        body: `@${currentUser.username} gifted you 1 month of Premium! Enjoy an ad-free experience until ${expiresAt.toLocaleDateString()}.`,
        type: 'update', icon_emoji: '👑', cta_label: 'View Premium Benefits', cta_url: '/premium',
      }).catch(() => {});
      await supabase.from('notifications').insert({ recipient_id: profile.id, kind: 'tip', actor_id: currentUser.id  }).catch(() => {});
      toast.success(`🎁 Premium gifted to @${profile.username} for 1 month!`);
      setShowGiftPremiumDialog(false);
    } catch (err: any) {
      toast.error(err.message || 'Failed to gift premium');
    } finally {
      setGiftingPremium(false);
    }
  };

  const handleSubscribe = async (tier: string, price: number) => {
    if (!currentUser) { navigate('/auth'); return; }
    setSubscribing(true);
    const { error: deductErr } = await supabase.rpc('deduct_from_wallet', { p_user_id: currentUser.id, p_amount: price });
    if (deductErr) { toast.error('Insufficient wallet balance. Top up your wallet first.'); setSubscribing(false); return; }
    const expiresAt = new Date();
    expiresAt.setMonth(expiresAt.getMonth() + 1);
    const { error } = await supabase.from('creator_subscriptions').upsert({
      creator_id: profile.id, subscriber_id: currentUser.id, tier, amount: price, status: 'active',
      expires_at: expiresAt.toISOString(),
    }, { onConflict: 'creator_id,subscriber_id' });
    if (error) { toast.error('Subscription failed'); setSubscribing(false); return; }
    await supabase.from('creator_earnings').insert({ user_id: profile.id, source: 'subscription', amount_cents: Math.round(price * 100), currency: 'USD', status: 'paid' }).then(() => {}).catch(() => {});
    await supabase.from('notifications').insert({ recipient_id: profile.id, kind: 'follow', actor_id: currentUser.id  }).catch(() => {});
    toast.success(`Subscribed to @${profile.username} on ${tier} tier!`);
    setActiveSubscription({ tier, price, status: 'active' });
    setShowSubscribeDialog(false);
    setSubscribing(false);
  };

  const handleUnsubscribe = async () => {
    if (!currentUser || !profile) return;
    await supabase.from('creator_subscriptions').update({ status: 'cancelled' }).eq('creator_id', profile.id).eq('subscriber_id', currentUser.id);
    setActiveSubscription(null);
    toast.success('Subscription cancelled');
  };

  const openHighlightViewer = async (h: any) => {
    if (!h.story_ids || h.story_ids.length === 0) { toast.error('No stories in this highlight'); return; }
    setLoadingHighlightStories(true);
    setViewingHighlight(h);
    const { data } = await supabase.from('stories').select('*').in('id', h.story_ids);
    setHighlightStories(data ?? []);
    setHighlightStoryIdx(0);
    setHighlightProgress(0);
    setLoadingHighlightStories(false);
  };

  const closeHighlightViewer = () => {
    setViewingHighlight(null);
    setHighlightStories([]);
    setHighlightStoryIdx(0);
    setHighlightProgress(0);
  };

  const trackProfileView = async (viewedUserId: string) => {
    if (!currentUser || currentUser.id === viewedUserId) return;
    await supabase.from('browsing_history').insert({ user_id: currentUser.id, profile_id: viewedUserId, view_type: 'profile' }).catch(() => {});
    // ── Profile View Notification: notify owner once per viewer per 24h (localStorage dedup) ──
    const notifKey = `ts-pv-notif-${viewedUserId}-${currentUser.id}`;
    try {
      const last = parseInt(localStorage.getItem(notifKey) ?? '0', 10);
      if (Date.now() - last < 86400000) return; // 24h cooldown
      localStorage.setItem(notifKey, String(Date.now()));
    } catch { return; }
    supabase.from('platform_inbox').insert({
      user_id: viewedUserId,
      subject: `@${currentUser.username} viewed your profile`,
      body: `@${currentUser.username} just visited your profile. They might be interested in your content!`,
      type: 'info',
      icon_emoji: '👀',
      cta_label: 'View their profile',
      cta_url: `/profile/${currentUser.username}`,
    }).catch(() => {});
  };

  const fetchProfileViews7d = async (userId: string) => {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { count } = await supabase.from('browsing_history').select('*', { count: 'exact', head: true }).eq('profile_id', userId).eq('view_type', 'profile').gte('created_at', sevenDaysAgo);
    setProfileViews7d(count ?? 0);
  };

  const fetchSubscription = async (creatorId: string) => {
    if (!currentUser) return;
    const { data } = await supabase.from('creator_subscriptions').select('*').eq('creator_id', creatorId).eq('subscriber_id', currentUser.id).eq('status', 'active').maybeSingle();
    setActiveSubscription(data ?? null);
  };

  const fetchTipGoal = async (userId: string) => {
    const { data: mon } = await supabase.from('user_monetization').select('total_earnings').eq('user_id', userId).maybeSingle();
    setTipGoal(null);
    const startOfMonth = new Date();
    startOfMonth.setDate(1); startOfMonth.setHours(0, 0, 0, 0);
    const { data: monthTips } = await supabase.from('tips').select('sender_id, amount_cents').eq('recipient_id', userId).gte('created_at', startOfMonth.toISOString()).order('amount', { ascending: false });
    const total = (monthTips ?? []).reduce((s: number, t: any) => s + Number(t.amount_cents ?? 0) / 100, 0);
    setCurrentMonthTips(total);
    // Use parallel arrays instead of index-sig objects (esbuild guard)
    const tipperIds: string[] = [];
    const tipperAmts: number[] = [];
    for (const t of (monthTips ?? [])) {
      const idx = tipperIds.indexOf(t.sender_id);
      if (idx >= 0) tipperAmts[idx] += Number(t.amount_cents ?? 0) / 100;
      else { tipperIds.push(t.sender_id); tipperAmts.push(Number(t.amount_cents ?? 0) / 100); }
    }
    const sorted = [...tipperAmts].sort((a, b) => b - a).slice(0, 3);
    setTopTippers(sorted.map((amount, i) => ({ rank: i + 1, amount })));
  };

  const handleSaveTipGoal = async () => {
    if (!currentUser || !profile) return;
    const goal = Number(goalInput);
    if (!goal || goal <= 0) return;
    toast.info('Tip goals are not part of the canonical monetization schema yet.'); return;
    setTipGoal(goal);
    setEditingGoal(false);
    toast.success('Tip goal saved! 🎯');
  };

  const fetchTipHistory = async (userId: string) => {
    setLoadingTips(true);
    const { data: tips } = await supabase.from('tips').select('*').or(`from_user_id.eq.${userId},to_user_id.eq.${userId}`).order('created_at', { ascending: false }).limit(50);
    if (!tips || tips.length === 0) { setTipHistory([]); setLoadingTips(false); return; }
    const allUids = tips.flatMap((t: any) => [t.sender_id, t.to_user_id]) as string[];
    const uids = allUids.filter((u: string, i: number) => allUids.indexOf(u) === i);
    const { data: profileRows } = await supabase.from('profiles').select('id, username, avatar_url').in('id', uids);
    // Use parallel arrays instead of index-sig objects (esbuild guard)
    const pIds: string[] = [];
    const pData: any[] = [];
    for (const p of (profileRows ?? [])) { pIds.push(p.id); pData.push(p); }
    const getP = (uid: string) => pData[pIds.indexOf(uid)];
    setTipHistory(tips.map((t: any) => ({ ...t, sender: getP(t.sender_id), recipient: getP(t.to_user_id) })));
    setLoadingTips(false);
  };

  const handleShareProfile = async () => {
    const url = `${window.location.origin}/profile/${profile.username}`;
    const shareText = `Check out @${profile.username} on Tsocial${profile.bio ? ': ' + profile.bio.slice(0, 80) : ''}!`;
    if (navigator.share) await navigator.share({ title: `@${profile.username} on Tsocial`, text: shareText, url }).catch(() => {});
    else await navigator.clipboard.writeText(url).catch(() => {});
    setProfileShared(true);
    setTimeout(() => setProfileShared(false), 2000);
  };

  useSEO({
    title: profile ? `@${profile.username} on Testagram` : 'Profile',
    description: profile ? (profile.bio?.slice(0, 155) || `Follow @${profile.username} on Testagram — ${profile.follower_count?.toLocaleString() ?? 0} followers`) : 'View profile on Testagram',
    image: profile ? buildOgImageUrl({ username: profile.username }) : undefined,
    url: profile ? `/profile/${profile.username}` : undefined,
    type: 'profile',
    keywords: profile ? `${profile.username}, testagram, social media, creator` : undefined,
    structuredData: profile ? buildProfileLD(profile) : undefined,
  });

  const fetchGiftHistory = async (userId: string) => {
    setLoadingGifts(true);
    const { data } = await supabase.from('premium_subscriptions').select('*').or(`user_id.eq.${userId}`).order('started_at', { ascending: false }).limit(50);
    if (!data || data.length === 0) { setGiftHistory([]); setLoadingGifts(false); return; }
    const { data: inbox } = await supabase.from('platform_inbox').select('body, sent_at, user_id').eq('user_id', userId).ilike('subject', '%gift%').order('sent_at', { ascending: false }).limit(30);
    setGiftHistory(data.map((sub: any) => ({
      ...sub,
      inboxHint: (inbox ?? []).find((m: any) => Math.abs(new Date(m.sent_at).getTime() - new Date(sub.started_at).getTime()) < 60000),
    })));
    setLoadingGifts(false);
  };

  const fetchProfilePodcasts = async (userId: string) => {
    if (podcastsFetched) return;
    setLoadingPodcasts(true);
    const { data } = await supabase.from('space_recordings').select('id, title, audio_url, video_url, has_video, duration, listener_count, created_at, spaces(title, artwork_url, category, episode_number, subscriber_only)').eq('user_id', userId).order('created_at', { ascending: false }).limit(30);
    setProfilePodcasts(data ?? []);
    setLoadingPodcasts(false);
    setPodcastsFetched(true);
  };

  const fetchPostImpressions = async (userId: string) => {
    const { data: userPosts } = await supabase.from('posts').select('id').eq('user_id', userId).limit(50);
    if (!userPosts || userPosts.length === 0) return;
    const since = new Date(Date.now() - 29 * 86400000).toISOString();
    const { data } = await supabase.from('browsing_history').select('created_at').in('post_id', userPosts.map((p: any) => p.id)).eq('view_type', 'post').gte('created_at', since);
    const days: { date: string; views: number }[] = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400000);
      days.push({ date: d.toISOString().split('T')[0].slice(5), views: 0 });
    }
    (data ?? []).forEach((r: any) => {
      const k = r.created_at?.split('T')[0]?.slice(5);
      const entry = days.find(d => d.date === k);
      if (entry) entry.views++;
    });
    setPostImpressionsChart(days);
  };

  const fetchProfileSeries = async (userId: string) => {
    if (profileSeriesFetched) return;
    setLoadingProfileSeries(true);
    const { data } = await supabase.from('post_series').select('*').eq('user_id', userId).eq('is_public', true).order('item_count', { ascending: false }).limit(20);
    setProfileSeries(data ?? []);
    setLoadingProfileSeries(false);
    setProfileSeriesFetched(true);
  };

  const togglePinPost = async (postId: string) => {
    if (!currentUser || !isOwnProfile) return;
    const newPinned = pinnedPostId === postId ? null : postId;
    setPinnedPostId(newPinned);
    if (newPinned) {
      localStorage.setItem(`pinned_post_${currentUser.id}`, newPinned);
      toast.success('Post pinned to your profile');
    } else {
      localStorage.removeItem(`pinned_post_${currentUser.id}`);
      toast.success('Post unpinned');
    }
  };

  useEffect(() => {
    if (isOwnProfile && currentUser) setPinnedPostId(localStorage.getItem(`pinned_post_${currentUser.id}`));
  }, [isOwnProfile, currentUser]);

  useEffect(() => { if (username) fetchProfile(); }, [username]);

  const fetchHighlights = async (userId: string) => {
    const { data } = await supabase.from('user_highlights').select('*').eq('user_id', userId).order('sort_order', { ascending: true });
    const list = data ?? [];
    setHighlights(list);
    const allStoryIds = list.flatMap((h: any) => h.story_ids ?? []) as string[];
    if (allStoryIds.length > 0) {
      const { data: viewData } = await supabase.from('story_views').select('story_id').in('story_id', allStoryIds);
      // Use parallel arrays (no index-sig map) — esbuild guard
      const ids: string[] = [];
      const counts: number[] = [];
      for (const h of list) {
        ids.push(h.id);
        counts.push((viewData ?? []).filter((v: any) => (h.story_ids ?? []).includes(v.story_id)).length);
      }
      setHighlightIds(ids);
      setHighlightCounts(counts);
    }
  };

  const updateHighlightOrder = async (newOrder: any[]) => {
    await Promise.all(newOrder.map((h, idx) => supabase.from('user_highlights').update({ sort_order: idx }).eq('id', h.id)));
  };

  const fetchAvailableStories = async (userId: string) => {
    const { data } = await supabase.from('stories').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(30);
    setAvailableStories(data ?? []);
  };

  const handleCreateHighlight = async () => {
    if (!currentUser || !highlightTitle.trim()) return;
    setCreatingHighlight(true);
    const autoCover = selectedStoryIds.length > 0 ? (availableStories.find((s: any) => s.id === selectedStoryIds[0])?.media_url ?? null) : null;
    const { error } = await supabase.from('user_highlights').insert({ user_id: currentUser.id, title: highlightTitle.trim(), cover_url: highlightCoverUrl ?? autoCover, story_ids: selectedStoryIds });
    if (error) { toast.error('Failed to create highlight'); }
    else {
      toast.success('Highlight created!');
      setShowCreateHighlight(false); setHighlightTitle(''); setHighlightCoverUrl(null); setSelectedStoryIds([]);
      fetchHighlights(currentUser.id);
    }
    setCreatingHighlight(false);
  };

  const handleDeleteHighlight = async (id: string) => {
    await supabase.from('user_highlights').delete().eq('id', id);
    setHighlights(prev => prev.filter(h => h.id !== id));
    toast.success('Highlight removed');
  };

  const handleSendTip = async () => {
    if (!currentUser || !profile) return;
    const amount = tipAmount ?? Number(customTipAmount);
    if (!amount || amount <= 0) { toast.error('Enter a valid tip amount'); return; }
    setSendingTip(true);
    const { data: wallet } = await supabase.from('user_wallets').select('balance').eq('user_id', currentUser.id).maybeSingle();
    if (!wallet || Number(wallet.balance) < amount) { toast.error('Insufficient wallet balance'); setSendingTip(false); return; }
    const { error: deductErr } = await supabase.rpc('deduct_from_wallet', { p_user_id: currentUser.id, p_amount: amount });
    if (deductErr) { toast.error('Could not deduct from wallet'); setSendingTip(false); return; }
    await supabase.rpc('add_to_wallet', { p_user_id: profile.id, p_amount: amount }).catch(() => {});
    await supabase.from('tips').insert({ sender_id: currentUser.id, recipient_id: profile.id, amount_cents: Math.round(amount * 100), currency: 'USD', provider: 'internal', status: 'completed' }).then(() => {}).catch(() => {});
    await supabase.from('creator_earnings').insert({ user_id: profile.id, source: 'tips', amount_cents: Math.round(amount * 100), currency: 'USD', status: 'paid' }).then(() => {}).catch(() => {});
    await supabase.from('notifications').insert({ recipient_id: profile.id, kind: 'tip', actor_id: currentUser.id  }).catch(() => {});
    toast.success(`$${amount.toFixed(2)} tip sent to @${profile.username}!`);
    setTipSent(true); setShowTipDialog(false); setTipAmount(null); setCustomTipAmount(''); setSendingTip(false);
    setTimeout(() => setTipSent(false), 3000);
  };

  useEffect(() => {
    if (!viewingHighlight || highlightStories.length === 0) { setHighlightProgress(0); return; }
    const story = highlightStories[highlightStoryIdx];
    if (!story || story.media_type === 'video') { setHighlightProgress(0); return; }
    setHighlightProgress(0);
    const start = Date.now();
    const DURATION = 5000;
    const iv = setInterval(() => {
      const pct = Math.min(((Date.now() - start) / DURATION) * 100, 100);
      setHighlightProgress(pct);
      if (pct >= 100) {
        clearInterval(iv);
        if (highlightStoryIdx < highlightStories.length - 1) setHighlightStoryIdx(p => p + 1);
        else closeHighlightViewer();
      }
    }, 50);
    return () => clearInterval(iv);
  }, [viewingHighlight, highlightStoryIdx, highlightStories]);

  useEffect(() => {
    if (!profile?.id) return;
    supabase.from('activitypub_actors').select('id', { count: 'exact', head: true }).eq('user_id', profile.id).then(({ count }) => setHasActorRecord((count ?? 0) > 0));
  }, [profile?.id]);

  useEffect(() => {
    if (profile && currentUser && profile.id !== currentUser.id) checkFollowStatus();
  }, [profile, currentUser]);

  const fetchProfile = async () => {
    try {
      const initialProfileQuery = username ? await supabase.from('profiles').select('*').eq('username', username).maybeSingle() : { data: null, error: null };
      let profileData = initialProfileQuery.data;
      if (!profileData && currentUser) {
        const ownProfileQuery = await supabase.from('profiles').select('*').eq('id', currentUser.id).maybeSingle();
        profileData = ownProfileQuery.data;
      }
      if (!profileData) throw initialProfileQuery.error ?? new Error('Canonical profile not found');
      const socialLinks = (profileData.social_links ?? {}) as { twitter?: string | null; instagram?: string | null; linkedin?: string | null };
      const { data: monetization } = await supabase.from('user_monetization').select('total_earnings').eq('user_id', profileData.id).maybeSingle();
      const normalizedProfile = { ...profileData, twitter_handle: socialLinks.twitter ?? null, instagram_handle: socialLinks.instagram ?? null, linkedin_url: socialLinks.linkedin ?? null, cover_image: profileData.cover_url ?? null, verified: profileData.verified_tier !== 'none', total_earnings: monetization?.total_earnings ?? 0 };
      setProfile(normalizedProfile);
      // Update meta tags inline (no IIFE in render — this is async data loading)
      const title = `@${profileData.username} on Testagram`;
      const desc = profileData.bio?.slice(0, 200) || `Follow @${profileData.username} on Testagram`;
      const img = profileData.avatar_url || `${window.location.origin}/app-icon.jpg`;
      const setM = (p: string, v: string) => { let el = document.querySelector(`meta[property="${p}"]`) as HTMLMetaElement | null; if (!el) { el = document.createElement('meta'); el.setAttribute('property', p); document.head.appendChild(el); } el.setAttribute('content', v); };
      document.title = title;
      setM('og:title', title); setM('og:description', desc); setM('og:image', img);
      setM('og:url', `${window.location.origin}/profile/${profileData.username}`);

      // Phase 1: critical path — posts + threads + media (renders the UI)
      await Promise.all([
        fetchPosts(profileData.id),
        fetchThreads(profileData.id),
        fetchMedia(profileData.id),
      ]);
      setLoading(false);
      // Phase 2: background loads — deferred, non-blocking
      Promise.all([
        fetchReplies(profileData.id),
        fetchLikedPosts(profileData.id),
        fetchFollowers(profileData.id),
        fetchFollowing(profileData.id),
        fetchProfileStats(profileData.id),
        fetchHighlights(profileData.id),
        fetchTipHistory(profileData.id),
        fetchTipGoal(profileData.id),
        fetchProfileViews7d(profileData.id),
        fetchSubscription(profileData.id),
        trackProfileView(profileData.id),
        fetchGiftHistory(profileData.id),
        fetchPostImpressions(profileData.id),
      ]).catch(() => {});
      if (currentUser && currentUser.id !== profileData.id) checkBlockMuteStatus(profileData.id);
    } catch (error) {
      console.error('Error fetching profile:', error);
      setLoading(false);
      navigate('/');
    }
  };

  // ── Post Impression Milestone Alerts (1K / 10K views) ──────────────────────
  const checkImpressionMilestones = async (userId: string, postList: Post[]) => {
    if (!currentUser || currentUser.id !== userId) return;
    const alertKey = `ts-impression-alerts-${userId}`;
    let alerted: string[] = [];
    try { alerted = JSON.parse(localStorage.getItem(alertKey) ?? '[]'); } catch { /* ignore */ }
    const toNotify: { postId: string; views: number; milestone: number }[] = [];
    const IMPRESSION_MILESTONES = [10000, 1000];
    for (const post of postList) {
      const views = post.views_count ?? 0;
      for (const m of IMPRESSION_MILESTONES) {
        if (views >= m) {
          const key = `${post.id}-${m}`;
          if (!alerted.includes(key)) { toNotify.push({ postId: post.id, views, milestone: m }); alerted.push(key); }
        }
      }
    }
    if (toNotify.length === 0) return;
    localStorage.setItem(alertKey, JSON.stringify(alerted));
    await Promise.allSettled(toNotify.map(({ postId, views, milestone }) =>
      supabase.from('platform_inbox').insert({
        user_id: userId,
        subject: `🎉 Your post hit ${milestone >= 10000 ? '10K' : '1K'} views!`,
        body: `One of your posts just crossed ${milestone.toLocaleString()} views (currently ${views.toLocaleString()}). Keep creating!`,
        type: 'update', icon_emoji: milestone >= 10000 ? '🚀' : '⭐',
        cta_label: 'View Post', cta_url: `/post/${postId}`,
      })
    ));
  };

  const fetchPosts = async (userId: string) => {
    const { data } = await supabase.from('posts').select('*, profiles!posts_user_id_fkey(*)').eq('user_id', userId).order('created_at', { ascending: false });
    const postList = data || [];
    setPosts(postList);
    // Fire milestone alerts asynchronously — won't block UI
    checkImpressionMilestones(userId, postList).catch(() => {});
  };
  const fetchThreads = async (userId: string) => {
    const { data } = await supabase.from('threads').select('*').eq('user_id', userId).eq('is_published', true).order('created_at', { ascending: false });
    setThreads(data || []);
  };
  const fetchReplies = async (userId: string) => {
    const { data } = await supabase.from('replies').select('*, posts(*, profiles!posts_user_id_fkey(*))').eq('user_id', userId).order('created_at', { ascending: false });
    setReplies(data || []);
  };
  const fetchMedia = async (userId: string) => {
    const { data } = await supabase.from('posts').select('*, profiles!posts_user_id_fkey(*)').eq('user_id', userId).or('image_url.not.is.null,video_url.not.is.null,media_urls.neq.[]').order('created_at', { ascending: false });
    setMedia(data || []);
  };
  const fetchLikedPosts = async (userId: string) => {
    const { data } = await supabase.from('post_likes').select('posts(*, profiles!posts_user_id_fkey(*))').eq('user_id', userId).order('created_at', { ascending: false });
    setLikedPosts((data || []).map((item: any) => item.posts).filter(Boolean));
  };
  const fetchFollowers = async (userId: string) => {
    const { data } = await supabase.from('follows').select('follower:profiles!follows_follower_id_fkey(*)').eq('following_id', userId);
    setFollowers((data || []).map((item: any) => item.follower).filter(Boolean));
  };
  const fetchProfileStats = async (userId: string) => {
    const { data: reward } = await supabase.from('daily_rewards').select('streak_day').eq('user_id', userId).maybeSingle();
    setStreakDay(reward?.streak_day ?? 0);
    const { data: pd } = await supabase.from('profiles').select('follower_count').eq('id', userId).maybeSingle();
    if (pd) {
      const { count } = await supabase.from('profiles').select('*', { count: 'exact', head: true }).gt('follower_count', pd.follower_count ?? 0);
      setFollowerRank((count ?? 0) + 1);
    }
  };
  const fetchFollowing = async (userId: string) => {
    const { data } = await supabase.from('follows').select('following:profiles!follows_following_id_fkey(*)').eq('follower_id', userId);
    setFollowing((data || []).map((item: any) => item.following).filter(Boolean));
  };
  const checkFollowStatus = async () => {
    if (!currentUser || !profile) return;
    const { data } = await supabase.from('follows').select('id').eq('follower_id', currentUser.id).eq('following_id', profile.id).single();
    setIsFollowing(!!data);
  };
  const handleFollow = async () => {
    if (!currentUser) { navigate('/auth'); return; }
    if (isFollowing) {
      await supabase.from('follows').delete().eq('follower_id', currentUser.id).eq('following_id', profile.id);
    } else {
      await supabase.from('follows').insert({ follower_id: currentUser.id, following_id: profile.id });
      await supabase.from('notifications').insert({ recipient_id: profile.id, kind: 'follow', actor_id: currentUser.id  });
      await sendActivityNotification({ recipientUserId: profile.id, title: 'New Follower', body: `${currentUser.username} started following you`, data: { route: `/profile/${currentUser.username}`, type: 'follow', fromUserId: currentUser.id } });
    }
    setIsFollowing(!isFollowing);
    fetchProfile();
  };
  const handleMessage = () => {
    if (!currentUser) { navigate('/auth'); return; }
    navigate(`/messages?to=${profile.username}`);
  };

  useEffect(() => { if (activeTab === 'Podcasts' && profile?.id && !podcastsFetched) fetchProfilePodcasts(profile.id); }, [activeTab, profile?.id, podcastsFetched]);
  useEffect(() => { if (activeTab === 'Series' && profile?.id && !profileSeriesFetched) fetchProfileSeries(profile.id); }, [activeTab, profile?.id, profileSeriesFetched]);

  if (loading) return <ProfileSkeleton />;

  if (!profile) return null;
  const videoPosts = posts.filter(p => p.is_video && p.video_url);
  // ── goalAchieved: MUST be declared before JSX — was missing, causing blank screen ──
  const goalAchieved = tipGoal !== null && tipGoal > 0 && currentMonthTips >= tipGoal;
  // ── Pre-computed values — esbuild guard: no IIFEs in render ──────────────
  const profileStrikes = profile?.strike_count ?? 0;
  const profileStrikesColor = profileStrikes === 0 ? 'text-green-600' : profileStrikes === 1 ? 'text-orange-500' : 'text-red-600';
  const profileStrikesBorderBg = profileStrikes === 0 ? 'border-green-500/20 bg-green-500/5' : profileStrikes === 1 ? 'border-orange-500/20 bg-orange-500/5' : 'border-red-500/20 bg-red-500/5';
  const profileVideoPosts = posts.filter(p => p.is_video);
  const profileTipsReceived = tipHistory.filter(t => t.to_user_id === profile?.id);
  const profileAchievementsAll = [
    { id: 'first_post',    emoji: '✍️', label: 'First Post',    unlocked: posts.length >= 1 },
    { id: 'verified',      emoji: '✅', label: 'Verified',       unlocked: !!profile?.verified },
    { id: 'video_creator', emoji: '🎬', label: 'Video Creator',  unlocked: profileVideoPosts.length >= 1 },
    { id: 'followers_100', emoji: '👥', label: '100 Followers',  unlocked: (profile?.follower_count ?? 0) >= 100 },
    { id: 'followers_1k',  emoji: '⭐', label: '1K Followers',   unlocked: (profile?.follower_count ?? 0) >= 1000 },
    { id: 'first_dollar',  emoji: '💰', label: 'First Dollar',   unlocked: Number(profile?.total_earnings ?? 0) >= 1 },
    { id: 'streak_7',      emoji: '🔥', label: '7-Day Streak',   unlocked: streakDay >= 7 },
    { id: 'tip_received',  emoji: '💝', label: 'Tip Received',   unlocked: profileTipsReceived.length >= 1 },
    { id: 'posts_10',      emoji: '📝', label: '10 Posts',       unlocked: posts.length >= 10 },
    { id: 'followers_10k', emoji: '🌟', label: '10K Followers',  unlocked: (profile?.follower_count ?? 0) >= 10000 },
  ];
  const profileAchievementsUnlocked = profileAchievementsAll.filter(a => a.unlocked);
  // Pre-computed podcast/series stats (no IIFE in render)
  const podTotalEps = profilePodcasts.length;
  const podTotalListeners = profilePodcasts.reduce((s: number, p: any) => s + (p.listener_count ?? 0), 0);
  const podTotalSecs = profilePodcasts.reduce((s: number, p: any) => s + (p.duration ?? 0), 0);
  // Pre-computed highlight viewer story — esbuild guard: no IIFE in render
  const viewerHighlightStory = viewingHighlight ? (highlightStories[highlightStoryIdx] ?? null) : null;
  const tabs = isOwnProfile
    ? ['Posts', 'Threads', 'Replies', 'Media', 'Videos', 'Podcasts', 'Series', 'Likes', 'Tips', 'Gifts', 'Followers', 'Following', 'Analytics']
    : ['Posts', 'Threads', 'Replies', 'Media', 'Videos', 'Podcasts', 'Series', 'Likes', 'Tips', 'Gifts', 'Followers', 'Following'];

  // ── Creator Tip Goal Progress Ring — visible on all profiles to all visitors —————
  // Fetched fresh from user_monetization + tips; goalAchieved triggers celebration badge
  const goalProgressPct = tipGoal && tipGoal > 0
    ? Math.min(Math.round((currentMonthTips / tipGoal) * 100), 100)
    : 0;
  const goalRemainingAmt = tipGoal && tipGoal > 0
    ? Math.max(0, tipGoal - currentMonthTips)
    : 0;

  return (
    <div
      className="min-h-screen bg-background pb-16 md:pb-0"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {/* Pull-to-Refresh Indicator */}
      <div
        className="overflow-hidden transition-all duration-300 flex items-center justify-center bg-background border-b border-border"
        style={{ height: pullDistance > 0 ? Math.min(pullDistance, PULL_THRESHOLD + 20) : isRefreshing ? PULL_THRESHOLD : 0 }}
      >
        <div className={`flex items-center gap-2 text-xs font-semibold text-primary transition-all ${
          isRefreshing ? 'opacity-100' : isPulling ? 'opacity-100' : 'opacity-60'
        }`}>
          <Loader2 className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : isPulling ? 'rotate-180' : ''} transition-transform duration-200`} />
          {isRefreshing ? 'Refreshing profile…' : isPulling ? 'Release to refresh' : 'Pull to refresh'}
        </div>
      </div>
      <TopBar title={profile.username} showBack />
      <ProfileAdBanner />

      <div className="border-b border-border">
        {profile.cover_image && (
          <div className="h-48 bg-muted overflow-hidden">
            <img src={profile.cover_image} alt="Cover" className="w-full h-full object-cover" />
          </div>
        )}

        <div className="px-4 pb-4">
          <div className="flex justify-between items-start -mt-16 mb-4">
            {/* Avatar — wrapped in gradient story ring when user has active stories */}
            <button
              className={`w-32 h-32 rounded-full border-4 border-background bg-muted overflow-hidden shrink-0 transition-all duration-200 ${
                profileHasStories
                  ? 'ring-4 ring-offset-2 ring-offset-background ring-transparent bg-gradient-to-br from-primary to-purple-500 p-0.5 cursor-pointer hover:scale-[1.03] active:scale-[0.98]'
                  : ''
              }`}
              onClick={() => { if (profileHasStories) setShowProfileStories(true); }}
              disabled={!profileHasStories}
              style={profileHasStories ? { background: 'linear-gradient(135deg, hsl(var(--primary)), #a855f7)', padding: '3px' } : undefined}
            >
              <div className="w-full h-full rounded-full overflow-hidden bg-muted">
                {profile.avatar_url
                  ? <img src={profile.avatar_url} alt={profile.username} className="w-full h-full object-cover" />
                  : <div className="w-full h-full flex items-center justify-center text-4xl font-bold">{profile.username[0].toUpperCase()}</div>}
              </div>
            </button>
            <div className="flex gap-2 mt-2 flex-wrap items-center">
              {isOwnProfile ? (
                <>
                  <button onClick={() => setShowEditDialog(true)} className="px-4 py-2 border border-border rounded-full font-semibold hover:bg-muted transition-colors">Edit profile</button>
                  <button onClick={handleShareProfile} className="p-2 border border-border rounded-full hover:bg-muted transition-colors text-muted-foreground hover:text-foreground">
                    {profileShared ? <Check className="w-4 h-4 text-green-500" /> : <Share2 className="w-4 h-4" />}
                  </button>
                </>
              ) : (
                <>
                  <button onClick={handleMessage} className="px-4 py-2 border border-border rounded-full font-semibold hover:bg-muted transition-colors flex items-center gap-2">
                    <MessageCircle className="w-4 h-4" />Message
                  </button>
                  <button onClick={() => setShowGiftPremiumDialog(true)} className="flex items-center gap-1.5 px-3 py-2 border border-amber-500/30 bg-amber-500/5 hover:bg-amber-500/10 text-amber-600 dark:text-amber-400 rounded-full font-semibold text-sm transition-colors">
                    <Crown className="w-3.5 h-3.5" />Gift Premium
                  </button>
                  <button onClick={() => navigate(`/wallet?tab=send&to=${profile.username}`)} className="flex items-center gap-1.5 px-3 py-2 border border-primary/30 bg-primary/5 hover:bg-primary/10 text-primary rounded-full font-semibold text-sm transition-colors">
                    <Send className="w-3.5 h-3.5" />Send
                  </button>
                  <button onClick={handleFollow} className={`px-4 py-2 rounded-full font-semibold transition-colors ${isFollowing ? 'border border-border hover:bg-muted' : 'bg-foreground text-background hover:opacity-90'}`}>
                    {isFollowing ? 'Following' : 'Follow'}
                  </button>
                  <button onClick={() => setShowTipDialog(true)} className={`p-2 border rounded-full transition-colors ${tipSent ? 'border-yellow-500/30 bg-yellow-500/10 text-yellow-500' : 'border-border hover:bg-yellow-500/10 hover:border-yellow-500/30 text-muted-foreground hover:text-yellow-600'}`}>
                    {tipSent ? <Check className="w-4 h-4 text-yellow-500" /> : <DollarSign className="w-4 h-4" />}
                  </button>
                  <div className="relative">
                    <button onClick={() => setShowMoreMenu(p => !p)} className="p-2 border border-border rounded-full hover:bg-muted transition-colors text-muted-foreground">
                      <MoreHorizontal className="w-4 h-4" />
                    </button>
                    {showMoreMenu && (
                      <>
                        <div className="fixed inset-0 z-40" onClick={() => setShowMoreMenu(false)} />
                        <div className="absolute right-0 mt-2 w-48 bg-background border border-border rounded-xl shadow-xl z-50 overflow-hidden">
                          <button onClick={handleMute} className="flex items-center gap-3 w-full px-4 py-3 hover:bg-muted text-left text-sm">
                            {isMuted ? <Volume2 className="w-4 h-4 text-primary" /> : <VolumeX className="w-4 h-4 text-muted-foreground" />}
                            {isMuted ? 'Unmute' : 'Mute'} @{profile.username}
                          </button>
                          <button onClick={handleBlock} className="flex items-center gap-3 w-full px-4 py-3 hover:bg-destructive/5 text-left text-sm text-destructive">
                            <Ban className="w-4 h-4" />{isBlocked ? 'Unblock' : 'Block'} @{profile.username}
                          </button>
                          <div className="border-t border-border" />
                          <button onClick={() => { setShowMoreMenu(false); toast.success('Report submitted'); }} className="flex items-center gap-3 w-full px-4 py-3 hover:bg-muted text-left text-sm text-muted-foreground">
                            <Flag className="w-4 h-4" />Report account
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                  {profile.is_creator && (
                    activeSubscription ? (
                      <button onClick={handleUnsubscribe} className="flex items-center gap-1.5 px-3 py-2 rounded-full border border-purple-500/30 bg-purple-500/10 text-purple-600 dark:text-purple-400 text-xs font-bold hover:bg-purple-500/20 transition-colors">
                        <Crown className="w-3.5 h-3.5" />{activeSubscription.tier} · Cancel
                      </button>
                    ) : (
                      <button onClick={() => setShowSubscribeDialog(true)} className="flex items-center gap-1.5 px-3 py-2 rounded-full bg-gradient-to-r from-purple-600 to-pink-600 text-white text-xs font-bold hover:opacity-90 transition-opacity shadow">
                        <Crown className="w-3.5 h-3.5" />Subscribe
                      </button>
                    )
                  )}
                  <button onClick={handleShareProfile} className="p-2 border border-border rounded-full hover:bg-muted transition-colors text-muted-foreground hover:text-foreground">
                    {profileShared ? <Check className="w-4 h-4 text-green-500" /> : <Share2 className="w-4 h-4" />}
                  </button>
                </>
              )}
            </div>
          </div>

          <div className="mb-3">
            <div className="flex items-center gap-2 mb-1">
              <h2 className="text-xl font-bold">{profile.username}</h2>
              {profile.verified && <BadgeCheck className="w-5 h-5 text-primary" fill="currentColor" />}
              {isRegulator && isOwnProfile && (
                <button onClick={() => navigate('/regulator')} className="flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-gradient-to-r from-violet-600/15 to-primary/10 border border-violet-500/30 text-[10px] font-black text-violet-600 dark:text-violet-400 hover:opacity-90 transition-opacity">
                  👑 Regulator
                </button>
              )}
              {(isOwnProfile ? isPremiumUser : false) && <Crown className="w-4 h-4 text-amber-500" fill="currentColor" title="Premium Member" />}
              {getCreatorTierLabel(profile.creator_tier) && (
                <span className={`flex items-center gap-1 px-2 py-0.5 rounded-full bg-gradient-to-r ${getCreatorTierBg(profile.creator_tier)} border ${getCreatorTierBorder(profile.creator_tier)} text-xs font-bold ${getCreatorTierText(profile.creator_tier)}`}>
                  <span>{getCreatorTierIcon(profile.creator_tier)}</span>{getCreatorTierLabel(profile.creator_tier)} Creator
                </span>
              )}
            </div>
            <p className="text-muted-foreground">@{profile.username}</p>
          </div>

          {profile.bio && <p className="mb-3 break-words">{profile.bio}</p>}

          {/* Achievements */}
          {profileAchievementsUnlocked.length > 0 && (
            <div className="mb-3">
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-xs font-bold text-muted-foreground uppercase tracking-wide">Achievements</span>
                <span className="text-[10px] bg-primary/10 text-primary font-bold px-1.5 py-0.5 rounded-full">{profileAchievementsUnlocked.length}/{profileAchievementsAll.length}</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {profileAchievementsAll.map(a => (
                  <div key={a.id} title={a.label} className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold border transition-all ${a.unlocked ? 'bg-primary/8 border-primary/20 text-foreground shadow-sm' : 'bg-muted/30 border-border text-muted-foreground/40 grayscale opacity-40'}`}>
                    <span>{a.emoji}</span>
                    <span className="hidden sm:inline">{a.label}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Tip Goal */}
          {(tipGoal !== null || isOwnProfile) && (
            <div className="mb-3 space-y-2">
              {!editingGoal ? (
                <div className={`rounded-2xl border p-3 transition-all ${goalAchieved ? 'border-yellow-400/60 bg-gradient-to-br from-yellow-500/15 to-amber-400/10 animate-pulse' : 'border-yellow-500/20 bg-yellow-500/5'}`}>
                  <div className="flex items-center gap-3">
                    {/* Enhanced circular SVG progress ring with milestone labels */}
                    <div className="relative w-14 h-14 shrink-0">
                      <svg className="w-14 h-14 -rotate-90" viewBox="0 0 56 56">
                        {/* Track */}
                        <circle cx="28" cy="28" r="23" fill="none" stroke="currentColor" strokeWidth="4" className="text-muted/30" />
                        {/* 25% / 50% / 75% milestone ticks */}
                        {[25, 50, 75].map(pct => {
                          const angle = ((pct / 100) * 2 * Math.PI) - Math.PI / 2;
                          const x1 = 28 + 19 * Math.cos(angle);
                          const y1 = 28 + 19 * Math.sin(angle);
                          const x2 = 28 + 23 * Math.cos(angle);
                          const y2 = 28 + 23 * Math.sin(angle);
                          return <line key={pct} x1={x1} y1={y1} x2={x2} y2={y2} stroke="currentColor" strokeWidth="2" className="text-muted-foreground/20" />;
                        })}
                        {/* Progress arc */}
                        <circle
                          cx="28" cy="28" r="23"
                          fill="none"
                          strokeWidth="4"
                          strokeLinecap="round"
                          stroke={goalAchieved ? '#fbbf24' : '#eab308'}
                          strokeDasharray={`${2 * Math.PI * 23}`}
                          strokeDashoffset={`${2 * Math.PI * 23 * (1 - goalProgressPct / 100)}`}
                          style={{ transition: 'stroke-dashoffset 0.8s cubic-bezier(0.4,0,0.2,1)' }}
                        />
                      </svg>
                      <span className="absolute inset-0 flex items-center justify-center text-[11px] font-black text-yellow-600">
                        {goalAchieved ? '🎉' : `${goalProgressPct}%`}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className="text-xs font-bold text-yellow-700 dark:text-yellow-400">Monthly Tip Goal</p>
                        {goalAchieved && <span className="text-[10px] font-black bg-amber-400/20 text-amber-600 px-1.5 py-0.5 rounded-full">REACHED! 🏆</span>}
                      </div>
                      <p className="text-sm font-bold text-foreground">${currentMonthTips.toFixed(2)}{tipGoal !== null && <span className="text-muted-foreground font-normal"> / ${tipGoal.toFixed(2)}</span>}</p>
                      {tipGoal !== null && tipGoal > 0 && !goalAchieved && (
                        <p className="text-[10px] text-muted-foreground mt-0.5">${goalRemainingAmt.toFixed(2)} to go</p>
                      )}
                      {tipGoal !== null && tipGoal > 0 && (
                        <div className="w-full bg-muted rounded-full h-1.5 mt-1 overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all duration-700 ${goalAchieved ? 'bg-gradient-to-r from-amber-400 to-yellow-300' : 'bg-gradient-to-r from-yellow-400 to-amber-500'}`}
                            style={{ width: `${goalProgressPct}%` }}
                          />
                        </div>
                      )}
                    </div>
                    {isOwnProfile && (
                      <button
                        onClick={() => { setGoalInput(String(tipGoal ?? '')); setEditingGoal(true); }}
                        className="text-xs text-yellow-600 hover:text-yellow-700 font-semibold px-2 py-1 rounded-lg hover:bg-yellow-500/10 transition-colors shrink-0"
                      >
                        {tipGoal ? 'Edit' : '+ Set Goal'}
                      </button>
                    )}
                  </div>
                  {topTippers.length > 0 && (
                    <div className="mt-3 pt-2.5 border-t border-yellow-500/15">
                      <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide mb-2">Top Supporters this month</p>
                      <div className="flex gap-2">
                        {topTippers.map(({ rank, amount }) => (
                          <div key={rank} className="flex-1 flex flex-col items-center gap-0.5 py-1.5 rounded-xl bg-yellow-500/8 border border-yellow-500/10">
                            <span className="text-base">{rank === 1 ? '🥇' : rank === 2 ? '🥈' : '🥉'}</span>
                            <span className="text-[10px] font-bold text-yellow-700 dark:text-yellow-400">${amount.toFixed(2)}</span>
                            <span className="text-[9px] text-muted-foreground">Tipper #{rank}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex items-center gap-2 p-3 rounded-2xl border border-yellow-500/30 bg-yellow-500/5">
                  <span className="text-yellow-600 font-bold text-sm">$</span>
                  <input type="number" min="1" step="1" value={goalInput} onChange={e => setGoalInput(e.target.value)} placeholder="Monthly goal (USD)" autoFocus
                    className="flex-1 bg-transparent text-sm focus:outline-none text-foreground placeholder:text-muted-foreground"
                    onKeyDown={e => { if (e.key === 'Enter') handleSaveTipGoal(); if (e.key === 'Escape') setEditingGoal(false); }} />
                  <button onClick={handleSaveTipGoal} className="text-xs bg-yellow-500 text-white px-3 py-1.5 rounded-lg font-bold hover:bg-yellow-600 transition-colors">Save</button>
                  <button onClick={() => setEditingGoal(false)} className="text-xs text-muted-foreground hover:text-foreground px-2 py-1.5">Cancel</button>
                </div>
              )}
            </div>
          )}

          {/* Story Highlights */}
          {/* StoryHighlights component */}
          {profile && (
            <StoryHighlights profileUserId={profile.id} isOwnProfile={isOwnProfile} />
          )}
          {(highlights.length > 0 || isOwnProfile) && (
            <div className="flex items-start gap-4 py-3 overflow-x-auto scrollbar-hide">
              {isOwnProfile && (
                <button onClick={() => { fetchAvailableStories(profile.id); setShowCreateHighlight(true); }} className="flex flex-col items-center gap-1.5 shrink-0 group">
                  <div className="w-16 h-16 rounded-full border-2 border-dashed border-muted-foreground/30 group-hover:border-primary/50 flex items-center justify-center transition-colors bg-muted/30">
                    <Plus className="w-6 h-6 text-muted-foreground group-hover:text-primary transition-colors" />
                  </div>
                  <span className="text-[10px] text-muted-foreground font-medium">New</span>
                </button>
              )}
              {highlights.map((h: any, hIdx: number) => {
                const viewCount = getHighlightCount(h.id);
                return (
                  <div key={h.id} draggable={isOwnProfile}
                    onDragStart={() => setDraggingHighlightIdx(hIdx)}
                    onDragOver={e => { e.preventDefault(); setDragOverHighlightIdx(hIdx); }}
                    onDragEnd={() => {
                      if (draggingHighlightIdx !== null && dragOverHighlightIdx !== null && draggingHighlightIdx !== dragOverHighlightIdx) {
                        const newOrder = [...highlights];
                        const [dragged] = newOrder.splice(draggingHighlightIdx, 1);
                        newOrder.splice(dragOverHighlightIdx, 0, dragged);
                        setHighlights(newOrder);
                        updateHighlightOrder(newOrder);
                      }
                      setDraggingHighlightIdx(null); setDragOverHighlightIdx(null);
                    }}
                    className={`flex flex-col items-center gap-1.5 shrink-0 transition-all duration-150 ${draggingHighlightIdx === hIdx ? 'opacity-40 scale-90' : ''} ${dragOverHighlightIdx === hIdx && draggingHighlightIdx !== hIdx ? 'scale-110' : ''}`}>
                    <div className="relative">
                      <button onClick={() => openHighlightViewer(h)} className="w-16 h-16 rounded-full ring-2 ring-offset-2 ring-offset-background ring-muted-foreground/20 hover:ring-primary/50 transition-all overflow-hidden bg-gradient-to-br from-primary/20 to-primary/40 flex items-center justify-center">
                        {h.cover_url ? <img src={h.cover_url} alt={h.title} className="w-full h-full object-cover" /> : <Star className="w-6 h-6 text-primary" />}
                      </button>
                      {isOwnProfile && viewCount > 0 && (
                        <div className="absolute -bottom-0.5 -right-0.5 flex items-center gap-0.5 bg-background border border-border rounded-full px-1.5 py-0.5 shadow-sm">
                          <Eye className="w-2.5 h-2.5 text-blue-500" />
                          <span className="text-[9px] font-bold text-blue-600">{viewCount > 999 ? `${(viewCount/1000).toFixed(1)}k` : viewCount}</span>
                        </div>
                      )}
                    </div>
                    <span className="text-[10px] font-medium max-w-[64px] truncate text-center">{h.title}</span>
                    {isOwnProfile && <button onClick={e => { e.stopPropagation(); handleDeleteHighlight(h.id); }} className="text-[10px] text-destructive hover:underline">Remove</button>}
                  </div>
                );
              })}
            </div>
          )}

          {/* Fediverse badge */}
          {hasActorRecord && profile.username && (
            <button onClick={() => { const handle = `@${profile.username}@testagram.site`; navigator.clipboard.writeText(handle).then(() => { setFedHandleCopied(true); setTimeout(() => setFedHandleCopied(false), 2000); }); }}
              className="mb-3 flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-purple-500/30 bg-purple-500/5 hover:bg-purple-500/10 transition-colors">
              <Globe className="w-3.5 h-3.5 text-purple-500" />
              <span className="text-xs font-mono font-semibold text-purple-600 dark:text-purple-400">@{profile.username}@testagram.site</span>
              {fedHandleCopied ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3 text-purple-400" />}
            </button>
          )}

          <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm text-muted-foreground mb-3">
            {profile.location && <div className="flex items-center gap-1"><MapPin className="w-4 h-4" /><span>{profile.location}</span></div>}
            {profile.website && (
              <a href={profile.website.startsWith('http') ? profile.website : `https://${profile.website}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-primary hover:underline">
                <LinkIcon className="w-4 h-4" /><span>{profile.website.replace(/^https?:\/\//, '')}</span>
              </a>
            )}
            <div className="flex items-center gap-1"><Calendar className="w-4 h-4" /><span>Joined {formatDistanceToNow(new Date(profile.created_at), { addSuffix: true })}</span></div>
          </div>

          {/* ── Social Links Row ── */}
          {(profile.twitter_handle || profile.instagram_handle || profile.linkedin_url || isOwnProfile) && (
            <div className="mb-3 space-y-2">
              {(profile.twitter_handle || profile.instagram_handle || profile.linkedin_url) && (
                <div className="flex items-center gap-2 flex-wrap">
                  {profile.twitter_handle && (
                    <a
                      href={`https://twitter.com/${profile.twitter_handle}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-sky-500/20 bg-sky-500/5 hover:bg-sky-500/15 text-sky-600 dark:text-sky-400 transition-colors"
                    >
                      <Twitter className="w-3.5 h-3.5" />
                      <span className="text-xs font-semibold">@{profile.twitter_handle}</span>
                      <ExternalLink className="w-2.5 h-2.5 opacity-60" />
                    </a>
                  )}
                  {profile.instagram_handle && (
                    <a
                      href={`https://instagram.com/${profile.instagram_handle}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-pink-500/20 bg-pink-500/5 hover:bg-pink-500/15 text-pink-600 dark:text-pink-400 transition-colors"
                    >
                      <Instagram className="w-3.5 h-3.5" />
                      <span className="text-xs font-semibold">@{profile.instagram_handle}</span>
                      <ExternalLink className="w-2.5 h-2.5 opacity-60" />
                    </a>
                  )}
                  {profile.linkedin_url && (
                    <a
                      href={profile.linkedin_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-blue-600/20 bg-blue-600/5 hover:bg-blue-600/15 text-blue-700 dark:text-blue-400 transition-colors"
                    >
                      <Linkedin className="w-3.5 h-3.5" />
                      <span className="text-xs font-semibold">LinkedIn</span>
                      <ExternalLink className="w-2.5 h-2.5 opacity-60" />
                    </a>
                  )}
                </div>
              )}
              {/* Own-profile inline editor */}
              {isOwnProfile && (
                <SocialLinksEditor
                  userId={profile.id}
                  twitterHandle={profile.twitter_handle ?? null}
                  instagramHandle={profile.instagram_handle ?? null}
                  linkedinUrl={profile.linkedin_url ?? null}
                  onSaved={fetchProfile}
                />
              )}
            </div>
          )}

          <div className="flex gap-4">
            <button onClick={() => setActiveTab('Following')} className="hover:underline">
              <span className="font-bold">{formatNumber(profile.following_count)}</span> <span className="text-muted-foreground">Following</span>
            </button>
            <button onClick={() => setActiveTab('Followers')} className="hover:underline">
              <span className="font-bold">{formatNumber(profile.follower_count)}</span> <span className="text-muted-foreground">Followers</span>
            </button>
          </div>

          {isOwnProfile && (
            <button onClick={() => { const link = `${window.location.origin}/auth?ref=${profile.id}`; navigator.clipboard.writeText(link).then(() => { setReferralCopied(true); setTimeout(() => setReferralCopied(false), 2000); }); }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-primary/30 bg-primary/5 hover:bg-primary/10 transition-colors mt-2">
              {referralCopied ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Gift className="w-3.5 h-3.5 text-primary" />}
              <span className="text-xs font-semibold text-primary">{referralCopied ? 'Link copied!' : 'Copy Invite Link'}</span>
            </button>
          )}

          {profile.is_creator && profile.subscriber_count > 0 && (
            <div className="flex items-center gap-1.5 mb-2 mt-2">
              <span className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-purple-500/10 border border-purple-500/20 text-purple-600 dark:text-purple-400 text-xs font-semibold">
                <Sparkles className="w-3 h-3" />{profile.subscriber_count.toLocaleString()} subscriber{profile.subscriber_count !== 1 ? 's' : ''}
              </span>
              {activeSubscription && (
                <span className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-gradient-to-r from-purple-500/15 to-pink-500/15 border border-purple-500/20 text-purple-700 dark:text-purple-300 text-xs font-bold">
                  <Crown className="w-3 h-3" />{activeSubscription.tier}
                </span>
              )}
            </div>
          )}

          {/* Stats */}
          <div className="flex gap-2 mt-3 flex-wrap">
            {followerRank !== null && (
              <div onClick={() => navigate('/leaderboard')} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-border bg-muted/50 cursor-pointer hover:bg-muted transition-colors">
                <Trophy className={`w-3.5 h-3.5 ${followerRank === 1 ? 'text-yellow-500' : followerRank === 2 ? 'text-slate-400' : followerRank === 3 ? 'text-amber-600' : 'text-primary'}`} />
                <span className="text-xs font-semibold">{followerRank <= 3 ? ['🥇','🥈','🥉'][followerRank - 1] + ` #${followerRank}` : `#${formatNumber(followerRank)}`}</span>
                <span className="text-xs text-muted-foreground">followers</span>
              </div>
            )}
            {streakDay > 0 && (
              <div onClick={() => navigate('/daily-rewards')} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-orange-500/30 bg-orange-500/5 cursor-pointer hover:bg-orange-500/10 transition-colors">
                <Flame className="w-3.5 h-3.5 text-orange-500" />
                <span className="text-xs font-semibold text-orange-600 dark:text-orange-400">Day {streakDay}</span>
                <span className="text-xs text-muted-foreground">streak</span>
              </div>
            )}
            {isOwnProfile && Number(profile.total_earnings) > 0 && (
              <div onClick={() => navigate('/monetization')} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-green-500/30 bg-green-500/5 cursor-pointer hover:bg-green-500/10 transition-colors">
                <DollarSign className="w-3.5 h-3.5 text-green-600" />
                <span className="text-xs font-semibold text-green-600">${Number(profile.total_earnings).toFixed(2)}</span>
                <span className="text-xs text-muted-foreground">earned</span>
              </div>
            )}
            {isOwnProfile && profileViews7d > 0 && (
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-blue-500/30 bg-blue-500/5">
                <Eye className="w-3.5 h-3.5 text-blue-500" />
                <span className="text-xs font-semibold text-blue-600">{profileViews7d.toLocaleString()}</span>
                <span className="text-xs text-muted-foreground">profile views (7d)</span>
              </div>
            )}
          </div>

          {/* Account Standing — own profile only */}
          {isOwnProfile && (
            <div className={`mt-3 rounded-2xl border p-3 ${profileStrikesBorderBg}`}>
              <div className="flex items-center gap-2 mb-2">
                <ShieldCheck className={`w-4 h-4 shrink-0 ${profileStrikesColor}`} />
                <span className="text-xs font-black text-foreground">Account Standing</span>
                {profileStrikes === 0
                  ? <span className="ml-auto text-[10px] font-bold text-green-600 bg-green-500/10 px-1.5 py-0.5 rounded-full">Good ✓</span>
                  : <span className={`ml-auto text-[10px] font-bold px-1.5 py-0.5 rounded-full ${profileStrikesColor}`}>{profileStrikes}/3 Strike{profileStrikes !== 1 ? 's' : ''}</span>}
              </div>
              <div className="flex gap-1 mb-2">
                {[1,2,3].map(n => (
                  <div key={n} className={`flex-1 h-2 rounded-full ${n <= profileStrikes ? (profileStrikes >= 3 ? 'bg-red-600' : profileStrikes >= 2 ? 'bg-red-500' : 'bg-orange-400') : 'bg-muted'}`} />
                ))}
              </div>
              <p className="text-[10px] text-muted-foreground mb-2">
                {profileStrikes === 0 ? 'No violations. Keep creating great content!' :
                 profileStrikes === 1 ? '1 policy strike. Avoid further violations.' :
                 profileStrikes === 2 ? '2 strikes — next may result in suspension.' :
                 '3 strikes — account may be permanently suspended.'}
              </p>
              <div className="flex gap-2">
                <button onClick={() => navigate('/policy')} className="flex items-center gap-1 px-2.5 py-1 bg-background border border-border rounded-xl text-[10px] font-bold hover:bg-muted transition-colors">
                  <ShieldCheck className="w-2.5 h-2.5" />View Policy
                </button>
                {profileStrikes > 0 && (
                  <button onClick={() => navigate('/appeals')} className="flex items-center gap-1 px-2.5 py-1 bg-primary/5 border border-primary/20 rounded-xl text-[10px] font-bold text-primary hover:bg-primary/10 transition-colors">
                    <Flag className="w-2.5 h-2.5" />File Appeal
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Post Impressions Sparkline — own profile only */}
          {isOwnProfile && postImpressionsChart.some(d => d.views > 0) && (
            <div className="mt-3 border border-blue-500/20 bg-blue-500/5 rounded-2xl overflow-hidden">
              <div className="px-3 pt-3 pb-1 flex items-center justify-between">
                <p className="text-xs font-bold text-blue-700 dark:text-blue-400 flex items-center gap-1.5">
                  <Eye className="w-3.5 h-3.5" />Post Impressions (30d)
                </p>
                <span className="text-xs font-black text-blue-600">{postImpressionsChart.reduce((s, d) => s + d.views, 0).toLocaleString()} total</span>
              </div>
              <ResponsiveContainer width="100%" height={72}>
                <AreaChart data={postImpressionsChart} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
                  <defs>
                    <linearGradient id="impGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="date" hide />
                  <Tooltip formatter={(v: any) => [v, 'views']} contentStyle={{ fontSize: 10, borderRadius: 8, padding: '4px 8px' }} />
                  <Area type="monotone" dataKey="views" stroke="#3b82f6" strokeWidth={2} fill="url(#impGrad)" dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      {/* Verify Banner */}
      {isOwnProfile && !profile.verified && !verifyBannerDismissed && (
        <div className="mx-4 mt-4 p-4 bg-gradient-to-r from-amber-500/10 via-yellow-500/10 to-transparent border border-amber-500/30 rounded-2xl">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-500/20 flex items-center justify-center flex-shrink-0">
                <ShieldCheck className="w-5 h-5 text-amber-600 dark:text-amber-400" />
              </div>
              <div>
                <p className="font-semibold text-sm text-foreground">Get Verified</p>
                <p className="text-xs text-muted-foreground">Add a blue checkmark to stand out</p>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <button onClick={() => navigate('/verify')} className="px-4 py-1.5 bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold rounded-full transition-colors">Apply</button>
              <button onClick={() => setVerifyBannerDismissed(true)} className="p-1 text-muted-foreground hover:text-foreground transition-colors"><X className="w-4 h-4" /></button>
            </div>
          </div>
        </div>
      )}

      {isOwnProfile && <div className="px-4 mt-4"><RevenueAnalyticsWidget /></div>}
      {isOwnProfile && profile && <div className="px-4 mt-4"><CreatorMonetizationHub userId={profile.id} /></div>}
      {!isOwnProfile && profile && currentUser && (
        <div className="px-4 mt-4 space-y-3">
          <SubscriptionTiersDisplay creatorId={profile.id} viewerId={currentUser.id} creatorUsername={profile.username ?? 'creator'} />
          <TipGoalWidget creatorId={profile.id} />
        </div>
      )}
      {profile && <div className="px-4 mt-1"><SubscriberBadge creatorId={profile.id} /></div>}

      {/* Tabs */}
      <div className="sticky top-14 z-30 bg-background border-b border-border">
        <div className="flex overflow-x-auto scrollbar-hide">
          {tabs.map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              className={`flex-shrink-0 px-4 py-4 font-semibold transition-colors border-b-2 ${activeTab === tab ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:bg-muted/50'}`}>
              {tab}
            </button>
          ))}
        </div>
      </div>

      <div>
        {activeTab === 'Posts' && (
          posts.length > 0 ? (
            <div>
              {pinnedPostId && posts.find(p => p.id === pinnedPostId) && (
                <div className="border-b-2 border-primary/20 bg-primary/3">
                  <div className="flex items-center gap-2 px-4 pt-3 pb-0">
                    <span className="text-[10px] font-bold text-primary uppercase tracking-wide">📌 Pinned Post</span>
                    {isOwnProfile && <button onClick={() => togglePinPost(pinnedPostId)} className="ml-auto text-[10px] text-muted-foreground hover:text-destructive transition-colors">Unpin</button>}
                  </div>
                  <PostCard post={posts.find(p => p.id === pinnedPostId)!} onUpdate={fetchProfile} />
                </div>
              )}
              {posts.filter(p => p.id !== pinnedPostId).map(post => (
                <div key={post.id} className="relative group">
                  <PostCard post={post} onUpdate={fetchProfile} />
                  {/* Impression milestone badge — ⭐ 1K · 🚀 10K (esbuild guard: no IIFE, plain conditional) */}
                  {(post.views_count ?? 0) >= 10000 && (
                    <div className="absolute top-3 left-14 z-10 flex items-center gap-0.5 px-1.5 py-0.5 bg-primary text-primary-foreground rounded-full text-[9px] font-black shadow pointer-events-none">
                      🚀 {formatNumber(post.views_count ?? 0)}
                    </div>
                  )}
                  {(post.views_count ?? 0) >= 1000 && (post.views_count ?? 0) < 10000 && (
                    <div className="absolute top-3 left-14 z-10 flex items-center gap-0.5 px-1.5 py-0.5 bg-amber-500 text-white rounded-full text-[9px] font-black shadow pointer-events-none">
                      ⭐ {formatNumber(post.views_count ?? 0)}
                    </div>
                  )}
                  {isOwnProfile && (
                    <button onClick={() => togglePinPost(post.id)} className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity text-[10px] font-bold text-muted-foreground hover:text-primary bg-background/90 px-2 py-1 rounded-full border border-border shadow-sm">
                      {pinnedPostId === post.id ? 'Unpin' : '📌 Pin'}
                    </button>
                  )}
                </div>
              ))}
            </div>
          ) : <div className="text-center py-12 text-muted-foreground"><p>No posts yet</p></div>
        )}

        {activeTab === 'Threads' && isOwnProfile && (
          <div className="flex items-center gap-2 px-4 pt-3 pb-0">
            <button onClick={async () => { await navigator.clipboard.writeText(getPodcastRssUrl(profile.username ?? '')); toast.success('Podcast RSS URL copied!'); }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-orange-500/30 bg-orange-500/5 text-orange-600 dark:text-orange-400 hover:bg-orange-500/10 transition-colors text-xs font-semibold">
              <Rss className="w-3.5 h-3.5" />Copy Podcast RSS
            </button>
            <span className="text-[10px] text-muted-foreground">Subscribe in Apple Podcasts, Spotify…</span>
          </div>
        )}
        {activeTab === 'Threads' && (
          threads.length > 0 ? (
            <>
              <div className="flex items-center gap-2 px-4 py-3 border-b border-border bg-muted/20">
                <Rss className="w-4 h-4 text-orange-500" />
                <span className="text-sm text-muted-foreground flex-1">Share your podcast RSS feed</span>
                <button onClick={() => navigator.clipboard.writeText(getPodcastRssUrl(profile.username)).then(() => toast.success('RSS feed URL copied!'))}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-orange-500/30 bg-orange-500/5 hover:bg-orange-500/10 text-orange-600 dark:text-orange-400 text-xs font-semibold transition-colors">
                  <Copy className="w-3 h-3" /> Copy RSS
                </button>
              </div>
              {threads.map(thread => (
                <div key={thread.id} onClick={() => navigate(`/thread/${thread.id}`)} className="border-b border-border p-4 hover:bg-muted/5 cursor-pointer">
                  <h3 className="font-bold text-lg mb-2">{thread.title}</h3>
                  <p className="text-muted-foreground line-clamp-3 mb-2">{thread.content.substring(0, 200)}...</p>
                  <div className="flex items-center gap-4 text-sm text-muted-foreground">
                    <span>{formatNumber(thread.views_count)} views</span>
                    <span>{formatNumber(thread.likes_count)} likes</span>
                    <span>{formatDistanceToNow(new Date(thread.created_at), { addSuffix: true })}</span>
                  </div>
                </div>
              ))}
            </>
          ) : <div className="text-center py-12 text-muted-foreground"><p>No threads yet</p></div>
        )}

        {activeTab === 'Replies' && (
          replies.length > 0 ? replies.map((reply: any) => (
            <div key={reply.id} className="border-b border-border p-4 hover:bg-muted/5">
              <p className="text-sm text-muted-foreground mb-2">Replying to @{reply.posts?.user_profiles?.username}</p>
              <p className="mb-2">{reply.content}</p>
              <button onClick={() => navigate(`/post/${reply.post_id}`)} className="text-sm text-primary hover:underline">View conversation</button>
            </div>
          )) : <div className="text-center py-12 text-muted-foreground"><p>No replies yet</p></div>
        )}

        {activeTab === 'Media' && (
          media.length > 0 ? (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2 p-2">
              {media.map(post => {
                const mediaUrl = post.video_url || post.image_url || post.media_urls?.[0];
                return (
                  <div key={post.id} onClick={() => navigate(`/post/${post.id}`)} className="aspect-square bg-muted rounded-lg overflow-hidden cursor-pointer hover:opacity-80 transition-opacity">
                    {post.is_video || post.video_url ? <video src={mediaUrl} className="w-full h-full object-cover" /> : <img src={mediaUrl} alt="Media" className="w-full h-full object-cover" />}
                  </div>
                );
              })}
            </div>
          ) : <div className="text-center py-12 text-muted-foreground"><p>No media yet</p></div>
        )}

        {activeTab === 'Videos' && (
          <div className="p-3">
            {videoPosts.length === 0 ? (
              <div className="text-center py-16 text-muted-foreground">
                <Play className="w-14 h-14 mx-auto mb-4 opacity-20" />
                <p className="font-semibold text-lg">No videos yet</p>
                <p className="text-sm">Upload short videos to appear here</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {videoPosts.map(post => (
                  <button key={post.id} onClick={() => navigate(`/videos?id=${post.id}`)} className="relative rounded-xl overflow-hidden bg-black aspect-[9/16] hover:scale-[1.02] active:scale-[0.98] transition-transform focus:outline-none">
                    <video src={`${post.video_url}#t=0.5`} className="w-full h-full object-cover" muted preload="metadata" />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />
                    <div className="absolute top-2 right-2 w-7 h-7 bg-black/50 rounded-full flex items-center justify-center">
                      <Play className="w-3.5 h-3.5 text-white fill-white ml-0.5" />
                    </div>
                    <div className="absolute bottom-2 left-2 right-2">
                      <p className="text-white text-[10px] font-medium line-clamp-2 mb-1 leading-tight">{post.content?.slice(0, 60)}</p>
                      <div className="flex items-center gap-2">
                        <span className="flex items-center gap-0.5 text-white/70 text-[10px]"><Heart className="w-2.5 h-2.5" />{formatNumber(post.likes_count ?? 0)}</span>
                        <span className="flex items-center gap-0.5 text-white/70 text-[10px]"><Eye className="w-2.5 h-2.5" />{formatNumber(post.views_count ?? 0)}</span>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'Podcasts' && (
          loadingPodcasts ? (
            <div className="flex justify-center py-16"><Loader2 className="w-7 h-7 animate-spin text-primary" /></div>
          ) : (
            <div>
              {podTotalEps > 0 && (
                <div className="flex items-center gap-3 px-4 pt-3 pb-2 overflow-x-auto scrollbar-hide">
                  <div className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-primary/8 border border-primary/20 shrink-0">
                    <Headphones className="w-3.5 h-3.5 text-primary" />
                    <span className="text-xs font-bold text-primary">{podTotalEps}</span>
                    <span className="text-xs text-muted-foreground">episodes</span>
                  </div>
                  <div className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-blue-500/8 border border-blue-500/20 shrink-0">
                    <Users className="w-3.5 h-3.5 text-blue-500" />
                    <span className="text-xs font-bold text-blue-600">{podTotalListeners.toLocaleString()}</span>
                    <span className="text-xs text-muted-foreground">listeners</span>
                  </div>
                  {podTotalSecs > 0 && (
                    <div className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-violet-500/8 border border-violet-500/20 shrink-0">
                      <Clock className="w-3.5 h-3.5 text-violet-500" />
                      <span className="text-xs font-bold text-violet-600">{fmtPodTotalDur(podTotalSecs)}</span>
                      <span className="text-xs text-muted-foreground">total</span>
                    </div>
                  )}
                </div>
              )}
              <div className="flex items-center gap-2 px-4 pt-3 pb-0">
                <button onClick={() => navigator.clipboard.writeText(getPodcastRssUrl(profile.username ?? '')).then(() => toast.success('Podcast RSS URL copied!'))}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-orange-500/30 bg-orange-500/5 text-orange-600 dark:text-orange-400 hover:bg-orange-500/10 transition-colors text-xs font-semibold">
                  <Rss className="w-3.5 h-3.5" />Copy RSS Feed
                </button>
                <span className="text-[10px] text-muted-foreground">Subscribe in Apple Podcasts, Spotify…</span>
              </div>
              {profilePodcasts.length === 0 ? (
                <div className="text-center py-16 text-muted-foreground">
                  <Headphones className="w-14 h-14 mx-auto mb-3 opacity-20" />
                  <p className="font-semibold">No podcast episodes yet</p>
                  <p className="text-sm mt-1">Recorded audio spaces will appear here</p>
                  {isOwnProfile && <button onClick={() => navigate('/spaces')} className="mt-4 px-5 py-2 bg-primary text-primary-foreground rounded-full text-sm font-bold hover:opacity-90">Start a Space</button>}
                </div>
              ) : (
                <div className="divide-y divide-border mt-2">
                  {profilePodcasts.map((pod: any) => {
                    const podDur = fmtRecDuration(pod.duration);
                    const podArt = pod.spaces?.artwork_url ?? null;
                    const podTitle = pod.spaces?.title ?? pod.title;
                    const podEp = pod.spaces?.episode_number ?? null;
                    const podSub = pod.spaces?.subscriber_only ?? false;
                    return (
                      <div key={pod.id} className="flex items-center gap-3 p-4 hover:bg-muted/15 transition-colors cursor-pointer" onClick={() => navigate(`/space-recording/${pod.id}`)}>
                        <div className="w-14 h-14 rounded-xl overflow-hidden bg-gradient-to-br from-primary/15 to-purple-500/10 shrink-0 shadow-sm flex items-center justify-center">
                          {podArt ? <img src={podArt} alt="" className="w-full h-full object-cover" /> : <Headphones className="w-6 h-6 text-primary opacity-70" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
                            {podEp && <span className="text-[10px] text-muted-foreground">Ep. {podEp}</span>}
                            {pod.has_video && <span className="text-[10px] text-primary font-semibold">📹 Video</span>}
                            {podSub && <span className="text-[10px] text-amber-600 font-semibold">⭐ Sub</span>}
                          </div>
                          <p className="font-bold text-sm line-clamp-2 leading-snug">{podTitle}</p>
                          <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                            {podDur && <span className="flex items-center gap-0.5"><Clock className="w-3 h-3" />{podDur}</span>}
                            {(pod.listener_count ?? 0) > 0 && <span className="flex items-center gap-0.5"><Users className="w-3 h-3" />{formatNumber(pod.listener_count)}</span>}
                            <span>{formatDistanceToNow(new Date(pod.created_at), { addSuffix: true })}</span>
                          </div>
                        </div>
                        <button onClick={e => { e.stopPropagation(); navigate(`/space-recording/${pod.id}`); }} className="w-10 h-10 rounded-full bg-primary/10 hover:bg-primary/20 flex items-center justify-center transition-colors shrink-0">
                          <Play className="w-4 h-4 text-primary ml-0.5" fill="currentColor" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )
        )}

        {activeTab === 'Gifts' && (
          loadingGifts ? <div className="flex items-center justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
          : giftHistory.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              <Crown className="w-12 h-12 mx-auto mb-3 opacity-20" />
              <p className="font-semibold">No gift history yet</p>
              <p className="text-sm mt-1">Premium gifts sent or received will appear here</p>
              {isOwnProfile && <button onClick={() => navigate('/premium')} className="mt-4 px-5 py-2 bg-gradient-to-r from-amber-500 to-yellow-500 text-white rounded-full text-sm font-bold shadow-sm shadow-amber-500/20 hover:opacity-90">Get Premium</button>}
            </div>
          ) : (
            <div className="divide-y divide-border">
              {giftHistory.map((sub: any) => {
                const isActive = sub.status === 'active' && new Date(sub.expires_at) > new Date();
                const isExpired = sub.status === 'expired' || (sub.expires_at && new Date(sub.expires_at) <= new Date());
                const hint = sub.inboxHint?.body ?? '';
                const gifterMatch = hint.match(/@(\w+)\s+gifted you/);
                const gifterName = gifterMatch?.[1] ?? null;
                const isReceived = sub.user_id === profile.id;
                return (
                  <div key={sub.id} className="p-4 hover:bg-muted/5 transition-colors flex items-center gap-3">
                    <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 ${isActive ? 'bg-gradient-to-br from-amber-500/20 to-yellow-500/20 border border-amber-500/30' : 'bg-muted border border-border'}`}>
                      <Crown className={`w-6 h-6 ${isActive ? 'text-amber-500' : 'text-muted-foreground'}`} fill={isActive ? 'currentColor' : 'none'} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-sm">{isReceived ? (gifterName ? `From @${gifterName}` : 'Premium Gift') : 'Gift Sent'}</span>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${isActive ? 'bg-amber-500/15 text-amber-600' : isExpired ? 'bg-muted text-muted-foreground' : 'bg-primary/10 text-primary'}`}>
                          {isActive ? '✓ Active' : isExpired ? 'Expired' : sub.status}
                        </span>
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-600 font-semibold capitalize">{sub.plan}</span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {sub.started_at ? formatDistanceToNow(new Date(sub.started_at), { addSuffix: true }) : ''}
                        {sub.expires_at && ` · Expires ${new Date(sub.expires_at).toLocaleDateString()}`}
                      </p>
                      {isActive && sub.expires_at && (
                        <div className="mt-1.5 flex items-center gap-2">
                          <div className="flex-1 h-1 bg-muted rounded-full overflow-hidden">
                            <div className="h-full bg-gradient-to-r from-amber-400 to-yellow-500 rounded-full"
                              style={{ width: `${Math.max(5, Math.min(100, ((new Date(sub.expires_at).getTime() - Date.now()) / (30 * 24 * 60 * 60 * 1000)) * 100))}%` }} />
                          </div>
                          <span className="text-[9px] text-muted-foreground shrink-0">{Math.max(0, Math.ceil((new Date(sub.expires_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))}d left</span>
                        </div>
                      )}
                    </div>
                    <p className="text-base font-bold shrink-0 text-amber-600">${Number(sub.price).toFixed(2)}</p>
                  </div>
                );
              })}
            </div>
          )
        )}

        {activeTab === 'Tips' && (
          loadingTips ? <div className="flex items-center justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
          : tipHistory.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              <DollarSign className="w-12 h-12 mx-auto mb-3 opacity-20" />
              <p className="font-semibold">No tips yet</p>
              <p className="text-sm mt-1">Tips sent and received will appear here</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {tipHistory.map((tip: any) => {
                const isSent = tip.from_user_id === profile.id;
                const other = isSent ? tip.recipient : tip.sender;
                const uname = other?.username ?? 'user';
                return (
                  <div key={tip.id} className="p-4 hover:bg-muted/5 transition-colors flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-muted overflow-hidden shrink-0 cursor-pointer" onClick={() => navigate(`/profile/${uname}`)}>
                      {other?.avatar_url ? <img src={other.avatar_url} alt={uname} className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center font-bold text-sm">{uname[0]?.toUpperCase()}</div>}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm cursor-pointer hover:underline" onClick={() => navigate(`/profile/${uname}`)}>{isSent ? `To @${uname}` : `From @${uname}`}</span>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${isSent ? 'bg-red-500/10 text-red-600' : 'bg-green-500/10 text-green-600'}`}>{isSent ? '↑ Sent' : '↓ Received'}</span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">{formatDistanceToNow(new Date(tip.created_at), { addSuffix: true })}</p>
                    </div>
                    <p className={`text-lg font-bold shrink-0 ${isSent ? 'text-red-600' : 'text-green-600'}`}>{isSent ? '-' : '+'}${Number(tip.amount).toFixed(2)}</p>
                  </div>
                );
              })}
            </div>
          )
        )}

        {activeTab === 'Series' && (
          loadingProfileSeries ? (
            <div className="flex justify-center py-16"><Loader2 className="w-7 h-7 animate-spin text-primary" /></div>
          ) : profileSeries.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              <BookOpen className="w-14 h-14 mx-auto mb-3 opacity-20" />
              <p className="font-semibold">No public series yet</p>
              {isOwnProfile && <button onClick={() => navigate('/series')} className="mt-4 px-5 py-2 bg-primary text-primary-foreground rounded-full text-sm font-bold hover:opacity-90">Create a Series</button>}
            </div>
          ) : (
            <div className="divide-y divide-border">
              {profileSeries.map((s: any) => {
                let sProg: any = null;
                try { const raw = localStorage.getItem('series_progress'); sProg = raw ? (JSON.parse(raw)[s.id] ?? null) : null; } catch { sProg = null; }
                const sTotal = s.item_count ?? 0;
                const sPct = sProg && sTotal > 0 ? Math.round((sProg.currentPart / sTotal) * 100) : 0;
                return (
                  <div key={s.id} className="hover:bg-muted/20 transition-colors">
                    <button onClick={() => navigate('/series')} className="w-full flex items-start gap-3 p-4 text-left">
                      <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-primary/20 to-purple-500/20 flex items-center justify-center shrink-0 overflow-hidden border border-border">
                        {s.cover_image ? <img src={s.cover_image} alt={s.name} className="w-full h-full object-cover" /> : <BookOpen className="w-7 h-7 text-primary" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-bold text-sm truncate">{s.name}</p>
                        {s.description && <p className="text-xs text-muted-foreground mt-0.5 truncate">{s.description}</p>}
                        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                          <span className="text-[10px] font-semibold text-primary bg-primary/10 px-1.5 py-0.5 rounded-full">{sTotal} parts</span>
                          {sProg && sTotal > 0 && <span className="text-[10px] font-bold text-purple-600 bg-purple-500/10 px-1.5 py-0.5 rounded-full border border-purple-500/20">{sPct}% · Part {sProg.currentPart}/{sTotal}</span>}
                          <span className="text-[10px] text-muted-foreground">{formatDistanceToNow(new Date(s.updated_at ?? s.created_at), { addSuffix: true })}</span>
                        </div>
                        {sProg && sTotal > 0 && <div className="mt-2 h-1 bg-muted rounded-full overflow-hidden"><div className="h-full bg-primary rounded-full" style={{ width: `${sPct}%` }} /></div>}
                      </div>
                      <ChevronRight className="w-4 h-4 text-muted-foreground mt-1 shrink-0" />
                    </button>
                    <div className="px-4 pb-3">
                      <button onClick={() => navigate('/series')} className={`w-full flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-bold transition-colors ${sProg && sTotal > 0 ? 'bg-primary text-primary-foreground hover:opacity-90' : 'bg-muted hover:bg-muted/80 text-foreground'}`}>
                        <Play className="w-3.5 h-3.5" />
                        {sProg && sTotal > 0 ? `Continue (Part ${sProg.currentPart})` : 'Start Reading'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )
        )}

        {activeTab === 'Likes' && (
          likedPosts.length > 0 ? likedPosts.map(post => <PostCard key={post.id} post={post} onUpdate={fetchProfile} />) : <div className="text-center py-12 text-muted-foreground"><p>No liked posts yet</p></div>
        )}

        {activeTab === 'Followers' && (
          followers.length > 0 ? (
            <div className="divide-y divide-border">
              {followers.map(follower => (
                <div key={follower.id} className="p-4 hover:bg-muted/5 flex items-center justify-between">
                  <div className="flex items-center space-x-3 flex-1 cursor-pointer" onClick={() => navigate(`/profile/${follower.username}`)}>
                    <div className="w-12 h-12 rounded-full bg-muted overflow-hidden">
                      {follower.avatar_url ? <img src={follower.avatar_url} alt={follower.username} className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-lg font-bold">{follower.username[0].toUpperCase()}</div>}
                    </div>
                    <div>
                      <div className="flex items-center gap-1">
                        <span className="font-bold">{follower.username}</span>
                        {follower.verified && <BadgeCheck className="w-4 h-4 text-primary" fill="currentColor" />}
                      </div>
                      <p className="text-sm text-muted-foreground line-clamp-1">{follower.bio || `@${follower.username}`}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : <div className="text-center py-12 text-muted-foreground"><p>No followers yet</p></div>
        )}

        {activeTab === 'Analytics' && isOwnProfile && (
          <div className="p-4 space-y-5">
            {/* Header */}
            <div className="flex items-center gap-3 p-4 bg-gradient-to-br from-blue-500/10 to-violet-500/5 border border-blue-500/20 rounded-2xl">
              <div className="w-11 h-11 rounded-2xl bg-blue-500/15 flex items-center justify-center shrink-0">
                <Eye className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <h2 className="font-bold text-base">Profile Analytics</h2>
                <p className="text-xs text-muted-foreground">Your stats for the last 30 days</p>
              </div>
            </div>

            {/* KPI row */}
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-card border border-border rounded-2xl p-4">
                <p className="text-xs text-muted-foreground mb-1">Post Impressions</p>
                <p className="text-2xl font-black text-blue-600">{postImpressionsChart.reduce((s, d) => s + d.views, 0).toLocaleString()}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">30-day total</p>
              </div>
              <div className="bg-card border border-border rounded-2xl p-4">
                <p className="text-xs text-muted-foreground mb-1">Profile Views</p>
                <p className="text-2xl font-black text-violet-600">{profileViews7d.toLocaleString()}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">Last 7 days</p>
              </div>
              <div className="bg-card border border-border rounded-2xl p-4">
                <p className="text-xs text-muted-foreground mb-1">Total Posts</p>
                <p className="text-2xl font-black text-foreground">{posts.length}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">Published</p>
              </div>
              <div className="bg-card border border-border rounded-2xl p-4">
                <p className="text-xs text-muted-foreground mb-1">Total Tips</p>
                <p className="text-2xl font-black text-yellow-600">${currentMonthTips.toFixed(2)}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">This month</p>
              </div>
            </div>

            {/* Impressions area chart */}
            {postImpressionsChart.some(d => d.views > 0) && (
              <div className="bg-card border border-border rounded-2xl overflow-hidden">
                <div className="px-4 pt-4 pb-2 flex items-center justify-between">
                  <div>
                    <p className="font-bold text-sm">Post Impressions</p>
                    <p className="text-xs text-muted-foreground">30-day view trend</p>
                  </div>
                  <span className="text-xs font-bold text-blue-600 bg-blue-500/10 px-2 py-0.5 rounded-full">
                    {postImpressionsChart.filter(d => d.views > 0).length} active days
                  </span>
                </div>
                <ResponsiveContainer width="100%" height={120}>
                  <AreaChart data={postImpressionsChart} margin={{ top: 4, right: 16, left: 4, bottom: 0 }}>
                    <defs>
                      <linearGradient id="analyticsGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.35} />
                        <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="date" hide />
                    <Tooltip
                      formatter={(v: any) => [v, 'impressions']}
                      contentStyle={{ fontSize: 11, borderRadius: 10, padding: '4px 10px', border: '1px solid hsl(var(--border))' }}
                    />
                    <Area type="monotone" dataKey="views" stroke="#3b82f6" strokeWidth={2} fill="url(#analyticsGrad)" dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Top posts by views */}
            {posts.length > 0 && (
              <div className="bg-card border border-border rounded-2xl overflow-hidden">
                <div className="px-4 py-3 border-b border-border">
                  <p className="font-bold text-sm">Top Posts by Views</p>
                </div>
                <div className="divide-y divide-border">
                  {[...posts]
                    .sort((a, b) => (b.views_count ?? 0) - (a.views_count ?? 0))
                    .slice(0, 5)
                    .map((post: any, i: number) => {
                      const maxViews = Math.max(...posts.map((p: any) => p.views_count ?? 0), 1);
                      const pct = Math.max(4, Math.round(((post.views_count ?? 0) / maxViews) * 100));
                      return (
                        <button
                          key={post.id}
                          onClick={() => navigate(`/post/${post.id}`)}
                          className="w-full text-left px-4 py-3 hover:bg-muted/20 transition-colors"
                        >
                          <div className="flex items-center gap-2 mb-1.5">
                            <span className="text-[10px] font-black text-muted-foreground w-4">#{i + 1}</span>
                            <p className="flex-1 text-sm font-medium line-clamp-1">{post.content?.slice(0, 80)}</p>
                            <span className="text-xs font-bold text-foreground shrink-0">{(post.views_count ?? 0).toLocaleString()}</span>
                          </div>
                          <div className="ml-6 h-1.5 bg-muted rounded-full overflow-hidden">
                            <div
                              className="h-full bg-blue-500 rounded-full transition-all duration-500"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <div className="flex items-center gap-3 mt-1 ml-6 text-[10px] text-muted-foreground">
                            <span>❤️ {post.likes_count ?? 0}</span>
                            <span>🔁 {post.reposts_count ?? 0}</span>
                            <span>💬 {post.replies_count ?? 0}</span>
                          </div>
                        </button>
                      );
                    })
                  }
                </div>
              </div>
            )}

            {/* Follower stats */}
            <div className="bg-card border border-border rounded-2xl p-4">
              <p className="font-bold text-sm mb-3">Audience</p>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Users className="w-4 h-4 text-primary" />
                    <span className="text-sm">Followers</span>
                  </div>
                  <span className="font-bold text-base">{(profile.follower_count ?? 0).toLocaleString()}</span>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Users className="w-4 h-4 text-muted-foreground" />
                    <span className="text-sm">Following</span>
                  </div>
                  <span className="font-bold text-base">{(profile.following_count ?? 0).toLocaleString()}</span>
                </div>
                {followerRank !== null && (
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Trophy className="w-4 h-4 text-yellow-500" />
                      <span className="text-sm">Follower Rank</span>
                    </div>
                    <span className="font-bold text-base text-yellow-600">#{followerRank.toLocaleString()}</span>
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Flame className="w-4 h-4 text-orange-500" />
                    <span className="text-sm">Daily Streak</span>
                  </div>
                  <span className="font-bold text-base text-orange-600">{streakDay} days</span>
                </div>
              </div>
            </div>

            {/* Earnings summary */}
            {Number(profile.total_earnings ?? 0) > 0 && (
              <div className="bg-gradient-to-br from-green-500/10 to-emerald-500/5 border border-green-500/20 rounded-2xl p-4">
                <p className="font-bold text-sm mb-3 text-green-700 dark:text-green-400">Earnings</p>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <DollarSign className="w-4 h-4 text-green-600" />
                    <span className="text-sm">Total Earned</span>
                  </div>
                  <span className="font-black text-lg text-green-600">${Number(profile.total_earnings).toFixed(2)}</span>
                </div>
                <button
                  onClick={() => navigate('/monetization')}
                  className="mt-3 w-full py-2 bg-green-600/10 border border-green-500/20 rounded-xl text-xs font-bold text-green-700 dark:text-green-400 hover:bg-green-600/20 transition-colors"
                >
                  View Full Earnings Report →
                </button>
              </div>
            )}
          </div>
        )}

        {activeTab === 'Following' && (
          following.length > 0 ? (
            <div className="divide-y divide-border">
              {following.map(followedUser => (
                <div key={followedUser.id} className="p-4 hover:bg-muted/5 flex items-center justify-between">
                  <div className="flex items-center space-x-3 flex-1 cursor-pointer" onClick={() => navigate(`/profile/${followedUser.username}`)}>
                    <div className="w-12 h-12 rounded-full bg-muted overflow-hidden">
                      {followedUser.avatar_url ? <img src={followedUser.avatar_url} alt={followedUser.username} className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-lg font-bold">{followedUser.username[0].toUpperCase()}</div>}
                    </div>
                    <div>
                      <div className="flex items-center gap-1">
                        <span className="font-bold">{followedUser.username}</span>
                        {followedUser.verified && <BadgeCheck className="w-4 h-4 text-primary" fill="currentColor" />}
                      </div>
                      <p className="text-sm text-muted-foreground line-clamp-1">{followedUser.bio || `@${followedUser.username}`}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : <div className="text-center py-12 text-muted-foreground"><p>Not following anyone yet</p></div>
        )}
      </div>

      {/* Highlight Viewer */}
      {viewingHighlight && (
        <div className="fixed inset-0 z-[220] bg-black flex flex-col select-none">
          {loadingHighlightStories ? (
            <div className="flex-1 flex items-center justify-center"><Loader2 className="w-10 h-10 animate-spin text-white/60" /></div>
          ) : highlightStories.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 text-white/60">
              <Star className="w-12 h-12" /><p className="text-sm">No media found for this highlight</p>
              <button onClick={closeHighlightViewer} className="px-5 py-2 border border-white/30 rounded-full text-sm text-white">Close</button>
            </div>
          ) : viewerHighlightStory ? (
            // Highlight story content — no IIFE (esbuild guard): viewerHighlightStory pre-computed above
            <>
              <div className="absolute top-3 left-3 right-3 flex gap-1 z-30 pointer-events-none">
                {highlightStories.map((_, i) => (
                  <div key={i} className="flex-1 h-0.5 bg-white/30 rounded-full overflow-hidden">
                    <div className="h-full bg-white rounded-full transition-none" style={{ width: i < highlightStoryIdx ? '100%' : i === highlightStoryIdx ? `${highlightProgress}%` : '0%' }} />
                  </div>
                ))}
              </div>
              <div className="absolute top-8 left-3 right-3 flex items-center gap-2 z-30">
                <div className="w-8 h-8 rounded-full overflow-hidden bg-white/20 shrink-0">
                  {profile.avatar_url ? <img src={profile.avatar_url} alt={profile.username} className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-white font-bold text-xs">{profile.username[0]?.toUpperCase()}</div>}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-white font-semibold text-sm truncate">{viewingHighlight.title}</p>
                  <p className="text-white/60 text-xs">@{profile.username}</p>
                </div>
                <button onClick={closeHighlightViewer} className="w-8 h-8 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center text-white"><X className="w-4 h-4" /></button>
              </div>
              <div className="flex-1 flex items-center justify-center" onClick={e => {
                const x = e.clientX; const w = (e.currentTarget as HTMLElement).offsetWidth;
                if (x < w / 2) { setHighlightStoryIdx(p => Math.max(0, p - 1)); setHighlightProgress(0); }
                else if (highlightStoryIdx < highlightStories.length - 1) { setHighlightStoryIdx(p => p + 1); setHighlightProgress(0); }
                else closeHighlightViewer();
              }}>
                {viewerHighlightStory.media_type === 'video'
                  ? <video key={viewerHighlightStory.id} src={viewerHighlightStory.media_url} autoPlay playsInline className="max-h-screen max-w-full object-contain" onEnded={() => { if (highlightStoryIdx < highlightStories.length - 1) { setHighlightStoryIdx(p => p + 1); setHighlightProgress(0); } else closeHighlightViewer(); }} />
                  : <img key={viewerHighlightStory.id} src={viewerHighlightStory.media_url} alt="" className="max-h-screen max-w-full object-contain" draggable={false} />}
              </div>
              {viewerHighlightStory.caption && <div className="absolute bottom-8 left-6 right-6 z-30 pointer-events-none"><p className="text-white text-sm font-medium bg-black/50 rounded-2xl px-4 py-2.5 text-center backdrop-blur-sm">{viewerHighlightStory.caption}</p></div>}
            </>
          ) : null}
        </div>
      )}

      {/* ── Profile Story Ring Viewer ──────────────────────────────── */}
      {showProfileStories && profile && (
        <div
          className="fixed inset-0 z-[400] bg-black flex items-center justify-center"
          onClick={() => setShowProfileStories(false)}
        >
          <div className="relative w-full max-w-sm" onClick={e => e.stopPropagation()}>
            {/* Close */}
            <button
              onClick={() => setShowProfileStories(false)}
              className="absolute top-4 right-4 z-20 w-9 h-9 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center text-white"
            >
              <X className="w-4 h-4" />
            </button>
            {/* Header */}
            <div className="absolute top-4 left-4 z-20 flex items-center gap-2">
              <div className="w-8 h-8 rounded-full overflow-hidden bg-white/20">
                {profile.avatar_url
                  ? <img src={profile.avatar_url} alt={profile.username} className="w-full h-full object-cover" />
                  : <div className="w-full h-full flex items-center justify-center text-white text-xs font-bold">{profile.username[0].toUpperCase()}</div>}
              </div>
              <span className="text-white font-semibold text-sm">@{profile.username}'s Stories</span>
            </div>
            {/* Redirect to main stories strip which handles the actual viewer */}
            <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 px-8">
              <div
                className="w-24 h-24 rounded-full overflow-hidden ring-4 ring-white/40 ring-offset-4 ring-offset-black"
                style={{ background: 'linear-gradient(135deg, hsl(var(--primary)), #a855f7)', padding: '3px' }}
              >
                <div className="w-full h-full rounded-full overflow-hidden">
                  {profile.avatar_url
                    ? <img src={profile.avatar_url} alt={profile.username} className="w-full h-full object-cover" />
                    : <div className="w-full h-full flex items-center justify-center text-4xl font-bold bg-muted">{profile.username[0].toUpperCase()}</div>}
                </div>
              </div>
              <p className="text-white font-bold text-lg">@{profile.username}</p>
              <p className="text-white/60 text-sm text-center">This user has active stories — view them in your home feed</p>
              <button
                onClick={() => { setShowProfileStories(false); navigate('/'); }}
                className="flex items-center gap-2 px-6 py-3 bg-white/15 hover:bg-white/25 border border-white/30 rounded-full text-white font-semibold text-sm transition-colors"
              >
                View Stories in Feed
              </button>
            </div>
          </div>
        </div>
      )}

      {isOwnProfile && <EditProfileDialog open={showEditDialog} onOpenChange={setShowEditDialog} profile={profile} onSuccess={fetchProfile} />}

      {/* Subscribe Dialog */}
      {showSubscribeDialog && !isOwnProfile && profile.is_creator && (
        <div className="fixed inset-0 z-[200] bg-black/60" onClick={() => setShowSubscribeDialog(false)}>
          <div className="absolute bottom-0 left-0 right-0 bg-background rounded-t-3xl p-5 space-y-4 max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <div><h2 className="font-bold text-lg">Subscribe to @{profile.username}</h2><p className="text-sm text-muted-foreground">Choose a tier — billed from your wallet monthly</p></div>
              <button onClick={() => setShowSubscribeDialog(false)} className="p-2 rounded-full hover:bg-muted"><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-3">
              {[
                { tier: 'Basic', price: 2,  perks: ['Early access to posts', 'Supporter badge', 'Direct message priority'] },
                { tier: 'Fan',   price: 5,  perks: ['Everything in Basic', 'Exclusive content', 'Monthly shoutout'] },
                { tier: 'Super', price: 10, perks: ['Everything in Fan', 'Video calls (monthly)', 'Custom badge', 'VIP community access'] },
              ].map(({ tier, price, perks }) => (
                <button key={tier} onClick={() => handleSubscribe(tier, price)} disabled={subscribing}
                  className={`w-full text-left p-4 rounded-2xl border-2 transition-all hover:scale-[1.01] active:scale-[0.99] disabled:opacity-60 ${tier === 'Fan' ? 'border-purple-500 bg-gradient-to-br from-purple-500/10 to-pink-500/5' : 'border-border hover:border-purple-500/40'}`}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      {tier === 'Fan' && <span className="text-xs bg-purple-600 text-white px-2 py-0.5 rounded-full font-bold">Popular</span>}
                      <span className="font-bold text-base">{tier}</span>
                    </div>
                    <div className="text-right"><span className="text-xl font-black text-purple-600">${price}</span><span className="text-xs text-muted-foreground">/mo</span></div>
                  </div>
                  <ul className="space-y-1">{perks.map(p => <li key={p} className="flex items-center gap-2 text-xs text-muted-foreground"><Check className="w-3 h-3 text-purple-500 shrink-0" />{p}</li>)}</ul>
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground text-center">Subscription renews monthly. Cancel anytime.</p>
            {subscribing && <div className="flex items-center justify-center gap-2 py-2"><Loader2 className="w-5 h-5 animate-spin text-purple-600" /><span className="text-sm font-medium">Processing…</span></div>}
          </div>
        </div>
      )}

      {/* Gift Premium Dialog */}
      {showGiftPremiumDialog && !isOwnProfile && (
        <div className="fixed inset-0 z-[250] bg-black/60 flex items-center justify-center p-4" onClick={() => setShowGiftPremiumDialog(false)}>
          <div className="bg-background border border-border rounded-2xl p-6 w-full max-w-sm shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="text-center mb-5">
              <div className="w-16 h-16 rounded-full bg-gradient-to-br from-amber-500/20 to-yellow-500/20 border border-amber-500/30 flex items-center justify-center mx-auto mb-3">
                <Crown className="w-8 h-8 text-amber-500" fill="currentColor" />
              </div>
              <h2 className="font-bold text-xl">Gift Premium</h2>
              <p className="text-sm text-muted-foreground mt-1">Give @{profile.username} 1 month of Premium (ad-free)</p>
            </div>
            <div className="bg-amber-500/8 border border-amber-500/20 rounded-xl p-4 mb-5 space-y-2">
              {['Ad-free browsing for 1 month', 'No pre-roll or mid-roll video ads', 'Crown badge on their profile', 'Notified instantly via platform inbox'].map(perk => (
                <div key={perk} className="flex items-center gap-2 text-sm">
                  <span className="w-4 h-4 rounded-full bg-amber-500/20 flex items-center justify-center shrink-0"><span className="text-amber-600 text-[10px]">✓</span></span>
                  <span className="text-foreground">{perk}</span>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between px-1 mb-4">
              <span className="text-sm text-muted-foreground">Cost (from your wallet)</span>
              <span className="text-xl font-black text-amber-600">$4.99</span>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setShowGiftPremiumDialog(false)} className="flex-1 py-3 border border-border rounded-xl text-sm font-semibold hover:bg-muted transition-colors">Cancel</button>
              <button onClick={handleGiftPremium} disabled={giftingPremium} className="flex-1 py-3 bg-gradient-to-r from-amber-500 to-yellow-500 text-white rounded-xl text-sm font-bold disabled:opacity-50 flex items-center justify-center gap-2 hover:opacity-90 transition-opacity shadow-lg shadow-amber-500/20">
                {giftingPremium ? <Loader2 className="w-4 h-4 animate-spin" /> : <Crown className="w-4 h-4" fill="currentColor" />}
                {giftingPremium ? 'Gifting…' : 'Gift $4.99'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Tip Dialog */}
      {showTipDialog && !isOwnProfile && (
        <div className="fixed inset-0 z-[200] bg-black/60" onClick={() => setShowTipDialog(false)}>
          <div className="absolute bottom-0 left-0 right-0 bg-background rounded-t-3xl p-5 space-y-4 max-h-[80vh]" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <div><h2 className="font-bold text-lg">Send a Tip</h2><p className="text-sm text-muted-foreground">to @{profile.username}</p></div>
              <button onClick={() => setShowTipDialog(false)} className="p-2 rounded-full hover:bg-muted"><X className="w-5 h-5" /></button>
            </div>
            <div className="grid grid-cols-3 gap-3">
              {[1, 5, 10].map(amt => (
                <button key={amt} onClick={() => { setTipAmount(amt); setCustomTipAmount(''); }}
                  className={`py-3 rounded-xl font-bold text-lg border-2 transition-all ${tipAmount === amt ? 'border-yellow-500 bg-yellow-500/10 text-yellow-600' : 'border-border hover:border-yellow-500/40 hover:bg-yellow-500/5'}`}>${amt}</button>
              ))}
            </div>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground font-bold">$</span>
              <input type="number" min="0.01" step="0.01" placeholder="Custom amount" value={customTipAmount} onChange={e => { setCustomTipAmount(e.target.value); setTipAmount(null); }}
                className="w-full pl-8 pr-4 py-3 rounded-xl border border-border bg-background focus:outline-none focus:ring-2 focus:ring-yellow-500/30 text-base" />
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/40 rounded-xl px-3 py-2">
              <DollarSign className="w-3.5 h-3.5 text-yellow-500" />Tips are sent from your wallet balance instantly
            </div>
            <button onClick={handleSendTip} disabled={sendingTip || (!tipAmount && !Number(customTipAmount))}
              className="w-full py-3.5 bg-gradient-to-r from-yellow-500 to-amber-500 text-white rounded-xl font-bold text-base disabled:opacity-50 flex items-center justify-center gap-2 hover:opacity-90 transition-opacity">
              {sendingTip ? <Loader2 className="w-5 h-5 animate-spin" /> : <DollarSign className="w-5 h-5" />}
              {sendingTip ? 'Sending…' : `Send $${(tipAmount ?? Number(customTipAmount)) || '—'} Tip`}
            </button>
          </div>
        </div>
      )}

      {/* Create Highlight Dialog */}
      {showCreateHighlight && isOwnProfile && (
        <div className="fixed inset-0 z-[200] bg-black/60" onClick={() => setShowCreateHighlight(false)}>
          <div className="absolute bottom-0 left-0 right-0 bg-background rounded-t-3xl p-5 space-y-4 max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="font-bold text-lg">New Highlight</h2>
              <button onClick={() => setShowCreateHighlight(false)} className="p-2 rounded-full hover:bg-muted"><X className="w-5 h-5" /></button>
            </div>
            <input type="text" placeholder="Highlight name (e.g. Travel, Food…)" value={highlightTitle} onChange={e => setHighlightTitle(e.target.value)}
              className="w-full px-4 py-3 rounded-xl border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary text-base" autoFocus maxLength={30} />
            {availableStories.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-semibold">Select stories</p>
                  {selectedStoryIds.length > 0 && <span className="text-xs text-primary font-semibold bg-primary/10 px-2 py-0.5 rounded-full">{selectedStoryIds.length} selected</span>}
                </div>
                <div className="grid grid-cols-4 gap-2">
                  {availableStories.map((s: any) => {
                    const isSelected = selectedStoryIds.includes(s.id);
                    const selIdx = selectedStoryIds.indexOf(s.id);
                    return (
                      <button key={s.id} onClick={() => { setSelectedStoryIds(prev => isSelected ? prev.filter(id => id !== s.id) : [...prev, s.id]); if (!isSelected && selectedStoryIds.length === 0 && !highlightCoverUrl) setHighlightCoverUrl(s.media_url); }}
                        className={`relative aspect-square rounded-xl overflow-hidden border-2 transition-all ${isSelected ? 'border-primary ring-2 ring-primary/30' : 'border-transparent hover:border-muted-foreground/30'}`}>
                        {s.media_type === 'video' ? <video src={s.media_url} className="w-full h-full object-cover" /> : <img src={s.media_url} alt="story" className="w-full h-full object-cover" />}
                        {isSelected && <div className="absolute inset-0 bg-primary/20 flex items-center justify-center"><span className="w-6 h-6 rounded-full bg-primary text-white text-xs font-bold flex items-center justify-center shadow">{selIdx + 1}</span></div>}
                      </button>
                    );
                  })}
                </div>
                {selectedStoryIds.length > 0 && <button onClick={() => { setSelectedStoryIds([]); setHighlightCoverUrl(null); }} className="mt-2 text-xs text-muted-foreground hover:text-destructive transition-colors">Clear selection</button>}
              </div>
            )}
            {highlightCoverUrl && (
              <div className="flex items-center gap-3">
                <span className="text-sm text-muted-foreground">Cover:</span>
                <div className="w-12 h-12 rounded-full overflow-hidden ring-2 ring-primary"><img src={highlightCoverUrl} alt="cover" className="w-full h-full object-cover" /></div>
                <button onClick={() => setHighlightCoverUrl(null)} className="text-xs text-muted-foreground hover:text-destructive">Remove</button>
              </div>
            )}
            <button onClick={handleCreateHighlight} disabled={creatingHighlight || !highlightTitle.trim()}
              className="w-full py-3.5 bg-primary text-primary-foreground rounded-xl font-bold text-base disabled:opacity-50 flex items-center justify-center gap-2 mt-1">
              {creatingHighlight ? <Loader2 className="w-5 h-5 animate-spin" /> : <Star className="w-5 h-5" />}
              {creatingHighlight ? 'Creating…' : 'Create Highlight'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
