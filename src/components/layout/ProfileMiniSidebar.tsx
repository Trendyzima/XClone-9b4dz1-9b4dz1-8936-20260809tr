import { useNavigate } from 'react-router-dom';
import { User, FileText, Image, Video, Heart, MessageSquare, Users, UserPlus, BarChart3, Settings, Share2 } from 'lucide-react';

const ITEMS = [
  ['Posts','posts',FileText],['Threads','threads',MessageSquare],['Replies','replies',MessageSquare],
  ['Media','media',Image],['Videos','videos',Video],['Likes','likes',Heart],
  ['Followers','followers',Users],['Following','following',UserPlus],['Analytics','analytics',BarChart3],
] as const;

export function ProfileMiniSidebar({ username, active }: { username: string; active: string }) {
  const navigate = useNavigate();
  const base = '/profile/' + encodeURIComponent(username);
  const share = async () => { const url = window.location.href; if (navigator.share) { try { await navigator.share({ title: `@${username} on Testagram`, url }); return; } catch {} } try { await navigator.clipboard.writeText(url); } catch {} };
  return (
    <aside aria-label="Profile navigation" className="sticky top-14 z-10 border-b border-border bg-background/90 backdrop-blur-xl shadow-sm">
      <div className="mx-auto max-w-6xl px-3 py-2">
        <div className="flex items-center gap-1 overflow-x-auto scrollbar-none snap-x" role="tablist" aria-label={`@${username} profile sections`}>
          <button onClick={() => navigate(base)} aria-current={active === "Posts" ? "page" : undefined} aria-label="Profile overview"
            className="shrink-0 inline-flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-bold hover:bg-muted transition-colors">
            <User className="h-4 w-4" /> Overview
          </button>
          {ITEMS.map(([label, key, Icon]) => (
            <button key={key} onClick={() => navigate(base + '/' + key)}
              aria-current={active === label ? 'page' : undefined}
              className={`shrink-0 inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold transition-colors ${active === label ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`}>
              <Icon className="h-3.5 w-3.5" /> {label}
            </button>
          ))}
          <button onClick={() => void share()}
            className="shrink-0 inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50">
            <Share2 className="h-3.5 w-3.5" /> Share
          </button>
          <span className="sr-only">@handle is permanent and owned by its account.</span>
        </div>
      </div>
    </aside>
  );
}
