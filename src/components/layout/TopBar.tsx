import { useAuth } from '@/hooks/useAuth';
import { useNavigate, useLocation } from 'react-router-dom';
import { ArrowLeft, Settings } from 'lucide-react';
import { ThemeToggle } from './ThemeToggle';
import { MobileSidebarDrawer } from './MobileSidebarDrawer';
import { CrossSurfaceNav } from './CrossSurfaceNav';
import { CommunityAdminOverlay } from '@/components/features/CommunityAdminOverlay';

interface TopBarProps {
  title: string;
  showProfile?: boolean;
  showBack?: boolean;
  onBack?: () => void;
  showSettings?: boolean;
}

const CROSS_SURFACE_PATHS = ['/', '/explore', '/search', '/hashtags', '/hashtag/', '/discover', '/communities', '/c/', '/spaces', '/space-recording/', '/trending/', '/challenge/', '/threads', '/thread/', '/videos', '/shorts', '/marketplace', '/shop', '/polls', '/podcasts/search'];

function shouldShowCrossSurfaceNav(pathname: string) {
  return CROSS_SURFACE_PATHS.some(root =>
    root === '/' ? pathname === '/' : pathname.startsWith(root)
  );
}

export function TopBar({ title, showProfile = true, showBack = false, onBack, showSettings = false }: TopBarProps) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const isHome = location.pathname === '/';
  const showCrossSurfaceNav = shouldShowCrossSurfaceNav(location.pathname);
  const isCommunity = location.pathname.startsWith('/c/');

  return (
    <div className="sticky top-0 z-40 tg-rigid-shell">
      <div className="tg-topbar border-b border-border/70" style={{ marginTop: "env(safe-area-inset-top, 0px)" }}>
      <div className="flex items-center justify-between px-4 h-16 sm:px-5">
        <div className="lg:hidden">
          <MobileSidebarDrawer />
        </div>

        <div className="flex items-center space-x-3">
          {showBack && (
            <button onClick={() => (onBack ? onBack() : navigate(-1))} className="tg-focus tg-touch-control p-2.5 rounded-full hover:bg-muted" aria-label="Go back">
              <ArrowLeft className="w-5 h-5" />
            </button>
          )}
          {isHome ? (
            <div className="flex items-center gap-2">
              <img src="/tsocial-logo.png" alt="Testagram" className="w-9 h-9 rounded-xl object-cover ring-1 ring-border shadow-sm" />
              <span className="text-xl font-bold bg-gradient-to-r from-primary to-emerald-500 bg-clip-text text-transparent">Testagram</span>
            </div>
          ) : (
            <h1 className="text-lg sm:text-xl font-black tracking-tight">{title}</h1>
          )}
        </div>
        
        <div className="flex items-center space-x-2">
          <ThemeToggle />
          
          {showSettings && (
            <button className="tg-focus tg-touch-control p-2.5 rounded-full hover:bg-muted" aria-label="Settings">
              <Settings className="w-5 h-5" />
            </button>
          )}
          {showProfile && user && (
            <div
              className="tg-focus tg-touch-control w-9 h-9 rounded-full bg-muted cursor-pointer overflow-hidden ring-2 ring-background ring-offset-1 ring-offset-border"
              onClick={() => navigate(`/profile/${user.username}`)}
              role="button"
              tabIndex={0}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') navigate(`/profile/${user.username}`); }}
              aria-label={`Open @${user.username} profile`}
            >
              {user.avatar ? (
                <img src={user.avatar} alt={user.username} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-xs font-bold">
                  {user.username[0].toUpperCase()}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      {showCrossSurfaceNav && <CrossSurfaceNav />}
      {isCommunity && <CommunityAdminOverlay />}
      </div>
    </div>
  );
}
