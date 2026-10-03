import { useNavigate, useLocation } from 'react-router-dom';
import { Shield, FileText, Scale, Flag } from 'lucide-react';

const ITEMS = [
  ['/privacy','Privacy'],['/terms','Terms'],['/policy','Content policy'],['/appeals','Appeals'],
] as const;

export function LegalMiniSidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  return (
    <nav aria-label="Legal navigation" className="sticky top-14 z-10 border-b border-border bg-background/90 backdrop-blur-xl shadow-sm">
      <div className="mx-auto max-w-3xl px-3 py-2">
        <div className="flex items-center gap-1 overflow-x-auto scrollbar-none snap-x">
          {ITEMS.map(([href,label]) => (
            <button key={href} onClick={() => navigate(href)} aria-current={location.pathname === href || location.pathname.startsWith(href + '/') ? 'page' : undefined}
              className={`shrink-0 inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold transition-colors ${location.pathname === href ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`}>
              {href === '/privacy' ? <Shield className="h-3.5 w-3.5"/> : href === '/terms' ? <FileText className="h-3.5 w-3.5"/> : href === '/policy' ? <Scale className="h-3.5 w-3.5"/> : <Flag className="h-3.5 w-3.5"/>}
              {label}
            </button>
          ))}
        </div>
      </div>
    </nav>
  );
}
