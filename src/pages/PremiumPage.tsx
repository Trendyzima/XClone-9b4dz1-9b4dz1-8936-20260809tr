import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Crown, Check, Loader2, Ban, Video, Sparkles, Volume2, Zap, BadgeCheck, Shield, X } from 'lucide-react';
import { toast } from 'sonner';
import { TopBar } from '@/components/layout/TopBar';
import { Button } from '@/components/ui/button';
import { PageAdBanner } from '@/components/features/AdSenseAd';
import { useAuth } from '@/hooks/useAuth';
import { usePremium } from '@/hooks/usePremium';
import { supabase } from '@/lib/supabase';
import { useSEO } from '@/hooks/useSEO';

const PLANS = {
  monthly: { label: 'Monthly', price: 4.99, period: 'month' },
  annual: { label: 'Annual', price: 39.99, period: 'year' },
} as const;

const FEATURES = [
  [Ban, 'Zero Ads', 'No feed or playback ads while Premium is active.'],
  [Crown, 'Premium Badge', 'A Premium identity badge on your account.'],
  [Video, 'HD Video Uploads', 'Higher-quality creator uploads.'],
  [Sparkles, 'AI Tools', 'Premium access to supported AI tools.'],
  [Volume2, 'Podcast Studio Pro', 'Premium audio-space capabilities.'],
  [Zap, 'Priority Feed', 'Premium feed enhancements where supported.'],
  [BadgeCheck, 'Verified Support', 'Priority support routing.'],
  [Shield, 'Advanced Privacy', 'Additional privacy controls as released.'],
] as const;

export default function PremiumPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { isActive, plan, expiresAt, loading, refresh } = usePremium();
  const [selectedPlan, setSelectedPlan] = useState<'monthly' | 'annual'>('annual');
  const [busy, setBusy] = useState(false);
  const [capturing, setCapturing] = useState(false);

  useSEO({ title: 'Testagram Premium', description: 'Testagram Premium', url: '/premium' });

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get('token');
    const paypalState = new URLSearchParams(window.location.search).get('paypal');
    if (!user || paypalState !== 'return' || !token || capturing) return;
    setCapturing(true);
    void (async () => {
      const { data, error } = await supabase.functions.invoke('premium-paypal-capture-order', { body: { orderId: token } });
      if (error || data?.error) toast.error(data?.error || error?.message || 'Premium payment could not be completed');
      else { toast.success('Premium activated successfully'); await refresh(); }
      window.history.replaceState({}, '', '/premium');
      setCapturing(false);
    })();
  }, [user?.id, capturing, refresh]);

  const subscribe = async () => {
    if (!user) { navigate('/auth'); return; }
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke('premium-paypal-create-order', { body: { plan: selectedPlan } });
      if (error || data?.error) throw new Error(data?.error || error?.message || 'Unable to start Premium checkout');
      if (!data?.approvalUrl) throw new Error('Payment approval URL was not returned');
      window.location.assign(data.approvalUrl);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to start Premium checkout');
      setBusy(false);
    }
  };

  const cancel = async () => {
    setBusy(true);
    const { data, error } = await supabase.rpc('cancel_premium_subscription');
    if (error || !data) toast.error(error?.message || 'Unable to cancel Premium');
    else { toast.success('Premium cancelled. Benefits remain until the current period ends.'); await refresh(); }
    setBusy(false);
  };

  if (!user) return <div className="min-h-screen flex items-center justify-center"><Button onClick={() => navigate('/auth')}>Sign in</Button></div>;

  return (
    <div className="min-h-screen bg-background pb-20 md:pb-0">
      <TopBar title="Premium" showBack />
      <PageAdBanner />
      <main className="max-w-2xl mx-auto p-4 space-y-7">
        <section className="text-center pt-4">
          <div className="inline-flex w-20 h-20 items-center justify-center rounded-full bg-gradient-to-br from-amber-400 to-orange-500 shadow-xl mb-4"><Crown className="w-10 h-10 text-white" /></div>
          <h1 className="text-3xl font-black">Testagram Premium</h1>
          <p className="text-muted-foreground mt-2">Verified payment. Server-authoritative entitlement. No client-side activation.</p>
        </section>

        {capturing && <div className="rounded-xl border p-4 flex items-center gap-3"><Loader2 className="animate-spin" /> Confirming your PayPal payment…</div>}

        {!loading && isActive && (
          <section className="rounded-2xl border-2 border-amber-400/40 bg-amber-400/10 p-5">
            <div className="flex items-center gap-3"><Crown className="w-6 h-6 text-amber-500" /><div><p className="font-bold">Premium Active</p><p className="text-sm text-muted-foreground capitalize">{plan} plan · expires {expiresAt?.toLocaleDateString()}</p></div></div>
            <Button variant="outline" className="mt-4" onClick={cancel} disabled={busy}><X className="w-4 h-4 mr-2" /> Cancel subscription</Button>
          </section>
        )}

        <section className="grid grid-cols-2 gap-3">{FEATURES.map(([Icon, label, desc]) => <div key={label} className="rounded-xl border bg-card p-4"><Icon className="w-5 h-5 text-primary mb-2" /><p className="font-bold text-sm">{label}</p><p className="text-xs text-muted-foreground mt-1">{desc}</p></div>)}</section>

        {!loading && !isActive && <section className="space-y-4">
          <h2 className="text-lg font-bold text-center">Choose your plan</h2>
          <div className="grid grid-cols-2 gap-3">{(Object.keys(PLANS) as Array<'monthly'|'annual'>).map(key => <button key={key} onClick={() => setSelectedPlan(key)} className={`rounded-2xl border-2 p-4 text-left ${selectedPlan === key ? 'border-primary bg-primary/5' : 'border-border'}`}><p className="font-bold">{PLANS[key].label}</p><p className="text-2xl font-black mt-1">${PLANS[key].price}</p><p className="text-xs text-muted-foreground">per {PLANS[key].period}</p>{key === 'annual' && <span className="text-[10px] text-green-600 font-bold">SAVE 33%</span>}{selectedPlan === key && <Check className="w-5 h-5 text-primary mt-2" />}</button>)}</div>
          <Button onClick={subscribe} disabled={busy} size="lg" className="w-full h-14 rounded-2xl font-black">{busy ? <Loader2 className="animate-spin mr-2" /> : <Crown className="mr-2" />}Continue to secure PayPal checkout</Button>
          <p className="text-xs text-muted-foreground text-center">Your Premium entitlement is granted only after the server verifies the captured PayPal amount and currency.</p>
        </section>}
      </main>
    </div>
  );
}
