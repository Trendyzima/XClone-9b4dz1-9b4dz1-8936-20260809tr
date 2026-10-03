import { useNavigate } from 'react-router-dom';
import { User, Palette, Bell, Shield, Link2, Settings } from 'lucide-react';

const ITEMS = [
  ['Account','account',User],['Appearance','appearance',Palette],['Notifications','notifications',Bell],
  ['Privacy & safety','privacy',Shield],['Connections','connections',Link2],
] as const;

export function SettingsMiniSidebar({ active }: { active: string }) {
  const navigate = useNavigate();
  return (
    <aside aria-label="Settings navigation" className="sticky top-14 z-10 border-b border-border bg-background/90 backdrop-blur-xl shadow-sm">
      <div className="mx-auto max-w-4xl px-3 py-2">
        <div className="flex items-center gap-1 overflow-x-auto scrollbar-none snap-x" role="tablist" aria-label="Settings sections">
          <button onClick={() => navigate('/settings')} className={`shrink-0 inline-flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-bold ${active === 'all' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}>
            <Settings className="h-4 w-4" /> All settings
          </button>
          {ITEMS.map(([label, key, Icon]) => (
            <button key={key} onClick={() => navigate('/settings/' + key)} aria-current={active === key ? 'page' : undefined}
              className={`shrink-0 inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold transition-colors ${active === key ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`}>
              <Icon className="h-3.5 w-3.5" /> {label}
            </button>
          ))}
        </div>
      </div>
    </aside>
  );
}
