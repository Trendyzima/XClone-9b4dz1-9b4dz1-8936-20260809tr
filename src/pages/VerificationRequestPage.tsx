import { useEffect, useState, ReactNode } from 'react';
import { useSEO } from '@/hooks/useSEO';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { TopBar } from '@/components/layout/TopBar';
import { toast } from 'sonner';
import { BadgeCheck, Loader2, Clock, CheckCircle2, XCircle, Shield, Star, Building2 } from 'lucide-react';
import { PageAdBanner } from '@/components/features/AdSenseAd';

function VerificationAdBanner() { return <PageAdBanner />; }

interface Tier { id: string; label: string; price: number; color: string; icon: ReactNode; benefits: string[]; }

const TIERS: Tier[] = [
  { id: 'blue', label: 'Blue Verified', price: 5, color: 'blue', icon: <BadgeCheck className="w-6 h-6 text-blue-500" />, benefits: ['Blue verification badge', 'Priority in search results', 'Early access to features'] },
  { id: 'gold', label: 'Gold Verified', price: 15, color: 'yellow', icon: <Star className="w-6 h-6 text-yellow-500" />, benefits: ['Gold verification badge', 'Creator monetization unlock', 'Analytics dashboard', 'Priority support'] },
  { id: 'business', label: 'Business', price: 25, color: 'purple', icon: <Building2 className="w-6 h-6 text-purple-500" />, benefits: ['Business badge', 'Ad manager access', 'Custom profile CTA', 'Dedicated account manager', 'Monthly analytics report'] },
];

const TIER_STYLES: Record<string, { border: string; bg: string; selectedBg: string }> = {
  blue: { border: 'border-blue-500', bg: 'bg-blue-500/5', selectedBg: 'bg-blue-500/10' },
  yellow: { border: 'border-yellow-500', bg: 'bg-yellow-500/5', selectedBg: 'bg-yellow-500/10' },
  purple: { border: 'border-purple-500', bg: 'bg-purple-500/5', selectedBg: 'bg-purple-500/10' },
};

export default function VerificationRequestPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  useSEO({ noindex: true, title: 'Verification Request', url: '/verify' });
  const [selectedTier, setSelectedTier] = useState('blue');
  const [uploading, setUploading] = useState(false);
  const [existingRequest, setExistingRequest] = useState<any>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);

  useEffect(() => {
    if (!user) return;
    void (async () => {
      const { data } = await supabase.from('verification_requests').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(1).maybeSingle();
      setExistingRequest(data);
      setLoadingStatus(false);
    })();
  }, [user?.id]);

  const handleSubmit = async () => {
    if (!user) { navigate('/auth'); return; }
    const tier = TIERS.find((item) => item.id === selectedTier);
    if (!tier) return;
    setUploading(true);
    try {
      const { data: identity, error: identityError } = await supabase.rpc('get_my_identity_verification_status');
      if (identityError) throw identityError;
      if (identity?.status !== 'approved') {
        toast.error('Complete Testagram identity verification before requesting a verification badge.');
        navigate('/verify-identity');
        return;
      }
      const { error } = await supabase.from('verification_requests').insert({
        user_id: user.id, tier: tier.id, payment_amount: tier.price, payment_status: 'pending', status: 'pending',
      });
      if (error) throw error;
      toast.success("Verification request submitted! We'll review it within 48 hours.");
      const { data } = await supabase.from('verification_requests').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(1).maybeSingle();
      setExistingRequest(data);
    } catch (error: any) {
      toast.error(error?.message || 'Submission failed');
    } finally {
      setUploading(false);
    }
  };

  if (!loadingStatus && existingRequest) {
    const status = existingRequest.status as 'pending' | 'approved' | 'rejected';
    const tier = TIERS.find((item) => item.id === existingRequest.tier);
    const styles = TIER_STYLES[tier?.color ?? 'blue'];
    const config = {
      pending: { icon: <Clock className="w-8 h-8 text-yellow-500" />, label: 'Under Review', desc: 'Your request is being reviewed. Typical turnaround is 24–48 hours.' },
      approved: { icon: <CheckCircle2 className="w-8 h-8 text-green-500" />, label: 'Approved!', desc: 'Congratulations! Your verification badge has been applied to your profile.' },
      rejected: { icon: <XCircle className="w-8 h-8 text-red-500" />, label: 'Not Approved', desc: existingRequest.admin_notes ?? 'Your request was not approved. You may submit a new request.' },
    }[status];
    return (
      <div className="min-h-screen bg-background pb-16 lg:pb-0">
        <TopBar title="Verification" showBack /><VerificationAdBanner />
        <div className="max-w-lg mx-auto p-6 space-y-6">
          <div className={'rounded-2xl border-2 ' + styles.border + ' ' + styles.bg + ' p-6 flex flex-col items-center text-center gap-3'}>
            {config.icon}<h2 className="text-xl font-bold">{config.label}</h2><p className="text-sm text-muted-foreground">{config.desc}</p>
            <div className="flex items-center gap-2 mt-1">{tier?.icon}<span className="font-semibold">{tier?.label}</span><span className="text-muted-foreground text-sm">· ${existingRequest.payment_amount}</span></div>
          </div>
          {status === 'rejected' && <button onClick={() => setExistingRequest(null)} className="w-full py-3 rounded-xl bg-primary text-primary-foreground font-semibold">Submit New Request</button>}
          <button onClick={() => navigate(-1)} className="w-full py-3 rounded-xl bg-muted font-medium text-sm">Back</button>
        </div>
      </div>
    );
  }

  const activeTier = TIERS.find((item) => item.id === selectedTier)!;
  const activeStyles = TIER_STYLES[activeTier.color];

  return (
    <div className="min-h-screen bg-background pb-16 lg:pb-0">
      <TopBar title="Get Verified" showBack /><VerificationAdBanner />
      <div className="max-w-lg mx-auto p-4 space-y-6">
        <div className="text-center pt-2 pb-1">
          <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-3"><Shield className="w-7 h-7 text-primary" /></div>
          <h1 className="text-2xl font-bold">Verify Your Account</h1>
          <p className="text-muted-foreground text-sm mt-1">Choose a monthly verification tier and keep your badge active while subscribed on Testagram</p>
        </div>
        <div className="space-y-3">
          {TIERS.map((tier) => {
            const styles = TIER_STYLES[tier.color];
            const selected = selectedTier === tier.id;
            return <button key={tier.id} onClick={() => setSelectedTier(tier.id)} className={'w-full text-left rounded-2xl border-2 p-4 transition-all ' + (selected ? styles.border + ' ' + styles.selectedBg : 'border-border hover:border-muted-foreground/30 bg-card')}>
              <div className="flex items-start gap-3">
                <div className={'w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ' + styles.bg}>{tier.icon}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-1"><span className="font-bold">{tier.label}</span><span className={'text-lg font-extrabold ' + (selected ? 'text-primary' : 'text-foreground')}>${tier.price}<span className="text-xs font-normal text-muted-foreground">/month</span></span></div>
                  <ul className="space-y-0.5">{tier.benefits.map((benefit) => <li key={benefit} className="text-xs text-muted-foreground flex items-center gap-1.5"><CheckCircle2 className="w-3 h-3 text-green-500 flex-shrink-0" />{benefit}</li>)}</ul>
                </div>
              </div>
            </button>;
          })}
        </div>
        <div className="rounded-2xl border border-primary/20 bg-primary/5 p-4 text-sm leading-6">
          <p className="font-bold">Identity verification is already built into Testagram.</p>
          <p className="mt-1 text-muted-foreground">Testagram uses the identity-first KYC flow for account uniqueness and security. Do not upload national-ID photos here; Testagram does not store them.</p>
        </div>
        <div className={'rounded-2xl border-2 ' + activeStyles.border + ' ' + activeStyles.bg + ' p-4'}>
          <div className="flex items-center justify-between mb-3"><span className="font-semibold text-sm">Order Summary</span><div className="flex items-center gap-1.5">{activeTier.icon}<span className="font-bold">{activeTier.label}</span></div></div>
          <div className="flex items-center justify-between text-sm text-muted-foreground border-t border-border pt-3"><span>Monthly subscription</span><span className="text-2xl font-extrabold text-foreground">${activeTier.price}</span></div>
        </div>
        <button onClick={handleSubmit} disabled={uploading || loadingStatus} className="w-full py-4 rounded-2xl bg-primary text-primary-foreground font-bold text-base disabled:opacity-50 flex items-center justify-center gap-2">
          {uploading ? <><Loader2 className="w-5 h-5 animate-spin" />Submitting…</> : <><BadgeCheck className="w-5 h-5" />Submit Verification Request</>}
        </button>
        <p className="text-center text-xs text-muted-foreground pb-4">Verification is a monthly subscription. The badge remains active only while the monthly entitlement is active; the platform owner is verified permanently.</p>
      </div>
    </div>
  );
}
