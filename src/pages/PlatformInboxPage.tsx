import { useCallback, useEffect, useState } from 'react';
import { useSEO } from '@/hooks/useSEO';
import { useAuth } from '@/hooks/useAuth';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { TopBar } from '@/components/layout/TopBar';
import { Button } from '@/components/ui/button';
import { Loader2, Inbox, CheckCircle2, ExternalLink, RefreshCw, Sparkles, Bell, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';
import { PageAdBanner } from '@/components/features/AdSenseAd';

interface InboxMessage {
  id: string; user_id: string; type: 'trending' | 'payment' | 'news' | 'update' | 'tip' | string;
  subject: string; body: string; icon_emoji: string | null; cta_label: string | null; cta_url: string | null;
  read: boolean; sent_at: string; created_at: string; dedupe_key: string; metadata: Record<string, unknown>; generation_version: number;
}
interface CreatorProfile { follower_count: number | null; }

const TYPE_CONFIG: Record<string, { icon: string; color: string; bg: string }> = {
  trending: { icon: '🔥', color: 'text-orange-600', bg: 'bg-orange-50 dark:bg-orange-900/20 border-orange-200 dark:border-orange-800' },
  payment: { icon: '💰', color: 'text-green-600', bg: 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800' },
  news: { icon: '📰', color: 'text-blue-600', bg: 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800' },
  update: { icon: '📊', color: 'text-purple-600', bg: 'bg-purple-50 dark:bg-purple-900/20 border-purple-200 dark:border-purple-800' },
  tip: { icon: '✨', color: 'text-yellow-600', bg: 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800' },
};

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error.trim()) return error;
  if (error && typeof error === 'object') {
    const value = error as Record<string, unknown>;
    for (const key of ['message', 'error', 'details', 'hint']) if (typeof value[key] === 'string' && value[key].trim()) return value[key] as string;
  }
  return fallback;
}

export default function PlatformInboxPage() {
  useSEO({ noindex: true, title: 'Wise Brain Inbox', url: '/platform-inbox' });
  const { user } = useAuth();
  const navigate = useNavigate();
  const [messages, setMessages] = useState<InboxMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [actionId, setActionId] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'unread' | 'trending' | 'payment' | 'update'>('all');
  const [creatorProfile, setCreatorProfile] = useState<CreatorProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const PAGE_SIZE = 30;

  const fetchMessages = useCallback(async (offset = 0) => {
    if (!user) return;
    const append = offset > 0;
    if (append) setLoadingMore(true); else setLoading(true);
    setError(null);
    const from = offset;
    const to = from + PAGE_SIZE - 1;
    const { data, error: fetchError } = await supabase.from('platform_inbox')
      .select('id,user_id,type,subject,body,icon_emoji,cta_label,cta_url,read,sent_at,created_at,dedupe_key,metadata,generation_version')
      .eq('user_id', user.id).order('sent_at', { ascending: false }).range(from, to);
    if (fetchError) {
      const message = getErrorMessage(fetchError, 'Unable to load your Wise Brain inbox.');
      setError(message); if (!append) setMessages([]); toast.error(message);
    } else {
      const next = (data ?? []) as InboxMessage[];
      setMessages(prev => append ? [...prev, ...next] : next);
      setHasMore(next.length === PAGE_SIZE);
    }
    if (append) setLoadingMore(false); else setLoading(false);
  }, [user]);

  useEffect(() => {
    if (!user) return;
    void fetchMessages();
    void supabase.from('profiles').select('follower_count').eq('id', user.id).maybeSingle().then(({ data }) => setCreatorProfile(data));
  }, [user, fetchMessages]);

  const generateDigest = async () => {
    if (!user || generating) return;
    setGenerating(true); setError(null);
    try {
      const { error: digestError } = await supabase.rpc('generate_platform_inbox_digest');
      if (digestError) throw digestError;
      await fetchMessages();
      toast.success('Wise Brain digest generated! 🦉');
    } catch (digestError) {
      const message = getErrorMessage(digestError, 'Failed to generate your Wise Brain digest.');
      setError(message); toast.error(message);
    } finally { setGenerating(false); }
  };

  const markRead = async (id: string) => {
    setActionId(id);
    const { error: updateError } = await supabase.from('platform_inbox').update({ read: true }).eq('id', id).eq('user_id', user?.id ?? '');
    setActionId(null);
    if (updateError) { toast.error(getErrorMessage(updateError, 'Unable to mark this message as read.')); return; }
    setMessages(prev => prev.map(message => message.id === id ? { ...message, read: true } : message));
  };

  const markAllRead = async () => {
    if (!user) return;
    setActionId('all');
    const { error: updateError } = await supabase.from('platform_inbox').update({ read: true }).eq('user_id', user.id).eq('read', false);
    setActionId(null);
    if (updateError) { toast.error(getErrorMessage(updateError, 'Unable to mark messages as read.')); return; }
    setMessages(prev => prev.map(message => ({ ...message, read: true })));
    toast.success('All messages marked as read');
  };

  const deleteMessage = async (id: string) => {
    setActionId(id);
    const { error: deleteError } = await supabase.from('platform_inbox').delete().eq('id', id).eq('user_id', user?.id ?? '');
    setActionId(null);
    if (deleteError) { toast.error(getErrorMessage(deleteError, 'Unable to delete this message.')); return; }
    setMessages(prev => prev.filter(message => message.id !== id));
  };

  const unreadCount = messages.filter(message => !message.read).length;
  const profilePath = user.username ? `/profile/${user.username}` : '/profile-features';
  const filteredMessages = messages.filter(message => filter === 'all' ? true : filter === 'unread' ? !message.read : message.type === filter);

  if (!user) return (
    <div className="min-h-screen bg-background"><TopBar title="Wise Brain Inbox" showBack /><PageAdBanner />
      <div className="flex flex-col items-center justify-center py-24 px-4 text-center"><Inbox className="w-16 h-16 mb-4 text-muted-foreground/30" /><p className="font-semibold text-lg mb-2">Sign in to access your inbox</p><Button onClick={() => navigate('/auth')}>Sign In</Button></div>
    </div>
  );

  return (
    <div className="min-h-screen bg-background pb-20">
      <TopBar title="Wise Brain Inbox 🦉" showBack />
      <PageAdBanner />
      <div className="max-w-2xl mx-auto p-4 space-y-4">
        <div className="bg-gradient-to-br from-primary/10 via-purple-500/5 to-transparent border border-primary/20 rounded-2xl p-5">
          <div className="flex items-start gap-4"><div className="text-4xl" aria-hidden="true">🦉</div><div className="flex-1"><h2 className="font-bold text-lg">Wise Brain</h2><p className="text-sm text-muted-foreground mt-0.5">Your personal assistant turns your real Testagram activity into useful updates — growth, content performance, wallet context, and important platform activity.</p></div></div>
          <div className="flex gap-2 mt-4"><Button size="sm" onClick={generateDigest} disabled={generating} className="flex-1 rounded-xl">{generating ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Sparkles className="w-4 h-4 mr-2" />}{generating ? 'Generating…' : 'Generate Digest'}</Button><Button size="sm" variant="outline" onClick={() => void fetchMessages(0)} disabled={loading} className="rounded-xl px-3" aria-label="Refresh Wise Brain inbox"><RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /></Button></div>
        </div>

        {creatorProfile && (creatorProfile.follower_count ?? 0) >= 500 && (
          <div className="bg-gradient-to-br from-amber-500/10 via-yellow-400/5 to-transparent border border-amber-500/20 rounded-2xl p-5">
            <div className="flex items-center gap-3 mb-3"><span className="text-3xl" aria-hidden="true">🌟</span><div><h3 className="font-bold text-base">Creator Hub</h3><p className="text-xs text-muted-foreground">{creatorProfile.follower_count?.toLocaleString()} followers · creator growth tools</p></div></div>
            <div className="grid grid-cols-2 gap-2 mb-3">{[
              { emoji: '💰', label: 'Monetization', desc: 'Manage earnings', path: '/monetization' },
              { emoji: '📢', label: 'Run Ads', desc: 'Boost reach', path: '/my-ads' },
              { emoji: '📚', label: 'Series', desc: 'Build loyal readers', path: '/series' },
              { emoji: '✅', label: 'Verify', desc: 'Verification', path: '/verify' },
            ].map(item => <button key={item.label} type="button" onClick={() => navigate(item.path)} className="flex items-center gap-2.5 p-3 rounded-xl bg-background border border-border hover:border-amber-500/30 hover:bg-amber-500/5 transition-all text-left"><span className="text-xl shrink-0" aria-hidden="true">{item.emoji}</span><div className="min-w-0"><p className="font-bold text-xs truncate">{item.label}</p><p className="text-[10px] text-muted-foreground truncate">{item.desc}</p></div></button>)}</div>
            <button type="button" onClick={generateDigest} disabled={generating} className="w-full py-2.5 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/30 text-amber-700 dark:text-amber-400 rounded-xl text-sm font-bold transition-colors flex items-center justify-center gap-2">{generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}{generating ? 'Generating creator briefing…' : 'Generate personalized creator briefing'}</button>
          </div>
        )}

        {error && <div role="alert" className="rounded-2xl border border-destructive/20 bg-destructive/5 p-4 text-sm"><p className="font-semibold text-destructive">Wise Brain could not complete that request.</p><p className="text-muted-foreground mt-1 break-words">{error}</p><Button size="sm" variant="outline" onClick={() => void fetchMessages(0)} className="mt-3">Try again</Button></div>}

        {messages.length > 0 && <div className="flex items-center justify-between"><div className="flex items-center gap-2"><span className="text-sm font-semibold">{messages.length} message{messages.length !== 1 ? 's' : ''}</span>{unreadCount > 0 && <span className="text-xs bg-primary text-primary-foreground font-bold px-2 py-0.5 rounded-full">{unreadCount} new</span>}</div>{unreadCount > 0 && <button type="button" onClick={markAllRead} disabled={actionId === 'all'} className="text-xs text-primary font-semibold hover:underline flex items-center gap-1 disabled:opacity-50">{actionId === 'all' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />} Mark all read</button>}</div>}

        <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-1">{([
          { id: 'all', label: 'All', icon: '📬' }, { id: 'unread', label: 'Unread', icon: '🔵' }, { id: 'trending', label: 'Trending', icon: '🔥' }, { id: 'payment', label: 'Payments', icon: '💰' }, { id: 'update', label: 'Updates', icon: '📊' },
        ] as const).map(f => <button key={f.id} type="button" onClick={() => setFilter(f.id)} className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition-all ${filter === f.id ? 'bg-primary text-primary-foreground border-primary' : 'bg-muted/30 border-border text-muted-foreground hover:border-primary/30'}`}><span aria-hidden="true">{f.icon}</span>{f.label}</button>)}</div>

        {loading ? <div className="flex items-center justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div> : filteredMessages.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground"><Inbox className="w-16 h-16 mx-auto mb-4 opacity-20" /><p className="font-semibold text-lg">{filter === 'unread' ? 'All caught up!' : 'Your Wise Brain inbox is ready'}</p><p className="text-sm mt-1">{filter === 'all' ? 'Generate a briefing from your real Testagram activity. It is safe to regenerate and will not create duplicate daily cards.' : 'There are no messages in this filter yet.'}</p>{filter === 'all' && <Button onClick={generateDigest} disabled={generating} className="mt-4 rounded-xl"><Sparkles className="w-4 h-4 mr-2" />Generate Digest Now</Button>}</div>
        ) : (
          <>
          <div className="space-y-3">{filteredMessages.map(message => { const cfg = TYPE_CONFIG[message.type] ?? TYPE_CONFIG.news; const busy = actionId === message.id; return (
            <article key={message.id} onClick={() => { if (!message.read && !busy) void markRead(message.id); }} className={`rounded-2xl border p-4 transition-all cursor-pointer ${!message.read ? `${cfg.bg} shadow-sm` : 'bg-card border-border hover:bg-muted/30'}`}>
              <div className="flex items-start gap-3"><div className="text-2xl shrink-0" aria-hidden="true">{message.icon_emoji ?? cfg.icon}</div><div className="flex-1 min-w-0"><div className="flex items-start justify-between gap-2"><p className={`font-bold text-sm leading-snug ${!message.read ? '' : 'text-muted-foreground'}`}>{message.subject}</p><div className="flex items-center gap-1 shrink-0">{!message.read && <span className="w-2 h-2 rounded-full bg-primary shrink-0" aria-label="Unread" />}<button type="button" aria-label="Delete message" onClick={event => { event.stopPropagation(); void deleteMessage(message.id); }} disabled={busy} className="p-1 rounded-full hover:bg-muted transition-colors text-muted-foreground disabled:opacity-50">{busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}</button></div></div><p className="text-xs text-muted-foreground mt-1 leading-relaxed line-clamp-3">{message.body}</p><div className="flex items-center gap-3 mt-2"><span className="text-[10px] text-muted-foreground">{formatDistanceToNow(new Date(message.sent_at), { addSuffix: true })}</span>{message.cta_label && message.cta_url && <button type="button" onClick={event => { event.stopPropagation(); void markRead(message.id); navigate(message.cta_url!); }} className={`flex items-center gap-1 text-xs font-bold ${cfg.color} hover:underline`}>{message.cta_label} <ExternalLink className="w-3 h-3" /></button>}</div></div></div>
            </article>
          ); })}</div>
          {filter === 'all' && hasMore && (
            <div className="flex justify-center pt-2"><Button variant="outline" onClick={() => void fetchMessages(messages.length)} disabled={loadingMore} className="rounded-xl">{loadingMore ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <RefreshCw className="w-4 h-4 mr-2" />}Load more</Button></div>
          )}
          </>
        )}

        <div className="bg-muted/30 rounded-2xl p-4 text-xs text-muted-foreground"><div className="flex items-start gap-2"><Bell className="w-4 h-4 shrink-0 mt-0.5" /><p><strong>Wise Brain</strong> uses your actual Testagram activity to produce a concise briefing. Regeneration is idempotent for the current UTC day, so repeated clicks update the same daily briefing instead of creating duplicates.</p></div></div>
      </div>
    </div>
  );
}
