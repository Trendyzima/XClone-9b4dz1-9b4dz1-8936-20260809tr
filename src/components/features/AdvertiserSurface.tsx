import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { BadgeCheck, BarChart3, Check, ChevronRight, Loader2, Megaphone, Settings2, WalletCards, X } from 'lucide-react';

type Props = { variant: 'profile' | 'wallet' };

type Stats = {
  accountId: string | null;
  accountName: string | null;
  campaigns: number;
  activeCampaigns: number;
  fundedKes: number;
  paidPayments: number;
};

type FeatureKey = 'analytics' | 'monetization' | 'podcasts' | 'series' | 'achievements' | 'highlights' | 'social-links' | 'tips';

type FeatureDefinition = { key: FeatureKey; label: string; description: string };

const FEATURES: FeatureDefinition[] = [
  { key: 'analytics', label: 'Analytics', description: 'Profile and post performance' },
  { key: 'monetization', label: 'Monetization', description: 'Creator earnings tools' },
  { key: 'podcasts', label: 'Podcasts', description: 'Podcast profile tab' },
  { key: 'series', label: 'Series', description: 'Public series tab' },
  { key: 'achievements', label: 'Achievements', description: 'Creator achievement badges' },
  { key: 'highlights', label: 'Story Highlights', description: 'Profile story highlights' },
  { key: 'social-links', label: 'Social Links', description: 'External social profiles' },
  { key: 'tips', label: 'Tips', description: 'Tip history and support tools' },
];

const DEFAULT_FEATURES: Record<FeatureKey, boolean> = {
  analytics: true,
  monetization: true,
  podcasts: true,
  series: true,
  achievements: true,
  highlights: true,
  'social-links': true,
  tips: true,
};

const EMPTY: Stats = {
  accountId: null,
  accountName: null,
  campaigns: 0,
  activeCampaigns: 0,
  fundedKes: 0,
  paidPayments: 0,
};

function moneyKes(value: number) {
  return `KES ${Math.round(value).toLocaleString()}`;
}

function ProfileFeatureRail() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [features, setFeatures] = useState<Record<FeatureKey, boolean>>(DEFAULT_FEATURES);
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<FeatureKey | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!user) { setLoading(false); return; }
      const { data, error } = await supabase.from('profiles').select('profile_features').eq('id', user.id).maybeSingle();
      if (!cancelled) {
        if (!error) setFeatures({ ...DEFAULT_FEATURES, ...((data?.profile_features ?? {}) as Partial<Record<FeatureKey, boolean>>) });
        setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [user]);

  const toggleFeature = async (key: FeatureKey) => {
    if (!user || savingKey) return;
    const previous = features;
    const next = { ...features, [key]: !features[key] };
    setFeatures(next);
    setSavingKey(key);
    const { error } = await supabase.from('profiles').update({ profile_features: next }).eq('id', user.id);
    setSavingKey(null);
    if (error) {
      setFeatures(previous);
      return;
    }
    window.dispatchEvent(new CustomEvent('testagram:profile-features-updated', { detail: next }));
  };

  if (!user) return null;

  return (
    <>
      <div data-profile-feature-rail className="fixed right-3 top-24 z-[120] flex flex-col items-end gap-2 pointer-events-none">
        {open && (
          <div className="pointer-events-auto w-[min(21rem,calc(100vw-1.5rem))] rounded-2xl border border-border bg-background/95 shadow-2xl backdrop-blur-md overflow-hidden">
            <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border">
              <div>
                <p className="text-sm font-bold">Profile Features</p>
                <p className="text-[10px] text-muted-foreground">Changes save to your profile</p>
              </div>
              <button onClick={() => setOpen(false)} className="p-1.5 rounded-full hover:bg-muted" aria-label="Close profile features">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="max-h-[min(70vh,34rem)] overflow-y-auto p-2">
              {loading ? (
                <div className="flex items-center justify-center gap-2 py-8 text-xs text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" />Loading features…</div>
              ) : FEATURES.map(feature => {
                const enabled = features[feature.key];
                const saving = savingKey === feature.key;
                return (
                  <button
                    key={feature.key}
                    type="button"
                    onClick={() => toggleFeature(feature.key)}
                    disabled={savingKey !== null}
                    className="w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-muted/70 disabled:opacity-60 transition-colors"
                    aria-pressed={enabled}
                  >
                    <span className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${enabled ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`}>
                      {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : enabled ? <Check className="w-4 h-4" /> : <span className="w-1.5 h-1.5 rounded-full bg-current" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs font-bold">{feature.label}</span>
                      <span className="block text-[10px] text-muted-foreground truncate">{feature.description}</span>
                    </span>
                    <span className={`text-[10px] font-bold ${enabled ? 'text-primary' : 'text-muted-foreground'}`}>{enabled ? 'ON' : 'OFF'}</span>
                  </button>
                );
              })}
            </div>
            <div className="border-t border-border p-2">
              <button onClick={() => navigate('/profile-features')} className="w-full flex items-center justify-between rounded-xl px-3 py-2.5 text-xs font-semibold hover:bg-muted transition-colors">
                <span className="flex items-center gap-2"><Settings2 className="w-3.5 h-3.5" />Open full settings</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}
        <button
          type="button"
          onClick={() => setOpen(value => !value)}
          className="pointer-events-auto inline-flex items-center gap-2 rounded-full border border-primary/25 bg-background/95 px-3 py-2 text-xs font-bold text-primary shadow-lg backdrop-blur-md hover:bg-primary/5 transition-colors"
          aria-expanded={open}
          aria-label="Open profile features"
        >
          <Settings2 className="w-4 h-4" />
          <span className="hidden sm:inline">Features</span>
        </button>
      </div>
      <style>{`body:has([data-profile-feature-rail]) .border-b.border-border > .px-4.pb-4 > .flex.justify-between.items-start.-mt-16.mb-4 > [class~="gap-2.5"] > button:nth-child(2){display:none}`}</style>
    </>
  );
}

export function AdvertiserSurface({ variant }: Props) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [stats, setStats] = useState<Stats>(EMPTY);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!user) {
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const { data: account } = await supabase
          .from('testagram_ad_accounts')
          .select('id,name')
          .eq('owner_user_id', user.id)
          .order('created_at', { ascending: true })
          .limit(1)
          .maybeSingle();

        if (!account) {
          if (!cancelled) setStats(EMPTY);
          return;
        }

        const [{ data: campaigns }, { data: payments }] = await Promise.all([
          supabase
            .from('testagram_ad_campaigns')
            .select('id,status,funded_micros')
            .eq('ad_account_id', account.id),
          supabase
            .from('testagram_ad_payments')
            .select('id,amount_kes,status')
            .eq('user_id', user.id)
            .eq('status', 'completed')
            .order('created_at', { ascending: false })
            .limit(100),
        ]);

        if (cancelled) return;
        const campaignRows = campaigns ?? [];
        const paymentRows = payments ?? [];
        setStats({
          accountId: account.id,
          accountName: account.name ?? 'Testagram Ads',
          campaigns: campaignRows.length,
          activeCampaigns: campaignRows.filter(c => c.status === 'active').length,
          fundedKes: campaignRows.reduce((sum, c) => sum + Number(c.funded_micros ?? 0) / 1_000_000, 0),
          paidPayments: paymentRows.length,
        });
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [user]);

  if (!user) return null;

  if (variant === 'profile') {
    return (
      <>
        <ProfileFeatureRail />
        <section className="rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/10 via-card to-card p-5 space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary/15 flex items-center justify-center shrink-0">
                <Megaphone className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="font-bold">Advertise on Testagram</p>
                <p className="text-xs text-muted-foreground mt-0.5">Create and fund campaigns from your Testagram account.</p>
              </div>
            </div>
            {stats.accountId && <BadgeCheck className="w-5 h-5 text-primary shrink-0" />}
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-xl bg-background/70 border border-border p-3"><p className="text-[10px] text-muted-foreground">Campaigns</p><p className="text-lg font-black mt-1">{stats.campaigns}</p></div>
            <div className="rounded-xl bg-background/70 border border-border p-3"><p className="text-[10px] text-muted-foreground">Active</p><p className="text-lg font-black mt-1">{stats.activeCampaigns}</p></div>
            <div className="rounded-xl bg-background/70 border border-border p-3"><p className="text-[10px] text-muted-foreground">Funded</p><p className="text-sm font-black mt-2">{moneyKes(stats.fundedKes)}</p></div>
          </div>
          <Button className="w-full" onClick={() => navigate('/create-ad')}>
            <Megaphone className="w-4 h-4 mr-2" /> {stats.accountId ? 'Create another ad' : 'Create your first ad'}
          </Button>
        </section>
      </>
    );
  }

  return (
    <section className="rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/10 via-card to-card p-5 space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/15 flex items-center justify-center"><Megaphone className="w-5 h-5 text-primary" /></div>
          <div><p className="font-bold">Testagram Advertising</p><p className="text-xs text-muted-foreground">Campaign funding and payment activity</p></div>
        </div>
        {stats.accountId ? <span className="text-xs font-semibold text-primary">{stats.accountName}</span> : <span className="text-xs text-muted-foreground">No ad account yet</span>}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <div className="rounded-xl bg-background/70 border border-border p-3"><p className="text-[10px] text-muted-foreground">Campaigns</p><p className="text-lg font-black">{stats.campaigns}</p></div>
        <div className="rounded-xl bg-background/70 border border-border p-3"><p className="text-[10px] text-muted-foreground">Active</p><p className="text-lg font-black">{stats.activeCampaigns}</p></div>
        <div className="rounded-xl bg-background/70 border border-border p-3"><p className="text-[10px] text-muted-foreground">Funded</p><p className="text-sm font-black mt-1">{moneyKes(stats.fundedKes)}</p></div>
        <div className="rounded-xl bg-background/70 border border-border p-3"><p className="text-[10px] text-muted-foreground">Paid payments</p><p className="text-lg font-black">{stats.paidPayments}</p></div>
      </div>
      <div className="flex gap-2">
        <Button className="flex-1" onClick={() => navigate('/create-ad')}><Megaphone className="w-4 h-4 mr-2" />Create Ad</Button>
        <Button variant="outline" onClick={() => navigate('/my-ads')}><BarChart3 className="w-4 h-4 mr-2" />My Ads</Button>
      </div>
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground"><WalletCards className="w-3.5 h-3.5" /> Advertising payments use the canonical Testagram ad-payment ledger.</div>
    </section>
  );
}
