import { useState, useEffect, useRef, useCallback } from 'react';
import { Heart, MessageCircle, Repeat2, Share, MoreHorizontal, BadgeCheck, Trash2, TrendingUp, Zap, Eye, BarChart3, Users, History, X, Languages, Loader2 as TransLoader, DollarSign, Flag, Check as CheckIcon, ChevronDown, ChevronUp, Send as SendIcon, Crown, Megaphone, Quote, Activity } from 'lucide-react';
import { Post } from '@/types/app-types';
import { formatDistanceToNow } from 'date-fns';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useNavigate } from 'react-router-dom';
import { useToast } from '@/hooks/use-toast';
import { cn, parseContent, formatNumber } from '@/lib/utils';
import { SharePostDialog } from './SharePostDialog';
import { BookmarkButton } from './BookmarkButton';
import { TipButton, PaywallGate } from './CreatorMonetizationHub';
import { PollCard } from './PollCard';
import { EditPostDialog } from './EditPostDialog';
import { BoostPostDialog } from './BoostPostDialog';
import { OneClickBoost } from './OneClickBoost';
import { RewardedAdBoost } from './RewardedAdBoost';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { VideoMonetizationAd } from './VideoMonetizationAd';
import { EmbedRenderer, PostContentEmbeds } from './EmbedRenderer';
import { updateInterestSignal } from '@/services/recommendations';
import { togglePostLike, togglePostRepost } from '@/services/postInteractionService';
import { backendCapabilities } from '@/services/backendClient';
// Canonical social interaction reads/writes stay behind backend capabilities.

// esbuild guard: no 'as const' on module-level objects/arrays used in .map() render
const REPORT_CATEGORIES = [
  { id: 'spam',           emoji: '📢', label: 'Spam',               desc: 'Unsolicited or repetitive content' },
  { id: 'hate_speech',    emoji: '⚠️', label: 'Hate Speech',         desc: 'Promotes hatred against a group' },
  { id: 'misinformation', emoji: '🔍', label: 'Misinformation',      desc: 'False or misleading information' },
  { id: 'explicit',       emoji: '🔞', label: 'Explicit Content',    desc: 'Adult content not marked properly' },
  { id: 'violence',       emoji: '🚫', label: 'Violence',            desc: 'Graphic violence or threats' },
  { id: 'harassment',     emoji: '😡', label: 'Harassment',          desc: 'Targeting or bullying someone' },
];

interface PostCardProps {
  post: Post;
  onUpdate?: () => void;
}

// Module-level cache: post author uid → has active premium
const premiumCache = new Map<string, boolean>();

export function PostCard({ post, onUpdate }: PostCardProps) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [isAuthorPremium, setIsAuthorPremium] = useState(false);
  const [isLiked, setIsLiked] = useState(false);
  const [isReposted, setIsReposted] = useState(false);
  const [likesCount, setLikesCount] = useState(post.likes_count);
  const [repostsCount, setRepostsCount] = useState(post.reposts_count);
  const [showShareDialog, setShowShareDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showDeleteMenu, setShowDeleteMenu] = useState(false);
  const [poll, setPoll] = useState<any>(null);
  const [showBoostDialog, setShowBoostDialog] = useState(false);
  const [showOneClickBoost, setShowOneClickBoost] = useState(false);
  const [showRewardedBoost, setShowRewardedBoost] = useState(false);
  const [shareCount, setShareCount] = useState(0);
  // Engagement tooltip
  const [showEngagement, setShowEngagement] = useState(false);
  const [analytics, setAnalytics] = useState<any>(null);
  const [loadingAnalytics, setLoadingAnalytics] = useState(false);
  const tooltipTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  // Edit history
  const [showEditHistory, setShowEditHistory] = useState(false);
  const editHistory: any[] = (post as any).edit_history ?? [];

  // Fetch author premium status using the static supabase import (no dynamic import)
  useEffect(() => {
    const uid = post.user_id;
    if (premiumCache.has(uid)) {
      setIsAuthorPremium(premiumCache.get(uid)!);
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
        premiumCache.set(uid, has);
        setIsAuthorPremium(has);
      });
  }, [post.user_id]);

  // Post Reactions
  // esbuild guard: no 'as const' on arrays used in .map() inside component
  const REACTIONS: string[] = ['❤️', '😂', '😮', '😢', '🔥'];
  // Reaction counts — parallel arrays (esbuild guard: no Record<string,number> in state)
  const [reactionEmojis, setReactionEmojis] = useState<string[]>([]);
  const [reactionNums, setReactionNums] = useState<number[]>([]);
  // Derived helper — reads from parallel arrays
  const getReactionCount = (emoji: string): number => {
    const idx = reactionEmojis.indexOf(emoji);
    return idx >= 0 ? (reactionNums[idx] ?? 0) : 0;
  };

  const [userReaction, setUserReaction] = useState<string | null>(null);
  const [showReactionPicker, setShowReactionPicker] = useState(false);

  const fetchReactions = useCallback(async () => {
    const { data } = await supabase
      .from('post_reactions')
      .select('emoji, user_id')
      .eq('post_id', post.id);
    if (data) {
      const emojis: string[] = [];
      const nums: number[] = [];
      let myReaction: string | null = null;
      data.forEach(r => {
        const idx = emojis.indexOf(r.emoji);
        if (idx >= 0) nums[idx]++;
        else { emojis.push(r.emoji); nums.push(1); }
        if (r.user_id === user?.id) myReaction = r.emoji;
      });
      setReactionEmojis(emojis);
      setReactionNums(nums);
      setUserReaction(myReaction);
    }
  }, [post.id, user?.id]);

  useEffect(() => { fetchReactions(); }, [post.id]);

  const handleReact = async (emoji: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!user) { navigate('/auth'); return; }
    setShowReactionPicker(false);
    const prevReaction = userReaction;

    if (prevReaction === emoji) {
      setUserReaction(null);
      setReactionEmojis(prev => {
        const idx = prev.indexOf(emoji);
        if (idx < 0) return prev;
        const next = [...prev];
        const nextNums = [...reactionNums];
        nextNums[idx] = Math.max(0, (nextNums[idx] ?? 1) - 1);
        if (nextNums[idx] === 0) { next.splice(idx, 1); nextNums.splice(idx, 1); }
        setReactionNums(nextNums);
        return next;
      });
      await supabase.from('post_reactions').delete().eq('post_id', post.id).eq('user_id', user.id);
      if (emoji === '❤️' && isLiked) {
        const state = await togglePostLike(post.id);
        setIsLiked(state.is_liked);
        setLikesCount(state.likes_count);
      }
    } else {
      setUserReaction(emoji);
      setReactionEmojis(prev => {
        const nextEmojis = [...prev];
        const nextNums = [...reactionNums];
        if (prevReaction) {
          const pi = nextEmojis.indexOf(prevReaction);
          if (pi >= 0) {
            nextNums[pi] = Math.max(0, (nextNums[pi] ?? 1) - 1);
            if (nextNums[pi] === 0) { nextEmojis.splice(pi, 1); nextNums.splice(pi, 1); }
          }
        }
        const ei = nextEmojis.indexOf(emoji);
        if (ei >= 0) nextNums[ei]++;
        else { nextEmojis.push(emoji); nextNums.push(1); }
        setReactionNums(nextNums);
        return nextEmojis;
      });
      await supabase.from('post_reactions').upsert(
        { post_id: post.id, user_id: user.id, emoji },
        { onConflict: 'post_id,user_id' }
      );
      if (emoji === '❤️' && !isLiked) {
        const state = await togglePostLike(post.id);
        setIsLiked(state.is_liked);
        setLikesCount(state.likes_count);
        if (state.is_liked && post.user_id !== user.id) {

        }
      } else if (prevReaction === '❤️' && emoji !== '❤️' && isLiked) {
        const state = await togglePostLike(post.id);
        setIsLiked(state.is_liked);
        setLikesCount(state.likes_count);
      }
    }
    onUpdate?.();
  };

  // Multi-language Post Translation
  const LANGUAGES = [
    { code: 'en', label: 'English', flag: '🇬🇧' },
    { code: 'es', label: 'Español', flag: '🇪🇸' },
    { code: 'fr', label: 'Français', flag: '🇫🇷' },
    { code: 'sw', label: 'Kiswahili', flag: '🇰🇪' },
    { code: 'ar', label: 'العربية', flag: '🇸🇦' },
  ];
  const [translatedContent, setTranslatedContent] = useState<string | null>(null);
  const [showTranslation, setShowTranslation] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [targetLang, setTargetLang] = useState<string>('en');
  const [showLangPicker, setShowLangPicker] = useState(false);
  const translationCacheRef = useRef<Record<string, string>>({});

  const handleTranslate = async (e: React.MouseEvent, lang?: string) => {
    e.stopPropagation();
    const selectedLang = lang ?? targetLang;
    if (showTranslation && selectedLang === targetLang && !lang) { setShowTranslation(false); return; }
    if (translationCacheRef.current[selectedLang]) {
      setTranslatedContent(translationCacheRef.current[selectedLang]);
      setTargetLang(selectedLang);
      setShowTranslation(true);
      return;
    }
    setTranslating(true);
    setShowLangPicker(false);
    try {
      const langName = LANGUAGES.find(l => l.code === selectedLang)?.label ?? selectedLang;
      const { data: cached } = await supabase
        .from('post_translations')
        .select('translated_content')
        .eq('post_id', post.id)
        .eq('language_code', selectedLang)
        .maybeSingle();
      if (cached?.translated_content) {
        translationCacheRef.current[selectedLang] = cached.translated_content;
        setTranslatedContent(cached.translated_content);
        setTargetLang(selectedLang);
        setShowTranslation(true);
        setTranslating(false);
        return;
      }
      const { data, error } = await supabase.functions.invoke('ai-chat', {
        body: {
          messages: [{ role: 'user', content: `Translate the following social media post to ${langName}. Return ONLY the translated text, no explanations:\n\n${post.content}` }],
          model: 'gemini-2.0-flash',
        },
      });
      if (error) throw error;
      const translated = data?.choices?.[0]?.message?.content ?? data?.content ?? data?.text ?? data?.response ?? '';
      if (translated.trim()) {
        translationCacheRef.current[selectedLang] = translated.trim();
        setTranslatedContent(translated.trim());
        setTargetLang(selectedLang);
        setShowTranslation(true);
        await supabase.from('post_translations').upsert(
          { post_id: post.id, language_code: selectedLang, translated_content: translated.trim() },
          { onConflict: 'post_id,language_code' }
        ).catch(() => {});
      }
    } catch (err) {
      console.warn('[translate]', err);
      toast({ title: 'Translation failed', description: 'Could not translate this post', variant: 'destructive' });
    } finally {
      setTranslating(false);
    }
  };

  const fetchAnalytics = useCallback(async () => {
    if (analytics) return;
    setLoadingAnalytics(true);
    const { data } = await supabase
      .from('post_analytics')
      .select('views, unique_viewers, engagement_rate, shares')
      .eq('post_id', post.id)
      .maybeSingle();
    setAnalytics(data ?? { views: post.views_count ?? 0, unique_viewers: 0, engagement_rate: 0, shares: 0 });
    setLoadingAnalytics(false);
  }, [post.id, analytics, post.views_count]);

  const openTooltip = useCallback(() => {
    setShowEngagement(true);
    fetchAnalytics();
  }, [fetchAnalytics]);

  const closeTooltip = useCallback(() => {
    setShowEngagement(false);
  }, []);

  const handleViewsMouseDown = () => {
    tooltipTimer.current = setTimeout(openTooltip, 500);
  };
  const handleViewsMouseUp = () => {
    if (tooltipTimer.current) clearTimeout(tooltipTimer.current);
  };

  // ── Inline Comment Thread ─────────────────────────────────────────────────
  const [showComments, setShowComments] = useState(false);
  const [inlineReplies, setInlineReplies] = useState<any[]>([]);
  const [inlineLoading, setInlineLoading] = useState(false);
  const [inlineReplyText, setInlineReplyText] = useState('');
  const [inlinePosting, setInlinePosting] = useState(false);
  const [replyingToId, setReplyingToId] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  // esbuild guard: parallel arrays replace Set<string> state (no Set in useState)
  const [expandedRepliesIds, setExpandedRepliesIds] = useState<string[]>([]);

  const fetchInlineReplies = async () => {
    setInlineLoading(true);
    try {
      const result = await backendCapabilities.listReplies(post.id, 50);
      setInlineReplies(result.items.map((reply: any) => ({ ...reply, user_profiles: reply.profile })));
    } catch (error) {
      console.error('Reply list error:', error);
      setInlineReplies([]);
    }
    setInlineLoading(false);
  };

  const toggleComments = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!showComments) fetchInlineReplies();
    setShowComments(v => !v);
  };

  const postInlineReply = async (parentId?: string) => {
    const text = parentId ? replyText.trim() : inlineReplyText.trim();
    if (!text || !user) return;
    if (parentId) { setReplyText(''); setReplyingToId(null); }
    else setInlineReplyText('');
    setInlinePosting(true);
    try {
      await backendCapabilities.createReply(post.id, text);
      await fetchInlineReplies();
    } catch (error) {
      toast({ title: 'Reply failed', description: error instanceof Error ? error.message : 'Failed to reply', variant: 'destructive' });
    }
    setInlinePosting(false);
  };

  const nestReplies = (flat: any[]) => flat;

  // Helper: check if 'all' is in expandedRepliesIds (replaces Set.has)
  const isAllExpanded = expandedRepliesIds.includes('all');
  const toggleAllExpanded = () => {
    setExpandedRepliesIds(prev =>
      prev.includes('all') ? prev.filter(x => x !== 'all') : [...prev, 'all']
    );
  };

  // Tip dialog state
  const [showTipDialog, setShowTipDialog] = useState(false);
  const [tipAmount, setTipAmount] = useState<number | null>(null);
  const [tipMessage, setTipMessage] = useState('');
  const [tippingLoading, setTippingLoading] = useState(false);

  const handleSendTip = async () => {
    if (!user) { navigate('/auth'); return; }
    if (!tipAmount || tipAmount <= 0) return;
    setTippingLoading(true);
    try {
      const { error: tipErr } = await supabase.rpc('send_tip_with_platform_cut', {
        p_from_user_id: user.id,
        p_to_user_id: post.user_id,
        p_amount: tipAmount,
        p_message: tipMessage.trim() || null,
        p_post_id: post.id,
      });
      if (tipErr) {
        const { data: wallet } = await supabase.from('user_wallets').select('id,balance').eq('user_id', user.id).maybeSingle();
        if (!wallet || Number(wallet.balance) < tipAmount) {
          toast({ title: 'Insufficient balance', description: 'Top up your wallet to send tips', variant: 'destructive' }); return;
        }
        await supabase.from('user_wallets').update({ balance: Number(wallet.balance) - tipAmount }).eq('user_id', user.id);
        await supabase.from('tips').insert({ from_user_id: user.id, to_user_id: post.user_id, amount: tipAmount, message: tipMessage.trim() || null, post_id: post.id });
        await supabase.from('notifications').insert({ recipient_id: post.user_id, kind: 'payment_sent', actor_id: user.id, post_id: post.id  });
        await supabase.from('creator_earnings').insert({ user_id: post.user_id, source: 'tips', amount: tipAmount, post_id: post.id, status: 'paid' }).catch(() => {});
      } else {
        await supabase.from('notifications').insert({ recipient_id: post.user_id, kind: 'payment_sent', actor_id: user.id, post_id: post.id  });
      }
      toast({ title: `Tip of $${tipAmount} sent!`, description: `You tipped @${post.user_profiles?.username}` });
      setShowTipDialog(false);
      setTipAmount(null);
      setTipMessage('');
    } catch (err: any) {
      toast({ title: 'Tip failed', description: err.message, variant: 'destructive' });
    } finally {
      setTippingLoading(false);
    }
  };

  const [showReportDialog, setShowReportDialog] = useState(false);
  const [reportCategory, setReportCategory] = useState('');
  const [reportSubmitting, setReportSubmitting] = useState(false);

  // Full Post Analytics Modal
  const [showFullAnalytics, setShowFullAnalytics] = useState(false);
  const [fullAnalyticsData, setFullAnalyticsData] = useState<{ date: string; views: number }[] | null>(null);
  const [fullAnalyticsLoading, setFullAnalyticsLoading] = useState(false);
  const [fullAnalyticsMeta, setFullAnalyticsMeta] = useState<{ views: number; unique: number; engagement: number; shares: number } | null>(null);
  // Reactions summary — parallel arrays (esbuild guard: no Record<string,number> in state)
  const [reactionSummaryEmojis, setReactionSummaryEmojis] = useState<string[]>([]);
  const [reactionSummaryCounts, setReactionSummaryCounts] = useState<number[]>([]);

  const fetchFullAnalyticsData = useCallback(async () => {
    if (fullAnalyticsData) return;
    setFullAnalyticsLoading(true);
    // 7-day daily view counts from browsing_history
    const since = new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10);
    const [historyRes, analyticsRes] = await Promise.all([
      supabase.from('browsing_history').select('created_at').eq('post_id', post.id).eq('view_type', 'post').gte('created_at', since),
      supabase.from('post_analytics').select('views, unique_viewers, engagement_rate, shares').eq('post_id', post.id).maybeSingle(),
    ]);
    // Build 7-day chart — parallel arrays, no index-sig (esbuild guard)
    const dayKeys: string[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400000);
      dayKeys.push(d.toISOString().slice(0, 10));
    }
    const counts = new Array<number>(7).fill(0);
    for (const row of (historyRes.data ?? [])) {
      const day = String(row.created_at ?? '').slice(0, 10);
      const idx = dayKeys.indexOf(day);
      if (idx >= 0) counts[idx]++;
    }
    setFullAnalyticsData(dayKeys.map((d, i) => ({ date: d.slice(5), views: counts[i] })));
    const a = analyticsRes.data;
    setFullAnalyticsMeta({
      views: a?.views ?? post.views_count ?? 0,
      unique: a?.unique_viewers ?? 0,
      engagement: Number(a?.engagement_rate ?? 0),
      shares: a?.shares ?? 0,
    });
    // Fetch reactions summary
    const { data: reactData } = await supabase
      .from('post_reactions')
      .select('emoji')
      .eq('post_id', post.id);
    const emojiList: string[] = [];
    const countList: number[] = [];
    for (const row of (reactData ?? [])) {
      const idx = emojiList.indexOf(row.emoji);
      if (idx >= 0) countList[idx]++;
      else { emojiList.push(row.emoji); countList.push(1); }
    }
    // Sort descending by count
    const sortOrder = countList
      .map((c, i) => ({ c, i }))
      .sort((a, b) => b.c - a.c);
    setReactionSummaryEmojis(sortOrder.map(s => emojiList[s.i]));
    setReactionSummaryCounts(sortOrder.map(s => s.c));
    setFullAnalyticsLoading(false);
  }, [post.id, post.views_count, fullAnalyticsData]);

  const handleSubmitReport = async () => {
    if (!user || !reportCategory) return;
    setReportSubmitting(true);
    await supabase.from('post_reports').upsert(
      { post_id: post.id, reporter_id: user.id, category: reportCategory },
      { onConflict: 'post_id,reporter_id' }
    ).catch(() => {});
    toast({ title: 'Report submitted', description: 'Thanks for helping keep the community safe.' });
    setShowReportDialog(false);
    setReportCategory('');
    setReportSubmitting(false);
  };

  // Video monetization pre-roll
  const videoRef2 = useRef<HTMLVideoElement | null>(null);
  const adShownRef = useRef(false);
  const [showVideoAd, setShowVideoAd] = useState(false);

  const handleVideoPlay = () => {
    if ((post as any).is_monetized && !adShownRef.current) {
      adShownRef.current = true;
      videoRef2.current?.pause();
      setShowVideoAd(true);
    }
  };

  const handleAdComplete = () => {
    setShowVideoAd(false);
    videoRef2.current?.play().catch(() => {});
  };

  const mediaUrls = post.media_urls && post.media_urls.length > 0
    ? post.media_urls
    : post.image_url
      ? [post.image_url]
      : [];

  const boostLabel = post.is_boosted
    ? post.boost_type === 'paid' ? 'Sponsored Content' : 'Boosted Content'
    : null;

  useEffect(() => {
    const fetchPoll = async () => {
      const { data } = await supabase
        .from('polls')
        .select('*, options:poll_options(*)')
        .eq('post_id', post.id)
        .maybeSingle();
      if (data) setPoll(data);
    };
    fetchPoll();
  }, [post.id]);

  useEffect(() => {
    if (!user) return;
    const checkUserInteractions = async () => {
      try {
        const [likeResult, repostResult] = await Promise.all([
          backendCapabilities.getLikeState(post.id),
          backendCapabilities.getRepostState(post.id),
        ]);
        setIsLiked(likeResult.state.is_liked);
        setIsReposted(repostResult.state.is_reposted);
        setLikesCount(likeResult.state.likes_count);
        setRepostsCount(repostResult.state.reposts_count);
      } catch (error) {
        console.error('Error checking user interactions:', error);
      }
    };
    checkUserInteractions();
  }, [user, post.id]);

  const handleLike = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!user) { navigate('/auth'); return; }
    const previousIsLiked = isLiked;
    const previousLikesCount = likesCount;
    const optimisticIsLiked = !previousIsLiked;
    setIsLiked(optimisticIsLiked);
    try {
      const state = await togglePostLike(post.id);
      setIsLiked(state.is_liked);
      setLikesCount(state.likes_count);
      if (state.is_liked) {
        updateInterestSignal(user.id, post.id, 'like').catch(() => {});
      }
      onUpdate?.();
    } catch (error) {
      console.error('Like error:', error);
      setIsLiked(previousIsLiked);
      setLikesCount(previousLikesCount);
      toast({ title: 'Error', description: error instanceof Error ? error.message : 'Failed to like post', variant: 'destructive' });
    }
  };

  const handleRepost = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!user) { navigate('/auth'); return; }
    const previousIsReposted = isReposted;
    const previousRepostsCount = repostsCount;
    const optimisticIsReposted = !previousIsReposted;
    setIsReposted(optimisticIsReposted);
    try {
      const state = await togglePostRepost(post.id);
      setIsReposted(state.is_reposted);
      setRepostsCount(state.reposts_count);
      if (state.is_reposted) {
        toast({ title: 'Reposted successfully' });
        updateInterestSignal(user.id, post.id, 'repost').catch(() => {});
      } else {
        toast({ title: 'Repost removed' });
      }
      onUpdate?.();
    } catch (error) {
      console.error('Repost error:', error);
      setIsReposted(previousIsReposted);
      setRepostsCount(previousRepostsCount);
      toast({ title: 'Error', description: error instanceof Error ? error.message : 'Failed to repost', variant: 'destructive' });
    }
  };

  const handleNativeShare = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const url = `${window.location.origin}/post/${post.id}`;
    const shareText = `${post.content.slice(0, 150)}${post.content.length > 150 ? '\u2026' : ''}`;
    const trackShare = () => {
      setShareCount(c => c + 1);
      supabase.from('post_analytics').select('id, shares').eq('post_id', post.id).maybeSingle().then(({ data }) => {
        if (data?.id) supabase.from('post_analytics').update({ shares: (data.shares || 0) + 1 }).eq('id', data.id).catch(() => {});
        else supabase.from('post_analytics').insert({ post_id: post.id, shares: 1 }).catch(() => {});
      });
    };
    if (navigator.share) {
      try {
        await navigator.share({ title: `@${post.user_profiles?.username} on Tsocial`, text: shareText, url });
        trackShare();
      } catch (err: any) {
        if (err?.name !== 'AbortError') setShowShareDialog(true);
      }
    } else {
      try {
        await navigator.clipboard.writeText(url);
        toast({ title: 'Link copied!', description: 'Post link copied to clipboard' });
        trackShare();
      } catch {
        setShowShareDialog(true);
      }
    }
  };

  const handlePostClick = () => { navigate(`/post/${post.id}`); };

  const handleDelete = async () => {
    if (!window.confirm('Are you sure you want to delete this post? This action cannot be undone.')) return;
    try {
      const { error } = await supabase.from('posts').delete().eq('id', post.id).eq('user_id', user?.id);
      if (error) throw error;
      toast({ title: 'Post deleted successfully' });
      onUpdate?.();
    } catch (error: any) {
      console.error('Error deleting post:', error);
      toast({ title: 'Error', description: error.message || 'Failed to delete post', variant: 'destructive' });
    }
  };

  return (
    <div
      className="border-b border-border p-4 hover:bg-muted/5 transition-colors cursor-pointer"
      onClick={handlePostClick}
    >
      {boostLabel && (
        <div className={`flex items-center gap-1.5 text-xs font-semibold mb-2 px-1 ${boostLabel === 'Sponsored Content' ? 'text-blue-500' : 'text-amber-500'}`}>
          {boostLabel === 'Sponsored Content'
            ? <><TrendingUp className="w-3 h-3" /> Sponsored Content</>
            : <><Zap className="w-3 h-3" /> Boosted Content</>}
        </div>
      )}
      <div className="flex space-x-3">
        <div
          className="w-10 h-10 rounded-full bg-muted flex-shrink-0 overflow-hidden cursor-pointer"
          onClick={(e) => { e.stopPropagation(); navigate(`/profile/${post.user_profiles?.username}`); }}
        >
          {post.user_profiles?.avatar_url ? (
            <img src={post.user_profiles.avatar_url} alt={post.user_profiles.username} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-sm font-semibold">
              {post.user_profiles?.username[0]?.toUpperCase()}
            </div>
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between">
            <div
              className="flex items-center space-x-1 min-w-0 cursor-pointer"
              onClick={(e) => { e.stopPropagation(); navigate(`/profile/${post.user_profiles?.username}`); }}
            >
              <span className="font-bold text-foreground truncate">{post.user_profiles?.username}</span>
              {post.user_profiles?.verified && (
                <BadgeCheck className="w-4 h-4 text-primary flex-shrink-0" fill="currentColor" />
              )}
              {isAuthorPremium && (
                <Crown className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" fill="currentColor" aria-label="Premium Member" />
              )}
              <span className="text-muted-foreground text-sm truncate">@{post.user_profiles?.username}</span>
              <span className="text-muted-foreground text-sm flex-shrink-0">·</span>
              <span className="text-muted-foreground text-sm flex-shrink-0">
                {formatDistanceToNow(new Date(post.created_at), { addSuffix: true })}
              </span>
            </div>
            {user?.id === post.user_id && (
              <div className="relative flex-shrink-0">
                <button
                  className="text-muted-foreground hover:text-primary p-2 -mr-2"
                  onClick={(e) => { e.stopPropagation(); setShowDeleteMenu(!showDeleteMenu); }}
                  title="Options"
                >
                  <MoreHorizontal className="w-5 h-5" />
                </button>
                {showDeleteMenu && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={(e) => { e.stopPropagation(); setShowDeleteMenu(false); }} />
                    <div className="absolute right-0 mt-2 w-48 bg-background border border-border rounded-lg shadow-lg z-50">
                      <button
                        onClick={(e) => { e.stopPropagation(); setShowEditDialog(true); setShowDeleteMenu(false); }}
                        className="w-full text-left px-4 py-3 hover:bg-muted flex items-center gap-2 rounded-t-lg"
                      >
                        <MoreHorizontal className="w-4 h-4" /> Edit post
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); setShowDeleteMenu(false); navigate(`/create-ad?from_post=${post.id}&title=${encodeURIComponent(post.content.slice(0, 80))}&desc=${encodeURIComponent(post.content.slice(0, 200))}&img=${encodeURIComponent((post as any).image_url ?? '')}&vid=${encodeURIComponent((post as any).video_url ?? '')}`); }}
                        className="w-full text-left px-4 py-3 hover:bg-muted flex items-center gap-2"
                      >
                        <Megaphone className="w-4 h-4 text-amber-500" /> Boost as Ad
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); setShowDeleteMenu(false); navigate(`/boost-analytics?post_id=${post.id}`); }}
                        className="w-full text-left px-4 py-3 hover:bg-muted flex items-center gap-2"
                      >
                        <TrendingUp className="w-4 h-4 text-green-500" /> View Boost Stats
                      </button>
                      {editHistory.length > 0 && (
                        <button
                          onClick={(e) => { e.stopPropagation(); setShowEditHistory(true); setShowDeleteMenu(false); }}
                          className="w-full text-left px-4 py-3 hover:bg-muted flex items-center gap-2"
                        >
                          <History className="w-4 h-4 text-blue-500" /> Edit History
                        </button>
                      )}
                      <button
                        onClick={(e) => { e.stopPropagation(); setShowDeleteMenu(false); setShowFullAnalytics(true); fetchFullAnalyticsData(); }}
                        className="w-full text-left px-4 py-3 hover:bg-muted flex items-center gap-2"
                      >
                        <BarChart3 className="w-4 h-4 text-blue-500" /> Post Analytics
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); setShowDeleteMenu(false); handleDelete(); }}
                        className="w-full text-left px-4 py-3 hover:bg-destructive/10 text-destructive flex items-center gap-2 rounded-b-lg"
                      >
                        <Trash2 className="w-4 h-4" /> Delete post
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          <div
            className="post-content text-foreground mt-1 whitespace-pre-wrap break-words"
            dangerouslySetInnerHTML={{ __html: parseContent(showTranslation && translatedContent ? translatedContent : post.content) }}
            onClick={(e) => { const target = e.target as HTMLElement; if (target.tagName === 'A') e.stopPropagation(); }}
          />

          {/* Translate button with multi-language picker */}
          {post.content && post.content.length > 20 && (
            <div className="relative mt-1">
              <div className="flex items-center gap-2">
                <button
                  onClick={handleTranslate}
                  className={`flex items-center gap-1 text-xs font-medium transition-colors ${showTranslation ? 'text-primary' : 'text-muted-foreground hover:text-primary'}`}
                >
                  {translating ? <TransLoader className="w-3 h-3 animate-spin" /> : <Languages className="w-3 h-3" />}
                  {translating ? 'Translating…' : showTranslation ? 'Show original' : 'Translate'}
                </button>
                {!showTranslation && !translating && (
                  <button
                    onClick={e => { e.stopPropagation(); setShowLangPicker(p => !p); }}
                    className="text-xs text-muted-foreground hover:text-primary flex items-center gap-0.5 transition-colors"
                    title="Pick language"
                  >
                    <span>{LANGUAGES.find(l => l.code === targetLang)?.flag ?? '🌐'}</span>
                    <span className="text-[10px]">{LANGUAGES.find(l => l.code === targetLang)?.label ?? 'EN'}</span>
                  </button>
                )}
              </div>
              {showLangPicker && (
                <>
                  <div className="fixed inset-0 z-40" onClick={e => { e.stopPropagation(); setShowLangPicker(false); }} />
                  <div className="absolute left-0 top-full mt-1 z-50 bg-background border border-border rounded-xl shadow-xl overflow-hidden min-w-[140px]" onClick={e => e.stopPropagation()}>
                    {LANGUAGES.map(lang => (
                      <button
                        key={lang.code}
                        onClick={e => { setTargetLang(lang.code); handleTranslate(e, lang.code); }}
                        className={`flex items-center gap-2 w-full px-3 py-2.5 text-xs font-medium hover:bg-muted transition-colors text-left ${targetLang === lang.code ? 'bg-primary/5 text-primary' : ''}`}
                      >
                        <span>{lang.flag}</span>{lang.label}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {/* Video Player with monetization pre-roll */}
          {post.is_video && post.video_url && (
            <div className="mt-3 relative rounded-2xl overflow-hidden bg-black max-h-[600px]" onClick={e => e.stopPropagation()}>
              {showVideoAd && (
                <VideoMonetizationAd
                  postId={post.id}
                  creatorUserId={post.user_id}
                  onAdComplete={handleAdComplete}
                  skipAfterSeconds={5}
                />
              )}
              {(post as any).is_monetized && (
                <div className="absolute top-2 right-2 z-10 flex items-center gap-1 px-2 py-0.5 bg-black/60 backdrop-blur-sm rounded-full text-xs text-green-400 font-semibold pointer-events-none">
                  <DollarSign className="w-3 h-3" />Monetized
                </div>
              )}
              <video
                ref={videoRef2}
                controls
                className="w-full h-full max-h-[600px] object-contain"
                playsInline
                preload="metadata"
                onPlay={handleVideoPlay}
              >
                <source src={post.video_url} type="video/mp4" />
                <source src={post.video_url} type="video/webm" />
                <source src={post.video_url} type="video/ogg" />
                Your browser does not support the video tag.
              </video>
            </div>
          )}

          {/* Multi-Image Grid */}
          {!post.is_video && mediaUrls.length > 0 && (
            <div className={`mt-3 gap-2 rounded-2xl overflow-hidden ${
              mediaUrls.length === 1 ? 'grid grid-cols-1' :
              mediaUrls.length === 2 ? 'grid grid-cols-2' :
              'grid grid-cols-2'
            }`}>
              {mediaUrls.map((url: string, index: number) => (
                <div key={index} className={`relative overflow-hidden ${mediaUrls.length === 3 && index === 0 ? 'col-span-2' : ''}`}>
                  <img src={url} alt={`Post media ${index + 1}`} className="w-full h-full object-cover max-h-96" />
                </div>
              ))}
            </div>
          )}

          {poll && <PollCard poll={poll} postId={post.id} />}

          {/* Embeds — YouTube, Spotify, SoundCloud, etc. */}
          {!post.is_video && <EmbedRenderer content={post.content} />}

          {/* Reaction bubbles */}
          {reactionEmojis.length > 0 && (
            <div className="flex gap-1.5 mt-2 flex-wrap" onClick={e => e.stopPropagation()}>
              {REACTIONS.filter(e => getReactionCount(e) > 0).map(emoji => (
                <button
                  key={emoji}
                  onClick={(e) => handleReact(emoji, e)}
                  className={cn(
                    'flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs border transition-all duration-100 hover:scale-105 active:scale-95',
                    userReaction === emoji
                      ? 'bg-primary/10 border-primary/30 text-primary font-semibold'
                      : 'bg-muted/50 border-border text-muted-foreground hover:border-primary/20 hover:bg-primary/5'
                  )}
                >
                  <span>{emoji}</span>
                  <span className="font-medium">{formatNumber(getReactionCount(emoji))}</span>
                </button>
              ))}
            </div>
          )}

          {/* Views count with Engagement Tooltip */}
          <div className="relative inline-block mt-2">
            <button
              onMouseEnter={openTooltip}
              onMouseLeave={closeTooltip}
              onMouseDown={handleViewsMouseDown}
              onMouseUp={handleViewsMouseUp}
              onTouchStart={handleViewsMouseDown}
              onTouchEnd={handleViewsMouseUp}
              onClick={e => { e.stopPropagation(); setShowFullAnalytics(true); fetchFullAnalyticsData(); }}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors cursor-pointer select-none"
            >
              <Eye className="w-3.5 h-3.5" />
              <span>{formatNumber(post.views_count || 0)} views</span>
              <BarChart3 className="w-3 h-3 opacity-40" />
            </button>

            {showEngagement && (
              <div
                ref={tooltipRef}
                className="absolute bottom-full left-0 mb-2 z-50 w-56 bg-background/95 backdrop-blur-md border border-border rounded-2xl shadow-xl p-3 pointer-events-none"
                onClick={e => e.stopPropagation()}
              >
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2 flex items-center gap-1">
                  <BarChart3 className="w-3 h-3" /> Post Analytics
                </p>
                {loadingAnalytics ? (
                  <div className="flex items-center justify-center py-3">
                    <span className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                  </div>
                ) : analytics ? (
                  <div className="grid grid-cols-2 gap-2">
                    <div className="bg-blue-500/8 rounded-xl p-2 text-center">
                      <p className="text-sm font-bold text-blue-600">{formatNumber(analytics.views ?? post.views_count ?? 0)}</p>
                      <p className="text-[9px] text-muted-foreground mt-0.5 flex items-center justify-center gap-0.5"><Eye className="w-2.5 h-2.5" />Views</p>
                    </div>
                    <div className="bg-purple-500/8 rounded-xl p-2 text-center">
                      <p className="text-sm font-bold text-purple-600">{formatNumber(analytics.unique_viewers ?? 0)}</p>
                      <p className="text-[9px] text-muted-foreground mt-0.5 flex items-center justify-center gap-0.5"><Users className="w-2.5 h-2.5" />Unique</p>
                    </div>
                    <div className="bg-green-500/8 rounded-xl p-2 text-center">
                      <p className="text-sm font-bold text-green-600">{Number(analytics.engagement_rate ?? 0).toFixed(1)}%</p>
                      <p className="text-[9px] text-muted-foreground mt-0.5 flex items-center justify-center gap-0.5"><TrendingUp className="w-2.5 h-2.5" />Engagement</p>
                    </div>
                    <div className="bg-orange-500/8 rounded-xl p-2 text-center">
                      <p className="text-sm font-bold text-orange-600">{formatNumber((analytics.shares ?? 0) + shareCount)}</p>
                      <p className="text-[9px] text-muted-foreground mt-0.5 flex items-center justify-center gap-0.5"><Share className="w-2.5 h-2.5" />Shares</p>
                    </div>
                  </div>
                ) : null}
                <div className="absolute -bottom-1.5 left-4 w-3 h-3 bg-background border-r border-b border-border rotate-45" />
              </div>
            )}
          </div>

          <div className="flex justify-between mt-3 max-w-md">
            <button
              className="flex items-center space-x-2 text-muted-foreground hover:text-primary transition-colors group"
              onClick={toggleComments}
            >
              <div className="p-2 rounded-full group-hover:bg-primary/10 transition-colors">
                <MessageCircle className="w-5 h-5" />
              </div>
              <span className="text-sm">{formatNumber(post.replies_count)}</span>
              {showComments ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3 opacity-50" />}
            </button>

            <button
              onClick={handleRepost}
              className={cn('flex items-center space-x-2 transition-colors group', isReposted ? 'text-green-500' : 'text-muted-foreground hover:text-green-500')}
            >
              <div className="p-2 rounded-full group-hover:bg-green-500/10 transition-colors">
                <Repeat2 className="w-5 h-5" />
              </div>
              <span className="text-sm">{formatNumber(repostsCount)}</span>
            </button>

            {/* Reaction button + picker */}
            <div className="relative">
              <button
                onClick={(e) => { e.stopPropagation(); setShowReactionPicker(p => !p); }}
                onMouseEnter={() => setShowReactionPicker(true)}
                onMouseLeave={() => setShowReactionPicker(false)}
                className={cn('flex items-center space-x-1.5 transition-colors group', userReaction ? 'text-pink-600' : 'text-muted-foreground hover:text-pink-600')}
              >
                <div className="p-2 rounded-full group-hover:bg-pink-600/10 transition-colors">
                  {userReaction ? <span className="text-base leading-none">{userReaction}</span> : <Heart className="w-5 h-5" />}
                </div>
                <span className="text-sm">{formatNumber(likesCount)}</span>
              </button>
              {showReactionPicker && (
                <div
                  className="absolute bottom-full mb-1 left-0 flex gap-0.5 bg-background border border-border rounded-full px-2 py-1.5 shadow-xl z-50"
                  onMouseEnter={() => setShowReactionPicker(true)}
                  onMouseLeave={() => setShowReactionPicker(false)}
                  onClick={e => e.stopPropagation()}
                >
                  {REACTIONS.map(emoji => (
                    <button
                      key={emoji}
                      onClick={(e) => handleReact(emoji, e)}
                      className={cn(
                        'text-xl transition-all duration-100 hover:scale-125 active:scale-90 rounded-full w-9 h-9 flex items-center justify-center',
                        userReaction === emoji ? 'bg-primary/10 scale-110 ring-2 ring-primary/20' : 'hover:bg-muted'
                      )}
                      title={emoji}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Quote Tweet */}
            <button
              title="Quote Tweet"
              className="flex items-center space-x-2 text-muted-foreground hover:text-blue-500 transition-colors group"
              onClick={e => { e.stopPropagation(); navigate(`/?quote_post_id=${post.id}&quote_preview=${encodeURIComponent(post.content.slice(0, 100))}`); }}
            >
              <div className="p-2 rounded-full group-hover:bg-blue-500/10 transition-colors">
                <Quote className="w-4 h-4" />
              </div>
            </button>

            <button
              className="flex items-center space-x-2 text-muted-foreground hover:text-primary transition-colors group"
              onClick={handleNativeShare}
            >
              <div className="p-2 rounded-full group-hover:bg-primary/10 transition-colors">
                <Share className="w-5 h-5" />
              </div>
              {shareCount > 0 && <span className="text-sm tabular-nums">{shareCount}</span>}
            </button>

            <div onClick={(e) => e.stopPropagation()}>
              <BookmarkButton postId={post.id} />
              {user && post.user_id !== user.id && (post as any).user_id && (
                <TipButton
                  postId={post.id}
                  creatorId={(post as any).user_id}
                  creatorUsername={(post as any).author?.username ?? 'creator'}
                  senderId={user.id}
                  senderUsername={user.username ?? user.email ?? 'me'}
                />
              )}
            </div>

            {user && user.id !== post.user_id && (
              <button
                className="flex items-center space-x-2 text-muted-foreground hover:text-amber-500 transition-colors group"
                onClick={(e) => { e.stopPropagation(); setShowTipDialog(true); }}
                title="Send a tip"
              >
                <div className="p-2 rounded-full group-hover:bg-amber-500/10 transition-colors">
                  <DollarSign className="w-5 h-5" />
                </div>
              </button>
            )}
            {user && user.id !== post.user_id && (
              <button
                className="flex items-center space-x-2 text-muted-foreground hover:text-red-500 transition-colors group"
                onClick={(e) => { e.stopPropagation(); setShowReportDialog(true); }}
                title="Report post"
              >
                <div className="p-2 rounded-full group-hover:bg-red-500/10 transition-colors">
                  <Flag className="w-4 h-4" />
                </div>
              </button>
            )}

            {user?.id === post.user_id && (
              <>
                <button
                  className="flex items-center space-x-2 text-muted-foreground hover:text-primary transition-colors group"
                  onClick={(e) => { e.stopPropagation(); setShowOneClickBoost(true); }}
                  title="Boost Post"
                >
                  <div className="p-2 rounded-full group-hover:bg-primary/10 transition-colors">
                    <TrendingUp className="w-5 h-5" />
                  </div>
                </button>
                <button
                  className="flex items-center space-x-2 text-muted-foreground hover:text-amber-500 transition-colors group"
                  onClick={(e) => { e.stopPropagation(); setShowRewardedBoost(true); }}
                  title="Free Boost (Watch Ad)"
                >
                  <div className="p-2 rounded-full group-hover:bg-amber-500/10 transition-colors">
                    <Zap className="w-5 h-5" />
                  </div>
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* ── Inline Comment Thread ──────────────────────────────────── */}
      {showComments && (
        <div className="mt-2 border-t border-border pt-3 space-y-3" onClick={e => e.stopPropagation()}>
          {user && (
            <div className="flex items-start gap-2 px-1">
              <div className="w-7 h-7 rounded-full bg-muted overflow-hidden shrink-0 mt-1">
                {user.avatar
                  ? <img src={user.avatar} alt={user.username} className="w-full h-full object-cover" />
                  : <div className="w-full h-full flex items-center justify-center text-xs font-bold">{user.username[0]?.toUpperCase()}</div>}
              </div>
              <div className="flex-1 flex items-center gap-2 bg-muted/50 border border-border rounded-xl px-3 py-1.5">
                <input
                  type="text"
                  value={inlineReplyText}
                  onChange={e => setInlineReplyText(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); postInlineReply(); } }}
                  placeholder="Add a comment…"
                  className="flex-1 bg-transparent text-sm focus:outline-none placeholder:text-muted-foreground/60"
                  maxLength={280}
                />
                <button
                  onClick={() => postInlineReply()}
                  disabled={!inlineReplyText.trim() || inlinePosting}
                  className="text-primary disabled:opacity-30 hover:opacity-80 transition-opacity"
                >
                  {inlinePosting ? <TransLoader className="w-4 h-4 animate-spin" /> : <SendIcon className="w-4 h-4" />}
                </button>
              </div>
            </div>
          )}

          {inlineLoading ? (
            <div className="flex justify-center py-3">
              <TransLoader className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : inlineReplies.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-3">No comments yet. Be the first!</p>
          ) : (
            <div className="space-y-0.5">
              {nestReplies(inlineReplies).slice(0, isAllExpanded ? 999 : 5).map((reply: any) => (
                <div key={reply.id} className="flex gap-2 px-1 py-2 rounded-xl hover:bg-muted/30 transition-colors group">
                  <button onClick={() => navigate(`/profile/${reply.user_profiles?.username}`)} className="shrink-0">
                    <div className="w-7 h-7 rounded-full bg-muted overflow-hidden">
                      {reply.user_profiles?.avatar_url
                        ? <img src={reply.user_profiles.avatar_url} alt={reply.user_profiles.username} className="w-full h-full object-cover" />
                        : <div className="w-full h-full flex items-center justify-center text-[10px] font-bold">{reply.user_profiles?.username?.[0]?.toUpperCase()}</div>}
                    </div>
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-xs font-bold">{reply.user_profiles?.username}</span>
                      {reply.user_profiles?.verified && <BadgeCheck className="w-3 h-3 text-primary shrink-0" fill="currentColor" />}
                      <span className="text-[10px] text-muted-foreground">
                        {formatDistanceToNow(new Date(reply.created_at), { addSuffix: true })}
                      </span>
                    </div>
                    <p className="text-sm leading-relaxed mt-0.5 break-words">{reply.content}</p>
                    <EmbedRenderer content={reply.content} />
                    <PostContentEmbeds content={reply.content} />
                    {user && (
                      <button
                        onClick={() => setReplyingToId(replyingToId === reply.id ? null : reply.id)}
                        className="text-[11px] text-muted-foreground hover:text-primary mt-1 transition-colors"
                      >
                        Reply
                      </button>
                    )}
                    {replyingToId === reply.id && (
                      <div className="flex items-center gap-2 mt-1.5">
                        <input
                          type="text"
                          value={replyText}
                          onChange={e => setReplyText(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') postInlineReply(reply.id); if (e.key === 'Escape') setReplyingToId(null); }}
                          placeholder={`Reply to @${reply.user_profiles?.username}…`}
                          className="flex-1 text-xs bg-muted/50 border border-border rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-primary/30"
                          autoFocus
                          maxLength={280}
                        />
                        <button onClick={() => postInlineReply(reply.id)} disabled={!replyText.trim()} className="text-primary disabled:opacity-30">
                          <SendIcon className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {inlineReplies.length > 5 && (
                <button
                  onClick={toggleAllExpanded}
                  className="w-full text-xs text-primary font-semibold py-2 hover:bg-primary/5 rounded-xl transition-colors flex items-center justify-center gap-1"
                >
                  {isAllExpanded
                    ? <><ChevronUp className="w-3.5 h-3.5" /> Show less</>
                    : <><ChevronDown className="w-3.5 h-3.5" /> View all {inlineReplies.length} comments</>}
                </button>
              )}
              {inlineReplies.length > 0 && (
                <button
                  onClick={() => navigate(`/post/${post.id}`)}
                  className="w-full text-xs text-muted-foreground py-1 hover:text-primary transition-colors text-center"
                >
                  View full thread →
                </button>
              )}
            </div>
          )}
        </div>
      )}

      <SharePostDialog open={showShareDialog} onOpenChange={setShowShareDialog} post={post} />

      {showEditHistory && editHistory.length > 0 && (
        <div className="fixed inset-0 z-[250] bg-black/60" onClick={(e) => { e.stopPropagation(); setShowEditHistory(false); }}>
          <div className="absolute bottom-0 left-0 right-0 bg-background rounded-t-3xl max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="sticky top-0 bg-background border-b border-border px-5 py-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <History className="w-5 h-5 text-blue-500" />
                <h2 className="font-bold text-base">Edit History</h2>
                <span className="text-xs bg-blue-500/10 text-blue-600 font-semibold px-2 py-0.5 rounded-full">{editHistory.length} edit{editHistory.length !== 1 ? 's' : ''}</span>
              </div>
              <button onClick={(e) => { e.stopPropagation(); setShowEditHistory(false); }} className="p-2 rounded-full hover:bg-muted transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="px-5 py-4 border-b border-border bg-green-500/3">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-[10px] font-bold uppercase tracking-widest text-green-600 bg-green-500/10 px-2 py-0.5 rounded-full">Current</span>
                {(post as any).edited_at && (
                  <span className="text-xs text-muted-foreground">
                    {new Date((post as any).edited_at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </span>
                )}
              </div>
              <p className="text-sm leading-relaxed whitespace-pre-wrap break-words text-green-800 dark:text-green-300 bg-green-500/5 rounded-xl px-3 py-2.5">{post.content}</p>
            </div>
            {[...editHistory].reverse().map((entry: any, idx: number) => (
              <div key={idx} className="px-5 py-4 border-b border-border last:border-0">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground bg-muted px-2 py-0.5 rounded-full">v{editHistory.length - idx}</span>
                  {entry.edited_at && (
                    <span className="text-xs text-muted-foreground">
                      {new Date(entry.edited_at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </span>
                  )}
                </div>
                <p className="text-sm leading-relaxed whitespace-pre-wrap break-words line-through text-muted-foreground/70 bg-red-500/3 rounded-xl px-3 py-2.5">
                  {entry.content ?? entry.previous_content ?? '(no content saved)'}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {showTipDialog && (
        <div className="fixed inset-0 z-[300] bg-black/60 flex items-center justify-center p-4" onClick={(e) => { e.stopPropagation(); setShowTipDialog(false); }}>
          <div className="bg-background border border-border rounded-2xl p-6 w-full max-w-sm shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full overflow-hidden bg-muted">
                {post.user_profiles?.avatar_url
                  ? <img src={post.user_profiles.avatar_url} alt="" className="w-full h-full object-cover" />
                  : <div className="w-full h-full flex items-center justify-center font-bold text-sm">{post.user_profiles?.username?.[0]?.toUpperCase()}</div>}
              </div>
              <div>
                <p className="font-bold">Tip @{post.user_profiles?.username}</p>
                <p className="text-xs text-muted-foreground">Support this creator</p>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2 mb-4">
              {[1, 5, 10].map(amt => (
                <button key={amt} onClick={() => setTipAmount(tipAmount === amt ? null : amt)}
                  className={`py-3 rounded-xl font-bold text-lg border-2 transition-all ${tipAmount === amt ? 'border-amber-500 bg-amber-500/10 text-amber-600' : 'border-border hover:border-amber-400'}`}>${amt}</button>
              ))}
            </div>
            <input
              type="number" min="0.5" step="0.5"
              placeholder="Custom amount ($)"
              value={tipAmount && ![1,5,10].includes(tipAmount) ? tipAmount : ''}
              onChange={e => setTipAmount(parseFloat(e.target.value) || null)}
              className="w-full px-3 py-2 border border-border rounded-xl text-sm bg-background mb-3 focus:outline-none focus:ring-2 focus:ring-amber-500/30"
            />
            <textarea
              placeholder="Optional message…"
              value={tipMessage}
              onChange={e => setTipMessage(e.target.value)}
              rows={2}
              className="w-full px-3 py-2 border border-border rounded-xl text-sm bg-background mb-4 focus:outline-none focus:ring-2 focus:ring-amber-500/30 resize-none"
            />
            <div className="flex gap-2">
              <button onClick={() => { setShowTipDialog(false); setTipAmount(null); setTipMessage(''); }} className="flex-1 py-2.5 border border-border rounded-xl text-sm font-semibold hover:bg-muted">Cancel</button>
              <button onClick={handleSendTip} disabled={!tipAmount || tippingLoading}
                className="flex-1 py-2.5 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-sm font-bold disabled:opacity-50 flex items-center justify-center gap-1.5">
                {tippingLoading ? <TransLoader className="w-4 h-4 animate-spin" /> : <DollarSign className="w-4 h-4" />}
                {tipAmount ? `Send $${tipAmount}` : 'Send Tip'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Full Post Analytics Modal */}
      {showFullAnalytics && (
        <div className="fixed inset-0 z-[350] bg-black/70 flex items-end sm:items-center justify-center" onClick={e => { e.stopPropagation(); setShowFullAnalytics(false); }}>
          <div className="w-full max-w-md bg-background rounded-t-3xl sm:rounded-2xl overflow-hidden shadow-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="sticky top-0 bg-background border-b border-border px-5 py-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Activity className="w-5 h-5 text-primary" />
                <h2 className="font-black text-base">Post Analytics</h2>
              </div>
              <button onClick={() => setShowFullAnalytics(false)} className="p-2 rounded-full hover:bg-muted"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-5 space-y-5">
              {/* Post preview */}
              <div className="p-3 bg-muted/40 rounded-xl">
                <p className="text-xs text-muted-foreground line-clamp-2">{post.content?.slice(0, 120)}{(post.content?.length ?? 0) > 120 ? '…' : ''}</p>
              </div>
              {fullAnalyticsLoading ? (
                <div className="flex justify-center py-8"><TransLoader className="w-7 h-7 animate-spin text-primary" /></div>
              ) : (
                <>
                  {/* KPI grid — explicit render (esbuild guard: no icon obj in .map()) */}
                  {fullAnalyticsMeta && (
                    <div className="grid grid-cols-2 gap-3">
                      <div className="p-3.5 rounded-2xl bg-gradient-to-br from-blue-500/15 to-transparent border border-border">
                        <Eye className="w-4 h-4 mb-2 text-blue-500" />
                        <p className="font-black text-xl leading-none">{fullAnalyticsMeta.views.toLocaleString()}</p>
                        <p className="text-[10px] text-muted-foreground mt-1">Total Views</p>
                      </div>
                      <div className="p-3.5 rounded-2xl bg-gradient-to-br from-purple-500/15 to-transparent border border-border">
                        <Users className="w-4 h-4 mb-2 text-purple-500" />
                        <p className="font-black text-xl leading-none">{fullAnalyticsMeta.unique.toLocaleString()}</p>
                        <p className="text-[10px] text-muted-foreground mt-1">Unique Viewers</p>
                      </div>
                      <div className="p-3.5 rounded-2xl bg-gradient-to-br from-green-500/15 to-transparent border border-border">
                        <TrendingUp className="w-4 h-4 mb-2 text-green-500" />
                        <p className="font-black text-xl leading-none">{fullAnalyticsMeta.engagement.toFixed(1)}%</p>
                        <p className="text-[10px] text-muted-foreground mt-1">Engagement</p>
                      </div>
                      <div className="p-3.5 rounded-2xl bg-gradient-to-br from-orange-500/15 to-transparent border border-border">
                        <Share className="w-4 h-4 mb-2 text-orange-500" />
                        <p className="font-black text-xl leading-none">{fullAnalyticsMeta.shares.toLocaleString()}</p>
                        <p className="text-[10px] text-muted-foreground mt-1">Shares</p>
                      </div>
                    </div>
                  )}
                  {/* 7-day views chart */}
                  {fullAnalyticsData && (
                    <div className="bg-card border border-border rounded-2xl p-4">
                      <p className="text-sm font-bold mb-3 flex items-center gap-2">
                        <Eye className="w-4 h-4 text-blue-500" />Views (Last 7 Days)
                      </p>
                      {fullAnalyticsData.some(d => d.views > 0) ? (
                        <>
                          <div className="flex items-end gap-1 h-24">
                            {fullAnalyticsData.map(d => {
                              const maxV = Math.max(...fullAnalyticsData.map(x => x.views), 1);
                              const pct = Math.max(4, Math.round((d.views / maxV) * 100));
                              return (
                                <div key={d.date} className="flex-1 flex flex-col items-center gap-1">
                                  <span className="text-[9px] text-muted-foreground">{d.views > 0 ? d.views : ''}</span>
                                  <div className="w-full rounded-t-sm bg-primary/70" style={{ height: pct + '%' }} />
                                </div>
                              );
                            })}
                          </div>
                          <div className="flex gap-1 mt-1">
                            {fullAnalyticsData.map(d => (
                              <div key={d.date} className="flex-1 text-center">
                                <span className="text-[9px] text-muted-foreground font-mono">{d.date}</span>
                              </div>
                            ))}
                          </div>
                        </>
                      ) : (
                        <div className="flex items-center justify-center h-20 text-muted-foreground text-xs">No view data in the last 7 days</div>
                      )}
                    </div>
                  )}
                  {/* Reactions Summary — no IIFE (esbuild guard) */}
                  {reactionSummaryEmojis.length > 0 && (
                    <div className="bg-card border border-border rounded-2xl p-4">
                      <p className="text-sm font-bold mb-3 flex items-center gap-2">
                        <span className="text-base">❤️</span>Reactions Breakdown
                      </p>
                      <div className="space-y-2">
                        {reactionSummaryEmojis.map((emoji, idx) => (
                          <div key={emoji} className="flex items-center gap-2.5">
                            <span className="text-lg w-7 shrink-0 text-center leading-none">{emoji}</span>
                            <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                              <div
                                className="h-full rounded-full bg-gradient-to-r from-primary/80 to-primary transition-all duration-500"
                                style={{ width: Math.max(6, Math.round((reactionSummaryCounts[idx] / (reactionSummaryCounts[0] ?? 1)) * 100)) + '%' }}
                              />
                            </div>
                            <span className="text-xs font-bold tabular-nums text-muted-foreground w-8 text-right shrink-0">{reactionSummaryCounts[idx]}</span>
                          </div>
                        ))}
                      </div>
                      <p className="text-[10px] text-muted-foreground mt-2.5">
                        {reactionSummaryCounts.reduce((a, b) => a + b, 0)} total reactions
                      </p>
                    </div>
                  )}
                  {/* Share Analytics — flat conditional render (esbuild guard: no IIFE, no const in render) */}
                  {fullAnalyticsMeta && fullAnalyticsMeta.shares >= 0 && (
                    <div className="bg-card border border-border rounded-2xl p-4">
                      <div className="flex items-center justify-between mb-3">
                        <p className="text-sm font-bold flex items-center gap-2">
                          <Share className="w-4 h-4 text-orange-500" />Share Analytics
                        </p>
                        <span className="text-xs font-bold text-orange-600 bg-orange-500/10 px-2 py-0.5 rounded-full border border-orange-500/20">
                          {fullAnalyticsMeta.views > 0 ? ((fullAnalyticsMeta.shares / fullAnalyticsMeta.views) * 100).toFixed(1) : '0.0'}% share rate
                        </span>
                      </div>
                      <div className="space-y-2.5">
                        <div className="flex items-center gap-2.5">
                          <span className="text-xs text-muted-foreground w-16 shrink-0">Views</span>
                          <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden"><div className="h-full bg-blue-500 rounded-full" style={{ width: '100%' }} /></div>
                          <span className="text-xs font-bold tabular-nums text-muted-foreground w-10 text-right shrink-0">{fullAnalyticsMeta.views.toLocaleString()}</span>
                        </div>
                        <div className="flex items-center gap-2.5">
                          <span className="text-xs text-muted-foreground w-16 shrink-0">Unique</span>
                          <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden"><div className="h-full bg-violet-500 rounded-full" style={{ width: Math.max(2, fullAnalyticsMeta.views > 0 ? Math.round((fullAnalyticsMeta.unique / fullAnalyticsMeta.views) * 100) : 0) + '%' }} /></div>
                          <span className="text-xs font-bold tabular-nums text-muted-foreground w-10 text-right shrink-0">{fullAnalyticsMeta.unique.toLocaleString()}</span>
                        </div>
                        <div className="flex items-center gap-2.5">
                          <span className="text-xs text-muted-foreground w-16 shrink-0">Reactions</span>
                          <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden"><div className="h-full bg-pink-500 rounded-full" style={{ width: Math.max(2, fullAnalyticsMeta.views > 0 ? Math.round((reactionSummaryCounts.reduce((a, b) => a + b, 0) / fullAnalyticsMeta.views) * 100) : 0) + '%' }} /></div>
                          <span className="text-xs font-bold tabular-nums text-muted-foreground w-10 text-right shrink-0">{reactionSummaryCounts.reduce((a, b) => a + b, 0).toLocaleString()}</span>
                        </div>
                        <div className="flex items-center gap-2.5">
                          <span className="text-xs text-muted-foreground w-16 shrink-0">Shares</span>
                          <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden"><div className="h-full bg-orange-500 rounded-full" style={{ width: Math.max(2, fullAnalyticsMeta.views > 0 ? Math.round((fullAnalyticsMeta.shares / fullAnalyticsMeta.views) * 100) : 0) + '%' }} /></div>
                          <span className="text-xs font-bold tabular-nums text-muted-foreground w-10 text-right shrink-0">{fullAnalyticsMeta.shares.toLocaleString()}</span>
                        </div>
                      </div>
                      <p className="text-[10px] text-muted-foreground mt-2.5">
                        {fullAnalyticsMeta.shares === 0 ? 'No shares yet — share the post to track' : `${fullAnalyticsMeta.shares} share${fullAnalyticsMeta.shares !== 1 ? 's' : ''} out of ${fullAnalyticsMeta.views.toLocaleString()} views`}
                      </p>
                    </div>
                  )}

                  <button onClick={() => { setShowFullAnalytics(false); navigate(`/post-analytics/${post.id}`); }}
                    className="w-full py-2.5 border border-border rounded-xl text-sm font-semibold text-muted-foreground hover:bg-muted transition-colors flex items-center justify-center gap-1.5">
                    <BarChart3 className="w-4 h-4" />Full Analytics Dashboard
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {showReportDialog && (
        <div className="fixed inset-0 z-[350] bg-black/60" onClick={e => { e.stopPropagation(); setShowReportDialog(false); setReportCategory(''); }}>
          <div className="absolute bottom-0 left-0 right-0 bg-background rounded-t-3xl p-5 space-y-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-bold text-lg">Report Post</h2>
                <p className="text-sm text-muted-foreground">Select the reason for this report</p>
              </div>
              <button onClick={() => { setShowReportDialog(false); setReportCategory(''); }} className="p-2 rounded-full hover:bg-muted">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-2">
              {REPORT_CATEGORIES.map(cat => (
                <button key={cat.id} onClick={() => setReportCategory(cat.id)}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border-2 text-left transition-all ${reportCategory === cat.id ? 'border-red-500 bg-red-500/5' : 'border-border hover:border-red-500/30 hover:bg-red-500/3'}`}>
                  <span className="text-xl shrink-0">{cat.emoji}</span>
                  <div className="flex-1">
                    <p className="text-sm font-semibold">{cat.label}</p>
                    <p className="text-xs text-muted-foreground">{cat.desc}</p>
                  </div>
                  {reportCategory === cat.id && (
                    <div className="w-5 h-5 rounded-full bg-red-500 flex items-center justify-center shrink-0">
                      <CheckIcon className="w-3 h-3 text-white" />
                    </div>
                  )}
                </button>
              ))}
            </div>
            <button onClick={handleSubmitReport} disabled={!reportCategory || reportSubmitting}
              className="w-full py-3.5 bg-red-500 text-white rounded-xl font-bold text-base disabled:opacity-50 flex items-center justify-center gap-2 hover:bg-red-600 transition-colors">
              {reportSubmitting ? <TransLoader className="w-5 h-5 animate-spin" /> : <Flag className="w-5 h-5" />}
              {reportSubmitting ? 'Submitting…' : 'Submit Report'}
            </button>
            <p className="text-xs text-muted-foreground text-center">Reports are reviewed by our moderation team within 24 hours.</p>
          </div>
        </div>
      )}

      {user?.id === post.user_id && (
        <>
          <EditPostDialog
            open={showEditDialog}
            onOpenChange={setShowEditDialog}
            post={post}
            onSuccess={() => { onUpdate?.(); toast({ title: 'Post updated' }); }}
          />
          <BoostPostDialog open={showBoostDialog} onOpenChange={setShowBoostDialog} postId={post.id} />
          <Dialog open={showOneClickBoost} onOpenChange={setShowOneClickBoost}>
            <DialogContent className="max-w-lg max-h-[92vh] flex flex-col p-0 overflow-hidden">
              <DialogHeader className="px-6 pt-5 pb-2 shrink-0 border-b border-border">
                <DialogTitle>Boost Your Post</DialogTitle>
              </DialogHeader>
              <div className="overflow-y-auto flex-1 px-6 py-4">
                <OneClickBoost postId={post.id} postContent={post.content} onClose={() => setShowOneClickBoost(false)} />
              </div>
            </DialogContent>
          </Dialog>
          <Dialog open={showRewardedBoost} onOpenChange={setShowRewardedBoost}>
            <DialogContent className="max-w-sm">
              <DialogHeader>
                <DialogTitle>Free Boost — Watch Ad</DialogTitle>
              </DialogHeader>
              <RewardedAdBoost
                postId={post.id}
                postContent={post.content}
                onClose={() => setShowRewardedBoost(false)}
                onBoostApplied={() => { setShowRewardedBoost(false); onUpdate?.(); }}
              />
            </DialogContent>
          </Dialog>
        </>
      )}
    </div>
  );
}
