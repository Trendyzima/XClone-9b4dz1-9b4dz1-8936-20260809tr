import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import { X, Heart, UserPlus, DollarSign, MessageCircle, Bell, Repeat2 } from 'lucide-react';
import { useNotificationSound } from '@/hooks/useNotificationSound';

interface BannerItem {
  id: string;
  type: string;
  from_user_id: string | null;
  fromUsername?: string;
  fromAvatar?: string | null;
  postId?: string | null;
  timestamp: number;
}

// Pure helpers — no Record<string,T> with icon components as values (esbuild guard)
function getNotifColor(type: string): string {
  if (type === 'like')         return 'text-pink-600';
  if (type === 'follow')       return 'text-primary';
  if (type === 'repost')       return 'text-green-600';
  if (type === 'mention')      return 'text-blue-600';
  if (type === 'reply')        return 'text-purple-600';
  if (type === 'tip')          return 'text-amber-600';
  if (type === 'payment_sent') return 'text-amber-600';
  return 'text-foreground';
}

function getNotifBg(type: string): string {
  if (type === 'like')         return 'bg-pink-500/10 border-pink-500/20';
  if (type === 'follow')       return 'bg-primary/10 border-primary/20';
  if (type === 'repost')       return 'bg-green-500/10 border-green-500/20';
  if (type === 'mention')      return 'bg-blue-500/10 border-blue-500/20';
  if (type === 'reply')        return 'bg-purple-500/10 border-purple-500/20';
  if (type === 'tip')          return 'bg-amber-500/10 border-amber-500/20';
  if (type === 'payment_sent') return 'bg-amber-500/10 border-amber-500/20';
  return 'bg-background border-border';
}

function getNotifLabel(type: string, username: string): string {
  if (type === 'like')         return `@${username} liked your post`;
  if (type === 'follow')       return `@${username} started following you`;
  if (type === 'repost')       return `@${username} reposted your post`;
  if (type === 'mention')      return `@${username} mentioned you`;
  if (type === 'reply')        return `@${username} replied to your post`;
  if (type === 'tip')          return `@${username} sent you a tip! 💰`;
  if (type === 'payment_sent') return `@${username} sent you money 💰`;
  return 'New notification';
}

function NotifIcon({ type, className }: { type: string; className?: string }) {
  if (type === 'like')   return <Heart      className={className} />;
  if (type === 'follow') return <UserPlus   className={className} />;
  if (type === 'repost') return <Repeat2    className={className} />;
  if (type === 'reply')  return <MessageCircle className={className} />;
  if (type === 'tip' || type === 'payment_sent') return <DollarSign className={className} />;
  return <Bell className={className} />;
}

const SOUND_MAP: { [k: string]: 'like' | 'follow' | 'tip' | 'comment' | 'repost' | 'dm' } = {
  like: 'like', follow: 'follow', tip: 'tip', payment_sent: 'tip',
  reply: 'comment', mention: 'comment', repost: 'repost',
};

export function LiveNotificationBanner() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { play: playSound } = useNotificationSound();

  // Queue of pending banners — show one at a time, then next
  const [queue, setQueue] = useState<BannerItem[]>([]);
  const [banner, setBanner] = useState<BannerItem | null>(null);
  const [visible, setVisible] = useState(false);
  const [hovered, setHovered] = useState(false);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const slideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resolvedUsers = useRef<{ [id: string]: { username: string; avatar_url: string | null } }>({});

  const clearTimers = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (slideTimerRef.current) clearTimeout(slideTimerRef.current);
  };

  const dismissBanner = useCallback(() => {
    clearTimers();
    setVisible(false);
    slideTimerRef.current = setTimeout(() => {
      setBanner(null);
      // Dequeue next after current is gone
      setQueue(q => {
        if (q.length === 0) return q;
        const [next, ...rest] = q;
        setBanner(next);
        slideTimerRef.current = setTimeout(() => setVisible(true), 30);
        timerRef.current = setTimeout(() => {
          setVisible(false);
          slideTimerRef.current = setTimeout(() => { setBanner(null); setQueue(r => r.slice(1)); }, 350);
        }, 4500);
        return rest;
      });
    }, 350);
  }, []);

  // Auto-dismiss after 5s when not hovered
  useEffect(() => {
    if (!banner || !visible || hovered) { clearTimers(); return; }
    clearTimers();
    timerRef.current = setTimeout(dismissBanner, 5000);
    return clearTimers;
  }, [banner, visible, hovered, dismissBanner]);

  const showBannerItem = useCallback(async (notif: any) => {
    const fromId = notif.from_user_id;
    if (!fromId) return;
    const isKnown = ['like','follow','repost','mention','reply','tip','payment_sent'].includes(notif.type);
    if (!isKnown) return;

    // Resolve user info (cached)
    if (!resolvedUsers.current[fromId]) {
      const { data } = await supabase
        .from('profiles')
        .select('username, avatar_url')
        .eq('id', fromId)
        .maybeSingle();
      if (data) resolvedUsers.current[fromId] = data;
    }
    const resolved = resolvedUsers.current[fromId];
    if (!resolved) return;

    // Play sound
    const soundType = SOUND_MAP[notif.type] ?? 'dm';
    playSound(soundType);

    const item: BannerItem = {
      id: notif.id,
      type: notif.type,
      from_user_id: fromId,
      fromUsername: resolved.username,
      fromAvatar: resolved.avatar_url,
      postId: notif.post_id,
      timestamp: Date.now(),
    };

    // If nothing showing, show immediately; else queue
    setBanner(prev => {
      if (!prev) {
        setTimeout(() => setVisible(true), 30);
        return item;
      }
      setQueue(q => [...q, item]);
      return prev;
    });
  }, [playSound]);

  useEffect(() => {
    if (!user) return;

    const channel = supabase
      .channel(`live-notif-banner-${user.id}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'notifications',
        filter: `user_id=eq.${user.id}`,
      }, (payload: any) => {
        showBannerItem(payload.new);
      })
      .subscribe();

    return () => {
      clearTimers();
      supabase.removeChannel(channel);
    };
  }, [user?.id, showBannerItem]);

  if (!banner) return null;

  const color = getNotifColor(banner.type);
  const bg    = getNotifBg(banner.type);
  const label = getNotifLabel(banner.type, banner.fromUsername ?? 'Someone');

  const handleClick = () => {
    dismissBanner();
    if (banner.postId) navigate(`/post/${banner.postId}`);
    else if (banner.fromUsername) navigate(`/profile/${banner.fromUsername}`);
    else navigate('/notifications');
  };

  return (
    <div
      className={`fixed top-16 left-1/2 z-[500] transition-all duration-300 ease-out pointer-events-auto
        ${visible ? '-translate-x-1/2 translate-y-0 opacity-100 scale-100' : '-translate-x-1/2 -translate-y-4 opacity-0 scale-95'}`}
      style={{ maxWidth: 'min(400px, calc(100vw - 32px))' }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div
        className={`flex items-center gap-3 px-4 py-3 rounded-2xl border shadow-xl backdrop-blur-sm cursor-pointer select-none ${bg}`}
        onClick={handleClick}
      >
        {/* Avatar */}
        <div className="relative shrink-0">
          <div className="w-9 h-9 rounded-full bg-muted overflow-hidden border-2 border-background shadow">
            {banner.fromAvatar
              ? <img src={banner.fromAvatar} alt={banner.fromUsername} className="w-full h-full object-cover" />
              : <div className="w-full h-full flex items-center justify-center font-bold text-sm bg-muted">
                  {banner.fromUsername?.[0]?.toUpperCase()}
                </div>
            }
          </div>
          {/* Queue badge */}
          {queue.length > 0 && (
            <div className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-primary text-primary-foreground text-[9px] font-black flex items-center justify-center shadow">
              {queue.length + 1}
            </div>
          )}
        </div>

        {/* Icon + Label */}
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <NotifIcon type={banner.type} className={`w-4 h-4 shrink-0 ${color}`} />
          <p className="text-sm font-semibold truncate text-foreground">{label}</p>
        </div>

        {/* Dismiss */}
        <button
          onClick={e => { e.stopPropagation(); dismissBanner(); }}
          className="p-1 rounded-full hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors shrink-0"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Progress bar — pauses on hover */}
      <div className="absolute bottom-0 left-0 right-0 h-0.5 rounded-full overflow-hidden">
        {visible && (
          <div
            className={`h-full ${color.replace('text-', 'bg-')} rounded-full`}
            style={{
              animation: hovered ? 'none' : 'live-banner-progress 5s linear forwards',
            }}
          />
        )}
      </div>

      <style>{`
        @keyframes live-banner-progress {
          from { width: 100%; }
          to   { width: 0%; }
        }
      `}</style>
    </div>
  );
}
