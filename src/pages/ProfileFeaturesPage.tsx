import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, BarChart3, BookOpen, Check, ChevronRight, Eye, Gift, Globe2, LayoutGrid, Mic2, Settings2, Sparkles, Star, Wallet, X } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import AccountPrivacyPage from '@/pages/AccountPrivacyPage';

type Feature = { key: string; title: string; description: string; icon: typeof Sparkles; group: string; };

const DEFAULT_SETTINGS: Record<string, boolean> = {
  analytics: true,
  monetization: true,
  podcasts: true,
  series: true,
  achievements: true,
  highlights: true,
  'social-links': true,
  tips: true,
};

const FEATURES: Feature[] = [
  { key: 'analytics', title: 'Analytics', description: 'Show profile and content performance tools to the owner.', icon: BarChart3, group: 'Creator' },
  { key: 'monetization', title: 'Monetization', description: 'Expose subscriptions, tips and earnings tools when wanted.', icon: Wallet, group: 'Creator' },
  { key: 'podcasts', title: 'Podcasts', description: 'Show your podcast presence as an optional profile destination.', icon: Mic2, group: 'Content' },
  { key: 'series', title: 'Series', description: 'Keep serialized content available without adding permanent clutter.', icon: BookOpen, group: 'Content' },
  { key: 'achievements', title: 'Achievements', description: 'Display creator milestones and badges on your profile.', icon: Star, group: 'Profile' },
  { key: 'highlights', title: 'Story Highlights', description: 'Show saved story collections beneath your profile header.', icon: Eye, group: 'Profile' },
  { key: 'social-links', title: 'Social Links', description: 'Display external social profiles in a compact row.', icon: Globe2, group: 'Profile' },
  { key: 'tips', title: 'Tips', description: 'Let visitors discover the tipping action from your profile.', icon: Gift, group: 'Engagement' },
];

export default function ProfileFeaturesPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const [settings, setSettings] = useState<Record<string, boolean>>(DEFAULT_SETTINGS);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!user) { setLoading(false); return; }
      const { data, error } = await supabase
        .from('profiles')
        .select('profile_features')
        .eq('id', user.id)
        .maybeSingle();
      if (cancelled) return;
      if (error) toast.error('Could not load profile feature settings');
      else setSettings({ ...DEFAULT_SETTINGS, ...(data?.profile_features ?? {}) });
      setLoading(false);
    };
    void load();
    return () => { cancelled = true; };
  }, [user]);

  const visibleFeatures = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return FEATURES;
    return FEATURES.filter(f => `${f.title} ${f.description} ${f.group}`.toLowerCase().includes(q));
  }, [query]);

  const toggle = async (key: string) => {
    if (!user || saving) return;
    const next = { ...settings, [key]: !settings[key] };
    const previous = settings;
    setSettings(next);
    setSaving(true);
    const { error } = await supabase.from('profiles').update({ profile_features: next }).eq('id', user.id);
    setSaving(false);
    if (error) {
      setSettings(previous);
      toast.error('Could not save that feature setting');
      return;
    }
    toast.success(`${FEATURES.find(f => f.key === key)?.title ?? 'Feature'} ${next[key] ? 'enabled' : 'disabled'}`);
  };

  const enabledCount = FEATURES.filter(f => settings[f.key]).length;

  if (searchParams.get('section') === 'account') return <AccountPrivacyPage />;

  if (!user) {
    return <div className="min-h-screen bg-background flex items-center justify-center px-4"><div className="text-center"><h1 className="font-bold text-lg">Sign in to manage profile features</h1><button onClick={() => navigate('/auth')} className="mt-4 px-5 py-2 rounded-full bg-primary text-primary-foreground font-semibold">Sign in</button></div></div>;
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-20 border-b border-border/70 bg-background/90 backdrop-blur-xl">
        <div className="max-w-2xl mx-auto px-4 h-14 flex items-center gap-3">
          <button onClick={() => navigate(-1)} aria-label="Back" className="w-9 h-9 rounded-full hover:bg-muted flex items-center justify-center transition-colors"><ArrowLeft className="w-5 h-5" /></button>
          <div className="min-w-0 flex-1"><h1 className="font-bold text-base">Profile features</h1><p className="text-[11px] text-muted-foreground">Choose what appears on your profile</p></div>
          <div className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-primary/10 text-primary">{enabledCount} enabled</div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-5 pb-12">
        <section className="rounded-3xl border border-border bg-gradient-to-br from-primary/10 via-background to-background p-5 mb-5 shadow-sm">
          <div className="flex items-start gap-3"><div className="w-11 h-11 rounded-2xl bg-primary/10 flex items-center justify-center shrink-0"><LayoutGrid className="w-5 h-5 text-primary" /></div><div className="min-w-0"><h2 className="font-bold text-lg">Keep your profile clean</h2><p className="text-sm text-muted-foreground mt-1 leading-5">Turn optional features on when you want them. Your main profile stays focused, spacious and easy to scan.</p></div></div>
          <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground"><Check className="w-3.5 h-3.5 text-primary" /> Settings are saved to your profile.</div>
        </section>

        <section className="rounded-3xl border border-border bg-background p-4 mb-5 shadow-sm">
          <div className="flex items-start gap-3"><div className="w-10 h-10 rounded-2xl bg-muted flex items-center justify-center shrink-0"><Globe2 className="w-4 h-4 text-primary" /></div><div className="min-w-0 flex-1"><h2 className="font-bold text-sm">Fediverse</h2><p className="text-xs text-muted-foreground mt-1">Open Testagram's existing federated timeline, ActivityPub identity and remote-network tools.</p></div><button onClick={() => navigate('/fediverse')} className="shrink-0 px-3 py-2 rounded-xl bg-foreground text-background text-xs font-bold hover:opacity-90">Open</button></div>
        </section>

        <section className="rounded-3xl border border-border bg-background p-4 mb-5 shadow-sm">
          <div className="flex items-start gap-3"><div className="w-10 h-10 rounded-2xl bg-muted flex items-center justify-center shrink-0"><Settings2 className="w-4 h-4" /></div><div className="min-w-0 flex-1"><h2 className="font-bold text-sm">Privacy & Account</h2><p className="text-xs text-muted-foreground mt-1">Appearance and profile modules are separate from account security, deactivation and permanent deletion.</p></div><button onClick={() => navigate('/profile-features?section=account')} className="shrink-0 px-3 py-2 rounded-xl bg-foreground text-background text-xs font-bold hover:opacity-90">Manage</button></div>
        </section>

        <div className="relative mb-5"><Settings2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search profile features" className="w-full h-11 rounded-2xl border border-border bg-muted/30 pl-10 pr-10 text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40" />{query && <button onClick={() => setQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"><X className="w-4 h-4" /></button>}</div>

        {loading ? <div className="py-16 text-center text-sm text-muted-foreground">Loading your profile settings…</div> : <div className="space-y-5">
          {Array.from(new Set(visibleFeatures.map(f => f.group))).map(group => <section key={group}><div className="px-1 mb-2 text-[11px] font-black uppercase tracking-wider text-muted-foreground">{group}</div><div className="rounded-3xl border border-border overflow-hidden bg-background shadow-sm divide-y divide-border/70">{visibleFeatures.filter(f => f.group === group).map(feature => { const Icon = feature.icon; const enabled = !!settings[feature.key]; return <div key={feature.key} className="flex items-center gap-3 p-4 hover:bg-muted/20 transition-colors"><div className={`w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 ${enabled ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`}><Icon className="w-4 h-4" /></div><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><h3 className="text-sm font-bold truncate">{feature.title}</h3>{enabled && <span className="text-[9px] font-black uppercase tracking-wide text-primary">On</span>}</div><p className="text-xs text-muted-foreground mt-0.5 leading-4">{feature.description}</p></div><button disabled={saving} role="switch" aria-checked={enabled} aria-label={`${enabled ? 'Disable' : 'Enable'} ${feature.title}`} onClick={() => void toggle(feature.key)} className={`relative shrink-0 w-12 h-7 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-60 ${enabled ? 'bg-primary' : 'bg-muted-foreground/25'}`}><span className={`absolute top-1 w-5 h-5 rounded-full bg-white shadow-sm transition-transform ${enabled ? 'translate-x-6' : 'translate-x-1'}`} /></button></div>; })}</div></section>)}
        </div>}

        {!loading && visibleFeatures.length === 0 && <div className="py-16 text-center text-sm text-muted-foreground">No profile features match “{query}”.</div>}
        <button onClick={() => { toast.success('Profile feature settings saved'); navigate(-1); }} className="mt-6 w-full h-11 rounded-2xl bg-foreground text-background font-bold text-sm hover:opacity-90 transition-opacity flex items-center justify-center gap-2">Done <ChevronRight className="w-4 h-4" /></button>
      </main>
    </div>
  );
}