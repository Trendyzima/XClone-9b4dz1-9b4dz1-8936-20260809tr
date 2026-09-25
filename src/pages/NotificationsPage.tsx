import { useState, useEffect } from 'react';
import { useSEO } from '@/hooks/useSEO';
import { TopBar } from '@/components/layout/TopBar';
import { PageAdBanner } from '@/components/features/AdSenseAd';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useNavigate } from 'react-router-dom';
import {
  Heart, Repeat2, UserPlus, MessageCircle, AtSign,
  BadgeCheck, Loader2, DollarSign, CheckCircle2, Smartphone,
  TrendingUp, Bell, CreditCard, ArrowDownLeft, Globe, UserCheck,
  Star, ExternalLink, RefreshCw, Flame, Trophy, Zap, XCircle, Megaphone,
  Settings2, Send as SendIcon, X,
} from 'lucide-react';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';
import { useInfiniteScroll } from '@/hooks/useInfiniteScroll';
import { useFediversePolling } from '@/hooks/useFediversePolling';
import { backendCapabilities, type NotificationItem } from '@/services/testagramCapabilityClient';

function NotificationsAdBanner() { return <PageAdBanner />; }

const PAGE_SIZE = 20;

type NotifTab = 'all' | 'mentions' | 'payments' | 'fediverse';

function normalizeNotification(notification: NotificationItem): any {
  return {
    ...notification,
    type: notification.kind,
    metadata: notification.data ?? {},
    read: Boolean(notification.read_at),
    from_user: notification.actor,
    from_user_id: notification.actor_id,
  };
}

function MentionReplyInput({ postId, onPosted }: { postId: string; onPosted: () => void }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [text, setText] = useState('');
  const [posting, setPosting] = useState(false);
  const [show, setShow] = useState(false);

  const submit = async () => {
    if (!user) { navigate('/auth'); return; }
    if (!text.trim()) return;
    setPosting(true);
    const { error } = await supabase.from('replies').insert({ post_id: postId, user_id: user.id, content: text.trim() });
    if (!error) {
      setText('');
      setShow(false);
      toast.success('Reply sent!');
      onPosted();
    } else {
      toast.error('Failed to send reply');
    }
    setPosting(false);
  };

  if (!show) {
    return (
      <button onClick={() => setShow(true)}
        className="mt-2 flex items-center gap-1.5 text-xs text-primary font-semibold hover:underline transition-colors">
        <MessageCircle className="w-3.5 h-3.5" />Reply
      </button>
    );
  }

  return (
    <div className="mt-2 flex items-center gap-2" onClick={e => e.stopPropagation()}>
      <input type="text" value={text} onChange={e => setText(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } if (e.key === 'Escape') setShow(false); }}
        placeholder="Write a reply…" maxLength={280} autoFocus
        className="flex-1 text-sm bg-muted/60 border border-border rounded-xl px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-primary/30" />
      <button onClick={submit} disabled={!text.trim() || posting}
        className="text-primary disabled:opacity-30 transition-opacity">
        {posting ? <Loader2 className="w-4 h-4 animate-spin" /> : <SendIcon className="w-4 h-4" />}
      </button>
      <button onClick={() => { setShow(false); setText(''); }} className="text-muted-foreground hover:text-foreground">
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

export default function NotificationsPage() {
  useSEO({ noindex: true, title: 'Notifications', url: '/notifications' });
  const { user } = useAuth();
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<NotifTab>('all');
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [unreadCount, setUnreadCount] = useState(0);

  function groupNotifications(notifs: any[]): any[] {
    const result: any[] = [];
    const used = new Set<number>();
    for (let i = 0; i < notifs.length; i++) {
      if (used.has(i)) continue;
      const n = notifs[i];
      if (n.type === 'like' || n.type === 'repost') {
        const group: any[] = [n];
        used.add(i);
        for (let j = i + 1; j < Math.min(notifs.length, i + 20); j++) {
          if (!used.has(j) && notifs[j].type === n.type && notifs[j].post_id === n.post_id) {
            group.push(notifs[j]);
            used.add(j);
          }
        }
        if (group.length > 1) {
          result.push({ _grouped: true, type: n.type, post_id: n.post_id, post: n.post, items: group, created_at: n.created_at, read: group.every((g: any) => g.read) });
        } else {
          result.push(n);
        }
        continue;
      }
      if (n.type === 'follow') {
        const group: any[] = [n];
        used.add(i);
        for (let j = i + 1; j < Math.min(notifs.length, i + 10); j++) {
          if (!used.has(j) && notifs[j].type === 'follow') {
            group.push(notifs[j]);
            used.add(j);
          }
        }
        if (group.length > 1) {
          result.push({ _grouped: true, type: 'follow', post_id: null, post: null, items: group, created_at: n.created_at, read: group.every((g: any) => g.read) });
        } else {
          result.push(n);
        }
        continue;
      }
      used.add(i);
      result.push(n);
    }
    return result;
  }

  const { notifs: fedNotifs, loading: fedLoading, lastPolled, refresh: refreshFed } =
    useFediversePolling(activeTab === 'fediverse' ? user?.id : null);

  const isPaymentType = (type: string) =>
    ['payment_success', 'payment_sent', 'payment_failed', 'payout_sent', 'deposit_confirmed', 'boost_activated', 'ad_active', 'ad_rejected', 'new_ad'].includes(type);

  const fetchNotifications = async (cursorValue?: string | null, replace = true): Promise<boolean> => {
    if (!user) return false;
    setLoading(true);
    try {
      const options = {};
      const result = await backendCapabilities.listNotifications(PAGE_SIZE, cursorValue ?? undefined, options);
      const normalized = result.items.map(normalizeNotification);
      const visible = activeTab === 'mentions' ? normalized.filter((n) => n.type === 'mention') : activeTab === 'payments' ? normalized.filter((n) => isPaymentType(n.type)) : normalized;
      setNotifications((prev) => replace ? visible : [...prev, ...visible.filter((n) => !prev.some((existing) => existing.id === n.id))]);
      setNextCursor(result.next_cursor);
      setHasMore(Boolean(result.next_cursor));
      return Boolean(result.next_cursor);
    } catch (err) {
      console.debug('[notifications] passive fetch unavailable', err);
      if (replace) {
        setNotifications([]);
        setNextCursor(null);
        setHasMore(false);
      }
      return false;
    } finally {
      setLoading(false);
    }
  };

  const refreshUnreadCount = async () => {
    if (!user) return;
    try {
      const result = await backendCapabilities.getUnreadNotificationCount();
      setUnreadCount(result.count);
    } catch (err) {
      console.debug('[notifications] passive unread count unavailable', err);
      setUnreadCount(0);
    }
  };

  const markNotificationRead = async (notificationId: string) => {
    try {
      await backendCapabilities.markNotificationRead(notificationId);
      setNotifications((prev) => prev.map((n) => n.id === notificationId ? { ...n, read: true, read_at: n.read_at ?? new Date().toISOString() } : n));
      setUnreadCount((count) => Math.max(0, count - 1));
    } catch (err) {
      console.debug('[notifications] mark read unavailable', err);
    }
  };

  const markAllAsRead = async () => {
    if (!user) return;
    try {
      await backendCapabilities.markAllNotificationsRead();
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true, read_at: n.read_at ?? new Date().toISOString() })));
      setUnreadCount(0);
    } catch (err) {
      console.debug('[notifications] mark all read unavailable', err);
      toast.error('Failed to mark notifications as read');
    }
  };

  useEffect(() => {
    if (!user) {
      navigate('/auth');
      return;
    }
    if (activeTab === 'fediverse') return;
    setNotifications([]);
    setNextCursor(null);
    setHasMore(true);
    void fetchNotifications(null, true);
    void refreshUnreadCount();
  }, [user, activeTab, navigate]);

  useEffect(() => {
    if (!user) return;
    if (activeTab === 'fediverse') return;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;
    void backendCapabilities.getNotificationSubscription().then((contract) => {
      if (cancelled || !contract.authenticated || contract.table !== 'notifications' || contract.filter !== `recipient_id=eq.${user.id}`) return;
      channel = supabase
        .channel(`notifications:${user.id}`)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: contract.filter }, (payload) => {
          const incoming = normalizeNotification(payload.new as NotificationItem);
          setNotifications((prev) => prev.some((n) => n.id === incoming.id) ? prev : [incoming, ...prev]);
          if (!incoming.read) setUnreadCount((count) => count + 1);
        })
        .subscribe((status) => {
          if (status === 'CHANNEL_ERROR') console.debug('[notifications] realtime channel unavailable; Supabase client will retry');
        });
    }).catch((err) => console.debug('[notifications] realtime contract unavailable', err));
    return () => {
      cancelled = true;
      if (channel) void supabase.removeChannel(channel);
    };
  }, [user, activeTab]);

  const loadMore = async (): Promise<boolean> => {
    if (activeTab === 'fediverse' || loading || !hasMore) return false;
    const cursorValue = nextCursor;
    if (!cursorValue) return false;
    return fetchNotifications(cursorValue, false);
  };

  const { lastElementRef, loading: loadingMore } = useInfiniteScroll(loadMore);

  const getIcon = (type: string) => {
    switch (type) {
      case 'like':              return <Heart className="w-8 h-8 text-pink-600" fill="currentColor" />;
      case 'repost':            return <Repeat2 className="w-8 h-8 text-green-500" />;
      case 'follow':            return <UserPlus className="w-8 h-8 text-primary" />;
      case 'reply':             return <MessageCircle className="w-8 h-8 text-primary" />;
      case 'mention':           return <AtSign className="w-8 h-8 text-primary" />;
      case 'payment_success':
      case 'deposit_confirmed': return <CheckCircle2 className="w-8 h-8 text-green-600" />;
      case 'payment_sent':
      case 'payout_sent':       return <ArrowDownLeft className="w-8 h-8 text-blue-600" />;
      case 'payment_failed':    return <CreditCard className="w-8 h-8 text-destructive" />;
      case 'boost_activated':   return <TrendingUp className="w-8 h-8 text-purple-600" />;
      case 'streak_milestone':   return <Flame className="w-8 h-8 text-orange-500" />;
      case 'ad_active':          return <CheckCircle2 className="w-8 h-8 text-green-600" />;
      case 'ad_rejected':        return <XCircle className="w-8 h-8 text-destructive" />;
      case 'new_ad':             return <Megaphone className="w-8 h-8 text-amber-500" />;
      default:                   return <Bell className="w-8 h-8 text-muted-foreground" />;
    }
  };

  const getText = (n: any) => {
    const username = n.from_user?.username ?? 'Someone';
    const meta = n.metadata ?? {};
    switch (n.type) {
      case 'like':              return `${username} liked your post`;
      case 'repost':            return `${username} reposted your post`;
      case 'follow':            return `${username} followed you`;
      case 'reply':             return `${username} replied to your post`;
      case 'mention':           return `${username} mentioned you`;
      case 'payment_success':
        return meta.message ?? `M-Pesa payment of KES ${meta.amount ?? ''} confirmed`;
      case 'deposit_confirmed':
        return `Deposit of KES ${meta.kes_amount ?? meta.amount ?? ''} confirmed · Receipt: ${meta.receipt ?? ''}`;
      case 'payment_sent':
        if (meta.purpose === 'creator_payout') return `Creator payout of $${meta.amount} (KES ${meta.kes_amount}) sent to ${meta.phone}`;
        if (meta.purpose === 'paypal_withdrawal') return `PayPal withdrawal of $${meta.amount} submitted to ${meta.email}`;
        return `Payment of $${meta.amount} sent`;
      case 'payout_sent': return `Payout of $${meta.amount} sent via ${meta.method ?? 'M-Pesa'}`;
      case 'payment_failed': return `Payment failed — ${meta.reason ?? 'please try again'}`;
      case 'boost_activated': return `Your post boost is now active · Est. reach: ${(meta.estimated_reach ?? 0).toLocaleString()}`;
      case 'ad_active': return 'Your ad has been approved and is now live!';
      case 'ad_rejected': return 'Your ad was rejected. Check admin notes for details.';
      case 'new_ad': return `${username} submitted a new ad for review.`;
      case 'streak_milestone': {
        const day = meta?.streak_day ?? n.from_user_id ? undefined : undefined;
        if (n.from_user_id === user?.id) return day === 7 ? '🏆 You hit a 7-day max streak! Keep it going!' : `🔥 You hit a ${day ?? ''}‑day streak milestone! Congrats!`;
        return '🔥 Streak milestone reached!';
      }
      default: return 'New notification';
    }
  };

  const getStreakMilestoneDay = (n: any): number => n.metadata?.streak_day ?? 0;

  const getNotifBg = (type: string) => {
    if (['payment_success', 'deposit_confirmed'].includes(type)) return 'bg-green-50/50 dark:bg-green-900/10';
    if (['payment_sent', 'payout_sent'].includes(type)) return 'bg-blue-50/50 dark:bg-blue-900/10';
    if (type === 'payment_failed') return 'bg-red-50/50 dark:bg-red-900/10';
    if (type === 'boost_activated') return 'bg-purple-50/50 dark:bg-purple-900/10';
    if (type === 'streak_milestone') return 'bg-orange-50/60 dark:bg-orange-900/10';
    if (type === 'ad_active') return 'bg-green-50/50 dark:bg-green-900/10';
    if (type === 'ad_rejected') return 'bg-red-50/50 dark:bg-red-900/10';
    if (type === 'new_ad') return 'bg-amber-50/50 dark:bg-amber-900/10';
    return '';
  };

  const getFedIcon = (type: string) => {
    switch (type?.toLowerCase()) {
      case 'follow': return <UserCheck className="w-6 h-6 text-purple-500" />;
      case 'like':
      case 'favourite': return <Star className="w-6 h-6 text-yellow-500" />;
      case 'boost':
      case 'announce': return <Repeat2 className="w-6 h-6 text-green-500" />;
      case 'mention': return <AtSign className="w-6 h-6 text-primary" />;
      case 'create': return <MessageCircle className="w-6 h-6 text-primary" />;
      default: return <Globe className="w-6 h-6 text-purple-400" />;
    }
  };

  const getFedText = (n: any) => {
    const actor = n.actor_url ?? n.account?.url ?? '';
    const actorName = String(n.account?.display_name ?? n.account?.name ?? n.account?.preferredUsername ?? n.account?.username ?? '').trim();
    const actorUsername = String(n.account?.preferredUsername ?? n.account?.username ?? n.account?.acct ?? '').replace(/^@/, '').trim();
    const actorDomain = String(n.account?.domain ?? '').trim();
    const actorLabel = actorName || actorUsername || (actor ? actor.replace(/https?:\\/\\//, '').split('/').filter(Boolean).pop() : '') || 'Profile';
    const actorHandle = actorUsername ? `@${actorUsername}${actorDomain ? `@${actorDomain}` : ''}` : '';
    const identity = actorHandle ? `${actorLabel} ${actorHandle}` : actorLabel;
    const type = (n.activity_type ?? n.type ?? '').toLowerCase();
    switch (type) {
      case 'follow': return `${identity} followed you from the Fediverse`;
      case 'like':
      case 'favourite': return `${identity} favourited your post`;
      case 'boost':
      case 'announce': return `${identity} boosted your post`;
      case 'mention': return `${identity} mentioned you`;
      case 'create': return `${identity} replied to your post`;
      default: return `${identity} interacted with you`;
    }
  };

  if (!user) return null;

  const tabs: { key: NotifTab; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'mentions', label: '@Mentions' },
    { key: 'payments', label: 'Payments' },
    { key: 'fediverse', label: 'Fediverse' },
  ];

  const unreadMentions = notifications.filter(n => n.type === 'mention' && !n.read).length;
  const nativeUnread = unreadCount;

  return (
    <div className="min-h-screen bg-background pb-16 md:pb-0">
      <TopBar title="Notifications" />
      <NotificationsAdBanner />
      <div className="sticky top-14 z-30 bg-background border-b border-border">
        <div className="flex items-center">
          <div className="flex flex-1 overflow-x-auto scrollbar-hide">
            {tabs.map(({ key, label }) => (
              <button key={key} onClick={() => setActiveTab(key)} className={`flex-1 min-w-[80px] py-4 font-semibold transition-colors border-b-2 text-sm whitespace-nowrap relative ${activeTab === key ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:bg-muted/50'}`}>
                {label}
                {key === 'mentions' && unreadMentions > 0 && <span className="absolute top-2.5 right-1.5 min-w-[16px] h-4 bg-primary text-primary-foreground text-[9px] font-black rounded-full flex items-center justify-center px-0.5">{unreadMentions > 9 ? '9+' : unreadMentions}</span>}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1 shrink-0 pr-2">
            {activeTab !== 'fediverse' && nativeUnread > 0 && <button onClick={markAllAsRead} className="px-2 py-1.5 text-xs font-semibold text-primary hover:bg-primary/10 rounded-full transition-colors whitespace-nowrap flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" />Mark all</button>}
            <button onClick={() => navigate('/notification-preferences')} title="Notification Preferences" className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted rounded-full transition-colors"><Settings2 className="w-4 h-4" /></button>
          </div>
        </div>
      </div>
      {(activeTab === 'fediverse' ? fedLoading && fedNotifs.length === 0 : loading) ? (
        <div className="flex items-center justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
      ) : activeTab === 'fediverse' ? (
        <div>
          <div className="flex items-center justify-between px-4 py-2 bg-purple-500/5 border-b border-purple-500/10 text-xs text-purple-500"><span className="flex items-center gap-1.5"><Globe className="w-3 h-3" />Live · polls every 30s{lastPolled && <span className="text-muted-foreground">· last {formatDistanceToNow(lastPolled, { addSuffix: true })}</span>}</span><button onClick={refreshFed} className="flex items-center gap-1 hover:text-purple-700 transition-colors"><RefreshCw className={`w-3 h-3 ${fedLoading ? 'animate-spin' : ''}`} />Refresh</button></div>
          {fedNotifs.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground px-6"><Globe className="w-12 h-12 mx-auto mb-3 opacity-40" /><p className="font-semibold">No Fediverse notifications yet</p><p className="text-sm mt-1">Follows, likes, and boosts from Mastodon/Misskey appear here</p><button onClick={() => navigate('/fediverse')} className="mt-4 px-4 py-2 bg-primary text-primary-foreground rounded-full text-sm font-medium">Go to Fediverse</button></div>
          ) : (
            fedNotifs.map((n: any, idx: number) => (
              <div key={n.id ?? idx} className="border-b border-border p-4 hover:bg-purple-500/5 transition-colors"><div className="flex gap-3 items-start"><div className="w-10 h-10 rounded-full bg-purple-500/10 flex items-center justify-center flex-shrink-0">{getFedIcon(n.activity_type ?? n.type)}</div><div className="flex-1 min-w-0"><p className="text-sm font-medium">{getFedText(n)}</p><div className="flex items-center gap-2 mt-0.5 flex-wrap"><span className="flex items-center gap-1 text-xs text-purple-500"><Globe className="w-3 h-3" />Fediverse</span>{n.created_at && <span className="text-xs text-muted-foreground">· {formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}</span>}</div>{(n.actor_url ?? n.account?.url) && <a href={n.actor_url ?? n.account?.url} target="_blank" rel="noopener noreferrer" className="mt-1 flex items-center gap-1 text-xs text-primary hover:underline"><ExternalLink className="w-3 h-3" />View actor</a>}</div>{!n.processed && <div className="w-2.5 h-2.5 bg-purple-500 rounded-full flex-shrink-0 mt-1" />}</div></div>
            ))
          )}
        </div>
      ) : (
        notifications.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            {activeTab === 'payments' ? <><DollarSign className="w-12 h-12 mx-auto mb-3 opacity-40" /><p className="font-semibold">No payment notifications yet</p><p className="text-sm mt-1">Deposits, payouts, and boosts will appear here</p></> : activeTab === 'mentions' ? <><AtSign className="w-12 h-12 mx-auto mb-3 opacity-40" /><p className="font-semibold">No mentions yet</p><p className="text-sm mt-1">When someone @mentions you in a post, it'll appear here</p></> : <><Bell className="w-12 h-12 mx-auto mb-3 opacity-40" /><p className="font-semibold">No notifications yet</p><p className="text-sm mt-1">When you get notifications, they'll show up here</p></>}
          </div>
        ) : (
          <div>
            {groupNotifications(notifications).map((n: any, idx: number) =>
              n._grouped ? (
                <div key={`group-${n.type}-${n.post_id}-${idx}`} ref={idx === notifications.length - 1 ? lastElementRef : null} onClick={() => { if (n.items?.length) n.items.forEach((item: any) => { void markNotificationRead(item.id); }); if (n.post_id) navigate(`/post/${n.post_id}`); }} className={`border-b border-border p-4 hover:bg-muted/5 cursor-pointer transition-colors ${!n.read ? 'bg-primary/3' : ''}`}>
                  <div className="flex gap-3 items-start"><div className="flex-shrink-0 pt-1">{getIcon(n.type)}</div><div className="flex-1 min-w-0"><div className="flex items-center mb-1.5">{n.items.slice(0, 5).map((item: any, ai: number) => <div key={item.id} className="w-7 h-7 rounded-full bg-muted border-2 border-background overflow-hidden -ml-1 first:ml-0 shrink-0" style={{ zIndex: 5 - ai }}>{item.from_user?.avatar_url ? <img src={item.from_user.avatar_url} alt={item.from_user.username} className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-[9px] font-bold">{item.from_user?.username?.[0]?.toUpperCase() ?? '?'}</div>}</div>)}{n.items.length > 5 && <div className="w-7 h-7 rounded-full bg-muted border-2 border-background -ml-1 flex items-center justify-center text-[9px] font-bold text-muted-foreground shrink-0">+{n.items.length - 5}</div>}{!n.read && <div className="w-2 h-2 bg-primary rounded-full ml-auto shrink-0" />}</div><p className="text-sm"><span className="font-bold">{n.items[0].from_user?.username ?? 'Someone'}</span>{n.items.length === 2 && <> and <span className="font-bold">{n.items[1].from_user?.username ?? 'another'}</span></>}{n.items.length > 2 && <> and <span className="font-semibold">{n.items.length - 1} others</span></>}<span className="text-muted-foreground">{n.type === 'like' ? ' liked' : n.type === 'repost' ? ' reposted' : ' followed'} your {n.type === 'follow' ? 'account' : 'post'}</span></p>{n.post?.content && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{n.post.content}</p>}<p className="text-xs text-muted-foreground mt-0.5">{formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}</p></div></div>
                </div>
              ) : n.type === 'streak_milestone' ? (
                <div key={n.id} ref={idx === notifications.length - 1 ? lastElementRef : null} onClick={() => navigate('/daily-rewards')} className="border-b border-orange-200/40 dark:border-orange-900/20 p-4 cursor-pointer transition-colors bg-gradient-to-r from-orange-500/10 via-amber-500/5 to-transparent hover:from-orange-500/15"><div className="flex gap-3 items-start"><div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-orange-400 to-amber-500 flex items-center justify-center flex-shrink-0 shadow-sm shadow-orange-500/20"><Flame className="w-6 h-6 text-white" /></div><div className="flex-1 min-w-0"><div className="flex items-center gap-1.5 mb-0.5"><Trophy className="w-3.5 h-3.5 text-yellow-500" /><span className="text-xs font-bold text-orange-600 dark:text-orange-400 uppercase tracking-wide">Streak Milestone</span>{!n.read && <span className="ml-auto w-2 h-2 bg-orange-500 rounded-full" />}</div><p className="font-semibold text-sm text-foreground">{getText(n)}</p><div className="flex items-center gap-3 mt-2"><div className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-orange-500/15 border border-orange-500/20"><Zap className="w-3 h-3 text-orange-500" /><span className="text-xs font-bold text-orange-600 dark:text-orange-400">Keep it up!</span></div><span className="text-xs text-muted-foreground">{formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}</span></div></div></div></div>
              ) : n.type === 'mention' ? (
                <div key={n.id} ref={idx === notifications.length - 1 ? lastElementRef : null} className={`border-b border-border p-4 transition-colors bg-primary/[0.02] hover:bg-primary/[0.04] ${!n.read ? 'border-l-2 border-l-primary' : ''}`}><div className="flex gap-3"><div className="shrink-0">{n.from_user?.avatar_url ? <img src={n.from_user.avatar_url} alt={n.from_user.username} className="w-10 h-10 rounded-full object-cover cursor-pointer" onClick={() => navigate(`/profile/${n.from_user.username}`)} /> : <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center text-sm font-bold text-primary cursor-pointer" onClick={() => navigate(`/profile/${n.from_user?.username}`)}>{n.from_user?.username?.[0]?.toUpperCase() ?? '@'}</div>}</div><div className="flex-1 min-w-0"><div className="flex items-center gap-1.5 mb-0.5 flex-wrap"><span className="flex items-center gap-1 text-[10px] font-bold text-primary uppercase tracking-wide"><AtSign className="w-3 h-3" />Mention</span>{!n.read && <span className="w-2 h-2 bg-primary rounded-full" />}<span className="ml-auto text-xs text-muted-foreground">{formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}</span></div><div className="flex items-center gap-1 mb-1"><button onClick={() => navigate(`/profile/${n.from_user?.username}`)} className="font-bold text-sm hover:underline">{n.from_user?.username}</button>{n.from_user?.verified && <BadgeCheck className="w-3.5 h-3.5 text-primary" fill="currentColor" />}<span className="text-sm text-muted-foreground">mentioned you</span></div>{n.post?.content && <button onClick={() => n.post_id && navigate(`/post/${n.post_id}`)} className="w-full text-left mt-1 mb-1 px-3 py-2 bg-muted/50 border border-border rounded-xl hover:bg-muted/80 transition-colors"><p className="text-sm text-foreground line-clamp-3 leading-relaxed">{n.post.content}</p>{n.post_id && <span className="text-xs text-primary font-semibold mt-1 block hover:underline">View post →</span>}</button>}{n.post_id && <MentionReplyInput postId={n.post_id} onPosted={() => fetchNotifications(null, true)} />}</div></div></div>
              ) : (
                <div key={n.id} ref={idx === notifications.length - 1 ? lastElementRef : null} onClick={() => { void markNotificationRead(n.id); if (n.post_id) navigate(`/post/${n.post_id}`); else if (n.from_user_id && !isPaymentType(n.type)) navigate(`/profile/${n.from_user?.username}`); else if (isPaymentType(n.type)) navigate('/wallet'); }} className={`border-b border-border p-4 hover:bg-muted/5 cursor-pointer transition-colors ${getNotifBg(n.type)}`}><div className="flex gap-3"><div className="flex-shrink-0 pt-1">{getIcon(n.type)}</div><div className="flex-1 min-w-0"><div className="flex items-start gap-2">{isPaymentType(n.type) ? <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${['payment_success', 'deposit_confirmed'].includes(n.type) ? 'bg-green-100 dark:bg-green-900/30' : n.type === 'boost_activated' ? 'bg-purple-100 dark:bg-purple-900/30' : 'bg-blue-100 dark:bg-blue-900/30'}`}><Smartphone className="w-4 h-4 text-green-600" /></div> : n.from_user?.avatar_url ? <img src={n.from_user.avatar_url} alt={n.from_user.username} className="w-8 h-8 rounded-full object-cover shrink-0" /> : <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-xs font-bold shrink-0">{n.from_user?.username?.[0]?.toUpperCase() ?? '?'}</div>}<div className="flex-1">{!isPaymentType(n.type) && <div className="flex items-center gap-1 flex-wrap"><span className="font-bold">{n.from_user?.username}</span>{n.from_user?.verified && <BadgeCheck className="w-4 h-4 text-primary" fill="currentColor" />}</div>}<p className={`text-sm ${isPaymentType(n.type) ? 'font-medium' : 'text-muted-foreground'}`}>{getText(n)}</p>{n.post?.content && <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{n.post.content}</p>}<p className="text-xs text-muted-foreground mt-1">{formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}</p></div>{!n.read && <div className="w-2.5 h-2.5 bg-primary rounded-full shrink-0 mt-1" />}</div></div></div></div>
              )
            )}
            {loadingMore && <div className="flex items-center justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>}
          </div>
        )
      )}
    </div>
  );
}
