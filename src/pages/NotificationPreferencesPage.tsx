import { useState, useEffect } from 'react';
import { useSEO } from '@/hooks/useSEO';
import { TopBar } from '@/components/layout/TopBar';
import { backendCapabilities } from '@/services/backendClient';
import { enableLocalPushNotifications, disableLocalPushNotifications, getLocalPushStatus } from '@/services/pushNotifications';
import { useAuth } from '@/hooks/useAuth';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  Bell, Heart, Repeat2, UserPlus, MessageCircle, AtSign,
  DollarSign, TrendingUp, Zap, Globe, Megaphone, Flame,
  Smartphone, Mail, BellRing, Loader2, CheckCircle2,
  ShieldCheck, Star, Trophy, Gift,
} from 'lucide-react';
import { PageAdBanner } from '@/components/features/AdSenseAd';

function NotifPrefsAdBanner() { return <PageAdBanner />; }

// ─── Types ────────────────────────────────────────────────────────────────────
interface NotifPref {
  notif_type: string;
  in_app: boolean;
  push: boolean;
  email: boolean;
}

type Channel = 'in_app' | 'push' | 'email';

// esbuild guard: module-level icon helpers — no inline JSX in data arrays
function iconHeart()       { return <Heart       className="w-4 h-4" />; }
function iconRepeat()      { return <Repeat2      className="w-4 h-4" />; }
function iconUserPlus()    { return <UserPlus     className="w-4 h-4" />; }
function iconMessage()     { return <MessageCircle className="w-4 h-4" />; }
function iconAtSign()      { return <AtSign       className="w-4 h-4" />; }
function iconDollar()      { return <DollarSign   className="w-4 h-4" />; }
function iconSmartphone()  { return <Smartphone   className="w-4 h-4" />; }
function iconShield()      { return <ShieldCheck  className="w-4 h-4" />; }
function iconTrending()    { return <TrendingUp   className="w-4 h-4" />; }
function iconMegaphone()   { return <Megaphone    className="w-4 h-4" />; }
function iconGift()        { return <Gift         className="w-4 h-4" />; }
function iconFlame()       { return <Flame        className="w-4 h-4" />; }
function iconTrophy()      { return <Trophy       className="w-4 h-4" />; }
function iconStar()        { return <Star         className="w-4 h-4" />; }
function iconGlobe()       { return <Globe        className="w-4 h-4" />; }
function iconBell()        { return <Bell         className="w-3.5 h-3.5" />; }
function iconBellRing()    { return <BellRing     className="w-3.5 h-3.5" />; }
function iconMail()        { return <Mail         className="w-3.5 h-3.5" />; }

// esbuild guard: module-level group/type data — no inline JSX
const NOTIF_GROUPS = [
  {
    label: 'Social',
    color: 'from-primary/10 to-primary/5 border-primary/20',
    types: [
      { key: 'like',    label: 'Likes',         description: 'When someone likes your post',       iconFn: iconHeart,    color: 'text-pink-500'   },
      { key: 'repost',  label: 'Reposts',        description: 'When someone reposts your content',  iconFn: iconRepeat,   color: 'text-green-500'  },
      { key: 'follow',  label: 'New Followers',  description: 'When someone follows you',           iconFn: iconUserPlus, color: 'text-primary'    },
      { key: 'reply',   label: 'Replies',        description: 'When someone replies to your post',  iconFn: iconMessage,  color: 'text-blue-500'   },
      { key: 'mention', label: 'Mentions',       description: 'When someone @mentions you',         iconFn: iconAtSign,   color: 'text-violet-500' },
    ],
  },
  {
    label: 'Payments & Earnings',
    color: 'from-green-600/10 to-green-500/5 border-green-600/20',
    types: [
      { key: 'deposit_confirmed', label: 'Deposits',         description: 'M-Pesa top-up confirmed',          iconFn: iconDollar,     color: 'text-green-600' },
      { key: 'payment_sent',      label: 'Payouts sent',     description: 'When a payout is sent to you',     iconFn: iconSmartphone, color: 'text-blue-600'  },
      { key: 'payment_failed',    label: 'Payment failures', description: 'When a payment or payout fails',   iconFn: iconShield,     color: 'text-red-500'   },
      { key: 'boost_activated',   label: 'Boost activated',  description: 'When your post boost goes live',   iconFn: iconTrending,   color: 'text-purple-600'},
    ],
  },
  {
    label: 'Creator & Ads',
    color: 'from-orange-600/10 to-amber-500/5 border-orange-600/20',
    types: [
      { key: 'ad_active',    label: 'Ad approved',   description: 'Your ad is now live',        iconFn: iconMegaphone, color: 'text-green-600' },
      { key: 'ad_rejected',  label: 'Ad rejected',   description: 'Your ad was rejected',       iconFn: iconMegaphone, color: 'text-red-500'   },
      { key: 'tip_received', label: 'Tips received', description: 'When someone tips you',      iconFn: iconGift,      color: 'text-amber-500' },
    ],
  },
  {
    label: 'Milestones & Rewards',
    color: 'from-yellow-600/10 to-amber-500/5 border-yellow-600/20',
    types: [
      { key: 'streak_milestone', label: 'Daily streak',  description: 'Daily check-in streak milestones',   iconFn: iconFlame,  color: 'text-orange-500' },
      { key: 'leaderboard',      label: 'Leaderboard',   description: 'Ranking changes and top-10 alerts',  iconFn: iconTrophy, color: 'text-yellow-500' },
      { key: 'verification',     label: 'Verification',  description: 'Account verification updates',        iconFn: iconStar,   color: 'text-primary'    },
    ],
  },
  {
    label: 'Fediverse',
    color: 'from-purple-600/10 to-purple-500/5 border-purple-600/20',
    types: [
      { key: 'fediverse_follow',  label: 'Fediverse follows',  description: 'Remote followers from Mastodon etc.', iconFn: iconGlobe,   color: 'text-purple-500' },
      { key: 'fediverse_mention', label: 'Fediverse mentions', description: 'Mentions from remote instances',       iconFn: iconAtSign,  color: 'text-purple-400' },
    ],
  },
];

// esbuild guard: module-level channels — no inline JSX
const CHANNELS = [
  { key: 'in_app' as Channel, label: 'In-App', iconFn: iconBell     },
  { key: 'push'   as Channel, label: 'Push',   iconFn: iconBellRing },
  { key: 'email'  as Channel, label: 'Email',  iconFn: iconMail     },
];

const ALL_TYPES = NOTIF_GROUPS.flatMap(g => g.types.map(t => t.key));

function buildDefaults(): NotifPref[] {
  return ALL_TYPES.map(key => ({
    notif_type: key,
    in_app: true,
    push: ['like', 'follow', 'mention', 'reply', 'deposit_confirmed', 'payment_sent'].includes(key),
    email: ['deposit_confirmed', 'payment_failed'].includes(key),
  }));
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function NotificationPreferencesPage() {
  const { user } = useAuth();
  useSEO({ noindex: true, title: 'Notification Preferences', url: '/notification-preferences' });
  const navigate = useNavigate();
  // esbuild guard: no explicit generics on useState
  const [prefs, setPrefs] = useState({} as Record<string, NotifPref>);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState('');   // esbuild guard: string not string|null
  const [masterMute, setMasterMute] = useState(false);
  const [testing, setTesting] = useState(false);
  const [pushStatus, setPushStatus] = useState<NotificationPermission | 'unsupported'>('unsupported');
  const [pushBusy, setPushBusy] = useState(false);
  const enabledCount = Object.values(prefs).filter(p => p.in_app || p.push || p.email).length;
  const pushEnabledCount = Object.values(prefs).filter(p => p.push).length;
  const emailEnabledCount = Object.values(prefs).filter(p => p.email).length;

  useEffect(() => {
    if (!user) { navigate('/auth'); return; }
    loadPrefs();
    void getLocalPushStatus().then(setPushStatus);
  }, [user]);

  const loadPrefs = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const { items: data } = await backendCapabilities.listNotificationPreferences();
      const map: Record<string, NotifPref> = {};
      buildDefaults().forEach(d => { map[d.notif_type] = d; });
      (data ?? []).forEach((row: any) => {
        map[row.notif_type] = { notif_type: row.notif_type, in_app: row.in_app, push: row.push, email: row.email };
      });
      setPrefs(map);
      setMasterMute(ALL_TYPES.length > 0 && ALL_TYPES.every(type => !map[type]?.push));
    } finally {
      setLoading(false);
    }
  };

  const togglePref = async (type: string, channel: Channel) => {
    if (!user) return;
    setSaving(`${type}-${channel}`);
    const current = prefs[type] ?? { notif_type: type, in_app: true, push: false, email: false };
    const updated = { ...current, [channel]: !current[channel] };
    setPrefs(prev => ({ ...prev, [type]: updated }));
    try {
      await backendCapabilities.upsertNotificationPreference({ notif_type: type, in_app: updated.in_app, push: updated.push, email: updated.email });
      toast.success(`${type} ${channel.replace('_', ' ')} ${updated[channel] ? 'enabled' : 'disabled'}`);
    } catch (error) {
      setPrefs(prev => ({ ...prev, [type]: current }));
      toast.error(error instanceof Error ? error.message : 'Could not save notification preference');
    } finally {
      setSaving('');
    }
  };

  const enablePush = async () => {
    setPushBusy(true);
    try { const result = await enableLocalPushNotifications(); if (result.enabled) { setPushStatus('granted'); toast.success('Push notifications enabled on this device'); } else toast.error(`Push notifications unavailable: ${result.reason ?? 'unknown error'}`); }
    catch (error) { toast.error(error instanceof Error ? error.message : 'Failed to enable push notifications'); }
    finally { setPushBusy(false); }
  };

  const disablePush = async () => {
    setPushBusy(true);
    try { await disableLocalPushNotifications(); setPushStatus('default'); toast.success('Push notifications disabled on this device'); }
    catch (error) { toast.error(error instanceof Error ? error.message : 'Failed to disable push notifications'); }
    finally { setPushBusy(false); }
  };

  const toggleMasterMute = async () => {
    if (!user) return;
    const next = !masterMute;
    setMasterMute(next);
    const updates = ALL_TYPES.map(type => {
      const current = prefs[type] ?? { notif_type: type, in_app: true, push: false, email: false };
      return { user_id: user.id, notif_type: type, in_app: current.in_app, push: next ? false : current.push, email: current.email, updated_at: new Date().toISOString() };
    });
    await Promise.all(updates.map(row => backendCapabilities.upsertNotificationPreference({ notif_type: row.notif_type, in_app: row.in_app, push: row.push, email: row.email })));
    if (next) {
      setPrefs(prev => { const clone = { ...prev }; ALL_TYPES.forEach(t => { clone[t] = { ...clone[t], push: false }; }); return clone; });
      toast.success('Push notifications muted');
    } else {
      toast.success('Push notifications restored');
    }
  };

  const saveAll = async () => {
    if (!user) return;
    setSaving('all');
    const rows = Object.values(prefs).map(p => ({
      user_id: user.id, notif_type: p.notif_type,
      in_app: p.in_app, push: p.push, email: p.email,
      updated_at: new Date().toISOString(),
    }));
    await Promise.all(rows.map(row => backendCapabilities.upsertNotificationPreference({ notif_type: row.notif_type, in_app: row.in_app, push: row.push, email: row.email })));
    setSaving('');
    setMasterMute(ALL_TYPES.length > 0 && ALL_TYPES.every(type => !prefs[type]?.push));
    toast.success('Notification preferences saved');
  };

  const handleTestNotification = async () => {
    setTesting(true);
    try { await backendCapabilities.testPush(); toast.success('Test notification queued. Close Testagram and check your device notifications.'); }
    catch (error) { toast.error(error instanceof Error ? error.message : 'Test notification failed'); }
    finally { setTesting(false); }
  };

  if (!user) return null;

  return (
    <div className="min-h-screen bg-background pb-20 md:pb-6">
      <TopBar title="Notification Preferences" showBack />
      <NotifPrefsAdBanner />

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      ) : (
        <div className="max-w-2xl mx-auto p-4 space-y-5">
          {/* Notification overview */}
          <section className="relative overflow-hidden rounded-3xl border border-primary/20 bg-gradient-to-br from-primary/12 via-background to-purple-500/10 p-5">
            <div className="pointer-events-none absolute -right-12 -top-12 h-36 w-36 rounded-full bg-primary/15 blur-3xl" />
            <div className="relative">
              <div className="flex items-start gap-3">
                <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/20"><Bell className="h-6 w-6" /></div>
                <div className="min-w-0 flex-1"><p className="text-lg font-black">Notification Controls</p><p className="mt-1 text-sm text-muted-foreground">Choose what reaches you and where it appears.</p></div>
              </div>
              <div className="mt-5 grid grid-cols-3 gap-2">
                <div className="rounded-2xl border border-border/70 bg-background/60 p-3"><p className="text-[10px] text-muted-foreground">Categories</p><p className="mt-1 text-xl font-black">{enabledCount}/{ALL_TYPES.length}</p></div>
                <div className="rounded-2xl border border-border/70 bg-background/60 p-3"><p className="text-[10px] text-muted-foreground">Push on</p><p className="mt-1 text-xl font-black">{pushEnabledCount}</p></div>
                <div className="rounded-2xl border border-border/70 bg-background/60 p-3"><p className="text-[10px] text-muted-foreground">Email on</p><p className="mt-1 text-xl font-black">{emailEnabledCount}</p></div>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2">
                <button onClick={toggleMasterMute} className={`flex items-center justify-center gap-2 rounded-xl border px-3 py-3 text-sm font-bold ${masterMute ? 'border-destructive/40 bg-destructive/10 text-destructive' : 'border-border bg-background/70 hover:bg-muted'}`}><BellRing className="h-4 w-4" />{masterMute ? 'Push muted' : 'Mute push'}</button>
                <button onClick={saveAll} disabled={saving === 'all'} className="flex items-center justify-center gap-2 rounded-xl bg-primary px-3 py-3 text-sm font-bold text-primary-foreground hover:opacity-90 disabled:opacity-60">{saving === 'all' ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}Save changes</button>
              </div>
            </div>
          </section>

          {/* Device permission */}
          <section className="overflow-hidden rounded-3xl border border-border bg-card">
            <div className="flex items-center gap-3 border-b border-border p-4">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10"><Smartphone className="h-5 w-5 text-primary" /></div>
              <div className="min-w-0 flex-1"><p className="font-bold">This device</p><p className="mt-0.5 text-xs text-muted-foreground">Receive Testagram alerts when the site is in the background.</p></div>
              <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${pushStatus === 'granted' ? 'bg-green-500/10 text-green-600' : pushStatus === 'denied' ? 'bg-destructive/10 text-destructive' : 'bg-muted text-muted-foreground'}`}>{pushStatus === 'granted' ? 'Enabled' : pushStatus === 'denied' ? 'Blocked' : pushStatus === 'unsupported' ? 'Unavailable' : 'Not enabled'}</span>
            </div>
            <div className="flex items-center justify-between gap-3 p-4">
              <p className="text-xs text-muted-foreground">{pushStatus === 'denied' ? 'Browser permission is blocked. Allow notifications for Testagram in your browser settings, then return here.' : 'Push requires browser permission and an active service worker.'}</p>
              {pushStatus === 'granted' ? <button onClick={disablePush} disabled={pushBusy} className="shrink-0 rounded-xl border border-border px-3 py-2 text-sm font-bold disabled:opacity-60">{pushBusy ? 'Working…' : 'Disable'}</button> : <button onClick={enablePush} disabled={pushBusy || pushStatus === 'unsupported' || pushStatus === 'denied'} className="shrink-0 rounded-xl bg-primary px-3 py-2 text-sm font-bold text-primary-foreground disabled:opacity-60">{pushBusy ? 'Enabling…' : 'Enable'}</button>}
            </div>
          </section>

          {/* Test notification */}
          <section className="flex items-center gap-3 rounded-2xl border border-border bg-card p-4">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10"><Zap className="h-5 w-5 text-primary" /></div>
            <div className="min-w-0 flex-1"><p className="text-sm font-bold">Test your notifications</p><p className="mt-0.5 text-xs text-muted-foreground">Send a real test through Testagram's push pipeline.</p></div>
            <button onClick={handleTestNotification} disabled={testing || pushStatus !== 'granted'} className="shrink-0 rounded-xl border border-border px-3 py-2 text-sm font-bold hover:bg-muted disabled:opacity-50">{testing ? 'Sending…' : 'Send test'}</button>
          </section>

          {/* Groups */}
          {NOTIF_GROUPS.map(group => (
            <div key={group.label} className={`bg-gradient-to-br ${group.color} border rounded-2xl overflow-hidden`}>
              <div className="px-4 py-3 border-b border-inherit">
                <h3 className="font-bold text-sm">{group.label}</h3>
              </div>
              <div className="divide-y divide-border/40">
                {group.types.map(type => {
                  const pref = prefs[type.key] ?? { notif_type: type.key, in_app: true, push: false, email: false };
                  return (
                    <div key={type.key} className="flex items-center gap-3 px-4 py-3.5 hover:bg-white/5 transition-colors">
                      <div className={`shrink-0 ${type.color}`}>{type.iconFn()}</div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-sm leading-tight">{type.label}</p>
                        <p className="text-xs text-muted-foreground leading-tight mt-0.5">{type.description}</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {CHANNELS.map(ch => {
                          const isOn = pref[ch.key];
                          const isSaving = saving === `${type.key}-${ch.key}`;
                          return (
                            <button key={ch.key} onClick={() => togglePref(type.key, ch.key)} disabled={!!saving} title={`${isOn ? 'Disable' : 'Enable'} ${ch.label}`}
                              className={`relative w-10 h-6 rounded-full transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60 ${isOn ? 'bg-primary' : 'bg-muted'}`}>
                              <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform duration-200 flex items-center justify-center ${isOn ? 'translate-x-4' : 'translate-x-0'}`}>
                                {isSaving && <Loader2 className="w-2.5 h-2.5 text-primary animate-spin" />}
                              </span>
                              <span className="sr-only">{ch.label}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          <div className="text-center text-xs text-muted-foreground pb-4">
            <p>Push notifications require browser permission.</p>
            <p className="mt-0.5">Email notifications are sent to your registered address.</p>
          </div>
        </div>
      )}
    </div>
  );
}
