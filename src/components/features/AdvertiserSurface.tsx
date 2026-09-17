import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { BadgeCheck, BarChart3, Loader2, Megaphone, WalletCards } from 'lucide-react';

type Props = { variant: 'profile' | 'wallet' };

type Stats = {
  accountId: string | null;
  accountName: string | null;
  campaigns: number;
  activeCampaigns: number;
  fundedKes: number;
  paidPayments: number;
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

  if (loading) {
    return (
      <div className="rounded-2xl border border-border bg-card p-4 flex items-center gap-3">
        <Loader2 className="w-4 h-4 animate-spin text-primary" />
        <span className="text-sm text-muted-foreground">Loading advertising account…</span>
      </div>
    );
  }

  if (variant === 'profile') {
    return (
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
