import { useState, useEffect, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import {
  Home, Search, Bell, Mail, User, Hash, Radio, LogOut, Plus, Users,
  TrendingUp, Sparkles, Bookmark, List, DollarSign, BarChart3,
  ShoppingBag, Calendar, Crown, Briefcase, Settings, HelpCircle,
  History, ChevronDown, ChevronUp, FileText, Wallet, Megaphone,
  Shield, LineChart, Globe, Flame, Trophy, UserSearch, Gift, BookOpen, Inbox,
  MessageSquare, ShieldCheck, ShoppingCart,
} from 'lucide-react';
import { authService } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { formatNumber } from '@/lib/utils';
import { useFediversePolling } from '@/hooks/useFediversePolling';
import { useIsRegulator } from '@/hooks/useFeatureUnlock';
import { useGovernance } from '@/lib/governance';

function runWhenIdle(task: () => void, timeout = 1200) {
  if (typeof window === 'undefined') return;
  const ric = (window as any).requestIdleCallback;
  if (typeof ric === 'function') {
    const id = ric(task, { timeout });
    return () => (window as any).cancelIdleCallback?.(id);
  }
  const id = window.setTimeout(task, 80);
  return () => window.clearTimeout(id);
}

interface Community {
  id: string;
  name: string;
  display_name: string;
  icon_url?: string;
  member_count: number;
}

export function Sidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuth();
  const isReg = useIsRegulator();
  const { governance } = useGovernance();
  const [communities, setCommunities] = useState<Community[]>([]);
  const [trendingCommunities, setTrendingCommunities] = useState<Community[]>([]);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showCommunities, setShowCommunities] = useState(true);
  const [showTrending, setShowTrending] = useState(true);
  const [isEmployee, setIsEmployee] = useState(false);

  // Check employee status for team-chat link visibility
  useEffect(() => {
    if (!user || isReg || governance.is_owner) { setIsEmployee(isReg || governance.is_owner); return; }
    return runWhenIdle(() => { supabase.from('employee_assignments').select('id').eq('user_id', user.id).eq('is_active', true).maybeSingle()
      .then(({ data }) => setIsEmployee(!!data)); });
  }, [user?.id, isReg, governance.is_owner]);

  // ── Unread counts ────────────────────────────────────────────────────────
  const [unreadNotifs, setUnreadNotifs] = useState(0);
  const [unreadMessages, setUnreadMessages] = useState(0);
  const [pendingAdsBadge, setPendingAdsBadge] = useState(0);
  const [unreadHelpReplies, setUnreadHelpReplies] = useState(0);
  const [unreadTeamChat, setUnreadTeamChat] = useState(0);
  const { unreadCount: unreadFed } = useFediversePolling(user?.id);

  // Check if user is admin + count pending ads
  useEffect(() => {
    if (!user) { setPendingAdsBadge(0); return; }
    const checkAdminAds = async () => {
      const { data: adminRow } = await supabase.from('admin_users').select('id').eq('user_id', user.id).maybeSingle();
      if (!adminRow) return;
      const { count } = await supabase.from('user_ads').select('id', { count: 'exact', head: true }).eq('status', 'pending');
      setPendingAdsBadge(count ?? 0);
    };
    const cancel = runWhenIdle(() => { checkAdminAds(); });
    const iv = setInterval(checkAdminAds, 30_000);
    return () => { cancel?.(); clearInterval(iv); };
  }, [user?.id]);

  // Poll help ticket reply badge
  useEffect(() => {
    if (!user) { setUnreadHelpReplies(0); return; }
    supabase
      .from('platform_inbox')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .like('subject', '[Support]%')
      .eq('read', false)
      .then(({ count }) => setUnreadHelpReplies(count ?? 0));
  }, [user?.id]);

  // Poll Team Chat unread badge every 30s
  useEffect(() => {
    if (!user || !isEmployee) { setUnreadTeamChat(0); return; }
    let mounted = true;
    const fetchTeamUnread = async () => {
      const lastSeen = localStorage.getItem('ts-teamchat-last-seen') ?? '1970-01-01T00:00:00.000Z';
      const { count } = await supabase
        .from('team_chat_messages')
        .select('id', { count: 'exact', head: true })
        .gt('created_at', lastSeen)
        .neq('user_id', user.id);
      if (mounted) setUnreadTeamChat(count ?? 0);
    };
    fetchTeamUnread();
    const iv = setInterval(fetchTeamUnread, 30_000);
    return () => { mounted = false; clearInterval(iv); };
  }, [user?.id, isEmployee]);

  // Poll local notification unread count every 60s
  useEffect(() => {
    if (!user) { setUnreadNotifs(0); setUnreadMessages(0); return; }
    let mounted = true;
    const fetchCounts = async () => {
      // Notification unread count
      const { count: notifCount } = await supabase
        .from('notifications')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('read', false);
      if (mounted) setUnreadNotifs(notifCount ?? 0);

      // DM unread count
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
        if (mounted) setUnreadMessages(dmCount ?? 0);
      } else {
        if (mounted) setUnreadMessages(0);
      }
    };
    const cancel = runWhenIdle(fetchCounts);
    // Poll every 15s for near-real-time badges
    const iv = setInterval(fetchCounts, 15_000);

    // Real-time subscription for instant notification badge updates
    const sub = supabase
      .channel(`sidebar-notifs-${user.id}`)
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

    return () => { mounted = false; cancel?.(); clearInterval(iv); supabase.removeChannel(sub); };
  }, [user?.id]);

  // Clear badges when visiting relevant pages
  useEffect(() => {
    if (location.pathname === '/notifications') setUnreadNotifs(0);
    if (location.pathname === '/messages') setUnreadMessages(0);
    if (location.pathname === '/team-chat') {
      localStorage.setItem('ts-teamchat-last-seen', new Date().toISOString());
      setUnreadTeamChat(0);
    }
  }, [location.pathname]);

  useEffect(() => {
    const cancel = runWhenIdle(() => { if (user) void fetchUserCommunities(); void fetchTrendingCommunities(); });
    return () => cancel?.();
  }, [user?.id]);

  const fetchUserCommunities = async () => {
    if (!user) return;
    const { data } = await supabase
      .from('community_members')
      .select('communities (*)')
      .eq('user_id', user.id)
      .limit(5);
    if (data) setCommunities(data.map((d: any) => d.communities));
  };

  const fetchTrendingCommunities = async () => {
    const { data } = await supabase
      .from('communities')
      .select('*')
      .order('member_count', { ascending: false })
      .limit(5);
    if (data) setTrendingCommunities(data);
  };

  // Nav items with badge counts
  const navItems = [
    { icon: Home, label: 'Home', path: '/', requireAuth: false, badge: 0 },
    { icon: Hash, label: 'Explore', path: '/explore', requireAuth: false, badge: 0 },
    { icon: MessageSquare, label: 'Threads', path: '/threads', requireAuth: false, badge: 0 },
    { icon: Bell, label: 'Notifications', path: '/notifications', requireAuth: true, badge: unreadNotifs },
    { icon: Mail, label: 'Messages', path: '/messages', requireAuth: true, badge: unreadMessages },
    { icon: Radio, label: 'Spaces', path: '/spaces', requireAuth: false, badge: 0 },
    { icon: Sparkles, label: 'AI', path: '/ai', requireAuth: false, badge: 0 },
    { icon: Globe, label: 'Fediverse', path: '/fediverse', requireAuth: false, badge: unreadFed },
    { icon: Trophy, label: 'Leaderboard', path: '/leaderboard', requireAuth: false, badge: 0 },
  ];

  const creatorTools = [
    { icon: Briefcase, label: 'Creator Studio', path: '/creator-studio', requireAuth: true },
    { icon: Radio, label: 'TV Production Studio', path: '/tv-studio', requireAuth: true },
    { icon: BarChart3, label: 'Analytics', path: '/analytics', requireAuth: true },
    { icon: DollarSign, label: 'Monetization', path: '/monetization', requireAuth: true },
    { icon: ShoppingBag, label: 'Products', path: '/products', requireAuth: true },
    { icon: Calendar, label: 'Scheduled', path: '/scheduled', requireAuth: true, badge: 0 },
  ];

  // Scheduled posts badge count
  const [scheduledBadge, setScheduledBadge] = useState(0);
  useEffect(() => {
    if (!user) { setScheduledBadge(0); return; }
    const fetchScheduled = async () => {
      const { count } = await supabase
        .from('scheduled_posts')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('status', 'pending');
      setScheduledBadge(count ?? 0);
    };
    const cancel = runWhenIdle(fetchScheduled);
    const iv = setInterval(fetchScheduled, 60_000);
    return () => { cancel?.(); clearInterval(iv); };
  }, [user?.id]);

  const adminTools = [
    { icon: Briefcase, label: 'Staff Recruitment', path: '/admin/staff-recruitment', requireAuth: true, badge: 0 },
    { icon: LineChart, label: 'Revenue Analytics', path: '/revenue-analytics', requireAuth: true, badge: 0 },
    { icon: TrendingUp, label: 'Admin Revenue', path: '/admin/revenue', requireAuth: true, badge: 0 },
    { icon: Megaphone, label: 'Ad Review', path: '/admin/ads-review', requireAuth: true, badge: pendingAdsBadge },
    { icon: Shield, label: 'Fraud Detection', path: '/fraud-detection', requireAuth: true, badge: 0 },
  ];

  const userTools = [
    { icon: Briefcase, label: 'Testagram Jobs', path: '/jobs', requireAuth: true },
    { icon: Bookmark, label: 'Bookmarks', path: '/bookmarks', requireAuth: true },
    { icon: List, label: 'Lists', path: '/lists', requireAuth: true },
    { icon: History, label: 'History', path: '/history', requireAuth: true },
    { icon: Flame, label: 'Daily Rewards', path: '/daily-rewards', requireAuth: true },
    { icon: UserSearch, label: 'Discover', path: '/discover', requireAuth: false },
    { icon: Gift, label: 'Refer & Earn', path: '/referral', requireAuth: true },
    { icon: Wallet, label: 'Wallet', path: '/wallet', requireAuth: true },
    { icon: DollarSign, label: 'Payouts', path: '/payouts', requireAuth: true },
    { icon: Megaphone, label: 'My Ads', path: '/my-ads', requireAuth: true },
    { icon: LineChart, label: 'Ad Analytics', path: '/ad-analytics', requireAuth: true },
    { icon: BookOpen, label: 'Series', path: '/series', requireAuth: false },
    { icon: ShoppingCart, label: 'Orders', path: '/orders', requireAuth: true },
    { icon: Inbox, label: 'Wise Brain', path: '/platform-inbox', requireAuth: true },
    { icon: BarChart3, label: 'Story Analytics', path: '/story-analytics', requireAuth: true },
    { icon: DollarSign, label: 'Platform Revenue', path: '/admin/platform-revenue', requireAuth: true },
  ];

  // Team chat — employees & regulator only
  const staffItems = (governance.is_admin || governance.is_owner) ? [
    { icon: ShieldCheck, label: governance.is_owner ? 'Owner Workspace' : 'Staff Workspace', path: '/staff', requireAuth: true },
  ] : [];
  const teamItems = isEmployee ? [
    { icon: MessageSquare, label: 'Team Chat', path: '/team-chat', requireAuth: true },
  ] : [];

  // Regulator-only items
  const regulatorItems = isReg ? [
    { icon: Crown, label: 'Regulator Panel', path: '/regulator', requireAuth: true },
    { icon: Shield, label: 'Appeals', path: '/appeals', requireAuth: true },
  ] : [];
  // The error was here: an extra closing bracket `]` which caused "Parsing error: Declaration or statement expected."
  // Removing it fixes the syntax.

  const handleNavClick = (path: string, requireAuth?: boolean) => {
    if (requireAuth && !user) navigate('/auth');
    else navigate(path);
  };

  const handleLogout = async () => {
    await authService.signOut();
    logout();
    navigate('/');
  };

  return (
    <aside className="hidden lg:flex lg:flex-col w-72 h-screen sticky top-0 border-r border-border overflow-y-auto">
      {/* Logo */}
      <div className="flex items-center space-x-2 p-4 border-b border-border">
        <img src="/tsocial-logo.png" alt="Tsocial" className="w-10 h-10 rounded-xl object-cover" />
        <span className="text-2xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">Tsocial</span>
      </div>

      {/* Main Navigation */}
      <nav className="flex-1 p-2">
        <div className="space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = location.pathname === item.path ||
              (item.path !== '/' && location.pathname.startsWith(item.path));

            return (
              <button
                key={item.path}
                onClick={() => handleNavClick(item.path, item.requireAuth)}
                className={`relative flex items-center space-x-3 px-4 py-3 rounded-lg transition-colors w-full text-left ${
                  isActive
                    ? 'bg-primary text-primary-foreground font-semibold'
                    : 'hover:bg-muted text-foreground'
                }`}
              >
                <div className="relative flex-shrink-0">
                  <Icon className="w-5 h-5" />
                  {item.badge > 0 && (
                    <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center px-0.5 leading-none">
                      {item.badge > 99 ? '99+' : item.badge}
                    </span>
                  )}
                </div>
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>

        {/* User Tools */}
        {user && (
          <>
            <div className="mt-6 mb-2">
              <h3 className="px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Library</h3>
            </div>
            <div className="space-y-1">
              {userTools.map((item) => {
                const Icon = item.icon;
                const isActive = location.pathname === item.path;
                return (
                  <button
                    key={item.path}
                    onClick={() => handleNavClick(item.path, item.requireAuth)}
                    className={`flex items-center space-x-3 px-4 py-2 rounded-lg transition-colors w-full text-left text-sm ${
                      isActive ? 'bg-primary/10 text-primary font-medium' : 'hover:bg-muted text-foreground'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    <span>{item.label}</span>
                  </button>
                );
              })}

              {/* Staff Workspace — governance assignment */}
              {staffItems.map((item) => { const Icon = item.icon; const isActive = location.pathname === item.path; return <button key={item.path} onClick={() => handleNavClick(item.path, item.requireAuth)} className={`flex items-center space-x-3 px-4 py-2 rounded-lg transition-colors w-full text-left text-sm ${isActive ? 'bg-primary/10 text-primary font-medium' : 'hover:bg-muted text-foreground'}`}><Icon className="w-4 h-4 text-primary"/><span>{item.label}</span><span className="ml-auto text-[9px] bg-primary/10 text-primary font-bold px-1.5 py-0.5 rounded-full">{governance.is_owner ? 'Owner' : (governance.role ?? 'Staff')}</span></button>; })}

              {/* Team Chat — employees only */}
              {teamItems.map((item) => {
                const Icon = item.icon;
                const isActive = location.pathname === item.path;
                return (
                  <button key={item.path} onClick={() => handleNavClick(item.path, item.requireAuth)}
                    className={`flex items-center space-x-3 px-4 py-2 rounded-lg transition-colors w-full text-left text-sm ${
                      isActive ? 'bg-violet-500/15 text-violet-600 font-medium' : 'hover:bg-muted text-foreground'
                    }`}>
                    <div className="relative shrink-0">
                      <Icon className="w-4 h-4 text-violet-500" />
                      {unreadTeamChat > 0 && (
                        <span className="absolute -top-1.5 -right-1.5 min-w-[14px] h-3.5 bg-red-500 text-white text-[8px] font-bold rounded-full flex items-center justify-center px-0.5 leading-none">
                          {unreadTeamChat > 99 ? '99+' : unreadTeamChat}
                        </span>
                      )}
                    </div>
                    <span>{item.label}</span>
                    {unreadTeamChat > 0 ? (
                      <span className="ml-auto text-[9px] font-bold text-red-500 bg-red-500/10 px-1.5 py-0.5 rounded-full">{unreadTeamChat} new</span>
                    ) : (
                      <span className="ml-auto text-[9px] bg-violet-500/10 text-violet-600 font-bold px-1.5 py-0.5 rounded-full">Staff</span>
                    )}
                  </button>
                );
              })}

              {/* Regulator items */}
              {regulatorItems.map((item) => {
                const Icon = item.icon;
                const isActive = location.pathname === item.path;
                return (
                  <button key={item.path} onClick={() => handleNavClick(item.path, item.requireAuth)}
                    className={`flex items-center space-x-3 px-4 py-2 rounded-lg transition-colors w-full text-left text-sm ${
                      isActive ? 'bg-amber-500/15 text-amber-600 font-medium' : 'hover:bg-muted text-foreground'
                    }`}>
                    <Icon className="w-4 h-4 text-amber-500" />
                    <span>{item.label}</span>
                    <span className="ml-auto text-[9px] bg-amber-500/10 text-amber-600 font-bold px-1.5 py-0.5 rounded-full">👑</span>
                  </button>
                );
              })}
            </div>

            {/* Creator Tools */}
            <div className="mt-6 mb-2">
              <h3 className="px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Creator Tools</h3>
            </div>
            <div className="space-y-1">
              {creatorTools.map((item) => {
                const Icon = item.icon;
                const isActive = location.pathname === item.path;
                const badge = item.path === '/scheduled' ? scheduledBadge : 0;
                return (
                  <button
                    key={item.path}
                    onClick={() => handleNavClick(item.path, item.requireAuth)}
                    className={`relative flex items-center space-x-3 px-4 py-2 rounded-lg transition-colors w-full text-left text-sm ${
                      isActive ? 'bg-primary/10 text-primary font-medium' : 'hover:bg-muted text-foreground'
                    }`}
                  >
                    <div className="relative shrink-0">
                      <Icon className="w-4 h-4" />
                      {badge > 0 && (
                        <span className="absolute -top-1.5 -right-1.5 min-w-[14px] h-3.5 bg-primary text-primary-foreground text-[8px] font-bold rounded-full flex items-center justify-center px-0.5 leading-none">
                          {badge > 99 ? '99+' : badge}
                        </span>
                      )}
                    </div>
                    <span>{item.label}</span>
                    {badge > 0 && (
                      <span className="ml-auto text-[9px] font-bold text-primary bg-primary/10 px-1.5 py-0.5 rounded-full">{badge} pending</span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Admin Tools */}
            <div className="mt-6 mb-2">
              <h3 className="px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Admin Tools</h3>
            </div>
            <div className="space-y-1">
              {adminTools.map((item) => {
                const Icon = item.icon;
                const isActive = location.pathname === item.path;
                return (
                  <button
                    key={item.path}
                    onClick={() => handleNavClick(item.path, item.requireAuth)}
                    className={`relative flex items-center space-x-3 px-4 py-2 rounded-lg transition-colors w-full text-left text-sm ${
                      isActive ? 'bg-primary/10 text-primary font-medium' : 'hover:bg-muted text-foreground'
                    }`}
                  >
                    <div className="relative shrink-0">
                      <Icon className="w-4 h-4" />
                      {item.badge > 0 && (
                        <span className="absolute -top-1.5 -right-1.5 min-w-[14px] h-3.5 bg-amber-500 text-white text-[8px] font-bold rounded-full flex items-center justify-center px-0.5 leading-none">
                          {item.badge > 99 ? '99+' : item.badge}
                        </span>
                      )}
                    </div>
                    <span>{item.label}</span>
                    {item.badge > 0 && (
                      <span className="ml-auto text-[9px] font-bold text-amber-600 bg-amber-500/10 px-1.5 py-0.5 rounded-full">Review</span>
                    )}
                  </button>
                );
              })}
            </div>
          </>
        )}

        {/* Communities */}
        <div className="mt-6">
          <button
            onClick={() => setShowCommunities(!showCommunities)}
            className="flex items-center justify-between w-full px-4 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide hover:text-foreground"
          >
            <span>Communities</span>
            {showCommunities ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>

          {showCommunities && (
            <div className="mt-2 space-y-1">
              <button
                onClick={() => navigate('/communities')}
                className="flex items-center space-x-2 px-4 py-2 rounded-lg hover:bg-muted w-full text-left text-sm"
              >
                <Plus className="w-4 h-4" />
                <span>Discover Communities</span>
              </button>

              {user && communities.length > 0 && (
                <>
                  <div className="px-4 py-1 text-xs text-muted-foreground">Your Communities</div>
                  {communities.map((community) => (
                    <button
                      key={community.id}
                      onClick={() => navigate(`/c/${community.name}`)}
                      className="flex items-center space-x-3 px-4 py-2 rounded-lg hover:bg-muted w-full text-left"
                    >
                      <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0 overflow-hidden">
                        {community.icon_url ? (
                          <img src={community.icon_url} alt={community.display_name} className="w-full h-full object-cover" />
                        ) : (
                          <span className="text-xs font-bold">{community.display_name[0]}</span>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{community.display_name}</p>
                        <p className="text-xs text-muted-foreground">{formatNumber(community.member_count)}</p>
                      </div>
                    </button>
                  ))}
                </>
              )}
            </div>
          )}
        </div>

        {/* Trending Communities */}
        {trendingCommunities.length > 0 && (
          <div className="mt-4">
            <button
              onClick={() => setShowTrending(!showTrending)}
              className="flex items-center justify-between w-full px-4 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide hover:text-foreground"
            >
              <div className="flex items-center gap-2">
                <TrendingUp className="w-4 h-4" />
                <span>Trending</span>
              </div>
              {showTrending ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>

            {showTrending && (
              <div className="mt-2 space-y-1">
                {trendingCommunities.map((community) => (
                  <button
                    key={community.id}
                    onClick={() => navigate(`/c/${community.name}`)}
                    className="flex items-center space-x-3 px-4 py-2 rounded-lg hover:bg-muted w-full text-left"
                  >
                    <div className="w-6 h-6 rounded-full bg-accent/20 flex items-center justify-center flex-shrink-0 overflow-hidden">
                      {community.icon_url ? (
                        <img src={community.icon_url} alt={community.display_name} className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-xs font-bold">{community.display_name[0]}</span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{community.display_name}</p>
                      <p className="text-xs text-muted-foreground">{formatNumber(community.member_count)}</p>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Content Policy link */}
        <div className="mt-4 mx-2">
          <button
            onClick={() => navigate('/policy')}
            className="flex items-center gap-2 w-full px-3 py-2 rounded-lg text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
            <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
            <span>Content Policy</span>
          </button>
        </div>

        {/* Premium Banner */}
        <div className="mt-2 mx-2">
          <div className="bg-gradient-to-br from-purple-500/10 to-pink-500/10 rounded-xl p-4 border border-purple-500/20">
            <Crown className="w-8 h-8 text-purple-500 mb-2" />
            <h3 className="font-bold text-sm mb-1">Upgrade to Premium</h3>
            <p className="text-xs text-muted-foreground mb-3">
              Get verified, unlock exclusive features, and monetize your content
            </p>
            <Button
              onClick={() => navigate('/premium')}
              size="sm"
              className="w-full bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600"
            >
              <Crown className="w-4 h-4 mr-2" />
              Get Premium
            </Button>
          </div>
        </div>
      </nav>

      {/* User Profile / Sign In */}
      <div className="p-2 border-t border-border">
        {user ? (
          <div className="relative">
            <button
              onClick={() => setShowUserMenu(!showUserMenu)}
              className="flex items-center justify-between p-3 hover:bg-muted rounded-lg w-full transition-colors"
            >
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 rounded-full bg-muted overflow-hidden flex-shrink-0">
                  {user.avatar ? (
                    <img src={user.avatar} alt={user.username} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center font-bold">
                      {user.username[0].toUpperCase()}
                    </div>
                  )}
                </div>
                <div className="flex-1 min-w-0 text-left">
                  <p className="font-semibold truncate">{user.username}</p>
                  <p className="text-sm text-muted-foreground truncate">@{user.username}</p>
                </div>
              </div>
              <ChevronDown className={`w-5 h-5 transition-transform ${showUserMenu ? 'rotate-180' : ''}`} />
            </button>

            {showUserMenu && (
              <div className="absolute bottom-full left-0 right-0 mb-2 bg-background border border-border rounded-lg shadow-lg overflow-hidden z-50">
                <button
                  onClick={() => { navigate(`/profile/${user.username}`); setShowUserMenu(false); }}
                  className="flex items-center gap-3 w-full p-3 hover:bg-muted text-left"
                >
                  <User className="w-5 h-5" />
                  <span>Profile</span>
                </button>
                <button
                  onClick={() => { navigate('/settings'); setShowUserMenu(false); }}
                  className="flex items-center gap-3 w-full p-3 hover:bg-muted text-left"
                >
                  <Settings className="w-5 h-5" />
                  <span>Settings</span>
                </button>
                <button
                  onClick={() => { navigate('/help'); setShowUserMenu(false); }}
                  className="flex items-center gap-3 w-full p-3 hover:bg-muted text-left"
                >
                  <HelpCircle className="w-5 h-5" />
                  <span>Help</span>
                  {unreadHelpReplies > 0 && (
                    <span className="ml-auto min-w-[16px] h-4 bg-green-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center px-0.5 leading-none">
                      {unreadHelpReplies > 9 ? '9+' : unreadHelpReplies}
                    </span>
                  )}
                </button>
                <div className="border-t border-border" />
                <button
                  onClick={() => { handleLogout(); setShowUserMenu(false); }}
                  className="flex items-center gap-3 w-full p-3 hover:bg-destructive/10 text-destructive text-left"
                >
                  <LogOut className="w-5 h-5" />
                  <span>Log out</span>
                </button>
              </div>
            )}
          </div>
        ) : (
          <Button onClick={() => navigate('/auth')} className="w-full rounded-lg font-semibold">
            Sign in
          </Button>
        )}
      </div>
    </aside>
  );
}
