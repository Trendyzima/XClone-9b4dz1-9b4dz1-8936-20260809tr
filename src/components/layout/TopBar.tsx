import { useAuth } from '@/hooks/useAuth';
import { useNavigate, useLocation } from 'react-router-dom';
import { ArrowLeft, Settings } from 'lucide-react';
import { ThemeToggle } from './ThemeToggle';
import { MobileSidebarDrawer } from './MobileSidebarDrawer';

interface TopBarProps {
  title: string;
  showProfile?: boolean;
  showBack?: boolean;
  onBack?: () => void;
  showSettings?: boolean;
}

export function TopBar({ title, showProfile = true, showBack = false, onBack, showSettings = false }: TopBarProps) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const isHome = location.pathname === '/';

  return (
    <div className="sticky top-0 z-40 bg-background/95 backdrop-blur-sm border-b border-border">
      <div className="flex items-center justify-between px-4 h-14">
        {/* Mobile Sidebar Drawer - Only visible on mobile */}
        <div className="lg:hidden">
          <MobileSidebarDrawer />
        </div>

        <div className="flex items-center space-x-3">
          {showBack && (
            <button onClick={() => (onBack ? onBack() : navigate(-1))} className="p-2 hover:bg-muted rounded-full">
              <ArrowLeft className="w-5 h-5" />
            </button>
          )}
          {isHome ? (
            <div className="flex items-center gap-2">
              <img src="/tsocial-logo.png" alt="Tsocial" className="w-8 h-8 rounded-lg object-cover" />
              <span className="text-xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">Tsocial</span>
            </div>
          ) : (
            <h1 className="text-xl font-bold">{title}</h1>
          )}
        </div>
        
        <div className="flex items-center space-x-2">
          {/* Theme Toggle */}
          <ThemeToggle />
          
          {showSettings && (
            <button className="p-2 hover:bg-muted rounded-full">
              <Settings className="w-5 h-5" />
            </button>
          )}
          {showProfile && user && (
            <div
              className="w-8 h-8 rounded-full bg-muted cursor-pointer overflow-hidden"
              onClick={() => navigate(`/profile/${user.username}`)}
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
    </div>
  );
}
