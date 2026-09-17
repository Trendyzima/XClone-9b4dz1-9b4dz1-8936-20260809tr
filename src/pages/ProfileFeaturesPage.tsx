import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, BarChart3, BookOpen, Check, ChevronRight, Eye, Gift, Globe2, Heart, LayoutGrid, Megaphone, Mic2, Settings2, Sparkles, Star, ToggleLeft, Wallet, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

// Profile feature registry. This first pass intentionally uses localStorage so the
// UX can be validated without changing the canonical profile/database schema.
const STORAGE_KEY = 'testagram-profile-feature-settings-v1';

type Feature = {
  key: string;
  title: string;
  description: string;
  icon: typeof Sparkles;
  group: string;
  defaultEnabled?: boolean;
};

const FEATURES: Feature[] = [
  { key: 'creator-tools', title: 'Creator Tools', description: 'Keep creator utilities one tap away without crowding your profile.', icon: Sparkles, group: 'Creator', defaultEnabled: true },
  { key: 'analytics', title: 'Analytics', description: 'Show profile and content performance tools to the owner.', icon: BarChart3, group: 'Creator' },
  { key: 'monetization', title: 'Monetization', description: 'Expose subscriptions, tips and earnings tools when wanted.', icon: Wallet, group: 'Creator' },
  { key: 'podcasts', title: 'Podcasts', description: 'Show your podcast presence as an optional profile destination.', icon: Mic2, group: 'Content' },
  { key: 'series', title: 'Series', description: 'Keep serialized content available without adding another permanent row.', icon: BookOpen, group: 'Content' },
  { key: 'achievements', title: 'Achievements', description: 'Display creator milestones and badges on your profile.', icon: Star, group: 'Profile' },
  { key: 'highlights', title: 'Story Highlights', description: 'Show saved story collections beneath your profile header.', icon: Eye, group: 'Profile', defaultEnabled: true },
  { key: 'social-links', title: 'Social Links', description: 'Display external social profiles in a compact row.', icon: Globe2, group: 'Profile' },
  { key: 'tips', title: 'Tips', description: 'Let visitors discover the tipping action from your profile.', icon: Gift, group: 'Engagement' },
  { key: 'promotions', title: 'Promotions', description: 'Keep promotional and boost tools available without permanent clutter.', icon: Megaphone, group: 'Growth' },
  { key: 'community', title: 'Community', description: 'Expose community-related profile tools when you want them visible.', icon: Heart, group: 'Engagement' },
];

function loadSettings(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* fall back to defaults */ }
  return Object.fromEntries(FEATURES.map(f => [f.key, !!f.defaultEnabled]));
}

export default function ProfileFeaturesPage() {
  const navigate = useNavigate();
  const [settings, setSettings] = useState<Record<string, boolean>>(loadSettings);
  const [query, setQuery] = useState('');

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  }, [settings]);

  const visibleFeatures = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return FEATURES;
    return FEATURES.filter(f => `${f.title} ${f.description} ${f.group}`.toLowerCase().includes(q));
  }, [query]);

  const toggle = (key: string) => {
    setSettings(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const enabledCount = FEATURES.filter(f => settings[f.key]).length;

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-20 border-b border-border/70 bg-background/90 backdrop-blur-xl">
        <div className="max-w-2xl mx-auto px-4 h-14 flex items-center gap-3">
          <button onClick={() => navigate(-1)} aria-label="Back" className="w-9 h-9 rounded-full hover:bg-muted flex items-center justify-center transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="font-bold text-base">Profile features</h1>
            <p className="text-[11px] text-muted-foreground">Choose what appears on your profile</p>
          </div>
          <div className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-primary/10 text-primary">{enabledCount} enabled</div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-5 pb-12">
        <section className="rounded-3xl border border-border bg-gradient-to-br from-primary/10 via-background to-background p-5 mb-5 shadow-sm">
          <div className="flex items-start gap-3">
            <div className="w-11 h-11 rounded-2xl bg-primary/10 flex items-center justify-center shrink-0">
              <LayoutGrid className="w-5 h-5 text-primary" />
            </div>
            <div className="min-w-0">
              <h2 className="font-bold text-lg">Keep your profile clean</h2>
              <p className="text-sm text-muted-foreground mt-1 leading-5">Turn optional features on when you want them. Your main profile stays focused, spacious and easy to scan.</p>
            </div>
          </div>
          <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
            <Check className="w-3.5 h-3.5 text-primary" /> Changes are saved automatically on this prototype page.
          </div>
        </section>

        <div className="relative mb-5">
          <Settings2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search profile features" className="w-full h-11 rounded-2xl border border-border bg-muted/30 pl-10 pr-10 text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40" />
          {query && <button onClick={() => setQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"><X className="w-4 h-4" /></button>}
        </div>

        <div className="space-y-5">
          {Array.from(new Set(visibleFeatures.map(f => f.group))).map(group => (
            <section key={group}>
              <div className="px-1 mb-2 text-[11px] font-black uppercase tracking-wider text-muted-foreground">{group}</div>
              <div className="rounded-3xl border border-border overflow-hidden bg-background shadow-sm divide-y divide-border/70">
                {visibleFeatures.filter(f => f.group === group).map(feature => {
                  const Icon = feature.icon;
                  const enabled = !!settings[feature.key];
                  return (
                    <div key={feature.key} className="flex items-center gap-3 p-4 hover:bg-muted/20 transition-colors">
                      <div className={`w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 ${enabled ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`}>
                        <Icon className="w-4.5 h-4.5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <h3 className="text-sm font-bold truncate">{feature.title}</h3>
                          {enabled && <span className="text-[9px] font-black uppercase tracking-wide text-primary">On</span>}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5 leading-4">{feature.description}</p>
                      </div>
                      <button role="switch" aria-checked={enabled} aria-label={`${enabled ? 'Disable' : 'Enable'} ${feature.title}`} onClick={() => toggle(feature.key)} className={`relative shrink-0 w-12 h-7 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 ${enabled ? 'bg-primary' : 'bg-muted-foreground/25'}`}>
                        <span className={`absolute top-1 w-5 h-5 rounded-full bg-white shadow-sm transition-transform ${enabled ? 'translate-x-6' : 'translate-x-1'}`} />
                      </button>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>

        {visibleFeatures.length === 0 && <div className="py-16 text-center text-sm text-muted-foreground">No profile features match “{query}”.</div>}

        <button onClick={() => { toast.success('Profile feature settings saved'); navigate(-1); }} className="mt-6 w-full h-11 rounded-2xl bg-foreground text-background font-bold text-sm hover:opacity-90 transition-opacity flex items-center justify-center gap-2">
          Done <ChevronRight className="w-4 h-4" />
        </button>
      </main>
    </div>
  );
}
