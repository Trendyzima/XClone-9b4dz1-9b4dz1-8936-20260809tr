import { useState, useEffect, useRef, useMemo } from 'react';
import SavingsGoalsTab from '@/components/features/SavingsGoalsTab';
import TransactionRemindersTab from '@/components/features/TransactionRemindersTab';
import FriendActivityFeed from '@/components/features/FriendActivityFeed';
import { TwoFAModal, TwoFASetupCard, MpesaPaymentHistory, WalletBudgetPlanner, FriendBalanceComparison, DirectMpesaSendPanel, WALLET_EXTRAS_OTP_EXPIRY_MS } from '@/components/features/WalletExtras';
import { MpesaFullTab } from '@/components/features/MpesaTab';
import { PageAdBanner } from '@/components/features/AdSenseAd';
import { useSEO } from '@/hooks/useSEO';
import { useSearchParams } from 'react-router-dom';
import { TopBar } from '@/components/layout/TopBar';
import { WalletDashboard } from '@/components/features/WalletDashboard';
import { AdvertiserSurface } from '@/components/features/AdvertiserSurface';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useWallet } from '@/hooks/useWallet';
import { toast } from 'sonner';
import { FunctionsHttpError } from '@supabase/supabase-js';
import {
  Smartphone, Loader2, CheckCircle2, Clock, AlertCircle,
  Phone, Zap, ArrowDownLeft, X, ArrowUpRight, Wallet, Download,
  Send, Search, UserCheck, Copy, TrendingUp, BarChart3,
  PieChart as LucidePieChart, Shield, Bell, BellOff, Settings2,
  QrCode, Calendar, RefreshCw, ChevronDown, ExternalLink, Key,
  Filter, Lock, Users, Gift, Printer, Globe,
  Fingerprint, Star, UserPlus, Activity, AlertTriangle, FileText
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer, Legend,
  AreaChart, Area,
} from 'recharts';

// ── Module-level constants ────────────────────────────────────────────────
const USD_TO_KES = 130;
const PIE_COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];
const PIN_PAD_KEYS = ['1','2','3','4','5','6','7','8','9','','0','del'];
const PIN_MAX_ATTEMPTS    = 3;
const FAVORITES_MAX = 5;
// TWO_FA_DEFAULT_THRESHOLD, BUDGET_CATEGORIES_LIST, SAVINGS_TIERS defined in WalletExtras.tsx

type TopUpStep    = 'idle' | 'sending' | 'polling' | 'success' | 'failed';
type WithdrawStep = 'idle' | 'sending' | 'polling' | 'success' | 'failed';
type CurrencyCode = 'USD' | 'KES' | 'EUR';
type ActiveTab    = 'wallet' | 'history' | 'send' | 'receive' | 'analytics' | 'referrals' | 'scheduled' | 'savings' | 'reminders' | 'security' | 'converter' | 'pocket' | 'mpesa';
type SendMode     = 'send' | 'request' | 'mpesa-direct';
const GOAL_MILESTONES = [25, 50, 75, 100] as const;
const GOAL_MILESTONE_EMOJIS = { 25: '📈', 50: '🌟', 75: '🏆', 100: '🎉' } as const;

const CURRENCIES: { code: CurrencyCode; symbol: string; rate: number }[] = [
  { code: 'USD', symbol: '$',    rate: 1    },
  { code: 'KES', symbol: 'KES ', rate: 130  },
  { code: 'EUR', symbol: '€',    rate: 0.92 },
];

const LOYALTY_TIERS = [
  { name: 'Platinum', min: 500, emoji: '💎', color: 'text-slate-400',  bg: 'bg-slate-400/10',  border: 'border-slate-400/30'  },
  { name: 'Gold',     min: 200, emoji: '🏆', color: 'text-amber-500',  bg: 'bg-amber-500/10',  border: 'border-amber-500/30'  },
  { name: 'Silver',   min: 50,  emoji: '🥈', color: 'text-gray-400',   bg: 'bg-gray-400/10',   border: 'border-gray-400/30'   },
  { name: 'Bronze',   min: 0,   emoji: '🥉', color: 'text-amber-700',  bg: 'bg-amber-700/10',  border: 'border-amber-700/30'  },
];

const MPESA_SECRETS = [
  { key: 'MPESA_CONSUMER_KEY',    desc: 'OAuth consumer key',                        where: 'Safaricom Developer Portal → My Apps → Consumer Key'     },
  { key: 'MPESA_CONSUMER_SECRET', desc: 'OAuth consumer secret',                     where: 'Safaricom Developer Portal → My Apps → Consumer Secret'  },
  { key: 'MPESA_SHORTCODE',       desc: 'Till/paybill number (sandbox: 174379)',      where: 'Safaricom Business → Account → Business Short Code'      },
  { key: 'MPESA_PASSKEY',         desc: 'STK Push passkey',                           where: 'Safaricom Developer Portal → Test Credentials → Passkey' },
  { key: 'MPESA_B2C_SHORTCODE',   desc: 'B2C payout shortcode',                      where: 'Safaricom Developer Portal → B2C Test Credentials'       },
  { key: 'MPESA_INITIATOR_NAME',  desc: 'B2C initiator username (sandbox: testapi)',  where: 'Safaricom Developer Portal → B2C → Initiator Name'       },
  { key: 'MPESA_SECURITY_CRED',   desc: 'B2C encrypted security credential',          where: 'Safaricom Developer Portal → B2C → Security Credential'  },
];

// ── Pure helpers ──────────────────────────────────────────────────────────
function fmtAmt(usd: number, cur: CurrencyCode): string {
  const c = CURRENCIES.find(x => x.code === cur) ?? CURRENCIES[0];
  const v = usd * c.rate;
  return cur === 'KES'
    ? `KES ${Math.round(v).toLocaleString()}`
    : `${c.symbol}${v.toFixed(2)}`;
}

function hashPin(pin: string): Promise<string> {
  return crypto.subtle.digest('SHA-256', new TextEncoder().encode(pin + 'tsocial-pin-v1'))
    .then(buf => Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join(''));
}

function getLoyaltyTier(totalDeposited: number) {
  return LOYALTY_TIERS.find(t => totalDeposited >= t.min) ?? LOYALTY_TIERS[LOYALTY_TIERS.length - 1];
}

function verifyBiometric(credentialId: string): Promise<boolean> {
  const rawId = Uint8Array.from(atob(credentialId), ch => ch.charCodeAt(0));
  const opts: any = {
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      allowCredentials: [{ type: 'public-key', id: rawId }],
      userVerification: 'required',
      timeout: 60000,
    },
  };
  return navigator.credentials.get(opts).then(c => !!c).catch(() => false);
}

// ── Currency Badge ────────────────────────────────────────────────────────
function CurrencyBadge({ currency, onChange }: { currency: CurrencyCode; onChange: (c: CurrencyCode) => void }) {
  return (
    <div className="flex items-center gap-0.5 bg-muted rounded-xl p-1">
      {CURRENCIES.map(c => (
        <button key={c.code} onClick={() => onChange(c.code)}
          className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-colors ${
            currency === c.code ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'
          }`}>{c.code}</button>
      ))}
    </div>
  );
}

// ── Loyalty Badge ─────────────────────────────────────────────────────────
function LoyaltyBadge({ totalDeposited }: { totalDeposited: number }) {
  const { tier, nextTier } = useMemo(() => ({
    tier: getLoyaltyTier(totalDeposited),
    nextTier: LOYALTY_TIERS.find(t => t.min > totalDeposited),
  }), [totalDeposited]);
  return (
    <div className="flex flex-col gap-0.5">
      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black border ${tier.bg} ${tier.border} ${tier.color}`}>
        {tier.emoji} {tier.name}
      </span>
      {nextTier && (
        <span className="text-[9px] text-muted-foreground">
          ${(nextTier.min - totalDeposited).toFixed(0)} to {nextTier.name}
        </span>
      )}
    </div>
  );
}

// ── PIN Entry Modal (with brute-force lock) ──────────────────────────────
function PinEntryModal({ title, onConfirm, onCancel, userId }: {
  title: string; onConfirm: (pin: string) => void; onCancel: () => void; userId?: string;
}) {
  const [pin,          setPin]      = useState('');
  const [lockedUntil,  setLockedUntil] = useState(null as number | null);
  const [failCount,    setFailCount]   = useState(0);
  const [countdown,    setCountdown]   = useState(0);
  const cdRef = useRef(null as ReturnType<typeof setInterval> | null);

  useEffect(() => {
    if (!userId) return;
    try {
      const raw = localStorage.getItem(`ts-pin-meta-${userId}`);
      if (raw) {
        const meta = JSON.parse(raw);
        const fc = meta.failCount ?? 0;
        const lu = meta.lockedUntil ?? 0;
        setFailCount(fc);
        if (lu > Date.now()) {
          setLockedUntil(lu);
          setCountdown(Math.ceil((lu - Date.now()) / 1000));
        }
      }
    } catch { /* ignore */ }
  }, [userId]);

  useEffect(() => {
    if (!lockedUntil) { if (cdRef.current) clearInterval(cdRef.current); return; }
    cdRef.current = setInterval(() => {
      const remaining = Math.ceil((lockedUntil - Date.now()) / 1000);
      if (remaining <= 0) {
        setLockedUntil(null); setCountdown(0); setFailCount(0);
        if (userId) {
          try {
            const raw = localStorage.getItem(`ts-pin-meta-${userId}`);
            const meta = raw ? JSON.parse(raw) : {};
            meta.failCount = 0; meta.lockedUntil = 0;
            localStorage.setItem(`ts-pin-meta-${userId}`, JSON.stringify(meta));
          } catch { /* ignore */ }
        }
        if (cdRef.current) clearInterval(cdRef.current);
      } else { setCountdown(remaining); }
    }, 1000);
    return () => { if (cdRef.current) clearInterval(cdRef.current); };
  }, [lockedUntil, userId]);

  const handleKey = (key: string) => {
    if (lockedUntil && lockedUntil > Date.now()) return;
    if (key === 'del') { setPin(p => p.slice(0, -1)); return; }
    if (pin.length >= 4) return;
    const next = pin + key;
    setPin(next);
    if (next.length === 4) {
      setTimeout(() => { onConfirm(next); }, 120);
    }
  };

  const isLocked = !!(lockedUntil && lockedUntil > Date.now());
  const attemptsLeft = Math.max(PIN_MAX_ATTEMPTS - failCount, 0);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onCancel}>
      <div className="bg-card border border-border rounded-t-3xl sm:rounded-3xl p-6 w-full max-w-sm shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center ${isLocked ? 'bg-red-500/15' : 'bg-primary/10'}`}>
              <Lock className={`w-4 h-4 ${isLocked ? 'text-red-500' : 'text-primary'}`} />
            </div>
            <div>
              <p className="font-bold text-sm">{title}</p>
              <p className="text-xs text-muted-foreground">
                {isLocked ? `Locked · ${Math.floor(countdown/60)}:${String(countdown%60).padStart(2,'0')} remaining` : 'Enter your 4-digit wallet PIN'}
              </p>
            </div>
          </div>
          <button onClick={onCancel} className="p-2 rounded-full hover:bg-muted transition-colors">
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>
        {isLocked ? (
          <div className="flex flex-col items-center gap-4 py-4 text-center">
            <div className="w-16 h-16 rounded-full bg-red-500/10 flex items-center justify-center">
              <Lock className="w-8 h-8 text-red-500" />
            </div>
            <div>
              <p className="font-bold text-red-500">Wallet PIN Locked</p>
              <p className="text-sm text-muted-foreground mt-1">Too many wrong attempts.</p>
              <p className="text-2xl font-black text-red-500 mt-2">{Math.floor(countdown/60)}:{String(countdown%60).padStart(2,'0')}</p>
              <p className="text-xs text-muted-foreground">Try again after the countdown</p>
            </div>
            <button onClick={onCancel} className="px-6 py-2.5 border border-border rounded-xl font-semibold text-sm hover:bg-muted">Close</button>
          </div>
        ) : (
          <>
            <div className="flex justify-center gap-5 mb-3">
              {[0,1,2,3].map(i => (
                <div key={i} className={`w-5 h-5 rounded-full border-2 transition-all ${
                  pin.length > i ? 'bg-primary border-primary scale-110' : 'border-muted-foreground/40'
                }`} />
              ))}
            </div>
            {userId && failCount > 0 && !isLocked && (
              <p className="text-center text-xs text-red-500 font-semibold mb-4">
                {attemptsLeft} attempt{attemptsLeft !== 1 ? 's' : ''} remaining before lockout
              </p>
            )}
            {!userId && <div className="mb-4" />}
            <div className="grid grid-cols-3 gap-3">
              {PIN_PAD_KEYS.map((key, i) => {
                if (!key) return <div key={i} />;
                return (
                  <button key={i} onClick={() => handleKey(key)}
                    className={`h-14 rounded-2xl font-bold text-xl transition-all active:scale-95 ${
                      key === 'del' ? 'bg-muted text-muted-foreground hover:bg-muted/70' : 'bg-muted hover:bg-primary/10 hover:text-primary'
                    }`}>
                    {key === 'del' ? '⌫' : key}
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── PIN Setup Card ────────────────────────────────────────────────────────
function PinSetupCard({ userId, pinHash, onSaved }: { userId: string; pinHash: string | null; onSaved: () => void }) {
  const hasPin = useMemo(() => !!pinHash, [pinHash]);
  const [mode,       setMode]    = useState('idle' as 'idle' | 'setup' | 'change' | 'remove');
  const [oldPin,     setOldPin]  = useState('');
  const [newPin,     setNewPin]  = useState('');
  const [confirmPin, setConfirm] = useState('');
  const [saving,     setSaving]  = useState(false);
  const resetForm = () => { setMode('idle'); setOldPin(''); setNewPin(''); setConfirm(''); };

  const handleSave = async () => {
    if (newPin.length !== 4 || !/^\d{4}$/.test(newPin)) { toast.error('PIN must be exactly 4 digits'); return; }
    if (newPin !== confirmPin) { toast.error('PINs do not match'); return; }
    if (hasPin && mode === 'change') {
      const oldHash = await hashPin(oldPin);
      if (oldHash !== pinHash) { toast.error('Current PIN is incorrect'); return; }
    }
    setSaving(true);
    const hash = await hashPin(newPin);
    const { error } = await supabase.from('user_wallets').update({ wallet_pin_hash: hash }).eq('user_id', userId);
    setSaving(false);
    if (error) { toast.error('Failed to save PIN'); return; }
    // Track last changed in localStorage
    try {
      const raw = localStorage.getItem(`ts-pin-meta-${userId}`);
      const meta = raw ? JSON.parse(raw) : {};
      meta.lastChanged = new Date().toISOString();
      localStorage.setItem(`ts-pin-meta-${userId}`, JSON.stringify(meta));
    } catch { /* ignore */ }
    toast.success(hasPin ? 'PIN updated!' : 'PIN set!');
    resetForm(); onSaved();
  };

  const handleRemove = async () => {
    if (oldPin.length !== 4) { toast.error('Enter your current PIN'); return; }
    const oldHash = await hashPin(oldPin);
    if (oldHash !== pinHash) { toast.error('PIN is incorrect'); return; }
    setSaving(true);
    const { error } = await supabase.from('user_wallets').update({ wallet_pin_hash: null }).eq('user_id', userId);
    setSaving(false);
    if (error) { toast.error('Failed to remove PIN'); return; }
    toast.success('PIN removed');
    resetForm(); onSaved();
  };

  return (
    <div className="rounded-2xl border border-border overflow-hidden">
      <div className="px-5 py-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Lock className="w-4 h-4 text-primary" />
            <h3 className="font-bold text-sm">Wallet PIN</h3>
            {hasPin && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-500/10 text-green-600 font-bold border border-green-500/20">Active</span>}
          </div>
          {mode === 'idle' && (
            <div className="flex gap-3">
              {hasPin ? (
                <>
                  <button onClick={() => setMode('change')} className="text-xs text-primary font-semibold hover:underline">Change</button>
                  <button onClick={() => setMode('remove')} className="text-xs text-red-500 font-semibold hover:underline">Remove</button>
                </>
              ) : (
                <button onClick={() => setMode('setup')} className="text-xs text-primary font-semibold hover:underline">Set PIN</button>
              )}
            </div>
          )}
        </div>
        {mode === 'idle' && (
          <p className="text-xs text-muted-foreground">
            {hasPin ? 'Your wallet PIN is required before sending or withdrawing.' : 'Set a 4-digit PIN for extra security on withdrawals and transfers.'}
          </p>
        )}
        {mode !== 'idle' && (
          <div className="mt-4 space-y-3">
            {(mode === 'change' || mode === 'remove') && (
              <div>
                <label className="text-xs font-semibold text-muted-foreground mb-1.5 block uppercase tracking-wide">Current PIN</label>
                <input type="password" inputMode="numeric" maxLength={4} placeholder="••••"
                  value={oldPin} onChange={e => setOldPin(e.target.value.replace(/\D/g,'').slice(0,4))}
                  className="w-full h-11 px-3 rounded-xl border border-border bg-background text-sm text-center tracking-widest focus:outline-none focus:ring-2 focus:ring-primary/30" />
              </div>
            )}
            {mode !== 'remove' && (
              <>
                <div>
                  <label className="text-xs font-semibold text-muted-foreground mb-1.5 block uppercase tracking-wide">New PIN</label>
                  <input type="password" inputMode="numeric" maxLength={4} placeholder="••••"
                    value={newPin} onChange={e => setNewPin(e.target.value.replace(/\D/g,'').slice(0,4))}
                    className="w-full h-11 px-3 rounded-xl border border-border bg-background text-sm text-center tracking-widest focus:outline-none focus:ring-2 focus:ring-primary/30" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-muted-foreground mb-1.5 block uppercase tracking-wide">Confirm PIN</label>
                  <input type="password" inputMode="numeric" maxLength={4} placeholder="••••"
                    value={confirmPin} onChange={e => setConfirm(e.target.value.replace(/\D/g,'').slice(0,4))}
                    className="w-full h-11 px-3 rounded-xl border border-border bg-background text-sm text-center tracking-widest focus:outline-none focus:ring-2 focus:ring-primary/30" />
                </div>
              </>
            )}
            <div className="flex gap-3">
              <button onClick={resetForm} className="flex-1 py-2.5 border border-border rounded-xl font-semibold text-sm hover:bg-muted transition-colors">Cancel</button>
              <button onClick={mode === 'remove' ? handleRemove : handleSave} disabled={saving}
                className={`flex-1 py-2.5 rounded-xl font-semibold text-sm disabled:opacity-50 flex items-center justify-center gap-2 ${
                  mode === 'remove' ? 'bg-red-500 text-white hover:bg-red-600' : 'bg-primary text-primary-foreground hover:opacity-90'
                } transition-opacity`}>
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />}
                {saving ? 'Saving…' : mode === 'remove' ? 'Remove PIN' : 'Save PIN'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Biometric Auth Card ───────────────────────────────────────────────────
function BiometricCard({ userId, credentialId, onSaved }: { userId: string; credentialId: string | null; onSaved: () => void }) {
  const [supported, setSupported] = useState(false);
  const [enabling,  setEnabling]  = useState(false);
  const [removing,  setRemoving]  = useState(false);

  useEffect(() => {
    setSupported(
      typeof window !== 'undefined' &&
      typeof (window as any).PublicKeyCredential !== 'undefined' &&
      typeof navigator.credentials?.create === 'function'
    );
  }, []);

  const registerBiometric = async () => {
    setEnabling(true);
    try {
      const challenge = crypto.getRandomValues(new Uint8Array(32));
      const cred = await navigator.credentials.create({
        publicKey: {
          challenge,
          rp: { name: 'Testagram Wallet', id: window.location.hostname },
          user: { id: new TextEncoder().encode(userId), name: userId, displayName: 'Wallet User' },
          pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
          authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required' },
          timeout: 60000,
        },
      }) as PublicKeyCredential;
      const credId = btoa(String.fromCharCode(...new Uint8Array(cred.rawId)));
      const { error } = await supabase.from('user_wallets').update({ biometric_credential_id: credId }).eq('user_id', userId);
      if (error) throw error;
      toast.success('Biometric authentication enabled!');
      onSaved();
    } catch (err: any) {
      if (err.name !== 'NotAllowedError') toast.error(err.message || 'Failed to set up biometrics');
    } finally { setEnabling(false); }
  };

  const removeBiometric = async () => {
    setRemoving(true);
    const { error } = await supabase.from('user_wallets').update({ biometric_credential_id: null }).eq('user_id', userId);
    setRemoving(false);
    if (error) { toast.error('Failed to remove biometrics'); return; }
    toast.success('Biometric authentication removed');
    onSaved();
  };

  if (!supported) return null;

  return (
    <div className="rounded-2xl border border-border overflow-hidden">
      <div className="px-5 py-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Fingerprint className={`w-4 h-4 ${credentialId ? 'text-green-500' : 'text-muted-foreground'}`} />
            <h3 className="font-bold text-sm">Biometric Auth</h3>
            {credentialId && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-500/10 text-green-600 font-bold border border-green-500/20">Active</span>}
          </div>
          {credentialId ? (
            <button onClick={removeBiometric} disabled={removing} className="text-xs text-red-500 font-semibold hover:underline disabled:opacity-50">
              {removing ? 'Removing…' : 'Remove'}
            </button>
          ) : (
            <button onClick={registerBiometric} disabled={enabling} className="text-xs text-primary font-semibold hover:underline disabled:opacity-50">
              {enabling ? 'Setting up…' : 'Enable'}
            </button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          {credentialId ? 'Face ID or fingerprint replaces your wallet PIN for withdrawals and transfers.' : 'Use Face ID, fingerprint, or device PIN as an alternative to your wallet PIN.'}
        </p>
        {!credentialId && <p className="text-[10px] text-muted-foreground/60 mt-1">Requires a device with a platform authenticator (Touch ID, Face ID, Windows Hello).</p>}
      </div>
    </div>
  );
}

// ── PIN Security Dashboard ────────────────────────────────────────────────
function PinSecurityDashboard({ userId, pinHash, credentialId, onRefresh }: {
  userId: string; pinHash: string | null; credentialId: string | null; onRefresh: () => void;
}) {
  const [locked,      setLocked]      = useState(false);
  const [failCount,   setFailCount]   = useState(0);
  const [lastChanged, setLastChanged] = useState(null as string | null);
  const [supported,   setSupported]   = useState(false);

  useEffect(() => {
    setSupported(typeof (window as any).PublicKeyCredential !== 'undefined');
    try {
      const raw = localStorage.getItem(`ts-pin-meta-${userId}`);
      if (raw) {
        const parsed = JSON.parse(raw);
        setFailCount(parsed.failCount ?? 0);
        setLastChanged(parsed.lastChanged ?? null);
      }
    } catch { /* use defaults */ }
    setLocked(localStorage.getItem(`ts-wallet-locked-${userId}`) === '1');
  }, [userId]);

  const lockWallet = () => {
    localStorage.setItem(`ts-wallet-locked-${userId}`, '1');
    setLocked(true);
    toast.success('Wallet locked — re-authenticate to unlock');
  };

  const unlockWallet = () => {
    localStorage.removeItem(`ts-wallet-locked-${userId}`);
    setLocked(false);
    toast.success('Wallet unlocked');
  };

  const resetFailCount = () => {
    try {
      const raw = localStorage.getItem(`ts-pin-meta-${userId}`);
      const parsed = raw ? JSON.parse(raw) : {};
      parsed.failCount = 0;
      localStorage.setItem(`ts-pin-meta-${userId}`, JSON.stringify(parsed));
      setFailCount(0);
      toast.success('Fail count reset');
    } catch { /* ignore */ }
  };

  const statusItems = [
    {
      label: 'Wallet PIN',
      status: pinHash ? 'Active' : 'Not set',
      ok: !!pinHash,
      badgeColor: pinHash ? 'bg-green-500/10 text-green-600 border-green-500/20' : 'bg-muted text-muted-foreground border-border',
      desc: pinHash ? 'PIN is required before transactions.' : 'Set a PIN for extra security.',
      icon: <Lock className="w-4 h-4" />,
    },
    {
      label: 'Biometric Auth',
      status: credentialId ? 'Registered' : supported ? 'Not set' : 'Unavailable',
      ok: !!credentialId,
      badgeColor: credentialId ? 'bg-green-500/10 text-green-600 border-green-500/20' : 'bg-muted text-muted-foreground border-border',
      desc: credentialId ? 'Face ID / fingerprint is registered.' : supported ? 'Enable biometric for faster auth.' : 'Your device does not support platform authenticators.',
      icon: <Fingerprint className="w-4 h-4" />,
    },
    {
      label: 'Wallet Status',
      status: locked ? 'Locked' : 'Unlocked',
      ok: !locked,
      badgeColor: locked ? 'bg-red-500/10 text-red-500 border-red-500/20' : 'bg-green-500/10 text-green-600 border-green-500/20',
      desc: locked ? 'All transactions are blocked until unlocked.' : 'Wallet is active and accepting transactions.',
      icon: locked ? <Lock className="w-4 h-4" /> : <Shield className="w-4 h-4" />,
    },
  ];

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3 p-4 bg-gradient-to-br from-primary/10 to-purple-500/5 border border-primary/20 rounded-2xl">
        <div className="w-12 h-12 rounded-full bg-primary/15 flex items-center justify-center shrink-0">
          <Shield className="w-6 h-6 text-primary" />
        </div>
        <div>
          <h3 className="font-black text-base">Wallet Security</h3>
          <p className="text-xs text-muted-foreground">PIN, biometric, and session lock status</p>
        </div>
      </div>
      <div className="space-y-3">
        {statusItems.map(item => (
          <div key={item.label} className="p-4 border border-border rounded-2xl bg-card">
            <div className="flex items-start justify-between mb-1">
              <div className="flex items-center gap-2">
                <div className={item.ok ? 'text-primary' : 'text-muted-foreground'}>{item.icon}</div>
                <span className="font-bold text-sm">{item.label}</span>
              </div>
              <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold border ${item.badgeColor}`}>{item.status}</span>
            </div>
            <p className="text-xs text-muted-foreground pl-6">{item.desc}</p>
          </div>
        ))}
      </div>
      <div className="p-4 border border-border rounded-2xl bg-card space-y-3">
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-500" />
          <h4 className="font-bold text-sm">Failed Attempts</h4>
          <span className={`ml-auto text-sm font-black ${failCount > 0 ? 'text-red-500' : 'text-green-600'}`}>{failCount}</span>
        </div>
        <p className="text-xs text-muted-foreground">Number of incorrect PIN entries logged locally.</p>
        {failCount > 0 && (
          <button onClick={resetFailCount} className="flex items-center gap-1.5 text-xs text-primary font-semibold hover:underline">
            <RefreshCw className="w-3 h-3" /> Reset counter
          </button>
        )}
        {lastChanged && (
          <p className="text-xs text-muted-foreground">Last PIN change: {new Date(lastChanged).toLocaleString()}</p>
        )}
      </div>
      <div className={`p-4 border rounded-2xl ${locked ? 'border-red-500/30 bg-red-500/5' : 'border-green-500/30 bg-green-500/5'}`}>
        <div className="flex items-center gap-2 mb-2">
          <Lock className={`w-4 h-4 ${locked ? 'text-red-500' : 'text-green-600'}`} />
          <h4 className="font-bold text-sm">Session Lock</h4>
        </div>
        <p className="text-xs text-muted-foreground mb-3">
          {locked ? 'Your wallet is locked. No transactions can be made until you unlock.' : 'Lock your wallet instantly to block all transactions without logging out.'}
        </p>
        {locked ? (
          <button onClick={unlockWallet}
            className="w-full py-2.5 bg-green-600 text-white rounded-xl font-bold text-sm flex items-center justify-center gap-2 hover:bg-green-700 transition-colors">
            <Shield className="w-4 h-4" /> Unlock Wallet
          </button>
        ) : (
          <button onClick={lockWallet}
            className="w-full py-2.5 bg-red-500 text-white rounded-xl font-bold text-sm flex items-center justify-center gap-2 hover:bg-red-600 transition-colors">
            <Lock className="w-4 h-4" /> Lock Wallet Now
          </button>
        )}
      </div>
      <div className="p-4 bg-muted/30 border border-border rounded-2xl text-xs text-muted-foreground">
        <p><strong>Security tip:</strong> Always set a PIN and enable biometric authentication to protect your wallet from unauthorized access.</p>
      </div>
    </div>
  );
}

// ── Installment Payments Panel ────────────────────────────────────────────
function InstallmentPanel({ userId, walletBalance, pinHash, currency, onClose }: {
  userId: string; walletBalance: number; pinHash: string | null; currency: CurrencyCode; onClose: () => void;
}) {
  const [query,       setQuery]     = useState('');
  const [results,     setResults]   = useState([] as any[]);
  const [searching,   setSearching] = useState(false);
  const [recipient,   setRecipient] = useState(null as any);
  const [totalAmt,    setTotalAmt]  = useState('');
  const [installments,setInstall]   = useState(3);
  const [freq,        setFreq]      = useState('monthly' as 'weekly' | 'monthly');
  const [note,        setNote]      = useState('');
  const [saving,      setSaving]    = useState(false);
  const [done,        setDone]      = useState(false);
  const [showPin,     setShowPin]   = useState(false);

  const { perInstall, schedule } = useMemo(() => {
    const total = parseFloat(totalAmt || '0');
    const per   = total > 0 ? parseFloat((total / installments).toFixed(2)) : 0;
    const arr: string[] = [];
    const now = Date.now();
    for (let i = 0; i < installments; i++) {
      const d = new Date(now + (freq === 'weekly' ? (i + 1) * 7 : (i + 1) * 30) * 86400000);
      d.setHours(10, 0, 0, 0);
      arr.push(d.toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' }));
    }
    return { perInstall: per, schedule: arr };
  }, [totalAmt, installments, freq]);

  const searchUsers = async (q: string) => {
    setQuery(q);
    if (q.trim().length < 2) { setResults([]); return; }
    setSearching(true);
    const { data } = await supabase.from('profiles').select('id,username,avatar_url,verified')
      .ilike('username', `%${q.trim()}%`).neq('id', userId).limit(6);
    setResults(data ?? []); setSearching(false);
  };

  const execute = async () => {
    if (!recipient || !totalAmt || parseFloat(totalAmt) <= 0) return;
    setSaving(true);
    const { error } = await supabase.rpc('wallet_create_pay_later', {
      p_to_user_id: recipient.id, p_total: parseFloat(totalAmt), p_installments: installments,
      p_frequency: freq, p_note: note.trim() || null,
    });
    setSaving(false);
    if (error) { toast.error('Failed to schedule installments'); return; }
    toast.success(`${installments} installments scheduled!`);
    setDone(true);
  };

  const handleConfirm = () => { if (pinHash) { setShowPin(true); } else { execute(); } };
  const handlePinConfirm = (pin: string) => {
    hashPin(pin).then(h => {
      setShowPin(false);
      if (h !== pinHash) { toast.error('Incorrect PIN'); return; }
      execute();
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-card border border-border rounded-t-3xl sm:rounded-3xl p-5 w-full max-w-md shadow-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        {showPin && <PinEntryModal title="Confirm Installments" onConfirm={handlePinConfirm} onCancel={() => setShowPin(false)} />}
        <div className="flex items-center justify-between mb-5">
          <div>
            <h3 className="font-black text-lg">Installment Payment</h3>
            <p className="text-xs text-muted-foreground">Split a payment into equal scheduled transfers</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-full hover:bg-muted"><X className="w-4 h-4" /></button>
        </div>
        {done ? (
          <div className="flex flex-col items-center gap-4 py-6 text-center">
            <div className="w-16 h-16 rounded-full bg-green-500/15 flex items-center justify-center">
              <CheckCircle2 className="w-9 h-9 text-green-500" />
            </div>
            <div>
              <p className="font-black text-lg text-green-600">Installments Scheduled!</p>
              <p className="text-sm text-muted-foreground mt-1">{installments} × {fmtAmt(perInstall, currency)} to @{recipient?.username}</p>
            </div>
            <button onClick={onClose} className="px-6 py-2.5 bg-primary text-primary-foreground rounded-full font-semibold text-sm hover:opacity-90">Done</button>
          </div>
        ) : (
          <div className="space-y-4">
            {!recipient ? (
              <div>
                <label className="text-sm font-semibold mb-2 block">Recipient</label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <input value={query} onChange={e => searchUsers(e.target.value)} placeholder="Search by username…"
                    className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
                  {searching && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin" />}
                </div>
                {results.length > 0 && (
                  <div className="mt-1 space-y-1">
                    {results.map(u => (
                      <button key={u.id} onClick={() => { setRecipient(u); setResults([]); setQuery(''); }}
                        className="w-full flex items-center gap-2 p-2.5 rounded-xl border border-border hover:border-primary/30 hover:bg-primary/5 text-left text-sm">
                        <div className="w-8 h-8 rounded-full bg-muted overflow-hidden shrink-0 flex items-center justify-center font-bold text-xs">
                          {u.avatar_url ? <img src={u.avatar_url} alt="" className="w-full h-full object-cover" /> : u.username[0]?.toUpperCase()}
                        </div>
                        <span className="font-semibold flex-1">@{u.username}</span>
                        {u.verified && <UserCheck className="w-3.5 h-3.5 text-primary" />}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-2 p-3 bg-primary/5 border border-primary/20 rounded-xl">
                <div className="w-8 h-8 rounded-full bg-muted overflow-hidden shrink-0 flex items-center justify-center font-bold text-xs">
                  {recipient.avatar_url ? <img src={recipient.avatar_url} alt="" className="w-full h-full object-cover" /> : recipient.username[0]?.toUpperCase()}
                </div>
                <span className="font-semibold text-sm flex-1">@{recipient.username}</span>
                <button onClick={() => setRecipient(null)} className="text-muted-foreground hover:text-destructive"><X className="w-3.5 h-3.5" /></button>
              </div>
            )}
            <div>
              <label className="text-sm font-semibold mb-2 block">Total Amount (USD)</label>
              <input type="number" min="0.01" step="0.01" placeholder="0.00" value={totalAmt} onChange={e => setTotalAmt(e.target.value)}
                className="w-full h-11 px-3 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
            </div>
            <div>
              <label className="text-sm font-semibold mb-2 block">Number of Installments</label>
              <div className="flex gap-2">
                {[2,3,4,5,6].map(n => (
                  <button key={n} onClick={() => setInstall(n)}
                    className={`flex-1 py-2.5 rounded-xl font-bold text-sm border-2 transition-all ${installments === n ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:border-primary/30'}`}>{n}</button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-sm font-semibold mb-2 block">Frequency</label>
              <div className="grid grid-cols-2 gap-2">
                {FREQ_WEEKLY_MONTHLY.map(f => (
                  <button key={f} onClick={() => setFreq(f)}
                    className={`py-2.5 rounded-xl font-bold text-sm border-2 capitalize transition-all ${freq === f ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:border-primary/30'}`}>{f}</button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-sm font-semibold mb-2 block">Note (optional)</label>
              <input type="text" maxLength={80} placeholder="What's this for?" value={note} onChange={e => setNote(e.target.value)}
                className="w-full h-11 px-3 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
            </div>
            {recipient && perInstall > 0 && (
              <div className="p-3 bg-primary/5 border border-primary/15 rounded-xl space-y-2">
                <p className="text-xs font-bold text-primary mb-1">{installments} × {fmtAmt(perInstall, currency)} = {fmtAmt(perInstall * installments, currency)}</p>
                <div className="space-y-1 max-h-36 overflow-y-auto">
                  {schedule.map((d, i) => (
                    <div key={i} className="flex justify-between text-xs">
                      <span className="text-muted-foreground">#{i + 1} · {d}</span>
                      <span className="font-semibold">{fmtAmt(perInstall, currency)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <button onClick={handleConfirm}
              disabled={saving || !recipient || !totalAmt || parseFloat(totalAmt) <= 0}
              className="w-full py-3.5 bg-primary text-primary-foreground rounded-xl font-bold text-base disabled:opacity-50 flex items-center justify-center gap-2 hover:opacity-90 transition-opacity">
              {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Calendar className="w-5 h-5" />}
              {saving ? 'Scheduling…' : `Schedule ${installments} Installments`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Split Payment Panel ───────────────────────────────────────────────────
function SplitPaymentPanel({ userId, senderUsername, walletBalance, pinHash, currency, onClose }: {
  userId: string; senderUsername: string; walletBalance: number;
  pinHash: string | null; currency: CurrencyCode; onClose: () => void;
}) {
  const [query,      setQuery]      = useState('');
  const [searching,  setSearching]  = useState(false);
  const [results,    setResults]    = useState([] as any[]);
  const [recipients, setRecipients] = useState([] as any[]);
  const [total,      setTotal]      = useState('');
  const [note,       setNote]       = useState('');
  const [showPin,    setShowPin]    = useState(false);
  const [step,       setStep]       = useState('form' as 'form' | 'sending' | 'done');
  const [sent,       setSent]       = useState(0);

  const perPerson = useMemo(() => {
    const t = parseFloat(total);
    if (!t || t <= 0 || recipients.length === 0) return 0;
    return parseFloat((t / recipients.length).toFixed(2));
  }, [total, recipients.length]);

  const searchUsers = async (q: string) => {
    setQuery(q);
    if (q.trim().length < 2) { setResults([]); return; }
    setSearching(true);
    const excludeIds = [userId, ...recipients.map(r => r.id)];
    const { data } = await supabase.from('profiles')
      .select('id,username,avatar_url,verified')
      .ilike('username', `%${q.trim()}%`)
      .not('id', 'in', `(${excludeIds.map(id => `"${id}"`).join(',')})`)
      .limit(6);
    setResults(data ?? []);
    setSearching(false);
  };

  const addRecipient = (u: any) => {
    if (recipients.length >= 5) { toast.error('Max 5 recipients'); return; }
    setRecipients(prev => [...prev, u]); setResults([]); setQuery('');
  };

  const executeSplit = async () => {
    setStep('sending');
    const { data: splitId, error } = await supabase.rpc('wallet_create_split', {
      p_total: parseFloat(total), p_recipient_ids: recipients.map(r => r.id), p_note: note.trim() || null,
    });
    if (error || !splitId) {
      setStep('form'); toast.error(error?.message || 'Split failed — no funds were moved.'); return;
    }
    setSent(recipients.length);
    setStep('done');
    toast.success(`Split complete! Sent ${fmtAmt(perPerson, currency)} to ${recipients.length} people.`);
  };

  const handleConfirm = () => { if (pinHash) { setShowPin(true); } else { executeSplit(); } };

  const handlePinConfirm = async (pin: string) => {
    const entered = await hashPin(pin);
    setShowPin(false);
    if (entered !== pinHash) { toast.error('Incorrect PIN'); return; }
    executeSplit();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-card border border-border rounded-t-3xl sm:rounded-3xl p-5 w-full max-w-md shadow-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        {showPin && <PinEntryModal title="Confirm Split" onConfirm={handlePinConfirm} onCancel={() => setShowPin(false)} />}
        <div className="flex items-center justify-between mb-5">
          <div>
            <h3 className="font-black text-lg">Split Bill</h3>
            <p className="text-xs text-muted-foreground">Divide an amount equally among friends</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-full hover:bg-muted transition-colors"><X className="w-4 h-4" /></button>
        </div>
        {step === 'done' ? (
          <div className="flex flex-col items-center gap-4 py-6 text-center">
            <div className="w-16 h-16 rounded-full bg-green-500/15 flex items-center justify-center">
              <CheckCircle2 className="w-9 h-9 text-green-500" />
            </div>
            <div>
              <p className="font-black text-lg text-green-600">Split Complete!</p>
              <p className="text-sm text-muted-foreground mt-1">{fmtAmt(perPerson, currency)} sent to {sent} people</p>
            </div>
            <button onClick={onClose} className="px-6 py-2.5 bg-primary text-primary-foreground rounded-full font-semibold text-sm hover:opacity-90 transition-opacity">Done</button>
          </div>
        ) : step === 'sending' ? (
          <div className="flex flex-col items-center gap-3 py-8">
            <Loader2 className="w-10 h-10 animate-spin text-primary" />
            <p className="font-semibold text-sm">Sending {sent}/{recipients.length}…</p>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <label className="text-sm font-semibold mb-2 block">Recipients <span className="text-muted-foreground font-normal">({recipients.length}/5)</span></label>
              {recipients.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-2">
                  {recipients.map(r => (
                    <div key={r.id} className="flex items-center gap-1.5 px-2.5 py-1.5 bg-primary/10 border border-primary/20 rounded-full text-xs font-semibold">
                      @{r.username}
                      <button onClick={() => setRecipients(prev => prev.filter(x => x.id !== r.id))} className="text-muted-foreground hover:text-destructive">
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {recipients.length < 5 && (
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <input value={query} onChange={e => searchUsers(e.target.value)} placeholder="Add by username…"
                    className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
                  {searching && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin" />}
                </div>
              )}
              {results.length > 0 && (
                <div className="mt-1 space-y-1">
                  {results.map(u => (
                    <button key={u.id} onClick={() => addRecipient(u)}
                      className="w-full flex items-center gap-2 p-2.5 rounded-xl border border-border hover:border-primary/30 hover:bg-primary/5 transition-all text-left text-sm">
                      <div className="w-7 h-7 rounded-full bg-muted overflow-hidden shrink-0 flex items-center justify-center font-bold text-xs">
                        {u.avatar_url ? <img src={u.avatar_url} alt="" className="w-full h-full object-cover" /> : u.username[0]?.toUpperCase()}
                      </div>
                      <span className="font-semibold flex-1">@{u.username}</span>
                      {u.verified && <UserCheck className="w-3.5 h-3.5 text-primary" />}
                      <UserPlus className="w-3.5 h-3.5 text-muted-foreground" />
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div>
              <label className="text-sm font-semibold mb-2 block">Total Amount (USD)</label>
              <input type="number" min="0.01" step="0.01" placeholder="Total to split…" value={total} onChange={e => setTotal(e.target.value)}
                className="w-full h-11 px-3 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
              {recipients.length > 0 && parseFloat(total) > 0 && (
                <p className="text-xs text-primary font-semibold mt-1">
                  {fmtAmt(perPerson, currency)} × {recipients.length} = {fmtAmt(perPerson * recipients.length, currency)}
                </p>
              )}
            </div>
            <div>
              <label className="text-sm font-semibold mb-2 block">Note (optional)</label>
              <input type="text" maxLength={80} placeholder="What's the split for?" value={note} onChange={e => setNote(e.target.value)}
                className="w-full h-11 px-3 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
            </div>
            {recipients.length > 0 && perPerson > 0 && (
              <div className="p-3 bg-primary/5 border border-primary/15 rounded-xl space-y-1">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Each person pays</span>
                  <span className="font-black text-primary">{fmtAmt(perPerson, currency)}</span>
                </div>
                {perPerson * recipients.length > walletBalance && (
                  <p className="text-xs text-red-500 pt-1">Exceeds your balance of {fmtAmt(walletBalance, currency)}</p>
                )}
              </div>
            )}
            <button onClick={handleConfirm}
              disabled={recipients.length === 0 || !total || parseFloat(total) <= 0 || perPerson * recipients.length > walletBalance}
              className="w-full py-3.5 bg-primary text-primary-foreground rounded-xl font-bold text-base disabled:opacity-50 flex items-center justify-center gap-2 hover:opacity-90 transition-opacity">
              {pinHash ? <Lock className="w-5 h-5" /> : <Send className="w-5 h-5" />}
              Split {fmtAmt(parseFloat(total || '0'), currency)} among {recipients.length || '?'} people
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Referral Earnings Tab ─────────────────────────────────────────────────
function ReferralEarningsTab({ userId }: { userId: string }) {
  const [referrals, setReferrals] = useState([] as any[]);
  const [credits,   setCredits]   = useState([] as any[]);
  const [loading,   setLoading]   = useState(true);
  const [copied,    setCopied]    = useState(false);
  const [refLink,   setRefLink]   = useState('');

  useEffect(() => {
    setRefLink(`${window.location.origin}/auth?ref=${userId}`);
    const loadData = async () => {
      setLoading(true);
      const [{ data: refs }, { data: creds }] = await Promise.all([
        supabase.from('wallet_referrals')
          .select('*, invited_user:profiles!wallet_referrals_invited_user_id_fkey(id,username,avatar_url)')
          .eq('inviter_user_id', userId).order('created_at', { ascending: false }),
        supabase.from('wallet_referral_credits').select('*').eq('user_id', userId)
          .eq('reason', 'referral_signup').order('created_at', { ascending: false }).limit(50),
      ]);
      setReferrals(refs ?? []); setCredits(creds ?? []); setLoading(false);
    };
    loadData();
  }, [userId]);

  const totalCredits = useMemo(() => credits.reduce((s, c) => s + Number(c.amount), 0), [credits]);

  const copyLink = () => {
    navigator.clipboard.writeText(refLink).then(() => {
      setCopied(true); toast.success('Referral link copied!');
      setTimeout(() => setCopied(false), 2500);
    });
  };
  const shareLink = async () => {
    if (navigator.share) await navigator.share({ title: 'Join me on Testagram', url: refLink });
    else copyLink();
  };

  return (
    <div className="space-y-5">
      <div className="p-4 rounded-2xl bg-purple-500/10 border border-purple-500/20">
        <div className="flex items-center gap-2 mb-1">
          <Users className="w-4 h-4 text-purple-600" />
          <h3 className="font-bold text-sm text-purple-700 dark:text-purple-400">Your Referral Link</h3>
        </div>
        <p className="text-xs text-muted-foreground mb-3">Earn <strong>100 credits</strong> for every friend who signs up.</p>
        <div className="flex gap-2 mb-3">
          <div className="flex-1 bg-background border border-border rounded-xl px-3 py-2 text-xs font-mono truncate text-muted-foreground">{refLink || '…'}</div>
          <button onClick={copyLink} className="shrink-0 flex items-center gap-1.5 px-3 py-2 bg-purple-600 text-white rounded-xl font-semibold text-xs hover:bg-purple-700 transition-colors">
            {copied ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
        <button onClick={shareLink} className="w-full flex items-center justify-center gap-2 py-2.5 border border-purple-500/30 rounded-xl text-purple-700 dark:text-purple-400 font-semibold text-sm hover:bg-purple-500/10 transition-colors">
          <Send className="w-3.5 h-3.5" /> Share Link
        </button>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="p-4 rounded-2xl bg-primary/10 border border-primary/20">
          <div className="flex items-center gap-1.5 mb-1"><Users className="w-3.5 h-3.5 text-primary" /><p className="text-xs text-muted-foreground">Total Referrals</p></div>
          <p className="text-3xl font-black text-primary">{referrals.length}</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">users signed up</p>
        </div>
        <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/20">
          <div className="flex items-center gap-1.5 mb-1"><Gift className="w-3.5 h-3.5 text-amber-600" /><p className="text-xs text-muted-foreground">Credits Earned</p></div>
          <p className="text-3xl font-black text-amber-600">{totalCredits}</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">from referrals</p>
        </div>
      </div>
      {loading ? (
        <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
      ) : referrals.length === 0 ? (
        <div className="text-center py-12">
          <Users className="w-12 h-12 text-muted-foreground/20 mx-auto mb-3" />
          <p className="font-semibold text-sm">No referrals yet</p>
          <p className="text-xs text-muted-foreground mt-1">Share your link and start earning credits</p>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Referred Users ({referrals.length})</p>
          {referrals.map(r => (
            <div key={r.id} className="flex items-center gap-3 p-3.5 border border-border rounded-2xl bg-card hover:bg-muted/30 transition-colors">
              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0 font-bold text-sm text-primary overflow-hidden">
                {r.invited_user?.avatar_url ? <img src={r.invited_user.avatar_url} alt="" className="w-full h-full object-cover" /> : (r.invited_user?.username?.[0]?.toUpperCase() ?? '?')}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm">@{r.invited_user?.username ?? 'Unknown'}</p>
                <p className="text-xs text-muted-foreground">{new Date(r.created_at).toLocaleDateString()}</p>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-sm font-black text-amber-600">+{r.credits_awarded ?? 0}</p>
                <p className="text-[10px] text-muted-foreground">credits</p>
              </div>
            </div>
          ))}
        </div>
      )}
      <ReferralLeaderboard userId={userId} />
    </div>
  );
}

// ── M-Pesa Secrets Guide ──────────────────────────────────────────────────
function MpesaSecretsGuide() {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-2xl border border-border overflow-hidden">
      <button onClick={() => setOpen(v => !v)} className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-muted/40 transition-colors text-left">
        <div className="w-8 h-8 rounded-full bg-amber-500/10 flex items-center justify-center shrink-0">
          <Key className="w-4 h-4 text-amber-600" />
        </div>
        <div className="flex-1">
          <p className="font-bold text-sm">M-Pesa Setup Guide</p>
          <p className="text-xs text-muted-foreground">Configure secrets in Cloud → Secrets</p>
        </div>
        <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="border-t border-border px-4 pb-4 pt-3 space-y-3">
          <p className="text-xs text-muted-foreground">Add each secret in <strong className="text-foreground">OnSpace Cloud → Secrets</strong>. Use sandbox values for testing.</p>
          <div className="space-y-2">
            {MPESA_SECRETS.map(s => (
              <div key={s.key} className="p-3 bg-background border border-border rounded-xl">
                <code className="text-[11px] font-mono font-bold text-primary bg-primary/10 px-1.5 py-0.5 rounded block mb-1">{s.key}</code>
                <p className="text-xs text-foreground mb-0.5">{s.desc}</p>
                <p className="text-[10px] text-muted-foreground flex items-start gap-1">
                  <ExternalLink className="w-2.5 h-2.5 shrink-0 mt-0.5" />{s.where}
                </p>
              </div>
            ))}
          </div>
          <a href="https://developer.safaricom.co.ke" target="_blank" rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 w-full py-2.5 border border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-400 rounded-xl font-semibold text-xs hover:bg-amber-500/10 transition-colors">
            <ExternalLink className="w-3.5 h-3.5" /> Open Safaricom Developer Portal
          </a>
        </div>
      )}
    </div>
  );
}

// ── Receive Money Tab (QR Code) ───────────────────────────────────────────
function ReceiveMoneyTab({ username, walletBalance, currency }: { username: string; walletBalance: number; currency: CurrencyCode }) {
  const [copied,        setCopied]        = useState(false);
  const [requestAmount, setRequestAmount] = useState('');
  const [requestNote,   setRequestNote]   = useState('');

  const { payUrl, qrImageUrl } = useMemo(() => {
    const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';
    const params  = new URLSearchParams({ tab: 'send', to: username });
    if (requestAmount && parseFloat(requestAmount) > 0) params.set('amount', requestAmount);
    if (requestNote.trim()) params.set('note', requestNote.trim());
    const url = `${baseUrl}/wallet?${params.toString()}`;
    const qr  = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(url)}&bgcolor=ffffff&color=000000&qzone=2&format=png`;
    return { payUrl: url, qrImageUrl: qr };
  }, [username, requestAmount, requestNote]);

  const copyLink = () => {
    navigator.clipboard.writeText(payUrl).then(() => {
      setCopied(true); toast.success('Payment link copied!'); setTimeout(() => setCopied(false), 2500);
    });
  };
  const shareLink = async () => {
    if (navigator.share) await navigator.share({ title: `Pay @${username}`, url: payUrl });
    else copyLink();
  };

  return (
    <div className="space-y-5">
      <div className="p-4 rounded-2xl bg-primary/10 border border-primary/20">
        <p className="text-sm font-semibold text-muted-foreground">Your Balance</p>
        <p className="text-3xl font-black text-primary">{fmtAmt(walletBalance, currency)}</p>
        <p className="text-xs text-muted-foreground mt-0.5">≈ {fmtAmt(walletBalance, currency === 'KES' ? 'USD' : 'KES')}</p>
      </div>
      <div className="space-y-3">
        <div>
          <label className="text-sm font-semibold mb-1.5 block">Request a specific amount (optional)</label>
          <div className="grid grid-cols-4 gap-2 mb-2">
            {[1,5,10,25].map(a => (
              <button key={a} onClick={() => setRequestAmount(requestAmount === String(a) ? '' : String(a))}
                className={`py-2 rounded-xl font-bold text-sm border-2 transition-all ${requestAmount === String(a) ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:border-primary/30'}`}>${a}</button>
            ))}
          </div>
          <input type="number" min="0.01" step="0.01" placeholder="Custom amount (USD)…"
            value={requestAmount && !['1','5','10','25'].includes(requestAmount) ? requestAmount : ''}
            onChange={e => setRequestAmount(e.target.value)}
            className="w-full h-11 px-3 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
        </div>
        <div>
          <label className="text-sm font-semibold mb-1.5 block">Note (optional)</label>
          <input type="text" maxLength={80} placeholder="What's it for?" value={requestNote} onChange={e => setRequestNote(e.target.value)}
            className="w-full h-11 px-3 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
        </div>
      </div>
      <div className="flex flex-col items-center gap-4 p-6 border border-border rounded-2xl bg-card">
        <div className="flex items-center gap-2 mb-1"><QrCode className="w-4 h-4 text-primary" /><p className="font-bold text-sm">Scan to pay @{username}</p></div>
        <div className="p-3 bg-white rounded-2xl shadow-sm border border-border">
          <img src={qrImageUrl} alt={`Pay @${username}`} width={220} height={220} className="rounded-xl" />
        </div>
        {requestAmount && parseFloat(requestAmount) > 0 && (
          <div className="flex items-center gap-2 px-4 py-2 bg-primary/10 border border-primary/20 rounded-full">
            <span className="text-sm font-black text-primary">Requesting ${parseFloat(requestAmount).toFixed(2)}</span>
            {requestNote && <span className="text-xs text-muted-foreground">· {requestNote}</span>}
          </div>
        )}
        <p className="text-xs text-muted-foreground text-center max-w-xs">Show this QR code — they'll be taken to Send Money pre-filled with your username.</p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <button onClick={copyLink} className="flex items-center justify-center gap-2 py-3 border border-border rounded-xl font-semibold text-sm hover:bg-muted transition-colors">
          {copied ? <CheckCircle2 className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
          {copied ? 'Copied!' : 'Copy Link'}
        </button>
        <button onClick={shareLink} className="flex items-center justify-center gap-2 py-3 bg-primary text-primary-foreground rounded-xl font-semibold text-sm hover:opacity-90 transition-opacity">
          <Send className="w-4 h-4" /> Share Link
        </button>
      </div>
    </div>
  );
}

// ── Payout Schedule Card ──────────────────────────────────────────────────
function PayoutScheduleCard({ userId, defaultPhone }: { userId: string; defaultPhone: string | null }) {
  const [schedule,  setSchedule]  = useState(null as any);
  const [loading,   setLoading]   = useState(true);
  const [saving,    setSaving]    = useState(false);
  const [enabled,   setEnabled]   = useState(false);
  const [frequency, setFrequency] = useState('monthly' as 'weekly' | 'monthly');
  const [minAmount, setMinAmount] = useState('5');
  const [phone,     setPhone]     = useState(defaultPhone ?? '');

  useEffect(() => { fetchSchedule(); }, [userId]);
  useEffect(() => { if (defaultPhone && !phone) setPhone(defaultPhone); }, [defaultPhone]);

  const fetchSchedule = async () => {
    setLoading(true);
    const { data } = await supabase.from('wallet_auto_payout_schedules').select('*').eq('user_id', userId).maybeSingle();
    if (data) {
      setSchedule(data); setEnabled(data.is_active); setFrequency(data.frequency ?? 'monthly');
      setMinAmount(String(data.minimum_amount ?? 5)); setPhone(data.payout_destination ?? defaultPhone ?? '');
    }
    setLoading(false);
  };

  const nextPayoutLabel = useMemo(() => {
    if (!schedule?.next_payout_at) return null;
    return new Date(schedule.next_payout_at).toLocaleDateString('en', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  }, [schedule]);

  const handleSave = async () => {
    const phoneTrimmed = phone.trim();
    if (enabled && phoneTrimmed.replace(/\D/g,'').length < 9) { toast.error('Enter a valid M-Pesa number'); return; }
    setSaving(true);
    const nextPayout = new Date();
    if (frequency === 'weekly') nextPayout.setDate(nextPayout.getDate() + 7);
    else nextPayout.setMonth(nextPayout.getMonth() + 1);
    nextPayout.setHours(9, 0, 0, 0);
    const payload = null;
    let err;
    const { error: rpcError } = await supabase.rpc('wallet_upsert_auto_payout_schedule', { p_frequency: frequency, p_minimum_amount: parseFloat(minAmount) || 5, p_destination: phoneTrimmed || null, p_enabled: enabled });
    err = rpcError;
    setSaving(false);
    if (err) { toast.error('Failed to save schedule'); return; }
    toast.success(enabled ? `Auto-payout scheduled ${frequency}` : 'Auto-payout disabled');
    fetchSchedule();
  };

  if (loading) {
    return <div className="rounded-2xl border border-border p-5 flex items-center justify-center"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="rounded-2xl border border-border overflow-hidden">
      <div className="px-5 py-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2"><Calendar className="w-4 h-4 text-primary" /><h3 className="font-bold text-sm">Auto-Payout Schedule</h3></div>
          <button onClick={() => setEnabled(v => !v)} className={`relative w-11 h-6 rounded-full transition-colors ${enabled ? 'bg-primary' : 'bg-muted'}`}>
            <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${enabled ? 'translate-x-5' : 'translate-x-0'}`} />
          </button>
        </div>
        {enabled ? (
          <div className="space-y-4">
            <div>
              <label className="text-xs text-muted-foreground mb-2 block font-semibold uppercase tracking-wide">Frequency</label>
              <div className="grid grid-cols-2 gap-2">
                {FREQ_WEEKLY_MONTHLY.map(f => (
                  <button key={f} onClick={() => setFrequency(f)}
                    className={`py-2.5 rounded-xl font-bold text-sm border-2 capitalize transition-all ${frequency === f ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:border-primary/30'}`}>{f}</button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-2 block font-semibold uppercase tracking-wide">Minimum payout (USD)</label>
              <div className="grid grid-cols-4 gap-2 mb-2">
                {['5','10','25','50'].map(v => (
                  <button key={v} onClick={() => setMinAmount(v)}
                    className={`py-2 rounded-xl font-bold text-xs border-2 transition-all ${minAmount === v ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:border-primary/30'}`}>${v}</button>
                ))}
              </div>
              <input type="number" min="1" step="0.01" placeholder="Custom minimum…"
                value={!['5','10','25','50'].includes(minAmount) ? minAmount : ''}
                onChange={e => setMinAmount(e.target.value)}
                className="w-full h-10 px-3 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-2 block font-semibold uppercase tracking-wide flex items-center gap-1.5">
                <Phone className="w-3 h-3" />M-Pesa destination
              </label>
              <input type="tel" placeholder="0712 345 678" value={phone} onChange={e => setPhone(e.target.value)}
                className="w-full h-11 px-3 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
            </div>
            {nextPayoutLabel && (
              <div className="flex items-center gap-2 p-3 bg-primary/5 border border-primary/15 rounded-xl">
                <RefreshCw className="w-4 h-4 text-primary shrink-0" />
                <div>
                  <p className="text-xs font-semibold">Next scheduled payout</p>
                  <p className="text-[11px] text-muted-foreground">{nextPayoutLabel}</p>
                </div>
              </div>
            )}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground mb-4">Automatically withdraw earnings to M-Pesa weekly or monthly when your balance reaches a minimum.</p>
        )}
        <button onClick={handleSave} disabled={saving}
          className="w-full mt-4 py-2.5 bg-primary text-primary-foreground rounded-xl font-semibold text-sm disabled:opacity-50 flex items-center justify-center gap-2 hover:opacity-90 transition-opacity">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Calendar className="w-4 h-4" />}
          {saving ? 'Saving…' : enabled ? 'Save Schedule' : 'Save (Disabled)'}
        </button>
      </div>
    </div>
  );
}

// ── Wallet Analytics Export Button ────────────────────────────────────────
function WalletAnalyticsExportButton({ userId, currency }: { userId: string; currency: CurrencyCode }) {
  const [exporting, setExporting] = useState(false);

  const exportStatement = async () => {
    setExporting(true);
    const [{ data: txns }, { data: walletData }] = await Promise.all([
      supabase.from('wallet_transactions').select('*').eq('user_id', userId)
        .order('created_at', { ascending: false }).limit(500),
      supabase.from('user_wallets').select('balance,total_deposited,total_withdrawn').eq('user_id', userId).maybeSingle(),
    ]);
    setExporting(false);
    const allTxns   = txns ?? [];
    const balance   = Number(walletData?.balance ?? 0);
    const deposited = Number(walletData?.total_deposited ?? 0);
    const withdrawn = Number(walletData?.total_withdrawn ?? 0);
    const totalIn   = allTxns.filter(t => t.type === 'deposit' || t.type === 'earnings').reduce((s,t) => s + Number(t.amount), 0);
    const totalOut  = allTxns.filter(t => t.type === 'withdrawal').reduce((s,t) => s + Number(t.amount), 0);
    const avgTxn    = allTxns.length > 0 ? allTxns.reduce((s,t) => s + Number(t.amount), 0) / allTxns.length : 0;
    const typeMap: any = {};
    allTxns.forEach(t => { const l = t.type.replace(/_/g,' '); typeMap[l] = (typeMap[l]||0) + Number(t.amount); });
    const breakdownRows = Object.entries(typeMap).map(([type, amt]) =>
      `<tr><td>${type.charAt(0).toUpperCase()+type.slice(1)}</td><td style="text-align:right;font-weight:700">$${Number(amt).toFixed(2)}</td></tr>`
    ).join('');
    const txnRows = allTxns.slice(0,100).map(t => {
      const isIn = t.type === 'deposit' || t.type === 'earnings';
      return `<tr><td>${new Date(t.created_at).toLocaleDateString()}</td><td>${t.type.replace(/_/g,' ')}</td><td style="color:${isIn?'#10b981':'#ef4444'};font-weight:700">${isIn?'+':'-'}$${Number(t.amount).toFixed(2)}</td><td>${t.status}</td><td>${t.description||'—'}</td></tr>`;
    }).join('');
    const w = window.open('','_blank','width=900,height=700');
    if (!w) { toast.error('Allow popups to export'); return; }
    w.document.write(`<!DOCTYPE html><html><head><title>Wallet Statement</title><style>
*{box-sizing:border-box}body{font-family:Arial,sans-serif;padding:32px;color:#111;max-width:860px;margin:0 auto}
h1{font-size:24px;font-weight:900;margin-bottom:4px}h2{font-size:15px;font-weight:700;margin:24px 0 8px;border-bottom:2px solid #eee;padding-bottom:4px}
.kpi-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:8px}
.kpi{background:#f8f8f8;border:1px solid #e0e0e0;border-radius:12px;padding:14px}
.kpi-label{font-size:11px;color:#666;margin-bottom:4px}.kpi-value{font-size:20px;font-weight:900}
.green{color:#10b981}.red{color:#ef4444}.blue{color:#3b82f6}
table{width:100%;border-collapse:collapse}th{background:#f5f5f5;padding:8px 10px;text-align:left;font-size:11px;border-bottom:2px solid #ddd}
td{padding:7px 10px;border-bottom:1px solid #eee;font-size:11px}
.btn{margin-bottom:16px;padding:8px 20px;background:#7c3aed;color:white;border:none;border-radius:8px;cursor:pointer;font-weight:700}
@media print{.btn{display:none}}
</style></head><body>
<h1>Wallet Statement</h1>
<p style="color:#666;font-size:12px">Exported ${new Date().toLocaleString()} · ${allTxns.length} transactions</p>
<button class="btn" onclick="window.print()">Print / Save PDF</button>
<h2>Account Overview</h2>
<div class="kpi-grid">
<div class="kpi"><div class="kpi-label">Current Balance</div><div class="kpi-value blue">$${balance.toFixed(2)}</div></div>
<div class="kpi"><div class="kpi-label">Total Deposited</div><div class="kpi-value green">$${deposited.toFixed(2)}</div></div>
<div class="kpi"><div class="kpi-label">Total Withdrawn</div><div class="kpi-value red">$${withdrawn.toFixed(2)}</div></div>
<div class="kpi"><div class="kpi-label">Total Received (period)</div><div class="kpi-value green">$${totalIn.toFixed(2)}</div></div>
<div class="kpi"><div class="kpi-label">Total Spent (period)</div><div class="kpi-value red">$${totalOut.toFixed(2)}</div></div>
<div class="kpi"><div class="kpi-label">Avg Transaction</div><div class="kpi-value blue">$${avgTxn.toFixed(2)}</div></div>
</div>
<h2>Transaction Breakdown by Type</h2>
<table><thead><tr><th>Type</th><th style="text-align:right">Total</th></tr></thead><tbody>${breakdownRows}</tbody></table>
<h2>Recent Transactions (last 100)</h2>
<table><thead><tr><th>Date</th><th>Type</th><th>Amount</th><th>Status</th><th>Description</th></tr></thead><tbody>${txnRows}</tbody></table>
</body></html>`);
    w.document.close();
  };

  return (
    <button onClick={exportStatement} disabled={exporting}
      className="w-full flex items-center justify-center gap-2 py-3 border border-border rounded-2xl font-semibold text-sm hover:bg-muted transition-colors disabled:opacity-50">
      {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4 text-primary" />}
      {exporting ? 'Generating Statement…' : 'Export Full Wallet Statement (PDF)'}
    </button>
  );
}

// ── Spending Analytics Tab ────────────────────────────────────────────────
function SpendingAnalyticsTab({ userId, currency }: { userId: string; currency: CurrencyCode }) {
  const [txns,    setTxns]    = useState([] as any[]);
  const [loading, setLoading] = useState(true);
  const [period,  setPeriod]  = useState('month' as 'week' | 'month' | 'all');

  useEffect(() => { fetchTxns(); }, [userId, period]);

  const fetchTxns = async () => {
    setLoading(true);
    let q = supabase.from('wallet_transactions').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(200);
    if (period === 'week')  q = q.gte('created_at', new Date(Date.now() - 7  * 86400000).toISOString());
    if (period === 'month') q = q.gte('created_at', new Date(Date.now() - 30 * 86400000).toISOString());
    const { data } = await q;
    setTxns(data ?? []); setLoading(false);
  };

  const { barData, pieData, totalIn, totalOut, totalBoosts, avgTxn, recentDeposits } = useMemo(() => {
    const days = period === 'week' ? 7 : 14;
    const now  = Date.now();
    const dailyMap: Record<string, { in: number; out: number }> = {};
    for (let i = days - 1; i >= 0; i--) {
      const key = new Date(now - i * 86400000).toLocaleDateString('en', { month: 'short', day: 'numeric' });
      dailyMap[key] = { in: 0, out: 0 };
    }
    txns.forEach(t => {
      const key = new Date(t.created_at).toLocaleDateString('en', { month: 'short', day: 'numeric' });
      if (!dailyMap[key]) return;
      if (t.type === 'deposit' || t.type === 'earnings') dailyMap[key].in  += Number(t.amount);
      else                                                 dailyMap[key].out += Number(t.amount);
    });
    const barData        = Object.entries(dailyMap).map(([date, v]) => ({ date, In: parseFloat(v.in.toFixed(2)), Out: parseFloat(v.out.toFixed(2)) }));
    const typeMap: any = {};
    txns.forEach(t => { const l = t.type.replace(/_/g,' '); typeMap[l] = (typeMap[l] || 0) + Number(t.amount); });
    const pieData        = Object.entries(typeMap).map(([name, value]) => ({ name, value: parseFloat((value as number).toFixed(2)) }));
    const totalIn        = txns.filter(t => t.type === 'deposit' || t.type === 'earnings').reduce((s,t) => s + Number(t.amount), 0);
    const totalOut       = txns.filter(t => t.type === 'withdrawal').reduce((s,t) => s + Number(t.amount), 0);
    const totalBoosts    = txns.filter(t => (t.description ?? '').toLowerCase().includes('boost')).reduce((s,t) => s + Number(t.amount), 0);
    const avgTxn         = txns.length > 0 ? txns.reduce((s,t) => s + Number(t.amount), 0) / txns.length : 0;
    const recentDeposits = txns.filter(t => t.type === 'deposit').slice(0,3);
    return { barData, pieData, totalIn, totalOut, totalBoosts, avgTxn, recentDeposits };
  }, [txns, period]);

  return (
    <div className="space-y-5">
      <div className="flex gap-1 bg-muted rounded-xl p-1">
        {PERIOD_OPTIONS.map(p => (
          <button key={p} onClick={() => setPeriod(p)}
            className={`flex-1 py-1.5 rounded-lg text-xs font-semibold capitalize transition-colors ${period === p ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
            {p === 'all' ? 'All time' : `Last ${p}`}
          </button>
        ))}
      </div>
      {loading ? (
        <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: 'Total Deposited', val: fmtAmt(totalIn,     currency), sub: `${txns.filter(t=>t.type==='deposit').length} deposits`,     color: 'text-green-600',  bg: 'bg-green-500/10 border-green-500/20'   },
              { label: 'Total Withdrawn', val: fmtAmt(totalOut,    currency), sub: `${txns.filter(t=>t.type==='withdrawal').length} withdrawals`, color: 'text-red-500',    bg: 'bg-red-500/10 border-red-500/20'       },
              { label: 'Avg Transaction', val: fmtAmt(avgTxn,      currency), sub: `over ${txns.length} transactions`,                           color: 'text-blue-600',   bg: 'bg-blue-500/10 border-blue-500/20'     },
              { label: 'Boost Spending',  val: fmtAmt(totalBoosts, currency), sub: 'on ad campaigns',                                            color: 'text-purple-600', bg: 'bg-purple-500/10 border-purple-500/20' },
            ].map(s => (
              <div key={s.label} className={`p-4 rounded-2xl border ${s.bg}`}>
                <p className="text-xs text-muted-foreground mb-1">{s.label}</p>
                <p className={`text-lg font-black ${s.color} leading-tight`}>{s.val}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">{s.sub}</p>
              </div>
            ))}
          </div>
          {barData.length > 0 && (
            <div className="border border-border rounded-2xl p-4">
              <div className="flex items-center gap-2 mb-4"><BarChart3 className="w-4 h-4 text-primary" /><h3 className="font-bold text-sm">Daily Cash Flow</h3></div>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={barData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="date" tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }} />
                  <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 11 }} formatter={(v: any) => [`$${v}`,'']} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="In"  name="Deposits"    fill="#10b981" radius={[3,3,0,0]} />
                  <Bar dataKey="Out" name="Withdrawals" fill="#ef4444" radius={[3,3,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
          {pieData.length > 0 && (
            <div className="border border-border rounded-2xl p-4">
              <div className="flex items-center gap-2 mb-4"><LucidePieChart className="w-4 h-4 text-primary" /><h3 className="font-bold text-sm">Transaction Breakdown</h3></div>
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie data={pieData} cx="50%" cy="50%" innerRadius={55} outerRadius={80} paddingAngle={3} dataKey="value">
                    {pieData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                  </Pie>
                  <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 11 }} formatter={(v: any) => [`$${v}`,'']} />
                  <Legend wrapperStyle={{ fontSize: 11 }} formatter={v => v.charAt(0).toUpperCase() + v.slice(1)} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
          {recentDeposits.length > 0 && (
            <div className="border border-border rounded-2xl p-4">
              <div className="flex items-center gap-2 mb-3"><TrendingUp className="w-4 h-4 text-green-500" /><h3 className="font-bold text-sm">Recent Top-ups</h3></div>
              <div className="space-y-2">
                {recentDeposits.map(d => (
                  <div key={d.id} className="flex items-center gap-3 p-3 bg-green-500/5 border border-green-500/15 rounded-xl">
                    <div className="w-9 h-9 rounded-full bg-green-500/10 flex items-center justify-center shrink-0"><ArrowDownLeft className="w-4 h-4 text-green-600" /></div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-green-700 dark:text-green-400">+{fmtAmt(Number(d.amount), currency)}</p>
                      <p className="text-xs text-muted-foreground truncate">{d.payment_method ? d.payment_method.toUpperCase() : 'M-Pesa'} · {new Date(d.created_at).toLocaleDateString()}</p>
                    </div>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${d.status === 'completed' ? 'bg-green-500/10 text-green-600' : 'bg-orange-500/10 text-orange-600'}`}>{d.status}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {txns.length === 0 && (
            <div className="text-center py-12">
              <BarChart3 className="w-12 h-12 text-muted-foreground/20 mx-auto mb-3" />
              <p className="font-semibold text-sm">No transactions yet</p>
              <p className="text-xs text-muted-foreground mt-1">Make your first deposit to see analytics</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── P2P Send Money Tab ────────────────────────────────────────────────────
function SendMoneyTab({ userId, senderUsername, walletBalance, pinHash, biometricCredentialId, onComplete, prefillUsername, currency }: {
  userId: string; senderUsername: string; walletBalance: number;
  pinHash: string | null; biometricCredentialId: string | null;
  onComplete: () => void; prefillUsername?: string; currency: CurrencyCode;
}) {
  const [query,        setQuery]        = useState(prefillUsername ?? '');
  const [users,        setUsers]        = useState([] as any[]);
  const [searching,    setSearching]    = useState(false);
  const [selectedUser, setSelectedUser] = useState(null as any);
  const [amount,       setAmount]       = useState('');
  const [note,         setNote]         = useState('');
  const [sending,      setSending]      = useState(false);
  const [showPin,      setShowPin]      = useState(false);
  const [receipt, setReceipt] = useState(null as { recipient: any; amount: number; note: string; ref: string; timestamp: string } | null);
  const [favorites,    setFavorites]    = useState([] as any[]);
  const favKey = useMemo(() => `ts-send-fav-${userId}`, [userId]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(favKey);
      if (raw) setFavorites(JSON.parse(raw));
    } catch { /* ignore */ }
  }, [userId]);

  const addToFavorites = (u: any) => {
    const already = favorites.some(f => f.id === u.id);
    if (already) { toast.info('Already in favorites'); return; }
    const next = [u, ...favorites].slice(0, FAVORITES_MAX);
    setFavorites(next);
    localStorage.setItem(favKey, JSON.stringify(next));
    toast.success(`@${u.username} added to favorites`);
  };

  const removeFromFavorites = (id: string) => {
    const next = favorites.filter(f => f.id !== id);
    setFavorites(next);
    localStorage.setItem(favKey, JSON.stringify(next));
  };

  useEffect(() => {
    if (prefillUsername && prefillUsername.length >= 2) searchUsers(prefillUsername);
  }, [prefillUsername]);

  const searchUsers = async (q: string) => {
    setQuery(q);
    if (q.trim().length < 2) { setUsers([]); return; }
    setSearching(true);
    const { data } = await supabase.from('profiles').select('id,username,avatar_url,verified')
      .ilike('username', `%${q.trim()}%`).neq('id', userId).limit(8);
    setUsers(data ?? []); setSearching(false);
  };

  const executeSend = async () => {
    if (!selectedUser || !amount || parseFloat(amount) <= 0) return;
    const amt = parseFloat(amount);
    if (amt > walletBalance) { toast.error('Insufficient balance'); return; }
    setSending(true);
    const { error } = await supabase.rpc('p2p_wallet_transfer', {
      p_from_user_id: userId, p_to_user_id: selectedUser.id, p_amount: amt, p_note: note.trim() || null,
    });
    if (error) { setSending(false); toast.error(error.message || 'Transfer failed'); return; }
    const txRef = `TXN${Date.now().toString(36).toUpperCase().slice(-8)}`;
    await Promise.allSettled([
      supabase.from('platform_inbox').insert({
        user_id: selectedUser.id,
        subject: `You received $${amt.toFixed(2)} from @${senderUsername}`,
        body: `@${senderUsername} sent you $${amt.toFixed(2)}${note.trim() ? ` — "${note.trim()}"` : ''}. Your wallet has been credited instantly.`,
        type: 'payment', icon_emoji: '💸', cta_label: 'View Wallet', cta_url: '/wallet',
      }),
      supabase.from('platform_inbox').insert({
        user_id: userId, subject: `Transfer of $${amt.toFixed(2)} to @${selectedUser.username} complete`,
        body: `Your transfer was successful. Ref: ${txRef}`,
        type: 'payment', icon_emoji: '✅', cta_label: 'View History', cta_url: '/wallet?tab=history',
      }),
    ]);
    setSending(false);
    toast.success(`$${amt.toFixed(2)} sent to @${selectedUser.username}!`);
    setReceipt({ recipient: selectedUser, amount: amt, note: note.trim(), ref: txRef, timestamp: new Date().toISOString() });
    setSelectedUser(null); setAmount(''); setNote(''); setQuery('');
    onComplete();
  };

  const handleSend = () => {
    if (biometricCredentialId) {
      verifyBiometric(biometricCredentialId).then(ok => {
        if (ok) { executeSend(); } else if (pinHash) { setShowPin(true); } else { executeSend(); }
      });
    } else if (pinHash) { setShowPin(true); } else { executeSend(); }
  };

  const handlePinConfirm = async (pin: string) => {
    const entered = await hashPin(pin); setShowPin(false);
    if (entered !== pinHash) { toast.error('Incorrect PIN'); return; }
    executeSend();
  };

  // esbuild guard: fee values pre-computed before JSX return (no IIFE in render)
  const sendFeeRaw = parseFloat(amount || '0');
  const sendFeeAmt = sendFeeRaw >= 0.10 ? parseFloat((sendFeeRaw * 0.05).toFixed(4)) : 0;
  const sendFeeNet = parseFloat((sendFeeRaw - sendFeeAmt).toFixed(4));

  if (receipt) {
    const isFav = favorites.some(f => f.id === receipt.recipient.id);
    return (
      <div className="space-y-5">
        <div className="flex flex-col items-center gap-4 p-6 bg-gradient-to-br from-green-500/10 to-emerald-400/5 border border-green-500/20 rounded-2xl text-center">
          <div className="w-16 h-16 rounded-full bg-green-500/15 flex items-center justify-center"><CheckCircle2 className="w-9 h-9 text-green-500" /></div>
          <div>
            <p className="text-lg font-black text-green-600">Transfer Complete!</p>
            <p className="text-3xl font-black mt-1">{fmtAmt(receipt.amount, currency)}</p>
            <p className="text-sm text-muted-foreground mt-0.5">sent to @{receipt.recipient.username}</p>
          </div>
          <div className="w-full space-y-2 text-sm">
            <div className="flex justify-between border-b border-border pb-2">
              <span className="text-muted-foreground">Reference</span>
              <span className="font-mono font-bold text-xs">{receipt.ref}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Status</span>
              <span className="font-bold text-green-600 text-xs">Completed</span>
            </div>
          </div>
          {!isFav && favorites.length < FAVORITES_MAX && (
            <button onClick={() => addToFavorites(receipt.recipient)}
              className="w-full flex items-center justify-center gap-2 py-2.5 border border-amber-500/30 bg-amber-500/5 text-amber-600 rounded-xl font-semibold text-sm hover:bg-amber-500/10 transition-colors">
              <Star className="w-4 h-4" /> Add @{receipt.recipient.username} to Favorites
            </button>
          )}
          <div className="flex gap-3 w-full">
            <button onClick={() => {
              const text = `Transfer Receipt\nRef: ${receipt.ref}\nAmount: $${receipt.amount.toFixed(2)}\nTo: @${receipt.recipient.username}`;
              navigator.clipboard.writeText(text).then(() => toast.success('Receipt copied!'));
            }} className="flex-1 flex items-center justify-center gap-2 py-3 border border-border rounded-xl font-semibold text-sm hover:bg-muted transition-colors">
              <Copy className="w-4 h-4" /> Copy Receipt
            </button>
            <button onClick={() => setReceipt(null)} className="flex-1 py-3 bg-primary text-primary-foreground rounded-xl font-semibold text-sm hover:opacity-90 transition-opacity">Done</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      {showPin && <PinEntryModal title="Confirm Transfer" onConfirm={handlePinConfirm} onCancel={() => setShowPin(false)} userId={userId} />}
      <div className="space-y-5">
        <div className="p-4 rounded-2xl bg-primary/10 border border-primary/20">
          <p className="text-sm font-semibold text-muted-foreground">Available to send</p>
          <p className="text-3xl font-black text-primary">{fmtAmt(walletBalance, currency)}</p>
        </div>
        {favorites.length > 0 && !selectedUser && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Favorites</p>
              <button onClick={() => removeFromFavorites(favorites[favorites.length - 1]?.id)} className="text-[10px] text-muted-foreground hover:text-destructive">Edit</button>
            </div>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {favorites.map(fav => (
                <button key={fav.id} onClick={() => { setSelectedUser(fav); setQuery(''); setUsers([]); }}
                  className="flex flex-col items-center gap-1.5 px-3 py-2.5 border border-border rounded-2xl hover:border-primary/40 hover:bg-primary/5 transition-all shrink-0 group">
                  <div className="relative">
                    <div className="w-11 h-11 rounded-full bg-primary/10 overflow-hidden flex items-center justify-center font-bold text-sm">
                      {fav.avatar_url
                        ? <img src={fav.avatar_url} alt={fav.username} className="w-full h-full object-cover" />
                        : fav.username?.[0]?.toUpperCase()}
                    </div>
                    <button
                      onClick={e => { e.stopPropagation(); removeFromFavorites(fav.id); }}
                      className="absolute -top-1 -right-1 w-4 h-4 bg-muted border border-border rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500 hover:border-red-500 hover:text-white">
                      <X className="w-2.5 h-2.5" />
                    </button>
                  </div>
                  <p className="text-[10px] font-semibold text-muted-foreground max-w-[56px] truncate">@{fav.username}</p>
                </button>
              ))}
            </div>
          </div>
        )}
        {!selectedUser ? (
          <div className="space-y-3">
            <label className="text-sm font-semibold">Send to user</label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input value={query} onChange={e => searchUsers(e.target.value)} placeholder="Search by username…"
                className="w-full pl-9 pr-4 py-3 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
              {searching && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-muted-foreground" />}
            </div>
            {users.length > 0 && (
              <div className="space-y-1">
                {users.map(u => (
                  <button key={u.id} onClick={() => { setSelectedUser(u); setUsers([]); setQuery(''); }}
                    className="w-full flex items-center gap-3 p-3 rounded-xl border border-border hover:border-primary/30 hover:bg-primary/5 transition-all text-left">
                    <div className="w-10 h-10 rounded-full bg-muted overflow-hidden shrink-0">
                      {u.avatar_url ? <img src={u.avatar_url} alt={u.username} className="w-full h-full object-cover" />
                        : <div className="w-full h-full flex items-center justify-center font-bold text-sm">{u.username[0]?.toUpperCase()}</div>}
                    </div>
                    <div className="flex-1 min-w-0 flex items-center gap-1">
                      <p className="font-bold text-sm truncate">@{u.username}</p>
                      {u.verified && <UserCheck className="w-3.5 h-3.5 text-primary shrink-0" />}
                    </div>
                    <Send className="w-4 h-4 text-muted-foreground" />
                  </button>
                ))}
              </div>
            )}
            {query.length >= 2 && users.length === 0 && !searching && (
              <p className="text-sm text-muted-foreground text-center py-4">No users found for "{query}"</p>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-3 p-4 bg-primary/5 border border-primary/20 rounded-2xl">
              <div className="w-12 h-12 rounded-full bg-muted overflow-hidden shrink-0">
                {selectedUser.avatar_url ? <img src={selectedUser.avatar_url} alt="" className="w-full h-full object-cover" />
                  : <div className="w-full h-full flex items-center justify-center font-bold">{selectedUser.username[0]?.toUpperCase()}</div>}
              </div>
              <div className="flex-1"><p className="font-bold">@{selectedUser.username}</p><p className="text-xs text-muted-foreground">Recipient</p></div>
              <button onClick={() => setSelectedUser(null)} className="p-2 rounded-full hover:bg-muted text-muted-foreground"><X className="w-4 h-4" /></button>
            </div>
            <div>
              <label className="text-sm font-semibold mb-2 block">Amount (USD)</label>
              <div className="grid grid-cols-4 gap-2 mb-2">
                {[1,5,10,25].map(a => (
                  <button key={a} onClick={() => setAmount(String(a))}
                    className={`py-2.5 rounded-xl font-bold text-sm border-2 transition-all ${amount === String(a) ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:border-primary/30'}`}>${a}</button>
                ))}
              </div>
              <input type="number" min="0.01" step="0.01" placeholder="Custom amount…"
                value={amount && ![1,5,10,25].map(String).includes(amount) ? amount : ''}
                onChange={e => setAmount(e.target.value)}
                className="w-full h-11 px-3 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
            </div>
            <div>
              <label className="text-sm font-semibold mb-2 block">Note (optional)</label>
              <input type="text" maxLength={100} placeholder="What's this for?" value={note} onChange={e => setNote(e.target.value)}
                className="w-full h-11 px-3 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
            </div>
            <button onClick={handleSend} disabled={sending || !amount || parseFloat(amount) <= 0 || parseFloat(amount) > walletBalance}
              className="w-full py-4 bg-primary text-primary-foreground rounded-xl font-bold text-base disabled:opacity-50 flex items-center justify-center gap-2 hover:opacity-90 transition-opacity">
              {sending ? <Loader2 className="w-5 h-5 animate-spin" /> : (pinHash || biometricCredentialId ? <Lock className="w-5 h-5" /> : <Send className="w-5 h-5" />)}
              {sending ? 'Sending…' : `Send ${fmtAmt(parseFloat(amount || '0'), currency)} to @${selectedUser.username}`}
            </button>
            {/* esbuild guard: fee values pre-computed before JSX return, no IIFE */}
            {sendFeeRaw > 0 && selectedUser && (
              <div className={`rounded-2xl border overflow-hidden ${sendFeeRaw > walletBalance ? 'border-red-500/30 bg-red-500/5' : 'border-primary/20 bg-primary/5'}`}>
                <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border/50 bg-muted/20">
                  <span className="text-xs font-bold text-muted-foreground uppercase tracking-wide">Transfer Breakdown</span>
                </div>
                <div className="divide-y divide-border/40">
                  <div className="flex justify-between items-center px-4 py-2.5">
                    <span className="text-sm text-muted-foreground">You send</span>
                    <span className="font-bold text-foreground">{fmtAmt(sendFeeRaw, currency)}</span>
                  </div>
                  {sendFeeAmt > 0 && (
                    <div className="flex justify-between items-center px-4 py-2.5">
                      <span className="text-sm text-muted-foreground">Platform fee (5%)</span>
                      <span className="font-semibold text-red-500">-{fmtAmt(sendFeeAmt, currency)}</span>
                    </div>
                  )}
                  <div className="flex justify-between items-center px-4 py-2.5 bg-green-500/5">
                    <span className="text-sm font-bold text-green-700 dark:text-green-400">@{selectedUser.username} receives</span>
                    <span className="font-black text-green-600">{fmtAmt(sendFeeNet, currency)}</span>
                  </div>
                </div>
                {sendFeeRaw > walletBalance && (
                  <p className="text-xs text-red-500 px-4 pb-2.5 font-semibold">Exceeds your balance of {fmtAmt(walletBalance, currency)}</p>
                )}
              </div>
            )}
          </div>
        )}
        <div className="bg-muted/30 rounded-2xl p-4 text-xs text-muted-foreground">
          <p><strong>Instant transfers</strong> — funds arrive immediately and cannot be reversed.</p>
        </div>
      </div>
    </>
  );
}

// ── Scheduled Transfers Tab ───────────────────────────────────────────────
function ScheduledTransfersTab({ userId, currency, pinHash }: { userId: string; currency: CurrencyCode; pinHash?: string | null }) {
  const [transfers,    setTransfers]    = useState([] as any[]);
  const [loading,      setLoading]      = useState(true);
  const [showForm,     setShowForm]     = useState(false);
  const [query,        setQuery]        = useState('');
  const [results,      setResults]      = useState([] as any[]);
  const [searching,    setSearching]    = useState(false);
  const [recipient,    setRecipient]    = useState(null as any);
  const [amount,       setAmount]       = useState('');
  const [note,         setNote]         = useState('');
  const [scheduleAt,   setScheduleAt]   = useState('');
  const [saving,       setSaving]       = useState(false);
  const [cancelling,   setCancelling]   = useState(null as string | null);
  const [selected,     setSelected]     = useState([] as string[]);
  const [batching,     setBatching]     = useState(false);
  const [batchDone,    setBatchDone]    = useState(0);
  const [showBatchPin, setShowBatchPin] = useState(false);

  const minDateTime = useMemo(() => {
    const d = new Date(Date.now() + 5 * 60000);
    return d.toISOString().slice(0, 16);
  }, []);

  useEffect(() => { loadTransfers(); }, [userId]);

  const loadTransfers = async () => {
    setLoading(true);
    const { data } = await supabase.from('wallet_scheduled_transfers')
      .select('*').eq('from_user_id', userId).eq('status', 'pending').order('scheduled_for', { ascending: true });
    setTransfers(data ?? []); setLoading(false);
  };

  const searchUsers = async (q: string) => {
    setQuery(q);
    if (q.trim().length < 2) { setResults([]); return; }
    setSearching(true);
    const { data } = await supabase.from('profiles').select('id,username,avatar_url,verified')
      .ilike('username', `%${q.trim()}%`).neq('id', userId).limit(6);
    setResults(data ?? []); setSearching(false);
  };

  const handleSchedule = async () => {
    if (!recipient || !amount || parseFloat(amount) <= 0) { toast.error('Fill in all fields'); return; }
    if (!scheduleAt) { toast.error('Select a date and time'); return; }
    const scheduledDate = new Date(scheduleAt);
    if (scheduledDate.getTime() <= Date.now()) { toast.error('Must be a future date/time'); return; }
    setSaving(true);
    const { error } = await supabase.from('scheduled_transfers').insert({
      from_user_id: userId, to_user_id: recipient.id, to_username: recipient.username,
      amount: parseFloat(amount), note: note.trim() || null, scheduled_for: scheduledDate.toISOString(),
    });
    setSaving(false);
    if (error) { toast.error('Failed to schedule transfer'); return; }
    toast.success(`Transfer to @${recipient.username} scheduled!`);
    setShowForm(false); setRecipient(null); setAmount(''); setNote(''); setScheduleAt(''); setQuery('');
    loadTransfers();
  };

  const cancelTransfer = async (id: string) => {
    setCancelling(id);
    const { error } = await supabase.from('scheduled_transfers').delete().eq('id', id).eq('from_user_id', userId);
    setCancelling(null);
    if (error) { toast.error('Failed to cancel'); return; }
    toast.success('Scheduled transfer cancelled');
    loadTransfers();
  };

  const executeBatch = async () => {
    if (selected.length === 0) return;
    setBatching(true); setBatchDone(0);
    const toProcess = transfers.filter(t => selected.includes(t.id));
    let done = 0;
    for (const t of toProcess) {
      const { data: executed, error } = await supabase.rpc('wallet_execute_scheduled_transfer', { p_id: t.id });
      if (!error && executed) { done++; setBatchDone(done); }
    }
    setBatching(false); setSelected([]);
    toast.success(`${done}/${toProcess.length} transfers executed!`);
    loadTransfers();
  };

  const handleBatch = () => { if (pinHash) { setShowBatchPin(true); } else { executeBatch(); } };

  const handleBatchPinConfirm = (pin: string) => {
    hashPin(pin).then(entered => {
      setShowBatchPin(false);
      if (entered !== pinHash) { toast.error('Incorrect PIN'); return; }
      executeBatch();
    });
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-bold text-sm">Scheduled Transfers</h3>
          <p className="text-xs text-muted-foreground">Send money at a future date and time</p>
        </div>
        <button onClick={() => setShowForm(v => !v)}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-xl font-semibold text-xs transition-colors ${showForm ? 'bg-muted border border-border text-muted-foreground' : 'bg-primary text-primary-foreground hover:opacity-90'}`}>
          <Calendar className="w-3.5 h-3.5" />{showForm ? 'Cancel' : 'Schedule New'}
        </button>
      </div>

      {showForm && (
        <div className="p-4 border border-border rounded-2xl bg-card space-y-4">
          <h4 className="font-bold text-sm">New Scheduled Transfer</h4>
          {!recipient ? (
            <div className="space-y-2">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Recipient</label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input value={query} onChange={e => searchUsers(e.target.value)} placeholder="Search by username…"
                  className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
                {searching && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin" />}
              </div>
              {results.length > 0 && (
                <div className="space-y-1">
                  {results.map(u => (
                    <button key={u.id} onClick={() => { setRecipient(u); setResults([]); setQuery(''); }}
                      className="w-full flex items-center gap-2 p-2.5 rounded-xl border border-border hover:border-primary/30 hover:bg-primary/5 transition-all text-left text-sm">
                      <div className="w-8 h-8 rounded-full bg-muted overflow-hidden shrink-0 flex items-center justify-center font-bold text-xs">
                        {u.avatar_url ? <img src={u.avatar_url} alt="" className="w-full h-full object-cover" /> : u.username[0]?.toUpperCase()}
                      </div>
                      <span className="font-semibold flex-1">@{u.username}</span>
                      {u.verified && <UserCheck className="w-3.5 h-3.5 text-primary" />}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5 block">Recipient</label>
              <div className="flex items-center gap-2 p-3 bg-primary/5 border border-primary/20 rounded-xl">
                <div className="w-8 h-8 rounded-full bg-muted overflow-hidden shrink-0 flex items-center justify-center font-bold text-xs">
                  {recipient.avatar_url ? <img src={recipient.avatar_url} alt="" className="w-full h-full object-cover" /> : recipient.username[0]?.toUpperCase()}
                </div>
                <span className="font-semibold text-sm flex-1">@{recipient.username}</span>
                <button onClick={() => setRecipient(null)} className="text-muted-foreground hover:text-destructive"><X className="w-3.5 h-3.5" /></button>
              </div>
            </div>
          )}
          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5 block">Amount (USD)</label>
            <input type="number" min="0.01" step="0.01" placeholder="0.00" value={amount} onChange={e => setAmount(e.target.value)}
              className="w-full h-11 px-3 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
          </div>
          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5 block">Schedule For</label>
            <input type="datetime-local" min={minDateTime} value={scheduleAt} onChange={e => setScheduleAt(e.target.value)}
              className="w-full h-11 px-3 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
          </div>
          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5 block">Note (optional)</label>
            <input type="text" maxLength={100} placeholder="What's this for?" value={note} onChange={e => setNote(e.target.value)}
              className="w-full h-11 px-3 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
          </div>
          {amount && recipient && parseFloat(amount) > 0 && (
            <div className="p-3 bg-primary/5 border border-primary/15 rounded-xl text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Amount</span><span className="font-black text-primary">{fmtAmt(parseFloat(amount), currency)}</span></div>
              <div className="flex justify-between mt-1"><span className="text-muted-foreground">To</span><span className="font-semibold">@{recipient.username}</span></div>
            </div>
          )}
          <button onClick={handleSchedule} disabled={saving || !recipient || !amount || !scheduleAt || parseFloat(amount) <= 0}
            className="w-full py-3 bg-primary text-primary-foreground rounded-xl font-bold text-sm disabled:opacity-50 flex items-center justify-center gap-2 hover:opacity-90 transition-opacity">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Calendar className="w-4 h-4" />}
            {saving ? 'Scheduling…' : 'Schedule Transfer'}
          </button>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
      ) : transfers.length === 0 ? (
        <div className="text-center py-12">
          <Calendar className="w-12 h-12 text-muted-foreground/20 mx-auto mb-3" />
          <p className="font-semibold text-sm">No scheduled transfers</p>
          <p className="text-xs text-muted-foreground mt-1">Schedule a future payment above</p>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{transfers.length} pending</p>
            <button onClick={() => setSelected(prev => prev.length === transfers.length ? [] : transfers.map(t => t.id))}
              className="text-xs text-primary font-semibold hover:underline">
              {selected.length === transfers.length ? 'Deselect All' : 'Select All'}
            </button>
          </div>
          {showBatchPin && <PinEntryModal title="Execute Batch" onConfirm={handleBatchPinConfirm} onCancel={() => setShowBatchPin(false)} />}
          {selected.length > 0 && !batching && (
            <div className="flex items-center gap-3 p-3 bg-primary/10 border border-primary/20 rounded-2xl">
              <p className="text-sm font-semibold flex-1">{selected.length} selected</p>
              <button onClick={() => setSelected([])} className="text-xs text-muted-foreground hover:text-foreground">Clear</button>
              <button onClick={handleBatch}
                className="flex items-center gap-1.5 px-4 py-2 bg-primary text-primary-foreground rounded-xl font-bold text-sm hover:opacity-90 transition-opacity">
                <Zap className="w-3.5 h-3.5" /> Execute Now
              </button>
            </div>
          )}
          {batching && (
            <div className="flex flex-col items-center gap-3 p-4 bg-primary/5 border border-primary/20 rounded-2xl">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
              <p className="text-sm font-semibold">Processing {batchDone}/{selected.length}…</p>
            </div>
          )}
          {transfers.map(t => {
            const sd = new Date(t.scheduled_for);
            const isSelected = selected.includes(t.id);
            return (
              <div key={t.id} className={`p-4 border rounded-2xl bg-card transition-colors ${isSelected ? 'border-primary/40 bg-primary/5' : 'border-border'}`}>
                <div className="flex items-center justify-between mb-2.5">
                  <span className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wide">Pending Transfer</span>
                  <button
                    onClick={() => setSelected(prev => prev.includes(t.id) ? prev.filter(id => id !== t.id) : [...prev, t.id])}
                    className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${isSelected ? 'border-primary bg-primary' : 'border-muted-foreground/40 hover:border-primary/60'}`}>
                    {isSelected && <span className="text-[9px] text-primary-foreground font-black">✓</span>}
                  </button>
                </div>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2.5 flex-1 min-w-0">
                    <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0"><Calendar className="w-5 h-5 text-primary" /></div>
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-sm">@{t.to_username}</p>
                      <p className="text-xs text-muted-foreground">{sd.toLocaleDateString()} at {sd.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                      {t.note && <p className="text-xs text-muted-foreground truncate mt-0.5">"{t.note}"</p>}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="font-black text-base text-primary">{fmtAmt(Number(t.amount), currency)}</p>
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-orange-500/10 text-orange-600 font-semibold">pending</span>
                  </div>
                </div>
                <button onClick={() => cancelTransfer(t.id)} disabled={cancelling === t.id}
                  className="mt-3 w-full py-2 border border-red-500/30 text-red-500 rounded-xl font-semibold text-xs hover:bg-red-500/5 disabled:opacity-50 flex items-center justify-center gap-1.5 transition-colors">
                  {cancelling === t.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <X className="w-3.5 h-3.5" />}
                  {cancelling === t.id ? 'Cancelling…' : 'Cancel Transfer'}
                </button>
              </div>
            );
          })}
        </div>
      )}
      <div className="p-4 bg-muted/30 rounded-2xl text-xs text-muted-foreground">
        <p><strong>Note:</strong> Scheduled transfers execute automatically when the scheduled time arrives. Ensure sufficient balance.</p>
      </div>
    </div>
  );
}

// ── Transaction History Tab ───────────────────────────────────────────────
function TransactionHistoryTab({ userId, currency }: { userId: string; currency: CurrencyCode }) {
  const [txns,           setTxns]          = useState([] as any[]);
  const [loading,        setLoading]       = useState(true);
  const [filter,         setFilter]        = useState('all' as 'all' | 'deposit' | 'withdrawal' | 'earnings');
  const [search,         setSearch]        = useState('');
  const [selectedReceipt, setSelectedReceipt] = useState(null as any);
  // tags — parallel arrays (esbuild guard: no index-sig type in state)
  const [tagIds,   setTagIds]   = useState([] as string[]);
  const [tagTexts, setTagTexts] = useState([] as string[]);
  const [tagColors, setTagColors2] = useState([] as string[]);
  const getTag = (id: string) => { const i = tagIds.indexOf(id); return i >= 0 ? { text: tagTexts[i], color: tagColors[i] ?? 'blue' } : undefined; };
  const setTag = (id: string, data: { text: string; color: string }) => {
    setTagIds(prev => {
      const i = prev.indexOf(id);
      if (i >= 0) {
        setTagTexts(t => { const n = [...t]; n[i] = data.text; return n; });
        setTagColors2(c => { const n = [...c]; n[i] = data.color; return n; });
        return prev;
      }
      setTagTexts(t => [...t, data.text]);
      setTagColors2(c => [...c, data.color]);
      return [...prev, id];
    });
  };
  const removeTagById = (id: string) => {
    setTagIds(prev => {
      const i = prev.indexOf(id);
      if (i < 0) return prev;
      setTagTexts(t => t.filter((_, j) => j !== i));
      setTagColors2(c => c.filter((_, j) => j !== i));
      return prev.filter((_, j) => j !== i);
    });
  };
  const [editingTag, setEditingTag] = useState(null as string | null);
  const [tagInput,   setTagInput]   = useState('');
  const [tagColor,   setTagColor]   = useState('blue');
  const tagsKey = useMemo(() => `ts-txn-notes-${userId}`, [userId]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(tagsKey);
      if (raw) { const obj = JSON.parse(raw); Object.keys(obj).forEach(k => setTag(k, obj[k])); }
    } catch { /* ignore */ }
  }, [tagsKey]);

  const saveTag = (txnId: string) => {
    if (!tagInput.trim()) return;
    setTag(txnId, { text: tagInput.trim(), color: tagColor });
    const obj: any = {}; tagIds.forEach((id, i) => { obj[id] = { text: tagTexts[i], color: tagColors[i] }; }); obj[txnId] = { text: tagInput.trim(), color: tagColor };
    localStorage.setItem(tagsKey, JSON.stringify(obj));
    setEditingTag(null); setTagInput('');
    toast.success('Note saved!');
  };

  const removeTag = (txnId: string) => {
    removeTagById(txnId);
    const obj: any = {}; tagIds.filter(id => id !== txnId).forEach((id, i) => { obj[id] = { text: tagTexts[i], color: tagColors[i] }; });
    localStorage.setItem(tagsKey, JSON.stringify(obj));
  };

  useEffect(() => { fetchTxns(); }, [userId, filter]);

  const fetchTxns = async () => {
    setLoading(true);
    let q = supabase.from('wallet_transactions').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(200);
    if (filter !== 'all') q = q.eq('type', filter);
    const { data } = await q;
    setTxns(data ?? []); setLoading(false);
  };

  const { filtered, totalIn, totalOut } = useMemo(() => {
    const totalIn  = txns.filter(t => t.type === 'deposit' || t.type === 'earnings').reduce((s,t) => s + Number(t.amount), 0);
    const totalOut = txns.filter(t => t.type === 'withdrawal').reduce((s,t) => s + Number(t.amount), 0);
    if (!search.trim()) return { filtered: txns, totalIn, totalOut };
    const q = search.trim().toLowerCase();
    return {
      filtered: txns.filter(t =>
        (t.description ?? '').toLowerCase().includes(q) || (t.type ?? '').toLowerCase().includes(q) ||
        (t.payment_method ?? '').toLowerCase().includes(q) || (t.reference ?? '').toLowerCase().includes(q) ||
        String(t.amount).includes(q)
      ), totalIn, totalOut,
    };
  }, [txns, search]);

  const downloadCSV = () => {
    const headers = ['Date','Type','Amount','Status','Method','Description'];
    const rows = filtered.map(t => [new Date(t.created_at).toLocaleString(), t.type, t.amount, t.status, t.payment_method ?? '', t.description ?? '']);
    const csv  = [headers, ...rows].map(r => r.map(c => `"${c}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = `transactions-${new Date().toISOString().split('T')[0]}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const printPDF = () => {
    const w = window.open('', '_blank', 'width=820,height=640');
    if (!w) { toast.error('Allow popups to print'); return; }
    const rows = filtered.map(t => {
      const isIn = t.type === 'deposit' || t.type === 'earnings';
      return `<tr><td>${new Date(t.created_at).toLocaleString()}</td><td>${t.type.replace(/_/g,' ')}</td><td style="color:${isIn ? '#10b981' : '#ef4444'};font-weight:700">${isIn ? '+' : '-'}$${Number(t.amount).toFixed(2)}</td><td>${t.payment_method ? t.payment_method.toUpperCase() : '—'}</td><td>${t.status}</td><td>${t.description || '—'}</td></tr>`;
    }).join('');
    w.document.write(`<!DOCTYPE html><html><head><title>Transaction History</title><style>body{font-family:Arial,sans-serif;padding:24px}table{width:100%;border-collapse:collapse}th{background:#f5f5f5;padding:10px;text-align:left;font-size:12px;border-bottom:2px solid #ddd}td{padding:9px 10px;border-bottom:1px solid #eee;font-size:12px}.btn{margin-bottom:16px;padding:8px 20px;background:#3b82f6;color:white;border:none;border-radius:8px;cursor:pointer}@media print{.btn{display:none}}</style></head><body><h1>Transaction History</h1><div>Exported: ${new Date().toLocaleString()} · ${filtered.length} records</div><div>Received: $${totalIn.toFixed(2)} | Withdrawn: $${totalOut.toFixed(2)}</div><br/><button class="btn" onclick="window.print()">Print / Save PDF</button><table><thead><tr><th>Date</th><th>Type</th><th>Amount</th><th>Method</th><th>Status</th><th>Description</th></tr></thead><tbody>${rows}</tbody></table></body></html>`);
    w.document.close();
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="p-4 rounded-2xl bg-green-500/10 border border-green-500/20">
          <p className="text-xs text-muted-foreground mb-1">Total Received</p>
          <p className="text-xl font-black text-green-600">{fmtAmt(totalIn, currency)}</p>
        </div>
        <div className="p-4 rounded-2xl bg-red-500/10 border border-red-500/20">
          <p className="text-xs text-muted-foreground mb-1">Total Withdrawn</p>
          <p className="text-xl font-black text-red-500">{fmtAmt(totalOut, currency)}</p>
        </div>
      </div>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input type="text" value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search description, method, amount, ref…"
          className="w-full pl-9 pr-9 py-2.5 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
        {search && <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"><X className="w-3.5 h-3.5" /></button>}
      </div>
      <div className="flex items-center gap-2">
        <div className="flex gap-1 bg-muted rounded-xl p-1 flex-1 overflow-x-auto">
          {FILTER_OPTIONS.map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`flex-shrink-0 flex-1 py-1.5 rounded-lg text-xs font-semibold capitalize transition-colors ${filter === f ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>{f}</button>
          ))}
        </div>
        <button onClick={printPDF} className="p-2 border border-border rounded-xl hover:bg-muted transition-colors text-muted-foreground shrink-0" title="Print PDF"><Printer className="w-4 h-4" /></button>
        <button onClick={downloadCSV} className="p-2 border border-border rounded-xl hover:bg-muted transition-colors text-muted-foreground shrink-0" title="Download CSV"><Download className="w-4 h-4" /></button>
      </div>
      {search && <p className="text-xs text-muted-foreground flex items-center gap-1.5"><Filter className="w-3 h-3" />{filtered.length} result{filtered.length !== 1 ? 's' : ''} for "{search}"</p>}
      {loading ? (
        <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12">
          <Wallet className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" />
          <p className="font-semibold text-sm">{search ? `No results for "${search}"` : `No ${filter !== 'all' ? filter : ''} transactions`}</p>
          <p className="text-xs text-muted-foreground mt-1">{search ? 'Try a different search term' : 'Your history will appear here'}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {selectedReceipt && (
            <ReceiptModal tx={selectedReceipt} currency={currency} onClose={() => setSelectedReceipt(null)} />
          )}
          {filtered.map(tx => {
            const isIn = tx.type === 'deposit' || tx.type === 'earnings';
            const isMpesaDeposit = tx.type === 'deposit' && (tx.payment_method === 'mpesa' || tx.reference);
            const txTag = getTag(tx.id);
            return (
              <div key={tx.id}
                className={`p-3.5 bg-card border border-border rounded-2xl transition-colors ${
                  isMpesaDeposit ? 'hover:border-green-500/40 hover:bg-green-500/5 cursor-pointer' : 'hover:bg-muted/30'
                }`}
                onClick={() => isMpesaDeposit && setSelectedReceipt(tx)}>
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${isIn ? 'bg-green-500/10 text-green-600' : 'bg-red-500/10 text-red-500'}`}>
                    {isIn ? <ArrowDownLeft className="w-4 h-4" /> : <ArrowUpRight className="w-4 h-4" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <p className="font-semibold text-sm capitalize">{tx.type.replace(/_/g,' ')}</p>
                      {isMpesaDeposit && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-green-500/10 text-green-600 font-bold border border-green-500/20">Receipt</span>}
                    </div>
                    <p className="text-xs text-muted-foreground truncate">
                      {tx.payment_method ? `${tx.payment_method.toUpperCase()} · ` : ''}{tx.description || new Date(tx.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className={`font-black text-base ${isIn ? 'text-green-600' : 'text-red-500'}`}>
                      {isIn ? '+' : '-'}{fmtAmt(Number(tx.amount), currency)}
                    </p>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${tx.status === 'completed' ? 'bg-green-500/10 text-green-600' : tx.status === 'pending' ? 'bg-orange-500/10 text-orange-600' : 'bg-red-500/10 text-red-500'}`}>
                      {tx.status}
                    </span>
                  </div>
                </div>
                <div className="mt-1.5 flex items-center gap-2 flex-wrap pl-[52px]" onClick={e => e.stopPropagation()}>
                  {txTag && (
                    <div className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${TAG_COLOR_BG[txTag.color] ?? TAG_COLOR_BG.blue}`}>
                      {txTag.text}
                      <button onClick={() => removeTag(tx.id)} className="ml-0.5 opacity-60 hover:opacity-100 text-xs leading-none">×</button>
                    </div>
                  )}
                  {!txTag && editingTag !== tx.id && (
                    <button onClick={() => { setEditingTag(tx.id); setTagInput(''); setTagColor('blue'); }}
                      className="text-[10px] text-muted-foreground/50 hover:text-muted-foreground transition-colors">
                      + add note
                    </button>
                  )}
                </div>
                {editingTag === tx.id && (
                  <div className="mt-2 space-y-2" onClick={e => e.stopPropagation()}>
                    <div className="flex gap-1.5 pl-[52px]">
                      {TAG_COLORS_LIST.map(c => (
                        <button key={c} onClick={() => setTagColor(c)}
                          className={`w-5 h-5 rounded-full ${TAG_DOT_BG[c] ?? 'bg-gray-500'} border-2 transition-all ${
                            tagColor === c ? 'border-foreground scale-110' : 'border-transparent opacity-50 hover:opacity-80'
                          }`} />
                      ))}
                    </div>
                    <div className="flex gap-2">
                      <input type="text" maxLength={40} placeholder="Add a note…" value={tagInput}
                        onChange={e => setTagInput(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') saveTag(tx.id); if (e.key === 'Escape') setEditingTag(null); }}
                        className="flex-1 h-8 px-2.5 rounded-lg border border-border bg-background text-xs focus:outline-none focus:ring-1 focus:ring-primary/40" />
                      <button onClick={() => saveTag(tx.id)}
                        className="px-3 h-8 bg-primary text-primary-foreground rounded-lg text-xs font-bold hover:opacity-90 transition-opacity">Save</button>
                      <button onClick={() => setEditingTag(null)}
                        className="px-2 h-8 border border-border rounded-lg text-xs hover:bg-muted transition-colors">✕</button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Spend Limit Card ──────────────────────────────────────────────────────
function SpendLimitCard({ userId, wallet, onSaved }: { userId: string; wallet: any; onSaved: () => void }) {
  const [enabled,    setEnabled]    = useState(wallet?.spend_limit_enabled ?? false);
  const [limitUsd,   setLimitUsd]   = useState(wallet?.daily_spend_limit ? String(wallet.daily_spend_limit) : '');
  const [saving,     setSaving]     = useState(false);
  const [todaySpent, setTodaySpent] = useState(0);

  useEffect(() => { fetchTodaySpend(); }, [userId]);

  const fetchTodaySpend = async () => {
    const since = new Date(); since.setHours(0, 0, 0, 0);
    const { data } = await supabase.from('wallet_transactions').select('amount').eq('user_id', userId).eq('type', 'withdrawal').gte('created_at', since.toISOString());
    setTodaySpent((data ?? []).reduce((s: number, t: any) => s + Number(t.amount), 0));
  };

  const { limitVal, progress, nearLimit, atLimit } = useMemo(() => {
    const limitVal = parseFloat(limitUsd || '0');
    const progress = enabled && limitVal > 0 ? Math.min((todaySpent / limitVal) * 100, 100) : 0;
    return { limitVal, progress, nearLimit: progress >= 80, atLimit: progress >= 100 };
  }, [limitUsd, enabled, todaySpent]);

  const handleSave = async () => {
    setSaving(true);
    const { error } = await supabase.from('user_wallets').update({ spend_limit_enabled: enabled, daily_spend_limit: limitUsd ? parseFloat(limitUsd) : null }).eq('user_id', userId);
    setSaving(false);
    if (error) { toast.error('Failed to save spend limit'); return; }
    toast.success(enabled ? `Daily limit set to $${parseFloat(limitUsd||'0').toFixed(2)}` : 'Spend limit disabled');
    onSaved();
  };

  return (
    <div className={`rounded-2xl border overflow-hidden ${atLimit ? 'border-red-500/40 bg-red-500/5' : nearLimit ? 'border-orange-500/40 bg-orange-500/5' : 'border-border'}`}>
      <div className="px-5 py-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2"><Shield className={`w-4 h-4 ${enabled ? 'text-primary' : 'text-muted-foreground'}`} /><h3 className="font-bold text-sm">Daily Spend Limit</h3></div>
          <button onClick={() => setEnabled(v => !v)} className={`relative w-11 h-6 rounded-full transition-colors ${enabled ? 'bg-primary' : 'bg-muted'}`}>
            <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${enabled ? 'translate-x-5' : 'translate-x-0'}`} />
          </button>
        </div>
        {enabled ? (
          <>
            <div className="mb-3">
              <label className="text-xs text-muted-foreground mb-1.5 block">Limit per day (USD)</label>
              <div className="grid grid-cols-4 gap-2 mb-2">
                {[10,25,50,100].map(v => (
                  <button key={v} onClick={() => setLimitUsd(String(v))}
                    className={`py-2 rounded-xl font-bold text-xs border-2 transition-all ${limitUsd === String(v) ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:border-primary/30'}`}>${v}</button>
                ))}
              </div>
              <input type="number" min="1" step="1" placeholder="Custom limit…" value={limitUsd && !['10','25','50','100'].includes(limitUsd) ? limitUsd : ''} onChange={e => setLimitUsd(e.target.value)}
                className="w-full h-10 px-3 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
            </div>
            {limitVal > 0 && (
              <div className="mb-3 space-y-1.5">
                <div className="flex justify-between text-xs">
                  <span className={atLimit ? 'text-red-500 font-bold' : nearLimit ? 'text-orange-500 font-bold' : 'text-muted-foreground'}>
                    {atLimit ? 'Limit reached' : nearLimit ? 'Near limit' : 'Spent today'}
                  </span>
                  <span className="font-semibold">${todaySpent.toFixed(2)} / ${limitVal.toFixed(2)}</span>
                </div>
                <div className="h-2 bg-muted rounded-full overflow-hidden">
                  <div className={`h-full rounded-full transition-all ${atLimit ? 'bg-red-500' : nearLimit ? 'bg-orange-500' : 'bg-primary'}`} style={{ width: `${progress}%` }} />
                </div>
              </div>
            )}
            <p className="text-xs text-muted-foreground mb-3">Withdrawals exceeding this limit will be blocked until midnight.</p>
          </>
        ) : (
          <p className="text-xs text-muted-foreground mb-4">Set a daily spend limit to control how much you can withdraw per day.</p>
        )}
        <button onClick={handleSave} disabled={saving || (enabled && !limitUsd)}
          className="w-full py-2.5 bg-primary text-primary-foreground rounded-xl font-semibold text-sm disabled:opacity-50 flex items-center justify-center gap-2 hover:opacity-90 transition-opacity">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Settings2 className="w-4 h-4" />}
          {saving ? 'Saving…' : 'Save Limit'}
        </button>
      </div>
    </div>
  );
}

// ── M-Pesa Receipt Modal ─────────────────────────────────────────────────
function ReceiptModal({ tx, currency, onClose }: { tx: any; currency: CurrencyCode; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const kesAmount = useMemo(() => Math.round(Number(tx.amount) * USD_TO_KES), [tx.amount]);
  const copyReceipt = () => {
    const text = [
      'M-Pesa Deposit Receipt',
      `Date:     ${new Date(tx.created_at).toLocaleString()}`,
      `Amount:   KES ${kesAmount.toLocaleString()} ($${Number(tx.amount).toFixed(2)})`,
      tx.reference ? `Receipt:  ${tx.reference}` : '',
      `Status:   ${tx.status}`,
      tx.description ? `Details:  ${tx.description}` : '',
    ].filter(Boolean).join('\n');
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true); toast.success('Receipt copied!');
      setTimeout(() => setCopied(false), 2500);
    });
  };
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-card border border-border rounded-t-3xl sm:rounded-3xl p-6 w-full max-w-sm shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-green-500/15 flex items-center justify-center">
              <CheckCircle2 className="w-4 h-4 text-green-600" />
            </div>
            <div>
              <p className="font-bold text-sm">M-Pesa Receipt</p>
              <p className="text-xs text-muted-foreground">Deposit confirmation</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-full hover:bg-muted transition-colors">
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>
        <div className="space-y-3">
          <div className="text-center py-3 bg-green-500/5 border border-green-500/20 rounded-2xl">
            <p className="text-xs text-muted-foreground mb-1">Amount Deposited</p>
            <p className="text-3xl font-black text-green-600">+{fmtAmt(Number(tx.amount), currency)}</p>
            <p className="text-sm text-muted-foreground mt-0.5">KES {kesAmount.toLocaleString()}</p>
          </div>
          <div className="space-y-2.5 divide-y divide-border">
            {tx.reference && (
              <div className="flex justify-between items-center pt-2.5">
                <span className="text-xs text-muted-foreground">Safaricom Receipt</span>
                <span className="font-mono text-xs font-black text-foreground">{tx.reference}</span>
              </div>
            )}
            <div className="flex justify-between items-center pt-2.5">
              <span className="text-xs text-muted-foreground">Date &amp; Time</span>
              <span className="text-xs font-semibold">{new Date(tx.created_at).toLocaleString()}</span>
            </div>
            <div className="flex justify-between items-center pt-2.5">
              <span className="text-xs text-muted-foreground">Payment Method</span>
              <span className="text-xs font-semibold uppercase">{tx.payment_method ?? 'M-Pesa'}</span>
            </div>
            <div className="flex justify-between items-center pt-2.5">
              <span className="text-xs text-muted-foreground">Status</span>
              <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                tx.status === 'completed' ? 'bg-green-500/10 text-green-600' : 'bg-orange-500/10 text-orange-600'
              }`}>{tx.status}</span>
            </div>
            {tx.description && (
              <div className="pt-2.5">
                <p className="text-xs text-muted-foreground mb-1">Description</p>
                <p className="text-xs">{tx.description}</p>
              </div>
            )}
          </div>
          <div className="flex gap-3 pt-2">
            <button onClick={copyReceipt}
              className="flex-1 flex items-center justify-center gap-2 py-3 border border-border rounded-xl font-semibold text-sm hover:bg-muted transition-colors">
              {copied ? <CheckCircle2 className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
              {copied ? 'Copied!' : 'Copy Receipt'}
            </button>
            <button onClick={onClose}
              className="flex-1 py-3 bg-primary text-primary-foreground rounded-xl font-semibold text-sm hover:opacity-90 transition-opacity">Done</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Tag editor constants ─────────────────────────────────────────────────
const TAG_COLORS_LIST = ['blue','green','purple','amber','red','pink','teal','orange'] as const;
const TAG_COLOR_BG = {
  blue:   'bg-blue-500/10 text-blue-600 border-blue-500/20',
  green:  'bg-green-500/10 text-green-600 border-green-500/20',
  purple: 'bg-purple-500/10 text-purple-600 border-purple-500/20',
  amber:  'bg-amber-500/10 text-amber-600 border-amber-500/20',
  red:    'bg-red-500/10 text-red-500 border-red-500/20',
  pink:   'bg-pink-500/10 text-pink-600 border-pink-500/20',
  teal:   'bg-teal-500/10 text-teal-600 border-teal-500/20',
  orange: 'bg-orange-500/10 text-orange-600 border-orange-500/20',
} as const;
const TAG_DOT_BG = {
  blue: 'bg-blue-500', green: 'bg-green-500', purple: 'bg-purple-500', amber: 'bg-amber-500',
  red: 'bg-red-500', pink: 'bg-pink-500', teal: 'bg-teal-500', orange: 'bg-orange-500',
} as const;
// ── Referral leaderboard ──────────────────────────────────────────────────
const RANK_BADGES = ['🥇','🥈','🥉'];
// ── Wallet search commands ────────────────────────────────────────────────
const SEARCH_COMMANDS: { label: string; hint: string; emoji: string; tab: ActiveTab; keywords: string[] }[] = [
  { label: 'Deposit via M-Pesa', hint: 'Top up your wallet',              emoji: '💰', tab: 'wallet',    keywords: ['deposit','top up','topup','add money','mpesa','funds']          },
  { label: 'Send Money',         hint: 'P2P transfer to a user',          emoji: '💸', tab: 'send',      keywords: ['send','transfer','pay','wire']                                  },
  { label: 'Receive Money',      hint: 'Show QR code & payment link',     emoji: '📥', tab: 'receive',   keywords: ['receive','qr','request','scan','link']                          },
  { label: 'Transaction History',hint: 'View all transactions',           emoji: '📋', tab: 'history',   keywords: ['history','transactions','txn','records','log']                  },
  { label: 'Analytics',          hint: 'Spending breakdown & charts',     emoji: '📊', tab: 'analytics', keywords: ['analytics','stats','spending','charts','insights']              },
  { label: 'Referrals',          hint: 'Earn credits by inviting friends',emoji: '👥', tab: 'referrals', keywords: ['referral','refer','invite','credits','leaderboard']             },
  { label: 'Scheduled Transfers',hint: 'Future & batch payments',         emoji: '⏰', tab: 'scheduled', keywords: ['scheduled','future','batch','automate']                         },
  { label: 'Savings Goals',      hint: 'Track financial milestones',      emoji: '🎯', tab: 'savings',   keywords: ['savings','goals','save','target','milestone']                   },
  { label: 'Reminders',          hint: 'Set payment reminders',           emoji: '🔔', tab: 'reminders', keywords: ['reminders','remind','alert','notify']                           },
  { label: 'Security',           hint: 'PIN, biometric & lock',           emoji: '🔒', tab: 'security',  keywords: ['security','pin','biometric','lock','fingerprint','password']    },
  { label: 'Currency Converter', hint: 'Convert between currencies',      emoji: '💱', tab: 'converter', keywords: ['convert','currency','exchange','forex','rate']                  },
  { label: 'M-Pesa History',     hint: 'View M-Pesa deposit receipts',     emoji: '📱', tab: 'mpesa',     keywords: ['mpesa','safaricom','receipt','mobile money','kenya']            },
];
// ── Module-level frequency / filter arrays (esbuild-safe) ─────────────
const FREQ_WEEKLY_MONTHLY = ['weekly','monthly'] as const;
const PERIOD_OPTIONS      = ['week','month','all'] as const;
const FILTER_OPTIONS      = ['all','deposit','withdrawal','earnings'] as const;
const CALENDAR_DAYS       = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'] as const;
const TOUR_STEPS: { emoji: string; title: string; body: string; tab: ActiveTab }[] = [
  { emoji: '💳', title: 'Deposit Funds',      body: 'Top up your wallet with M-Pesa STK Push in seconds. Funds arrive instantly after payment.',             tab: 'wallet'   },
  { emoji: '💸', title: 'Send Money',         body: 'Transfer funds to any Testagram user instantly, or request payment with a link.',                       tab: 'send'     },
  { emoji: '💰', title: 'Savings Pocket',     body: 'Set aside money in your Savings Pocket — separate from your spending balance.',                        tab: 'pocket'   },
  { emoji: '🔒', title: 'Secure Your Wallet', body: 'Set a 4-digit PIN or enable biometric (Face ID / fingerprint) to protect every transaction.',           tab: 'security' },
];

// ── Module-level heatmap color scales ────────────────────────────────────
const HEATMAP_GREEN = ['bg-green-200 dark:bg-green-950','bg-green-300 dark:bg-green-800','bg-green-500 dark:bg-green-700','bg-green-600 dark:bg-green-500'] as const;
const HEATMAP_RED   = ['bg-red-200 dark:bg-red-950',  'bg-red-300 dark:bg-red-800',  'bg-red-500 dark:bg-red-700',  'bg-red-600 dark:bg-red-500'  ] as const;
const CALENDAR_GREENS = ['bg-green-100 dark:bg-green-950','bg-green-200 dark:bg-green-900','bg-green-400 dark:bg-green-700','bg-green-600 dark:bg-green-500'] as const;
const CALENDAR_REDS   = ['bg-red-100 dark:bg-red-950','bg-red-200 dark:bg-red-900','bg-red-400 dark:bg-red-700','bg-red-600 dark:bg-red-500'] as const;

function heatmapCellBg(amount: number, hasIn: boolean, maxAmount: number): string {
  if (amount === 0) return 'bg-muted';
  const i = Math.min(Math.ceil((amount / maxAmount) * 4), 4);
  const g = hasIn ? HEATMAP_GREEN : HEATMAP_RED;
  return g[i - 1] ?? g[3];
}

// ── Crypto Price Widget ───────────────────────────────────────────────────
function CryptoWidget() {
  const [prices, setPrices] = useState(null as { btc: number; eth: number; btcChange: number; ethChange: number } | null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchPrices = () => {
      fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=usd&include_24hr_change=true')
        .then(r => r.ok ? r.json() : Promise.reject())
        .then(d => { setPrices({ btc: d.bitcoin.usd, eth: d.ethereum.usd, btcChange: d.bitcoin.usd_24h_change, ethChange: d.ethereum.usd_24h_change }); setLoading(false); })
        .catch(() => setLoading(false));
    };
    fetchPrices();
    const t = setInterval(fetchPrices, 60000);
    return () => clearInterval(t);
  }, []);

  if (!loading && !prices) return null;

  return (
    <div className="rounded-2xl border border-border overflow-hidden">
      <div className="px-4 py-3 flex items-center gap-2 border-b border-border">
        <TrendingUp className="w-4 h-4 text-primary" />
        <h3 className="font-bold text-sm">Crypto Prices</h3>
        <span className="text-[10px] text-muted-foreground ml-auto">Live · CoinGecko</span>
      </div>
      {loading ? (
        <div className="flex justify-center p-4"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
      ) : prices ? (
        <div className="grid grid-cols-2 divide-x divide-border">
          {[
            { symbol: 'BTC', emoji: '₿', price: prices.btc, change: prices.btcChange },
            { symbol: 'ETH', emoji: 'Ξ', price: prices.eth, change: prices.ethChange },
          ].map(c => (
            <div key={c.symbol} className="p-4">
              <div className="flex items-center gap-1.5 mb-1.5">
                <span className="text-lg font-black">{c.emoji}</span>
                <span className="text-xs font-bold text-muted-foreground">{c.symbol}</span>
              </div>
              <p className="text-base font-black">${c.price.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
              <p className={`text-xs font-semibold mt-0.5 ${c.change >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                {c.change >= 0 ? '▲' : '▼'} {Math.abs(c.change).toFixed(2)}%
              </p>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// ── Activity Heatmap ──────────────────────────────────────────────────────
function ActivityHeatmap({ userId }: { userId: string }) {
  const [txns,    setTxns]    = useState([] as any[]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const since = new Date(Date.now() - 35 * 86400000).toISOString();
    supabase.from('wallet_transactions').select('created_at, amount, type').eq('user_id', userId)
      .gte('created_at', since).order('created_at', { ascending: true })
      .then(({ data }) => { setTxns(data ?? []); setLoading(false); });
  }, [userId]);

  const { cells, maxAmount } = useMemo(() => {
    const map: Record<string, { count: number; amount: number; hasIn: boolean }> = {};
    const now = Date.now();
    for (let i = 34; i >= 0; i--) {
      const key = new Date(now - i * 86400000).toISOString().split('T')[0];
      map[key] = { count: 0, amount: 0, hasIn: false };
    }
    txns.forEach(t => {
      const key = (t.created_at as string).split('T')[0];
      if (!map[key]) return;
      map[key].count++;
      map[key].amount += Number(t.amount);
      if (t.type === 'deposit' || t.type === 'earnings') map[key].hasIn = true;
    });
    const arr = Object.entries(map).map(([date, v]) => ({ date, ...v }));
    return { cells: arr, maxAmount: Math.max(...arr.map(c => c.amount), 1) };
  }, [txns]);

  const getCellBg = (amount: number, hasIn: boolean) => heatmapCellBg(amount, hasIn, maxAmount);

  return (
    <div className="border border-border rounded-2xl p-4">
      <div className="flex items-center gap-2 mb-4">
        <Activity className="w-4 h-4 text-primary" />
        <h3 className="font-bold text-sm">Activity Heatmap</h3>
        <span className="text-[10px] text-muted-foreground ml-auto">Last 35 days</span>
      </div>
      {loading ? (
        <div className="flex justify-center py-4"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>
      ) : (
        <>
          <div className="grid grid-cols-7 gap-1.5">
            {cells.map(c => (
              <div key={c.date}
                title={`${c.date}: ${c.count} txn${c.count !== 1 ? 's' : ''} · $${c.amount.toFixed(2)}`}
                className={`h-8 rounded-md cursor-default transition-opacity hover:opacity-75 ${getCellBg(c.amount, c.hasIn)}`}
              />
            ))}
          </div>
          <div className="flex items-center justify-between mt-3">
            <span className="text-[10px] text-muted-foreground">Less</span>
            <div className="flex gap-1 items-center">
              <div className="w-3.5 h-3.5 rounded-sm bg-muted border border-border/50" />
              <div className="w-3.5 h-3.5 rounded-sm bg-green-200 dark:bg-green-950" />
              <div className="w-3.5 h-3.5 rounded-sm bg-green-400 dark:bg-green-800" />
              <div className="w-3.5 h-3.5 rounded-sm bg-green-500 dark:bg-green-700" />
              <div className="w-3.5 h-3.5 rounded-sm bg-green-600 dark:bg-green-500" />
            </div>
            <span className="text-[10px] text-muted-foreground">More</span>
          </div>
          {txns.length === 0 && <p className="text-center text-xs text-muted-foreground mt-3">No transactions in this period</p>}
        </>
      )}
    </div>
  );
}

// ── Spending Alerts Card ──────────────────────────────────────────────────
function SpendingAlertsCard({ userId }: { userId: string }) {
  const [prefs, setPrefs] = useState({ enabled: false, threshold: '10', budget: '50' } as { enabled: boolean; threshold: string; budget: string });
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(`ts-alerts-${userId}`);
      if (raw) setPrefs(JSON.parse(raw));
    } catch { /* use defaults */ }
  }, [userId]);

  const save = (next: { enabled: boolean; threshold: string; budget: string }) => {
    setPrefs(next);
    localStorage.setItem(`ts-alerts-${userId}`, JSON.stringify(next));
  };

  const runCheck = async () => {
    if (!prefs.enabled) return;
    setChecking(true);
    const since = new Date(); since.setHours(0, 0, 0, 0);
    const { data } = await supabase.from('wallet_transactions')
      .select('amount,type,created_at,id').eq('user_id', userId).gte('created_at', since.toISOString());
    const withdrawals = (data ?? []).filter((t: any) => t.type === 'withdrawal');
    const todayTotal  = withdrawals.reduce((s: number, t: any) => s + Number(t.amount), 0);
    const budget      = parseFloat(prefs.budget    || '0');
    const threshold   = parseFloat(prefs.threshold || '0');
    const todayKey    = since.toISOString().split('T')[0];
    const alertKey    = `ts-alerted-${userId}`;
    const alerted: any = (() => { try { return JSON.parse(localStorage.getItem(alertKey) ?? '{}'); } catch { return {}; } })();

    if (budget > 0 && todayTotal >= budget * 0.8 && !alerted[`budget-${todayKey}`]) {
      await supabase.from('platform_inbox').insert({
        user_id: userId, subject: 'Spending Alert: 80% of daily budget used',
        body: `You have spent $${todayTotal.toFixed(2)} today — 80% of your $${budget.toFixed(2)} daily budget.`,
        type: 'warning', icon_emoji: '⚠️', cta_label: 'Review Limit', cta_url: '/wallet',
      });
      alerted[`budget-${todayKey}`] = true;
      localStorage.setItem(alertKey, JSON.stringify(alerted));
      toast.warning('Alert sent: 80% of daily budget reached!');
    }
    if (threshold > 0) {
      for (const t of withdrawals.filter((t: any) => Number(t.amount) >= threshold)) {
        const k = `txn-${t.id}`;
        if (!alerted[k]) {
          await supabase.from('platform_inbox').insert({
            user_id: userId, subject: `Large withdrawal alert: $${Number(t.amount).toFixed(2)}`,
            body: `A withdrawal of $${Number(t.amount).toFixed(2)} was recorded — above your $${threshold.toFixed(2)} threshold.`,
            type: 'warning', icon_emoji: '💸', cta_label: 'View History', cta_url: '/wallet?tab=history',
          });
          alerted[k] = true;
        }
      }
      localStorage.setItem(alertKey, JSON.stringify(alerted));
    }
    setChecking(false);
    toast.success('Alert check complete');
  };

  return (
    <div className="rounded-2xl border border-border overflow-hidden">
      <div className="px-5 py-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <AlertTriangle className={`w-4 h-4 ${prefs.enabled ? 'text-amber-500' : 'text-muted-foreground'}`} />
            <h3 className="font-bold text-sm">Spending Alerts</h3>
            {prefs.enabled && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-600 font-bold border border-amber-500/20">On</span>}
          </div>
          <button onClick={() => save({ ...prefs, enabled: !prefs.enabled })}
            className={`relative w-11 h-6 rounded-full transition-colors ${prefs.enabled ? 'bg-primary' : 'bg-muted'}`}>
            <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${prefs.enabled ? 'translate-x-5' : 'translate-x-0'}`} />
          </button>
        </div>
        {prefs.enabled ? (
          <div className="space-y-4 mt-3">
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5 block">Large withdrawal alert (USD)</label>
              <div className="grid grid-cols-4 gap-2 mb-2">
                {['5','10','25','50'].map(v => (
                  <button key={v} onClick={() => save({ ...prefs, threshold: v })}
                    className={`py-2 rounded-xl font-bold text-xs border-2 transition-all ${prefs.threshold === v ? 'border-amber-500 bg-amber-500/10 text-amber-600' : 'border-border hover:border-amber-500/30'}`}>${v}</button>
                ))}
              </div>
              <input type="number" min="1" step="0.01" placeholder="Custom threshold…"
                value={!['5','10','25','50'].includes(prefs.threshold) ? prefs.threshold : ''}
                onChange={e => save({ ...prefs, threshold: e.target.value })}
                className="w-full h-10 px-3 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/30" />
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5 block">Daily budget alert at 80% (USD)</label>
              <div className="grid grid-cols-4 gap-2 mb-2">
                {['25','50','100','250'].map(v => (
                  <button key={v} onClick={() => save({ ...prefs, budget: v })}
                    className={`py-2 rounded-xl font-bold text-xs border-2 transition-all ${prefs.budget === v ? 'border-amber-500 bg-amber-500/10 text-amber-600' : 'border-border hover:border-amber-500/30'}`}>${v}</button>
                ))}
              </div>
              <input type="number" min="1" step="0.01" placeholder="Custom budget…"
                value={!['25','50','100','250'].includes(prefs.budget) ? prefs.budget : ''}
                onChange={e => save({ ...prefs, budget: e.target.value })}
                className="w-full h-10 px-3 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/30" />
            </div>
            <button onClick={runCheck} disabled={checking}
              className="w-full py-2.5 border border-amber-500/30 text-amber-600 rounded-xl font-semibold text-sm hover:bg-amber-500/5 disabled:opacity-50 flex items-center justify-center gap-2 transition-colors">
              {checking ? <Loader2 className="w-4 h-4 animate-spin" /> : <AlertTriangle className="w-4 h-4" />}
              {checking ? 'Checking…' : 'Check Alerts Now'}
            </button>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground mt-1">Get inbox notifications when a withdrawal exceeds a set amount, or your daily spending hits 80% of your budget.</p>
        )}
      </div>
    </div>
  );
}

// ── Wallet Notifications Hub ─────────────────────────────────────────────
function WalletNotificationsHub({ userId }: { userId: string }) {
  const [msgs,    setMsgs]    = useState([] as any[]);
  const [loading, setLoading] = useState(true);
  const [marking, setMarking] = useState(false);
  const [open,    setOpen]    = useState(false);

  useEffect(() => { load(); }, [userId]);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase.from('platform_inbox')
      .select('*').eq('user_id', userId)
      .in('type', ['payment','warning','system'])
      .order('sent_at', { ascending: false }).limit(20);
    setMsgs(data ?? []); setLoading(false);
  };

  const markAllRead = async () => {
    const unreadIds = msgs.filter(m => !m.read).map(m => m.id);
    if (!unreadIds.length) return;
    setMarking(true);
    await supabase.from('platform_inbox').update({ read: true }).in('id', unreadIds);
    setMarking(false);
    load();
  };

  const unreadCount = msgs.filter(m => !m.read).length;

  return (
    <div className="rounded-2xl border border-border overflow-hidden">
      <button onClick={() => setOpen(v => !v)} className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-muted/40 transition-colors text-left">
        <div className="relative">
          <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center">
            <Bell className="w-4 h-4 text-primary" />
          </div>
          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white text-[9px] font-black rounded-full flex items-center justify-center">{unreadCount}</span>
          )}
        </div>
        <div className="flex-1">
          <p className="font-bold text-sm">Wallet Notifications</p>
          <p className="text-xs text-muted-foreground">{unreadCount > 0 ? `${unreadCount} unread` : 'All caught up'}</p>
        </div>
        <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="border-t border-border">
          {loading ? (
            <div className="flex justify-center p-4"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>
          ) : msgs.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-5">No wallet notifications yet</p>
          ) : (
            <>
              {unreadCount > 0 && (
                <div className="flex justify-end px-4 py-2 border-b border-border">
                  <button onClick={markAllRead} disabled={marking}
                    className="flex items-center gap-1.5 text-xs text-primary font-semibold hover:underline disabled:opacity-50">
                    {marking ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
                    Mark all read
                  </button>
                </div>
              )}
              <div className="divide-y divide-border max-h-72 overflow-y-auto">
                {msgs.map(m => (
                  <div key={m.id} className={`px-4 py-3 flex gap-3 ${!m.read ? 'bg-primary/3' : ''}`}>
                    <span className="text-xl shrink-0 mt-0.5">{m.icon_emoji ?? '🔔'}</span>
                    <div className="flex-1 min-w-0">
                      <p className={`text-xs font-semibold ${!m.read ? 'text-foreground' : 'text-muted-foreground'}`}>{m.subject}</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">{new Date(m.sent_at).toLocaleString()}</p>
                    </div>
                    {!m.read && <div className="w-2 h-2 rounded-full bg-primary shrink-0 mt-1.5" />}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Currency Converter Widget ─────────────────────────────────────────────
// Converter maps — plain objects, no Record<string,T> annotation (esbuild guard)
const CONVERTER_RATES = { USD: 1, KES: 130, EUR: 0.92, GBP: 0.79, NGN: 1580, TZS: 2600, UGX: 3700, ZAR: 18.7 };
const CONVERTER_SYMBOLS = { USD: '$', KES: 'KSh', EUR: '€', GBP: '£', NGN: '₦', TZS: 'TSh', UGX: 'USh', ZAR: 'R' };
const CONVERTER_CURRENCY_KEYS = ['USD','KES','EUR','GBP','NGN','TZS','UGX','ZAR'] as const;

function CurrencyConverterWidget() {
  const [fromCur, setFromCur] = useState('KES');
  const [toCur,   setToCur]   = useState('USD');
  const [input,   setInput]   = useState('');

  const { result, pairs } = useMemo(() => {
    const val = parseFloat(input || '0');
    const inUsd = val / (CONVERTER_RATES[fromCur] ?? 1);
    const result = inUsd * (CONVERTER_RATES[toCur] ?? 1);
    const pairs = CONVERTER_CURRENCY_KEYS.filter(k => k !== fromCur).map(k => ({
      code: k, symbol: CONVERTER_SYMBOLS[k] ?? k,
      value: (inUsd * CONVERTER_RATES[k]).toFixed(k === 'KES' || k === 'NGN' || k === 'TZS' || k === 'UGX' ? 0 : 2),
    }));
    return { result, pairs };
  }, [input, fromCur, toCur]);

  const swap = () => { setFromCur(toCur); setToCur(fromCur); };

  return (
    <div className="rounded-2xl border border-border overflow-hidden">
      <div className="px-4 py-3 flex items-center gap-2 border-b border-border">
        <Globe className="w-4 h-4 text-primary" />
        <h3 className="font-bold text-sm">Currency Converter</h3>
        <span className="text-[10px] text-muted-foreground ml-auto">Static rates</span>
      </div>
      <div className="p-4 space-y-3">
        <div className="flex gap-2 items-center">
          <div className="flex-1">
            <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide block mb-1">From</label>
            <select value={fromCur} onChange={e => setFromCur(e.target.value)}
              className="w-full h-10 px-3 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30">
              {CONVERTER_CURRENCY_KEYS.map(c => <option key={c} value={c}>{CONVERTER_SYMBOLS[c]} {c}</option>)}
            </select>
          </div>
          <button onClick={swap} className="mt-5 p-2.5 rounded-full border border-border hover:bg-muted transition-colors shrink-0">
            <RefreshCw className="w-4 h-4 text-muted-foreground" />
          </button>
          <div className="flex-1">
            <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide block mb-1">To</label>
            <select value={toCur} onChange={e => setToCur(e.target.value)}
              className="w-full h-10 px-3 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30">
              {CONVERTER_CURRENCY_KEYS.map(c => <option key={c} value={c}>{CONVERTER_SYMBOLS[c]} {c}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide block mb-1">Amount ({fromCur})</label>
          <input type="number" min="0" step="any" placeholder="Enter amount…" value={input} onChange={e => setInput(e.target.value)}
            className="w-full h-11 px-3 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
        </div>
        {parseFloat(input) > 0 && (
          <div className="p-3 bg-primary/5 border border-primary/15 rounded-xl">
            <p className="text-xs font-semibold text-muted-foreground mb-1">{input} {fromCur} =</p>
            <p className="text-2xl font-black text-primary">{CONVERTER_SYMBOLS[toCur]}{result.toFixed(toCur === 'KES' || toCur === 'NGN' || toCur === 'TZS' || toCur === 'UGX' ? 0 : 2)} {toCur}</p>
          </div>
        )}
        {parseFloat(input) > 0 && (
          <div className="grid grid-cols-2 gap-2">
            {pairs.slice(0,4).map(p => (
              <div key={p.code} className="p-2.5 bg-muted/30 border border-border rounded-xl">
                <p className="text-[10px] text-muted-foreground font-semibold">{p.code}</p>
                <p className="text-sm font-black">{p.symbol}{p.value}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── P2P Transfer History Chart ────────────────────────────────────────────
const LINE_CHART_STROKE = '#7c3aed';

function P2PBalanceChart({ userId, currency }: { userId: string; currency: CurrencyCode }) {
  const [txns,    setTxns]    = useState([] as any[]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const since = new Date(Date.now() - 30 * 86400000).toISOString();
    supabase.from('wallet_transactions').select('created_at,amount,type')
      .eq('user_id', userId).gte('created_at', since)
      .order('created_at', { ascending: true }).limit(500)
      .then(({ data }) => { setTxns(data ?? []); setLoading(false); });
  }, [userId]);

  const { chartData, minBal, maxBal } = useMemo(() => {
    const dayMap: Record<string, number> = {};
    const now = Date.now();
    for (let i = 29; i >= 0; i--) {
      const key = new Date(now - i * 86400000).toLocaleDateString('en', { month: 'short', day: 'numeric' });
      dayMap[key] = 0;
    }
    let running = 0;
    txns.forEach(t => {
      const key = new Date(t.created_at).toLocaleDateString('en', { month: 'short', day: 'numeric' });
      const isIn = t.type === 'deposit' || t.type === 'earnings';
      running += isIn ? Number(t.amount) : -Number(t.amount);
      if (dayMap[key] !== undefined) dayMap[key] = running;
    });
    // forward-fill
    let last = 0;
    const chartData = Object.entries(dayMap).map(([date, bal]) => {
      if (bal !== 0) last = bal;
      else if (last !== 0) bal = last;
      return { date, bal: parseFloat(bal.toFixed(2)) };
    });
    const vals = chartData.map(d => d.bal);
    return { chartData, minBal: Math.min(...vals, 0), maxBal: Math.max(...vals, 1) };
  }, [txns]);

  if (loading) return <div className="flex justify-center py-4"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>;
  if (txns.length === 0) return null;

  return (
    <div className="border border-border rounded-2xl p-4">
      <div className="flex items-center gap-2 mb-4">
        <TrendingUp className="w-4 h-4 text-primary" />
        <h3 className="font-bold text-sm">Balance Over 30 Days</h3>
      </div>
      <ResponsiveContainer width="100%" height={160}>
        <AreaChart data={chartData} margin={{ top: 4, right: 0, left: -28, bottom: 0 }}>
          <defs>
            <linearGradient id="balGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={LINE_CHART_STROKE} stopOpacity={0.18} />
              <stop offset="95%" stopColor={LINE_CHART_STROKE} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
          <XAxis dataKey="date" tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }} interval={4} />
          <YAxis tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }} domain={[minBal, maxBal]} />
          <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 11 }}
            formatter={(v: any) => [`$${v}`, 'Balance']} />
          <Area type="monotone" dataKey="bal" stroke={LINE_CHART_STROKE} strokeWidth={2} fill="url(#balGrad)" dot={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Inactivity lock minutes (must be before InactivityLockCard) ─────────
const INACTIVITY_MINUTES = [5, 10, 30, 60] as const;

// ── Inactivity Lock Card ────────────────────────────────────────────────
function InactivityLockCard({ userId }: { userId: string }) {
  const STORAGE_KEY = useMemo(() => `ts-inactivity-mins-${userId}`, [userId]);
  const [enabled, setEnabled] = useState(false);
  const [minutes, setMinutes] = useState(10);
  const [saved,   setSaved]   = useState(false);

  useEffect(() => {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) { setEnabled(true); setMinutes(parseInt(raw, 10) || 10); }
  }, [userId]);

  const save = () => {
    if (enabled) { localStorage.setItem(STORAGE_KEY, String(minutes)); }
    else          { localStorage.removeItem(STORAGE_KEY); }
    setSaved(true);
    toast.success(enabled ? `Wallet locks after ${minutes}m inactivity` : 'Auto-lock disabled');
    setTimeout(() => setSaved(false), 2500);
  };

  return (
    <div className="rounded-2xl border border-border overflow-hidden">
      <div className="px-5 py-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-primary" />
            <h3 className="font-bold text-sm">Auto-Lock on Inactivity</h3>
          </div>
          <button onClick={() => setEnabled(v => !v)}
            className={`relative w-11 h-6 rounded-full transition-colors ${enabled ? 'bg-primary' : 'bg-muted'}`}>
            <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${enabled ? 'translate-x-5' : 'translate-x-0'}`} />
          </button>
        </div>
        {enabled ? (
          <>
            <p className="text-xs text-muted-foreground mb-3">Lock wallet after this many minutes with no interaction.</p>
            <div className="flex gap-2 mb-3">
              {INACTIVITY_MINUTES.map(m => (
                <button key={m} onClick={() => setMinutes(m)}
                  className={`flex-1 py-2.5 rounded-xl font-bold text-sm border-2 transition-all ${minutes === m ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:border-primary/30'}`}>
                  {m}m
                </button>
              ))}
            </div>
          </>
        ) : (
          <p className="text-xs text-muted-foreground mb-3">Automatically lock your wallet after a period of inactivity to prevent unauthorized access.</p>
        )}
        <button onClick={save}
          className="w-full py-2.5 bg-primary text-primary-foreground rounded-xl font-semibold text-sm flex items-center justify-center gap-2 hover:opacity-90 transition-opacity">
          {saved ? <CheckCircle2 className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
          {saved ? 'Saved!' : enabled ? `Save (${minutes}m timeout)` : 'Save (disabled)'}
        </button>
      </div>
    </div>
  );
}



// ── Wallet Onboarding Tour ──────────────────────────────────────────────
function WalletOnboardingTour({ userId, onNavigate, onDismiss }: {
  userId: string; onNavigate: (tab: ActiveTab) => void; onDismiss: () => void;
}) {
  const [step, setStep] = useState(0);
  const current = TOUR_STEPS[step];
  const isLast  = step === TOUR_STEPS.length - 1;

  const dismiss = () => {
    try { localStorage.setItem(`ts-wallet-toured-${userId}`, '1'); } catch { /* ignore */ }
    onDismiss();
  };

  return (
    <div className="rounded-2xl border-2 border-primary/30 bg-gradient-to-br from-primary/10 to-purple-500/5 p-5 relative">
      <button onClick={dismiss} className="absolute top-3 right-3 p-1.5 rounded-full hover:bg-muted/60 text-muted-foreground">
        <X className="w-3.5 h-3.5" />
      </button>
      <div className="flex items-center gap-1.5 mb-4">
        {TOUR_STEPS.map((_, i) => (
          <div key={i} className={`h-1 rounded-full flex-1 transition-all ${
            i === step ? 'bg-primary' : i < step ? 'bg-primary/40' : 'bg-border'
          }`} />
        ))}
      </div>
      <div className="flex flex-col items-center text-center gap-3 py-2">
        <div className="text-4xl">{current.emoji}</div>
        <div>
          <p className="font-black text-base">{current.title}</p>
          <p className="text-sm text-muted-foreground mt-1 leading-relaxed">{current.body}</p>
        </div>
        <div className="flex gap-2 w-full mt-1">
          {step > 0 && (
            <button onClick={() => setStep(s => s - 1)}
              className="flex-1 py-2.5 border border-border rounded-xl font-semibold text-sm hover:bg-muted transition-colors">
              Back
            </button>
          )}
          <button
            onClick={() => {
              onNavigate(current.tab);
              if (isLast) { dismiss(); } else { setStep(s => s + 1); }
            }}
            className="flex-1 py-2.5 bg-primary text-primary-foreground rounded-xl font-bold text-sm hover:opacity-90 transition-opacity">
            {isLast ? 'Get Started' : `Next: ${TOUR_STEPS[step + 1].title}`}
          </button>
        </div>
        <button onClick={dismiss} className="text-xs text-muted-foreground hover:underline">Skip tour</button>
      </div>
    </div>
  );
}

// ── Monthly Heatmap Calendar ──────────────────────────────────────────────
function MonthlyHeatmapCalendar({ userId, currency }: { userId: string; currency: CurrencyCode }) {
  const [txns,    setTxns]    = useState([] as any[]);
  const [loading, setLoading] = useState(true);
  const [offset,  setOffset]  = useState(0);

  const { year, month, monthLabel } = useMemo(() => {
    const d = new Date();
    d.setMonth(d.getMonth() + offset);
    d.setDate(1);
    return {
      year:       d.getFullYear(),
      month:      d.getMonth(),
      monthLabel: d.toLocaleDateString('en', { month: 'long', year: 'numeric' }),
    };
  }, [offset]);

  useEffect(() => {
    setLoading(true);
    const start = new Date(year, month, 1).toISOString();
    const end   = new Date(year, month + 1, 1).toISOString();
    supabase.from('wallet_transactions')
      .select('created_at,amount,type').eq('user_id', userId)
      .gte('created_at', start).lt('created_at', end)
      .then(({ data }) => { setTxns(data ?? []); setLoading(false); });
  }, [userId, year, month]);

  const { cells, maxAmt } = useMemo(() => {
    const daysInMonth  = new Date(year, month + 1, 0).getDate();
    const firstWeekday = new Date(year, month, 1).getDay();
    const dayMap: Record<number, { inAmt: number; outAmt: number; count: number }> = {};
    for (let d = 1; d <= daysInMonth; d++) dayMap[d] = { inAmt: 0, outAmt: 0, count: 0 };
    txns.forEach(t => {
      const day = new Date(t.created_at).getDate();
      if (!dayMap[day]) return;
      dayMap[day].count++;
      if (t.type === 'deposit' || t.type === 'earnings') dayMap[day].inAmt  += Number(t.amount);
      else                                                dayMap[day].outAmt += Number(t.amount);
    });
    const cells: { day: number | null; data: { inAmt: number; outAmt: number; count: number } | null }[] = [];
    for (let i = 0; i < firstWeekday; i++) cells.push({ day: null, data: null });
    for (let d = 1; d <= daysInMonth; d++) cells.push({ day: d, data: dayMap[d] });
    const maxAmt = Math.max(...Object.values(dayMap).map(v => v.inAmt + v.outAmt), 1);
    return { cells, maxAmt };
  }, [txns, year, month]);

  const getCellColor = (data: { inAmt: number; outAmt: number; count: number } | null) => {
    if (!data || data.count === 0) return 'bg-muted/60';
    const total     = data.inAmt + data.outAmt;
    const intensity = Math.min(Math.ceil((total / maxAmt) * 4), 4);
    return data.inAmt >= data.outAmt
      ? (CALENDAR_GREENS[intensity - 1] ?? CALENDAR_GREENS[3])
      : (CALENDAR_REDS[intensity - 1] ?? CALENDAR_REDS[3]);
  };

  const today = new Date();
  const isCurrentMonth = today.getFullYear() === year && today.getMonth() === month;

  return (
    <div className="border border-border rounded-2xl p-4">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2"><Calendar className="w-4 h-4 text-primary" /><h3 className="font-bold text-sm">Monthly Calendar</h3></div>
        <div className="flex items-center gap-1">
          <button onClick={() => setOffset(o => o - 1)} className="p-1.5 rounded-lg hover:bg-muted transition-colors">
            <ChevronDown className="w-3.5 h-3.5 rotate-90 text-muted-foreground" />
          </button>
          <span className="text-xs font-semibold min-w-[108px] text-center">{monthLabel}</span>
          <button onClick={() => setOffset(o => o + 1)} disabled={isCurrentMonth}
            className="p-1.5 rounded-lg hover:bg-muted transition-colors disabled:opacity-30">
            <ChevronDown className="w-3.5 h-3.5 -rotate-90 text-muted-foreground" />
          </button>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-0.5 mb-1">
        {CALENDAR_DAYS.map(d => <div key={d} className="text-center text-[9px] font-bold text-muted-foreground py-1">{d}</div>)}
      </div>
      {loading ? (
        <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>
      ) : (
        <div className="grid grid-cols-7 gap-1">
          {cells.map((cell, i) => {
            if (!cell.day) return <div key={i} />;
            const isToday  = isCurrentMonth && cell.day === today.getDate();
            const label    = cell.data && cell.data.count > 0
              ? `${cell.data.count} txn(s) · ${fmtAmt(cell.data.inAmt + cell.data.outAmt, currency)}`
              : 'No activity';
            return (
              <div key={i}
                title={`${year}-${String(month + 1).padStart(2,'0')}-${String(cell.day).padStart(2,'0')}\n${label}`}
                className={`aspect-square rounded-lg flex items-center justify-center text-[10px] font-bold cursor-default hover:opacity-75 transition-opacity ${
                  isToday ? 'ring-2 ring-primary ring-offset-1 ring-offset-background' : ''
                } ${getCellColor(cell.data)}`}>
                {cell.day}
              </div>
            );
          })}
        </div>
      )}
      <div className="flex gap-4 justify-center mt-3 text-[10px] text-muted-foreground">
        <div className="flex items-center gap-1"><div className="w-3 h-3 rounded-sm bg-green-400 dark:bg-green-700" /><span>Deposits</span></div>
        <div className="flex items-center gap-1"><div className="w-3 h-3 rounded-sm bg-red-400 dark:bg-red-700" /><span>Withdrawals</span></div>
        <div className="flex items-center gap-1"><div className="w-3 h-3 rounded-sm bg-muted border border-border/50" /><span>None</span></div>
      </div>
    </div>
  );
}

// ── P2P Money Request Panel ───────────────────────────────────────────────
function RequestMoneyPanel({ userId, senderUsername, currency }: {
  userId: string; senderUsername: string; currency: CurrencyCode;
}) {
  const [query,     setQuery]     = useState('');
  const [results,   setResults]   = useState([] as any[]);
  const [searching, setSearching] = useState(false);
  const [target,    setTarget]    = useState(null as any);
  const [amount,    setAmount]    = useState('');
  const [note,      setNote]      = useState('');
  const [sent,      setSent]      = useState(false);
  const [sending,   setSending]   = useState(false);

  const payLink = useMemo(() => {
    if (!target || typeof window === 'undefined') return '';
    const params = new URLSearchParams({ tab: 'send', to: senderUsername });
    if (amount && parseFloat(amount) > 0) params.set('amount', amount);
    if (note.trim()) params.set('note', note.trim());
    return `${window.location.origin}/wallet?${params.toString()}`;
  }, [target, senderUsername, amount, note]);

  const searchUsers = async (q: string) => {
    setQuery(q);
    if (q.trim().length < 2) { setResults([]); return; }
    setSearching(true);
    const { data } = await supabase.from('profiles').select('id,username,avatar_url,verified')
      .ilike('username', `%${q.trim()}%`).neq('id', userId).limit(8);
    setResults(data ?? []); setSearching(false);
  };

  const sendRequest = async () => {
    if (!target) return;
    setSending(true);
    const amtLabel  = amount && parseFloat(amount) > 0 ? ` for ${fmtAmt(parseFloat(amount), currency)}` : '';
    const noteLabel = note.trim() ? ` — "${note.trim()}"` : '';
    await supabase.from('platform_inbox').insert({
      user_id: target.id,
      subject: `@${senderUsername} requested money from you`,
      body: `@${senderUsername} is requesting payment${amtLabel}${noteLabel}. Tap below to send instantly.`,
      type: 'payment', icon_emoji: '\uD83D\uDE4F',
      cta_label: `Send${amtLabel}`, cta_url: payLink,
    });
    setSending(false); setSent(true);
    toast.success(`Request sent to @${target.username}!`);
  };

  if (sent) {
    return (
      <div className="flex flex-col items-center gap-4 p-6 bg-gradient-to-br from-blue-500/10 to-indigo-400/5 border border-blue-500/20 rounded-2xl text-center">
        <div className="w-16 h-16 rounded-full bg-blue-500/15 flex items-center justify-center"><CheckCircle2 className="w-9 h-9 text-blue-500" /></div>
        <div>
          <p className="text-lg font-black text-blue-600">Request Sent!</p>
          <p className="text-sm text-muted-foreground mt-0.5">@{target?.username} received your payment request</p>
        </div>
        <button onClick={() => { setSent(false); setTarget(null); setAmount(''); setNote(''); setQuery(''); }}
          className="px-6 py-2.5 bg-primary text-primary-foreground rounded-full font-semibold text-sm hover:opacity-90">Done</button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="p-4 rounded-2xl bg-blue-500/10 border border-blue-500/20">
        <p className="text-sm font-semibold text-blue-700 dark:text-blue-400">Request Money</p>
        <p className="text-xs text-muted-foreground mt-0.5">The recipient gets a notification with a one-tap Pay button pre-filled with your username.</p>
      </div>
      {!target ? (
        <div className="space-y-2">
          <label className="text-sm font-semibold">Request from</label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input value={query} onChange={e => searchUsers(e.target.value)} placeholder="Search by username…"
              className="w-full pl-9 pr-4 py-3 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30" />
            {searching && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin" />}
          </div>
          {results.length > 0 && (
            <div className="space-y-1">
              {results.map(u => (
                <button key={u.id} onClick={() => { setTarget(u); setResults([]); setQuery(''); }}
                  className="w-full flex items-center gap-3 p-3 rounded-xl border border-border hover:border-blue-500/30 hover:bg-blue-500/5 transition-all text-left">
                  <div className="w-10 h-10 rounded-full bg-muted overflow-hidden shrink-0 flex items-center justify-center font-bold text-sm">
                    {u.avatar_url ? <img src={u.avatar_url} alt={u.username} className="w-full h-full object-cover" /> : u.username[0]?.toUpperCase()}
                  </div>
                  <div className="flex-1 flex items-center gap-1">
                    <p className="font-bold text-sm">@{u.username}</p>
                    {u.verified && <UserCheck className="w-3.5 h-3.5 text-primary shrink-0" />}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center gap-3 p-3 bg-blue-500/5 border border-blue-500/20 rounded-2xl">
            <div className="w-10 h-10 rounded-full bg-muted overflow-hidden shrink-0 flex items-center justify-center font-bold">
              {target.avatar_url ? <img src={target.avatar_url} alt="" className="w-full h-full object-cover" /> : target.username[0]?.toUpperCase()}
            </div>
            <div className="flex-1"><p className="font-bold">@{target.username}</p><p className="text-xs text-muted-foreground">Will receive your request</p></div>
            <button onClick={() => setTarget(null)} className="p-1.5 rounded-full hover:bg-muted"><X className="w-3.5 h-3.5" /></button>
          </div>
          <div>
            <label className="text-sm font-semibold mb-2 block">Amount (optional)</label>
            <div className="grid grid-cols-4 gap-2 mb-2">
              {[1,5,10,25].map(a => (
                <button key={a} onClick={() => setAmount(String(a))}
                  className={`py-2.5 rounded-xl font-bold text-sm border-2 transition-all ${amount === String(a) ? 'border-blue-500 bg-blue-500/10 text-blue-600' : 'border-border hover:border-blue-500/30'}`}>${a}</button>
              ))}
            </div>
            <input type="number" min="0.01" step="0.01" placeholder="Custom amount (USD)…"
              value={amount && !['1','5','10','25'].includes(amount) ? amount : ''} onChange={e => setAmount(e.target.value)}
              className="w-full h-11 px-3 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30" />
          </div>
          <div>
            <label className="text-sm font-semibold mb-2 block">Note (optional)</label>
            <input type="text" maxLength={80} placeholder="What's it for?" value={note} onChange={e => setNote(e.target.value)}
              className="w-full h-11 px-3 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30" />
          </div>
          <button onClick={sendRequest} disabled={sending}
            className="w-full py-3.5 bg-blue-600 text-white rounded-xl font-bold text-base disabled:opacity-50 flex items-center justify-center gap-2 hover:opacity-90 transition-opacity">
            {sending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Bell className="w-5 h-5" />}
            {sending ? 'Sending request…' : `Request${amount && parseFloat(amount) > 0 ? ' ' + fmtAmt(parseFloat(amount), currency) : ''} from @${target.username}`}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Savings Pocket Tab ────────────────────────────────────────────────────
function SavingsPocketTab({ userId, mainBalance, savingsBalance, pinHash, currency, onRefresh }: {
  userId: string; mainBalance: number; savingsBalance: number;
  pinHash: string | null; currency: CurrencyCode; onRefresh: () => void;
}) {
  const [mode,      setMode]      = useState('idle' as 'idle' | 'deposit' | 'withdraw');
  const [amount,    setAmount]    = useState('');
  const [saving,    setSaving]    = useState(false);
  const [showPin,   setShowPin]   = useState(false);
  const [pendingOp, setPendingOp] = useState(null as 'in' | 'out' | null);
  const [history,   setHistory]   = useState([] as { type: 'in' | 'out'; amount: number; date: string }[]);
  const historyKey  = useMemo(() => `ts-pocket-hist-${userId}`, [userId]);
  const goalLinkKey  = useMemo(() => `ts-pocket-goal-${userId}`, [userId]);
  const [goals,        setGoals]        = useState([] as any[]);
  const [linkedGoalId, setLinkedGoalId] = useState(null as string | null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(historyKey);
      if (raw) setHistory(JSON.parse(raw));
    } catch { /* ignore */ }
  }, [historyKey]);

  useEffect(() => {
    supabase.from('wallet_savings_goals').select('id,name,emoji,current_amount,target_amount')
      .eq('user_id', userId).eq('is_completed', false)
      .order('created_at', { ascending: false })
      .then(({ data }) => setGoals(data ?? []));
  }, [userId]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(goalLinkKey);
      if (raw) setLinkedGoalId(raw);
    } catch { /* ignore */ }
  }, [goalLinkKey]);

  const addHistory = (type: 'in' | 'out', amt: number) => {
    const next = [{ type, amount: amt, date: new Date().toISOString() }, ...history].slice(0, 50);
    setHistory(next);
    localStorage.setItem(historyKey, JSON.stringify(next));
  };

  const executeTransfer = async (type: 'in' | 'out') => {
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) return;
    if (type === 'in'  && amt > mainBalance)    { toast.error('Insufficient wallet balance');  return; }
    if (type === 'out' && amt > savingsBalance) { toast.error('Insufficient savings balance'); return; }
    setSaving(true);
    const newMain    = parseFloat((type === 'in' ? mainBalance - amt : mainBalance + amt).toFixed(2));
    const newSavings = parseFloat((type === 'in' ? savingsBalance + amt : savingsBalance - amt).toFixed(2));
    const { error } = await supabase.rpc('wallet_move_savings', { p_amount: amt, p_direction: type });
    setSaving(false);
    if (error) { toast.error('Transfer failed'); return; }
    addHistory(type, amt);
    if (type === 'in' && linkedGoalId) {
      const { data: goal } = await supabase.from('wallet_savings_goals')
        .select('current_amount,target_amount,name').eq('id', linkedGoalId).eq('user_id', userId).maybeSingle();
      if (goal) {
        const prevAmt    = Number(goal.current_amount);
        const targetAmt  = Number(goal.target_amount);
        const newGoalAmt = Math.min(prevAmt + amt, targetAmt);
        const completed  = newGoalAmt >= targetAmt;
        await supabase.from('savings_goals')
          .update({ current_amount: newGoalAmt, is_completed: completed }).eq('id', linkedGoalId);
        if (completed) toast.success(`🎉 Goal "${goal.name}" completed!`);
        else toast.info(`Goal progress: ${fmtAmt(newGoalAmt, currency)} / ${fmtAmt(targetAmt, currency)}`);
        // Send milestone notifications
        const prevPct = targetAmt > 0 ? (prevAmt / targetAmt) * 100 : 0;
        const newPct  = targetAmt > 0 ? (newGoalAmt / targetAmt) * 100 : 0;
        const crossed = GOAL_MILESTONES.filter(m => prevPct < m && newPct >= m);
        for (const milestone of crossed) {
          const milEmoji = GOAL_MILESTONE_EMOJIS[milestone] ?? '🌟';
          supabase.from('platform_inbox').insert({
            user_id: userId,
            subject: `${milEmoji} Goal "${goal.name}" is ${milestone}% complete!`,
            body: `You've saved ${fmtAmt(newGoalAmt, currency)} of your ${fmtAmt(targetAmt, currency)} goal. ${
              milestone === 100 ? 'You did it — goal complete! 🎉' :
              milestone === 75  ? 'Almost there! Just 25% to go.' :
              milestone === 50  ? 'Halfway there! Keep it up.' :
                                  'Great start on your savings goal!'
            }`,
            type: 'system', icon_emoji: milEmoji,
            cta_label: 'View Goals', cta_url: '/wallet?tab=savings',
          }).then(() => {});
        }
      }
    }
    toast.success(type === 'in' ? `${fmtAmt(amt, currency)} moved to Savings Pocket` : `${fmtAmt(amt, currency)} returned to wallet`);
    setAmount(''); setMode('idle'); onRefresh();
  };

  const handleAction = (type: 'in' | 'out') => {
    if (pinHash) { setPendingOp(type); setShowPin(true); }
    else { executeTransfer(type); }
  };

  const handlePinConfirm = (pin: string) => {
    hashPin(pin).then(h => {
      setShowPin(false);
      if (h !== pinHash) { toast.error('Incorrect PIN'); return; }
      if (pendingOp) executeTransfer(pendingOp);
    });
  };

  const { savingsPct, streak } = useMemo(() => ({
    savingsPct: mainBalance + savingsBalance > 0
      ? Math.round((savingsBalance / (mainBalance + savingsBalance)) * 100) : 0,
    streak: history.filter(h => h.type === 'in').length,
  }), [mainBalance, savingsBalance, history]);

  return (
    <div className="space-y-5">
      {showPin && <PinEntryModal title="Confirm Transfer" onConfirm={handlePinConfirm} onCancel={() => setShowPin(false)} userId={userId} />}
      <div className="bg-gradient-to-br from-emerald-500/15 to-teal-400/5 border border-emerald-500/25 rounded-2xl p-5">
        <div className="flex items-start justify-between mb-3">
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Savings Pocket</p>
            <p className="text-4xl font-black text-emerald-600 mt-0.5">{fmtAmt(savingsBalance, currency)}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{savingsPct}% of total balance</p>
          </div>
          <div className="flex items-center gap-1 px-2.5 py-1 bg-emerald-500/10 border border-emerald-500/20 rounded-full">
            <Star className="w-3 h-3 text-emerald-600" />
            <span className="text-[10px] font-black text-emerald-700 dark:text-emerald-400">{streak} saves</span>
          </div>
        </div>
        <div className="space-y-1.5 mb-4">
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">Wallet: {fmtAmt(mainBalance, currency)}</span>
            <span className="text-emerald-600 font-semibold">Saved: {fmtAmt(savingsBalance, currency)}</span>
          </div>
          <div className="h-2 bg-muted rounded-full overflow-hidden">
            <div className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 rounded-full transition-all duration-500" style={{ width: `${savingsPct}%` }} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => { setMode(mode === 'deposit' ? 'idle' : 'deposit'); setAmount(''); }}
            className="flex items-center justify-center gap-1.5 py-2.5 bg-emerald-600 text-white rounded-xl font-bold text-sm hover:bg-emerald-700 transition-colors">
            <ArrowDownLeft className="w-4 h-4" /> Save Money
          </button>
          <button onClick={() => { setMode(mode === 'withdraw' ? 'idle' : 'withdraw'); setAmount(''); }}
            disabled={savingsBalance <= 0}
            className="flex items-center justify-center gap-1.5 py-2.5 border border-emerald-500/30 text-emerald-600 rounded-xl font-bold text-sm hover:bg-emerald-500/10 disabled:opacity-40 transition-colors">
            <ArrowUpRight className="w-4 h-4" /> Withdraw
          </button>
        </div>
      </div>
      {goals.length > 0 && (
        <div className="flex items-center gap-3 p-3.5 bg-muted/30 border border-border rounded-2xl">
          <Star className="w-4 h-4 text-emerald-600 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold">Link to Savings Goal</p>
            <select value={linkedGoalId ?? ''}
              onChange={e => {
                const val = e.target.value;
                setLinkedGoalId(val || null);
                if (val) localStorage.setItem(goalLinkKey, val);
                else localStorage.removeItem(goalLinkKey);
              }}
              className="w-full text-xs bg-transparent text-muted-foreground focus:outline-none mt-0.5">
              <option value="">None — pocket only</option>
              {goals.map(g => (
                <option key={g.id} value={g.id}>{g.emoji} {g.name} ({fmtAmt(Number(g.current_amount), currency)}/{fmtAmt(Number(g.target_amount), currency)})</option>
              ))}
            </select>
          </div>
        </div>
      )}
      {mode !== 'idle' && (
        <div className="p-4 border border-border rounded-2xl bg-card space-y-4">
          <h4 className="font-bold text-sm">{mode === 'deposit' ? 'Move to Savings Pocket' : 'Withdraw from Savings Pocket'}</h4>
          <p className="text-xs text-muted-foreground">
            {mode === 'deposit' ? `Available in wallet: ${fmtAmt(mainBalance, currency)}` : `Available in savings: ${fmtAmt(savingsBalance, currency)}`}
          </p>
          <div>
            <div className="grid grid-cols-4 gap-2 mb-2">
              {[1,5,10,25].map(a => (
                <button key={a} onClick={() => setAmount(String(a))}
                  className={`py-2.5 rounded-xl font-bold text-sm border-2 transition-all ${amount === String(a) ? 'border-emerald-600 bg-emerald-600/10 text-emerald-700 dark:text-emerald-400' : 'border-border hover:border-emerald-600/40'}`}>${a}</button>
              ))}
            </div>
            <input type="number" min="0.01" step="0.01" placeholder="Custom amount (USD)…"
              value={amount && !['1','5','10','25'].includes(amount) ? amount : ''} onChange={e => setAmount(e.target.value)}
              className="w-full h-11 px-3 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30" />
          </div>
          <div className="flex gap-2">
            <button onClick={() => { setMode('idle'); setAmount(''); }}
              className="flex-1 py-2.5 border border-border rounded-xl font-semibold text-sm hover:bg-muted">Cancel</button>
            <button onClick={() => handleAction(mode === 'deposit' ? 'in' : 'out')}
              disabled={saving || !amount || parseFloat(amount) <= 0}
              className="flex-1 py-2.5 bg-emerald-600 text-white rounded-xl font-bold text-sm disabled:opacity-50 flex items-center justify-center gap-2 hover:bg-emerald-700 transition-colors">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : mode === 'deposit' ? <ArrowDownLeft className="w-4 h-4" /> : <ArrowUpRight className="w-4 h-4" />}
              {saving ? 'Processing…' : mode === 'deposit' ? 'Save' : 'Withdraw'}
            </button>
          </div>
        </div>
      )}
      {history.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Recent Activity</p>
          {history.slice(0, 10).map((h, i) => (
            <div key={i} className="flex items-center gap-3 p-3 border border-border rounded-xl bg-card">
              <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${h.type === 'in' ? 'bg-emerald-500/10' : 'bg-orange-500/10'}`}>
                {h.type === 'in' ? <ArrowDownLeft className="w-4 h-4 text-emerald-600" /> : <ArrowUpRight className="w-4 h-4 text-orange-600" />}
              </div>
              <div className="flex-1">
                <p className="font-semibold text-sm">{h.type === 'in' ? 'Saved to pocket' : 'Withdrawn'}</p>
                <p className="text-xs text-muted-foreground">{new Date(h.date).toLocaleDateString()}</p>
              </div>
              <p className={`font-black text-sm ${h.type === 'in' ? 'text-emerald-600' : 'text-orange-600'}`}>
                {h.type === 'in' ? '+' : '-'}{fmtAmt(h.amount, currency)}
              </p>
            </div>
          ))}
        </div>
      )}
      {history.length === 0 && (
        <div className="text-center py-8">
          <div className="w-14 h-14 rounded-full bg-emerald-500/10 flex items-center justify-center mx-auto mb-3">
            <ArrowDownLeft className="w-7 h-7 text-emerald-600" />
          </div>
          <p className="font-semibold text-sm">No savings activity yet</p>
          <p className="text-xs text-muted-foreground mt-1">Start by moving money from your wallet into the Savings Pocket</p>
        </div>
      )}
      <div className="p-4 bg-muted/30 border border-border rounded-2xl text-xs text-muted-foreground">
        <p><strong>Savings Pocket</strong> keeps funds separate from your spending balance. Withdraw any time with no restrictions.</p>
      </div>
    </div>
  );
}

// ── Wallet Search Shortcut ───────────────────────────────────────────────
function WalletSearchShortcut({ onNavigate }: { onNavigate: (tab: ActiveTab) => void }) {
  const [open,  setOpen]  = useState(false);
  const [query, setQuery] = useState('');
  const inputRef = useRef(null as HTMLInputElement | null);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 60);
  }, [open]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return SEARCH_COMMANDS;
    return SEARCH_COMMANDS.filter(c =>
      c.label.toLowerCase().includes(q) ||
      c.hint.toLowerCase().includes(q) ||
      c.keywords.some(k => k.includes(q))
    );
  }, [query]);

  const handleSelect = (tab: ActiveTab) => {
    onNavigate(tab);
    setOpen(false);
    setQuery('');
  };

  return (
    <>
      <button onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-border bg-muted/40 text-muted-foreground hover:bg-muted transition-colors text-xs font-semibold">
        <Search className="w-3.5 h-3.5" />
        <span>Search…</span>
        <kbd className="text-[9px] px-1 py-0.5 bg-background border border-border rounded leading-none">⌘K</kbd>
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-16 px-4 bg-black/60 backdrop-blur-sm"
          onClick={() => { setOpen(false); setQuery(''); }}>
          <div className="bg-card border border-border rounded-2xl w-full max-w-md shadow-2xl overflow-hidden"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
              <Search className="w-4 h-4 text-muted-foreground shrink-0" />
              <input ref={inputRef} value={query} onChange={e => setQuery(e.target.value)}
                placeholder="Search features… (e.g. 'send', 'goals', 'security')"
                className="flex-1 bg-transparent text-sm focus:outline-none placeholder:text-muted-foreground"
                onKeyDown={e => {
                  if (e.key === 'Escape') { setOpen(false); setQuery(''); }
                  if (e.key === 'Enter' && matches.length > 0) handleSelect(matches[0].tab);
                }} />
              <button onClick={() => { setOpen(false); setQuery(''); }} className="text-muted-foreground hover:text-foreground">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="max-h-80 overflow-y-auto divide-y divide-border">
              {matches.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-6">No results for "{query}"</p>
              ) : (
                matches.map(cmd => (
                  <button key={cmd.tab} onClick={() => handleSelect(cmd.tab)}
                    className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-muted/60 transition-colors text-left">
                    <span className="text-xl w-8 text-center shrink-0">{cmd.emoji}</span>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm">{cmd.label}</p>
                      <p className="text-xs text-muted-foreground">{cmd.hint}</p>
                    </div>
                    <ChevronDown className="w-3.5 h-3.5 text-muted-foreground -rotate-90 shrink-0" />
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ── Referral Leaderboard ─────────────────────────────────────────────────
function ReferralLeaderboard({ userId }: { userId: string }) {
  const [leaders, setLeaders] = useState([] as { uid: string; username: string; avatarUrl: string | null; count: number }[]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const { data: allRefs } = await supabase
        .from('referrals')
        .select('invited_by')
        .limit(500);
      const counts: any = {};
      (allRefs ?? []).forEach((r: any) => { counts[r.invited_by] = (counts[r.invited_by] ?? 0) + 1; });
      const top10 = Object.entries(counts as Record<string, number>).sort((a, b) => b[1] - a[1]).slice(0, 10);
      if (top10.length === 0) { setLeaders([]); setLoading(false); return; }
      const { data: profiles } = await supabase.from('profiles')
        .select('id,username,avatar_url').in('id', top10.map(([id]) => id));
      const pm: any = {};
      (profiles ?? []).forEach((p: any) => { pm[p.id] = p; });
      setLeaders(top10.map(([uid, count]) => ({
        uid, count: Number(count),
        username: pm[uid]?.username ?? 'Unknown',
        avatarUrl: pm[uid]?.avatar_url ?? null,
      })));
      setLoading(false);
    };
    load();
  }, []);

  if (!loading && leaders.length === 0) return null;

  return (
    <div className="border border-border rounded-2xl overflow-hidden">
      <div className="px-4 py-3 flex items-center gap-2 border-b border-border">
        <TrendingUp className="w-4 h-4 text-primary" />
        <h3 className="font-bold text-sm">Top Referrers</h3>
        <span className="text-[10px] text-muted-foreground ml-auto">All time</span>
      </div>
      {loading ? (
        <div className="flex justify-center p-4"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>
      ) : (
        <div className="divide-y divide-border">
          {leaders.map((l, i) => (
            <div key={l.uid} className={`flex items-center gap-3 px-4 py-3 ${l.uid === userId ? 'bg-primary/5' : ''}`}>
              <div className="w-7 text-center shrink-0">
                {i < 3
                  ? <span className="text-lg">{RANK_BADGES[i]}</span>
                  : <span className="text-xs font-black text-muted-foreground">#{i + 1}</span>}
              </div>
              <div className="w-9 h-9 rounded-full bg-muted overflow-hidden shrink-0 flex items-center justify-center font-bold text-sm">
                {l.avatarUrl
                  ? <img src={l.avatarUrl} alt={l.username} className="w-full h-full object-cover" />
                  : l.username?.[0]?.toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-sm truncate">@{l.username}</p>
                {l.uid === userId && <span className="text-[10px] text-primary font-semibold">You</span>}
              </div>
              <div className="text-right shrink-0">
                <p className="font-black text-base text-primary">{l.count}</p>
                <p className="text-[10px] text-muted-foreground">referral{l.count !== 1 ? 's' : ''}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Module-level tab config ───────────────────────────────────────────────
const WALLET_TABS: { key: ActiveTab; label: string }[] = [
  { key: 'wallet',    label: '💳 Wallet'    },
  { key: 'pocket',    label: '💰 Savings'   },
  { key: 'send',      label: '💸 Send'      },
  { key: 'receive',   label: '📥 Receive'   },
  { key: 'mpesa',     label: '📱 M-Pesa'    },
  { key: 'history',   label: '📋 History'   },
  { key: 'analytics', label: '📊 Analytics' },
  { key: 'referrals', label: '👥 Referrals' },
  { key: 'scheduled', label: '⏰ Scheduled' },
  { key: 'savings',   label: '🎯 Goals'     },
  { key: 'reminders', label: '🔔 Reminders' },
  { key: 'security',  label: '🔒 Security'  },
  { key: 'converter', label: '💱 Convert'   },
];

function WalletAdBanner() { return <PageAdBanner />; }

export default function WalletPage() {
  useSEO({ noindex: true, title: 'Wallet', url: '/wallet' });
  const { user }                = useAuth();
  const { wallet, fetchWallet } = useWallet();
  const [showTour, setShowTour] = useState(false);

  useEffect(() => {
    if (!user) return;
    try {
      const toured = localStorage.getItem(`ts-wallet-toured-${user.id}`);
      if (!toured) setShowTour(true);
    } catch { /* ignore */ }
  }, [user]);

  const [searchParams] = useSearchParams();

  const [activeTab, setActiveTab] = useState(() => {
    const t = searchParams.get('tab');
    if (t === 'send')      return 'send';
    if (t === 'history')   return 'history';
    if (t === 'analytics') return 'analytics';
    if (t === 'receive')   return 'receive';
    if (t === 'referrals') return 'referrals';
    if (t === 'scheduled') return 'scheduled';
    if (t === 'savings')   return 'savings';
    if (t === 'reminders') return 'reminders';
    if (t === 'security')  return 'security';
    if (t === 'converter') return 'converter';
    if (t === 'pocket')    return 'pocket';
    if (t === 'mpesa')     return 'mpesa';
    return 'wallet' as ActiveTab;
  });
  const prefillTo = searchParams.get('to') ?? '';

  // ── Inactivity auto-lock ────────────────────────────────────────────
  const inactivityRef = useRef(null as ReturnType<typeof setTimeout> | null);
  useEffect(() => {
    if (!user) return;
    const lockMins = parseInt(localStorage.getItem(`ts-inactivity-mins-${user.id}`) ?? '0', 10);
    if (!lockMins) return;
    const resetTimer = () => {
      if (inactivityRef.current) clearTimeout(inactivityRef.current);
      inactivityRef.current = setTimeout(() => {
        localStorage.setItem(`ts-wallet-locked-${user.id}`, '1');
        toast.warning('Wallet locked due to inactivity');
      }, lockMins * 60000);
    };
    const onActivity = () => resetTimer();
    window.addEventListener('mousemove', onActivity);
    window.addEventListener('keydown',   onActivity);
    window.addEventListener('touchstart', onActivity);
    const onVisible = () => { if (!document.hidden) resetTimer(); };
    document.addEventListener('visibilitychange', onVisible);
    resetTimer();
    return () => {
      if (inactivityRef.current) clearTimeout(inactivityRef.current);
      window.removeEventListener('mousemove', onActivity);
      window.removeEventListener('keydown',   onActivity);
      window.removeEventListener('touchstart', onActivity);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [user]);

  const twoFaActionRef = useRef(null as (() => void) | null);
  const [twoFaModal, setTwoFaModal] = useState(null as { code: string; expiry: number } | null);

  const checkAndExecuteWithdraw = async () => {
    if (!user) return;
    try {
      const raw2fa = localStorage.getItem(`ts-2fa-${user.id}`);
      if (raw2fa) {
        const settings = JSON.parse(raw2fa);
        const usdAmt = parseFloat(wKes) / USD_TO_KES;
        if (settings.enabled && usdAmt >= settings.threshold) {
          const otp    = String(Math.floor(100000 + Math.random() * 900000));
          const expiry = Date.now() + WALLET_EXTRAS_OTP_EXPIRY_MS;
          await supabase.from('platform_inbox').insert({
            user_id: user.id,
            subject: `Wallet Verification Code: ${otp}`,
            body: `Your one-time withdrawal code is: ${otp}. Valid for 5 minutes. Confirms KES ${parseInt(wKes).toLocaleString()} withdrawal.`,
            type: 'system', icon_emoji: '🔐',
          });
          twoFaActionRef.current = executeWithdraw;
          setTwoFaModal({ code: otp, expiry });
          return;
        }
      }
    } catch { /* proceed without 2FA */ }
    executeWithdraw();
  };

  const [showSplit,       setShowSplit]       = useState(false);
  const [showInstallment, setShowInstallment] = useState(false);
  const [showDepositPin,  setShowDepositPin]  = useState(false);
  const [currency,  setCurrency]  = useState('USD' as CurrencyCode);

  useEffect(() => {
    const pref = (wallet as any)?.preferred_currency;
    if (pref && ['USD','KES','EUR'].includes(pref)) setCurrency(pref as CurrencyCode);
  }, [wallet]);

  const handleCurrencyChange = async (c: CurrencyCode) => {
    setCurrency(c);
    if (user) await supabase.from('user_wallets').update({ preferred_currency: c }).eq('user_id', user.id);
  };

  const pinHash: string | null               = (wallet as any)?.wallet_pin_hash         ?? null;
  const biometricCredentialId: string | null  = (wallet as any)?.biometric_credential_id ?? null;
  const [showPinModal, setShowPinModal]       = useState(false);

  const [phone,    setPhone]    = useState('');
  const [amount,   setAmount]   = useState('');
  const [step,     setStep]     = useState('idle' as TopUpStep);
  const [pollSecs, setPollSecs] = useState(0);
  const [pollMsg,  setPollMsg]  = useState('');
  const [showTopUp, setShowTopUp] = useState(false);
  const pollRef = useRef(null as ReturnType<typeof setInterval> | null);

  const [wPhone,    setWPhone]    = useState('');
  const [wKes,      setWKes]      = useState('');
  const [wStep,     setWStep]     = useState('idle' as WithdrawStep);
  const [wPollSecs, setWPollSecs] = useState(0);
  const [wPollMsg,  setWPollMsg]  = useState('');
  const [showWithdraw, setShowWithdraw] = useState(false);
  const wPollRef = useRef(null as ReturnType<typeof setInterval> | null);

  const [lastTopUpAmount, setLastTopUpAmount] = useState(null as number | null);
  const balancePollRef = useRef(null as ReturnType<typeof setInterval> | null);

  useEffect(() => {
    if (wallet?.mpesa_phone) {
      if (!phone)  setPhone(wallet.mpesa_phone);
      if (!wPhone) setWPhone(wallet.mpesa_phone);
    }
  }, [wallet]);

  useEffect(() => { if (user) fetchLastTopUp(); }, [user]);

  useEffect(() => {
    return () => {
      if (pollRef.current)        clearInterval(pollRef.current);
      if (wPollRef.current)       clearInterval(wPollRef.current);
      if (balancePollRef.current) clearInterval(balancePollRef.current);
    };
  }, []);

  const fetchLastTopUp = async () => {
    if (!user) return;
    const { data } = await supabase.from('wallet_transactions').select('amount')
      .eq('user_id', user.id).eq('type', 'deposit').order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (data) setLastTopUpAmount(Number(data.amount));
  };

  const startBalancePoll = () => {
    if (balancePollRef.current) clearInterval(balancePollRef.current);
    balancePollRef.current = setInterval(async () => { await fetchWallet(); }, 8000);
  };
  const stopBalancePoll = () => {
    if (balancePollRef.current) { clearInterval(balancePollRef.current); balancePollRef.current = null; }
  };

  const startPoll = (checkoutId: string, depositUsd: number) => {
    let elapsed = 0;
    setPollSecs(0); setPollMsg('Check your phone and enter your M-Pesa PIN…');
    setStep('polling'); startBalancePoll();
    pollRef.current = setInterval(async () => {
      elapsed += 3; setPollSecs(elapsed);
      if (elapsed >= 120) {
        clearInterval(pollRef.current!); stopBalancePoll(); await fetchWallet();
        setStep('failed'); setPollMsg('Timed out. If you paid, funds will appear shortly.'); return;
      }
      try {
        const { data } = await supabase.functions.invoke('mpesa-stk-status', { body: { checkout_request_id: checkoutId } });
        if (data?.status === 'completed') {
          // Wallet already credited by mpesa-callback edge function — just refresh balance
          clearInterval(pollRef.current!); stopBalancePoll();
          await fetchWallet(); setLastTopUpAmount(depositUsd); setStep('success');
          setPollMsg(`KES ${Math.ceil(depositUsd * USD_TO_KES).toLocaleString()} received! Wallet topped up.`);
          toast.success(`+${fmtAmt(depositUsd, currency)} added to wallet`); setAmount('');
        } else if (data?.status === 'failed' || data?.status === 'cancelled') {
          clearInterval(pollRef.current!); stopBalancePoll(); await fetchWallet();
          setStep('failed'); setPollMsg('Payment cancelled or failed. Please try again.');
        } else { await fetchWallet(); }
      } catch { /* keep polling */ }
    }, 3000);
  };

  const handleDepositClick = () => {
    if (biometricCredentialId) {
      verifyBiometric(biometricCredentialId).then(ok => {
        if (ok) { handleTopUp(); } else if (pinHash) { setShowDepositPin(true); } else { handleTopUp(); }
      });
    } else if (pinHash) { setShowDepositPin(true); } else { handleTopUp(); }
  };

  const handleTopUp = async () => {
    if (!user) return;
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) { toast.error('Enter a valid amount'); return; }
    if (phone.replace(/\D/g,'').length < 9) { toast.error('Enter a valid M-Pesa number'); return; }
    setStep('sending');
    try {
      const kesAmount = Math.ceil(amt * USD_TO_KES);
      const { data, error } = await supabase.functions.invoke('mpesa-stk-push', {
        body: { phone, amount: kesAmount, purpose: 'wallet_topup', metadata: { wallet_id: wallet?.id, user_id: user.id } },
      });
      if (error) {
        let msg = error.message;
        if (error instanceof FunctionsHttpError) { try { msg = (await error.context?.text()) || msg; } catch { /* */ } }
        throw new Error(msg);
      }
      toast.success(data.customer_message || 'STK Push sent — check your phone!');
      startPoll(data.checkout_request_id, parseFloat(amount));
    } catch (err: any) {
      setStep('failed'); setPollMsg(err.message || 'Failed to initiate top-up.'); toast.error(err.message || 'Failed to initiate top-up');
    }
  };

  const resetTopUp = () => {
    if (pollRef.current) clearInterval(pollRef.current); stopBalancePoll();
    setStep('idle'); setPollMsg(''); setPollSecs(0);
  };

  const resetWithdraw = () => {
    if (wPollRef.current) clearInterval(wPollRef.current); stopBalancePoll();
    setWStep('idle'); setWPollMsg(''); setWPollSecs(0);
  };

  const executeWithdraw = async () => {
    if (!user) return;
    const kesAmt = parseFloat(wKes);
    if (!kesAmt || kesAmt < 10) { toast.error('Minimum withdrawal is KES 10'); return; }
    const usdAmt  = kesAmt / USD_TO_KES;
    const balance = Number(wallet?.balance ?? 0);
    if (usdAmt > balance) { toast.error(`Insufficient balance — ${fmtAmt(balance, currency)} available`); return; }
    if (wPhone.replace(/\D/g,'').length < 9) { toast.error('Enter a valid M-Pesa number'); return; }
    setWStep('sending');
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token      = sessionData.session?.access_token;
      const backendUrl = import.meta.env.VITE_SUPABASE_URL;
      await fetchWallet();
      const res     = await fetch(`${backendUrl}/functions/v1/mpesa-b2c-payout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ phone: wPhone, amount: Math.floor(kesAmt), purpose: 'creator_payout' }),
      });
      const payload = await res.json();
      if (!res.ok || !payload.success) throw new Error(payload.error || 'B2C request failed');
      toast.success('Payout initiated — check your phone!');
      const convId = payload.conversation_id;
      await supabase.rpc('deduct_from_wallet', { p_user_id: user.id, p_amount: usdAmt });
      await fetchWallet(); startBalancePoll();
      let elapsed = 0; setWPollSecs(0); setWPollMsg('Your M-Pesa payment is on its way…'); setWStep('polling');
      wPollRef.current = setInterval(async () => {
        elapsed += 3; setWPollSecs(elapsed); await fetchWallet();
        if (elapsed >= 120) {
          clearInterval(wPollRef.current!); stopBalancePoll(); setWStep('success');
          setWPollMsg(`KES ${Math.floor(kesAmt).toLocaleString()} is being sent to your M-Pesa.`); return;
        }
        const { data: txn } = await supabase.from('mpesa_transactions').select('status')
          .eq('checkout_request_id', convId).order('created_at', { ascending: false }).limit(1).maybeSingle();
        if (txn?.status === 'completed' || txn?.status === 'success') {
          clearInterval(wPollRef.current!); stopBalancePoll(); await fetchWallet();
          setWStep('success'); setWPollMsg(`KES ${Math.floor(kesAmt).toLocaleString()} sent to your M-Pesa!`);
          toast.success('Withdrawal complete!');
        } else if (txn?.status === 'failed') {
          clearInterval(wPollRef.current!); stopBalancePoll();
          await supabase.rpc('add_to_wallet', { p_user_id: user.id, p_amount: usdAmt }); await fetchWallet();
          setWStep('failed'); setWPollMsg('Payout failed — balance restored.'); toast.error('Payout failed. Balance restored.');
        }
      }, 3000);
    } catch (err: any) {
      setWStep('failed'); setWPollMsg(err.message || 'Withdrawal failed. Try again.'); toast.error(err.message || 'Withdrawal failed');
    }
  };

  const handleWithdrawClick = () => {
    if (biometricCredentialId) {
      verifyBiometric(biometricCredentialId).then(ok => {
        if (ok) { checkAndExecuteWithdraw(); } else if (pinHash) { setShowPinModal(true); } else { checkAndExecuteWithdraw(); }
      });
    } else if (pinHash) { setShowPinModal(true); } else { checkAndExecuteWithdraw(); }
  };

  const handleWithdrawPinConfirm = async (pin: string) => {
    const entered = await hashPin(pin); setShowPinModal(false);
    if (entered !== pinHash) { toast.error('Incorrect PIN'); return; }
    checkAndExecuteWithdraw();
  };

  const [sendMode, setSendMode] = useState('send' as SendMode);

  const { walletBalance, username, totalDeposited, savingsBalance } = useMemo(() => ({
    walletBalance:  Number(wallet?.balance ?? 0),
    username:       user?.username ?? user?.email?.split('@')[0] ?? 'me',
    totalDeposited: Number((wallet as any)?.total_deposited ?? 0),
    savingsBalance: Number((wallet as any)?.savings_balance ?? 0),
  }), [wallet, user]);

  return (
    <div className="min-h-screen bg-background pb-16 md:pb-0">
      {showPinModal && <PinEntryModal title="Confirm Withdrawal" onConfirm={handleWithdrawPinConfirm} onCancel={() => setShowPinModal(false)} userId={user?.id} />}
      {twoFaModal && (
        <TwoFAModal
          code={twoFaModal.code}
          expiry={twoFaModal.expiry}
          onVerified={() => { setTwoFaModal(null); if (twoFaActionRef.current) twoFaActionRef.current(); }}
          onCancel={() => setTwoFaModal(null)}
        />
      )}
      {showDepositPin && <PinEntryModal title="Confirm Deposit" onConfirm={async (pin) => { const h = await hashPin(pin); setShowDepositPin(false); if (h !== pinHash) { toast.error('Incorrect PIN'); return; } handleTopUp(); }} onCancel={() => setShowDepositPin(false)} userId={user?.id} />}
      {showSplit && user && (
        <SplitPaymentPanel userId={user.id} senderUsername={username} walletBalance={walletBalance} pinHash={pinHash} currency={currency} onClose={() => setShowSplit(false)} />
      )}
      {showInstallment && user && (
        <InstallmentPanel userId={user.id} walletBalance={walletBalance} pinHash={pinHash} currency={currency} onClose={() => setShowInstallment(false)} />
      )}

      <TopBar title="My Wallet" showBack />
      <WalletAdBanner />
      <div className="max-w-2xl mx-auto px-4 pt-2 pb-1 flex justify-end">
        <WalletSearchShortcut onNavigate={setActiveTab} />
      </div>

      <div className="sticky top-14 z-30 bg-background/95 backdrop-blur-sm border-b border-border">
        <div className="flex max-w-2xl mx-auto overflow-x-auto scrollbar-hide">
          {WALLET_TABS.map(t => (
            <button key={t.key} onClick={() => setActiveTab(t.key)}
              className={`flex-shrink-0 flex-1 py-3 font-semibold text-xs border-b-2 transition-colors whitespace-nowrap px-1 ${
                activeTab === t.key ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:bg-muted/40'
              }`}>
              {t.label}
              {t.key === 'wallet' && lastTopUpAmount !== null && (
                <span className="ml-1 text-[8px] font-black bg-green-500 text-white px-1 py-0.5 rounded-full leading-none align-top mt-0.5 inline-block">
                  +${lastTopUpAmount.toFixed(0)}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="max-w-2xl mx-auto p-4 space-y-5">
        {activeTab === 'mpesa'     && user && <MpesaFullTab userId={user.id} currency={currency} wallet={wallet} onSaved={fetchWallet} />}
        {activeTab === 'history'   && user && <TransactionHistoryTab userId={user.id} currency={currency} />}
        {activeTab === 'pocket' && user && (
          <SavingsPocketTab userId={user.id} mainBalance={walletBalance} savingsBalance={savingsBalance}
            pinHash={pinHash} currency={currency} onRefresh={fetchWallet} />
        )}
        {activeTab === 'send' && user && (
          <div className="space-y-4">
            <div className="flex gap-1 bg-muted rounded-xl p-1">
              <button onClick={() => setSendMode('send')}
                className={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                  sendMode === 'send' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'
                }`}>💸 Send</button>
              <button onClick={() => setSendMode('request')}
                className={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                  sendMode === 'request' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'
                }`}>🙏 Request</button>
              <button onClick={() => setSendMode('mpesa-direct')}
                className={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                  sendMode === 'mpesa-direct' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'
                }`}>📲 M-Pesa</button>
            </div>
            {sendMode === 'send' && (
              <SendMoneyTab userId={user.id} senderUsername={username} walletBalance={walletBalance}
                pinHash={pinHash} biometricCredentialId={biometricCredentialId} onComplete={fetchWallet}
                prefillUsername={prefillTo} currency={currency} />
            )}
            {sendMode === 'request' && (
              <RequestMoneyPanel userId={user.id} senderUsername={username} currency={currency} />
            )}
            {sendMode === 'mpesa-direct' && (
              <DirectMpesaSendPanel userId={user.id} walletBalance={walletBalance}
                pinHash={pinHash} currency={currency} onComplete={fetchWallet} />
            )}
          </div>
        )}
        {activeTab === 'receive'   && user && <ReceiveMoneyTab username={username} walletBalance={walletBalance} currency={currency} />}
        {activeTab === 'analytics' && user && (
          <>
            <FriendBalanceComparison savingsBalance={savingsBalance} totalDeposited={totalDeposited} currency={currency} />
            <WalletBudgetPlanner userId={user.id} currency={currency} />
            <P2PBalanceChart userId={user.id} currency={currency} />
            <MonthlyHeatmapCalendar userId={user.id} currency={currency} />
            <ActivityHeatmap userId={user.id} />
            <WalletAnalyticsExportButton userId={user.id} currency={currency} />
            <SpendingAnalyticsTab userId={user.id} currency={currency} />
          </>
        )}
        {activeTab === 'referrals' && user && (
          <div className="space-y-5">
            <ReferralEarningsTab userId={user.id} />
            <FriendActivityFeed userId={user.id} />
          </div>
        )}
        {activeTab === 'scheduled' && user && <ScheduledTransfersTab userId={user.id} currency={currency} pinHash={pinHash} />}
        {activeTab === 'savings'   && user && <SavingsGoalsTab userId={user.id} walletBalance={walletBalance} currency={currency} />}
        {activeTab === 'reminders' && user && <TransactionRemindersTab userId={user.id} currency={currency} />}
        {activeTab === 'security'  && user && (
          <>
            <PinSecurityDashboard userId={user.id} pinHash={pinHash} credentialId={biometricCredentialId} onRefresh={fetchWallet} />
            <TwoFASetupCard userId={user.id} />
            <InactivityLockCard userId={user.id} />
          </>
        )}
        {activeTab === 'converter' && <CurrencyConverterWidget />}
      </div>

      {activeTab === 'wallet' && (
        <div className="max-w-2xl mx-auto p-4 space-y-5">
        {showTour && user && (
          <WalletOnboardingTour
            userId={user.id}
            onNavigate={tab => { setActiveTab(tab); setShowTour(false); }}
            onDismiss={() => setShowTour(false)}
          />
        )}
        <div className="bg-gradient-to-br from-primary/10 to-purple-500/5 border border-primary/20 rounded-2xl p-5">
            <div className="flex items-start justify-between mb-1">
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold text-muted-foreground">Wallet Balance</p>
                <LoyaltyBadge totalDeposited={totalDeposited} />
              </div>
              <CurrencyBadge currency={currency} onChange={handleCurrencyChange} />
            </div>
            <p className="text-4xl font-black mt-1">{fmtAmt(walletBalance, currency)}</p>
            <p className="text-sm text-muted-foreground mt-0.5">≈ {fmtAmt(walletBalance, currency === 'KES' ? 'USD' : 'KES')}</p>
            {lastTopUpAmount !== null && (
              <p className="text-xs text-green-600 font-semibold mt-1 flex items-center gap-1">
                <TrendingUp className="w-3 h-3" /> Last top-up +{fmtAmt(lastTopUpAmount, currency)}
              </p>
            )}
            <div className="grid grid-cols-3 gap-2 mt-4">
              <button onClick={() => setActiveTab('receive')} className="flex items-center justify-center gap-1.5 py-2 bg-primary/10 border border-primary/20 rounded-xl text-primary font-semibold text-xs hover:bg-primary/15 transition-colors">
                <QrCode className="w-3.5 h-3.5" /> Receive
              </button>
              <button onClick={() => setActiveTab('send')} className="flex items-center justify-center gap-1.5 py-2 bg-primary text-primary-foreground rounded-xl font-semibold text-xs hover:opacity-90 transition-opacity">
                <Send className="w-3.5 h-3.5" /> Send
              </button>
              <button onClick={() => setShowSplit(true)} className="flex items-center justify-center gap-1.5 py-2 bg-blue-500/10 border border-blue-500/20 rounded-xl text-blue-600 font-semibold text-xs hover:bg-blue-500/15 transition-colors">
                <Star className="w-3.5 h-3.5" /> Split
              </button>
              <button onClick={() => setShowInstallment(true)} className="flex items-center justify-center gap-1.5 py-2 bg-amber-500/10 border border-amber-500/20 rounded-xl text-amber-600 font-semibold text-xs hover:bg-amber-500/15 transition-colors">
                <Calendar className="w-3.5 h-3.5" /> Pay Later
              </button>
              <button onClick={() => setActiveTab('referrals')} className="flex items-center justify-center gap-1.5 py-2 bg-purple-500/10 border border-purple-500/20 rounded-xl text-purple-600 font-semibold text-xs hover:bg-purple-500/15 transition-colors">
                <Users className="w-3.5 h-3.5" /> Refer
              </button>
              <button onClick={() => setActiveTab('security')} className="flex items-center justify-center gap-1.5 py-2 bg-red-500/10 border border-red-500/20 rounded-xl text-red-500 font-semibold text-xs hover:bg-red-500/15 transition-colors">
                <Lock className="w-3.5 h-3.5" /> Security
              </button>
            </div>
            <button onClick={() => setActiveTab('pocket')}
              className="w-full flex items-center justify-between gap-2 py-2.5 px-3 mt-1 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-emerald-700 dark:text-emerald-400 font-semibold text-xs hover:bg-emerald-500/15 transition-colors">
              <div className="flex items-center gap-1.5"><ArrowDownLeft className="w-3.5 h-3.5" /> Savings Pocket</div>
              <span className="font-black text-sm">{fmtAmt(savingsBalance, currency)}</span>
            </button>
          </div>

          {/* Deposit */}
          <div className="bg-gradient-to-br from-green-600/10 via-emerald-500/5 to-transparent border border-green-600/20 rounded-2xl overflow-hidden">
            <button onClick={() => { resetTopUp(); setShowTopUp(v => !v); }} className="w-full flex items-center gap-3 px-5 py-4 hover:bg-green-500/5 transition-colors">
              <div className="w-10 h-10 rounded-full bg-green-600/15 flex items-center justify-center shrink-0"><Zap className="w-5 h-5 text-green-600" /></div>
              <div className="flex-1 text-left">
                <p className="font-bold text-base">Deposit via M-Pesa</p>
                <p className="text-xs text-muted-foreground">STK Push — funds credited after payment</p>
              </div>
              <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-transform ${showTopUp ? 'border-green-600 rotate-45' : 'border-muted-foreground/40'}`}>
                <span className="text-lg leading-none text-muted-foreground">+</span>
              </div>
            </button>
            {showTopUp && (
              <div className="px-5 pb-5 space-y-4 border-t border-green-600/15 pt-4">
                {(step === 'idle' || step === 'failed') && (
                  <>
                    {step === 'failed' && pollMsg && (
                      <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2.5 text-sm text-red-600">
                        <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" /><span>{pollMsg}</span>
                      </div>
                    )}
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide">Select Amount</p>
                      <div className="grid grid-cols-4 gap-2 mb-2">
                        {[{ kes: 100 }, { kes: 500 }, { kes: 1000 }, { kes: 5000 }].map(({ kes }) => {
                          const usd = kes / USD_TO_KES;
                          const val = usd.toFixed(2);
                          return (
                            <button key={kes} onClick={() => setAmount(val)}
                              className={`py-2.5 rounded-xl font-bold text-xs border-2 transition-all flex flex-col items-center ${amount === val ? 'border-green-600 bg-green-600/10 text-green-700 dark:text-green-400' : 'border-border hover:border-green-600/40'}`}>
                              <span className="text-[11px] font-black">KES {kes.toLocaleString()}</span>
                              <span className="text-[9px] opacity-60">${usd.toFixed(2)}</span>
                            </button>
                          );
                        })}
                      </div>
                      <Input type="number" min="1" step="0.01" placeholder="Custom USD amount…" value={amount} onChange={e => setAmount(e.target.value)} className="h-11" />
                      {amount && parseFloat(amount) > 0 && <p className="text-xs text-green-600 font-semibold mt-1">≈ KES {Math.ceil(parseFloat(amount) * USD_TO_KES).toLocaleString()}</p>}
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide flex items-center gap-1.5"><Phone className="w-3 h-3" />M-Pesa Number</p>
                      <Input type="tel" placeholder="0712 345 678" value={phone} onChange={e => setPhone(e.target.value)} className="h-11" />
                    </div>
                    <button onClick={handleDepositClick} disabled={!amount || !phone || parseFloat(amount) <= 0}
                      className="w-full py-3.5 bg-gradient-to-r from-green-600 to-emerald-500 text-white rounded-xl font-bold text-base disabled:opacity-50 flex items-center justify-center gap-2 hover:opacity-90 transition-opacity">
                      <Smartphone className="w-5 h-5" />
                      Request KES {amount && parseFloat(amount) > 0 ? Math.ceil(parseFloat(amount) * USD_TO_KES).toLocaleString() : '—'}
                    </button>
                  </>
                )}
                {step === 'sending' && <div className="flex flex-col items-center gap-3 py-6"><Loader2 className="w-10 h-10 animate-spin text-green-600" /><p className="font-semibold text-sm">Sending M-Pesa request…</p></div>}
                {step === 'polling' && (
                  <div className="flex flex-col items-center gap-4 py-4">
                    <div className="w-16 h-16 rounded-full bg-green-600/10 flex items-center justify-center"><Clock className="w-8 h-8 text-green-600 animate-pulse" /></div>
                    <div className="text-center">
                      <p className="font-bold text-green-700 dark:text-green-400">Awaiting M-Pesa PIN…</p>
                      <p className="text-sm text-muted-foreground mt-1">{pollMsg}</p>
                      <p className="text-xs text-muted-foreground">{pollSecs}s · checking every 3s</p>
                    </div>
                    <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
                      <div className="h-full bg-gradient-to-r from-green-500 to-emerald-400 rounded-full transition-all duration-1000" style={{ width: `${Math.min((pollSecs / 90) * 100, 100)}%` }} />
                    </div>
                    <button onClick={resetTopUp} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-destructive"><X className="w-3.5 h-3.5" /> Cancel</button>
                  </div>
                )}
                {step === 'success' && (
                  <div className="flex flex-col items-center gap-3 py-4">
                    <div className="w-16 h-16 rounded-full bg-green-500/15 flex items-center justify-center"><CheckCircle2 className="w-9 h-9 text-green-500" /></div>
                    <p className="font-bold text-lg text-green-600">Payment Confirmed!</p>
                    <p className="text-sm text-muted-foreground text-center">{pollMsg}</p>
                    <button onClick={() => { resetTopUp(); setShowTopUp(false); }} className="px-6 py-2.5 bg-green-600 text-white rounded-full font-semibold text-sm hover:bg-green-700 transition-colors">Done</button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Withdraw */}
          <div className="bg-gradient-to-br from-orange-600/10 via-red-500/5 to-transparent border border-orange-600/20 rounded-2xl overflow-hidden">
            <button onClick={() => { resetWithdraw(); setShowWithdraw(v => !v); }} className="w-full flex items-center gap-3 px-5 py-4 hover:bg-orange-500/5 transition-colors">
              <div className="w-10 h-10 rounded-full bg-orange-600/15 flex items-center justify-center shrink-0"><ArrowUpRight className="w-5 h-5 text-orange-600" /></div>
              <div className="flex-1 text-left">
                <p className="font-bold text-base">Withdraw to M-Pesa</p>
                <p className="text-xs text-muted-foreground">Available: <span className="font-semibold text-foreground">{fmtAmt(walletBalance, currency)}</span></p>
              </div>
              {(pinHash || biometricCredentialId) && (
                <div className="flex items-center gap-1 mr-1">
                  {biometricCredentialId && <Fingerprint className="w-3.5 h-3.5 text-green-500" />}
                  {pinHash && <Lock className="w-3.5 h-3.5 text-primary" />}
                </div>
              )}
              <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-transform ${showWithdraw ? 'border-orange-600 rotate-45' : 'border-muted-foreground/40'}`}>
                <span className="text-lg leading-none text-muted-foreground">+</span>
              </div>
            </button>
            {showWithdraw && (
              <div className="px-5 pb-5 space-y-4 border-t border-orange-600/15 pt-4">
                {(wStep === 'idle' || wStep === 'failed') && (
                  <>
                    {wStep === 'failed' && wPollMsg && (
                      <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2.5 text-sm text-red-600">
                        <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" /><span>{wPollMsg}</span>
                      </div>
                    )}
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide">Amount (KES)</p>
                      <div className="grid grid-cols-4 gap-2 mb-2">
                        {[500,1000,2500,5000].map(kes => {
                          const maxKes  = Math.floor(walletBalance * USD_TO_KES);
                          const disabled = kes > maxKes;
                          return (
                            <button key={kes} onClick={() => !disabled && setWKes(String(kes))} disabled={disabled}
                              className={`py-2.5 rounded-xl font-bold text-xs border-2 flex flex-col items-center transition-all ${
                                wKes === String(kes) ? 'border-orange-600 bg-orange-600/10 text-orange-700 dark:text-orange-400' :
                                disabled ? 'border-border opacity-30 cursor-not-allowed' : 'border-border hover:border-orange-600/40'
                              }`}>
                              <span className="text-[11px] font-black">KES {kes.toLocaleString()}</span>
                              <span className="text-[9px] opacity-60">${(kes/USD_TO_KES).toFixed(2)}</span>
                            </button>
                          );
                        })}
                      </div>
                      <input type="number" min="10" step="10" placeholder="Custom KES amount…" value={wKes} onChange={e => setWKes(e.target.value)}
                        className="w-full h-11 px-3 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-orange-500/30" />
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide flex items-center gap-1.5"><Phone className="w-3 h-3" />Recipient M-Pesa Number</p>
                      <input type="tel" placeholder="0712 345 678" value={wPhone} onChange={e => setWPhone(e.target.value)}
                        className="w-full h-11 px-3 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-orange-500/30" />
                    </div>
                    <button onClick={handleWithdrawClick} disabled={!wKes || !wPhone || parseFloat(wKes) < 10}
                      className="w-full py-3.5 bg-gradient-to-r from-orange-600 to-red-500 text-white rounded-xl font-bold text-base disabled:opacity-50 flex items-center justify-center gap-2 hover:opacity-90 transition-opacity">
                      {biometricCredentialId ? <Fingerprint className="w-5 h-5" /> : pinHash ? <Lock className="w-5 h-5" /> : <Wallet className="w-5 h-5" />}
                      Withdraw KES {parseInt(wKes || '0').toLocaleString() || '—'}
                    </button>
                  </>
                )}
                {wStep === 'sending' && <div className="flex flex-col items-center gap-3 py-6"><Loader2 className="w-10 h-10 animate-spin text-orange-600" /><p className="font-semibold text-sm">Initiating payout…</p></div>}
                {wStep === 'polling' && (
                  <div className="flex flex-col items-center gap-4 py-4">
                    <div className="w-16 h-16 rounded-full bg-orange-600/10 flex items-center justify-center"><Clock className="w-8 h-8 text-orange-600 animate-pulse" /></div>
                    <div className="text-center">
                      <p className="font-bold text-orange-700 dark:text-orange-400">Processing payout…</p>
                      <p className="text-sm text-muted-foreground mt-1">{wPollMsg}</p>
                      <p className="text-xs text-muted-foreground">{wPollSecs}s elapsed</p>
                    </div>
                    <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
                      <div className="h-full bg-gradient-to-r from-orange-500 to-red-400 rounded-full transition-all duration-1000" style={{ width: `${Math.min((wPollSecs / 90) * 100, 100)}%` }} />
                    </div>
                    <button onClick={resetWithdraw} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-destructive"><X className="w-3.5 h-3.5" /> Cancel</button>
                  </div>
                )}
                {wStep === 'success' && (
                  <div className="flex flex-col items-center gap-3 py-4">
                    <div className="w-16 h-16 rounded-full bg-green-500/15 flex items-center justify-center"><CheckCircle2 className="w-9 h-9 text-green-500" /></div>
                    <p className="font-bold text-lg text-green-600">Payout Initiated!</p>
                    <p className="text-sm text-muted-foreground text-center">{wPollMsg}</p>
                    <button onClick={() => { resetWithdraw(); setShowWithdraw(false); setWKes(''); }} className="px-6 py-2.5 bg-green-600 text-white rounded-full font-semibold text-sm hover:bg-green-700 transition-colors">Done</button>
                  </div>
                )}
              </div>
            )}
          </div>

          <WalletDashboard />
        <AdvertiserSurface variant="wallet" />
          {user && wallet && <SpendLimitCard userId={user.id} wallet={wallet} onSaved={fetchWallet} />}
          {user && wallet && <PinSetupCard userId={user.id} pinHash={(wallet as any)?.wallet_pin_hash ?? null} onSaved={fetchWallet} />}
          {user && wallet && <BiometricCard userId={user.id} credentialId={(wallet as any)?.biometric_credential_id ?? null} onSaved={fetchWallet} />}
          {user && <PayoutScheduleCard userId={user.id} defaultPhone={wallet?.mpesa_phone ?? null} />}
          <WalletNotificationsHub userId={user.id} />
          <CryptoWidget />
          <MpesaSecretsGuide />
          <div className="flex items-start gap-3 p-4 bg-muted/40 border border-border rounded-2xl">
            <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5"><Bell className="w-4 h-4 text-primary" /></div>
            <div className="flex-1">
              <p className="font-semibold text-sm">Wallet Notifications</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Deposit and withdrawal updates are sent to your{' '}
                <button onClick={() => { window.location.href = '/platform-inbox'; }} className="text-primary font-semibold hover:underline">Platform Inbox</button>.
              </p>
            </div>
            <BellOff className="w-4 h-4 text-muted-foreground/50 shrink-0" />
          </div>
          <div className="flex items-start gap-3 p-4 bg-muted/20 border border-border rounded-2xl">
            <div className="w-8 h-8 rounded-full bg-blue-500/10 flex items-center justify-center shrink-0 mt-0.5"><Globe className="w-4 h-4 text-blue-500" /></div>
            <div>
              <p className="font-semibold text-sm">Multi-Currency Display</p>
              <p className="text-xs text-muted-foreground mt-0.5">Toggle between USD, KES, and EUR. Your preference is saved automatically.</p>
            </div>
          </div>
          {user && <SpendingAlertsCard userId={user.id} />}
        </div>
      )}
    </div>
  );
}
