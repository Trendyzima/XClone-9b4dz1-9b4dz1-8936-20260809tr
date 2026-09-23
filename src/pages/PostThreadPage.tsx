import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { TopBar } from '@/components/layout/TopBar';
import { PostCard } from '@/components/features/PostCard';
import { PollCard } from '@/components/features/PollCard';
import { CreatePollDialog } from '@/components/features/CreatePollDialog';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { sendActivityNotification } from '@/components/layout/AuthProvider';
import { Post } from '@/types/app-types';
import { Loader2, Send, BadgeCheck, Twitter, Facebook, Link2, MessageCircle, BarChart3, X, Heart } from 'lucide-react';
import { DynamicAd } from '@/components/features/DynamicAd';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { formatDistanceToNow } from 'date-fns';
import { useSEO, buildOgImageUrl } from '@/hooks/useSEO';
import * as federation from '@/api/federation';
import { createFederatedReply, getFederatedReplies } from '@/services/postInteractionService';

import { PageAdBanner } from '@/components/features/AdSenseAd';
import { EmbedRenderer, PostContentEmbeds } from '@/components/features/EmbedRenderer';

function PostThreadAdBanner() { return <PageAdBanner />; }

export default function PostThreadPage() {
  const { postId } = useParams<{ postId: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [post, setPost] = useState(null as Post | null);
  // useSEO — placed after ALL useState/useRef declarations below

  const [loading, setLoading] = useState(true);
  const [copySuccess, setCopySuccess] = useState(false);

  // Dynamic SEO — injected once post loads, upgrades to og-image edge function card
  useSEO({
    title: post
      ? `${post.user_profiles?.username ?? 'Post'} on Testagram`
      : 'Post — Testagram',
    description: post
      ? (post.content?.replace(/<[^>]*>/g, '').slice(0, 155) || 'View this post on Testagram')
      : 'View this post on Testagram',
    image: post ? buildOgImageUrl({ post: post.id }) : undefined,
    url: postId ? `/post/${postId}` : undefined,
    type: post?.is_video ? 'video.other' : 'article',
    keywords: post ? `${post.user_profiles?.username ?? ''}, testagram, post, social media` : undefined,
    structuredData: post ? {
      '@context': 'https://schema.org',
      '@type': 'SocialMediaPosting',
      headline: (post.content?.replace(/<[^>]*>/g, '').slice(0, 110) || 'Post on Testagram'),
      text: post.content?.replace(/<[^>]*>/g, '').slice(0, 500),
      datePublished: post.created_at,
      url: `https://testagram.site/post/${post.id}`,
      image: post.image_url || (post.media_urls?.[0]) || buildOgImageUrl({ post: post.id }),
      author: {
        '@type': 'Person',
        name: post.user_profiles?.username ?? 'Creator',
        url: `https://testagram.site/profile/${post.user_profiles?.username}`,
      },
      interactionStatistic: [
        { '@type': 'InteractionCounter', interactionType: 'https://schema.org/LikeAction', userInteractionCount: post.likes_count ?? 0 },
        { '@type': 'InteractionCounter', interactionType: 'https://schema.org/CommentAction', userInteractionCount: post.replies_count ?? 0 },
        { '@type': 'InteractionCounter', interactionType: 'https://schema.org/WatchAction', userInteractionCount: post.views_count ?? 0 },
      ],
      sharedContent: post.is_video && post.video_url ? { '@type': 'VideoObject', contentUrl: post.video_url } : undefined,
    } : undefined,
  });

  // Poll reply count every 10s — show floating pill when new replies arrive
  useEffect(() => {
    if (!postId) return;
    const fetchReplyCount = async () => {
      const { count } = await supabase
        .from('replies')
        .select('*', { count: 'exact', head: true })
        .eq('post_id', postId);
      if (count !== null) {
        setLiveReplyCount(count);
        if (knownReplyCount.current !== null && count > knownReplyCount.current) {
          setNewReplyCount(count - knownReplyCount.current);
        }
        // Initialize base after first load completes
        if (knownReplyCount.current === null) knownReplyCount.current = count;
      }
    };
    fetchReplyCount();
    const iv = setInterval(fetchReplyCount, 10_000);
    return () => clearInterval(iv);
  }, [postId]);

  const handleViewNewReplies = () => {
    knownReplyCount.current = liveReplyCount;
    setNewReplyCount(0);
    fetchPostAndReplies();
  };

  const fetchReplyLikes = async (replyIds: string[]) => {
    if (!replyIds.length) return;
    const { data: likes } = await supabase
      .from('reply_likes')
      .select('reply_id, user_id')
      .in('reply_id', replyIds);
    const map: Record<string, { count: number; liked: boolean }> = {};
    replyIds.forEach(id => { map[id] = { count: 0, liked: false }; });
    (likes ?? []).forEach((l: { reply_id: string; user_id: string }) => {
      if (!map[l.reply_id]) map[l.reply_id] = { count: 0, liked: false };
      map[l.reply_id].count++;
      if (l.user_id === user?.id) map[l.reply_id].liked = true;
    });
    setReplyLikes(prev => ({ ...prev, ...map }));
  };

  const handleReplyLike = async (replyId: string) => {
    if (!user) { navigate('/auth'); return; }
    const current = replyLikes[replyId] ?? { count: 0, liked: false };
    if (current.liked) {
      setReplyLikes(prev => ({ ...prev, [replyId]: { count: Math.max(0, (prev[replyId]?.count ?? 0) - 1), liked: false } }));
      await supabase.from('reply_likes').delete().eq('reply_id', replyId).eq('user_id', user.id);
    } else {
      setReplyLikes(prev => ({ ...prev, [replyId]: { count: (prev[replyId]?.count ?? 0) + 1, liked: true } }));
      await supabase.from('reply_likes').upsert({ reply_id: replyId, user_id: user.id }, { onConflict: 'reply_id,user_id' });
    }
  };

  const fetchPost = async () => {
    if (!postId) return;
    setLoading(true);
    try {
      // ActivityPub object URIs stay on the federation transport and never enter
      // local UUID-backed post/reply tables.
      if (/^https:\/\//i.test(postId)) {
        const remote = await federation.getFederatedObject(postId);
        const object = remote?.object ?? remote;
        if (!object?.id) throw new Error('Remote ActivityPub object not found');

        const actor = typeof object.attributedTo === 'string'
          ? object.attributedTo
          : object.attributedTo?.id ?? object.attributedTo?.url ?? '';
        const actorPath = actor ? actor.replace(/\/$/, '').split('/').pop() || 'Fediverse user' : 'Fediverse user';
        const published = object.published ?? object.created ?? new Date().toISOString();
        const attachments = Array.isArray(object.attachment) ? object.attachment : [];
        const mediaUrls = attachments
          .map((a: any) => a?.url ?? a?.href)
          .filter((v: any): v is string => typeof v === 'string');

        setPost({
          id: object.id,
          content: object.content ?? object.name ?? object.summary ?? '',
          created_at: published,
          updated_at: object.updated ?? published,
          user_id: actor,
          author_id: actor,
          user_profiles: {
            id: actor,
            username: actorPath.replace(/^@/, ''),
            display_name: object.attributedTo?.name ?? actorPath.replace(/^@/, ''),
            avatar_url: object.attributedTo?.icon?.url ?? object.attributedTo?.icon ?? undefined,
            verified: false,
          },
          likes_count: Number(object.likes?.totalItems ?? 0),
          reposts_count: Number(object.shares?.totalItems ?? 0),
          replies_count: Number(object.replies?.totalItems ?? 0),
          views_count: 0,
          media_urls: mediaUrls,
          image_url: mediaUrls.find((u: string) => /image|\.png$|\.jpe?g$|\.webp$/i.test(u)) ?? null,
          video_url: mediaUrls.find((u: string) => /video|\.mp4$|\.webm$/i.test(u)) ?? null,
          is_video: mediaUrls.some((u: string) => /video|\.mp4$|\.webm$/i.test(u)),
          is_federated: true,
          federation_id: object.id,
        } as Post);
        return;
      }

      const { data: postData, error: postError } = await supabase
        .from('posts')
        .select('*, profiles!posts_author_id_fkey(*)')
        .eq('id', postId)
        .single();
      if (postError) throw postError;
      setPost(postData);

      void supabase
        .from('posts')
        .update({ views_count: (postData.views_count || 0) + 1 })
        .eq('id', postId);
    } catch (err) {
      console.error('Error fetching post:', err);
      toast({ title: 'Error', description: 'Failed to load post', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (postId) void fetchPost();
  }, [postId]);

  const openReplies = () => {
    if (!postId) return;
    navigate(/^https:\/\//i.test(postId) ? `/post/${encodeURIComponent(postId)}/replies` : `/post/${postId}/replies`);
  };

  // Build URL lazily — avoids window.location at render scope (esbuild non-determinism)
  const getPostUrl = () => `${window.location.origin}/post/${postId}`;

  const copyLink = () => {
    const url = getPostUrl();
    navigator.clipboard.writeText(url).then(() => {
      setCopySuccess(true);
      toast({ title: 'Link copied!' });
      setTimeout(() => setCopySuccess(false), 2000);
    });
  };

  const shareToX = () => {
    const url = getPostUrl();
    const text = post ? `${post.content?.slice(0, 100)}...` : 'Check out this post on Testagram';
    window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`, '_blank');
  };

  const shareToFacebook = () => {
    const url = getPostUrl();
    window.open(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`, '_blank');
  };

  const shareToWhatsApp = () => {
    const url = getPostUrl();
    const text = post ? `${post.content?.slice(0, 100)}... ` : '';
    window.open(`https://wa.me/?text=${encodeURIComponent(text + url)}`, '_blank');
  };

  // Sync knownReplyCount once replies load
  useEffect(() => {
    if (replies.length > 0 && knownReplyCount.current === null) {
      knownReplyCount.current = replies.length;
    }
  }, [replies.length]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!post) {
    return (
      <div className="min-h-screen bg-background">
        <TopBar title="Post" showBack />
        <div className="flex flex-col items-center justify-center py-24 gap-4 text-muted-foreground">
          <MessageCircle className="w-16 h-16 opacity-30" />
          <p className="font-semibold text-lg">Post not found</p>
          <p className="text-sm text-center max-w-xs">This post may have been deleted or the link is invalid.</p>
          <Button onClick={() => navigate('/')} variant="outline" className="rounded-full">Go Home</Button>
        </div>
      </div>
    );
  }

  const postUrl = getPostUrl();
  const postThumb =
    (post.media_urls && post.media_urls.length > 0 ? post.media_urls[0] : null) ||
    post.image_url || null;

  return (
    <div className="min-h-screen bg-background pb-20 md:pb-0">
      <TopBar title="Post" showBack />
      <PostThreadAdBanner />

      <div className="border-b border-border p-4 bg-muted/5">
        <button
          onClick={openReplies}
          className="w-full flex items-center justify-between gap-3 rounded-2xl border border-border bg-background px-4 py-3 text-left hover:bg-muted/40 transition-colors"
        >
          <div>
            <p className="font-semibold">Replies</p>
            <p className="text-sm text-muted-foreground">
              {post.replies_count ?? 0} {post.replies_count === 1 ? 'reply' : 'replies'} · Open the independent replies page
            </p>
          </div>
          <MessageCircle className="w-5 h-5 text-muted-foreground shrink-0" />
        </button>
      </div>
      {/* Poll creation dialog for replies */}
      {showPollDialog && (
        <CreatePollDialog
          onClose={() => setShowPollDialog(false)}
          onPollCreated={(data) => {
            setReplyPollData(data);
            setShowPollDialog(false);
          }}
        />
      )}
    </div>
  );
}
