import { useState, useEffect, useRef } from 'react';
import { useSEO } from '@/hooks/useSEO';
import { useAuth } from '@/hooks/useAuth';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { TopBar } from '@/components/layout/TopBar';
import { Button } from '@/components/ui/button';
import {
  Loader2, Inbox, CheckCircle2, ExternalLink, RefreshCw,
  Sparkles, Bell, Trash2
} from 'lucide-react';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';

// ── AdSense banner — push-guarded ─────────────────────────────────────────────
import { PageAdBanner } from '@/components/features/AdSenseAd';
function PlatformInboxAdBanner() { return <PageAdBanner />; }

const TYPE_CONFIG: Record<string, { icon: string; color: string; bg: string }> = {
  trending: { icon: '🔥', color: 'text-orange-600', bg: 'bg-orange-50 dark:bg-orange-900/20 border-orange-200 dark:border-orange-800' },
  payment:  { icon: '💰', color: 'text-green-600',  bg: 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800' },
  news:     { icon: '📰', color: 'text-blue-600',   bg: 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800' },
  update:   { icon: '📊', color: 'text-purple-600', bg: 'bg-purple-50 dark:bg-purple-900/20 border-purple-200 dark:border-purple-800' },
  tip:      { icon: '✨', color: 'text-yellow-600', bg: 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800' },
};

export default function PlatformInboxPage() {
  useSEO({ noindex: true, title: 'Platform Inbox', url: '/platform-inbox' });
  const { user } = useAuth();
  const navigate = useNavigate();
  const [messages, setMessages] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [filter, setFilter] = useState<'all' | 'unread' | 'trending' | 'payment' | 'update'>('all');
  const [creatorProfile, setCreatorProfile] = useState<any | null>(null);

  useEffect(() => {
    if (!user) return;
    fetchMessages();
    // Fetch creator profile to check 500+ followers eligibility
    supabase
      .from('profiles')
      .select('follower_count, creator_tier, is_creator, total_earnings, verified')
      .eq('id', user.id)
      .maybeSingle()
      .then(({ data }) => setCreatorProfile(data));
  }, [user]);

  const fetchMessages = async () => {
    if (!user) return;
    setLoading(true);
    const { data } = await supabase
      .from('platform_inbox')
      .select('*')
      .or(`user_id.eq.${user.id},user_id.is.null`)
      .order('sent_at', { ascending: false })
      .limit(50);
    setMessages(data ?? []);
    setLoading(false);
  };

  const generateDigest = async () => {
    if (!user) return;
    setGenerating(true);
    try {
      await supabase.rpc('generate_platform_inbox_digest', { p_user_id: user.id });
      await supabase.rpc('generate_ad_weekly_report', { p_user_id: user.id });
      await fetchMessages();
      toast.success('Wise Brain digest generated! 🦉');
    } catch (e) {
      toast.error('Failed to generate digest');
    } finally {
      setGenerating(false);
    }
  };

  const markRead = async (id: string) => {
    await supabase.from('platform_inbox').update({ read: true }).eq('id', id);
    setMessages(prev => prev.map(m => m.id === id ? { ...m, read: true } : m));
  };

  const markAllRead = async () => {
    if (!user) return;
    await supabase.from('platform_inbox').update({ read: true }).eq('user_id', user.id).eq('read', false);
    setMessages(prev => prev.map(m => ({ ...m, read: true })));
    toast.success('All marked as read');
  };

  const deleteMessage = async (id: string) => {
    await supabase.from('platform_inbox').delete().eq('id', id);
    setMessages(prev => prev.filter(m => m.id !== id));
  };

  const unreadCount = messages.filter(m => !m.read).length;

  const filteredMessages = messages.filter(m => {
    if (filter === 'all') return true;
    if (filter === 'unread') return !m.read;
    return m.type === filter;
  });

  if (!user) {
    return (
      <div className="min-h-screen bg-background">
        <TopBar title="Wise Brain Inbox" showBack />
        <PlatformInboxAdBanner />
        <div className="flex flex-col items-center justify-center py-24 px-4 text-center">
          <Inbox className="w-16 h-16 mb-4 text-muted-foreground/30" />
          <p className="font-semibold text-lg mb-2">Sign in to access your inbox</p>
          <Button onClick={() => navigate('/auth')}>Sign In</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-20">
      <TopBar title="Wise Brain Inbox 🦉" showBack />

      <div className="max-w-2xl mx-auto p-4 space-y-4">
        {/* Hero */}
        <div className="bg-gradient-to-br from-primary/10 via-purple-500/5 to-transparent border border-primary/20 rounded-2xl p-5">
          <div className="flex items-start gap-4">
            <div className="text-4xl">🦉</div>
            <div className="flex-1">
              <h2 className="font-bold text-lg">Wise Brain</h2>
              <p className="text-sm text-muted-foreground mt-0.5">
                Your personal AI assistant delivers personalized updates — trending content, earnings summaries, platform news, and growth tips — directly to your inbox.
              </p>
            </div>
          </div>
          <div className="flex gap-2 mt-4">
            <Button size="sm" onClick={generateDigest} disabled={generating} className="flex-1 rounded-xl">
              {generating ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Sparkles className="w-4 h-4 mr-2" />}
              {generating ? 'Generating…' : 'Generate Digest'}
            </Button>
            <Button size="sm" variant="outline" onClick={fetchMessages} className="rounded-xl px-3">
              <RefreshCw className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* ── Creator Hub (500+ followers) ──────────────────────────── */}
        {creatorProfile && (creatorProfile.follower_count ?? 0) >= 500 && (
          <div className="bg-gradient-to-br from-amber-500/10 via-yellow-400/5 to-transparent border border-amber-500/20 rounded-2xl p-5">
            <div className="flex items-center gap-3 mb-3">
              <span className="text-3xl">🌟</span>
              <div>
                <h3 className="font-bold text-base">Creator Hub</h3>
                <p className="text-xs text-muted-foreground">{creatorProfile.follower_count?.toLocaleString()} followers · {creatorProfile.creator_tier === 'gold' ? '🥇 Gold' : creatorProfile.creator_tier === 'silver' ? '🥈 Silver' : '🥉 Bronze'} Creator</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 mb-3">
              {[
                { emoji: '💰', label: 'Monetization', desc: 'Enable earnings', path: '/monetization' },
                { emoji: '📢', label: 'Run Ads', desc: 'Boost reach', path: '/my-ads' },
                { emoji: '📚', label: 'Series', desc: 'Build loyal readers', path: '/series' },
                { emoji: '✅', label: 'Verify', desc: 'Get blue badge', path: '/verify' },
              ].map(item => (
                <button key={item.label} onClick={() => navigate(item.path)}
                  className="flex items-center gap-2.5 p-3 rounded-xl bg-background border border-border hover:border-amber-500/30 hover:bg-amber-500/5 transition-all text-left">
                  <span className="text-xl shrink-0">{item.emoji}</span>
                  <div className="min-w-0">
                    <p className="font-bold text-xs truncate">{item.label}</p>
                    <p className="text-[10px] text-muted-foreground truncate">{item.desc}</p>
                  </div>
                </button>
              ))}
            </div>
            <button onClick={generateDigest} disabled={generating}
              className="w-full py-2.5 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/30 text-amber-700 dark:text-amber-400 rounded-xl text-sm font-bold transition-colors flex items-center justify-center gap-2">
              {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              {generating ? 'Generating creator tips…' : 'Generate personalized creator tips'}
            </button>
          </div>
        )}

        {/* Stats + mark all read */}
        {messages.length > 0 && (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold">{messages.length} message{messages.length !== 1 ? 's' : ''}</span>
              {unreadCount > 0 && (
                <span className="text-xs bg-primary text-primary-foreground font-bold px-2 py-0.5 rounded-full">{unreadCount} new</span>
              )}
            </div>
            {unreadCount > 0 && (
              <button onClick={markAllRead} className="text-xs text-primary font-semibold hover:underline flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" /> Mark all read
              </button>
            )}
          </div>
        )}

        {/* Filter chips */}
        <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-1">
          {([
            { id: 'all', label: 'All', icon: '📬' },
            { id: 'unread', label: 'Unread', icon: '🔵' },
            { id: 'trending', label: 'Trending', icon: '🔥' },
            { id: 'payment', label: 'Payments', icon: '💰' },
            { id: 'update', label: 'Updates', icon: '📊' },
          ] as const).map(f => (
            <button key={f.id} onClick={() => setFilter(f.id)}
              className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition-all ${
                filter === f.id ? 'bg-primary text-primary-foreground border-primary' : 'bg-muted/30 border-border text-muted-foreground hover:border-primary/30'
              }`}>
              <span>{f.icon}</span>{f.label}
            </button>
          ))}
        </div>

        {/* Messages */}
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        ) : filteredMessages.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            <Inbox className="w-16 h-16 mx-auto mb-4 opacity-20" />
            <p className="font-semibold text-lg">
              {filter === 'unread' ? 'All caught up!' : 'No messages yet'}
            </p>
            <p className="text-sm mt-1">
              {filter === 'all' ? 'Click "Generate Digest" to get your personalized Wise Brain update.' : 'Try another filter.'}
            </p>
            {filter === 'all' && (
              <Button onClick={generateDigest} disabled={generating} className="mt-4 rounded-xl">
                <Sparkles className="w-4 h-4 mr-2" /> Generate Digest Now
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {filteredMessages.map(msg => {
              const cfg = TYPE_CONFIG[msg.type] ?? TYPE_CONFIG['news'];
              return (
                <div
                  key={msg.id}
                  onClick={() => { if (!msg.read) markRead(msg.id); }}
                  className={`rounded-2xl border p-4 transition-all cursor-pointer ${
                    !msg.read
                      ? `${cfg.bg} shadow-sm`
                      : 'bg-card border-border hover:bg-muted/30'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className="text-2xl shrink-0">{msg.icon_emoji ?? cfg.icon}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <p className={`font-bold text-sm leading-snug ${!msg.read ? '' : 'text-muted-foreground'}`}>
                          {msg.subject}
                        </p>
                        <div className="flex items-center gap-1 shrink-0">
                          {!msg.read && (
                            <span className="w-2 h-2 rounded-full bg-primary shrink-0" />
                          )}
                          <button
                            onClick={e => { e.stopPropagation(); deleteMessage(msg.id); }}
                            className="p-1 rounded-full hover:bg-muted transition-colors text-muted-foreground opacity-0 group-hover:opacity-100"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1 leading-relaxed line-clamp-3">{msg.body}</p>
                      <div className="flex items-center gap-3 mt-2">
                        <span className="text-[10px] text-muted-foreground">
                          {formatDistanceToNow(new Date(msg.sent_at), { addSuffix: true })}
                        </span>
                        {msg.cta_label && msg.cta_url && (
                          <button
                            onClick={e => { e.stopPropagation(); navigate(msg.cta_url); markRead(msg.id); }}
                            className={`flex items-center gap-1 text-xs font-bold ${cfg.color} hover:underline`}
                          >
                            {msg.cta_label} <ExternalLink className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Info footer */}
        <div className="bg-muted/30 rounded-2xl p-4 text-xs text-muted-foreground">
          <div className="flex items-start gap-2">
            <Bell className="w-4 h-4 shrink-0 mt-0.5" />
            <p>
              <strong>Wise Brain</strong> generates personalized digests based on your activity — trending topics, earnings, ad performance, and growth milestones. Click "Generate Digest" to receive your latest briefing.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
