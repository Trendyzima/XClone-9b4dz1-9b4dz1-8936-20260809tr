import { Hash, Home, Search, Users, FileText, Compass } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';

const SURFACES = [
  { label: 'Home', path: '/', icon: Home },
  { label: 'Explore', path: '/explore', icon: Compass },
  { label: 'Search', path: '/search', icon: Search },
  { label: 'Hashtags', path: '/hashtag/trending', icon: Hash },
  { label: 'Discover', path: '/discover', icon: Users },
  { label: 'Threads', path: '/threads', icon: FileText },
] as const;

const SURFACE_ROOTS = ['/', '/explore', '/search', '/hashtag/', '/discover', '/threads', '/thread/'];

export function CrossSurfaceNav() {
  const location = useLocation();
  const navigate = useNavigate();
  const activeRoot = SURFACE_ROOTS.find(root =>
    root === '/' ? location.pathname === '/' : location.pathname.startsWith(root)
  );

  return (
    <nav aria-label="Explore Testagram" className="border-b border-border bg-background/95 backdrop-blur overflow-x-auto scrollbar-hide">
      <div className="flex min-w-max px-2">
        {SURFACES.map(({ label, path, icon: Icon }) => {
          const root = path === '/' ? '/' : path;
          const active = path === '/'
            ? activeRoot === '/'
            : path === '/hashtag/trending'
              ? activeRoot === '/hashtag/'
              : activeRoot === root;
          return (
            <button
              key={label}
              type="button"
              onClick={() => navigate(path)}
              aria-current={active ? 'page' : undefined}
              className={`flex items-center gap-1.5 px-3.5 py-2.5 text-xs font-semibold border-b-2 transition-colors ${
                active
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/50'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
