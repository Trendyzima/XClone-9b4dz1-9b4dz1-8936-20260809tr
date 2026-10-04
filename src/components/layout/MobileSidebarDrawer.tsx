import { useEffect, useState } from 'react';
import {
  Menu, Home, Hash, Bell, Mail, Radio, Sparkles, Bookmark, List, History,
  Briefcase, BarChart3, DollarSign, ShoppingBag, Calendar, Crown, LogOut,
  Settings, HelpCircle, User, FileText, Globe, Trophy, Flame, UserSearch,
  Gift, Wallet, Users, Megaphone, BadgeCheck, UserPlus, Shield, X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { authService } from '@/lib/auth';
import { formatNumber } from '@/lib/utils';

export function MobileSidebarDrawer() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuth();

  // Use a deterministic mobile drawer instead of a dialog animation layer.
  // This avoids Radix overlay/content race conditions that can leave a black
  // backdrop mounted while the drawer itself is visually hidden.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  // ── Primary nav items (large bold text — X.com style) ───────────────────
  const primaryItems = [
    { icon: User,       label: 'Profile',            path: user ? `/profile/${user.username}` : '/auth', requireAuth: true },
    { icon: UserSearch, label: 'Discover People',     path: '/discover',        requireAuth: false },
    { icon: Crown,      label: 'Premium',             path: '/premium',         requireAuth: false },
    { icon: List,       label: 'Lists',               path: '/lists',           requireAuth: true },
    { icon: Users,      label: 'Communities',         path: '/communities',     requireAuth: false },
    { icon: Bookmark,   label: 'Bookmarks',           path: '/bookmarks',       requireAuth: true },
    { icon: Briefcase,  label: 'Creator Studio',      path: '/creator-studio',  requireAuth: true },
    { icon: Megaphone,  label: 'Ads',                 path: '/my-ads',          requireAuth: true },
    { icon: Settings,   label: 'Settings and privacy',path: '/settings',        requireAuth: false },
  ];

  // ── Secondary items (smaller) ────────────────────────────────────────────
  const secondaryItems = [
    { icon: Home,       label: 'Home',          path: '/',               requireAuth: false },
    { icon: Hash,       label: 'Explore',       path: '/explore',        requireAuth: false },
    { icon: Bell,       label: 'Notifications', path: '/notifications',  requireAuth: true },
    { icon: Mail,       label: 'Messages',      path: '/messages',       requireAuth: true },
    { icon: Radio,      label: 'Spaces',        path: '/spaces',         requireAuth: false },
    { icon: Sparkles,   label: 'AI',            path: '/ai',             requireAuth: false },
    { icon: FileText,   label: 'Threads',       path: '/threads',        requireAuth: false },
    { icon: Globe,      label: 'Fediverse',     path: '/fediverse',      requireAuth: false },
    { icon: Trophy,     label: 'Leaderboard',   path: '/leaderboard',    requireAuth: false },
    { icon: Flame,      label: 'Daily Rewards', path: '/daily-rewards',  requireAuth: true },
    { icon: Gift,       label: 'Refer & Earn',  path: '/referral',       requireAuth: true },
    { icon: Wallet,     label: 'Wallet',        path: '/wallet',         requireAuth: true },
    { icon: BarChart3,  label: 'Analytics',     path: '/analytics',      requireAuth: true },
    { icon: HelpCircle, label: 'Help',          path: '/help',           requireAuth: false },
  ];

  const goTo = (path: string, requireAuth?: boolean) => {
    // Close the modal first so Radix can remove its focus trap/backdrop
    // before React Router swaps the page underneath it.
    setOpen(false);
    window.setTimeout(() => {
      if (requireAuth && !user) navigate('/auth');
      else navigate(path);
    }, 0);
  };

  const closeAnd = (action: () => void) => {
    setOpen(false);
    window.setTimeout(action, 0);
  };

  const handleLogout = async () => {
    await authService.signOut();
    logout();
    navigate('/');
    setOpen(false);
  };

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="lg:hidden tg-touch-control"
        aria-label="Open navigation menu"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <Menu className="w-6 h-6" />
      </Button>

      {open && (
        <div
          className="fixed inset-0 z-[9998] lg:hidden"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
        >
          <div className="absolute inset-0 bg-black/60" aria-hidden="true" />
          <aside
            role="dialog"
            aria-modal="true"
            aria-label="Testagram navigation"
            className="tg-drawer-surface fixed inset-y-0 left-0 z-[9999] flex w-[min(300px,85vw)] flex-col overflow-hidden bg-background shadow-2xl"
            onMouseDown={(event) => event.stopPropagation()}
          >
        {/* ── User card ─────────────────────────────────────────────────────── */}
        {user ? (
          <div className="p-4 border-b border-border">
            <div className="flex items-start justify-between mb-3">
              <div
                className="w-12 h-12 rounded-full bg-muted overflow-hidden cursor-pointer"
                onClick={() => goTo(`/profile/${user.username}`)}
              >
                {user.avatar ? (
                  <img src={user.avatar} alt={user.username} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-xl font-bold bg-primary/10 text-primary">
                    {user.username[0]?.toUpperCase()}
                  </div>
                )}
              </div>
            </div>
            <p className="font-bold text-base leading-tight">{user.username}</p>
            <p className="text-sm text-muted-foreground">@{user.username}</p>
            {/* Following / Followers mini stats */}
            <div className="flex gap-4 mt-2 text-sm">
              <button onClick={() => goTo(`/profile/${user.username}`)} className="hover:underline">
                <span className="font-bold text-foreground">—</span>{' '}
                <span className="text-muted-foreground">Following</span>
              </button>
              <button onClick={() => goTo(`/profile/${user.username}`)} className="hover:underline">
                <span className="font-bold text-foreground">—</span>{' '}
                <span className="text-muted-foreground">Followers</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="p-4 border-b border-border">
            <img src="/tsocial-logo.png" alt="Tsocial" className="w-10 h-10 rounded-xl object-cover mb-2" />
            <p className="text-xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">Tsocial</p>
          </div>
        )}

        {/* ── Primary nav (large bold — X.com style) ────────────────────────── */}
        <nav className="flex-1 overflow-y-auto">
          <div className="py-2">
            {primaryItems.map((item) => {
              const Icon = item.icon;
              const isActive = location.pathname === item.path || (item.path !== '/' && location.pathname.startsWith(item.path));
              return (
                <button
                  key={item.path + item.label}
                  onClick={() => goTo(item.path, item.requireAuth)}
                  className={`flex items-center gap-4 w-full px-5 py-3.5 text-left transition-colors hover:bg-muted/50 ${
                    isActive ? 'text-primary font-bold' : 'text-foreground font-semibold'
                  }`}
                >
                  <Icon className="w-6 h-6 shrink-0" />
                  <span className="text-xl leading-tight">{item.label}</span>
                </button>
              );
            })}
          </div>

          {/* ── Secondary items ───────────────────────────────────────────────── */}
          <div className="border-t border-border pt-2 pb-2">
            <p className="px-5 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">More</p>
            {secondaryItems.map((item) => {
              const Icon = item.icon;
              const isActive = location.pathname === item.path;
              return (
                <button
                  key={item.path + item.label}
                  onClick={() => goTo(item.path, item.requireAuth)}
                  className={`flex items-center gap-3 w-full px-5 py-2.5 text-left transition-colors hover:bg-muted/50 text-sm ${
                    isActive ? 'text-primary font-semibold' : 'text-foreground'
                  }`}
                >
                  <Icon className="w-4.5 h-4.5 shrink-0" />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>

          {/* ── Premium banner ─────────────────────────────────────────────────── */}
          {user && (
            <div className="mx-4 my-3 bg-gradient-to-br from-purple-500/10 to-pink-500/10 rounded-xl p-4 border border-purple-500/20">
              <Crown className="w-7 h-7 text-purple-500 mb-1.5" />
              <h3 className="font-bold text-sm mb-0.5">Upgrade to Premium</h3>
              <p className="text-xs text-muted-foreground mb-3">Get verified and unlock exclusive features</p>
              <Button
                onClick={() => closeAnd(() => navigate('/premium'))}
                size="sm"
                className="w-full bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600"
              >
                Get Premium
              </Button>
            </div>
          )}
        </nav>

        {/* ── Bottom auth / logout ──────────────────────────────────────────── */}
        <div className="p-4 border-t border-border shrink-0">
          {user ? (
            <button
              onClick={handleLogout}
              className="flex items-center gap-3 w-full p-3 hover:bg-destructive/10 text-destructive rounded-lg text-left font-semibold transition-colors"
            >
              <LogOut className="w-5 h-5" />
              <span>Log out</span>
            </button>
          ) : (
            <Button onClick={() => closeAnd(() => navigate('/auth'))} className="w-full rounded-full font-semibold">
              Sign in
            </Button>
          )}
        </div>
          </aside>
        </div>
      )}
    </>
  );
}
