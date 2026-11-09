import { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Home, Bell, User, Flame, UserSearch, Inbox, ShieldCheck, MessageSquare, HelpCircle, Tv } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { socialApi } from '@/services/socialApiClient';
import { useIsRegulator } from '@/hooks/useFeatureUnlock';
import { backendCapabilities } from '@/services/testagramCapabilityClient';
import { toast } from 'sonner';

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

  // Poll canonical Backend notification and conversation summaries. No
  // browser database subscriptions or direct table reads are used here.
  useEffect(() => {
    if (!user) {
      setUnreadNotifs(0); setUnreadMessages(0);
      prevNotifs.current = -1; prevMessages.current = -1;
      return;
    }
    let mounted = true;
    const fetchCounts = async () => {
      try {
        const [notifications, conversations] = await Promise.all([
          socialApi.listNotifications(100),
          backendCapabilities.listConversations(100),
        ]);
        if (!mounted) return;
        const notificationCount = (notifications.items ?? []).filter((item: any) => !item.read_at).length;
        const messageCount = (conversations.items ?? []).reduce((total: number, item: any) => total + Math.max(0, Number(item.unread_count) || 0), 0);
        if (prevNotifs.current >= 0 && notificationCount > prevNotifs.current) playBeep();
        if (prevMessages.current >= 0 && messageCount > prevMessages.current) playBeep();
        prevNotifs.current = notificationCount;
        prevMessages.current = messageCount;
        setUnreadNotifs(notificationCount);
        setUnreadMessages(messageCount);
      } catch (error) {
        console.debug('[bottom-nav] Backend badge refresh unavailable', error);
      }
    };
    void fetchCounts();
    const interval = window.setInterval(() => void fetchCounts(), 15000);
    return () => { mounted = false; window.clearInterval(interval); };
  }, [user?.id]);

  // Clear notification badge when visiting relevant pages
  useEffect(() => {
    if (location.pathname === '/notifications') setUnreadNotifs(0);
    if (location.pathname === '/messages') setUnreadMessages(0);
    if (location.pathname === '/platform-inbox') setUnreadInbox(0);
  }, [location.pathname]);

  // Platform inbox, moderation appeals, daily rewards and scheduled-post
  // badges do not yet have verified owner-service read contracts. Keep these
  // counters at zero rather than silently querying legacy Supabase tables.
  useEffect(() => {
    if (!user) {
      setPendingAppeals(0); setStreakDay(0); setHasNewSuggestions(false);
      setUnreadInbox(0); setScheduledBadge(0); setUnreadHelpReplies(0);
      return;
    }
    setPendingAppeals(0);
    setStreakDay(0);
    setHasNewSuggestions(false);
    setUnreadInbox(0);
    setScheduledBadge(0);
    setUnreadHelpReplies(0);
  }, [user?.id, isReg]);

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
    { icon: Tv,           label: 'World TV',  path: '/iptv',           badge: 0 },
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
      className={`lg:hidden fixed bottom-0 left-0 right-0 z-50 transition-transform duration-300 ease-in-out ${
        visible ? 'translate-y-0' : 'translate-y-full'
      }`}
    >
      <div className="bg-background/85 backdrop-blur-2xl border-t border-border/70 shadow-[0_-12px_40px_-28px_hsl(0_0%_0%_/_0.7)]" style={{ marginBottom: "env(safe-area-inset-bottom, 0px)" }}>
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
              className={`tg-nav-item tg-touch-control flex flex-col items-center justify-center flex-1 h-full rounded-xl transition-all duration-200 active:scale-90 ${
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
    </div>
    </nav>
  );
}
