import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { TopBar } from '@/components/layout/TopBar';
import { useIsRegulator, FEATURE_KEYS, FEATURE_LABELS, type FeatureKey } from '@/hooks/useFeatureUnlock';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { Shield, Users, Unlock, Lock, Check, X, Loader2, Search,
  UserPlus, Briefcase, Trash2, Crown, Settings, ChevronRight,
  BarChart3, Bell, Star, Eye, TrendingUp, AlertTriangle,
  DollarSign, Wallet, Send, Megaphone, RefreshCw, Activity,
  ArrowUpRight, ArrowDownRight, Ban, AlertCircle, CheckCircle,
  XCircle, Zap, ShieldAlert, Flag, MessageSquare, BadgeCheck,
  Download, FileText, BadgeX, Mail, AtSign, Image as ImageIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';
import { formatNumber } from '@/lib/utils';
import { FunctionsHttpError } from '@supabase/supabase-js';

// Module-level constants — esbuild guard
const DEPT_OPTIONS = ['Engineering', 'Content', 'Marketing', 'Moderation', 'Finance', 'Design', 'Operations'] as const;
const REG_PANEL_TABS = ['employees', 'features', 'wallets', 'moderation', 'platform', 'announce', 'reports', 'audit', 'analytics'] as const;
type RegTab = typeof REG_PANEL_TABS[number];

const REG_TAB_DEFS = [
  { key: 'employees',  label: 'Team',       Icon: Briefcase   },
  { key: 'features',   label: 'Features',   Icon: Lock        },
  { key: 'wallets',    label: 'Wallets',    Icon: Wallet      },
  { key: 'moderation', label: 'Moderation', Icon: Shield      },
  { key: 'platform',   label: 'Platform',   Icon: Settings    },
  { key: 'announce',   label: 'Announce',   Icon: Megaphone   },
  { key: 'reports',    label: 'Reports',    Icon: TrendingUp  },
  { key: 'audit',      label: 'Audit Log',  Icon: FileText    },
  { key: 'analytics', label: 'Analytics',  Icon: TrendingUp  },
] as const;

function getScoreColor(score: number): string {
  if (score >= 80) return 'text-red-600';
  if (score >= 50) return 'text-orange-500';
  return 'text-green-600';
}
function getScoreBg(score: number): string {
  if (score >= 80) return 'bg-red-500/10 border-red-500/20';
  if (score >= 50) return 'bg-orange-500/10 border-orange-500/20';
  return 'bg-green-500/10 border-green-500/20';
}
function getActionLabel(action: string): string {
  if (action === 'auto_ban') return '🚫 Auto-banned';
  if (action === 'flag') return '🚩 Flagged';
  return '✅ Passed';
}
// Module-level helpers for analytics — esbuild guard (no index-sig objects)
function buildAnalyticsDayKeys(): string[] {
  const keys: string[] = [];
  for (let i = 29; i >= 0; i--) keys.push(new Date(Date.now() - i * 86400000).toISOString().slice(0, 10));
  return keys;
}
function buildCountArr(rows: any[], dateKeys: string[], field: string): number[] {
  const arr = new Array<number>(dateKeys.length).fill(0);
  for (const row of rows) {
    const d = String(row[field] ?? '').slice(0, 10);
    const idx = dateKeys.indexOf(d);
    if (idx >= 0) arr[idx]++;
  }
  return arr;
}
function buildRevArr(rows: any[], dateKeys: string[]): number[] {
  const arr = new Array<number>(dateKeys.length).fill(0);
  for (const row of rows) {
    const d = String(row.created_at ?? '').slice(0, 10);
    const idx = dateKeys.indexOf(d);
    if (idx >= 0) arr[idx] += Number(row.amount ?? 0);
  }
  return arr;
}

// Pure helper — replaces Object.entries in render scope (esbuild guard)
function getTopCategory(cats: any): { key: string; score: number } | null {
  let bestKey = '';
  let bestScore = -1;
  const keys = Object.keys(cats ?? {});
  for (let i = 0; i < keys.length; i++) {
    const s = Number(cats[keys[i]] ?? 0);
    if (s > bestScore) { bestScore = s; bestKey = keys[i]; }
  }
  return bestKey ? { key: bestKey, score: bestScore } : null;
}

export default function RegulatorPanel() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const isReg = useIsRegulator();

  const [activeTab, setActiveTab] = useState<RegTab>('employees');
  const [loading, setLoading] = useState(true);

  const [employees, setEmployees] = useState<any[]>([]);
  const [showHireDialog, setShowHireDialog] = useState(false);
  const [hireSearch, setHireSearch] = useState('');
  const [hireResults, setHireResults] = useState<any[]>([]);
  const [hireForm, setHireForm] = useState({ job_title: '', department: 'Engineering', notes: '', rev_share_pct: '0' });
  const [selectedHireUser, setSelectedHireUser] = useState<any | null>(null);
  const [hiring, setHiring] = useState(false);
  const [editingRevShare, setEditingRevShare] = useState<string | null>(null);
  const [revShareInput, setRevShareInput] = useState('');
  const [savingRevShare, setSavingRevShare] = useState(false);

  const [unlockSearch, setUnlockSearch] = useState('');
  const [unlockResults, setUnlockResults] = useState<any[]>([]);
  const [selectedUnlockUser, setSelectedUnlockUser] = useState<any | null>(null);
  const [lockedFeatures, setLockedFeatures] = useState<FeatureKey[]>([]);
  const [savingLocks, setSavingLocks] = useState(false);

  const [walletSearch, setWalletSearch] = useState('');
  const [walletSearchResults, setWalletSearchResults] = useState<any[]>([]);
  const [selectedWalletUser, setSelectedWalletUser] = useState<any | null>(null);
  const [walletData, setWalletData] = useState<any | null>(null);
  const [walletTxns, setWalletTxns] = useState<any[]>([]);
  const [walletEarnings, setWalletEarnings] = useState<any | null>(null);
  const [loadingWallet, setLoadingWallet] = useState(false);
  const [topWallets, setTopWallets] = useState<any[]>([]);
  const [loadingTopWallets, setLoadingTopWallets] = useState(false);
  const [showTopUp, setShowTopUp] = useState(false);
  const [topUpAmount, setTopUpAmount] = useState('');
  const [toppingUp, setToppingUp] = useState(false);
  const [topUpNote, setTopUpNote] = useState('');

  const [annSubject, setAnnSubject] = useState('');
  const [annBody, setAnnBody] = useState('');
  const [annEmoji, setAnnEmoji] = useState('📣');
  const [annCtaLabel, setAnnCtaLabel] = useState('');
  const [annCtaUrl, setAnnCtaUrl] = useState('');
  const [sendingAnn, setSendingAnn] = useState(false);
  const [annSent, setAnnSent] = useState(false);

  // Audit log
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [loadingAudit, setLoadingAudit] = useState(false);
  const [auditFilter, setAuditFilter] = useState('all');

  const [platformStats, setPlatformStats] = useState({ users: 0, posts: 0, live_spaces: 0 });
  const [recentUsers, setRecentUsers] = useState<any[]>([]);
  const [platformRevenue, setPlatformRevenue] = useState(0);

  const [modLogs, setModLogs] = useState<any[]>([]);
  const [bannedUsers, setBannedUsers] = useState<any[]>([]);
  const [pendingAppeals, setPendingAppeals] = useState<any[]>([]);
  const [loadingMod, setLoadingMod] = useState(false);
  const [scanningPosts, setScanningPosts] = useState(false);
  const [scanResult, setScanResult] = useState<{ scanned: number; flagged: number; banned: number } | null>(null);
  const [modFilter, setModFilter] = useState<'all' | 'flag' | 'auto_ban' | 'unreviewed'>('unreviewed');
  const [appealNote, setAppealNote] = useState<{ [id: string]: string }>({});
  const [modChartData, setModChartData] = useState<{ date: string; flagged: number; banned: number }[]>([]);

  // Announcements archive
  const [annArchive, setAnnArchive] = useState<any[]>([]);
  const [loadingArchive, setLoadingArchive] = useState(false);

  // Platform user search
  const [platformSearch, setPlatformSearch] = useState('');
  const [platformSearchResults, setPlatformSearchResults] = useState<any[]>([]);
  const [platformSelectedUser, setPlatformSelectedUser] = useState<any | null>(null);
  const [platformUserBan, setPlatformUserBan] = useState<any | null>(null);

  // Analytics tab
  const [analyticsData, setAnalyticsData] = useState<{
    days: string[];
    signups: number[];
    posts: number[];
    revenue: number[];
    topHashtags: { tag: string; count: number }[];
  } | null>(null);
  const [loadingAnalytics, setLoadingAnalytics] = useState(false);

  // Ad review queue
  const [adQueue, setAdQueue] = useState<any[]>([]);
  const [loadingAdQueue, setLoadingAdQueue] = useState(false);
  const [verifyingAd, setVerifyingAd] = useState<string | null>(null);

  useEffect(() => {
    if (!isReg) { navigate('/'); return; }
    fetchEmployees();
    fetchPlatformStats();
    setLoading(false);
  }, [isReg]);

  useEffect(() => {
    if (activeTab === 'wallets' && topWallets.length === 0) fetchTopWallets();
    if (activeTab === 'moderation' && modLogs.length === 0) fetchModeration();
    if (activeTab === 'moderation') fetchModChartData();
    if (activeTab === 'announce') fetchAnnArchive();
    if (activeTab === 'reports') fetchAdQueue();
    if (activeTab === 'audit') fetchAuditLogs();
    if (activeTab === 'analytics' && !analyticsData) fetchAnalytics();
  }, [activeTab]);

  const fetchAuditLogs = useCallback(async () => {
    setLoadingAudit(true);
    const { data } = await supabase
      .from('regulator_audit_logs')
      .select('*, target_user:target_user_id(username, avatar_url)')
      .order('created_at', { ascending: false })
      .limit(100);
    setAuditLogs(data ?? []);
    setLoadingAudit(false);
  }, []);

  const logAudit = useCallback(async (action_type: string, target_user_id: string | null, notes: string) => {
    if (!user) return;
    supabase.from('regulator_audit_logs').insert({
      regulator_id: user.id, action_type, target_user_id: target_user_id ?? null, notes,
    }).then(() => {}).then(() => {}).catch(() => {});
  }, [user]);

  const fetchEmployees = useCallback(async () => {
    const { data } = await supabase
      .from('employee_assignments')
      .select('*, user_profiles:user_id(id, username, avatar_url, verified, followers_count)')
      .eq('is_active', true)
      .order('created_at', { ascending: false });
    setEmployees(data ?? []);
  }, []);

  const fetchPlatformStats = useCallback(async () => {
    const [usersRes, postsRes, spacesRes] = await Promise.all([
      supabase.from('user_profiles').select('*', { count: 'exact', head: true }),
      supabase.from('posts').select('*', { count: 'exact', head: true }),
      supabase.from('spaces').select('*', { count: 'exact', head: true }).eq('is_live', true),
    ]);
    setPlatformStats({
      users:       usersRes.count ?? 0,
      posts:       postsRes.count ?? 0,
      live_spaces: spacesRes.count ?? 0,
    });
    const { data: earningsData } = await supabase.from('creator_earnings').select('amount').eq('status', 'paid');
    const total = (earningsData ?? []).reduce((s: number, e: any) => s + Number(e.amount ?? 0), 0);
    setPlatformRevenue(total);
    const { data: recent } = await supabase.from('user_profiles')
      .select('id, username, avatar_url, verified, created_at')
      .order('created_at', { ascending: false }).limit(10);
    setRecentUsers(recent ?? []);
  }, []);

  const fetchTopWallets = useCallback(async () => {
    setLoadingTopWallets(true);
    const { data } = await supabase
      .from('user_wallets')
      .select('balance, credits, user_id, user_profiles:user_id(username, avatar_url, verified)')
      .order('balance', { ascending: false })
      .limit(20);
    setTopWallets(data ?? []);
    setLoadingTopWallets(false);
  }, []);

  const searchUsersToHire = useCallback(async (q: string) => {
    if (!q.trim()) { setHireResults([]); return; }
    const { data } = await supabase.from('user_profiles')
      .select('id, username, avatar_url, verified, followers_count')
      .ilike('username', `${q}%`).limit(8);
    setHireResults(data ?? []);
  }, []);

  const handleHire = useCallback(async () => {
    if (!selectedHireUser || !hireForm.job_title.trim() || !user) return;
    setHiring(true);
    const revPct = Math.max(0, Math.min(100, Number(hireForm.rev_share_pct) || 0));
    const { error } = await supabase.from('employee_assignments').upsert({
      user_id: selectedHireUser.id, job_title: hireForm.job_title.trim(),
      department: hireForm.department, notes: hireForm.notes.trim(),
      assigned_by: user.id, is_active: true,
      permissions: { revenue_share_pct: revPct },
    }, { onConflict: 'user_id' });
    if (error) { toast.error(error.message); setHiring(false); return; }
    await supabase.from('platform_inbox').insert({
      user_id: selectedHireUser.id,
      subject: `🎉 You've been hired on Testagram!`,
      body: `The platform regulator has assigned you the role of "${hireForm.job_title}" in ${hireForm.department}.${hireForm.notes ? '\n\nNote: ' + hireForm.notes : ''}${revPct > 0 ? `\n\n💰 Revenue share: ${revPct}%` : ''} Welcome to the team!`,
      type: 'update', icon_emoji: '🎉', cta_label: 'Open Team Chat', cta_url: '/team-chat',
    }).then(() => {}).catch(() => {});
    toast.success(`@${selectedHireUser.username} hired!`);
    await logAudit('hire_employee', selectedHireUser.id, 'Hired as ' + hireForm.job_title + ' in ' + hireForm.department);
    setShowHireDialog(false); setSelectedHireUser(null);
    setHireForm({ job_title: '', department: 'Engineering', notes: '', rev_share_pct: '0' });
    setHireSearch(''); setHireResults([]);
    setHiring(false); fetchEmployees();
  }, [selectedHireUser, hireForm, user, fetchEmployees]);

  const handleFire = useCallback(async (empId: string, username: string) => {
    if (!window.confirm(`Remove @${username} from employees?`)) return;
    await supabase.from('employee_assignments').update({ is_active: false }).eq('id', empId);
    toast.success(`@${username} removed`);
    fetchEmployees();
  }, [fetchEmployees]);

  const handleGrantVerified = useCallback(async (empUserId: string, username: string, isVerified: boolean) => {
    await supabase.from('user_profiles').update({ verified: !isVerified }).eq('id', empUserId);
    if (!isVerified) {
      await supabase.from('platform_inbox').insert({
        user_id: empUserId,
        subject: '✅ You are now verified on Testagram!',
        body: 'The platform regulator has granted you a verified badge. Your profile now shows the blue checkmark ✓',
        type: 'update', icon_emoji: '✅',
      }).then(() => {}).catch(() => {});
      toast.success(`@${username} verified!`);
      await logAudit('grant_verified', empUserId, 'Granted verified badge to @' + username);
    } else {
      toast.success(`@${username} unverified`);
      await logAudit('remove_verified', empUserId, 'Removed verified badge from @' + username);
    }
    fetchEmployees();
  }, [fetchEmployees]);

  const handleExportPayroll = useCallback(() => {
    if (employees.length === 0) { toast.error('No employees to export'); return; }
    const rows = ['Username,Job Title,Department,Revenue Share %,Est. Dollar Amount'];
    for (const emp of employees) {
      const pct = emp.permissions?.revenue_share_pct ?? 0;
      const amt = (platformRevenue * pct / 100).toFixed(2);
      rows.push(`"${emp.user_profiles?.username ?? ''}","${emp.job_title}","${emp.department}",${pct},$${amt}`);
    }
    const csv = rows.join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `payroll_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Payroll CSV downloaded!');
  }, [employees, platformRevenue]);

  const handleSaveRevShare = useCallback(async (empId: string, empUserId: string, username: string) => {
    const pct = Math.max(0, Math.min(100, Number(revShareInput) || 0));
    setSavingRevShare(true);
    const { data: existing } = await supabase.from('employee_assignments').select('permissions').eq('id', empId).maybeSingle();
    const perms = existing?.permissions ?? {};
    await supabase.from('employee_assignments').update({ permissions: { ...perms, revenue_share_pct: pct } }).eq('id', empId);
    await supabase.from('platform_inbox').insert({
      user_id: empUserId,
      subject: `💰 Revenue share updated: ${pct}%`,
      body: `The platform regulator has set your revenue share to ${pct}% of platform earnings.`,
      type: 'update', icon_emoji: '💰',
    }).then(() => {}).catch(() => {});
    toast.success(`Revenue share set to ${pct}% for @${username}`);
    setEditingRevShare(null); setRevShareInput(''); setSavingRevShare(false);
    fetchEmployees();
  }, [revShareInput, fetchEmployees]);

  const searchUsersToManage = useCallback(async (q: string) => {
    if (!q.trim()) { setUnlockResults([]); return; }
    const { data } = await supabase.from('user_profiles')
      .select('id, username, avatar_url, verified').ilike('username', `${q}%`).limit(8);
    setUnlockResults(data ?? []);
  }, []);

  const selectUserToManage = useCallback(async (profile: any) => {
    setSelectedUnlockUser(profile);
    setUnlockResults([]);
    setUnlockSearch(profile.username);
    const { data } = await supabase.from('user_feature_unlocks').select('feature_key')
      .eq('user_id', profile.id).eq('is_locked', true);
    setLockedFeatures((data ?? []).map((r: any) => r.feature_key as FeatureKey));
  }, []);

  const toggleFeatureLock = (key: FeatureKey) => {
    setLockedFeatures(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]);
  };

  const saveFeatureLocks = useCallback(async () => {
    if (!selectedUnlockUser || !user) return;
    setSavingLocks(true);
    await supabase.from('user_feature_unlocks').delete()
      .eq('user_id', selectedUnlockUser.id).eq('is_locked', true);
    if (lockedFeatures.length > 0) {
      await supabase.from('user_feature_unlocks').upsert(
        lockedFeatures.map(fk => ({ user_id: selectedUnlockUser.id, feature_key: fk, unlocked_by: user.id, is_locked: true })),
        { onConflict: 'user_id,feature_key' }
      );
      await supabase.from('platform_inbox').insert({
        user_id: selectedUnlockUser.id,
        subject: `🔒 Feature access updated`,
        body: `${lockedFeatures.length} feature(s) restricted: ${lockedFeatures.map(k => FEATURE_LABELS[k] ?? k).join(', ')}.`,
        type: 'update', icon_emoji: '🔒',
      }).then(() => {}).catch(() => {});
    }
    toast.success(`Feature locks saved for @${selectedUnlockUser.username}`);
    setSavingLocks(false);
  }, [selectedUnlockUser, lockedFeatures, user]);

  const searchWalletUsers = useCallback(async (q: string) => {
    if (!q.trim()) { setWalletSearchResults([]); return; }
    const { data } = await supabase.from('user_profiles')
      .select('id, username, avatar_url, verified').ilike('username', `${q}%`).limit(8);
    setWalletSearchResults(data ?? []);
  }, []);

  const viewUserWallet = useCallback(async (profile: any) => {
    setSelectedWalletUser(profile);
    setWalletSearchResults([]);
    setWalletSearch(profile.username);
    setLoadingWallet(true);
    const [walletRes, txnRes, earnRes] = await Promise.all([
      supabase.from('user_wallets').select('*').eq('user_id', profile.id).maybeSingle(),
      supabase.from('wallet_transactions').select('*').eq('user_id', profile.id).order('created_at', { ascending: false }).limit(20),
      supabase.from('user_monetization').select('*').eq('user_id', profile.id).maybeSingle(),
    ]);
    setWalletData(walletRes.data ?? null);
    setWalletTxns(txnRes.data ?? []);
    setWalletEarnings(earnRes.data ?? null);
    setLoadingWallet(false);
  }, []);

  const handleTopUp = useCallback(async () => {
    if (!selectedWalletUser || !topUpAmount || !user) return;
    const amount = Number(topUpAmount);
    if (!amount || amount <= 0) { toast.error('Enter a valid amount'); return; }
    setToppingUp(true);
    const { error } = await supabase.rpc('add_to_wallet', { p_user_id: selectedWalletUser.id, p_amount: amount });
    if (error) { toast.error(error.message); setToppingUp(false); return; }
    const { data: walletRow } = await supabase.from('user_wallets').select('id').eq('user_id', selectedWalletUser.id).maybeSingle();
    if (walletRow) {
      await supabase.from('wallet_transactions').insert({
        wallet_id: walletRow.id, user_id: selectedWalletUser.id, type: 'credit', amount,
        description: topUpNote.trim() || `Regulator top-up by @${user.username}`, status: 'completed',
      }).then(() => {}).catch(() => {});
    }
    await supabase.from('platform_inbox').insert({
      user_id: selectedWalletUser.id,
      subject: `💰 Wallet top-up: +$${amount.toFixed(2)}`,
      body: `The platform regulator has added $${amount.toFixed(2)} to your wallet.${topUpNote ? '\n\nNote: ' + topUpNote : ''}`,
      type: 'update', icon_emoji: '💰',
    }).then(() => {}).catch(() => {});
    toast.success(`$${amount.toFixed(2)} added to @${selectedWalletUser.username}'s wallet!`);
    setShowTopUp(false); setTopUpAmount(''); setTopUpNote('');
    setToppingUp(false);
    viewUserWallet(selectedWalletUser);
  }, [selectedWalletUser, topUpAmount, topUpNote, user, viewUserWallet]);

  const fetchModChartData = useCallback(async () => {
    const since = new Date(Date.now() - 30 * 24 * 3600000).toISOString();
    const { data } = await supabase
      .from('content_moderation_logs')
      .select('action, created_at')
      .gte('created_at', since)
      .neq('action', 'pass');
    const dateMap: { [d: string]: { flagged: number; banned: number } } = {};
    for (const log of data ?? []) {
      const d = (log.created_at as string).slice(0, 10);
      if (!dateMap[d]) dateMap[d] = { flagged: 0, banned: 0 };
      if (log.action === 'flag') dateMap[d].flagged++;
      else if (log.action === 'auto_ban') dateMap[d].banned++;
    }
    const result: { date: string; flagged: number; banned: number }[] = [];
    for (let i = 29; i >= 0; i--) {
      const iso = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
      result.push({ date: iso.slice(5), flagged: dateMap[iso]?.flagged ?? 0, banned: dateMap[iso]?.banned ?? 0 });
    }
    setModChartData(result);
  }, []);

  const fetchAnnArchive = useCallback(async () => {
    setLoadingArchive(true);
    const { data } = await supabase
      .from('platform_inbox')
      .select('*')
      .is('user_id', null)
      .order('sent_at', { ascending: false })
      .limit(20);
    setAnnArchive(data ?? []);
    setLoadingArchive(false);
  }, []);

  const searchPlatformUsers = useCallback(async (q: string) => {
    if (!q.trim()) { setPlatformSearchResults([]); return; }
    const { data } = await supabase
      .from('user_profiles')
      .select('id, username, email, avatar_url, verified, is_blocked, strike_count, created_at, followers_count')
      .or(`username.ilike.${q}%,email.ilike.${q}%`)
      .limit(8);
    setPlatformSearchResults(data ?? []);
  }, []);

  const selectPlatformUser = useCallback(async (profile: any) => {
    setPlatformSelectedUser(profile);
    setPlatformSearchResults([]);
    setPlatformSearch(profile.username);
    const { data: ban } = await supabase
      .from('user_bans')
      .select('*')
      .eq('user_id', profile.id)
      .eq('is_active', true)
      .order('banned_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    setPlatformUserBan(ban ?? null);
  }, []);

  const fetchAdQueue = useCallback(async () => {
    setLoadingAdQueue(true);
    const { data } = await supabase
      .from('user_ads')
      .select('*, user_profiles:user_id(id, username, avatar_url)')
      .in('status', ['pending'])
      .order('created_at', { ascending: false })
      .limit(20);
    setAdQueue(data ?? []);
    setLoadingAdQueue(false);
  }, []);

  const handleVerifyAd = useCallback(async (ad: any) => {
    if (!user) return;
    setVerifyingAd(ad.id);
    try {
      const { data, error } = await supabase.functions.invoke('ai-moderation', {
        body: { ad_id: ad.id, ad_title: ad.title, ad_description: ad.description, ad_image_url: ad.image_url },
      });
      if (error) {
        let msg = error.message;
        if (error instanceof FunctionsHttpError) { msg = await error.context?.text?.() ?? msg; }
        toast.error(`AI check failed: ${msg}`);
      } else {
        toast.success(`AI verified: ${data.action} (score ${data.overall_score}/100)`);
        fetchAdQueue();
      }
    } catch (err: any) { toast.error(err.message ?? 'Verification failed'); }
    setVerifyingAd(null);
  }, [user, fetchAdQueue]);

  const handleApproveAd = useCallback(async (adId: string, adUserId: string, adTitle: string) => {
    await supabase.from('user_ads').update({ status: 'active', verified_by: user?.id ?? null, verified_at: new Date().toISOString() }).eq('id', adId);
    await supabase.from('platform_inbox').insert({
      user_id: adUserId, subject: '✅ Your advertisement is approved!',
      body: `Your ad "${adTitle}" has been approved by the platform regulator and is now live.`,
      type: 'update', icon_emoji: '✅',
    }).then(() => {}).catch(() => {});
    toast.success(`Ad approved!`);
    await logAudit('approve_ad', adUserId, 'Ad approved: "' + adTitle.slice(0, 60) + '"');
    fetchAdQueue();
  }, [user, fetchAdQueue]);

  const handleRejectAd = useCallback(async (adId: string, adUserId: string, adTitle: string) => {
    await supabase.from('user_ads').update({ status: 'rejected', verified_by: user?.id ?? null, verified_at: new Date().toISOString() }).eq('id', adId);
    await supabase.from('platform_inbox').insert({
      user_id: adUserId, subject: '❌ Your advertisement was rejected',
      body: `Your ad "${adTitle}" was rejected for not meeting platform content guidelines. Please review our policies and resubmit.`,
      type: 'update', icon_emoji: '❌', cta_label: 'Create New Ad', cta_url: '/create-ad',
    }).then(() => {}).catch(() => {});
    toast.success('Ad rejected');
    await logAudit('reject_ad', adUserId, 'Ad rejected: "' + adTitle.slice(0, 60) + '"');
    fetchAdQueue();
  }, [user, fetchAdQueue]);

  const fetchModeration = useCallback(async () => {
    setLoadingMod(true);
    const [logsRes, bansRes, appealsRes] = await Promise.all([
      supabase.from('content_moderation_logs')
        .select('*, user_profiles:user_id(id, username, avatar_url), posts(content)')
        .neq('action', 'pass').order('created_at', { ascending: false }).limit(50),
      supabase.from('user_bans')
        .select('*, user_profiles:user_id(id, username, avatar_url, is_blocked, strike_count)')
        .eq('is_active', true).order('banned_at', { ascending: false }).limit(20),
      supabase.from('moderation_appeals')
        .select('*, user_profiles:user_id(id, username, avatar_url)')
        .eq('status', 'pending').order('created_at', { ascending: false }).limit(20),
    ]);
    setModLogs(logsRes.data ?? []);
    setBannedUsers(bansRes.data ?? []);
    setPendingAppeals(appealsRes.data ?? []);
    setLoadingMod(false);
  }, []);

  const handleScanPosts = useCallback(async () => {
    setScanningPosts(true); setScanResult(null);
    try {
      const { data, error } = await supabase.functions.invoke('ai-moderation', { body: { scan_recent: true } });
      if (error) {
        let msg = error.message;
        if (error instanceof FunctionsHttpError) { msg = await error.context?.text?.() ?? msg; }
        toast.error(`Scan failed: ${msg}`);
      } else {
        setScanResult({ scanned: data.scanned, flagged: data.flagged, banned: data.banned });
        toast.success(data.message);
        fetchModeration();
      }
    } catch (err: any) { toast.error(err.message ?? 'Scan failed'); }
    setScanningPosts(false);
  }, [fetchModeration]);

  const handleLiftBan = useCallback(async (banId: string, userId: string, username: string) => {
    if (!user) return;
    await supabase.from('user_bans').update({ is_active: false, lifted_at: new Date().toISOString(), lifted_by: user.id }).eq('id', banId);
    await supabase.from('user_profiles').update({ is_blocked: false }).eq('id', userId);
    await supabase.from('platform_inbox').insert({
      user_id: userId, subject: '✅ Your account restriction has been lifted',
      body: 'The platform regulator has reviewed your case and lifted your account restriction.',
      type: 'update', icon_emoji: '✅',
    }).then(() => {}).catch(() => {});
    toast.success(`@${username}'s ban lifted`);
    await logAudit('lift_ban', userId, 'Ban lifted for @' + username);
    fetchModeration();
  }, [user, fetchModeration]);

  const handleResetStrikes = useCallback(async (userId: string, username: string) => {
    await supabase.from('user_profiles').update({ strike_count: 0 }).eq('id', userId);
    await supabase.from('platform_inbox').insert({
      user_id: userId, subject: '🔄 Strike count reset',
      body: 'The platform regulator has reset your strike count to 0, giving you a clean slate.',
      type: 'update', icon_emoji: '🔄',
    }).then(() => {}).catch(() => {});
    toast.success(`Strikes reset for @${username}`);
    await logAudit('reset_strikes', userId, 'Strike count reset to 0 for @' + username);
    fetchModeration();
  }, [fetchModeration]);

  const handleReviewAppeal = useCallback(async (appealId: string, decision: 'approved' | 'denied', appeal: any) => {
    if (!user) return;
    const note = appealNote[appealId]?.trim() ?? '';
    await supabase.from('moderation_appeals').update({
      status: decision, reviewed_by: user.id, reviewed_at: new Date().toISOString(), regulator_note: note || null,
    }).eq('id', appealId);
    if (decision === 'approved' && appeal.ban_id) {
      await supabase.from('user_bans').update({ is_active: false, lifted_at: new Date().toISOString(), lifted_by: user.id }).eq('id', appeal.ban_id);
      await supabase.from('user_profiles').update({ is_blocked: false }).eq('id', appeal.user_id);
    }
    const msgBody = decision === 'approved'
      ? `Great news! Your appeal has been approved. Your account restriction has been lifted.${note ? '\n\nNote: ' + note : ''}`
      : `Your appeal has been reviewed and could not be approved at this time.${note ? '\n\nNote: ' + note : ''}`;
    await supabase.from('platform_inbox').insert({
      user_id: appeal.user_id,
      subject: decision === 'approved' ? '✅ Appeal Approved' : '❌ Appeal Denied',
      body: msgBody, type: 'update', icon_emoji: decision === 'approved' ? '✅' : '❌',
    }).then(() => {}).catch(() => {});
    toast.success(`Appeal ${decision}`);
    setAppealNote(prev => { const n = { ...prev }; delete n[appealId]; return n; });
    fetchModeration();
  }, [user, appealNote, fetchModeration]);

  const handleReviewLog = useCallback(async (logId: string, decision: 'confirm' | 'dismiss') => {
    if (!user) return;
    await supabase.from('content_moderation_logs').update({
      reviewed: true, reviewed_by: user.id, reviewed_at: new Date().toISOString(), review_decision: decision,
    }).eq('id', logId);
    toast.success(decision === 'confirm' ? 'Action confirmed' : 'Flag dismissed');
    fetchModeration();
  }, [user, fetchModeration]);

  const handleManualBan = useCallback(async (userId: string, username: string) => {
    if (!user) return;
    if (!window.confirm(`Manually ban @${username} for 24 hours?`)) return;
    await supabase.from('user_profiles').update({ is_blocked: true }).eq('id', userId);
    const expires = new Date(Date.now() + 24 * 3600000).toISOString();
    await supabase.from('user_bans').insert({
      user_id: userId, banned_by: user.id, reason: 'Manual ban by regulator',
      ban_type: 'temporary', duration_hours: 24, expires_at: expires,
    });
    await supabase.from('platform_inbox').insert({
      user_id: userId, subject: '🚫 Your account has been temporarily restricted',
      body: 'A platform moderator has temporarily restricted your account for 24 hours due to a policy violation.',
      type: 'update', icon_emoji: '🚫',
    }).then(() => {}).catch(() => {});
    toast.success(`@${username} banned for 24h`);
    await logAudit('manual_ban', userId, 'Manual 24h ban applied to @' + username);
    fetchModeration();
  }, [user, fetchModeration]);

  const fetchAnalytics = useCallback(async () => {
    setLoadingAnalytics(true);
    const dayKeys = buildAnalyticsDayKeys();
    const since = dayKeys[0];
    const [usersRes, postsRes, earningsRes, hashtagsRes] = await Promise.all([
      supabase.from('user_profiles').select('created_at').gte('created_at', since + 'T00:00:00Z'),
      supabase.from('posts').select('created_at').gte('created_at', since + 'T00:00:00Z'),
      supabase.from('creator_earnings').select('amount, created_at').eq('status', 'paid').gte('created_at', since + 'T00:00:00Z'),
      supabase.from('hashtags').select('tag, usage_count').order('usage_count', { ascending: false }).limit(10),
    ]);
    const signups = buildCountArr(usersRes.data ?? [], dayKeys, 'created_at');
    const postCounts = buildCountArr(postsRes.data ?? [], dayKeys, 'created_at');
    const revenue = buildRevArr(earningsRes.data ?? [], dayKeys);
    const topHashtags = (hashtagsRes.data ?? []).map((h: any) => ({ tag: h.tag, count: h.usage_count ?? 0 }));
    setAnalyticsData({ days: dayKeys, signups, posts: postCounts, revenue, topHashtags });
    setLoadingAnalytics(false);
  }, []);

  const handleBroadcast = useCallback(async () => {
    if (!annSubject.trim() || !annBody.trim()) return;
    setSendingAnn(true);
    const { error } = await supabase.from('platform_inbox').insert({
      user_id: null, subject: annSubject.trim(), body: annBody.trim(),
      type: 'news', icon_emoji: annEmoji,
      cta_label: annCtaLabel.trim() || null, cta_url: annCtaUrl.trim() || null,
    });
    if (error) { toast.error(error.message); setSendingAnn(false); return; }
    toast.success('Broadcast sent to all users!');
    await logAudit('broadcast', null, 'Broadcast sent: ' + annSubject.trim());
    setAnnSubject(''); setAnnBody(''); setAnnCtaLabel(''); setAnnCtaUrl('');
    setAnnEmoji('📣'); setAnnSent(true);
    setTimeout(() => setAnnSent(false), 4000);
    setSendingAnn(false);
  }, [annSubject, annBody, annEmoji, annCtaLabel, annCtaUrl]);

  if (!isReg) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <AlertTriangle className="w-16 h-16 mx-auto text-destructive mb-4" />
          <h2 className="text-2xl font-black mb-2">Access Denied</h2>
          <p className="text-muted-foreground">This panel is restricted to platform regulators.</p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  const filteredLogs = modFilter === 'all' ? modLogs
    : modFilter === 'unreviewed' ? modLogs.filter((l: any) => !l.reviewed)
    : modLogs.filter((l: any) => l.action === modFilter);

  return (
    <div className="min-h-screen bg-background pb-20">
      <TopBar title="Regulator Panel" showBack />

      {/* Hero */}
      <div className="bg-gradient-to-br from-violet-600/15 via-background to-primary/10 border-b border-border px-4 py-5">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-violet-600 to-primary flex items-center justify-center shadow-lg shadow-violet-500/30">
            <Crown className="w-6 h-6 text-white" fill="currentColor" />
          </div>
          <div>
            <h1 className="text-xl font-black">Platform Regulator</h1>
            <p className="text-xs text-muted-foreground">Full control · @{user?.username}</p>
          </div>
          <div className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-green-500/10 border border-green-500/20">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
            <span className="text-xs font-bold text-green-600">Active</span>
          </div>
        </div>
        <div className="flex gap-3 overflow-x-auto scrollbar-hide pb-1">
          {[
            { label: 'Users',     val: platformStats.users ?? 0,        icon: Users,      color: 'text-blue-500' },
            { label: 'Posts',     val: platformStats.posts ?? 0,        icon: BarChart3,  color: 'text-primary' },
            { label: 'Live',      val: platformStats.live_spaces ?? 0,  icon: Bell,       color: 'text-red-500' },
            { label: 'Revenue',   val: platformRevenue,                  icon: DollarSign, color: 'text-green-500', prefix: '$' },
            { label: 'Employees', val: employees.length,                 icon: Briefcase,  color: 'text-violet-500' },
            { label: 'Flagged',   val: modLogs.filter((l: any) => !l.reviewed).length, icon: Flag, color: 'text-orange-500' },
          ].map(s => (
            <div key={s.label} className="flex items-center gap-2 px-3 py-2 bg-card border border-border rounded-xl shrink-0">
              <s.icon className={`w-3.5 h-3.5 ${s.color}`} />
              <span className="text-xs font-black">{(s as any).prefix ?? ''}{s.label === 'Revenue' ? s.val.toFixed(0) : formatNumber(s.val)}</span>
              <span className="text-xs text-muted-foreground">{s.label}</span>
            </div>
          ))}
        </div>
        <div className="flex gap-2 mt-3">
          <button onClick={() => navigate('/team-chat')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-primary/10 text-primary border border-primary/20 text-xs font-bold hover:bg-primary/15 transition-colors">
            <MessageSquare className="w-3.5 h-3.5" />Team Chat
          </button>
          <button onClick={handleScanPosts} disabled={scanningPosts}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-red-500/10 text-red-600 border border-red-500/20 text-xs font-bold hover:bg-red-500/15 transition-colors disabled:opacity-50">
            {scanningPosts ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
            {scanningPosts ? 'Scanning…' : 'AI Scan Posts'}
          </button>
        </div>
        {scanResult && (
          <div className="mt-2 flex items-center gap-2 px-3 py-2 bg-green-500/10 border border-green-500/20 rounded-xl">
            <CheckCircle className="w-3.5 h-3.5 text-green-600 shrink-0" />
            <p className="text-[11px] text-green-700 dark:text-green-400 font-semibold">
              Scanned {scanResult.scanned} posts — {scanResult.flagged} flagged, {scanResult.banned} auto-banned
            </p>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="sticky top-14 z-20 bg-background border-b border-border overflow-x-auto">
        <div className="flex min-w-max">
          {REG_TAB_DEFS.map(t => (
            <button key={t.key} onClick={() => setActiveTab(t.key as RegTab)}
              className={`px-4 py-3 text-xs font-bold border-b-2 flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap relative ${
                activeTab === t.key ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground'
              }`}>
              <t.Icon className="w-3.5 h-3.5" />{t.label}
              {t.key === 'moderation' && modLogs.filter((l: any) => !l.reviewed).length > 0 && (
                <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-red-500" />
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="p-4">

        {/* ── EMPLOYEES TAB ── */}
        {activeTab === 'employees' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-black text-base">Platform Employees</h2>
                <p className="text-xs text-muted-foreground mt-0.5">Assign roles, revenue share, and manage the team</p>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => navigate('/team-chat')}
                  className="flex items-center gap-1 px-2.5 py-1.5 bg-primary/10 text-primary rounded-xl text-xs font-bold hover:bg-primary/15 transition-colors">
                  <MessageSquare className="w-3 h-3" />Chat
                </button>
                <button onClick={handleExportPayroll}
                  className="flex items-center gap-1 px-2.5 py-1.5 bg-muted border border-border rounded-xl text-xs font-bold hover:bg-muted/80 transition-colors">
                  <Download className="w-3 h-3" />CSV
                </button>
                <button onClick={() => setShowHireDialog(true)}
                  className="flex items-center gap-1.5 px-3 py-2 bg-primary text-primary-foreground rounded-xl text-xs font-bold hover:opacity-90">
                  <UserPlus className="w-3.5 h-3.5" />Hire
                </button>
              </div>
            </div>

            {employees.length > 0 && (() => {
              const totalSharePct = employees.reduce((s: number, e: any) => s + (e.permissions?.revenue_share_pct ?? 0), 0);
              return totalSharePct > 0 ? (
                <div className="p-3 bg-green-500/5 border border-green-500/20 rounded-xl">
                  <p className="text-xs font-bold text-green-700 dark:text-green-400 mb-1 flex items-center gap-1.5">
                    <DollarSign className="w-3.5 h-3.5" />Revenue Distribution Summary
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Total allocated: <span className="font-bold text-foreground">{totalSharePct.toFixed(1)}%</span> of ${platformRevenue.toFixed(2)} = 
                    <span className="font-bold text-green-600 ml-1">${(platformRevenue * totalSharePct / 100).toFixed(2)} total payout</span>
                  </p>
                </div>
              ) : null;
            })()}

            {employees.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <Briefcase className="w-14 h-14 mx-auto mb-3 opacity-20" />
                <p className="font-semibold">No employees yet</p>
              </div>
            ) : (
              <div className="space-y-2">
                {employees.map((emp: any) => {
                  const revPct = emp.permissions?.revenue_share_pct ?? 0;
                  const revAmount = platformRevenue * revPct / 100;
                  return (
                    <div key={emp.id} className="p-3 bg-card border border-border rounded-2xl hover:border-primary/20 transition-colors">
                      {/* Employee header */}
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-muted overflow-hidden shrink-0">
                          {emp.user_profiles?.avatar_url
                            ? <img src={emp.user_profiles.avatar_url} className="w-full h-full object-cover" alt="" />
                            : <div className="w-full h-full flex items-center justify-center font-bold">{emp.user_profiles?.username?.[0]?.toUpperCase()}</div>}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <p className="font-bold text-sm">@{emp.user_profiles?.username}</p>
                            {emp.user_profiles?.verified && <span className="text-[10px] text-primary font-bold">✓</span>}
                          </div>
                          <p className="text-xs text-muted-foreground">{emp.job_title} · {emp.department}</p>
                        </div>
                        <div className="flex flex-col items-end gap-1 shrink-0">
                          <span className="text-[10px] bg-violet-500/10 text-violet-600 font-bold px-2 py-0.5 rounded-full">{emp.department}</span>
                          <button onClick={() => handleFire(emp.id, emp.user_profiles?.username)}
                            className="text-[10px] text-destructive hover:underline">Remove</button>
                        </div>
                      </div>

                      {/* Revenue share row */}
                      <div className="mt-2 pt-2 border-t border-border flex items-center gap-2">
                        <DollarSign className="w-3 h-3 text-green-500 shrink-0" />
                        {editingRevShare === emp.id ? (
                          <div className="flex items-center gap-1.5 flex-1">
                            <input type="number" min="0" max="100" step="0.1" value={revShareInput}
                              onChange={e => setRevShareInput(e.target.value)} autoFocus
                              className="w-20 h-7 px-2 rounded-lg border border-border bg-background text-xs focus:outline-none focus:ring-1 focus:ring-primary/30"
                              placeholder="0-100" />
                            <span className="text-xs text-muted-foreground">%</span>
                            <button onClick={() => handleSaveRevShare(emp.id, emp.user_profiles?.id, emp.user_profiles?.username)}
                              disabled={savingRevShare}
                              className="flex items-center gap-1 px-2 py-1 bg-primary text-primary-foreground rounded-lg text-[10px] font-bold disabled:opacity-50">
                              {savingRevShare ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                            </button>
                            <button onClick={() => { setEditingRevShare(null); setRevShareInput(''); }} className="text-muted-foreground">
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2 flex-1 min-w-0">
                            <span className="text-[11px] text-muted-foreground">Revenue share:</span>
                            <span className={`text-[11px] font-black ${revPct > 0 ? 'text-green-600' : 'text-muted-foreground'}`}>
                              {revPct > 0 ? `${revPct}% = $${revAmount.toFixed(2)}` : 'Not set'}
                            </span>
                            <button onClick={() => { setEditingRevShare(emp.id); setRevShareInput(String(revPct)); }}
                              className="ml-auto text-[10px] text-primary hover:underline font-semibold">
                              {revPct > 0 ? 'Edit' : 'Set %'}
                            </button>
                          </div>
                        )}
                      </div>

                      {/* Verified badge row */}
                      <div className="mt-2 pt-2 border-t border-border flex items-center gap-2">
                        <BadgeCheck className={`w-3 h-3 shrink-0 ${emp.user_profiles?.verified ? 'text-primary' : 'text-muted-foreground'}`} />
                        <span className="text-[11px] text-muted-foreground flex-1">
                          {emp.user_profiles?.verified ? 'Verified badge granted' : 'Not verified'}
                        </span>
                        <button
                          onClick={() => handleGrantVerified(emp.user_profiles?.id, emp.user_profiles?.username, emp.user_profiles?.verified ?? false)}
                          className={`flex items-center gap-1 px-2.5 py-1 rounded-xl text-[10px] font-bold border transition-all ${
                            emp.user_profiles?.verified
                              ? 'border-destructive/20 bg-destructive/5 text-destructive hover:bg-destructive/10'
                              : 'border-primary/20 bg-primary/5 text-primary hover:bg-primary/10'
                          }`}>
                          {emp.user_profiles?.verified
                            ? <><BadgeX className="w-3 h-3" />Remove ✓</>
                            : <><BadgeCheck className="w-3 h-3" />Grant ✓</>}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Hire Dialog */}
            {showHireDialog && (
              <div className="fixed inset-0 z-[300] bg-black/60 flex items-end" onClick={() => setShowHireDialog(false)}>
                <div className="w-full bg-background rounded-t-3xl p-5 space-y-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                  <div className="flex items-center justify-between">
                    <h3 className="font-black text-lg">Hire Employee</h3>
                    <button onClick={() => setShowHireDialog(false)} className="p-2 rounded-full hover:bg-muted"><X className="w-4 h-4" /></button>
                  </div>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <input type="text" value={hireSearch}
                      onChange={e => { setHireSearch(e.target.value); searchUsersToHire(e.target.value); }}
                      placeholder="Search username…"
                      className="w-full h-10 pl-9 pr-4 bg-muted/40 border border-border rounded-xl text-sm focus:outline-none focus:ring-1 focus:ring-primary/30" />
                    {hireResults.length > 0 && (
                      <div className="absolute top-full mt-1 w-full bg-background border border-border rounded-xl shadow-xl z-10 overflow-hidden">
                        {hireResults.map((u: any) => (
                          <button key={u.id} onClick={() => { setSelectedHireUser(u); setHireSearch(u.username); setHireResults([]); }}
                            className="w-full flex items-center gap-2 px-3 py-2.5 hover:bg-muted text-left">
                            <div className="w-7 h-7 rounded-full bg-muted overflow-hidden shrink-0">
                              {u.avatar_url ? <img src={u.avatar_url} className="w-full h-full object-cover" alt="" /> : <div className="w-full h-full flex items-center justify-center text-xs font-bold">{u.username?.[0]?.toUpperCase()}</div>}
                            </div>
                            <span className="text-sm font-semibold">@{u.username}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  {selectedHireUser && (
                    <div className="flex items-center gap-2 px-3 py-2 bg-primary/5 border border-primary/20 rounded-xl">
                      <Check className="w-4 h-4 text-primary shrink-0" />
                      <span className="text-sm font-bold">@{selectedHireUser.username}</span>
                    </div>
                  )}
                  <div>
                    <label className="text-sm font-semibold mb-1 block">Job Title *</label>
                    <input type="text" value={hireForm.job_title} onChange={e => setHireForm(p => ({ ...p, job_title: e.target.value }))}
                      placeholder="e.g. Content Moderator"
                      className="w-full h-10 px-3 bg-muted/40 border border-border rounded-xl text-sm focus:outline-none" />
                  </div>
                  <div>
                    <label className="text-sm font-semibold mb-1 block">Department</label>
                    <div className="flex flex-wrap gap-2">
                      {DEPT_OPTIONS.map(d => (
                        <button key={d} onClick={() => setHireForm(p => ({ ...p, department: d }))}
                          className={`px-3 py-1.5 rounded-xl text-xs font-bold border-2 transition-all ${hireForm.department === d ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:border-primary/30'}`}>
                          {d}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="text-sm font-semibold mb-1 block">Revenue Share %</label>
                    <input type="number" min="0" max="100" step="0.5" value={hireForm.rev_share_pct}
                      onChange={e => setHireForm(p => ({ ...p, rev_share_pct: e.target.value }))} placeholder="0"
                      className="w-full h-10 px-3 bg-muted/40 border border-border rounded-xl text-sm focus:outline-none" />
                    <p className="text-[10px] text-muted-foreground mt-0.5">% of platform revenue this employee receives</p>
                  </div>
                  <div>
                    <label className="text-sm font-semibold mb-1 block">Notes (optional)</label>
                    <textarea value={hireForm.notes} onChange={e => setHireForm(p => ({ ...p, notes: e.target.value }))}
                      rows={2} maxLength={300}
                      className="w-full px-3 py-2 bg-muted/40 border border-border rounded-xl text-sm resize-none focus:outline-none" />
                  </div>
                  <button onClick={handleHire} disabled={hiring || !selectedHireUser || !hireForm.job_title.trim()}
                    className="w-full py-3 bg-primary text-primary-foreground rounded-xl font-bold disabled:opacity-50 flex items-center justify-center gap-2 hover:opacity-90">
                    {hiring ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
                    {hiring ? 'Hiring…' : 'Hire Employee'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── FEATURES TAB ── */}
        {activeTab === 'features' && (
          <div className="space-y-4">
            <div>
              <h2 className="font-black text-base">Feature Access Control</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                All features are <span className="text-green-600 font-bold">unlocked by default</span>. Lock specific features per user.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {FEATURE_KEYS.map(fk => (
                <div key={fk} className="flex items-center gap-2 px-3 py-2 bg-green-500/5 border border-green-500/20 rounded-xl">
                  <Unlock className="w-3 h-3 text-green-500 shrink-0" />
                  <span className="text-[10px] font-semibold text-green-700 dark:text-green-400 truncate">{FEATURE_LABELS[fk]?.replace(/^[^\s]+\s/, '') ?? fk}</span>
                </div>
              ))}
            </div>
            <div className="border-t border-border pt-4">
              <h3 className="font-bold text-sm mb-2">Lock Features for Specific User</h3>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input type="text" value={unlockSearch}
                  onChange={e => { setUnlockSearch(e.target.value); searchUsersToManage(e.target.value); }}
                  placeholder="Search user to manage…"
                  className="w-full h-10 pl-9 pr-4 bg-muted/40 border border-border rounded-xl text-sm focus:outline-none focus:ring-1 focus:ring-primary/30" />
                {unlockResults.length > 0 && (
                  <div className="absolute top-full mt-1 w-full bg-background border border-border rounded-xl shadow-xl z-10 overflow-hidden">
                    {unlockResults.map((u: any) => (
                      <button key={u.id} onClick={() => selectUserToManage(u)}
                        className="w-full flex items-center gap-2 px-3 py-2.5 hover:bg-muted text-left">
                        <div className="w-7 h-7 rounded-full bg-muted overflow-hidden shrink-0">
                          {u.avatar_url ? <img src={u.avatar_url} className="w-full h-full object-cover" alt="" /> : <div className="w-full h-full flex items-center justify-center text-xs font-bold">{u.username?.[0]?.toUpperCase()}</div>}
                        </div>
                        <span className="text-sm font-semibold">@{u.username}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {selectedUnlockUser ? (
                <div className="space-y-3 mt-3">
                  <div className="flex items-center gap-2 px-3 py-2.5 bg-primary/5 border border-primary/20 rounded-xl">
                    <div className="w-8 h-8 rounded-full overflow-hidden bg-muted shrink-0">
                      {selectedUnlockUser.avatar_url ? <img src={selectedUnlockUser.avatar_url} className="w-full h-full object-cover" alt="" /> : <div className="w-full h-full flex items-center justify-center text-xs font-bold">{selectedUnlockUser.username?.[0]?.toUpperCase()}</div>}
                    </div>
                    <span className="font-bold text-sm">@{selectedUnlockUser.username}</span>
                    <span className="text-xs text-muted-foreground ml-1">— {lockedFeatures.length} locked</span>
                    <button onClick={() => { setSelectedUnlockUser(null); setUnlockSearch(''); setLockedFeatures([]); }} className="ml-auto text-muted-foreground"><X className="w-3.5 h-3.5" /></button>
                  </div>
                  <div className="space-y-2">
                    {FEATURE_KEYS.map(fk => {
                      const isLocked = lockedFeatures.includes(fk);
                      return (
                        <button key={fk} onClick={() => toggleFeatureLock(fk)}
                          className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border-2 transition-all text-left ${isLocked ? 'border-destructive/30 bg-destructive/5' : 'border-green-500/25 bg-green-500/5'}`}>
                          <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${isLocked ? 'bg-destructive/15 text-destructive' : 'bg-green-500/15 text-green-600'}`}>
                            {isLocked ? <Lock className="w-4 h-4" /> : <Unlock className="w-4 h-4" />}
                          </div>
                          <span className="font-semibold text-sm flex-1">{FEATURE_LABELS[fk] ?? fk}</span>
                          <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${isLocked ? 'bg-destructive/10 text-destructive' : 'bg-green-500/10 text-green-600'}`}>
                            {isLocked ? 'LOCKED' : 'OPEN'}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  <button onClick={saveFeatureLocks} disabled={savingLocks}
                    className="w-full py-3 bg-primary text-primary-foreground rounded-xl font-bold disabled:opacity-50 flex items-center justify-center gap-2 hover:opacity-90">
                    {savingLocks ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                    {savingLocks ? 'Saving…' : 'Save Lock Settings'}
                  </button>
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground mt-4">
                  <Lock className="w-12 h-12 mx-auto mb-2 opacity-20" />
                  <p className="text-sm font-semibold">Search a user above</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── WALLETS TAB ── */}
        {activeTab === 'wallets' && (
          <div className="space-y-4">
            <div>
              <h2 className="font-black text-base">Wallet & Monetization Access</h2>
              <p className="text-xs text-muted-foreground mt-0.5">View and top up any user's wallet</p>
            </div>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input type="text" value={walletSearch}
                onChange={e => { setWalletSearch(e.target.value); searchWalletUsers(e.target.value); }}
                placeholder="Search username to view wallet…"
                className="w-full h-10 pl-9 pr-4 bg-muted/40 border border-border rounded-xl text-sm focus:outline-none focus:ring-1 focus:ring-primary/30" />
              {walletSearchResults.length > 0 && (
                <div className="absolute top-full mt-1 w-full bg-background border border-border rounded-xl shadow-xl z-10 overflow-hidden">
                  {walletSearchResults.map((u: any) => (
                    <button key={u.id} onClick={() => viewUserWallet(u)}
                      className="w-full flex items-center gap-2 px-3 py-2.5 hover:bg-muted text-left">
                      <div className="w-7 h-7 rounded-full bg-muted overflow-hidden shrink-0">
                        {u.avatar_url ? <img src={u.avatar_url} className="w-full h-full object-cover" alt="" /> : <div className="w-full h-full flex items-center justify-center text-xs font-bold">{u.username?.[0]?.toUpperCase()}</div>}
                      </div>
                      <span className="text-sm font-semibold">@{u.username}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {selectedWalletUser && (
              <div className="space-y-3">
                <div className="flex items-center gap-2 px-3 py-2.5 bg-primary/5 border border-primary/20 rounded-xl">
                  <div className="w-8 h-8 rounded-full overflow-hidden bg-muted shrink-0">
                    {selectedWalletUser.avatar_url ? <img src={selectedWalletUser.avatar_url} className="w-full h-full object-cover" alt="" /> : <div className="w-full h-full flex items-center justify-center text-xs font-bold">{selectedWalletUser.username?.[0]?.toUpperCase()}</div>}
                  </div>
                  <span className="font-bold text-sm">@{selectedWalletUser.username}</span>
                  <button onClick={() => setShowTopUp(true)}
                    className="ml-auto flex items-center gap-1 px-2.5 py-1.5 bg-green-500 text-white rounded-xl text-xs font-bold hover:opacity-90">
                    <ArrowUpRight className="w-3 h-3" />Top Up
                  </button>
                  <button onClick={() => { setSelectedWalletUser(null); setWalletSearch(''); setWalletData(null); setWalletTxns([]); setShowTopUp(false); }}
                    className="text-muted-foreground hover:text-foreground"><X className="w-3.5 h-3.5" /></button>
                </div>

                {showTopUp && (
                  <div className="p-4 bg-green-500/5 border border-green-500/20 rounded-2xl space-y-3">
                    <div className="flex items-center gap-2">
                      <DollarSign className="w-4 h-4 text-green-500" />
                      <h4 className="font-bold text-sm">Top Up Wallet</h4>
                    </div>
                    <div className="flex gap-2">
                      {[5, 10, 25, 50].map(amt => (
                        <button key={amt} onClick={() => setTopUpAmount(String(amt))}
                          className={`flex-1 py-2 rounded-xl text-xs font-black border-2 transition-all ${topUpAmount === String(amt) ? 'border-green-500 bg-green-500/15 text-green-600' : 'border-border hover:border-green-500/30'}`}>
                          ${amt}
                        </button>
                      ))}
                    </div>
                    <input type="number" min="0.01" step="0.01" value={topUpAmount}
                      onChange={e => setTopUpAmount(e.target.value)} placeholder="Custom amount ($)"
                      className="w-full h-10 px-3 bg-background border border-border rounded-xl text-sm focus:outline-none" />
                    <input type="text" value={topUpNote} onChange={e => setTopUpNote(e.target.value)}
                      placeholder="Note (optional)"
                      className="w-full h-10 px-3 bg-background border border-border rounded-xl text-sm focus:outline-none" />
                    <div className="flex gap-2">
                      <button onClick={() => setShowTopUp(false)} className="flex-1 py-2.5 border border-border rounded-xl text-sm font-semibold hover:bg-muted">Cancel</button>
                      <button onClick={handleTopUp} disabled={toppingUp || !topUpAmount}
                        className="flex-1 py-2.5 bg-green-500 text-white rounded-xl text-sm font-bold disabled:opacity-50 flex items-center justify-center gap-1.5 hover:opacity-90">
                        {toppingUp ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowUpRight className="w-4 h-4" />}
                        {toppingUp ? 'Adding…' : `Add $${topUpAmount || '—'}`}
                      </button>
                    </div>
                  </div>
                )}

                {loadingWallet ? <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div> : (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div className="p-4 bg-gradient-to-br from-green-500/15 to-emerald-400/10 border border-green-500/20 rounded-2xl">
                        <p className="text-[10px] text-muted-foreground mb-1 flex items-center gap-1"><Wallet className="w-3 h-3" />Balance</p>
                        <p className="text-2xl font-black text-green-600">${Number(walletData?.balance ?? 0).toFixed(2)}</p>
                      </div>
                      <div className="p-4 bg-gradient-to-br from-blue-500/15 to-cyan-400/10 border border-blue-500/20 rounded-2xl">
                        <p className="text-[10px] text-muted-foreground mb-1 flex items-center gap-1"><Star className="w-3 h-3" />Credits</p>
                        <p className="text-2xl font-black text-blue-600">{walletData?.credits ?? 0}</p>
                      </div>
                    </div>
                    {walletEarnings && (
                      <div className="p-4 bg-card border border-border rounded-2xl">
                        <p className="text-xs font-bold mb-2 flex items-center gap-2"><DollarSign className="w-4 h-4 text-primary" />Monetization</p>
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          <div><p className="text-muted-foreground">Status</p><p className={`font-bold ${walletEarnings.is_monetized ? 'text-green-600' : 'text-muted-foreground'}`}>{walletEarnings.is_monetized ? '✓ Active' : 'Inactive'}</p></div>
                          <div><p className="text-muted-foreground">Total Earned</p><p className="font-bold text-green-600">${Number(walletEarnings.total_earnings ?? 0).toFixed(2)}</p></div>
                        </div>
                      </div>
                    )}
                    <div className="bg-card border border-border rounded-2xl overflow-hidden">
                      <div className="px-4 py-3 border-b border-border flex items-center gap-2">
                        <Activity className="w-4 h-4 text-primary" />
                        <p className="font-bold text-sm">Recent Transactions</p>
                      </div>
                      {walletTxns.length === 0 ? <p className="text-xs text-muted-foreground text-center py-4">No transactions</p> : (
                        <div className="divide-y divide-border max-h-56 overflow-y-auto">
                          {walletTxns.map((txn: any) => {
                            const isCredit = txn.type === 'deposit' || txn.type === 'credit';
                            return (
                              <div key={txn.id} className="flex items-center gap-3 px-4 py-2.5">
                                <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${isCredit ? 'bg-green-500/10' : 'bg-red-500/10'}`}>
                                  {isCredit ? <ArrowUpRight className="w-4 h-4 text-green-600" /> : <ArrowDownRight className="w-4 h-4 text-red-600" />}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="text-xs font-semibold capitalize">{txn.type}</p>
                                  <p className="text-[10px] text-muted-foreground truncate">{txn.description ?? txn.reference ?? '—'}</p>
                                </div>
                                <p className={`text-sm font-black shrink-0 ${isCredit ? 'text-green-600' : 'text-red-600'}`}>
                                  {isCredit ? '+' : '-'}${Number(txn.amount ?? 0).toFixed(2)}
                                </p>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {!selectedWalletUser && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="font-bold text-sm">Top Wallets by Balance</h3>
                  <button onClick={fetchTopWallets} className="text-xs text-primary hover:underline flex items-center gap-1">
                    <RefreshCw className="w-3 h-3" />Refresh
                  </button>
                </div>
                {loadingTopWallets ? <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div> : (
                  <div className="space-y-2">
                    {topWallets.map((w: any, i: number) => (
                      <button key={w.user_id} onClick={() => viewUserWallet(w.user_profiles ?? { id: w.user_id, username: '—' })}
                        className="w-full flex items-center gap-3 p-3 bg-card border border-border rounded-xl hover:border-primary/20 transition-colors text-left">
                        <span className="text-xs font-black text-muted-foreground w-5 text-center shrink-0">{i + 1}</span>
                        <div className="w-8 h-8 rounded-full bg-muted overflow-hidden shrink-0">
                          {w.user_profiles?.avatar_url ? <img src={w.user_profiles.avatar_url} className="w-full h-full object-cover" alt="" /> : <div className="w-full h-full flex items-center justify-center text-xs font-bold">{w.user_profiles?.username?.[0]?.toUpperCase()}</div>}
                        </div>
                        <span className="font-semibold text-sm flex-1">@{w.user_profiles?.username ?? '—'}</span>
                        <span className="text-base font-black text-green-600 shrink-0">${Number(w.balance ?? 0).toFixed(2)}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── MODERATION TAB ── */}
        {activeTab === 'moderation' && (
          <div className="space-y-4">
            {/* 30-day moderation chart */}
            {modChartData.length > 0 && (
              <div className="bg-card border border-border rounded-2xl p-4">
                <div className="flex items-center gap-2 mb-3">
                  <BarChart3 className="w-4 h-4 text-primary" />
                  <h3 className="font-bold text-sm">30-Day Moderation Activity</h3>
                </div>
                <ResponsiveContainer width="100%" height={120}>
                  <BarChart data={modChartData} margin={{ top: 0, right: 0, bottom: 0, left: -20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="date" tick={{ fontSize: 8 }} interval={6} stroke="hsl(var(--muted-foreground))" />
                    <YAxis allowDecimals={false} tick={{ fontSize: 8 }} stroke="hsl(var(--muted-foreground))" />
                    <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8, border: '1px solid hsl(var(--border))' }} />
                    <Bar dataKey="flagged" name="Flagged" fill="hsl(32 95% 55%)" radius={[2,2,0,0]} />
                    <Bar dataKey="banned" name="Auto-banned" fill="hsl(0 80% 55%)" radius={[2,2,0,0]} />
                  </BarChart>
                </ResponsiveContainer>
                <div className="flex items-center gap-4 mt-2 justify-center">
                  <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                    <span className="w-3 h-3 rounded-sm bg-orange-500 shrink-0" />Flagged
                  </div>
                  <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                    <span className="w-3 h-3 rounded-sm bg-red-500 shrink-0" />Auto-banned
                  </div>
                </div>
              </div>
            )}

            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-black text-base flex items-center gap-2"><ShieldAlert className="w-5 h-5 text-red-500" />AI Moderation</h2>
                <p className="text-xs text-muted-foreground mt-0.5">Facebook-style policy enforcement powered by OnSpace AI</p>
              </div>
              <button onClick={handleScanPosts} disabled={scanningPosts}
                className="flex items-center gap-1.5 px-3 py-2 bg-red-500/10 text-red-600 border border-red-500/20 rounded-xl text-xs font-bold hover:bg-red-500/15 disabled:opacity-50">
                {scanningPosts ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
                {scanningPosts ? 'Scanning…' : 'Run AI Scan'}
              </button>
            </div>

            <div className="p-4 bg-card border border-border rounded-2xl">
              <h3 className="font-bold text-sm mb-3 flex items-center gap-2"><BadgeCheck className="w-4 h-4 text-primary" />Moderation Model</h3>
              <div className="grid grid-cols-2 gap-2 text-xs">
                {[
                  { cat: 'Hate Speech', desc: 'Race, religion, gender, orientation', color: 'text-red-500' },
                  { cat: 'Harassment', desc: 'Threats, bullying, direct attacks', color: 'text-orange-500' },
                  { cat: 'Explicit Content', desc: 'Sexual/graphic material', color: 'text-pink-500' },
                  { cat: 'Violence', desc: 'Promotes or glorifies harm', color: 'text-red-600' },
                  { cat: 'Spam', desc: 'Repetitive/misleading/scam', color: 'text-yellow-600' },
                  { cat: 'Misinformation', desc: 'False health/safety/election info', color: 'text-amber-600' },
                ].map(c => (
                  <div key={c.cat} className="flex items-start gap-1.5 p-2 bg-muted/40 rounded-lg">
                    <span className={`font-bold shrink-0 text-[10px] ${c.color}`}>●</span>
                    <div><p className="font-semibold">{c.cat}</p><p className="text-muted-foreground text-[10px]">{c.desc}</p></div>
                  </div>
                ))}
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-[10px]">
                <div className="p-2 bg-green-500/8 border border-green-500/20 rounded-lg text-center">
                  <p className="font-black text-green-600">0–49</p><p className="text-muted-foreground">Pass ✅</p>
                </div>
                <div className="p-2 bg-orange-500/8 border border-orange-500/20 rounded-lg text-center">
                  <p className="font-black text-orange-500">50–79</p><p className="text-muted-foreground">Flag 🚩</p>
                </div>
                <div className="p-2 bg-red-500/8 border border-red-500/20 rounded-lg text-center">
                  <p className="font-black text-red-600">80–100</p><p className="text-muted-foreground">Auto-Ban 🚫</p>
                </div>
              </div>
            </div>

            {bannedUsers.length > 0 && (
              <div className="bg-card border border-red-500/20 rounded-2xl overflow-hidden">
                <div className="px-4 py-3 border-b border-red-500/15 flex items-center gap-2 bg-red-500/5">
                  <Ban className="w-4 h-4 text-red-500" />
                  <h3 className="font-bold text-sm text-red-600">Active Bans ({bannedUsers.length})</h3>
                  <span className="text-[10px] text-muted-foreground ml-1">3 strikes = permanent</span>
                </div>
                <div className="divide-y divide-border">
                  {bannedUsers.map((ban: any) => (
                    <div key={ban.id} className="flex items-center gap-3 px-4 py-3">
                      <div className="w-8 h-8 rounded-full bg-muted overflow-hidden shrink-0">
                        {ban.user_profiles?.avatar_url ? <img src={ban.user_profiles.avatar_url} className="w-full h-full object-cover" alt="" /> : <div className="w-full h-full flex items-center justify-center text-xs font-bold">{ban.user_profiles?.username?.[0]?.toUpperCase()}</div>}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold">@{ban.user_profiles?.username}</p>
                        <p className="text-[10px] text-muted-foreground truncate">{ban.reason?.slice(0, 60)}</p>
                        <p className="text-[9px] text-red-500 font-semibold mt-0.5">
                          Strike {ban.strike_count ?? 1}/3 · {ban.ban_type === 'permanent' ? '🚫 Permanent' : `Expires ${ban.expires_at ? formatDistanceToNow(new Date(ban.expires_at), { addSuffix: true }) : '—'}`}
                        </p>
                      </div>
                      <div className="flex flex-col gap-1 shrink-0">
                        <button onClick={() => handleLiftBan(ban.id, ban.user_profiles?.id, ban.user_profiles?.username)}
                          className="flex items-center gap-1 px-2.5 py-1.5 bg-green-500/10 text-green-600 border border-green-500/20 rounded-xl text-[10px] font-bold hover:bg-green-500/20">
                          <CheckCircle className="w-3 h-3" />Lift
                        </button>
                        <button onClick={() => handleResetStrikes(ban.user_profiles?.id, ban.user_profiles?.username)}
                          className="flex items-center gap-1 px-2.5 py-1.5 bg-blue-500/10 text-blue-600 border border-blue-500/20 rounded-xl text-[10px] font-bold hover:bg-blue-500/20">
                          <RefreshCw className="w-3 h-3" />Reset
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {pendingAppeals.length > 0 && (
              <div className="bg-card border border-blue-500/20 rounded-2xl overflow-hidden">
                <div className="px-4 py-3 border-b border-blue-500/15 flex items-center gap-2 bg-blue-500/5">
                  <FileText className="w-4 h-4 text-blue-500" />
                  <h3 className="font-bold text-sm text-blue-600">Pending Appeals ({pendingAppeals.length})</h3>
                </div>
                <div className="divide-y divide-border">
                  {pendingAppeals.map((appeal: any) => (
                    <div key={appeal.id} className="p-4 space-y-3">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full bg-muted overflow-hidden shrink-0">
                          {appeal.user_profiles?.avatar_url ? <img src={appeal.user_profiles.avatar_url} className="w-full h-full object-cover" alt="" /> : <div className="w-full h-full flex items-center justify-center text-[9px] font-bold">{appeal.user_profiles?.username?.[0]?.toUpperCase()}</div>}
                        </div>
                        <span className="text-sm font-bold">@{appeal.user_profiles?.username}</span>
                        <span className="text-[10px] text-muted-foreground ml-auto">{formatDistanceToNow(new Date(appeal.created_at), { addSuffix: true })}</span>
                      </div>
                      <div className="bg-muted/40 rounded-xl px-3 py-2">
                        <p className="text-xs text-foreground leading-relaxed line-clamp-4">"{appeal.reason}"</p>
                      </div>
                      <input type="text" value={appealNote[appeal.id] ?? ''}
                        onChange={e => setAppealNote(prev => ({ ...prev, [appeal.id]: e.target.value }))}
                        placeholder="Add a note (optional)"
                        className="w-full h-9 px-3 bg-background border border-border rounded-xl text-xs focus:outline-none focus:ring-1 focus:ring-primary/30" />
                      <div className="flex gap-2">
                        <button onClick={() => handleReviewAppeal(appeal.id, 'approved', appeal)}
                          className="flex-1 flex items-center justify-center gap-1.5 py-2 bg-green-500/10 text-green-600 border border-green-500/20 rounded-xl text-xs font-bold hover:bg-green-500/15">
                          <CheckCircle className="w-3.5 h-3.5" />Approve & Lift Ban
                        </button>
                        <button onClick={() => handleReviewAppeal(appeal.id, 'denied', appeal)}
                          className="flex-1 flex items-center justify-center gap-1.5 py-2 bg-red-500/10 text-red-600 border border-red-500/20 rounded-xl text-xs font-bold hover:bg-red-500/15">
                          <XCircle className="w-3.5 h-3.5" />Deny
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex gap-2 overflow-x-auto scrollbar-hide">
              {[
                { val: 'unreviewed', label: 'To Review' },
                { val: 'flag', label: '🚩 Flagged' },
                { val: 'auto_ban', label: '🚫 Auto-Banned' },
                { val: 'all', label: 'All Logs' },
              ].map(f => (
                <button key={f.val} onClick={() => setModFilter(f.val as typeof modFilter)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold border-2 shrink-0 transition-all ${modFilter === f.val ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:border-primary/30'}`}>
                  {f.label}
                </button>
              ))}
              <button onClick={() => { fetchModeration(); }} className="px-3 py-1.5 rounded-xl text-xs text-muted-foreground border border-border hover:bg-muted flex items-center gap-1 shrink-0">
                <RefreshCw className="w-3 h-3" />Refresh
              </button>
            </div>

            {loadingMod ? <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div> :
             filteredLogs.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <CheckCircle className="w-14 h-14 mx-auto mb-3 opacity-20" />
                <p className="font-semibold">No items to review</p>
                <p className="text-sm mt-1">Run an AI scan to check recent posts</p>
              </div>
            ) : (
              <div className="space-y-3">
                {filteredLogs.map((log: any) => {
                  const cats = log.categories ?? {};
                  const topCat = getTopCategory(cats);
                  return (
                    <div key={log.id} className={`bg-card border rounded-2xl overflow-hidden ${log.reviewed ? 'border-border opacity-60' : 'border-orange-500/20'}`}>
                      <div className={`px-4 py-3 border-b border-border flex items-center gap-2 ${getScoreBg(log.overall_score)}`}>
                        <div className={`text-sm font-black ${getScoreColor(log.overall_score)}`}>{log.overall_score}/100</div>
                        <span className="text-[11px] font-bold text-muted-foreground">{getActionLabel(log.action)}</span>
                        {log.reviewed && <span className="ml-auto text-[10px] text-green-600 font-bold bg-green-500/10 px-1.5 py-0.5 rounded-full">Reviewed ✓</span>}
                      </div>
                      <div className="p-4 space-y-3">
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-full bg-muted overflow-hidden shrink-0">
                            {log.user_profiles?.avatar_url ? <img src={log.user_profiles.avatar_url} className="w-full h-full object-cover" alt="" /> : <div className="w-full h-full flex items-center justify-center text-[9px] font-bold">{log.user_profiles?.username?.[0]?.toUpperCase()}</div>}
                          </div>
                          <span className="text-sm font-bold">@{log.user_profiles?.username}</span>
                          <span className="text-[10px] text-muted-foreground ml-auto">{formatDistanceToNow(new Date(log.created_at), { addSuffix: true })}</span>
                        </div>
                        {log.content_snippet && (
                          <div className="bg-muted/40 rounded-xl px-3 py-2">
                            <p className="text-xs text-muted-foreground line-clamp-3 italic">"{log.content_snippet}"</p>
                          </div>
                        )}
                        <p className="text-xs font-semibold text-foreground">{log.reason}</p>
                        {topCat && (
                          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-xl ${getScoreBg(topCat.score)}`}>
                            <AlertCircle className={`w-3.5 h-3.5 shrink-0 ${getScoreColor(topCat.score)}`} />
                            <span className="text-[11px] font-bold capitalize">{topCat.key.replace('_', ' ')}</span>
                            <span className={`text-[11px] font-black ml-auto ${getScoreColor(topCat.score)}`}>{topCat.score}/100</span>
                          </div>
                        )}
                        {!log.reviewed && (
                          <div className="flex gap-2 pt-1">
                            {log.user_profiles?.id && (
                              <button onClick={() => handleManualBan(log.user_profiles.id, log.user_profiles.username)}
                                className="flex items-center gap-1 px-3 py-2 bg-red-500/10 text-red-600 border border-red-500/20 rounded-xl text-xs font-bold hover:bg-red-500/15">
                                <Ban className="w-3 h-3" />Ban User
                              </button>
                            )}
                            <button onClick={() => handleReviewLog(log.id, 'confirm')}
                              className="flex items-center gap-1 px-3 py-2 bg-orange-500/10 text-orange-600 border border-orange-500/20 rounded-xl text-xs font-bold hover:bg-orange-500/15">
                              <CheckCircle className="w-3 h-3" />Confirm
                            </button>
                            <button onClick={() => handleReviewLog(log.id, 'dismiss')}
                              className="flex items-center gap-1 px-3 py-2 bg-green-500/10 text-green-600 border border-green-500/20 rounded-xl text-xs font-bold hover:bg-green-500/15 ml-auto">
                              <XCircle className="w-3 h-3" />Dismiss
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── PLATFORM TAB ── */}
        {activeTab === 'platform' && (
          <div className="space-y-4">
            <h2 className="font-black text-base">Platform Overview</h2>

            {/* User Search by Email/Username */}
            <div className="bg-card border border-border rounded-2xl p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Search className="w-4 h-4 text-primary" />
                <h3 className="font-bold text-sm">Find User by Email or Username</h3>
              </div>
              <div className="relative">
                <AtSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input type="text" value={platformSearch}
                  onChange={e => { setPlatformSearch(e.target.value); searchPlatformUsers(e.target.value); }}
                  placeholder="Search by @username or email…"
                  className="w-full h-10 pl-9 pr-4 bg-muted/40 border border-border rounded-xl text-sm focus:outline-none focus:ring-1 focus:ring-primary/30" />
                {platformSearchResults.length > 0 && (
                  <div className="absolute top-full mt-1 w-full bg-background border border-border rounded-xl shadow-xl z-10 overflow-hidden">
                    {platformSearchResults.map((u: any) => (
                      <button key={u.id} onClick={() => selectPlatformUser(u)}
                        className="w-full flex items-center gap-2 px-3 py-2.5 hover:bg-muted text-left">
                        <div className="w-7 h-7 rounded-full bg-muted overflow-hidden shrink-0">
                          {u.avatar_url ? <img src={u.avatar_url} className="w-full h-full object-cover" alt="" /> : <div className="w-full h-full flex items-center justify-center text-xs font-bold">{u.username?.[0]?.toUpperCase()}</div>}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold">@{u.username}</p>
                          <p className="text-[10px] text-muted-foreground truncate">{u.email}</p>
                        </div>
                        {u.is_blocked && <span className="text-[9px] bg-red-500/10 text-red-600 font-bold px-1.5 py-0.5 rounded-full shrink-0">Banned</span>}
                        {u.verified && <span className="text-[9px] text-primary font-bold shrink-0">✓</span>}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {platformSelectedUser && (
                <div className="space-y-3">
                  <div className="flex items-center gap-3 p-3 bg-primary/5 border border-primary/20 rounded-xl">
                    <div className="w-10 h-10 rounded-full bg-muted overflow-hidden shrink-0">
                      {platformSelectedUser.avatar_url ? <img src={platformSelectedUser.avatar_url} className="w-full h-full object-cover" alt="" /> : <div className="w-full h-full flex items-center justify-center font-bold">{platformSelectedUser.username?.[0]?.toUpperCase()}</div>}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className="font-bold text-sm">@{platformSelectedUser.username}</p>
                        {platformSelectedUser.verified && <span className="text-[10px] text-primary font-bold">✓</span>}
                        {platformSelectedUser.is_blocked && <span className="text-[9px] bg-red-500/10 text-red-600 font-bold px-1.5 py-0.5 rounded-full">Banned</span>}
                      </div>
                      <p className="text-xs text-muted-foreground truncate">{platformSelectedUser.email}</p>
                    </div>
                    <button onClick={() => { setPlatformSelectedUser(null); setPlatformSearch(''); setPlatformUserBan(null); }} className="text-muted-foreground"><X className="w-3.5 h-3.5" /></button>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div className="p-2 bg-muted/40 rounded-xl text-center">
                      <p className="font-black text-base">{formatNumber(platformSelectedUser.followers_count ?? 0)}</p>
                      <p className="text-muted-foreground">Followers</p>
                    </div>
                    <div className="p-2 bg-muted/40 rounded-xl text-center">
                      <p className={`font-black text-base ${(platformSelectedUser.strike_count ?? 0) > 0 ? 'text-orange-500' : 'text-green-500'}`}>{platformSelectedUser.strike_count ?? 0}</p>
                      <p className="text-muted-foreground">Strikes</p>
                    </div>
                    <div className="p-2 bg-muted/40 rounded-xl text-center">
                      <p className="font-black text-base">{platformSelectedUser.verified ? '✓' : '—'}</p>
                      <p className="text-muted-foreground">Verified</p>
                    </div>
                  </div>
                  {platformUserBan && (
                    <div className="p-3 bg-red-500/5 border border-red-500/20 rounded-xl">
                      <p className="text-xs font-bold text-red-600 mb-1">🚫 Active Ban</p>
                      <p className="text-xs text-muted-foreground">{platformUserBan.reason?.slice(0, 80)}</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">Type: {platformUserBan.ban_type} · Strike {platformUserBan.strike_count}/3</p>
                    </div>
                  )}
                  <div className="flex gap-2 flex-wrap">
                    <button onClick={() => navigate(`/profile/${platformSelectedUser.username}`)}
                      className="flex items-center gap-1 px-2.5 py-1.5 bg-primary/10 text-primary border border-primary/20 rounded-xl text-[10px] font-bold hover:bg-primary/15">
                      <Eye className="w-3 h-3" />View Profile
                    </button>
                    <button onClick={() => handleGrantVerified(platformSelectedUser.id, platformSelectedUser.username, platformSelectedUser.verified ?? false)}
                      className={`flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-[10px] font-bold border transition-all ${platformSelectedUser.verified ? 'border-destructive/20 bg-destructive/5 text-destructive' : 'border-primary/20 bg-primary/5 text-primary'}`}>
                      <BadgeCheck className="w-3 h-3" />{platformSelectedUser.verified ? 'Remove ✓' : 'Grant ✓'}
                    </button>
                    <button onClick={() => handleResetStrikes(platformSelectedUser.id, platformSelectedUser.username)}
                      className="flex items-center gap-1 px-2.5 py-1.5 bg-blue-500/10 text-blue-600 border border-blue-500/20 rounded-xl text-[10px] font-bold hover:bg-blue-500/15">
                      <RefreshCw className="w-3 h-3" />Reset Strikes
                    </button>
                    {platformUserBan && (
                      <button onClick={() => handleLiftBan(platformUserBan.id, platformSelectedUser.id, platformSelectedUser.username)}
                        className="flex items-center gap-1 px-2.5 py-1.5 bg-green-500/10 text-green-600 border border-green-500/20 rounded-xl text-[10px] font-bold hover:bg-green-500/15">
                        <CheckCircle className="w-3 h-3" />Lift Ban
                      </button>
                    )}
                    {!platformUserBan && (
                      <button onClick={() => handleManualBan(platformSelectedUser.id, platformSelectedUser.username)}
                        className="flex items-center gap-1 px-2.5 py-1.5 bg-red-500/10 text-red-600 border border-red-500/20 rounded-xl text-[10px] font-bold hover:bg-red-500/15">
                        <Ban className="w-3 h-3" />Ban 24h
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: 'Total Users',   val: platformStats.users ?? 0,       color: 'from-blue-500/15',   icon: '👥' },
                { label: 'Total Posts',   val: platformStats.posts ?? 0,       color: 'from-primary/15',    icon: '📝' },
                { label: 'Live Spaces',   val: platformStats.live_spaces ?? 0, color: 'from-red-500/15',    icon: '🔴' },
                { label: 'Employees',     val: employees.length,               color: 'from-violet-500/15', icon: '💼' },
              ].map(s => (
                <div key={s.label} className={`p-4 rounded-2xl bg-gradient-to-br ${s.color} to-transparent border border-border`}>
                  <p className="text-2xl font-black">{formatNumber(s.val)}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{s.icon} {s.label}</p>
                </div>
              ))}
            </div>
            <div className="p-4 bg-gradient-to-br from-green-500/15 to-emerald-500/5 border border-green-500/20 rounded-2xl">
              <div className="flex items-center gap-2 mb-2"><DollarSign className="w-4 h-4 text-green-500" /><h3 className="font-bold text-sm">Platform Revenue</h3></div>
              <p className="text-3xl font-black text-green-600">${platformRevenue.toFixed(2)}</p>
              <p className="text-xs text-muted-foreground mt-1">Total paid creator earnings (all time)</p>
            </div>
            <div>
              <h3 className="font-bold text-sm mb-2 flex items-center gap-2"><Eye className="w-4 h-4 text-primary" />Recent Users</h3>
              <div className="space-y-2">
                {recentUsers.map((u: any) => (
                  <button key={u.id} onClick={() => navigate(`/profile/${u.username}`)}
                    className="w-full flex items-center gap-3 p-3 bg-card border border-border rounded-xl hover:border-primary/20 transition-colors text-left">
                    <div className="w-8 h-8 rounded-full bg-muted overflow-hidden shrink-0">
                      {u.avatar_url ? <img src={u.avatar_url} className="w-full h-full object-cover" alt="" /> : <div className="w-full h-full flex items-center justify-center text-xs font-bold">{u.username?.[0]?.toUpperCase()}</div>}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-sm">@{u.username}</p>
                      <p className="text-[10px] text-muted-foreground">{formatDistanceToNow(new Date(u.created_at), { addSuffix: true })}</p>
                    </div>
                    {u.verified && <span className="text-[10px] text-primary font-bold shrink-0">✓ Verified</span>}
                    <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-2 pt-2">
              <h3 className="font-bold text-sm mb-2">Quick Links</h3>
              {[
                { label: 'Admin Panel', path: '/admin' }, { label: 'Admin Revenue', path: '/admin/revenue' },
                { label: 'Fraud Detection', path: '/fraud-detection' }, { label: 'Admin Verifications', path: '/admin/verifications' },
                { label: 'Team Chat', path: '/team-chat' }, { label: 'Monetization', path: '/monetization' },
                { label: 'Podcast Analytics', path: '/podcasts/analytics' }, { label: 'Appeals', path: '/appeals' },
              ].map(l => (
                <button key={l.path} onClick={() => navigate(l.path)}
                  className="w-full flex items-center justify-between px-4 py-2.5 bg-card border border-border rounded-xl text-sm hover:border-primary/20 transition-colors">
                  <span className="font-semibold">{l.label}</span>
                  <ChevronRight className="w-4 h-4 text-muted-foreground" />
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── ANNOUNCE TAB ── */}
        {activeTab === 'announce' && (
          <div className="space-y-4">
            <div>
              <h2 className="font-black text-base">Broadcast Announcement</h2>
              <p className="text-xs text-muted-foreground mt-0.5">Send a message to ALL users' platform inbox</p>
            </div>
            {/* Announcements Archive */}
            {annArchive.length > 0 && (
              <div className="bg-card border border-border rounded-2xl overflow-hidden">
                <div className="px-4 py-3 border-b border-border flex items-center gap-2">
                  <Mail className="w-4 h-4 text-primary" />
                  <h3 className="font-bold text-sm">Broadcast Archive</h3>
                  <span className="text-xs text-muted-foreground ml-1">{annArchive.length} sent</span>
                  <button onClick={fetchAnnArchive} className="ml-auto text-muted-foreground hover:text-foreground">
                    <RefreshCw className="w-3.5 h-3.5" />
                  </button>
                </div>
                {loadingArchive ? <div className="flex justify-center py-4"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div> : (
                  <div className="divide-y divide-border max-h-64 overflow-y-auto">
                    {annArchive.map((ann: any) => (
                      <div key={ann.id} className="px-4 py-3">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-base shrink-0">{ann.icon_emoji ?? '📣'}</span>
                          <p className="text-sm font-bold truncate flex-1">{ann.subject}</p>
                          <span className="text-[10px] text-muted-foreground shrink-0">{formatDistanceToNow(new Date(ann.sent_at ?? ann.created_at), { addSuffix: true })}</span>
                        </div>
                        <p className="text-xs text-muted-foreground line-clamp-2 pl-6">{ann.body}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            {annSent && (
              <div className="flex items-center gap-2 p-3 bg-green-500/10 border border-green-500/20 rounded-xl">
                <Check className="w-4 h-4 text-green-600 shrink-0" />
                <p className="text-sm font-bold text-green-600">Broadcast sent successfully!</p>
              </div>
            )}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                {['📣', '🔔', '🎉', '⚠️', '🚀', '💡', '❤️', '🏆'].map(e => (
                  <button key={e} onClick={() => setAnnEmoji(e)}
                    className={`text-xl w-9 h-9 rounded-xl flex items-center justify-center transition-all ${annEmoji === e ? 'bg-primary/10 ring-2 ring-primary/30 scale-110' : 'hover:bg-muted'}`}>
                    {e}
                  </button>
                ))}
              </div>
              <div>
                <label className="text-sm font-semibold mb-1 block">Subject *</label>
                <input type="text" value={annSubject} onChange={e => setAnnSubject(e.target.value)} placeholder="Announcement subject" maxLength={100}
                  className="w-full h-10 px-3 bg-muted/40 border border-border rounded-xl text-sm focus:outline-none" />
              </div>
              <div>
                <label className="text-sm font-semibold mb-1 block">Message *</label>
                <textarea value={annBody} onChange={e => setAnnBody(e.target.value)} rows={4} maxLength={800}
                  className="w-full px-3 py-2 bg-muted/40 border border-border rounded-xl text-sm resize-none focus:outline-none" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm font-semibold mb-1 block">CTA Label</label>
                  <input type="text" value={annCtaLabel} onChange={e => setAnnCtaLabel(e.target.value)} placeholder="Learn More" maxLength={40}
                    className="w-full h-10 px-3 bg-muted/40 border border-border rounded-xl text-sm focus:outline-none" />
                </div>
                <div>
                  <label className="text-sm font-semibold mb-1 block">CTA URL</label>
                  <input type="text" value={annCtaUrl} onChange={e => setAnnCtaUrl(e.target.value)} placeholder="/premium" maxLength={200}
                    className="w-full h-10 px-3 bg-muted/40 border border-border rounded-xl text-sm focus:outline-none" />
                </div>
              </div>
              <button onClick={handleBroadcast} disabled={sendingAnn || !annSubject.trim() || !annBody.trim()}
                className="w-full py-3 bg-gradient-to-r from-violet-600 to-primary text-white rounded-xl font-bold disabled:opacity-50 flex items-center justify-center gap-2 hover:opacity-90">
                {sendingAnn ? <Loader2 className="w-4 h-4 animate-spin" /> : <Megaphone className="w-4 h-4" />}
                {sendingAnn ? 'Broadcasting…' : 'Broadcast to All Users'}
              </button>
            </div>
          </div>
        )}

        {/* ── AUDIT LOG TAB ── */}
        {activeTab === 'audit' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-black text-base flex items-center gap-2"><FileText className="w-5 h-5 text-primary" />Regulator Audit Log</h2>
                <p className="text-xs text-muted-foreground mt-0.5">Every action taken in this panel — immutable record</p>
              </div>
              <button onClick={fetchAuditLogs} disabled={loadingAudit} className="text-muted-foreground hover:text-foreground">
                <RefreshCw className={`w-4 h-4 ${loadingAudit ? 'animate-spin' : ''}`} />
              </button>
            </div>

            {/* Filter chips */}
            <div className="flex gap-2 overflow-x-auto scrollbar-hide">
              {['all', 'ban', 'verified', 'hire', 'broadcast', 'ad'].map(f => (
                <button key={f} onClick={() => setAuditFilter(f)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold border-2 shrink-0 capitalize transition-all ${
                    auditFilter === f ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground'
                  }`}>
                  {f === 'all' ? 'All Actions' : f}
                </button>
              ))}
            </div>

            {loadingAudit ? (
              <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
            ) : auditLogs.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <FileText className="w-14 h-14 mx-auto mb-3 opacity-20" />
                <p className="font-semibold">No audit entries yet</p>
                <p className="text-sm mt-1">Actions taken in this panel will appear here</p>
              </div>
            ) : (
              <div className="space-y-2">
                {auditLogs
                  .filter(log => {
                    if (auditFilter === 'all') return true;
                    if (auditFilter === 'ban') return String(log.action_type).includes('ban');
                    if (auditFilter === 'verified') return String(log.action_type).includes('verified');
                    if (auditFilter === 'hire') return String(log.action_type).includes('hire');
                    if (auditFilter === 'broadcast') return log.action_type === 'broadcast';
                    if (auditFilter === 'ad') return String(log.action_type).includes('ad');
                    return true;
                  })
                  .map((log: any) => {
                    const actionEmoji = log.action_type.includes('ban') ? '🚫'
                      : log.action_type.includes('verified') ? '✅'
                      : log.action_type.includes('hire') ? '💼'
                      : log.action_type === 'broadcast' ? '📣'
                      : log.action_type.includes('ad') ? '📢'
                      : log.action_type.includes('strikes') ? '🔄'
                      : '⚙️';
                    return (
                      <div key={log.id} className="flex items-start gap-3 p-3 bg-card border border-border rounded-xl">
                        <div className="w-8 h-8 rounded-xl bg-muted flex items-center justify-center shrink-0 text-base">
                          {actionEmoji}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs font-black capitalize">{log.action_type.replace(/_/g, ' ')}</span>
                            {log.target_user?.username && (
                              <span className="text-[10px] bg-primary/8 text-primary px-1.5 py-0.5 rounded-full font-semibold">@{log.target_user.username}</span>
                            )}
                          </div>
                          <p className="text-[10px] text-muted-foreground mt-0.5 truncate">{log.notes}</p>
                        </div>
                        <span className="text-[9px] text-muted-foreground shrink-0 whitespace-nowrap">
                          {formatDistanceToNow(new Date(log.created_at), { addSuffix: true })}
                        </span>
                      </div>
                    );
                  })}
              </div>
            )}
          </div>
        )}

        {/* ── REPORTS TAB ── */}
        {/* ── ANALYTICS TAB ── */}
        {activeTab === 'analytics' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-black text-base flex items-center gap-2"><TrendingUp className="w-5 h-5 text-primary" />Platform Analytics</h2>
                <p className="text-xs text-muted-foreground mt-0.5">30-day overview — signups, posts, revenue, and trending content</p>
              </div>
              <button onClick={fetchAnalytics} disabled={loadingAnalytics} className="text-muted-foreground hover:text-foreground">
                <RefreshCw className={`w-4 h-4 ${loadingAnalytics ? 'animate-spin' : ''}`} />
              </button>
            </div>
            {loadingAnalytics ? (
              <div className="flex justify-center py-12"><Loader2 className="w-7 h-7 animate-spin text-primary" /></div>
            ) : !analyticsData ? (
              <div className="text-center py-12 text-muted-foreground">
                <BarChart3 className="w-14 h-14 mx-auto mb-3 opacity-20" />
                <p className="font-semibold">No analytics data yet</p>
              </div>
            ) : (() => {
              const chartDays = analyticsData.days.map(d => d.slice(5));
              const signupChartData = chartDays.map((date, i) => ({ date, count: analyticsData.signups[i] }));
              const postChartData = chartDays.map((date, i) => ({ date, count: analyticsData.posts[i] }));
              const revChartData = chartDays.map((date, i) => ({ date, amount: analyticsData.revenue[i] }));
              const maxHashtag = analyticsData.topHashtags.length > 0 ? Math.max(...analyticsData.topHashtags.map(h => h.count), 1) : 1;
              return (
                <div className="space-y-5">
                  {/* New User Signups */}
                  <div className="bg-card border border-border rounded-2xl p-4">
                    <p className="font-bold text-sm mb-3 flex items-center gap-2"><Users className="w-4 h-4 text-blue-500" />New Signups (30d)</p>
                    <ResponsiveContainer width="100%" height={120}>
                      <LineChart data={signupChartData} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                        <XAxis dataKey="date" tick={{ fontSize: 8 }} interval={6} stroke="hsl(var(--muted-foreground))" />
                        <YAxis allowDecimals={false} tick={{ fontSize: 8 }} stroke="hsl(var(--muted-foreground))" />
                        <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} />
                        <Line type="monotone" dataKey="count" name="Signups" stroke="#3b82f6" strokeWidth={2} dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                  {/* Daily Posts */}
                  <div className="bg-card border border-border rounded-2xl p-4">
                    <p className="font-bold text-sm mb-3 flex items-center gap-2"><BarChart3 className="w-4 h-4 text-primary" />Daily Posts (30d)</p>
                    <ResponsiveContainer width="100%" height={120}>
                      <BarChart data={postChartData} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                        <XAxis dataKey="date" tick={{ fontSize: 8 }} interval={6} stroke="hsl(var(--muted-foreground))" />
                        <YAxis allowDecimals={false} tick={{ fontSize: 8 }} stroke="hsl(var(--muted-foreground))" />
                        <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} />
                        <Bar dataKey="count" name="Posts" fill="hsl(var(--primary))" radius={[2,2,0,0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  {/* Revenue */}
                  <div className="bg-card border border-border rounded-2xl p-4">
                    <p className="font-bold text-sm mb-3 flex items-center gap-2"><DollarSign className="w-4 h-4 text-green-500" />Daily Creator Revenue (30d)</p>
                    <ResponsiveContainer width="100%" height={120}>
                      <LineChart data={revChartData} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                        <XAxis dataKey="date" tick={{ fontSize: 8 }} interval={6} stroke="hsl(var(--muted-foreground))" />
                        <YAxis tick={{ fontSize: 8 }} stroke="hsl(var(--muted-foreground))" />
                        <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} formatter={(v: any) => [`$${Number(v).toFixed(2)}`, 'Revenue']} />
                        <Line type="monotone" dataKey="amount" name="Revenue" stroke="#22c55e" strokeWidth={2} dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                  {/* Top Hashtags */}
                  {analyticsData.topHashtags.length > 0 && (
                    <div className="bg-card border border-border rounded-2xl p-4">
                      <p className="font-bold text-sm mb-3 flex items-center gap-2"><TrendingUp className="w-4 h-4 text-orange-500" />Top Hashtags (all time)</p>
                      <div className="space-y-2">
                        {analyticsData.topHashtags.map((h, i) => (
                          <div key={h.tag} className="flex items-center gap-2">
                            <span className="text-[10px] font-black text-muted-foreground w-4 shrink-0 text-center">{i + 1}</span>
                            <span className="text-xs font-bold text-primary min-w-[80px] shrink-0">#{h.tag}</span>
                            <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                              <div className="h-full bg-gradient-to-r from-orange-400 to-amber-500 rounded-full" style={{ width: `${Math.max(4, (h.count / maxHashtag) * 100)}%` }} />
                            </div>
                            <span className="text-[10px] text-muted-foreground shrink-0 font-semibold">{h.count.toLocaleString()}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        )}

        {activeTab === 'reports' && (
          <div className="space-y-4">
            <h2 className="font-black text-base">Platform Reports</h2>

            {/* Ad Review Queue */}
            <div className="bg-card border border-orange-500/20 rounded-2xl overflow-hidden">
              <div className="px-4 py-3 border-b border-orange-500/15 bg-orange-500/5 flex items-center gap-2">
                <Megaphone className="w-4 h-4 text-orange-500" />
                <h3 className="font-bold text-sm text-orange-600">Ad Review Queue</h3>
                <span className="text-xs text-muted-foreground ml-1">
                  {adQueue.length > 0 ? `${adQueue.length} pending` : 'All clear'}
                </span>
                <button onClick={fetchAdQueue} className="ml-auto text-muted-foreground hover:text-foreground">
                  <RefreshCw className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="p-4 space-y-2">
                <p className="text-[10px] text-muted-foreground bg-muted/40 rounded-xl px-3 py-2">
                  🛡️ Platform policy: <span className="font-bold text-red-600">No nudity, pornography, or sexual content.</span> Ads are AI-screened before human review. Score 0-29 = approve, 30-59 = flag, 60+ = reject.
                </p>
                {loadingAdQueue ? <div className="flex justify-center py-4"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div> :
                 adQueue.length === 0 ? (
                  <div className="text-center py-6 text-muted-foreground">
                    <CheckCircle className="w-10 h-10 mx-auto mb-2 opacity-20" />
                    <p className="text-sm font-semibold">No ads pending review</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {adQueue.map((ad: any) => {
                      const aiScore = ad.ai_verification_score;
                      const hasAI = aiScore !== null && aiScore !== undefined;
                      return (
                        <div key={ad.id} className="p-3 bg-background border border-border rounded-xl space-y-2">
                          <div className="flex items-center gap-2">
                            {ad.image_url && (
                              <div className="w-10 h-10 rounded-lg overflow-hidden bg-muted shrink-0">
                                <img src={ad.image_url} className="w-full h-full object-cover" alt="" />
                              </div>
                            )}
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-bold truncate">{ad.title}</p>
                              <p className="text-[10px] text-muted-foreground truncate">@{ad.user_profiles?.username} · KES {Number(ad.budget ?? 0).toLocaleString()}</p>
                            </div>
                            {hasAI && (
                              <span className={`text-[10px] font-black px-2 py-0.5 rounded-full shrink-0 ${aiScore >= 60 ? 'bg-red-500/10 text-red-600' : aiScore >= 30 ? 'bg-orange-500/10 text-orange-600' : 'bg-green-500/10 text-green-600'}`}>
                                AI: {aiScore}/100
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground line-clamp-2">{ad.description}</p>
                          {ad.ai_verification_notes && (
                            <p className="text-[10px] text-orange-600 bg-orange-500/5 border border-orange-500/15 rounded-lg px-2 py-1 truncate">{ad.ai_verification_notes}</p>
                          )}
                          <div className="flex gap-2">
                            <button onClick={() => handleVerifyAd(ad)} disabled={verifyingAd === ad.id}
                              className="flex items-center gap-1 px-2.5 py-1.5 bg-violet-500/10 text-violet-600 border border-violet-500/20 rounded-xl text-[10px] font-bold hover:bg-violet-500/15 disabled:opacity-50">
                              {verifyingAd === ad.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
                              AI Check
                            </button>
                            <button onClick={() => handleApproveAd(ad.id, ad.user_profiles?.id, ad.title)}
                              className="flex items-center gap-1 px-2.5 py-1.5 bg-green-500/10 text-green-600 border border-green-500/20 rounded-xl text-[10px] font-bold hover:bg-green-500/15">
                              <CheckCircle className="w-3 h-3" />Approve
                            </button>
                            <button onClick={() => handleRejectAd(ad.id, ad.user_profiles?.id, ad.title)}
                              className="flex items-center gap-1 px-2.5 py-1.5 bg-red-500/10 text-red-600 border border-red-500/20 rounded-xl text-[10px] font-bold hover:bg-red-500/15">
                              <XCircle className="w-3 h-3" />Reject
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-2">
              {[
                { label: 'AI Moderation Queue', icon: '🛡️', path: undefined, tab: 'moderation' as RegTab },
                { label: 'Post Reports',         icon: '⚠️', path: '/admin', tab: undefined },
                { label: 'Fraud Alerts',         icon: '🔍', path: '/fraud-detection', tab: undefined },
                { label: 'Ad Reviews',           icon: '📣', path: '/admin/ads-review', tab: undefined },
                { label: 'Revenue Analytics',    icon: '💰', path: '/revenue-analytics', tab: undefined },
                { label: 'Post Analytics',       icon: '📊', path: '/post-analytics', tab: undefined },
                { label: 'Podcast Analytics',    icon: '🎙️', path: '/podcasts/analytics', tab: undefined },
                { label: 'All Wallets',          icon: '👛', path: undefined, tab: 'wallets' as RegTab },
                { label: 'Appeals Queue',        icon: '📋', path: '/appeals', tab: undefined },
              ].map(r => (
                <button key={r.label}
                  onClick={() => r.path ? navigate(r.path) : r.tab ? setActiveTab(r.tab) : undefined}
                  className="w-full flex items-center gap-3 px-4 py-3 bg-card border border-border rounded-xl hover:border-primary/20 transition-colors text-left">
                  <span className="text-xl shrink-0">{r.icon}</span>
                  <span className="font-semibold text-sm flex-1">{r.label}</span>
                  <ChevronRight className="w-4 h-4 text-muted-foreground" />
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
