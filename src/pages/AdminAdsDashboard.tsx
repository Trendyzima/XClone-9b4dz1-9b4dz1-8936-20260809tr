import { useCallback, useEffect, useMemo, useState, type ElementType } from 'react';
import { useSEO } from '@/hooks/useSEO';
import { useNavigate } from 'react-router-dom';
import { TopBar } from '@/components/layout/TopBar';
import { useAuth } from '@/hooks/useAuth';
import { appwriteAuth } from '@/services/appwriteAuth';
import { backendCapabilities } from '@/services/testagramCapabilityClient';
import { TestagramApiError } from '@/services/apiClient';
import {
  CheckCircle2, XCircle, Clock, DollarSign, Loader2, RefreshCw,
  BadgeCheck, Megaphone, AlertTriangle, TrendingUp, User, ExternalLink,
  ChevronDown, ChevronUp, ShieldCheck, ShieldX, Search, KeyRound,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';
import { PageAdBanner } from '@/components/features/AdSenseAd';

type AdStatus = 'pending' | 'active' | 'rejected' | 'paused' | 'pending_payment';

const STATUS_CONFIG: Record<AdStatus, { label: string; color: string; icon: ElementType }> = {
  pending: { label: 'Pending Review', color: 'text-amber-600 bg-amber-500/10 border-amber-500/20', icon: Clock },
  pending_payment: { label: 'Approved · Awaiting payment', color: 'text-blue-600 bg-blue-500/10 border-blue-500/20', icon: Clock },
  active: { label: 'Active', color: 'text-green-600 bg-green-500/10 border-green-500/20', icon: CheckCircle2 },
  rejected: { label: 'Rejected', color: 'text-red-600 bg-red-500/10 border-red-500/20', icon: XCircle },
  paused: { label: 'Paused', color: 'text-muted-foreground bg-muted border-border', icon: Clock },
};

function kesFromMicros(value: unknown): number {
  const amount = Number(value ?? 0) / 1_000_000;
  return Number.isFinite(amount) ? amount : 0;
}

function formatKES(value: number): string {
  return new Intl.NumberFormat('en-KE', {
    style: 'currency',
    currency: 'KES',
    maximumFractionDigits: 0,
  }).format(value);
}

function safeHttpURL(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function mapCampaign(row: any) {
  const status: AdStatus = row.moderation_status === 'pending'
    ? 'pending'
    : row.campaign_status === 'pending_payment'
      ? 'pending_payment'
      : row.campaign_status === 'paused'
        ? 'paused'
        : row.campaign_status === 'rejected' || row.moderation_status === 'rejected'
          ? 'rejected'
          : row.campaign_status === 'active'
            ? 'active'
            : 'pending_payment';
  return {
    id: row.campaign_id,
    title: row.campaign_name,
    description: row.creative?.body ?? '',
    image_url: row.creative?.asset_url ?? '',
    target_url: row.creative?.click_through_url ?? '',
    budget: kesFromMicros(row.lifetime_budget_micros),
    funded: kesFromMicros(row.funded_micros),
    currency: row.currency ?? 'KES',
    payment_status: row.payment_status ?? 'unpaid',
    status,
    moderation_status: row.moderation_status,
    objective: row.objective,
    created_at: row.created_at,
    starts_at: row.starts_at,
    ends_at: row.ends_at,
    admin_notes: row.moderation_note ?? '',
    user_profiles: {
      id: row.owner_user_id,
      username: row.advertiser_name ?? 'Advertiser',
      avatar_url: null,
      verified: false,
    },
  };
}

export default function AdminAdsDashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  useSEO({ noindex: true, title: 'Admin — Ads Review', url: '/admin/ads' });

  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [mfaRequired, setMfaRequired] = useState(false);
  const [mfaFactors, setMfaFactors] = useState<string[]>([]);
  const [mfaFactor, setMfaFactor] = useState('totp');
  const [mfaChallengeId, setMfaChallengeId] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [mfaBusy, setMfaBusy] = useState(false);
  const [ads, setAds] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<AdStatus>('pending');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [adminNote, setAdminNote] = useState<Record<string, string>>({});
  const [searchQ, setSearchQ] = useState('');

  const loadMfaFactors = useCallback(async () => {
    try {
      const factors = await appwriteAuth.listMfaFactors();
      const available = ['totp', 'email', 'phone'].filter(key => Boolean((factors as any)?.[key]));
      setMfaFactors(available);
      setMfaFactor(available[0] ?? 'totp');
    } catch {
      setMfaFactors([]);
    }
  }, []);

  const fetchAds = useCallback(async () => {
    setLoading(true);
    try {
      const result = await backendCapabilities.listAdminAdReviewQueue('all', 200);
      const mapped = (result.items ?? []).map(mapCampaign);
      setAds(mapped);
      setIsAdmin(true);
      setMfaRequired(false);
      return true;
    } catch (error) {
      if (error instanceof TestagramApiError && error.code === 'ADMIN_MFA_REQUIRED') {
        setMfaRequired(true);
        setIsAdmin(null);
        await loadMfaFactors();
        return false;
      }
      if (error instanceof TestagramApiError && error.code === 'ADMIN_PERMISSION_REQUIRED') {
        setIsAdmin(false);
        toast.error('Your account does not have the platform.ads permission.');
        navigate('/');
        return false;
      }
      if (error instanceof TestagramApiError && error.status === 401) {
        navigate('/auth');
        return false;
      }
      toast.error(error instanceof Error ? error.message : 'Ad review queue could not be loaded.');
      setIsAdmin(false);
      return false;
    } finally {
      setLoading(false);
    }
  }, [loadMfaFactors, navigate]);

  useEffect(() => {
    if (!user) {
      navigate('/auth');
      return;
    }
    void fetchAds();
  }, [user?.id, fetchAds, navigate]);

  const submitMfa = async () => {
    setMfaBusy(true);
    try {
      if (!mfaChallengeId) {
        const challenge = await appwriteAuth.createMfaChallenge(mfaFactor);
        setMfaChallengeId((challenge as any).$id ?? (challenge as any).id ?? '');
        toast.success(mfaFactor === 'totp' ? 'Enter the code from your authenticator app.' : 'A verification code has been sent.');
        return;
      }
      await appwriteAuth.completeMfaChallenge(mfaChallengeId, mfaCode);
      setMfaChallengeId('');
      setMfaCode('');
      await fetchAds();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'MFA verification failed.');
    } finally {
      setMfaBusy(false);
    }
  };

  const stats = useMemo(() => ({
    pending: ads.filter(ad => ad.status === 'pending').length,
    active: ads.filter(ad => ad.status === 'active').length,
    rejected: ads.filter(ad => ad.status === 'rejected').length,
    funded: ads.reduce((total, ad) => total + ad.funded, 0),
    paused: ads.filter(ad => ad.status === 'paused').length,
    awaitingPayment: ads.filter(ad => ad.status === 'pending_payment').length,
  }), [ads]);

  const filtered = ads
    .filter(ad => ad.status === activeTab)
    .filter(ad => !searchQ.trim() || (
      ad.title?.toLowerCase().includes(searchQ.toLowerCase()) ||
      ad.user_profiles?.username?.toLowerCase().includes(searchQ.toLowerCase())
    ));

  const review = async (adId: string, decision: 'approved' | 'rejected') => {
    const note = adminNote[adId]?.trim() ?? '';
    if (decision === 'rejected' && !note) {
      toast.error('A rejection reason is required.');
      return;
    }
    setProcessingId(adId);
    try {
      await backendCapabilities.reviewAdminAdCampaign(adId, decision, note);
      toast.success(decision === 'approved' ? 'Campaign approved. It will activate only after funding.' : 'Campaign rejected.');
      await fetchAds();
    } catch (error) {
      if (error instanceof TestagramApiError && error.code === 'ADMIN_MFA_REQUIRED') {
        await fetchAds();
      } else {
        toast.error(error instanceof Error ? error.message : 'Campaign review failed.');
      }
    } finally {
      setProcessingId(null);
    }
  };

  const changeStatus = async (adId: string, status: 'active' | 'paused') => {
    setProcessingId(adId);
    try {
      await backendCapabilities.updateAdminAdCampaignStatus(adId, status);
      toast.success(status === 'paused' ? 'Campaign paused.' : 'Campaign resumed.');
      await fetchAds();
    } catch (error) {
      if (error instanceof TestagramApiError && error.code === 'ADMIN_MFA_REQUIRED') {
        await fetchAds();
      } else {
        toast.error(error instanceof Error ? error.message : 'Campaign status update failed.');
      }
    } finally {
      setProcessingId(null);
    }
  };

  if (isAdmin === null && mfaRequired) {
    return (
      <div className="min-h-screen bg-background">
        <TopBar title="Verify admin session" showBack />
        <div className="max-w-md mx-auto p-5 pt-16">
          <div className="rounded-2xl border border-border bg-card p-6 space-y-4">
            <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
              <KeyRound className="w-6 h-6 text-primary" />
            </div>
            <h1 className="text-xl font-black">Additional verification required</h1>
            <p className="text-sm text-muted-foreground">
              Ad moderation requires a recent Appwrite multi-factor verification. Your session is not elevated yet.
            </p>
            {mfaFactors.length === 0 ? (
              <p className="text-sm text-destructive">No MFA factor is enabled on this Appwrite account. Enable an authenticator, email or phone factor before reviewing ads.</p>
            ) : (
              <>
                <label className="block text-xs font-semibold text-muted-foreground">Verification method</label>
                <select value={mfaFactor} onChange={event => { setMfaFactor(event.target.value); setMfaChallengeId(''); }}
                  className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm">
                  {mfaFactors.map(factor => <option key={factor} value={factor}>{factor.toUpperCase()}</option>)}
                </select>
                {mfaChallengeId && (
                  <>
                    <label className="block text-xs font-semibold text-muted-foreground">Verification code</label>
                    <input value={mfaCode} onChange={event => setMfaCode(event.target.value.replace(/\D/g, '').slice(0, 10))}
                      inputMode="numeric" autoComplete="one-time-code" placeholder="Enter code"
                      className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm" />
                  </>
                )}
                <button onClick={submitMfa} disabled={mfaBusy || (Boolean(mfaChallengeId) && mfaCode.length < 6)}
                  className="w-full rounded-xl bg-primary px-4 py-3 text-sm font-bold text-primary-foreground disabled:opacity-50">
                  {mfaBusy ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : mfaChallengeId ? 'Verify and continue' : 'Start verification'}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (isAdmin === null) {
    return <div className="min-h-screen flex items-center justify-center bg-background"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;
  }

  if (!isAdmin) return null;

  const tabs: { key: AdStatus; label: string; count: number }[] = [
    { key: 'pending', label: 'Pending review', count: stats.pending },
    { key: 'pending_payment', label: 'Awaiting payment', count: stats.awaitingPayment },
    { key: 'active', label: 'Active', count: stats.active },
    { key: 'paused', label: 'Paused', count: stats.paused },
    { key: 'rejected', label: 'Rejected', count: stats.rejected },
  ];

  return (
    <div className="min-h-screen bg-background pb-16 md:pb-0">
      <TopBar title="Ad Review Dashboard" showBack />
      <PageAdBanner />

      <div className="grid grid-cols-4 gap-2 p-3 border-b border-border">
        {[
          { label: 'Pending', value: stats.pending, icon: Clock, color: 'text-amber-600' },
          { label: 'Active', value: stats.active, icon: TrendingUp, color: 'text-green-600' },
          { label: 'Rejected', value: stats.rejected, icon: XCircle, color: 'text-red-600' },
          { label: 'Funded', value: formatKES(stats.funded), icon: DollarSign, color: 'text-primary' },
        ].map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="rounded-xl border border-border bg-muted/30 p-2.5 text-center">
            <Icon className={`mx-auto mb-1 h-4 w-4 ${color}`} />
            <p className={`text-sm font-black ${color}`}>{value}</p>
            <p className="text-[10px] text-muted-foreground">{label}</p>
          </div>
        ))}
      </div>

      <div className="border-b border-border px-3 pt-2">
        <div className="flex gap-1 overflow-x-auto pb-2">
          {tabs.map(tab => (
            <button key={tab.key} onClick={() => setActiveTab(tab.key)}
              className={`shrink-0 rounded-full border px-3.5 py-1.5 text-xs font-bold transition-colors ${activeTab === tab.key ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-muted-foreground hover:bg-muted'}`}>
              {tab.label}{tab.count > 0 && <span className="ml-1.5 rounded-full bg-muted/70 px-1.5 py-0.5 text-[10px]">{tab.count}</span>}
            </button>
          ))}
        </div>
        <div className="relative pb-2">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input value={searchQ} onChange={event => setSearchQ(event.target.value)}
            placeholder="Search by campaign or advertiser…"
            className="w-full rounded-xl bg-muted py-2 pl-9 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
        </div>
      </div>

      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <p className="text-xs text-muted-foreground">{filtered.length} campaigns</p>
        <button onClick={() => void fetchAds()} disabled={loading}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50">
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}Refresh
        </button>
      </div>

      <div className="divide-y divide-border">
        {loading ? (
          <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center text-muted-foreground">
            <Megaphone className="mx-auto mb-3 h-12 w-12 opacity-20" />
            <p className="font-semibold">No {tabs.find(tab => tab.key === activeTab)?.label.toLowerCase()} campaigns</p>
          </div>
        ) : filtered.map(ad => {
          const config = STATUS_CONFIG[ad.status];
          const StatusIcon = config.icon;
          const expanded = expandedId === ad.id;
          const imageURL = safeHttpURL(ad.image_url);
          const targetURL = safeHttpURL(ad.target_url);
          return (
            <div key={ad.id} className="p-4 transition-colors hover:bg-muted/5">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted">
                  <User className="h-5 w-5 text-muted-foreground" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="mb-0.5 flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-bold">{ad.title}</span>
                    <span className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold ${config.color}`}>
                      <StatusIcon className="h-3 w-3" />{config.label}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span>{ad.user_profiles?.username}</span>
                    <BadgeCheck className="h-3 w-3 text-primary/60" />
                    <span>·</span>
                    <span>{formatDistanceToNow(new Date(ad.created_at), { addSuffix: true })}</span>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-4 text-xs">
                    <span className="font-semibold text-primary">Budget {formatKES(ad.budget)}</span>
                    <span className="text-muted-foreground">Funded {formatKES(ad.funded)}</span>
                    <span className="text-muted-foreground">Payment {String(ad.payment_status).toUpperCase()}</span>
                  </div>
                </div>
                <button onClick={() => setExpandedId(expanded ? null : ad.id)} className="shrink-0 rounded-full p-2 transition-colors hover:bg-muted">
                  {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </button>
              </div>

              {expanded && (
                <div className="mt-4 space-y-3 pl-13">
                  {imageURL && <div className="overflow-hidden rounded-xl border border-border"><img src={imageURL} alt={ad.title} className="max-h-48 w-full object-cover" /></div>}
                  {ad.description && <div className="rounded-xl bg-muted/30 p-3 text-sm text-muted-foreground">{ad.description}</div>}
                  {targetURL && <a href={targetURL} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-xs text-primary hover:underline"><ExternalLink className="h-3.5 w-3.5" />{targetURL}</a>}
                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded-lg bg-muted/30 p-2 text-center">
                      <p className="text-xs font-bold">{ad.objective}</p><p className="text-[10px] text-muted-foreground">Objective</p>
                    </div>
                    <div className="rounded-lg bg-muted/30 p-2 text-center">
                      <p className="text-xs font-bold">{ad.ends_at ? new Date(ad.ends_at).toLocaleDateString() : 'No end date'}</p><p className="text-[10px] text-muted-foreground">End date</p>
                    </div>
                  </div>
                  {ad.admin_notes && <div className="rounded-xl bg-muted/40 p-2.5 text-xs text-muted-foreground"><span className="font-semibold text-foreground">Review note: </span>{ad.admin_notes}</div>}
                  {ad.status === 'pending' && (
                    <div className="space-y-2">
                      <label className="block text-xs font-semibold text-muted-foreground">Review note (required for rejection)</label>
                      <textarea value={adminNote[ad.id] ?? ''} onChange={event => setAdminNote(previous => ({ ...previous, [ad.id]: event.target.value }))}
                        placeholder="Add a note for the advertiser…" rows={2}
                        className="w-full resize-none rounded-xl border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
                      <div className="flex gap-2">
                        <button onClick={() => void review(ad.id, 'approved')} disabled={processingId === ad.id}
                          className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-green-600 py-2.5 text-sm font-bold text-white transition-colors hover:bg-green-700 disabled:opacity-50">
                          {processingId === ad.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}Approve
                        </button>
                        <button onClick={() => void review(ad.id, 'rejected')} disabled={processingId === ad.id}
                          className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-destructive/20 bg-destructive/10 py-2.5 text-sm font-bold text-destructive transition-colors hover:bg-destructive/20 disabled:opacity-50">
                          <ShieldX className="h-4 w-4" />Reject
                        </button>
                      </div>
                    </div>
                  )}
                  {ad.status === 'active' && (
                    <button onClick={() => void changeStatus(ad.id, 'paused')} disabled={processingId === ad.id}
                      className="flex items-center gap-1.5 rounded-xl border border-border px-4 py-2 text-xs font-semibold text-muted-foreground hover:bg-muted disabled:opacity-50">
                      {processingId === ad.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <AlertTriangle className="h-3.5 w-3.5" />}Pause campaign
                    </button>
                  )}
                  {ad.status === 'paused' && (
                    <button onClick={() => void changeStatus(ad.id, 'active')} disabled={processingId === ad.id}
                      className="flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-xs font-bold text-primary-foreground disabled:opacity-50">
                      {processingId === ad.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}Resume campaign
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
