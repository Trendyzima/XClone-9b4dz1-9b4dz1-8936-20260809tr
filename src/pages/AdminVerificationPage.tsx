import { useState, useEffect, useRef } from 'react';
import { useSEO } from '@/hooks/useSEO';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { TopBar } from '@/components/layout/TopBar';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import {
  ShieldCheck, Clock, CheckCircle, XCircle, Loader2,
  BadgeCheck, Crown, Star, Zap, Users, RefreshCw,
  ChevronDown, AlertTriangle,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { formatNumber } from '@/lib/utils';

import { PageAdBanner } from '@/components/features/AdSenseAd';
function AdminVerificationAdBanner() { return <PageAdBanner />; }

// ─── Types ────────────────────────────────────────────────────────────────────
interface VerificationRequest {
  id: string;
  user_id: string;
  tier: string;
  payment_status: string;
  payment_amount: number;
  status: string;
  admin_notes: string | null;
  created_at: string;
  processed_at: string | null;
  user: {
    username: string;
    email: string;
    avatar_url?: string;
    follower_count: number;
    bio?: string;
    verified: boolean;
  };
}

type FilterStatus = 'pending' | 'approved' | 'rejected' | 'all';

// ─── Tier config ──────────────────────────────────────────────────────────────
const TIER_CONFIG: Record<string, { label: string; color: string; bg: string; icon: any; price: number }> = {
  basic:     { label: 'Basic',     color: 'text-blue-600 dark:text-blue-400',   bg: 'bg-blue-100 dark:bg-blue-900/30',    icon: BadgeCheck, price: 5  },
  creator:   { label: 'Creator',   color: 'text-purple-600 dark:text-purple-400', bg: 'bg-purple-100 dark:bg-purple-900/30', icon: Star,      price: 15 },
  business:  { label: 'Business',  color: 'text-amber-600 dark:text-amber-400',  bg: 'bg-amber-100 dark:bg-amber-900/30',   icon: Crown,     price: 25 },
  celebrity: { label: 'Celebrity', color: 'text-rose-600 dark:text-rose-400',    bg: 'bg-rose-100 dark:bg-rose-900/30',     icon: Zap,       price: 50 },
};

export default function AdminVerificationPage() {
  const { user } = useAuth();
  useSEO({ noindex: true, title: 'Admin — Verifications', url: '/admin/verify' });
  const navigate = useNavigate();
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [requests, setRequests] = useState<VerificationRequest[]>([]);
  const [filter, setFilter] = useState<FilterStatus>('pending');
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [adminNotes, setAdminNotes] = useState<Record<string, string>>({});
  const [stats, setStats] = useState({ pending: 0, approved: 0, rejected: 0, total: 0 });

  useEffect(() => {
    if (!user) { navigate('/auth'); return; }
    checkAdmin();
  }, [user]);

  const checkAdmin = async () => {
    if (!user) return;
    const { data } = await supabase.from('admin_users').select('*').eq('user_id', user.id).single();
    if (!data) { toast.error('Admin access required'); navigate('/'); return; }
    setIsAdmin(true);
    await fetchRequests();
    setLoading(false);
  };

  const fetchRequests = async () => {
    const { data, error } = await supabase
      .from('verification_requests')
      .select(`
        *,
        user:profiles(username, email, avatar_url, follower_count, bio, verified)
      `)
      .order('created_at', { ascending: false });

    if (error) { toast.error(error.message); return; }
    const rows = (data as any[]) || [];
    setRequests(rows);

    const pending  = rows.filter(r => r.status === 'pending').length;
    const approved = rows.filter(r => r.status === 'approved').length;
    const rejected = rows.filter(r => r.status === 'rejected').length;
    setStats({ pending, approved, rejected, total: rows.length });
  };

  const handleDecision = async (req: VerificationRequest, approve: boolean) => {
    setActionLoading(req.id);
    const notes = adminNotes[req.id] || '';
    try {
      const status = approve ? 'approved' : 'rejected';
      const { error: reqErr } = await supabase
        .from('verification_requests')
        .update({ status, admin_notes: notes, processed_at: new Date().toISOString() })
        .eq('id', req.id);
      if (reqErr) throw reqErr;

      if (approve) {
        const { error: profileErr } = await supabase
          .from('profiles')
          .update({ verified: true })
          .eq('id', req.user_id);
        if (profileErr) throw profileErr;

        // Insert notification to user
        await supabase.from('notifications').insert({ recipient_id: req.user_id, kind: 'verified', actor_id: user!.id,
         });
      }

      toast.success(approve ? `@${req.user.username} is now verified ✓` : 'Verification rejected');
      setExpandedId(null);
      await fetchRequests();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setActionLoading(null);
    }
  };

  if (!user || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }
  if (!isAdmin) return null;

  const filtered = filter === 'all' ? requests : requests.filter(r => r.status === filter);

  return (
    <div className="min-h-screen bg-background pb-20 md:pb-4">
      <TopBar title="Verification Dashboard" showBack />
      <AdminVerificationAdBanner />

      <div className="max-w-2xl mx-auto p-4 space-y-5">

        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div className="bg-gradient-to-br from-primary/10 via-primary/5 to-transparent border border-primary/20 rounded-2xl p-5">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-primary/20 flex items-center justify-center">
              <ShieldCheck className="w-6 h-6 text-primary" />
            </div>
            <div className="flex-1">
              <h1 className="text-xl font-bold">Verification Queue</h1>
              <p className="text-sm text-muted-foreground">Review and approve user badge requests</p>
            </div>
            <button
              onClick={fetchRequests}
              className="p-2 rounded-full hover:bg-muted transition-colors text-muted-foreground"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* ── Stats Row ────────────────────────────────────────────────────── */}
        <div className="grid grid-cols-4 gap-2">
          {[
            { label: 'Pending',  value: stats.pending,  color: 'text-amber-500',  alert: stats.pending > 0 },
            { label: 'Approved', value: stats.approved, color: 'text-green-500',  alert: false },
            { label: 'Rejected', value: stats.rejected, color: 'text-red-500',    alert: false },
            { label: 'Total',    value: stats.total,    color: 'text-foreground', alert: false },
          ].map(s => (
            <div
              key={s.label}
              className={`bg-card border rounded-xl p-3 text-center ${s.alert ? 'border-amber-500/40' : 'border-border'}`}
            >
              <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{s.label}</p>
            </div>
          ))}
        </div>

        {/* ── Filter Tabs ──────────────────────────────────────────────────── */}
        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
          {(['pending', 'approved', 'rejected', 'all'] as FilterStatus[]).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`flex-shrink-0 px-4 py-2 rounded-full text-sm font-semibold transition-colors capitalize ${
                filter === f
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80'
              }`}
            >
              {f === 'pending' && stats.pending > 0 ? `Pending (${stats.pending})` : f}
            </button>
          ))}
        </div>

        {/* ── Request Cards ─────────────────────────────────────────────────── */}
        <div className="space-y-3">
          {filtered.length === 0 && (
            <div className="text-center py-16 text-muted-foreground">
              <ShieldCheck className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p className="font-medium">No {filter === 'all' ? '' : filter} requests</p>
              <p className="text-sm mt-1">
                {filter === 'pending' ? 'All caught up!' : 'Switch filter to see other requests'}
              </p>
            </div>
          )}

          {filtered.map(req => {
            const tierCfg = TIER_CONFIG[req.tier] || TIER_CONFIG.basic;
            const TierIcon = tierCfg.icon;
            const isExpanded = expandedId === req.id;
            const isPending = req.status === 'pending';
            const isLoading = actionLoading === req.id;

            return (
              <div
                key={req.id}
                className={`bg-card border rounded-2xl overflow-hidden transition-all ${
                  isPending ? 'border-amber-500/30' : 'border-border'
                }`}
              >
                {/* Card header */}
                <div className="p-4">
                  <div className="flex items-start gap-3">
                    {/* Avatar */}
                    <div className="w-12 h-12 rounded-full bg-muted overflow-hidden flex-shrink-0">
                      {req.user?.avatar_url ? (
                        <img src={req.user.avatar_url} alt={req.user.username} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-lg font-bold">
                          {req.user?.username?.[0]?.toUpperCase()}
                        </div>
                      )}
                    </div>

                    {/* User info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-bold truncate">@{req.user?.username}</span>
                        {req.user?.verified && (
                          <BadgeCheck className="w-4 h-4 text-primary flex-shrink-0" fill="currentColor" />
                        )}
                        {/* Tier badge */}
                        <span className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-semibold ${tierCfg.bg} ${tierCfg.color}`}>
                          <TierIcon className="w-3 h-3" />
                          {tierCfg.label}
                        </span>
                      </div>
                      <p className="text-sm text-muted-foreground truncate">{req.user?.email}</p>
                      <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Users className="w-3 h-3" />
                          {formatNumber(req.user?.follower_count || 0)} followers
                        </span>
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {formatDistanceToNow(new Date(req.created_at), { addSuffix: true })}
                        </span>
                      </div>
                    </div>

                    {/* Right side: status + payment + expand */}
                    <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                      <StatusPill status={req.status} />
                      <span className="text-sm font-bold text-green-600 dark:text-green-400">
                        ${req.payment_amount}
                      </span>
                      <PaymentPill status={req.payment_status} />
                    </div>
                  </div>

                  {/* Bio preview */}
                  {req.user?.bio && (
                    <p className="text-xs text-muted-foreground mt-2 line-clamp-2 ml-15">
                      {req.user.bio}
                    </p>
                  )}

                  {/* Expand toggle */}
                  {isPending && (
                    <button
                      onClick={() => setExpandedId(isExpanded ? null : req.id)}
                      className="mt-3 w-full flex items-center justify-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <span>{isExpanded ? 'Collapse' : 'Review & Decide'}</span>
                      <ChevronDown className={`w-3 h-3 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                    </button>
                  )}
                </div>

                {/* Expanded decision area */}
                {isExpanded && isPending && (
                  <div className="border-t border-border bg-muted/30 p-4 space-y-3">
                    {/* Tier info */}
                    <div className={`flex items-center gap-3 p-3 rounded-xl ${tierCfg.bg}`}>
                      <TierIcon className={`w-5 h-5 ${tierCfg.color} flex-shrink-0`} />
                      <div>
                        <p className={`font-semibold text-sm ${tierCfg.color}`}>{tierCfg.label} Verification</p>
                        <p className="text-xs text-muted-foreground">
                          Paid ${req.payment_amount} • {req.payment_status}
                        </p>
                      </div>
                    </div>

                    {/* Admin notes */}
                    <div>
                      <label className="text-xs font-semibold text-muted-foreground block mb-1.5">
                        Admin Notes (optional)
                      </label>
                      <textarea
                        value={adminNotes[req.id] || ''}
                        onChange={e => setAdminNotes(prev => ({ ...prev, [req.id]: e.target.value }))}
                        placeholder="Add a note for the applicant…"
                        rows={2}
                        className="w-full text-sm bg-background border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary resize-none"
                      />
                    </div>

                    {/* Action buttons */}
                    <div className="flex gap-2">
                      <Button
                        className="flex-1 bg-green-600 hover:bg-green-700 text-white"
                        disabled={isLoading}
                        onClick={() => handleDecision(req, true)}
                      >
                        {isLoading
                          ? <Loader2 className="w-4 h-4 animate-spin" />
                          : <><CheckCircle className="w-4 h-4 mr-1.5" />Approve</>
                        }
                      </Button>
                      <Button
                        variant="destructive"
                        className="flex-1"
                        disabled={isLoading}
                        onClick={() => handleDecision(req, false)}
                      >
                        {isLoading
                          ? <Loader2 className="w-4 h-4 animate-spin" />
                          : <><XCircle className="w-4 h-4 mr-1.5" />Reject</>
                        }
                      </Button>
                    </div>
                  </div>
                )}

                {/* Processed result */}
                {!isPending && (
                  <div className={`px-4 pb-3 text-xs flex items-center gap-1.5 ${
                    req.status === 'approved' ? 'text-green-600 dark:text-green-400' : 'text-red-500'
                  }`}>
                    {req.status === 'approved'
                      ? <CheckCircle className="w-3.5 h-3.5" />
                      : <XCircle className="w-3.5 h-3.5" />
                    }
                    {req.status === 'approved' ? 'Verified' : 'Rejected'}
                    {req.processed_at && ` · ${formatDistanceToNow(new Date(req.processed_at), { addSuffix: true })}`}
                    {req.admin_notes && ` · "${req.admin_notes}"`}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Status Pills ─────────────────────────────────────────────────────────────
function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    pending:  'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
    approved: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
    rejected: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  };
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-semibold capitalize ${map[status] || 'bg-muted text-muted-foreground'}`}>
      {status}
    </span>
  );
}

function PaymentPill({ status }: { status: string }) {
  const isPaid = status === 'paid';
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${
      isPaid
        ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
        : 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400'
    }`}>
      {status}
    </span>
  );
}
