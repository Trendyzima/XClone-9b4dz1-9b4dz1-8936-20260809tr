import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Loader2, Quote, Send } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import * as federation from '@/api/federation';
import { federatedObjectToPost } from '@/features/federation/federatedPostAdapter';
import { quotePost } from '@/features/quotes/quotesService';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';

export default function PostQuoteComposerPage() {
  const { postId: encodedPostId } = useParams<{ postId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const postId = encodedPostId ? decodeURIComponent(encodedPostId) : '';
  const isFederated = /^https:\/\//i.test(postId);
  const [post, setPost] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!postId) { setError('Missing quote target'); setLoading(false); return; }
      setLoading(true); setError(null);
      try {
        if (isFederated) {
          const remote = await federation.getFederatedObject(postId);
          const object = remote?.object ?? remote;
          if (!object?.id) throw new Error('Remote post could not be loaded');
          const normalized = await federatedObjectToPost(object, federation.getFederatedObject);
          if (!cancelled) setPost(normalized);
        } else {
          const { data, error: fetchError } = await supabase.from('posts').select('*, profiles!posts_author_id_fkey(*)').eq('id', postId).single();
          if (fetchError) throw fetchError;
          if (!cancelled) setPost({ ...data, user_profiles: data.profiles ?? data.user_profiles ?? null });
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Unable to load post');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [postId, isFederated]);

  const submit = async () => {
    if (!user) { navigate('/auth'); return; }
    if (!postId || !text.trim() || sending) return;
    setSending(true); setError(null);
    try {
      if (isFederated) await federation.quoteStatus(postId, text.trim());
      else await quotePost(postId, text.trim());
      toast.success('Quote posted');
      navigate(isFederated ? '/post/' + encodeURIComponent(postId) : '/post/' + postId);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Could not create quote';
      setError(message);
      toast.error('Quote failed', { description: message });
    } finally { setSending(false); }
  };

  if (loading) return <div className='min-h-screen flex items-center justify-center'><Loader2 className='w-7 h-7 animate-spin text-primary' /></div>;
  if (!post) return <div className='min-h-screen bg-background p-6'><button onClick={() => navigate(-1)} className='p-2 rounded-full hover:bg-muted' aria-label='Back'><ArrowLeft className='w-5 h-5' /></button><div className='py-16 text-center'><p className='font-semibold'>Quote target not found</p><p className='mt-2 text-sm text-muted-foreground'>{error ?? 'This post is no longer available.'}</p><button onClick={() => navigate('/')} className='mt-5 rounded-full border px-4 py-2 text-sm font-semibold'>Go Home</button></div></div>;

  const profile = { ...(post.user_profiles ?? {}), ...(post.remote_account ?? {}) };
  const username = String(profile.preferredUsername ?? profile.username ?? profile.acct ?? '').replace(/^@/, '');
  const displayName = String(profile.display_name ?? profile.displayName ?? profile.name ?? username ?? 'Profile');
  const avatar = profile.avatar_url ?? profile.avatar?.url ?? profile.icon?.url ?? '';
  const handle = isFederated && profile.domain ? '@' + username + '@' + profile.domain : (username ? '@' + username : '');

  return <div className='min-h-screen bg-background pb-20'>
    <div className='sticky top-0 z-20 flex items-center gap-3 border-b border-border bg-background/95 px-4 py-3 backdrop-blur'><button onClick={() => navigate(-1)} className='rounded-full p-2 hover:bg-muted' aria-label='Back'><ArrowLeft className='w-5 h-5' /></button><div className='flex items-center gap-2'><Quote className='w-5 h-5 text-primary' /><h1 className='font-bold'>Quote post</h1></div></div>
    <div className='p-4 space-y-4'>
      <textarea value={text} onChange={e => setText(e.target.value)} placeholder='Add a comment…' maxLength={5000} autoFocus className='min-h-28 w-full resize-none rounded-2xl border border-border bg-muted/20 p-4 text-sm outline-none focus:ring-2 focus:ring-primary/30' />
      <div className='rounded-2xl border border-border p-4'><div className='flex gap-3'><div className='h-10 w-10 shrink-0 overflow-hidden rounded-full bg-muted'>{avatar ? <img src={avatar} alt={displayName} className='h-full w-full object-cover' /> : null}</div><div className='min-w-0'><div className='font-semibold text-sm truncate'>{displayName}</div>{handle && <div className='text-xs text-muted-foreground truncate'>{handle}</div>}</div></div><p className='mt-3 whitespace-pre-wrap break-words text-sm'>{String(post.content ?? post.name ?? '')}</p></div>
      {error && <div className='rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive'>{error}</div>}
      <button onClick={() => void submit()} disabled={!text.trim() || sending} className='flex w-full items-center justify-center gap-2 rounded-full bg-primary px-5 py-3 font-semibold text-primary-foreground disabled:opacity-40'>{sending ? <Loader2 className='h-4 w-4 animate-spin' /> : <Send className='h-4 w-4' />}{sending ? 'Posting…' : 'Quote post'}</button>
    </div>
  </div>;
}