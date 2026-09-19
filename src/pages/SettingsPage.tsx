
import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useSEO } from '@/hooks/useSEO';
import { TopBar } from '@/components/layout/TopBar';
import { useAuth } from '@/hooks/useAuth';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import {
  Bell, Lock, Shield, HelpCircle, FileText, LogOut,
  Moon, Sun, Palette, User, ChevronRight, Smartphone, Monitor, Check,
  Sparkles, Heart, Volume2, VolumeX, Play, Trash2, AlertTriangle,
  Copy, AtSign, Globe, UserX, BadgeCheck, Crown,
} from 'lucide-react';
import { useNotificationSound } from '@/hooks/useNotificationSound';
import { applyAppearance, getStoredAppearance, THEME_PRESETS, type AppearanceSettings, type ThemeChoice, type ThemePresetId } from '@/theme/themes';
import { authService } from '@/lib/auth';
import { toast } from 'sonner';

// esbuild guard: module-level locale constants
const LOCALE_KEY = 'ts-locale';
const LOCALES = [
  { code: 'en', label: 'English',  native: 'English'    },
  { code: 'sw', label: 'Swahili',  native: 'Kiswahili'  },
  { code: 'fr', label: 'French',   native: 'Fran\u00e7ais' },
];

// esbuild guard: module-level dark-schedule constants — no inline computation in render
const DARK_SCHEDULE_KEY = 'ts-dark-schedule-enabled';
const DARK_HOUR_START = 20;
const DARK_HOUR_END = 7;
const TWO_FA_KEY = 'ts-2fa-required';

// esbuild guard: module-level helper — check if current hour is within dark-mode schedule
function isDarkScheduleActive(): boolean {
  const h = new Date().getHours();
  // 20:00 – 07:00 span (crosses midnight)
  return h >= DARK_HOUR_START || h < DARK_HOUR_END;
}

// Module-level constants (esbuild guard: no `as const` arrays or icon components in .map() data)
const THEME_IDS: ThemeChoice[] = ['light', 'dark', 'system'];
const THEME_LABELS = ['Light', 'Dark', 'System'];
const THEME_CLS = ['text-yellow-500', 'text-slate-400', 'text-blue-400'];

// esbuild guard: no explicit complex union type annotation on module-level array
const SOUND_PREVIEW_ITEMS = [
  { type: 'like',    label: 'Like',    emoji: '❤️', desc: 'Soft two-tone chime'       },
  { type: 'follow',  label: 'Follow',  emoji: '👤', desc: 'Rising three-note fanfare' },
  { type: 'tip',     label: 'Tip',     emoji: '💰', desc: 'Warm coin-drop jingle'     },
  { type: 'comment', label: 'Comment', emoji: '💬', desc: 'Subtle pop'                },
  { type: 'repost',  label: 'Repost',  emoji: '🔁', desc: 'Double-tap click'          },
  { type: 'dm',      label: 'DM',      emoji: '✉️',  desc: 'Friendly ping'             },
  { type: 'group',   label: 'Group',   emoji: '👥', desc: 'Richer group chime'        },
];

function ThemeIcon({ id, cls, active }: { id: ThemeChoice; cls: string; active: boolean }) {
  const iconCls = `w-6 h-6 ${active ? 'text-primary' : cls}`;
  if (id === 'light') return <Sun className={iconCls} />;
  if (id === 'dark')  return <Moon className={iconCls} />;
  return <Monitor className={iconCls} />;
}

export default function SettingsPage() {
  useSEO({ noindex: true, title: 'Settings', url: '/settings' });
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState(true);
  const [privateAccount, setPrivateAccount] = useState(false);
  const [discoverableByUsername, setDiscoverableByUsername] = useState(true);
  const [savingPrivacyDiscovery, setSavingPrivacyDiscovery] = useState(false);
  const [appearance, setAppearance] = useState<AppearanceSettings>(() => getStoredAppearance());
  const [themeChoice, setThemeChoice] = useState<ThemeChoice>(() => getStoredAppearance().mode);
  const [savingAppearance, setSavingAppearance] = useState(false);
  // 2FA toggle
  const [twoFaEnabled, setTwoFaEnabled] = useState(() => localStorage.getItem(TWO_FA_KEY) !== 'false');
  // Dark mode schedule
  const [darkScheduleEnabled, setDarkScheduleEnabled] = useState(() => localStorage.getItem(DARK_SCHEDULE_KEY) === 'true');
  // Account deletion (esbuild guard: no explicit generics)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteInput, setDeleteInput] = useState('');
  const [deleting, setDeleting] = useState(false);
  // Password change (esbuild guard: no explicit generics)
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordChanging, setPasswordChanging] = useState(false);
  // Export data
  const [exporting, setExporting] = useState(false);
  // Verification status
  const [verifiedStatus, setVerifiedStatus] = useState(false);
  const [creatorTier, setCreatorTier] = useState('');
  // Language & Region
  const [locale, setLocale] = useState(() => localStorage.getItem(LOCALE_KEY) ?? 'en');
  const [timezone] = useState(() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return 'UTC'; } });
  // Referral
  const [referralCount, setReferralCount] = useState(0);
  // Connected accounts
  const [twitterHandle, setTwitterHandle] = useState('');
  const [instagramHandle, setInstagramHandle] = useState('');
  const [linkedinUrl, setLinkedinUrl] = useState('');
  const [savingConnected, setSavingConnected] = useState(false);
  const [showConnectedForm, setShowConnectedForm] = useState(false);
  const { play: playSound, isEnabled: isSoundEnabled, setEnabled: setSoundEnabled } = useNotificationSound();
  const [soundsOn, setSoundsOn] = useState(isSoundEnabled());

  const handleLocaleChange = (code: string) => {
    setLocale(code);
    localStorage.setItem(LOCALE_KEY, code);
    toast.success('Language updated — restart the app to apply fully');
  };

  const toggleDarkSchedule = (v: boolean) => {
    setDarkScheduleEnabled(v);
    localStorage.setItem(DARK_SCHEDULE_KEY, v ? 'true' : 'false');
    if (!v) {
      // Restore theme choice
      applyAppearance(appearance);
    }
    toast.success(v ? 'Auto Dark Mode enabled (20:00 – 07:00)' : 'Auto Dark Mode disabled');
  };

  const toggleTwoFa = (v: boolean) => {
    setTwoFaEnabled(v);
    localStorage.setItem(TWO_FA_KEY, v ? 'true' : 'false');
    toast.success(v ? '2FA OTP verification enabled' : '2FA OTP verification disabled');
  };

  const toggleSounds = (v: boolean) => {
    setSoundEnabled(v);
    setSoundsOn(v);
    if (v) playSound('dm');
  };

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data } = await (supabase.from('profiles') as any)
        .select('appearance_settings')
        .eq('id', user.id)
        .maybeSingle();
      const remote = data?.appearance_settings;
      if (!remote || typeof remote !== 'object') return;
      const merged: AppearanceSettings = { ...getStoredAppearance(), ...remote };
      setAppearance(merged);
      setThemeChoice(merged.mode);
      applyAppearance(merged);
    })();
  }, [user?.id]);

  // Load profile privacy/discovery settings
  useEffect(() => {
    if (!user) return;
    supabase.from('profiles').select('protected_account, discoverable_by_username').eq('id', user.id).single()
      .then(({ data }) => {
        if (!data) return;
        setPrivateAccount(!!data.protected_account);
        setDiscoverableByUsername(data.discoverable_by_username !== false);
      });
  }, [user?.id]);

  const savePrivacyDiscovery = async (patch: { protected_account?: boolean; discoverable_by_username?: boolean }) => {
    if (!user) return;
    setSavingPrivacyDiscovery(true);
    const { error } = await supabase.from('profiles').update(patch).eq('id', user.id);
    setSavingPrivacyDiscovery(false);
    if (error) {
      toast.error(error.message || 'Failed to update privacy settings');
      return;
    }
    toast.success('Privacy settings updated');
  };

  const togglePrivateAccount = (value: boolean) => {
    setPrivateAccount(value);
    void savePrivacyDiscovery({ protected_account: value });
  };

  const toggleUsernameDiscovery = (value: boolean) => {
    setDiscoverableByUsername(value);
    void savePrivacyDiscovery({ discoverable_by_username: value });
  };

  // Verification + creator tier
  useEffect(() => {
    if (!user) return;
    supabase.from('profiles').select('verified, creator_tier').eq('id', user.id).single()
      .then(({ data }) => {
        if (!data) return;
        setVerifiedStatus(!!(data as any).verified);
        setCreatorTier((data as any).creator_tier ?? 'free');
      });
  }, [user?.id]);

  // Referral count
  useEffect(() => {
    if (!user) return;
    supabase.from('referrals').select('id', { count: 'exact', head: true }).eq('invited_by', user.id)
      .then(({ count }) => setReferralCount(count ?? 0));
  }, [user?.id]);

  // Load connected accounts
  useEffect(() => {
    if (!user) return;
    supabase.from('profiles').select('twitter_handle, instagram_handle, linkedin_url').eq('id', user.id).single()
      .then(({ data }) => {
        if (!data) return;
        setTwitterHandle((data as any).twitter_handle ?? '');
        setInstagramHandle((data as any).instagram_handle ?? '');
        setLinkedinUrl((data as any).linkedin_url ?? '');
      });
  }, [user?.id]);

  // Listen for OS preference changes when in System mode
  useEffect(() => {
    if (themeChoice !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => applyTheme('system');
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [themeChoice]);

  // Dark mode schedule — 60s interval, applies only when schedule is enabled
  useEffect(() => {
    if (!darkScheduleEnabled) return;
    const applySchedule = () => {
      const shouldBeDark = isDarkScheduleActive();
      const html = document.documentElement;
      if (shouldBeDark) {
        html.classList.add('dark');
        html.classList.remove('light');
      } else {
        html.classList.remove('dark');
        html.classList.add('light');
      }
    };
    applySchedule();
    const iv = setInterval(applySchedule, 60_000);
    return () => clearInterval(iv);
  }, [darkScheduleEnabled]);

  if (!user) {
    navigate('/auth');
    return null;
  }

  const handleLogout = async () => {
    await authService.signOut();
    logout();
    navigate('/');
  };

  const handleChangePassword = async () => {
    if (newPassword.length < 6) { toast.error('Password must be at least 6 characters'); return; }
    if (newPassword !== confirmPassword) { toast.error('Passwords do not match'); return; }
    setPasswordChanging(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setPasswordChanging(false);
    if (error) { toast.error(error.message || 'Failed to update password'); return; }
    toast.success('Password updated successfully');
    setShowPasswordForm(false);
    setNewPassword('');
    setConfirmPassword('');
  };

  const handleExportData = async () => {
    if (!user) return;
    setExporting(true);
    const [profileRes, postsRes, txRes] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', user.id).single(),
      supabase.from('posts').select('id, content, created_at, likes_count, views_count').eq('user_id', user.id).order('created_at', { ascending: false }).limit(100),
      supabase.from('wallet_transactions').select('type, amount, status, description, created_at').eq('user_id', user.id).order('created_at', { ascending: false }).limit(200),
    ]);
    const payload = {
      exported_at: new Date().toISOString(),
      profile: profileRes.data ?? {},
      posts: postsRes.data ?? [],
      wallet_transactions: txRes.data ?? [],
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `testagram-data-${user.username}-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setExporting(false);
    toast.success('Data exported successfully');
  };

  const handleDeleteAccount = async () => {
    if (!user || deleteInput !== user.username) return;
    setDeleting(true);
    await supabase.from('profiles').delete().eq('id', user.id);
    await authService.signOut();
    logout();
    navigate('/');
  };

  const handleSaveConnectedAccounts = async () => {
    if (!user) return;
    setSavingConnected(true);
    const cleanTwitter = twitterHandle.trim().replace(/^@/, '') || null;
    const cleanInsta = instagramHandle.trim().replace(/^@/, '') || null;
    const cleanLinkedin = linkedinUrl.trim() || null;
    const { error } = await supabase.from('profiles').update({
      twitter_handle: cleanTwitter,
      instagram_handle: cleanInsta,
      linkedin_url: cleanLinkedin,
    }).eq('id', user.id);
    setSavingConnected(false);
    if (error) { toast.error(error.message || 'Failed to save'); return; }
    toast.success('Connected accounts saved');
    setShowConnectedForm(false);
  };

  const persistAppearance = async (next: AppearanceSettings) => {
    setAppearance(next);
    setThemeChoice(next.mode);
    applyAppearance(next);
    if (!user) return;
    setSavingAppearance(true);
    const { error } = await (supabase.from('profiles') as any)
      .update({ appearance_settings: next })
      .eq('id', user.id);
    setSavingAppearance(false);
    if (error) toast.error(error.message || 'Theme saved locally, but cloud sync failed');
  };

  const selectTheme = (choice: ThemeChoice) => {
    void persistAppearance({ ...appearance, mode: choice });
  };

  const selectPreset = (preset: ThemePresetId) => {
    void persistAppearance({ ...appearance, preset, accent: undefined, background: undefined });
  };

  const updateAccent = (accent: string) => {
    void persistAppearance({ ...appearance, accent: accent || undefined });
  };

  const updateRadius = (radius: AppearanceSettings['radius']) => {
    void persistAppearance({ ...appearance, radius });
  };

  const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const activePreset = THEME_PRESETS.find(t => t.id === appearance.preset) ?? THEME_PRESETS[0];
  // esbuild guard: pre-compute referral link before JSX
  const referralLink = `${window.location.origin}/?ref=${user.username}`;
  const referralCountLabel = referralCount > 0 ? `${referralCount} referral${referralCount !== 1 ? 's' : ''}` : '';
  const effectiveTheme = themeChoice === 'system' ? (systemDark ? 'dark' : 'light') : themeChoice;

  return (
    <div className="min-h-screen bg-background pb-20 md:pb-0">
      <TopBar title="Settings" showBack />
      <div className="divide-y divide-border">

        {/* ── Account ── */}
        <div className="p-4">
          <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-3">Account</h2>
          <div className="space-y-1">

            {/* View Profile */}
            <button
              onClick={() => navigate(`/profile/${user.username}`)}
              className="flex items-center justify-between w-full p-3 hover:bg-muted/50 rounded-xl transition-colors"
            >
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center">
                  <User className="w-4 h-4 text-primary" />
                </div>
                <div className="text-left">
                  <p className="font-semibold text-sm">View Profile</p>
                  <p className="text-xs text-muted-foreground">@{user.username}</p>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-muted-foreground" />
            </button>

            {/* Private Account */}
            <div className="flex items-center justify-between p-3 hover:bg-muted/50 rounded-xl transition-colors">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-orange-500/10 flex items-center justify-center">
                  <Lock className="w-4 h-4 text-orange-500" />
                </div>
                <div>
                  <p className="font-semibold text-sm">Private Account</p>
                  <p className="text-xs text-muted-foreground">Only followers see your posts</p>
                </div>
              </div>
              <Switch checked={privateAccount} onCheckedChange={togglePrivateAccount} disabled={savingPrivacyDiscovery} />
            </div>

            {/* Public discovery */}
            <div className="flex items-center justify-between p-3 hover:bg-muted/50 rounded-xl transition-colors">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-blue-500/10 flex items-center justify-center">
                  <Globe className="w-4 h-4 text-blue-500" />
                </div>
                <div>
                  <p className="font-semibold text-sm">Discoverable by Username</p>
                  <p className="text-xs text-muted-foreground">Let people find your profile by @username and display name</p>
                </div>
              </div>
              <Switch checked={discoverableByUsername} onCheckedChange={toggleUsernameDiscovery} disabled={savingPrivacyDiscovery} />
            </div>

            {/* ── Verification Status ── */}
            <div className="p-3 border border-border rounded-xl space-y-2">
              <div className="flex items-center gap-2">
                <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${verifiedStatus ? 'bg-primary/10' : 'bg-muted'}`}>
                  {verifiedStatus
                    ? <BadgeCheck className="w-4 h-4 text-primary" />
                    : <BadgeCheck className="w-4 h-4 text-muted-foreground" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold">
                    {verifiedStatus ? 'Verified Account ✓' : 'Not Verified'}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {creatorTier && creatorTier !== 'free'
                      ? `Creator tier: ${creatorTier.charAt(0).toUpperCase() + creatorTier.slice(1)}`
                      : 'Free tier'}
                  </p>
                </div>
                {verifiedStatus
                  ? <span className="text-[10px] font-bold text-primary bg-primary/10 px-2 py-0.5 rounded-full border border-primary/20">Verified</span>
                  : <button
                      onClick={() => navigate('/verify')}
                      className="flex items-center gap-1 px-3 py-1.5 bg-amber-500 text-white rounded-lg text-xs font-bold hover:opacity-90 transition-opacity shrink-0"
                    >
                      <Crown className="w-3 h-3" /> Apply
                    </button>}
              </div>
              {!verifiedStatus && (
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  Get a verified badge to stand out and unlock creator monetization features.
                </p>
              )}
              {verifiedStatus && creatorTier && creatorTier !== 'free' && (
                <div className="flex items-center gap-2 pt-1">
                  <Crown className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                  <p className="text-[11px] text-muted-foreground">
                    {creatorTier === 'gold' ? 'Gold Creator — highest CPM tier ($3.50/1K views)'
                     : creatorTier === 'silver' ? 'Silver Creator — mid CPM tier ($2.50/1K views)'
                     : 'Bronze Creator — base CPM tier ($1.50/1K views)'}
                  </p>
                </div>
              )}
            </div>

            {/* Change Password */}
            {!showPasswordForm ? (
              <button
                onClick={() => setShowPasswordForm(true)}
                className="flex items-center justify-between w-full p-3 hover:bg-muted/50 rounded-xl transition-colors text-left"
              >
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-sky-500/10 flex items-center justify-center">
                    <Lock className="w-4 h-4 text-sky-500" />
                  </div>
                  <div>
                    <p className="font-semibold text-sm">Change Password</p>
                    <p className="text-xs text-muted-foreground">Update your account password</p>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-muted-foreground" />
              </button>
            ) : (
              <div className="p-3 bg-muted/30 border border-border rounded-xl space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-bold">Change Password</p>
                  <button
                    onClick={() => { setShowPasswordForm(false); setNewPassword(''); setConfirmPassword(''); }}
                    className="text-xs text-muted-foreground hover:text-foreground"
                  >
                    Cancel
                  </button>
                </div>
                <div className="space-y-2">
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground block mb-1">New Password</label>
                    <input
                      type="password"
                      value={newPassword}
                      onChange={e => setNewPassword(e.target.value)}
                      placeholder="At least 6 characters"
                      className="w-full h-9 px-3 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground block mb-1">Confirm Password</label>
                    <input
                      type="password"
                      value={confirmPassword}
                      onChange={e => setConfirmPassword(e.target.value)}
                      placeholder="Repeat new password"
                      className="w-full h-9 px-3 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                    />
                  </div>
                </div>
                {confirmPassword.length > 0 && newPassword !== confirmPassword && (
                  <p className="text-xs text-destructive font-semibold">Passwords do not match</p>
                )}
                <button
                  onClick={handleChangePassword}
                  disabled={passwordChanging || newPassword.length < 6 || newPassword !== confirmPassword}
                  className="w-full py-2 bg-primary text-primary-foreground rounded-lg text-sm font-bold disabled:opacity-40 hover:opacity-90 transition-opacity"
                >
                  {passwordChanging ? 'Updating…' : 'Update Password'}
                </button>
              </div>
            )}

            {/* Export My Data */}
            <button
              onClick={handleExportData}
              disabled={exporting}
              className="flex items-center justify-between w-full p-3 hover:bg-muted/50 rounded-xl transition-colors text-left disabled:opacity-60"
            >
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-emerald-500/10 flex items-center justify-center">
                  <Sparkles className="w-4 h-4 text-emerald-500" />
                </div>
                <div>
                  <p className="font-semibold text-sm">Export My Data</p>
                  <p className="text-xs text-muted-foreground">
                    {exporting ? 'Preparing download…' : 'Download profile, posts & transactions as JSON'}
                  </p>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-muted-foreground" />
            </button>

            {/* ── Referral Code Widget ── */}
            <div className="p-3 bg-primary/5 border border-primary/15 rounded-xl space-y-2">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-primary shrink-0" />
                <p className="text-sm font-bold flex-1">Refer & Earn</p>
                {referralCountLabel ? (
                  <span className="text-[10px] font-bold text-primary bg-primary/10 px-2 py-0.5 rounded-full">{referralCountLabel}</span>
                ) : null}
              </div>
              <p className="text-xs text-muted-foreground">Share your link — earn rewards when friends join</p>
              <div className="flex items-center gap-2">
                <div className="flex-1 bg-background border border-border rounded-lg px-3 py-1.5 text-[11px] font-mono text-muted-foreground truncate">
                  {referralLink}
                </div>
                <button
                  onClick={() => navigator.clipboard.writeText(referralLink).then(() => toast.success('Referral link copied!')).catch(() => {})}
                  className="px-3 py-1.5 bg-primary text-primary-foreground rounded-lg text-xs font-bold hover:opacity-90 transition-opacity flex items-center gap-1.5 shrink-0"
                >
                  <Copy className="w-3 h-3" /> Copy
                </button>
              </div>
            </div>

            {/* Delete Account */}
            {!showDeleteConfirm ? (
              <button
                onClick={() => setShowDeleteConfirm(true)}
                className="flex items-center gap-3 w-full p-3 hover:bg-destructive/5 rounded-xl transition-colors text-left"
              >
                <div className="w-9 h-9 rounded-full bg-destructive/10 flex items-center justify-center shrink-0">
                  <Trash2 className="w-4 h-4 text-destructive" />
                </div>
                <div>
                  <p className="font-semibold text-sm text-destructive">Delete Account</p>
                  <p className="text-xs text-muted-foreground">Permanently remove all your data</p>
                </div>
              </button>
            ) : (
              <div className="p-3 bg-destructive/5 border border-destructive/20 rounded-xl space-y-3">
                <div className="flex items-start gap-2.5">
                  <AlertTriangle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-bold text-destructive">Delete your account?</p>
                    <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                      This cannot be undone. All posts, followers, earnings, and data will be permanently removed. Withdraw your wallet balance first.
                    </p>
                  </div>
                </div>
                <div>
                  <p className="text-xs font-semibold text-muted-foreground mb-1.5">
                    Type your username to confirm: <span className="text-foreground font-bold">@{user.username}</span>
                  </p>
                  <input
                    type="text"
                    value={deleteInput}
                    onChange={e => setDeleteInput(e.target.value)}
                    placeholder={user.username}
                    className="w-full h-9 px-3 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-destructive/30"
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => { setShowDeleteConfirm(false); setDeleteInput(''); }}
                    className="flex-1 py-2 border border-border rounded-lg text-sm font-semibold hover:bg-muted transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleDeleteAccount}
                    disabled={deleting || deleteInput !== user.username}
                    className="flex-1 py-2 bg-destructive text-destructive-foreground rounded-lg text-sm font-bold disabled:opacity-40 hover:opacity-90 transition-opacity"
                  >
                    {deleting ? 'Deleting…' : 'Delete'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── Appearance ── */}
        <div className="p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Appearance</h2>
            {savingAppearance && <span className="text-[10px] text-muted-foreground">Saving…</span>}
          </div>

          <div className="flex items-center gap-3 p-3 rounded-xl mb-3 bg-muted/20 border border-border">
            <div className="w-9 h-9 rounded-full bg-purple-500/10 flex items-center justify-center shrink-0">
              <Palette className="w-4 h-4 text-purple-500" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-sm">Theme</p>
              <p className="text-xs text-muted-foreground">
                {themeChoice === 'system'
                  ? `System (${effectiveTheme} mode) · ${activePreset.name}`
                  : `${themeChoice.charAt(0).toUpperCase() + themeChoice.slice(1)} · ${activePreset.name}`}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2 mb-4">
            {THEME_IDS.map((id, i) => {
              const label = THEME_LABELS[i];
              const cls = THEME_CLS[i];
              const active = themeChoice === id;
              return (
                <button
                  key={id}
                  onClick={() => selectTheme(id)}
                  className={`relative flex flex-col items-center gap-2 p-3 border-2 rounded-2xl transition-all ${
                    active ? 'border-primary bg-primary/8 shadow-sm' : 'border-border hover:border-muted-foreground/30 hover:bg-muted/40'
                  }`}
                >
                  <ThemeIcon id={id} cls={cls} active={active} />
                  <span className={`font-semibold text-xs ${active ? 'text-primary' : 'text-foreground'}`}>{label}</span>
                  {active && <span className="absolute top-2 right-2 w-4 h-4 bg-primary rounded-full flex items-center justify-center"><Check className="w-2.5 h-2.5 text-primary-foreground" /></span>}
                  {id === 'system' && <span className="text-[9px] text-muted-foreground leading-none">{effectiveTheme === 'dark' ? '(dark)' : '(light)'}</span>}
                </button>
              );
            })}
          </div>

          <p className="text-xs font-semibold text-muted-foreground mb-2">Choose a style</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
            {THEME_PRESETS.map(preset => {
              const active = appearance.preset === preset.id;
              const previewMode = effectiveTheme === 'dark' ? 'dark' : 'light';
              const preview = preset[previewMode];
              return (
                <button
                  key={preset.id}
                  onClick={() => selectPreset(preset.id)}
                  className={`relative overflow-hidden text-left rounded-2xl border-2 p-2 transition-all ${active ? 'border-primary shadow-sm' : 'border-border hover:border-primary/30'}`}
                >
                  <div
                    className="h-14 rounded-xl border flex items-end justify-between p-2"
                    style={{ background: `hsl(${preview['--background']})`, borderColor: `hsl(${preview['--border']})` }}
                  >
                    <span className="w-8 h-2 rounded-full" style={{ background: `hsl(${preview['--primary']})` }} />
                    <span className="w-5 h-5 rounded-full" style={{ background: `hsl(${preview['--accent']})` }} />
                  </div>
                  <p className="text-xs font-bold mt-2">{preset.name}</p>
                  <p className="text-[10px] text-muted-foreground">{preset.description}</p>
                  {active && <Check className="absolute top-3 right-3 w-3.5 h-3.5 text-primary" />}
                </button>
              );
            })}
          </div>

          <div className="p-3 rounded-2xl bg-muted/20 border border-border space-y-3">
            <p className="text-xs font-semibold">Customize</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-background border border-border">
                <div className="min-w-0">
                  <p className="text-sm font-medium">Accent</p>
                  <p className="text-[10px] text-muted-foreground truncate">Buttons & highlights</p>
                </div>
                <input
                  type="color"
                  value={appearance.accent || '#16a34a'}
                  onChange={e => updateAccent(e.target.value)}
                  className="w-9 h-9 rounded-lg border border-border bg-background cursor-pointer p-1 shrink-0"
                  aria-label="Choose accent color"
                />
              </div>
              <div className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-background border border-border">
                <div className="min-w-0">
                  <p className="text-sm font-medium">Background</p>
                  <p className="text-[10px] text-muted-foreground truncate">Main app surface</p>
                </div>
                <input
                  type="color"
                  value={appearance.background || (effectiveTheme === 'dark' ? '#000000' : '#ffffff')}
                  onChange={e => void persistAppearance({ ...appearance, background: e.target.value })}
                  className="w-9 h-9 rounded-lg border border-border bg-background cursor-pointer p-1 shrink-0"
                  aria-label="Choose background color"
                />
              </div>
            </div>
            <div>
              <p className="text-sm font-medium mb-2">Corner style</p>
              <div className="grid grid-cols-3 gap-2">
                {RADIUS_OPTIONS.map(radius => (
                  <button
                    key={radius}
                    onClick={() => updateRadius(radius)}
                    className={`py-2 rounded-xl border text-xs font-semibold capitalize ${appearance.radius === radius ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:bg-muted'}`}
                  >
                    {radius}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between p-3 mt-3 hover:bg-muted/50 rounded-xl transition-colors">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-slate-500/10 flex items-center justify-center">
                <Moon className="w-4 h-4 text-slate-500" />
              </div>
              <div>
                <p className="font-semibold text-sm">Auto Dark Mode</p>
                <p className="text-xs text-muted-foreground">
                  {darkScheduleEnabled ? 'Dark 20:00 – 07:00, light otherwise' : 'Schedule inactive'}
                </p>
              </div>
            </div>
            <Switch checked={darkScheduleEnabled} onCheckedChange={toggleDarkSchedule} />
          </div>
        </div>

        {/* ── Feed & Personalisation ── */}
        <div className="p-4">
          <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-3">Feed & Personalisation</h2>
          <div className="space-y-1">
            <button
              onClick={() => navigate('/interests')}
              className="flex items-center justify-between w-full p-3 hover:bg-muted/50 rounded-xl transition-colors"
            >
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center">
                  <Sparkles className="w-4 h-4 text-primary" />
                </div>
                <div className="text-left">
                  <p className="font-semibold text-sm">My Interests</p>
                  <p className="text-xs text-muted-foreground">Personalise your For You feed</p>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-muted-foreground" />
            </button>
            <button
              onClick={() => navigate('/wishlist')}
              className="flex items-center justify-between w-full p-3 hover:bg-muted/50 rounded-xl transition-colors"
            >
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-rose-500/10 flex items-center justify-center">
                  <Heart className="w-4 h-4 text-rose-500" />
                </div>
                <div className="text-left">
                  <p className="font-semibold text-sm">Wishlist</p>
                  <p className="text-xs text-muted-foreground">Products you've saved</p>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-muted-foreground" />
            </button>
          </div>
        </div>

        {/* ── Language & Region ── */}
        <div className="p-4">
          <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-3">Language &amp; Region</h2>
          <div className="space-y-3">
            <div>
              <p className="text-xs font-semibold text-muted-foreground mb-2">App Language</p>
              <div className="grid grid-cols-3 gap-2">
                {LOCALES.map(l => (
                  <button
                    key={l.code}
                    onClick={() => handleLocaleChange(l.code)}
                    className={`py-2.5 rounded-xl border-2 text-xs font-bold transition-all ${
                      locale === l.code
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border hover:border-primary/30 text-foreground'
                    }`}
                  >
                    <span className="block">{l.native}</span>
                    <span className="block text-[10px] font-normal text-muted-foreground mt-0.5">{l.label}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-3 p-3 bg-muted/30 border border-border rounded-xl">
              <div className="w-9 h-9 rounded-full bg-blue-500/10 flex items-center justify-center shrink-0">
                <Globe className="w-4 h-4 text-blue-500" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold">Timezone</p>
                <p className="text-xs text-muted-foreground truncate">{timezone}</p>
              </div>
              <span className="text-[10px] text-muted-foreground bg-muted px-2 py-0.5 rounded-full">Auto</span>
            </div>
          </div>
        </div>

        {/* ── Connected Accounts ── */}
        <div className="p-4">
          <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-3">Connected Accounts</h2>
          {!showConnectedForm ? (
            <button
              onClick={() => setShowConnectedForm(true)}
              className="flex items-center justify-between w-full p-3 hover:bg-muted/50 rounded-xl transition-colors text-left"
            >
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-sky-500/10 flex items-center justify-center">
                  <AtSign className="w-4 h-4 text-sky-500" />
                </div>
                <div>
                  <p className="font-semibold text-sm">Social Profiles</p>
                  <p className="text-xs text-muted-foreground">
                    {(twitterHandle || instagramHandle || linkedinUrl) ? 'Tap to edit linked accounts' : 'Link Twitter, Instagram & LinkedIn'}
                  </p>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-muted-foreground" />
            </button>
          ) : (
            <div className="p-3 bg-muted/30 border border-border rounded-xl space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-bold">Connected Accounts</p>
                <button onClick={() => setShowConnectedForm(false)} className="text-xs text-muted-foreground hover:text-foreground">Cancel</button>
              </div>
              <div className="space-y-2">
                <div>
                  <label className="text-xs font-semibold text-muted-foreground block mb-1">Twitter / X handle</label>
                  <input
                    type="text"
                    value={twitterHandle}
                    onChange={e => setTwitterHandle(e.target.value)}
                    placeholder="username (without @)"
                    className="w-full h-9 px-3 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-muted-foreground block mb-1">Instagram handle</label>
                  <input
                    type="text"
                    value={instagramHandle}
                    onChange={e => setInstagramHandle(e.target.value)}
                    placeholder="username (without @)"
                    className="w-full h-9 px-3 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-muted-foreground block mb-1">LinkedIn URL</label>
                  <input
                    type="url"
                    value={linkedinUrl}
                    onChange={e => setLinkedinUrl(e.target.value)}
                    placeholder="https://linkedin.com/in/yourname"
                    className="w-full h-9 px-3 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                </div>
              </div>
              <button
                onClick={handleSaveConnectedAccounts}
                disabled={savingConnected}
                className="w-full py-2 bg-primary text-primary-foreground rounded-lg text-sm font-bold disabled:opacity-40 hover:opacity-90 transition-opacity"
              >
                {savingConnected ? 'Saving…' : 'Save Connected Accounts'}
              </button>
            </div>
          )}
        </div>

        {/* ── Notifications ── */}
        <div className="p-4">
          <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-3">Notifications</h2>
          <div className="space-y-1">
            <div className="flex items-center justify-between p-3 hover:bg-muted/50 rounded-xl transition-colors">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-blue-500/10 flex items-center justify-center">
                  <Bell className="w-4 h-4 text-blue-500" />
                </div>
                <div>
                  <p className="font-semibold text-sm">Push Notifications</p>
                  <p className="text-xs text-muted-foreground">Likes, replies, follows &amp; more</p>
                </div>
              </div>
              <Switch checked={notifications} onCheckedChange={setNotifications} />
            </div>
            <button
              onClick={() => navigate('/notification-preferences')}
              className="flex items-center justify-between w-full p-3 hover:bg-muted/50 rounded-xl transition-colors text-left"
            >
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-indigo-500/10 flex items-center justify-center">
                  <Bell className="w-4 h-4 text-indigo-500" />
                </div>
                <div>
                  <p className="font-semibold text-sm">Notification Preferences</p>
                  <p className="text-xs text-muted-foreground">Per-type controls: likes, tips, follows…</p>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-muted-foreground" />
            </button>
          </div>
        </div>

        {/* ── Notification Sounds ── */}
        <div className="p-4">
          <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-3">Notification Sounds</h2>
          <div className="flex items-center justify-between p-3 hover:bg-muted/50 rounded-xl transition-colors mb-2">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-violet-500/10 flex items-center justify-center">
                {soundsOn ? <Volume2 className="w-4 h-4 text-violet-500" /> : <VolumeX className="w-4 h-4 text-muted-foreground" />}
              </div>
              <div>
                <p className="font-semibold text-sm">Notification Sounds</p>
                <p className="text-xs text-muted-foreground">{soundsOn ? 'Distinct sounds per event' : 'All sounds muted'}</p>
              </div>
            </div>
            <Switch checked={soundsOn} onCheckedChange={toggleSounds} />
          </div>
          {soundsOn && (
            <div className="bg-muted/30 rounded-2xl p-3 space-y-1">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground px-1 mb-2">Preview sounds</p>
              {SOUND_PREVIEW_ITEMS.map(({ type, label, emoji, desc }) => (
                <button
                  key={type}
                  onClick={() => playSound(type as Parameters<typeof playSound>[0])}
                  className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl hover:bg-background/70 active:scale-[0.98] transition-all group"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-lg leading-none w-7 text-center">{emoji}</span>
                    <div className="text-left">
                      <p className="text-sm font-semibold">{label}</p>
                      <p className="text-[11px] text-muted-foreground">{desc}</p>
                    </div>
                  </div>
                  <div className="w-7 h-7 rounded-full bg-violet-500/10 group-hover:bg-violet-500/20 flex items-center justify-center transition-colors">
                    <Play className="w-3 h-3 text-violet-500" fill="currentColor" />
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* ── Privacy & Security ── */}
        <div className="p-4">
          <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-3">Privacy & Security</h2>
          <div className="space-y-1">
            {/* ── Two-Factor Authentication ── */}
            <div className="p-3 border border-border rounded-xl space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-emerald-500/10 flex items-center justify-center shrink-0">
                    <Shield className="w-4 h-4 text-emerald-600" />
                  </div>
                  <div>
                    <p className="font-semibold text-sm">Login OTP Verification</p>
                    <p className="text-xs text-muted-foreground">
                      {twoFaEnabled ? 'OTP sent on unrecognised devices' : 'Disabled — less secure'}
                    </p>
                  </div>
                </div>
                <Switch checked={twoFaEnabled} onCheckedChange={toggleTwoFa} />
              </div>
              {twoFaEnabled && (
                <p className="text-[11px] text-muted-foreground leading-relaxed pl-12">
                  Every login from a new device or browser triggers a one-time code sent to your registered email. Keep your email accessible.
                </p>
              )}
              {!twoFaEnabled && (
                <p className="text-[11px] text-muted-foreground leading-relaxed pl-12">
                  OTP verification is disabled. We strongly recommend keeping it on to protect your account.
                </p>
              )}
            </div>

            <button
              onClick={() => navigate('/blocked')}
              className="flex items-center justify-between w-full p-3 hover:bg-muted/50 rounded-xl transition-colors text-left"
            >
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-rose-500/10 flex items-center justify-center">
                  <UserX className="w-4 h-4 text-rose-500" />
                </div>
                <div>
                  <p className="font-semibold text-sm">Blocked & Muted Users</p>
                  <p className="text-xs text-muted-foreground">Manage who you've blocked</p>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-muted-foreground" />
            </button>
            <button
              onClick={() => navigate('/wallet?tab=security')}
              className="flex items-center justify-between w-full p-3 hover:bg-muted/50 rounded-xl transition-colors text-left"
            >
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center">
                  <Lock className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <p className="font-semibold text-sm">Wallet PIN &amp; Security</p>
                  <p className="text-xs text-muted-foreground">Set PIN, biometric and session lock</p>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-muted-foreground" />
            </button>
            <button
              onClick={() => navigate('/sessions')}
              className="flex items-center justify-between w-full p-3 hover:bg-muted/50 rounded-xl transition-colors text-left"
            >
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-violet-500/10 flex items-center justify-center">
                  <Monitor className="w-4 h-4 text-violet-500" />
                </div>
                <div>
                  <p className="font-semibold text-sm">Active Sessions</p>
                  <p className="text-xs text-muted-foreground">View and sign out of other devices</p>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-muted-foreground" />
            </button>
            <button
              onClick={() => navigate('/policy')}
              className="flex items-center justify-between w-full p-3 hover:bg-muted/50 rounded-xl transition-colors text-left"
            >
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-blue-500/10 flex items-center justify-center">
                  <Shield className="w-4 h-4 text-blue-500" />
                </div>
                <div>
                  <p className="font-semibold text-sm">Community Guidelines</p>
                  <p className="text-xs text-muted-foreground">Our rules &amp; content policy</p>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-muted-foreground" />
            </button>
            <button
              onClick={() => navigate('/privacy')}
              className="flex items-center justify-between w-full p-3 hover:bg-muted/50 rounded-xl transition-colors text-left"
            >
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-green-500/10 flex items-center justify-center">
                  <Shield className="w-4 h-4 text-green-500" />
                </div>
                <div>
                  <p className="font-semibold text-sm">Privacy Policy</p>
                  <p className="text-xs text-muted-foreground">How we protect your data</p>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-muted-foreground" />
            </button>
            <button
              onClick={() => navigate('/terms')}
              className="flex items-center justify-between w-full p-3 hover:bg-muted/50 rounded-xl transition-colors text-left"
            >
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-gray-500/10 flex items-center justify-center">
                  <FileText className="w-4 h-4 text-gray-500" />
                </div>
                <div>
                  <p className="font-semibold text-sm">Terms of Service</p>
                  <p className="text-xs text-muted-foreground">Read our terms</p>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-muted-foreground" />
            </button>
          </div>
        </div>

        {/* ── Help & Support ── */}
        <div className="p-4">
          <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-3">Help & Support</h2>
          <button
            onClick={() => navigate('/help')}
            className="flex items-center justify-between w-full p-3 hover:bg-muted/50 rounded-xl transition-colors text-left"
          >
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-teal-500/10 flex items-center justify-center">
                <HelpCircle className="w-4 h-4 text-teal-500" />
              </div>
              <div>
                <p className="font-semibold text-sm">Help Center</p>
                <p className="text-xs text-muted-foreground">Get help with T Social</p>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>

        {/* ── About ── */}
        <div className="p-4">
          <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-3">About</h2>
          <div className="p-3 bg-muted/30 rounded-xl space-y-1.5">
            <div className="flex items-center gap-2">
              <Smartphone className="w-4 h-4 text-muted-foreground" />
              <p className="text-sm font-medium">T Social v2.0.0</p>
            </div>
            <p className="text-xs text-muted-foreground pl-6">© 2025 T Social. All rights reserved.</p>
            <p className="text-xs text-muted-foreground pl-6">Built with ❤️ for the community</p>
          </div>
        </div>

        {/* ── Logout ── */}
        <div className="p-4">
          <Button onClick={handleLogout} variant="destructive" className="w-full rounded-xl py-5">
            <LogOut className="w-4 h-4 mr-2" />
            Log Out
          </Button>
        </div>
      </div>
    </div>
  );
}
