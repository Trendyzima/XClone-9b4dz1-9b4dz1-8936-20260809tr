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
import { getFederatedReplies } from '@/services/postInteractionService';

import { PageAdBanner } from '@/components/features/AdSenseAd';
import { EmbedRenderer, PostContentEmbeds } from '@/components/features/EmbedRenderer';

function PostThreadAdBanner() { return <PageAdBanner />; }

interface Reply {
  id: string;
  post_id: string;
  user_id: string;
  content: string;
  created_at: string;
  user_profiles: {
    id: string;
    username: string;
    avatar_url?: string;
    verified: boolean;
  };
}


export default function PostThreadPage() {
  const { postId } = useParams<{ postId: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [post, setPost] = useState(null as Post | null);
  // useSEO — placed after ALL useState/useRef declarations below

  const [replies, setReplies] = useState([] as Reply[]);
  const [loading, setLoading] = useState(true);
  const [replyContent, setReplyContent] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);
  const [liveReplyCount, setLiveReplyCount] = useState(null as number | null);
  const [newReplyCount, setNewReplyCount] = useState(0);
  const knownReplyCount = useRef<number | null>(null);
  // Maps reply.id → pollPost.id for inline poll display
  const [replyPollPostIds, setReplyPollPostIds] = useState({} as Record<string, string>);
  const [replyLikes, setReplyLikes] = useState({} as Record<string, { count: number; liked: boolean }>);

  // Poll in reply state
  const [showPollDialog, setShowPollDialog] = useState(false);
  const [replyPollData, setReplyPollData] = useState(null as { question: string; options: string[]; duration: number } | null);

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

  const fetchPostAndReplies = async () => {
    if (!postId) return;
    setLoading(true);
    try {
      // Federated posts are ActivityPub object URIs, not local UUIDs. Never send
      // them through the local posts table/detail resolver.
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

        const remotePost: any = {
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
        };
        setPost(remotePost);

        const [counts, remoteReplies] = await Promise.all([
          federation.getFederatedObject(postId).then((r: any) => ({
            likes: Number(r?.object?.likes?.totalItems ?? r?.likes?.totalItems ?? remotePost.likes_count),
            reposts: Number(r?.object?.shares?.totalItems ?? r?.shares?.totalItems ?? remotePost.reposts_count),
            replies: Number(r?.object?.replies?.totalItems ?? r?.replies?.totalItems ?? remotePost.replies_count),
          })).catch(() => null),
          getFederatedReplies(postId),
        ]);
        if (counts) {
          setPost(prev => prev ? ({ ...prev, likes_count: counts.likes, reposts_count: counts.reposts, replies_count: counts.replies }) : prev);
        }
        const mappedReplies: any[] = (remoteReplies || []).map((r: any) => ({
          id: r.id,
          post_id: postId,
          user_id: r.user_id,
          content: r.content,
          created_at: r.created_at,
          updated_at: r.updated_at,
          user_profiles: {
            id: r.user_id,
            username: r.user_id,
            display_name: r.user_id,
            verified: false,
          },
        }));
        setReplies(mappedReplies);
        return;
      }

      const { data: postData, error: postError } = await supabase
        .from('posts')
        .select('*, profiles (*)')
        .eq('id', postId)
        .single();
      if (postError) throw postError;
      setPost(postData);

      supabase
        .from('posts')
        .update({ views_count: (postData.views_count || 0) + 1 })
        .eq('id', postId)
        .then(() => {});

      const { data: repliesData, error: repliesError } = await supabase
        .from('replies')
        .select('*, profiles (*)')
        .eq('post_id', postId)
        .order('created_at', { ascending: true });
      if (repliesError) throw repliesError;
      setReplies(repliesData || []);
      if (repliesData?.length) fetchReplyLikes(repliesData.map((r: Reply) => r.id));
    } catch (err) {
      console.error('Error fetching post thread:', err);
      toast({ title: 'Error', description: 'Failed to load post', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (postId) fetchPostAndReplies();
  }, [postId]);

  const handleReply = async () => {
    if (!user) return navigate('/auth');
    if (!replyContent.trim() || !postId) return;

    setSubmitting(true);
    try {
      const { data: newReply, error: insertError } = await supabase.from('replies').insert({
        post_id: postId,
        user_id: user.id,
        content: replyContent.trim(),
      }).select().single();
      if (insertError) throw insertError;

      // Attach poll to this reply's post if user added one
      if (replyPollData && newReply) {
        // Create a mini post record for the poll linked to the reply content
        const { data: pollPost } = await supabase.from('posts').insert({
          user_id: user.id,
          content: replyContent.trim(),
          community_id: null,
        }).select().single();
        if (pollPost) {
          const expiresAt = new Date(Date.now() + replyPollData.duration * 60 * 1000);
          const { data: poll } = await supabase.from('polls').insert({
            post_id: pollPost.id,
            question: replyPollData.question,
            expires_at: expiresAt.toISOString(),
          }).select().single();
          if (poll) {
            await supabase.from('poll_options').insert(
              replyPollData.options.map(opt => ({ poll_id: poll.id, option_text: opt }))
            );
          }
          // Store pollPostId in a ref so we can display it
          setReplyPollPostIds(prev => ({ ...prev, [newReply.id]: pollPost.id }));
        }
        setReplyPollData(null);
      }

      if (post) {
        await supabase.from('posts')
          .update({ replies_count: (post.replies_count || 0) + 1 })
          .eq('id', postId);
      }

      if (post && post.user_id !== user.id) {
        await supabase.from('notifications').insert({ recipient_id: post.user_id, kind: 'reply', actor_id: user.id,
          post_id: postId,
         });
        await sendActivityNotification({
          recipientUserId: post.user_id,
          title: 'New Reply',
          body: `${user.username} replied to your post: "${replyContent.trim().slice(0, 60)}..."`,
          data: { route: `/post/${postId}`, type: 'reply', fromUserId: user.id, postId },
        });
      }

      setReplyContent('');
      toast({ title: 'Reply posted!' });
      fetchPostAndReplies();
    } catch (err: any) {
      console.error('Reply error:', err);
      toast({ title: 'Error', description: err.message || 'Failed to post reply', variant: 'destructive' });
    } finally {
      setSubmitting(false);
    }
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

      {/* ── Floating "View N new replies" pill ── */}
      {newReplyCount > 0 && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 animate-bounce">
          <button
            onClick={handleViewNewReplies}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-full shadow-lg shadow-primary/25 text-sm font-semibold"
          >
            <MessageCircle className="w-4 h-4" />
            View {newReplyCount} new {newReplyCount === 1 ? 'reply' : 'replies'}
          </button>
        </div>
      )}

      {/* Main post */}
      <PostCard post={post} onUpdate={fetchPostAndReplies} />

      {/* Share Panel */}
      <div className="border-b border-border p-4 bg-muted/5">
        <p className="text-xs font-semibold text-muted-foreground mb-3 uppercase tracking-wide">Share this post</p>
        {/* Thumbnail preview when image exists */}
        {postThumb && (
          <div className="mb-3 rounded-xl overflow-hidden border border-border flex items-center gap-3 p-2 bg-card">
            <img src={postThumb} alt="Post thumbnail" className="w-16 h-16 object-cover rounded-lg flex-shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-medium truncate">{post.user_profiles?.username} on Testagram</p>
              <p className="text-xs text-muted-foreground truncate">{post.content?.slice(0, 80)}</p>
              <p className="text-xs text-primary mt-0.5 truncate">{postUrl}</p>
            </div>
          </div>
        )}
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={copyLink}
            className="flex items-center gap-1.5 px-3 py-2 rounded-full bg-muted hover:bg-muted/80 text-sm font-medium transition-colors"
          >
            <Link2 className="w-4 h-4" />
            {copySuccess ? 'Copied!' : 'Copy Link'}
          </button>
          <button
            onClick={shareToX}
            className="flex items-center gap-1.5 px-3 py-2 rounded-full bg-black text-white hover:bg-neutral-800 text-sm font-medium transition-colors"
          >
            <Twitter className="w-4 h-4" />
            X (Twitter)
          </button>
          <button
            onClick={shareToFacebook}
            className="flex items-center gap-1.5 px-3 py-2 rounded-full bg-[#1877F2] text-white hover:bg-[#1864d2] text-sm font-medium transition-colors"
          >
            <Facebook className="w-4 h-4" />
            Facebook
          </button>
          <button
            onClick={shareToWhatsApp}
            className="flex items-center gap-1.5 px-3 py-2 rounded-full bg-[#25D366] text-white hover:bg-[#1da851] text-sm font-medium transition-colors"
          >
            <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"/></svg>
            WhatsApp
          </button>
        </div>
      </div>

      {/* Reply composer */}
      {user && (
        <div className="border-b border-border p-4 bg-muted/5">
          <div className="flex space-x-3">
            <div className="w-10 h-10 rounded-full bg-muted flex-shrink-0 overflow-hidden">
              {user.avatar ? (
                <img src={user.avatar} alt={user.username} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-sm font-bold">
                  {user.username[0]?.toUpperCase()}
                </div>
              )}
            </div>
            <div className="flex-1">
              <Textarea
                placeholder={`Reply to @${post.user_profiles?.username}...`}
                value={replyContent}
                onChange={(e) => setReplyContent(e.target.value)}
                className="min-h-[80px] border-0 resize-none focus-visible:ring-0 p-0 text-base bg-transparent"
                maxLength={280}
              />
              {/* Poll preview when attached */}
              {replyPollData && (
                <div className="mt-2 p-3 border border-border rounded-xl bg-muted/30 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <BarChart3 className="w-4 h-4 text-primary shrink-0" />
                    <span className="text-sm font-medium truncate">{replyPollData.question}</span>
                    <span className="text-xs text-muted-foreground shrink-0">{replyPollData.options.length} options</span>
                  </div>
                  <button onClick={() => setReplyPollData(null)} className="p-1 text-muted-foreground hover:text-foreground shrink-0"><X className="w-3.5 h-3.5" /></button>
                </div>
              )}
              <div className="flex items-center justify-between mt-3 pt-2 border-t border-border">
                <div className="flex items-center gap-1">
                  {replyContent.length > 0 && (
                    <span className={`text-sm ${replyContent.length > 260 ? 'text-destructive' : 'text-muted-foreground'}`}>
                      {replyContent.length}/280
                    </span>
                  )}
                  {/* Poll attach button */}
                  <button
                    onClick={() => setShowPollDialog(true)}
                    disabled={!!replyPollData}
                    className={`ml-2 p-2 rounded-full transition-colors disabled:opacity-40 ${
                      replyPollData ? 'bg-primary/10 text-primary' : 'hover:bg-muted text-muted-foreground hover:text-primary'
                    }`}
                    title="Attach poll to reply"
                  >
                    <BarChart3 className="w-4 h-4" />
                  </button>
                </div>
                <Button
                  onClick={handleReply}
                  disabled={submitting || !replyContent.trim() || replyContent.length > 280}
                  className="rounded-full px-6 font-semibold"
                >
                  {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : (
                    <>
                      <Send className="w-4 h-4 mr-1.5" />
                      Reply
                    </>
                  )}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Replies list */}
      <div>
        {replies.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <p className="font-medium">No replies yet</p>
            <p className="text-sm mt-1">Be the first to reply!</p>
          </div>
        ) : (
          <>
            <div className="px-4 py-2 border-b border-border flex items-center gap-2">
              <span className="text-sm font-semibold text-muted-foreground">
                {replies.length} {replies.length === 1 ? 'reply' : 'replies'}
              </span>
              {liveReplyCount !== null && liveReplyCount > replies.length && (
                <span className="px-2 py-0.5 rounded-full bg-primary/10 text-primary text-xs font-bold animate-pulse">
                  +{liveReplyCount - replies.length} new
                </span>
              )}
            </div>
            {replies.map((reply, idx) => (
              <div key={reply.id}>
                <div className="border-b border-border p-4 hover:bg-muted/5 transition-colors">
                  <div className="flex space-x-3">
                    <div
                      className="w-10 h-10 rounded-full bg-muted flex-shrink-0 overflow-hidden cursor-pointer"
                      onClick={() => navigate(`/profile/${reply.user_profiles.username}`)}
                    >
                      {reply.user_profiles.avatar_url ? (
                        <img src={reply.user_profiles.avatar_url} alt={reply.user_profiles.username} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-sm font-semibold">
                          {reply.user_profiles.username[0]?.toUpperCase()}
                        </div>
                      )}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span
                          className="font-bold cursor-pointer hover:underline"
                          onClick={() => navigate(`/profile/${reply.user_profiles.username}`)}
                        >
                          {reply.user_profiles.username}
                        </span>
                        {reply.user_profiles.verified && (
                          <BadgeCheck className="w-4 h-4 text-primary" fill="currentColor" />
                        )}
                        <span className="text-muted-foreground text-sm">
                          · {formatDistanceToNow(new Date(reply.created_at), { addSuffix: true })}
                        </span>
                      </div>
                      <p className="text-foreground mt-1 whitespace-pre-wrap break-words">{reply.content}</p>
                      {/* Embeds in reply content */}
                      <EmbedRenderer content={reply.content} />
                      <PostContentEmbeds content={reply.content} />
                      {/* Inline Poll — if this reply has an attached poll */}
                      {replyPollPostIds[reply.id] && (
                        <div className="mt-2">
                          <PollCard postId={replyPollPostIds[reply.id]} />
                        </div>
                      )}
                      {/* Reply Like button */}
                      <button
                        onClick={() => handleReplyLike(reply.id)}
                        className={`mt-2 flex items-center gap-1.5 text-xs font-semibold transition-colors ${
                          replyLikes[reply.id]?.liked ? 'text-pink-600' : 'text-muted-foreground hover:text-pink-600'
                        }`}
                      >
                        <Heart className={`w-3.5 h-3.5 ${replyLikes[reply.id]?.liked ? 'fill-current' : ''}`} />
                        {replyLikes[reply.id]?.count > 0 && <span>{replyLikes[reply.id].count}</span>}
                      </button>
                    </div>
                  </div>
                </div>
                {/* Wise Brain ad every 8 replies */}
                {idx > 0 && (idx + 1) % 8 === 0 && (
                  <div className="px-4 py-3 bg-muted/20 border-b border-border">
                    <p className="text-[9px] text-muted-foreground/40 uppercase tracking-widest text-center mb-1">🧠 Sponsored</p>
                    <DynamicAd location="feed_inline" className="rounded-xl overflow-hidden" />
                  </div>
                )}
              </div>
            ))}
          </>
        )}
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
