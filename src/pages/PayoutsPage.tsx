import { useEffect, useState } from 'react';
import { useSEO } from '@/hooks/useSEO';
import { TopBar } from '@/components/layout/TopBar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { AlertCircle, CheckCircle2, Clock, DollarSign, Loader2, Phone, Wallet, XCircle } from 'lucide-react';
import { PageAdBanner } from '@/components/features/AdSenseAd';

const MIN_PAYOUT_KES = 10;
const MAX_PAYOUT_KES = 150000;

type Payout = {
  id: string;
  amount_cents: number;
  currency: string;
  provider: string | null;
  provider_payout_id: string | null;
  destination: { phone?: string } | null;
  status: string;
  failure_reason: string | null;
  requested_at: string;
  processed_at: string | null;
};

export default function PayoutsPage() {
  useSEO({ noindex: true, title: 'Payouts', url: '/payouts' });
  const { user } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [monetized, setMonetized] = useState(false);
  const [currency, setCurrency] = useState('KES');
  const [availableCents, setAvailableCents] = useState(0);
  const [pendingCents, setPendingCents] = useState(0);
  const [lifetimeEarnedCents, setLifetimeEarnedCents] = useState(0);
  const [lifetimePaidCents, setLifetimePaidCents] = useState(0);
  const [userShare, setUserShare] = useState(0);
  const [platformShare, setPlatformShare] = useState(0);
  const [phone, setPhone] = useState('');
  const [amount, setAmount] = useState('');
  const [payouts, setPayouts] = useState<Payout[]>([]);

  useEffect(() => {
    if (!user) { navigate('/auth'); return; }
    void fetchData();
  }, [user, navigate]);

  const fetchData = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const [mon, account, revenue, history] = await Promise.all([
        supabase.from('user_monetization').select('is_monetized').eq('user_id', user.id).maybeSingle(),
        supabase.from('monetization_accounts').select('currency,available_cents,pending_cents,lifetime_earned_cents,lifetime_paid_cents').eq('user_id', user.id).maybeSingle(),
        supabase.from('revenue_shares').select('user_share,platform_share').eq('user_id', user.id).maybeSingle(),
        supabase.from('monetization_payouts').select('id,amount_cents,currency,provider,provider_payout_id,destination,status,failure_reason,requested_at,processed_at').eq('user_id', user.id).order('requested_at', { ascending: false }).limit(25),
      ]);

      if (mon.error) throw mon.error;
      if (account.error) throw account.error;
      if (revenue.error) throw revenue.error;
      if (history.error) throw history.error;

      setMonetized(Boolean(mon.data?.is_monetized));
      setCurrency(String(account.data?.currency || 'KES').toUpperCase());
      setAvailableCents(Number(account.data?.available_cents || 0));
      setPendingCents(Number(account.data?.pending_cents || 0));
      setLifetimeEarnedCents(Number(account.data?.lifetime_earned_cents || 0));
      setLifetimePaidCents(Number(account.data?.lifetime_paid_cents || 0));
      setUserShare(Number(revenue.data?.user_share || 0));
      setPlatformShare(Number(revenue.data?.platform_share || 0));
      setPayouts((history.data || []) as Payout[]);
    } catch (error) {
      console.error('PayoutsPage fetchData', error);
      toast.error('Unable to load payout data');
    } finally {
      setLoading(false);
    }
  };

  const handleMpesaWithdraw = async () => {
    if (!user) return;
    if (currency !== 'KES') {
      toast.error('M-Pesa payouts require a KES monetization account.');
      return;
    }

    const kes = Math.floor(Number(amount));
    const digits = phone.replace(/\D/g, '');
    const availableKes = Math.floor(availableCents / 100);

    if (!Number.isFinite(kes) || kes < MIN_PAYOUT_KES || kes > MAX_PAYOUT_KES) {
      toast.error(`Enter an amount from KES ${MIN_PAYOUT_KES.toLocaleString()} to KES ${MAX_PAYOUT_KES.toLocaleString()}.`);
      return;
    }
    if (kes * 100 > availableCents) {
      toast.error(`Available balance: KES ${availableKes.toLocaleString()}`);
      return;
    }
    if (digits.length < 9) {
      toast.error('Enter a valid M-Pesa number.');
      return;
    }

    setSubmitting(true);
    try {
      const idempotencyKey = `mpesa-${user.id}-${crypto.randomUUID()}`;
      const { data: payout, error: requestError } = await supabase.rpc('request_monetization_payout', {
        p_amount_cents: kes * 100,
        p_provider: 'mpesa',
        p_destination: { phone },
        p_idempotency_key: idempotencyKey,
      });
      if (requestError) throw requestError;
      if (!payout?.id) throw new Error('Payout reservation was not created');

      const { data: adapterData, error: adapterError } = await supabase.functions.invoke('creator-mpesa-payout', {
        body: { payout_id: payout.id },
      });
      if (adapterError) throw adapterError;
      if (!adapterData?.ok) throw new Error(adapterData?.error || 'M-Pesa payout could not be submitted');

      toast.success(`KES ${kes.toLocaleString()} payout reserved and submitted.`);
      setAmount('');
      await fetchData();
    } catch (error: any) {
      console.error('canonical creator payout', error);
      toast.error(error?.message || 'Payout failed');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin" /></div>;
  }

  if (!monetized) {
    return (
      <div className="min-h-screen bg-background">
        <TopBar title="Payouts" showBack />
        <div className="max-w-2xl mx-auto p-6 text-center py-20">
          <AlertCircle className="w-16 h-16 mx-auto mb-4 text-muted-foreground" />
          <h2 className="text-2xl font-bold mb-2">Monetization Not Enabled</h2>
          <p className="text-muted-foreground mb-6">Enable monetization before requesting a creator payout.</p>
          <Button onClick={() => navigate('/monetization')}>Go to Monetization</Button>
        </div>
      </div>
    );
  }

  const availableKes = Math.floor(availableCents / 100);
  const pendingKes = Math.floor(pendingCents / 100);
  const earnedKes = Math.floor(lifetimeEarnedCents / 100);
  const paidKes = Math.floor(lifetimePaidCents / 100);

  return (
    <div className="min-h-screen bg-background pb-16 md:pb-0">
      <TopBar title="Payouts & Revenue" showBack />
      <PageAdBanner />
      <div className="max-w-4xl mx-auto p-4 space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="border rounded-2xl p-5">
            <div className="flex items-center gap-2 mb-1"><Wallet className="w-5 h-5" /><span className="text-sm text-muted-foreground">Available</span></div>
            <p className="text-3xl font-bold">KES {availableKes.toLocaleString()}</p>
            <p className="text-xs text-muted-foreground mt-1">Ready for payout</p>
          </div>
          <div className="border rounded-2xl p-5">
            <div className="flex items-center gap-2 mb-1"><Clock className="w-5 h-5" /><span className="text-sm text-muted-foreground">Pending</span></div>
            <p className="text-3xl font-bold">KES {pendingKes.toLocaleString()}</p>
            <p className="text-xs text-muted-foreground mt-1">Awaiting release</p>
          </div>
          <div className="border rounded-2xl p-5">
            <div className="flex items-center gap-2 mb-1"><DollarSign className="w-5 h-5" /><span className="text-sm text-muted-foreground">Paid</span></div>
            <p className="text-3xl font-bold">KES {paidKes.toLocaleString()}</p>
            <p className="text-xs text-muted-foreground mt-1">Lifetime creator payouts</p>
          </div>
        </div>

        <div className="border rounded-2xl p-5 space-y-5">
          <div>
            <h2 className="text-xl font-semibold">M-Pesa creator payout</h2>
            <p className="text-sm text-muted-foreground">Requests reserve funds from the canonical monetization balance before M-Pesa submission.</p>
          </div>
          {currency !== 'KES' && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm">This account is denominated in {currency}. The canonical M-Pesa adapter intentionally requires KES; no client-side FX conversion is performed.</div>
          )}
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2"><Label htmlFor="mpesa-phone">M-Pesa number</Label><div className="relative"><Phone className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" /><Input id="mpesa-phone" className="pl-9" value={phone} onChange={e => setPhone(e.target.value)} placeholder="0712345678" disabled={submitting || currency !== 'KES'} /></div></div>
            <div className="space-y-2"><Label htmlFor="payout-amount">Amount (KES)</Label><Input id="payout-amount" type="number" min={MIN_PAYOUT_KES} max={MAX_PAYOUT_KES} value={amount} onChange={e => setAmount(e.target.value)} placeholder="1000" disabled={submitting || currency !== 'KES'} /></div>
          </div>
          <Button onClick={handleMpesaWithdraw} disabled={submitting || currency !== 'KES' || availableKes < MIN_PAYOUT_KES} className="w-full md:w-auto">
            {submitting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Processing…</> : 'Request M-Pesa payout'}
          </Button>
          <p className="text-xs text-muted-foreground">Limits: KES {MIN_PAYOUT_KES.toLocaleString()}–KES {MAX_PAYOUT_KES.toLocaleString()} per request. Available: KES {availableKes.toLocaleString()}.</p>
        </div>

        <div className="border rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4"><h2 className="text-xl font-semibold">Revenue</h2><span className="text-sm text-muted-foreground">Creator: {userShare.toFixed(2)} · Platform: {platformShare.toFixed(2)}</span></div>
          <p className="text-2xl font-bold">KES {earnedKes.toLocaleString()}</p>
          <p className="text-sm text-muted-foreground">Lifetime earnings recorded in the canonical monetization account.</p>
        </div>

        <div className="border rounded-2xl p-5">
          <h2 className="text-xl font-semibold mb-4">Payout history</h2>
          {payouts.length === 0 ? <p className="text-sm text-muted-foreground">No canonical payouts yet.</p> : <div className="space-y-3">{payouts.map(p => {
            const amountKes = Math.floor(Number(p.amount_cents) / 100);
            const icon = p.status === 'paid' ? <CheckCircle2 className="h-5 w-5" /> : p.status === 'failed' ? <XCircle className="h-5 w-5" /> : <Clock className="h-5 w-5" />;
            return <div key={p.id} className="flex items-center justify-between gap-3 border rounded-xl p-3"><div className="flex items-center gap-3">{icon}<div><p className="font-medium">KES {amountKes.toLocaleString()} · M-Pesa</p><p className="text-xs text-muted-foreground">{new Date(p.requested_at).toLocaleString()}</p></div></div><div className="text-right"><p className="text-sm capitalize">{p.status}</p>{p.failure_reason && <p className="text-xs text-destructive max-w-48 truncate">{p.failure_reason}</p>}</div></div>;
          })}</div>}
        </div>
      </div>
    </div>
  );
}
