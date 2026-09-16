import { useState, useEffect, useRef, useCallback } from 'react';
import { useSEO } from '@/hooks/useSEO';
import { useNavigate } from 'react-router-dom';
import { TopBar } from '@/components/layout/TopBar';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import {
  CheckCircle2, XCircle, Clock, Eye, MousePointer, DollarSign,
  Loader2, RefreshCw, BadgeCheck, Megaphone, AlertTriangle,
  TrendingUp, BarChart3, User, ExternalLink, ChevronDown, ChevronUp,
  ShieldCheck, ShieldX, Search, Filter, Send
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';
import { formatNumber } from '@/lib/utils';

import { PageAdBanner } from '@/components/features/AdSenseAd';
function AdminAdsAdBanner() { return <PageAdBanner />; }

type AdStatus = 'pending' | 'active' | 'rejected' | 'paused';

const STATUS_CONFIG: Record<AdStatus, { label: string; color: string; icon: React.ElementType }> = {
  pending:  { label: 'Pending Review', color: 'text-amber-600 bg-amber-500/10 border-amber-500/20', icon: Clock },
  active:   { label: 'Active',         color: 'text-green-600 bg-green-500/10 border-green-500/20', icon: CheckCircle2 },
  rejected: { label: 'Rejected',       color: 'text-red-600 bg-red-500/10 border-red-500/20',       icon: XCircle },
  paused:   { label: 'Paused',         color: 'text-muted-foreground bg-muted border-border',        icon: Clock },
};

export default function AdminAdsDashboard() {
  const { user } = useAuth();
  useSEO({ noindex: true, title: 'Admin — Ads Dashboard', url: '/admin/ads' });
  const navigate = useNavigate();
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [ads, setAds] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<AdStatus>('pending');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [adminNote, setAdminNote] = useState<Record<string, string>>({});
  const [searchQ, setSearchQ] = useState('');
  const [stats, setStats] = useState({ pending: 0, active: 0, rejected: 0, totalRevenue: 0 });

  useEffect(() => {
    if (!user) { navigate('/auth'); return; }
    checkAdmin();
  }, [user]);

  const checkAdmin = async () => {
    if (!user) return;
    const { data } = await supabase.from('admin_users').select('id').eq('user_id', user.id).maybeSingle();
    if (!data) { toast.error('Admin access required'); navigate('/'); return; }
    setIsAdmin(true);
    fetchAds();
    fetchStats();
  };

  const fetchStats = async () => {
    const [pendingRes, activeRes, rejectedRes] = await Promise.all([
      supabase.from('user_ads').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
      supabase.from('user_ads').select('id', { count: 'exact', head: true }).eq('status', 'active'),
      supabase.from('user_ads').select('id', { count: 'exact', head: true }).eq('status', 'rejected'),
    ]);
    const { data: revenue } = await supabase.from('user_ads').select('spent').eq('status', 'active');
    const totalRevenue = (revenue ?? []).reduce((s: number, r: any) => s + Number(r.spent ?? 0), 0);
    setStats({
      pending: pendingRes.count ?? 0,
      active: activeRes.count ?? 0,
      rejected: rejectedRes.count ?? 0,
      totalRevenue,
    });
  };

  const fetchAds = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('user_ads')
      .select('*, user_profiles!user_ads_user_id_fkey(id, username, avatar_url, verified, email)')
      .order('created_at', { ascending: false });
    setAds(data ?? []);
    setLoading(false);
  }, []);

  const approveAd = async (adId: string) => {
    setProcessingId(adId);
    const note = adminNote[adId]?.trim() || null;
    const { error } = await supabase.from('user_ads').update({
      status: 'active',
      payment_status: 'paid',
      admin_notes: note,
      verified_by: user!.id,
      verified_at: new Date().toISOString(),
      start_date: new Date().toISOString(),
      end_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    }).eq('id', adId);
    if (error) toast.error(error.message);
    else {
      toast.success('Ad approved and activated');
      const ad = ads.find(a => a.id === adId);
      if (ad?.user_id) {
        await supabase.from('notifications').insert({ recipient_id: ad.user_id, kind: 'ad_active', actor_id: user!.id,
         }).catch(() => {});
        // platform_inbox message
        await supabase.from('platform_inbox').insert({
          user_id: ad.user_id,
          subject: '🎉 Your ad is now live!',
          body: `Your ad "${ad.title}" has been approved and is now live. Users will start seeing it in their feeds.${note ? `\n\nAdmin note: ${note}` : ''}`,
          type: 'update',
          icon_emoji: '✅',
          cta_label: 'View My Ads',
          cta_url: '/my-ads',
        }).catch(() => {});
      }
      fetchAds(); fetchStats();
    }
    setProcessingId(null);
  };

  const rejectAd = async (adId: string) => {
    const note = adminNote[adId]?.trim();
    if (!note) { toast.error('Please add a rejection reason in the notes field'); return; }
    setProcessingId(adId);
    const { error } = await supabase.from('user_ads').update({
      status: 'rejected',
      admin_notes: note,
      verified_by: user!.id,
      verified_at: new Date().toISOString(),
    }).eq('id', adId);
    if (error) toast.error(error.message);
    else {
      toast.success('Ad rejected');
      const ad = ads.find(a => a.id === adId);
      if (ad?.user_id) {
        await supabase.from('notifications').insert({ recipient_id: ad.user_id, kind: 'ad_rejected', actor_id: user!.id,
         }).catch(() => {});
        // platform_inbox message with rejection reason
        await supabase.from('platform_inbox').insert({
          user_id: ad.user_id,
          subject: '❌ Ad not approved',
          body: `Your ad "${ad.title}" was not approved.\n\nReason: ${note}\n\nYou can edit and resubmit your ad from My Ads page.`,
          type: 'update',
          icon_emoji: '❌',
          cta_label: 'View My Ads',
          cta_url: '/my-ads',
        }).catch(() => {});
      }
      fetchAds(); fetchStats();
    }
    setProcessingId(null);
  };

  const pauseAd = async (adId: string) => {
    setProcessingId(adId);
    await supabase.from('user_ads').update({ status: 'paused' }).eq('id', adId);
    toast.success('Ad paused'); fetchAds(); fetchStats();
    setProcessingId(null);
  };

  const resumeAd = async (adId: string) => {
    setProcessingId(adId);
    await supabase.from('user_ads').update({ status: 'active' }).eq('id', adId);
    toast.success('Ad resumed'); fetchAds(); fetchStats();
    setProcessingId(null);
  };

  const [sendingDigest, setSendingDigest] = useState(false);

  const sendDigestToAll = async () => {
    setSendingDigest(true);
    try {
      await supabase.from('platform_inbox').insert({
        user_id: null,
        subject: '📊 Weekly Platform Digest',
        body: `Platform update: ${stats.active} active ads, ${stats.pending} pending review. Total ad revenue: $${stats.totalRevenue.toFixed(2)}. Reach thousands of users — create an ad today!`,
        type: 'news',
        icon_emoji: '📊',
        cta_label: 'Create an Ad',
        cta_url: '/create-ad',
      });
      toast.success('Digest broadcast sent to all users');
    } catch (e: any) {
      toast.error(e.message || 'Failed to send digest');
    } finally {
      setSendingDigest(false);
    }
  };

  if (isAdmin === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  const filtered = ads
    .filter(a => a.status === activeTab)
    .filter(a => !searchQ.trim() || (
      a.title?.toLowerCase().includes(searchQ.toLowerCase()) ||
      a.user_profiles?.username?.toLowerCase().includes(searchQ.toLowerCase())
    ));

  const TABS: { key: AdStatus; label: string; count: number; color: string }[] = [
    { key: 'pending',  label: 'Pending',  count: stats.pending,  color: 'text-amber-600' },
    { key: 'active',   label: 'Active',   count: stats.active,   color: 'text-green-600' },
    { key: 'rejected', label: 'Rejected', count: stats.rejected, color: 'text-red-600'   },
    { key: 'paused',   label: 'Paused',   count: ads.filter(a => a.status === 'paused').length, color: 'text-muted-foreground' },
  ];

  return (
    <div className="min-h-screen bg-background pb-16 md:pb-0">
      <TopBar title="Ad Review Dashboard" showBack />
      <AdminAdsAdBanner />

      {/* Stats Row */}
      <div className="grid grid-cols-4 gap-2 p-3 border-b border-border">
        {[
          { label: 'Pending',  value: stats.pending,  icon: Clock,        color: 'text-amber-600' },
          { label: 'Active',   value: stats.active,   icon: TrendingUp,   color: 'text-green-600' },
          { label: 'Rejected', value: stats.rejected, icon: XCircle,      color: 'text-red-600'   },
          { label: 'Revenue',  value: `$${stats.totalRevenue.toFixed(0)}`, icon: DollarSign, color: 'text-primary' },
        ].map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="bg-muted/30 rounded-xl p-2.5 text-center border border-border">
            <Icon className={`w-4 h-4 mx-auto mb-1 ${color}`} />
            <p className={`text-base font-black ${color}`}>{value}</p>
            <p className="text-[10px] text-muted-foreground">{label}</p>
          </div>
        ))}
      </div>

      {/* Tabs + Search */}
      <div className="border-b border-border px-3 pt-2">
        <div className="flex gap-1 overflow-x-auto scrollbar-hide pb-2">
          {TABS.map(t => (
            <button key={t.key} onClick={() => setActiveTab(t.key)}
              className={`shrink-0 flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-bold border transition-colors ${
                activeTab === t.key
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'border-border text-muted-foreground hover:bg-muted'
              }`}>
              {t.label}
              {t.count > 0 && (
                <span className={`${activeTab === t.key ? 'bg-primary-foreground/20' : 'bg-muted'} px-1.5 py-0.5 rounded-full text-[10px] font-black`}>
                  {t.count}
                </span>
              )}
            </button>
          ))}
        </div>
        <div className="relative pb-2">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
          <input value={searchQ} onChange={e => setSearchQ(e.target.value)}
            placeholder="Search by title or advertiser…"
            className="w-full pl-9 pr-4 py-2 bg-muted rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
        </div>
      </div>

      {/* Refresh + Digest */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <p className="text-xs text-muted-foreground">{filtered.length} ads</p>
        <div className="flex items-center gap-2">
          <button onClick={sendDigestToAll} disabled={sendingDigest}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors disabled:opacity-50">
            {sendingDigest ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
            Broadcast Digest
          </button>
          <span className="text-border">|</span>
          <button onClick={() => { fetchAds(); fetchStats(); }} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
            <RefreshCw className="w-3.5 h-3.5" />Refresh
          </button>
        </div>
      </div>

      {/* Ad List */}
      <div className="divide-y divide-border">
        {loading ? (
          <div className="flex items-center justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            <Megaphone className="w-12 h-12 mx-auto mb-3 opacity-20" />
            <p className="font-semibold">No {activeTab} ads</p>
          </div>
        ) : filtered.map(ad => {
          const cfg = STATUS_CONFIG[ad.status as AdStatus] ?? STATUS_CONFIG.pending;
          const CfgIcon = cfg.icon;
          const ctr = ad.impressions > 0 ? ((ad.clicks / ad.impressions) * 100).toFixed(2) : '0.00';
          const spentPct = ad.budget > 0 ? Math.min((Number(ad.spent ?? 0) / Number(ad.budget)) * 100, 100) : 0;
          const isExpanded = expandedId === ad.id;

          return (
            <div key={ad.id} className="p-4 hover:bg-muted/5 transition-colors">
              {/* Header row */}
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-full bg-muted overflow-hidden shrink-0">
                  {ad.user_profiles?.avatar_url
                    ? <img src={ad.user_profiles.avatar_url} alt="" className="w-full h-full object-cover" />
                    : <div className="w-full h-full flex items-center justify-center font-bold text-sm">{ad.user_profiles?.username?.[0]?.toUpperCase()}</div>
                  }
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-0.5">
                    <span className="font-bold text-sm truncate">{ad.title}</span>
                    <span className={`flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border ${cfg.color}`}>
                      <CfgIcon className="w-3 h-3" />{cfg.label}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <User className="w-3 h-3" />
                    <span>@{ad.user_profiles?.username}</span>
                    {ad.user_profiles?.verified && <BadgeCheck className="w-3 h-3 text-primary" />}
                    <span>·</span>
                    <span>{formatDistanceToNow(new Date(ad.created_at), { addSuffix: true })}</span>
                  </div>

                  <div className="flex items-center gap-4 mt-2">
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Eye className="w-3 h-3" />{formatNumber(ad.impressions ?? 0)}
                    </span>
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <MousePointer className="w-3 h-3" />{formatNumber(ad.clicks ?? 0)}
                    </span>
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <BarChart3 className="w-3 h-3" />{ctr}% CTR
                    </span>
                    <span className="flex items-center gap-1 text-xs font-semibold text-primary">
                      <DollarSign className="w-3 h-3" />{Number(ad.budget).toFixed(0)}
                    </span>
                  </div>

                  <div className="mt-2 flex items-center gap-2">
                    <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                      <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${spentPct}%` }} />
                    </div>
                    <span className="text-[10px] text-muted-foreground shrink-0">{spentPct.toFixed(0)}% spent</span>
                  </div>
                </div>

                <button onClick={() => setExpandedId(isExpanded ? null : ad.id)} className="p-2 rounded-full hover:bg-muted transition-colors shrink-0">
                  {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </button>
              </div>

              {/* Expanded detail */}
              {isExpanded && (
                <div className="mt-4 space-y-3 pl-13">
                  {ad.image_url && (
                    <div className="rounded-xl overflow-hidden border border-border">
                      <img src={ad.image_url} alt={ad.title} className="w-full max-h-48 object-cover" />
                    </div>
                  )}

                  <div className="p-3 bg-muted/30 rounded-xl text-sm text-muted-foreground">
                    {ad.description}
                  </div>

                  {ad.target_url && (
                    <a href={ad.target_url} target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-1.5 text-xs text-primary hover:underline">
                      <ExternalLink className="w-3.5 h-3.5" />{ad.target_url}
                    </a>
                  )}

                  <div className="grid grid-cols-3 gap-2">
                    <div className="bg-muted/30 rounded-lg p-2 text-center">
                      <p className="text-xs font-bold text-foreground">{ad.payment_method?.toUpperCase() ?? '—'}</p>
                      <p className="text-[10px] text-muted-foreground">Method</p>
                    </div>
                    <div className="bg-muted/30 rounded-lg p-2 text-center">
                      <p className={`text-xs font-bold ${ad.payment_status === 'paid' ? 'text-green-600' : 'text-amber-600'}`}>
                        {ad.payment_status?.toUpperCase() ?? 'PENDING'}
                      </p>
                      <p className="text-[10px] text-muted-foreground">Payment</p>
                    </div>
                    <div className="bg-muted/30 rounded-lg p-2 text-center">
                      <p className="text-xs font-bold text-foreground">${Number(ad.spent ?? 0).toFixed(2)}</p>
                      <p className="text-[10px] text-muted-foreground">Spent</p>
                    </div>
                  </div>

                  {ad.ai_verification_score != null && (
                    <div className={`flex items-start gap-2 p-2.5 rounded-xl border text-xs ${
                      Number(ad.ai_verification_score) >= 0.7
                        ? 'bg-green-500/5 border-green-500/20 text-green-700 dark:text-green-400'
                        : 'bg-amber-500/5 border-amber-500/20 text-amber-700 dark:text-amber-400'
                    }`}>
                      <ShieldCheck className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                      <div>
                        <span className="font-semibold">AI Score: {(Number(ad.ai_verification_score) * 100).toFixed(0)}%</span>
                        {ad.ai_verification_notes && <p className="mt-0.5 opacity-80">{ad.ai_verification_notes}</p>}
                      </div>
                    </div>
                  )}

                  {(activeTab === 'pending') && (
                    <div>
                      <label className="text-xs font-semibold text-muted-foreground mb-1 block">
                        Admin Notes {activeTab === 'pending' && '(required for rejection)'}
                      </label>
                      <textarea
                        value={adminNote[ad.id] ?? ''}
                        onChange={e => setAdminNote(prev => ({ ...prev, [ad.id]: e.target.value }))}
                        placeholder="Add notes for the advertiser…"
                        rows={2}
                        className="w-full px-3 py-2 text-sm rounded-xl border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none"
                      />
                    </div>
                  )}

                  {ad.admin_notes && activeTab !== 'pending' && (
                    <div className="p-2.5 bg-muted/40 rounded-xl text-xs text-muted-foreground">
                      <span className="font-semibold text-foreground">Admin notes: </span>{ad.admin_notes}
                    </div>
                  )}

                  <div className="flex gap-2">
                    {activeTab === 'pending' && (
                      <>
                        <button onClick={() => approveAd(ad.id)} disabled={processingId === ad.id}
                          className="flex-1 flex items-center justify-center gap-1.5 py-2.5 bg-green-600 hover:bg-green-700 text-white rounded-xl text-sm font-bold disabled:opacity-50 transition-colors">
                          {processingId === ad.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
                          Approve & Activate
                        </button>
                        <button onClick={() => rejectAd(ad.id)} disabled={processingId === ad.id}
                          className="flex-1 flex items-center justify-center gap-1.5 py-2.5 bg-destructive/10 hover:bg-destructive/20 text-destructive border border-destructive/20 rounded-xl text-sm font-bold disabled:opacity-50 transition-colors">
                          <ShieldX className="w-4 h-4" />
                          Reject
                        </button>
                      </>
                    )}
                    {activeTab === 'active' && (
                      <button onClick={() => pauseAd(ad.id)} disabled={processingId === ad.id}
                        className="flex items-center gap-1.5 px-4 py-2 border border-border rounded-xl text-xs font-semibold text-muted-foreground hover:bg-muted disabled:opacity-50">
                        {processingId === ad.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <AlertTriangle className="w-3.5 h-3.5" />}
                        Pause Ad
                      </button>
                    )}
                    {activeTab === 'paused' && (
                      <button onClick={() => resumeAd(ad.id)} disabled={processingId === ad.id}
                        className="flex items-center gap-1.5 px-4 py-2 bg-primary text-primary-foreground rounded-xl text-xs font-bold disabled:opacity-50">
                        {processingId === ad.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                        Resume Ad
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
