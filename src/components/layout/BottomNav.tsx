import { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Home, Bell, User, Flame, UserSearch, Inbox, ShieldCheck, MessageSquare, HelpCircle } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import { useIsRegulator } from '@/hooks/useFeatureUnlock';

export function BottomNav() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const [visible, setVisible] = useState(true);
  const lastScrollY = useRef(0);
  const ticking = useRef(false);

  // Unread counts
  const [unreadNotifs, setUnreadNotifs] = useState(0);
  const [unreadMessages, setUnreadMessages] = useState(0);
  const [streakDay, setStreakDay] = useState(0);
  const [hasNewSuggestions, setHasNewSuggestions] = useState(false);
  const [unreadInbox, setUnreadInbox] = useState(0);
  const [scheduledBadge, setScheduledBadge] = useState(0);
  const [unreadHelpReplies, setUnreadHelpReplies] = useState(0);
  const prevNotifs = useRef(-1);
  const prevMessages = useRef(-1);
  const audioCtxRef = useRef(null as any);
  const isReg = useIsRegulator();
  const [pendingAppeals, setPendingAppeals] = useState(0);

  const playBeep = () => {
    try {
      if (!audioCtxRef.current) {
        audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      const ctx = audioCtxRef.current;
      if (ctx.state === 'suspended') void ctx.resume();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = 520;
      gain.gain.setValueAtTime(0.07, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.1);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.1);
    } catch { /* browser may block audio without prior user gesture */ }
  };

  // Poll local unread notification count every 60s
  useEffect(() => {
    if (!user) { setUnreadNotifs(0); setUnreadMessages(0); return; }
    let mounted = true;
    const fetchCounts = async () => {
      const { count: notifCount } = await supabase
        .from('notifications')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('read', false);
      if (mounted) {
        const nc = notifCount ?? 0;
        if (prevNotifs.current >= 0 && nc > prevNotifs.current) playBeep();
        prevNotifs.current = nc;
        setUnreadNotifs(nc);
      }

      const { data: convData } = await supabase
        .from('conversations')
        .select('id')
        .or(`participant_1.eq.${user.id},participant_2.eq.${user.id}`);
      const convIds = convData?.map((c: any) => c.id) ?? [];
      if (convIds.length > 0) {
        const { count: dmCount } = await supabase
          .from('direct_messages')
          .select('*', { count: 'exact', head: true })
          .in('conversation_id', convIds)
          .eq('read', false)
          .neq('sender_id', user.id);
        if (mounted) {
          const dc = dmCount ?? 0;
          if (prevMessages.current >= 0 && dc > prevMessages.current) playBeep();
          prevMessages.current = dc;
          setUnreadMessages(dc);
        }
      } else {
        if (mounted) {
          prevMessages.current = 0;
          setUnreadMessages(0);
        }
      }
    };
    fetchCounts();
    const iv = setInterval(fetchCounts, 15_000);

    // Real-time subscription for instant badge updates
    const sub = supabase
      .channel(`bottomnav-notifs-${user.id}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'notifications',
        filter: `user_id=eq.${user.id}`,
      }, () => { if (mounted) fetchCounts(); })
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'direct_messages',
      }, () => { if (mounted) fetchCounts(); })
      .subscribe();

    return () => { mounted = false; clearInterval(iv); supabase.removeChannel(sub); };
  }, [user?.id]);

  // Clear notification badge when visiting relevant pages
  useEffect(() => {
    if (location.pathname === '/notifications') setUnreadNotifs(0);
    if (location.pathname === '/messages') setUnreadMessages(0);
    if (location.pathname === '/platform-inbox') setUnreadInbox(0);
  }, [location.pathname]);

  // Fetch pending appeals count for regulators
  useEffect(() => {
    if (!user || !isReg) { setPendingAppeals(0); return; }
    const fetchAppeals = async () => {
      const { count } = await supabase
        .from('moderation_appeals')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'pending');
      setPendingAppeals(count ?? 0);
    };
    fetchAppeals();
    const iv = setInterval(fetchAppeals, 30000);
    return () => clearInterval(iv);
  }, [user?.id, isReg]);

  // Fetch current streak on mount and after auth changes
  useEffect(() => {
    if (!user) { setStreakDay(0); setHasNewSuggestions(false); return; }
    supabase
      .from('daily_rewards')
      .select('streak_day')
      .eq('user_id', user.id)
      .maybeSingle()
      .then(({ data }) => setStreakDay(data?.streak_day ?? 0));

    // Check for unread user suggestions (score > 0)
    supabase
      .from('user_suggestions')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .gt('score', 0)
      .then(({ count }) => setHasNewSuggestions((count ?? 0) > 0));
    // Check platform inbox unread count
    supabase
      .from('platform_inbox')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('read', false)
      .then(({ count }) => setUnreadInbox(count ?? 0));
    // Scheduled posts pending count
    supabase
      .from('scheduled_posts')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('status', 'pending')
      .then(({ count }) => setScheduledBadge(count ?? 0));

    // Help support ticket reply badge — unread inbox items with [Support] subject that are read=true (team viewed them)
    // We show a green dot on Help nav when the user has pending (unread by user) support reply messages
    supabase
      .from('platform_inbox')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .like('subject', '[Support]%')
      .eq('read', false)
      .then(({ count }) => setUnreadHelpReplies(count ?? 0));

    // Real-time subscription for new inbox messages → instant badge + toast
    const inboxSub = supabase
      .channel(`inbox-realtime-${user.id}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'platform_inbox',
        filter: `user_id=eq.${user.id}`,
      }, (payload: any) => {
        setUnreadInbox(prev => prev + 1);
        // Show in-app toast for the new message
        const msg = payload.new;
        if (msg?.subject) {
          import('sonner').then(({ toast }) => {
            toast(msg.icon_emoji ? `${msg.icon_emoji} ${msg.subject}` : msg.subject, {
              description: msg.body?.slice(0, 100),
              action: msg.cta_url ? { label: msg.cta_label ?? 'View', onClick: () => window.location.href = msg.cta_url } : undefined,
              duration: 6000,
            });
          });
        }
      })
      .subscribe();

    return () => { supabase.removeChannel(inboxSub); };
  }, [user?.id]);

  useEffect(() => {
    const handleScroll = () => {
      if (!ticking.current) {
        window.requestAnimationFrame(() => {
          const currentY = window.scrollY;
          const delta = currentY - lastScrollY.current;

          // Hide on scroll down (>10px), show on scroll up
          if (delta > 10 && currentY > 60) {
            setVisible(false);
          } else if (delta < -5) {
            setVisible(true);
          }
          lastScrollY.current = currentY;
          ticking.current = false;
        });
        ticking.current = true;
      }
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Always show on route change
  useEffect(() => {
    setVisible(true);
    lastScrollY.current = 0;
  }, [location.pathname]);

  const navItems = [
    { icon: Home,         label: 'Home',     path: '/',          badge: 0 },
    { icon: MessageSquare,label: 'Messages', path: '/messages',  badge: unreadMessages,  requireAuth: true },
    { icon: Flame,        label: 'Streak',   path: '/daily-rewards', badge: streakDay, badgeStyle: 'bg-orange-500', requireAuth: true },
    { icon: Inbox,        label: 'Inbox',    path: '/platform-inbox', requireAuth: true, badge: unreadInbox + (isReg ? pendingAppeals : 0) },
    { icon: Bell,         label: 'Alerts',   path: '/notifications', requireAuth: true,  badge: unreadNotifs },
    { icon: HelpCircle,   label: 'Help',     path: '/help',      badge: unreadHelpReplies, badgeStyle: 'bg-green-500', requireAuth: false },
    { icon: User,         label: 'Profile',  path: user ? `/profile/${user.username}` : '/auth', badge: 0, requireAuth: true },
  ];

  const handleNavClick = (path: string, requireAuth?: boolean) => {
    // Initialize AudioContext on user gesture so beep works later
    if (!audioCtxRef.current) {
      try { audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)(); } catch { /* ignore */ }
    }
    if (requireAuth && !user) navigate('/auth');
    else navigate(path);
  };

  return (
    <nav
      className={`lg:hidden fixed bottom-0 left-0 right-0 safe-area-bottom bg-background/85 backdrop-blur-2xl border-t border-border/70 shadow-[0_-12px_40px_-28px_hsl(0_0%_0%_/_0.7)] z-50 transition-transform duration-300 ease-in-out ${
        visible ? 'translate-y-0' : 'translate-y-full'
      }`}
    >
      {/* Policy footer link — tiny, always visible above nav */}
      <div className="border-t border-border/50 flex justify-center pt-1 pb-0.5">
        <button onClick={() => navigate('/policy')}
          className="flex items-center gap-1 text-[9px] text-muted-foreground hover:text-foreground transition-colors px-3 py-0.5 rounded-full hover:bg-muted">
          <ShieldCheck className="w-2.5 h-2.5 shrink-0" />
          <span>Content Policy</span>
        </button>
      </div>
      <div className="flex justify-around items-center h-16 px-1">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = location.pathname === item.path ||
            (item.path !== '/' && location.pathname.startsWith(item.path));

          return (
            <button
              key={item.path}
              onClick={() => handleNavClick(item.path, item.requireAuth)}
              className={`tg-nav-item flex flex-col items-center justify-center flex-1 h-full rounded-xl transition-all duration-200 active:scale-90 ${
                isActive ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <div className={`relative p-1.5 rounded-full transition-colors ${isActive ? 'bg-primary/10' : ''}`}>
                <Icon className="w-5 h-5" fill={isActive ? 'currentColor' : 'none'} strokeWidth={isActive ? 2.5 : 2} />
                {item.badge > 0 && (
                  <span className={`absolute -top-0.5 -right-0.5 min-w-[16px] h-4 text-white text-[9px] font-bold rounded-full flex items-center justify-center px-0.5 leading-none ${(item as any).badgeStyle ?? 'bg-red-500'}`}>
                    {item.badge > 99 ? '99+' : item.badge}
                  </span>
                )}
                {(item as any).dot && item.badge === 0 && (
                  <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-primary rounded-full border-2 border-background" />
                )}
              </div>
              <span className={`text-[10px] mt-0.5 font-medium ${isActive ? 'text-primary' : ''}`}>{item.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
