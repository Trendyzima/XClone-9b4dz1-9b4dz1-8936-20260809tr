import { useState, useEffect, useRef, ReactNode } from 'react';
import { useSEO } from '@/hooks/useSEO';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { TopBar } from '@/components/layout/TopBar';
import { toast } from 'sonner';
import { BadgeCheck, Upload, Loader2, Clock, CheckCircle2, XCircle, Shield, Star, Building2 } from 'lucide-react';

import { PageAdBanner } from '@/components/features/AdSenseAd';
function VerificationAdBanner() { return <PageAdBanner />; }

interface Tier {
  id: string;
  label: string;
  price: number;
  color: string;
  icon: ReactNode;
  benefits: string[];
}

const TIERS: Tier[] = [
  {
    id: 'blue',
    label: 'Blue Verified',
    price: 5,
    color: 'blue',
    icon: <BadgeCheck className="w-6 h-6 text-blue-500" />,
    benefits: ['Blue verification badge', 'Priority in search results', 'Early access to features'],
  },
  {
    id: 'gold',
    label: 'Gold Verified',
    price: 15,
    color: 'yellow',
    icon: <Star className="w-6 h-6 text-yellow-500" />,
    benefits: ['Gold verification badge', 'Creator monetization unlock', 'Analytics dashboard', 'Priority support'],
  },
  {
    id: 'business',
    label: 'Business',
    price: 25,
    color: 'purple',
    icon: <Building2 className="w-6 h-6 text-purple-500" />,
    benefits: ['Business badge', 'Ad manager access', 'Custom profile CTA', 'Dedicated account manager', 'Monthly analytics report'],
  },
];

const TIER_STYLES: Record<string, { border: string; bg: string; selectedBg: string; badge: string }> = {
  blue:   { border: 'border-blue-500',   bg: 'bg-blue-500/5',   selectedBg: 'bg-blue-500/10',   badge: 'bg-blue-500' },
  yellow: { border: 'border-yellow-500', bg: 'bg-yellow-500/5', selectedBg: 'bg-yellow-500/10', badge: 'bg-yellow-500' },
  purple: { border: 'border-purple-500', bg: 'bg-purple-500/5', selectedBg: 'bg-purple-500/10', badge: 'bg-purple-500' },
};

export default function VerificationRequestPage() {
  const { user } = useAuth();
  useSEO({ noindex: true, title: 'Verification Request', url: '/verify' });
  const navigate = useNavigate();

  const [selectedTier, setSelectedTier] = useState<string>('blue');
  const [idFile, setIdFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [existingRequest, setExistingRequest] = useState<any>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data } = await supabase
        .from('verification_requests')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      setExistingRequest(data);
      setLoadingStatus(false);
    })();
  }, [user?.id]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { toast.error('File must be under 10MB'); return; }
    setIdFile(file);
  };

  const handleSubmit = async () => {
    if (!user) { navigate('/auth'); return; }
    const tier = TIERS.find(t => t.id === selectedTier);
    if (!tier) return;

    setUploading(true);
    try {
      let idDocUrl: string | null = null;

      if (idFile) {
        const ext = idFile.name.split('.').pop();
        const path = `verifications/${user.id}/${Date.now()}.${ext}`;
        const { error: upErr } = await supabase.storage.from('posts').upload(path, idFile);
        if (upErr) throw upErr;
        const { data: { publicUrl } } = supabase.storage.from('posts').getPublicUrl(path);
        idDocUrl = publicUrl;
      }

      const { error } = await supabase.from('verification_requests').insert({
        user_id: user.id,
        tier: tier.id,
        payment_amount: tier.price,
        payment_status: 'pending',
        status: 'pending',
        admin_notes: idDocUrl ? `ID document: ${idDocUrl}` : null,
      });

      if (error) throw error;

      toast.success('Verification request submitted! We\'ll review it within 48 hours.');
      const { data } = await supabase
        .from('verification_requests')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      setExistingRequest(data);
    } catch (err: any) {
      toast.error(err.message || 'Submission failed');
    } finally {
      setUploading(false);
    }
  };

  // ── Status view (already submitted) ────────────────────────────────────────
  if (!loadingStatus && existingRequest) {
    const st = existingRequest.status as 'pending' | 'approved' | 'rejected';
    const tier = TIERS.find(t => t.id === existingRequest.tier);
    const styles = TIER_STYLES[tier?.color ?? 'blue'];

    const statusConfig = {
      pending:  { icon: <Clock className="w-8 h-8 text-yellow-500" />, label: 'Under Review',    desc: 'Your request is being reviewed. Typical turnaround is 24–48 hours.' },
      approved: { icon: <CheckCircle2 className="w-8 h-8 text-green-500" />, label: 'Approved!',  desc: 'Congratulations! Your verification badge has been applied to your profile.' },
      rejected: { icon: <XCircle className="w-8 h-8 text-red-500" />, label: 'Not Approved',     desc: existingRequest.admin_notes ?? 'Your request was not approved. You may submit a new request.' },
    };

    const sc = statusConfig[st];

    return (
      <div className="min-h-screen bg-background pb-16 lg:pb-0">
        <TopBar title="Verification" showBack />
          <VerificationAdBanner />
        <div className="max-w-lg mx-auto p-6 space-y-6">
          {/* Status card */}
          <div className={`rounded-2xl border-2 ${styles.border} ${styles.bg} p-6 flex flex-col items-center text-center gap-3`}>
            {sc.icon}
            <h2 className="text-xl font-bold">{sc.label}</h2>
            <p className="text-sm text-muted-foreground">{sc.desc}</p>
            <div className="flex items-center gap-2 mt-1">
              {tier?.icon}
              <span className="font-semibold">{tier?.label}</span>
              <span className="text-muted-foreground text-sm">· ${existingRequest.payment_amount}</span>
            </div>
          </div>

          {/* Allow resubmit if rejected */}
          {st === 'rejected' && (
            <button
              onClick={() => setExistingRequest(null)}
              className="w-full py-3 rounded-xl bg-primary text-primary-foreground font-semibold hover:opacity-90 transition-opacity"
            >
              Submit New Request
            </button>
          )}

          <button
            onClick={() => navigate(-1)}
            className="w-full py-3 rounded-xl bg-muted hover:bg-muted/70 font-medium transition-colors text-sm"
          >
            Back
          </button>
        </div>
      </div>
    );
  }

  const activeTier = TIERS.find(t => t.id === selectedTier)!;
  const activeStyles = TIER_STYLES[activeTier.color];

  return (
    <div className="min-h-screen bg-background pb-16 lg:pb-0">
      <TopBar title="Get Verified" showBack />
      <VerificationAdBanner />

      <div className="max-w-lg mx-auto p-4 space-y-6">
        {/* Hero */}
        <div className="text-center pt-2 pb-1">
          <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-3">
            <Shield className="w-7 h-7 text-primary" />
          </div>
          <h1 className="text-2xl font-bold">Verify Your Account</h1>
          <p className="text-muted-foreground text-sm mt-1">Choose a monthly verification tier and keep your badge active while subscribed on Testagram</p>
        </div>

        {/* Tier selector */}
        <div className="space-y-3">
          {TIERS.map(tier => {
            const s = TIER_STYLES[tier.color];
            const selected = selectedTier === tier.id;
            return (
              <button
                key={tier.id}
                onClick={() => setSelectedTier(tier.id)}
                className={`w-full text-left rounded-2xl border-2 p-4 transition-all ${
                  selected ? `${s.border} ${s.selectedBg}` : 'border-border hover:border-muted-foreground/30 bg-card'
                }`}
              >
                <div className="flex items-start gap-3">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${s.bg}`}>
                    {tier.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-bold">{tier.label}</span>
                      <span className={`text-lg font-extrabold ${selected ? 'text-primary' : 'text-foreground'}`}>
                        ${tier.price}<span className="text-xs font-normal text-muted-foreground">/month</span>
                      </span>
                    </div>
                    <ul className="space-y-0.5">
                      {tier.benefits.map(b => (
                        <li key={b} className="text-xs text-muted-foreground flex items-center gap-1.5">
                          <CheckCircle2 className="w-3 h-3 text-green-500 flex-shrink-0" />
                          {b}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {/* ID Upload (optional) */}
        <div className="space-y-2">
          <label className="block text-sm font-semibold">ID Document <span className="text-muted-foreground font-normal">(optional but speeds up review)</span></label>
          <label className={`flex items-center gap-3 w-full rounded-xl border-2 border-dashed p-4 cursor-pointer transition-colors ${
            idFile ? 'border-green-500 bg-green-500/5' : 'border-border hover:border-primary/50 hover:bg-muted/30'
          }`}>
            <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center flex-shrink-0">
              <Upload className="w-5 h-5 text-muted-foreground" />
            </div>
            <div className="min-w-0">
              {idFile
                ? <><p className="font-medium text-sm text-green-600 truncate">{idFile.name}</p><p className="text-xs text-muted-foreground">{(idFile.size / 1024).toFixed(1)} KB</p></>
                : <><p className="font-medium text-sm">Upload ID or proof of identity</p><p className="text-xs text-muted-foreground">JPG, PNG or PDF · Max 10MB</p></>
              }
            </div>
            {idFile && (
              <button
                type="button"
                onClick={(e) => { e.preventDefault(); setIdFile(null); }}
                className="ml-auto text-muted-foreground hover:text-foreground flex-shrink-0"
              >
                <XCircle className="w-4 h-4" />
              </button>
            )}
            <input type="file" className="hidden" accept="image/*,.pdf" onChange={handleFileChange} />
          </label>
        </div>

        {/* Summary + Submit */}
        <div className={`rounded-2xl border-2 ${activeStyles.border} ${activeStyles.bg} p-4`}>
          <div className="flex items-center justify-between mb-3">
            <span className="font-semibold text-sm">Order Summary</span>
            <div className="flex items-center gap-1.5">
              {activeTier.icon}
              <span className="font-bold">{activeTier.label}</span>
            </div>
          </div>
          <div className="flex items-center justify-between text-sm text-muted-foreground border-t border-border pt-3">
            <span>Monthly subscription</span>
            <span className="text-2xl font-extrabold text-foreground">${activeTier.price}</span>
          </div>
        </div>

        <button
          onClick={handleSubmit}
          disabled={uploading || loadingStatus}
          className="w-full py-4 rounded-2xl bg-primary text-primary-foreground font-bold text-base hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {uploading
            ? <><Loader2 className="w-5 h-5 animate-spin" />Submitting…</>
            : <><BadgeCheck className="w-5 h-5" />Submit Verification Request</>
          }
        </button>

        <p className="text-center text-xs text-muted-foreground pb-4">
          Verification is a monthly subscription. The badge remains active only while the monthly entitlement is active; the platform owner is verified permanently.
        </p>
      </div>
    </div>
  );
}
