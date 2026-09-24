import { useState, useEffect, useRef } from 'react';
import { useSEO } from '@/hooks/useSEO';
import { TopBar } from '@/components/layout/TopBar';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import {
  Shield, Users, TrendingUp, DollarSign, Settings,
  AlertTriangle, Loader2, Plus, Eye, MousePointer,
  BarChart3, CheckCircle, XCircle, Clock, Star,
  Megaphone, Ban, UserCheck, Flag, Activity,
  RefreshCw, Search, Filter, ChevronDown, Edit3,
  Trash2, ToggleLeft, ToggleRight, Zap, Globe,
  Lock, Unlock, Crown, FileText, Video, Heart,
} from 'lucide-react';
import { formatNumber } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';

import { PageAdBanner } from '@/components/features/AdSenseAd';
function AdminPanelAdBanner() { return <PageAdBanner />; }

// ─── Types ────────────────────────────────────────────────────────────────────
interface PlatformStats {
  total_users: number;
  total_posts: number;
  total_views: number;
  total_communities: number;
  total_revenue: number;
  pending_verifications: number;
  pending_ads: number;
  fraud_alerts: number;
  active_streams: number;
  total_earnings_distributed: number;
}

interface UserAdEntry {
  id: string;
  user_id: string;
  title: string;
  description: string;
  status: string;
  payment_status: string;
  budget: number;
  spent: number;
  impressions: number;
  clicks: number;
  ai_verification_score?: number;
  created_at: string;
  user: { username: string; email: string };
}

interface ReportedUser {
  id: string;
  username: string;
  email: string;
  is_blocked: boolean;
  follower_count: number;
  created_at: string;
  post_count?: number;
}

interface FraudAlert {
  id: string;
  user_id: string;
  alert_type: string;
  severity: string;
  details: any;
  resolved: boolean;
  created_at: string;
  user?: { username: string };
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function AdminPanel() {
  useSEO({ noindex: true, title: 'Admin Panel', url: '/admin' });
  const { user } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [activeTab, setActiveTab] = useState('overview');
  const [stats, setStats] = useState<PlatformStats>({
    total_users: 0, total_posts: 0, total_views: 0, total_communities: 0,
    total_revenue: 0, pending_verifications: 0, pending_ads: 0,
    fraud_alerts: 0, active_streams: 0, total_earnings_distributed: 0,
  });
  const [userAds, setUserAds] = useState<UserAdEntry[]>([]);
  const [users, setUsers] = useState<ReportedUser[]>([]);
  const [fraudAlerts, setFraudAlerts] = useState<FraudAlert[]>([]);
  const [reportedPosts, setReportedPosts] = useState<any[]>([]);
  const [pendingReports, setPendingReports] = useState(0);
  const [userSearch, setUserSearch] = useState('');
  const [adFilter, setAdFilter] = useState<'all' | 'pending' | 'active' | 'rejected'>('pending');
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [sponsoredForm, setSponsoredForm] = useState({ title: '', content: '', advertiser_name: '', budget: '' });
  const [createSponsoredOpen, setCreateSponsoredOpen] = useState(false);

  useEffect(() => {
    if (!user) { navigate('/auth'); return; }
    checkAdmin();
  }, [user]);

  const checkAdmin = async () => {
    if (!user) return;
    const { data } = await supabase.from('admin_users').select('*').eq('user_id', user.id).single();
    if (!data) { toast.error('Access denied — admin only'); navigate('/'); return; }
    setIsAdmin(true);
    await Promise.all([fetchStats(), fetchUserAds(), fetchUsers(), fetchFraudAlerts(), fetchReportedPosts()]);
    setLoading(false);
  };

  const fetchStats = async () => {
    const [
      { count: usersCount },
      { count: postsCount },
      { count: commCount },
      { count: pendingVer },
      { count: pendingAds },
      { count: fraudCount },
      { count: liveStreams },
    ] = await Promise.all([
      supabase.from('profiles').select('*', { count: 'exact', head: true }),
      supabase.from('posts').select('*', { count: 'exact', head: true }),
      supabase.from('communities').select('*', { count: 'exact', head: true }),
      supabase.from('verification_requests').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
      supabase.from('user_ads').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
      supabase.from('fraud_alerts').select('*', { count: 'exact', head: true }).eq('resolved', false),
      supabase.from('live_streams').select('*', { count: 'exact', head: true }).eq('is_live', true),
    ]);
    const { data: viewData } = await supabase.from('posts').select('views_count');
    const total_views = viewData?.reduce((s, p) => s + (p.views_count || 0), 0) ?? 0;
    const { data: earningsData } = await supabase.from('creator_earnings').select('amount');
    const total_earnings_distributed = earningsData?.reduce((s, e) => s + Number(e.amount), 0) ?? 0;
    setStats({
      total_users: usersCount ?? 0,
      total_posts: postsCount ?? 0,
      total_views,
      total_communities: commCount ?? 0,
      total_revenue: total_earnings_distributed / 0.3 * 1, // gross estimate
      pending_verifications: pendingVer ?? 0,
      pending_ads: pendingAds ?? 0,
      fraud_alerts: fraudCount ?? 0,
      active_streams: liveStreams ?? 0,
      total_earnings_distributed,
    });
  };

  const fetchUserAds = async () => {
    const { data } = await supabase
      .from('user_ads')
      .select('*, user:profiles(username, email)')
      .order('created_at', { ascending: false })
      .limit(100);
    setUserAds((data as any) || []);
  };

  const fetchUsers = async () => {
    const { data } = await supabase
      .from('profiles')
      .select('id, username, email, is_blocked, follower_count, created_at')
      .order('created_at', { ascending: false })
      .limit(200);
    setUsers((data as any) || []);
  };

  const fetchReportedPosts = async () => {
    const { data } = await supabase
      .from('post_reports')
      .select('*, post:posts(id, content, user_id, profiles(username, avatar_url)), reporter:user_profiles!post_reports_reporter_id_fkey(username)')
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(50);
    const reports = data || [];
    setReportedPosts(reports);
    setPendingReports(reports.length);
  };

  const handleDismissReport = async (reportId: string) => {
    await supabase.from('post_reports').update({ status: 'dismissed' }).eq('id', reportId);
    toast.success('Report dismissed');
    fetchReportedPosts();
  };

  const handleRemoveReportedPost = async (reportId: string, postId: string) => {
    await supabase.from('posts').delete().eq('id', postId);
    await supabase.from('post_reports').update({ status: 'actioned' }).eq('id', reportId);
    toast.success('Post removed');
    fetchReportedPosts();
  };

  const fetchFraudAlerts = async () => {
    const { data } = await supabase
      .from('fraud_alerts')
      .select('*, user:profiles(username)')
      .order('created_at', { ascending: false })
      .limit(50);
    setFraudAlerts((data as any) || []);
  };

  // ── Ad review actions ───────────────────────────────────────────────────────
  const handleAdReview = async (id: string, approve: boolean, notes = '') => {
    setActionLoading(id);
    try {
      const status = approve ? 'active' : 'rejected';
      await supabase.from('user_ads').update({ status, admin_notes: notes, verified_at: new Date().toISOString() }).eq('id', id);
      toast.success(approve ? 'Ad approved & activated ✓' : 'Ad rejected');
      fetchUserAds();
      fetchStats();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setActionLoading(null);
    }
  };

  // ── User management ─────────────────────────────────────────────────────────
  const handleBlockUser = async (userId: string, blocked: boolean) => {
    setActionLoading(userId);
    try {
      await supabase.from('profiles').update({ is_blocked: !blocked }).eq('id', userId);
      toast.success(!blocked ? 'User blocked' : 'User unblocked');
      fetchUsers();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setActionLoading(null);
    }
  };

  // ── Fraud alert resolve ─────────────────────────────────────────────────────
  const handleResolveFraud = async (id: string) => {
    setActionLoading(id);
    try {
      await supabase.from('fraud_alerts').update({ resolved: true, resolved_at: new Date().toISOString() }).eq('id', id);
      toast.success('Alert resolved');
      fetchFraudAlerts();
      fetchStats();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setActionLoading(null);
    }
  };

  // ── Create sponsored content ────────────────────────────────────────────────
  const handleCreateSponsored = async () => {
    if (!sponsoredForm.title || !sponsoredForm.advertiser_name || !sponsoredForm.budget) {
      toast.error('All fields are required');
      return;
    }
    const { error } = await supabase.from('sponsored_content').insert({
      title: sponsoredForm.title,
      content: sponsoredForm.content,
      advertiser_name: sponsoredForm.advertiser_name,
      budget: Number(sponsoredForm.budget),
    });
    if (error) { toast.error(error.message); return; }
    toast.success('Sponsored content created');
    setCreateSponsoredOpen(false);
    setSponsoredForm({ title: '', content: '', advertiser_name: '', budget: '' });
  };

  if (!user) return null;
  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <Loader2 className="w-8 h-8 animate-spin text-primary" />
    </div>
  );
  if (!isAdmin) return null;

  // ── Filtered data ───────────────────────────────────────────────────────────
  const filteredUsers = users.filter(u =>
    u.username?.toLowerCase().includes(userSearch.toLowerCase()) ||
    u.email?.toLowerCase().includes(userSearch.toLowerCase())
  );
  const filteredAds = adFilter === 'all' ? userAds : userAds.filter(a => a.status === adFilter);

  // ── Stat card ───────────────────────────────────────────────────────────────
  const StatCard = ({ icon: Icon, label, value, color, alert }: any) => (
    <div className={`relative bg-card border border-border rounded-xl p-4 ${alert ? 'border-red-500/40 bg-red-500/5' : ''}`}>
      {alert && (
        <span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-red-500 animate-pulse" />
      )}
      <div className={`flex items-center gap-2 mb-2 text-${color}`}>
        <Icon className="w-4 h-4" />
        <span className="text-xs text-muted-foreground font-medium">{label}</span>
      </div>
      <p className="text-2xl font-bold text-foreground">{value}</p>
    </div>
  );

  const StatusBadge = ({ status }: { status: string }) => {
    const map: Record<string, string> = {
      pending: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
      approved: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
      active: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
      rejected: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
      paid: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
    };
    return (
      <span className={`text-xs px-2 py-0.5 rounded-full font-semibold capitalize ${map[status] || 'bg-muted text-muted-foreground'}`}>
        {status}
      </span>
    );
  };

  return (
    <div className="min-h-screen bg-background pb-20 md:pb-4">
      <TopBar title="Admin Command Center" showBack />
      <AdminPanelAdBanner />

      <div className="p-4 max-w-4xl mx-auto space-y-6">
        {/* Hero Header */}
        <div className="bg-gradient-to-br from-primary/10 via-primary/5 to-transparent border border-primary/20 rounded-2xl p-6">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-primary/20 flex items-center justify-center">
              <Shield className="w-7 h-7 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-foreground">Admin Command Center</h1>
              <p className="text-muted-foreground text-sm">Full platform control — users, ads, verifications, fraud & revenue</p>
            </div>
            <div className="ml-auto flex gap-2">
              {stats.pending_verifications > 0 && (
                <span className="flex items-center gap-1 px-3 py-1 bg-yellow-500/20 text-yellow-600 dark:text-yellow-400 rounded-full text-xs font-bold">
                  <Clock className="w-3 h-3" /> {stats.pending_verifications} pending
                </span>
              )}
              {stats.fraud_alerts > 0 && (
                <span className="flex items-center gap-1 px-3 py-1 bg-red-500/20 text-red-600 dark:text-red-400 rounded-full text-xs font-bold">
                  <AlertTriangle className="w-3 h-3" /> {stats.fraud_alerts} alerts
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard icon={Users} label="Total Users" value={formatNumber(stats.total_users)} color="blue-500" />
          <StatCard icon={FileText} label="Total Posts" value={formatNumber(stats.total_posts)} color="purple-500" />
          <StatCard icon={DollarSign} label="Revenue Est." value={`$${stats.total_revenue.toFixed(0)}`} color="green-500" />
          <StatCard icon={Globe} label="Communities" value={formatNumber(stats.total_communities)} color="orange-500" />
          <StatCard icon={UserCheck} label="Verif. Pending" value={stats.pending_verifications} color="yellow-500" alert={stats.pending_verifications > 0} />
          <StatCard icon={Megaphone} label="Ads Pending" value={stats.pending_ads} color="blue-500" alert={stats.pending_ads > 0} />
          <StatCard icon={AlertTriangle} label="Fraud Alerts" value={stats.fraud_alerts} color="red-500" alert={stats.fraud_alerts > 0} />
          <StatCard icon={Activity} label="Live Streams" value={stats.active_streams} color="green-500" />
        </div>

        {/* Main Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid grid-cols-5 w-full h-auto p-1">
            <TabsTrigger value="overview" className="text-xs py-2">Overview</TabsTrigger>
            
            <TabsTrigger value="ads" className="relative text-xs py-2">
              Ads
              {stats.pending_ads > 0 && (
                <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full text-white text-[10px] flex items-center justify-center font-bold">
                  {stats.pending_ads > 9 ? '9+' : stats.pending_ads}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="users" className="text-xs py-2">Users</TabsTrigger>
            <TabsTrigger value="fraud" className="relative text-xs py-2">
              Fraud
              {stats.fraud_alerts > 0 && (
                <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full text-white text-[10px] flex items-center justify-center font-bold">
                  {stats.fraud_alerts > 9 ? '9+' : stats.fraud_alerts}
                </span>
              )}
            </TabsTrigger>
          </TabsList>

          {/* ── OVERVIEW ──────────────────────────────────────────────────────── */}
          <TabsContent value="overview" className="space-y-4 mt-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Quick Actions */}
              <div className="bg-card border border-border rounded-xl p-5 space-y-3">
                <h3 className="font-bold text-foreground flex items-center gap-2">
                  <Zap className="w-4 h-4 text-primary" /> Quick Actions
                </h3>
                <div className="space-y-2">
                  <button onClick={() => navigate('/admin/verifications')} className="w-full flex items-center justify-between p-3 rounded-lg bg-yellow-500/10 hover:bg-yellow-500/20 transition-colors">
                    <div className="flex items-center gap-2">
                      <UserCheck className="w-4 h-4 text-yellow-600" />
                      <span className="text-sm font-medium">Review Verifications</span>
                    </div>
                    <span className="text-xs bg-yellow-500 text-white px-2 py-0.5 rounded-full font-bold">
                      {stats.pending_verifications}
                    </span>
                  </button>
                  <button onClick={() => setActiveTab('ads')} className="w-full flex items-center justify-between p-3 rounded-lg bg-blue-500/10 hover:bg-blue-500/20 transition-colors">
                    <div className="flex items-center gap-2">
                      <Megaphone className="w-4 h-4 text-blue-600" />
                      <span className="text-sm font-medium">Review User Ads</span>
                    </div>
                    <span className="text-xs bg-blue-500 text-white px-2 py-0.5 rounded-full font-bold">
                      {stats.pending_ads}
                    </span>
                  </button>
                  <button onClick={() => setActiveTab('fraud')} className="w-full flex items-center justify-between p-3 rounded-lg bg-red-500/10 hover:bg-red-500/20 transition-colors">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 text-red-600" />
                      <span className="text-sm font-medium">Fraud Alerts</span>
                    </div>
                    <span className="text-xs bg-red-500 text-white px-2 py-0.5 rounded-full font-bold">
                      {stats.fraud_alerts}
                    </span>
                  </button>
                  <button onClick={() => setActiveTab('fraud')} className="w-full flex items-center justify-between p-3 rounded-lg bg-orange-500/10 hover:bg-orange-500/20 transition-colors">
                    <div className="flex items-center gap-2">
                      <Flag className="w-4 h-4 text-orange-600" />
                      <span className="text-sm font-medium">Post Reports</span>
                    </div>
                    <span className="text-xs bg-orange-500 text-white px-2 py-0.5 rounded-full font-bold">
                      {pendingReports}
                    </span>
                  </button>
                  <Dialog open={createSponsoredOpen} onOpenChange={setCreateSponsoredOpen}>
                    <DialogTrigger asChild>
                      <button className="w-full flex items-center gap-2 p-3 rounded-lg bg-green-500/10 hover:bg-green-500/20 transition-colors">
                        <Plus className="w-4 h-4 text-green-600" />
                        <span className="text-sm font-medium">Create Sponsored Post</span>
                      </button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader><DialogTitle>Create Sponsored Content</DialogTitle></DialogHeader>
                      <div className="space-y-4 pt-4">
                        <div>
                          <label className="text-sm font-medium mb-2 block">Title</label>
                          <Input placeholder="Ad title" value={sponsoredForm.title} onChange={e => setSponsoredForm({ ...sponsoredForm, title: e.target.value })} />
                        </div>
                        <div>
                          <label className="text-sm font-medium mb-2 block">Content</label>
                          <Textarea placeholder="Ad body..." value={sponsoredForm.content} onChange={e => setSponsoredForm({ ...sponsoredForm, content: e.target.value })} rows={4} />
                        </div>
                        <div>
                          <label className="text-sm font-medium mb-2 block">Advertiser</label>
                          <Input placeholder="Company name" value={sponsoredForm.advertiser_name} onChange={e => setSponsoredForm({ ...sponsoredForm, advertiser_name: e.target.value })} />
                        </div>
                        <div>
                          <label className="text-sm font-medium mb-2 block">Budget ($)</label>
                          <Input type="number" placeholder="1000" value={sponsoredForm.budget} onChange={e => setSponsoredForm({ ...sponsoredForm, budget: e.target.value })} />
                        </div>
                        <Button onClick={handleCreateSponsored} className="w-full">Create</Button>
                      </div>
                    </DialogContent>
                  </Dialog>
                </div>
              </div>

              {/* Revenue Summary */}
              <div className="bg-card border border-border rounded-xl p-5 space-y-3">
                <h3 className="font-bold text-foreground flex items-center gap-2">
                  <DollarSign className="w-4 h-4 text-green-500" /> Revenue Summary
                </h3>
                <div className="space-y-3">
                  <div className="flex justify-between items-center p-3 bg-muted/30 rounded-lg">
                    <div>
                      <p className="text-xs text-muted-foreground">Creator Earnings Paid</p>
                      <p className="font-bold text-green-600">${stats.total_earnings_distributed.toFixed(2)}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-muted-foreground">Creator Share</p>
                      <p className="font-bold">30%</p>
                    </div>
                  </div>
                  <div className="flex justify-between items-center p-3 bg-muted/30 rounded-lg">
                    <div>
                      <p className="text-xs text-muted-foreground">Platform Revenue</p>
                      <p className="font-bold text-primary">${(stats.total_earnings_distributed / 0.3 * 0.7).toFixed(2)}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-muted-foreground">Platform Share</p>
                      <p className="font-bold">70%</p>
                    </div>
                  </div>
                  <div className="flex justify-between items-center p-3 bg-primary/10 rounded-lg">
                    <div>
                      <p className="text-xs text-muted-foreground">Total Gross Revenue</p>
                      <p className="font-bold text-foreground text-lg">${(stats.total_earnings_distributed / 0.3).toFixed(2)}</p>
                    </div>
                    <TrendingUp className="w-6 h-6 text-primary" />
                  </div>
                </div>
              </div>
            </div>

            {/* Platform Health */}
            <div className="bg-card border border-border rounded-xl p-5">
              <h3 className="font-bold text-foreground mb-3 flex items-center gap-2">
                <Activity className="w-4 h-4 text-primary" /> Platform Health
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="text-center">
                  <p className="text-2xl font-bold text-foreground">{formatNumber(stats.total_views)}</p>
                  <p className="text-xs text-muted-foreground mt-1">Total Views</p>
                </div>
                <div className="text-center">
                  <p className="text-2xl font-bold text-green-500">{stats.active_streams}</p>
                  <p className="text-xs text-muted-foreground mt-1">Live Streams</p>
                </div>
                <div className="text-center">
                  <p className="text-2xl font-bold text-purple-500">{formatNumber(stats.total_communities)}</p>
                  <p className="text-xs text-muted-foreground mt-1">Communities</p>
                </div>
                <div className="text-center">
                  <p className="text-2xl font-bold text-foreground">{formatNumber(stats.total_posts)}</p>
                  <p className="text-xs text-muted-foreground mt-1">Posts</p>
                </div>
              </div>
            </div>
          </TabsContent>

          {/* ── VERIFICATIONS ─────────────────────────────────────────────────── */}
          

          {/* ── ADS REVIEW ────────────────────────────────────────────────────── */}
          <TabsContent value="ads" className="space-y-4 mt-4">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-lg flex items-center gap-2">
                <Megaphone className="w-5 h-5 text-primary" /> User Ad Reviews
              </h3>
              <div className="flex gap-2">
                {(['all', 'pending', 'active', 'rejected'] as const).map(f => (
                  <button
                    key={f}
                    onClick={() => setAdFilter(f)}
                    className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${adFilter === f ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/80'}`}
                  >
                    {f}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-3">
              {filteredAds.map(ad => (
                <AdReviewCard
                  key={ad.id}
                  ad={ad}
                  actionLoading={actionLoading}
                  onApprove={id => handleAdReview(id, true)}
                  onReject={id => handleAdReview(id, false)}
                />
              ))}
              {filteredAds.length === 0 && (
                <EmptyState icon={Megaphone} title="No ads to review" subtitle={adFilter !== 'all' ? `No ${adFilter} ads` : 'All caught up!'} />
              )}
            </div>
          </TabsContent>

          {/* ── USERS ─────────────────────────────────────────────────────────── */}
          <TabsContent value="users" className="space-y-4 mt-4">
            <div className="flex items-center gap-3">
              <h3 className="font-bold text-lg flex items-center gap-2 flex-shrink-0">
                <Users className="w-5 h-5 text-primary" /> User Management
              </h3>
              <div className="flex-1 relative">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search users..."
                  value={userSearch}
                  onChange={e => setUserSearch(e.target.value)}
                  className="pl-9"
                />
              </div>
            </div>

            <div className="space-y-2">
              {filteredUsers.map(u => (
                <UserManageCard
                  key={u.id}
                  user={u}
                  actionLoading={actionLoading}
                  onBlock={() => handleBlockUser(u.id, u.is_blocked)}
                />
              ))}
              {filteredUsers.length === 0 && (
                <EmptyState icon={Users} title="No users found" subtitle="Try a different search term" />
              )}
            </div>
          </TabsContent>

          {/* ── FRAUD ALERTS ──────────────────────────────────────────────────── */}
          <TabsContent value="fraud" className="space-y-4 mt-4">
            <h3 className="font-bold text-lg flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-red-500" /> Fraud Alerts
            </h3>

            {/* ── Post Reports Section ── */}
            {reportedPosts.length > 0 && (
              <div className="space-y-3 mb-6">
                <h4 className="font-semibold text-base flex items-center gap-2">
                  <Flag className="w-4 h-4 text-orange-500" />
                  Post Reports
                  <span className="text-xs bg-orange-500 text-white px-2 py-0.5 rounded-full font-bold">{reportedPosts.length}</span>
                </h4>
                {reportedPosts.map((report: any) => (
                  <div key={report.id} className="bg-card border border-orange-500/30 rounded-xl p-4 space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs px-2 py-0.5 rounded-full font-bold bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400 capitalize">
                            {report.category?.replace(/_/g, ' ')}
                          </span>
                          <span className="text-xs text-muted-foreground">by @{report.reporter?.username}</span>
                        </div>
                        <p className="text-sm text-foreground line-clamp-2">{report.post?.content?.slice(0, 200)}</p>
                        <p className="text-xs text-muted-foreground mt-1">Author: @{report.post?.user_profiles?.username}</p>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" variant="destructive" className="flex-1" onClick={() => handleRemoveReportedPost(report.id, report.post_id)}>
                        <Trash2 className="w-3.5 h-3.5 mr-1" /> Remove Post
                      </Button>
                      <Button size="sm" variant="outline" className="flex-1" onClick={() => handleDismissReport(report.id)}>
                        <CheckCircle className="w-3.5 h-3.5 mr-1" /> Dismiss
                      </Button>
                    </div>
                  </div>
                ))}
                <div className="border-b border-border pt-2" />
              </div>
            )}

            <div className="space-y-3">
              {fraudAlerts.map(alert => (
                <FraudAlertCard
                  key={alert.id}
                  alert={alert}
                  actionLoading={actionLoading}
                  onResolve={() => handleResolveFraud(alert.id)}
                />
              ))}
              {fraudAlerts.length === 0 && (
                <EmptyState icon={Shield} title="No fraud alerts" subtitle="Platform is clean" />
              )}
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function AdReviewCard({ ad, actionLoading, onApprove, onReject }: {
  ad: UserAdEntry;
  actionLoading: string | null;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
}) {
  const isLoading = actionLoading === ad.id;
  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <div className="flex items-start justify-between mb-2">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <p className="font-bold text-foreground">{ad.title}</p>
            {ad.ai_verification_score !== undefined && (
              <span className={`text-xs px-2 py-0.5 rounded-full font-bold ${
                ad.ai_verification_score >= 0.7 ? 'bg-green-100 text-green-700' :
                ad.ai_verification_score >= 0.4 ? 'bg-yellow-100 text-yellow-700' :
                'bg-red-100 text-red-700'
              }`}>
                AI: {(ad.ai_verification_score * 100).toFixed(0)}%
              </span>
            )}
          </div>
          <p className="text-sm text-muted-foreground line-clamp-2">{ad.description}</p>
          <p className="text-xs text-muted-foreground mt-1">by @{ad.user?.username} • Budget: ${ad.budget}</p>
        </div>
        <StatusBadge status={ad.status} />
      </div>
      <div className="grid grid-cols-3 gap-2 text-xs text-center my-3">
        <div className="bg-muted/30 rounded p-2">
          <p className="text-muted-foreground">Impressions</p>
          <p className="font-bold">{formatNumber(ad.impressions)}</p>
        </div>
        <div className="bg-muted/30 rounded p-2">
          <p className="text-muted-foreground">Clicks</p>
          <p className="font-bold">{formatNumber(ad.clicks)}</p>
        </div>
        <div className="bg-muted/30 rounded p-2">
          <p className="text-muted-foreground">Spent</p>
          <p className="font-bold">${ad.spent?.toFixed(2)}</p>
        </div>
      </div>
      <p className="text-xs text-muted-foreground mb-3">
        {formatDistanceToNow(new Date(ad.created_at), { addSuffix: true })}
        {' · '}
        Payment: <StatusBadge status={ad.payment_status} />
      </p>
      {ad.status === 'pending' && (
        <div className="flex gap-2">
          <Button size="sm" className="flex-1 bg-green-600 hover:bg-green-700" disabled={isLoading} onClick={() => onApprove(ad.id)}>
            {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <><CheckCircle className="w-4 h-4 mr-1" /> Approve Ad</>}
          </Button>
          <Button size="sm" variant="destructive" className="flex-1" disabled={isLoading} onClick={() => onReject(ad.id)}>
            {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <><XCircle className="w-4 h-4 mr-1" /> Reject</>}
          </Button>
        </div>
      )}
    </div>
  );
}

function UserManageCard({ user, actionLoading, onBlock }: {
  user: ReportedUser;
  actionLoading: string | null;
  onBlock: () => void;
}) {
  const isLoading = actionLoading === user.id;
  return (
    <div className={`flex items-center justify-between p-3 rounded-xl border border-border bg-card ${user.is_blocked ? 'opacity-60' : ''}`}>
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-full bg-muted flex items-center justify-center font-bold text-sm flex-shrink-0">
          {user.username?.[0]?.toUpperCase()}
        </div>
        <div>
          <p className="font-semibold text-sm text-foreground flex items-center gap-1">
            @{user.username}
            {user.is_blocked && <Ban className="w-3 h-3 text-red-500" />}
          </p>
          <p className="text-xs text-muted-foreground">{formatNumber(user.follower_count)} followers</p>
        </div>
      </div>
      <Button
        size="sm"
        variant={user.is_blocked ? 'outline' : 'destructive'}
        disabled={isLoading}
        onClick={onBlock}
        className="text-xs"
      >
        {isLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : user.is_blocked ? <><Unlock className="w-3 h-3 mr-1" />Unblock</> : <><Ban className="w-3 h-3 mr-1" />Block</>}
      </Button>
    </div>
  );
}

function FraudAlertCard({ alert, actionLoading, onResolve }: {
  alert: FraudAlert;
  actionLoading: string | null;
  onResolve: () => void;
}) {
  const isLoading = actionLoading === alert.id;
  const severityColor = { high: 'text-red-500 bg-red-500/10', medium: 'text-yellow-500 bg-yellow-500/10', low: 'text-blue-500 bg-blue-500/10' }[alert.severity] || 'text-muted-foreground bg-muted';
  return (
    <div className={`bg-card border rounded-xl p-4 ${alert.resolved ? 'border-border opacity-50' : 'border-red-500/30'}`}>
      <div className="flex items-start justify-between mb-2">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className={`text-xs px-2 py-0.5 rounded-full font-bold capitalize ${severityColor}`}>
              {alert.severity}
            </span>
            <span className="text-xs text-muted-foreground capitalize">{alert.alert_type.replace(/_/g, ' ')}</span>
          </div>
          {alert.user && <p className="text-sm font-medium">@{alert.user.username}</p>}
          <p className="text-xs text-muted-foreground mt-1">{formatDistanceToNow(new Date(alert.created_at), { addSuffix: true })}</p>
        </div>
        {!alert.resolved && (
          <Button size="sm" variant="outline" disabled={isLoading} onClick={onResolve}>
            {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <><CheckCircle className="w-4 h-4 mr-1" />Resolve</>}
          </Button>
        )}
        {alert.resolved && <span className="text-xs text-green-600 font-semibold flex items-center gap-1"><CheckCircle className="w-3 h-3" />Resolved</span>}
      </div>
      {alert.details && typeof alert.details === 'object' && (
        <div className="mt-2 bg-muted/40 rounded-lg p-2">
          <p className="text-xs font-mono text-muted-foreground">
            {JSON.stringify(alert.details, null, 2).slice(0, 200)}
          </p>
        </div>
      )}
    </div>
  );
}

function EmptyState({ icon: Icon, title, subtitle }: { icon: any; title: string; subtitle: string }) {
  return (
    <div className="text-center py-16 text-muted-foreground">
      <Icon className="w-10 h-10 mx-auto mb-3 opacity-30" />
      <p className="font-medium">{title}</p>
      <p className="text-sm mt-1">{subtitle}</p>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    pending: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
    approved: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
    active: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
    rejected: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
    paid: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
    unpaid: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400',
  };
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-semibold capitalize ${map[status] || 'bg-muted text-muted-foreground'}`}>
      {status}
    </span>
  );
}
