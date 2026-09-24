import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { TopBar } from '@/components/layout/TopBar';
import { PostCard } from '@/components/features/PostCard';
import { supabase } from '@/lib/supabase';
import { Post } from '@/types/app-types';
import { Loader2, Twitter, Facebook, Link2, MessageCircle, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { useSEO, buildOgImageUrl } from '@/hooks/useSEO';
import * as federation from '@/api/federation';
import { listReplies, createReply, type ReplyItem } from '@/features/replies/repliesService';
import { getInteractionCounts } from '@/services/postInteractionService';
import { useAuth } from '@/hooks/useAuth';

import { PageAdBanner } from '@/components/features/AdSenseAd';

function PostThreadAdBanner() { return <PageAdBanner />; }

export default function PostThreadPage() {
  const { postId } = useParams<{ postId: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user } = useAuth();

  const [post, setPost] = useState(null as Post | null);
  // useSEO — placed after ALL useState/useRef declarations below

  const [loading, setLoading] = useState(true);
  const [copySuccess, setCopySuccess] = useState(false);
  const [replies, setReplies] = useState<ReplyItem[]>([]);
  const [replyText, setReplyText] = useState('');
  const [replySending, setReplySending] = useState(false);
  const [replyLoading, setReplyLoading] = useState(false);
  const [counts, setCounts] = useState({ likes: 0, replies: 0, reposts: 0, quotes: 0, views: 0 });

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
            email: '',
            display_name: object.attributedTo?.name ?? actorPath.replace(/^@/, ''),
            avatar_url: object.attributedTo?.icon?.url ?? object.attributedTo?.icon ?? undefined,
            verified: false,
            follower_count: 0,
            following_count: 0,
            created_at: published,
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

  const loadReplies = useCallback(async () => {
    if (!postId || /^https:\/\//i.test(postId)) return;
    setReplyLoading(true);
    try {
      const [result, liveCounts] = await Promise.all([listReplies(postId, 20), getInteractionCounts(postId)]);
      setReplies(result.items ?? []);
      setCounts(liveCounts);
    } catch (error) {
      console.warn('[post-thread] replies unavailable', error);
    } finally {
      setReplyLoading(false);
    }
  }, [postId]);

  useEffect(() => { void loadReplies(); }, [loadReplies]);

  const submitReply = async () => {
    if (!postId || !user || !replyText.trim()) return;
    setReplySending(true);
    try {
      await createReply(postId, replyText.trim());
      setReplyText('');
      await loadReplies();
      toast({ title: 'Reply posted' });
    } catch (error) {
      toast({ title: 'Reply failed', description: error instanceof Error ? error.message : 'Could not post reply', variant: 'destructive' });
    } finally {
      setReplySending(false);
    }
  };

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

      <PostCard post={post} onUpdate={() => { void loadReplies(); }} />

      <section className="border-b border-border bg-background">
        <div className="px-4 py-3 flex items-center justify-between">
          <div>
            <h2 className="font-bold">Replies</h2>
            <p className="text-xs text-muted-foreground">{counts.replies} {counts.replies === 1 ? 'reply' : 'replies'}</p>
          </div>
          <button onClick={openReplies} className="text-xs font-semibold text-primary">Open all replies</button>
        </div>
        {user && !/^https:\/\//i.test(postId ?? '') && (
          <div className="px-4 pb-3 flex gap-2">
            <input value={replyText} onChange={e => setReplyText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void submitReply(); } }}
              placeholder="Write a reply…" aria-label="Write a reply"
              className="flex-1 rounded-2xl border border-border bg-muted/30 px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/20" />
            <button onClick={() => void submitReply()} disabled={!replyText.trim() || replySending}
              className="rounded-full bg-primary text-primary-foreground px-4 disabled:opacity-40">
              {replySending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </button>
          </div>
        )}
        {replyLoading ? (
          <div className="py-8 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>
        ) : replies.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">No replies yet. Be the first to reply.</div>
        ) : (
          <div>{replies.slice(0, 3).map(reply => (
            <button key={reply.id} onClick={() => navigate('/post/' + postId + '/reply/' + reply.id)}
              className="w-full text-left px-4 py-3 border-t border-border hover:bg-muted/20">
              <div className="flex gap-3">
                <div className="w-8 h-8 rounded-full bg-muted overflow-hidden shrink-0">
                  {reply.profile?.avatar_url && <img src={reply.profile.avatar_url} alt="" className="w-full h-full object-cover" />}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold">@{reply.profile?.username ?? 'user'}</p>
                  <p className="text-sm mt-1 whitespace-pre-wrap break-words">{reply.content}</p>
                </div>
              </div>
            </button>
          ))}</div>
        )}
        {replies.length > 3 && <button onClick={openReplies} className="w-full py-3 text-sm font-semibold text-primary border-t border-border">View all {counts.replies} replies</button>}
      </section>
    </div>
  );
}
