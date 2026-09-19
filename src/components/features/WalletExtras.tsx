import { useState, useEffect, useRef, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import {
  Shield, X, Loader2, CheckCircle2, Smartphone,
  BarChart3, Lock, Phone, Send, Copy, Printer,
} from 'lucide-react';

// ── esbuild-safe module-level constants ──────────────────────────────────
const EXTRAS_USD_TO_KES   = 130;
const MPESA_QUICK_KES_AMOUNTS = [100, 500, 1000, 2000, 5000] as const;
const MPESA_RECENTS_MAX   = 5;
const TWO_FA_DEFAULT_THRESHOLD = 10;
const TWO_FA_AMOUNTS      = [5, 10, 25, 50] as const;
const EXT_PIN_PAD_KEYS    = ['1','2','3','4','5','6','7','8','9','','0','del'] as const;

const BUDGET_CATEGORIES_LIST = ['deposits','withdrawals','transfers','boosts','other'] as const;

const SAVINGS_TIERS = [
  { min: 40, label: 'Super Saver',   emoji: '🌟', color: 'text-emerald-600', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20', msg: "You're in the top tier of savers!" },
  { min: 25, label: 'Great Saver',   emoji: '💚', color: 'text-green-600',   bg: 'bg-green-500/10',   border: 'border-green-500/20',   msg: 'You save a quarter of your deposits. Excellent!' },
  { min: 15, label: 'Good Saver',    emoji: '👍', color: 'text-blue-600',    bg: 'bg-blue-500/10',    border: 'border-blue-500/20',    msg: 'Consistent saving. Try to push above 25%.' },
  { min: 5,  label: 'Getting There', emoji: '📈', color: 'text-amber-600',   bg: 'bg-amber-500/10',   border: 'border-amber-500/20',   msg: "You've started saving. Aim for 15% of deposits." },
  { min: 0,  label: 'New Saver',     emoji: '🌱', color: 'text-muted-foreground', bg: 'bg-muted/40', border: 'border-border',        msg: 'Move some funds to Savings Pocket to get started!' },
] as const;

// ── Private type + helpers (prefixed to avoid collision with WalletPage) ─
type ExtCur = 'USD' | 'KES' | 'EUR';
const EXT_RATES   = { USD: 1, KES: 130, EUR: 0.92 } as const;
const EXT_SYMBOLS = { USD: '$', KES: 'KES ', EUR: '€' } as const;

function xfmt(usd: number, cur: ExtCur): string {
  const v = usd * (EXT_RATES[cur] ?? 1);
  return cur === 'KES'
    ? `KES ${Math.round(v).toLocaleString()}`
    : `${EXT_SYMBOLS[cur]}${v.toFixed(2)}`;
}

// ── Local PIN hash (pure utility, matches WalletPage) ─────────────────
function hashPinLocal(pin: string): Promise<string> {
  return crypto.subtle.digest('SHA-256', new TextEncoder().encode(pin + 'tsocial-pin-v1'))
    .then(buf => Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join(''));
}

// ── Two-Factor Auth Modal ────────────────────────────────────────────────
export function TwoFAModal({ code, expiry, onVerified, onCancel }: {
  code: string; expiry: number; onVerified: () => void; onCancel: () => void;
}) {
  const [input,     setInput]     = useState('');
  const [countdown, setCountdown] = useState(Math.max(0, Math.ceil((expiry - Date.now()) / 1000)));
  const cdRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    cdRef.current = setInterval(() => {
      const r = Math.max(0, Math.ceil((expiry - Date.now()) / 1000));
      setCountdown(r);
      if (r <= 0) { if (cdRef.current) clearInterval(cdRef.current); onCancel(); }
    }, 1000);
    return () => { if (cdRef.current) clearInterval(cdRef.current); };
  }, [expiry, onCancel]);

  const verify = () => {
    if (Date.now() > expiry) { toast.error('Code expired'); onCancel(); return; }
    if (input.trim() === code) { onVerified(); }
    else { toast.error('Incorrect code. Check your Wallet Notifications.'); setInput(''); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onCancel}>
      <div className="bg-card border border-border rounded-t-3xl sm:rounded-3xl p-6 w-full max-w-sm shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-full bg-blue-500/15 flex items-center justify-center shrink-0">
            <Shield className="w-5 h-5 text-blue-600" />
          </div>
          <div className="flex-1">
            <p className="font-bold text-sm">Two-Factor Verification</p>
            <p className="text-xs text-muted-foreground">Check Wallet Notifications for your 6-digit code</p>
          </div>
          <button onClick={onCancel} className="p-1.5 rounded-full hover:bg-muted"><X className="w-4 h-4" /></button>
        </div>
        <div className="space-y-4">
          <div className="text-center p-3 bg-blue-500/10 border border-blue-500/20 rounded-xl">
            <p className="text-xs text-blue-600 font-semibold">
              Expires in {Math.floor(countdown / 60)}:{String(countdown % 60).padStart(2, '0')}
            </p>
          </div>
          <input type="text" inputMode="numeric" maxLength={6} placeholder="000000"
            value={input} onChange={e => setInput(e.target.value.replace(/\D/g, '').slice(0, 6))}
            onKeyDown={e => { if (e.key === 'Enter' && input.length === 6) verify(); }}
            className="w-full h-12 px-3 rounded-xl border border-border bg-background text-xl font-mono font-black text-center focus:outline-none focus:ring-2 focus:ring-blue-500/30 tracking-widest" />
          <div className="grid grid-cols-2 gap-3">
            <button onClick={onCancel} className="py-3 border border-border rounded-xl font-semibold text-sm hover:bg-muted">Cancel</button>
            <button onClick={verify} disabled={input.length !== 6}
              className="py-3 bg-blue-600 text-white rounded-xl font-bold text-sm disabled:opacity-50 hover:bg-blue-700 transition-colors">
              Verify
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Two-Factor Auth Setup Card ───────────────────────────────────────────
export function TwoFASetupCard({ userId }: { userId: string }) {
  const key2fa = useMemo(() => `ts-2fa-${userId}`, [userId]);
  const [enabled,   setEnabled]   = useState(false);
  const [threshold, setThreshold] = useState(TWO_FA_DEFAULT_THRESHOLD);
  const [saved,     setSaved]     = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(key2fa);
      if (raw) {
        const v = JSON.parse(raw);
        setEnabled(v.enabled ?? false);
        setThreshold(v.threshold ?? TWO_FA_DEFAULT_THRESHOLD);
      }
    } catch { /* ignore */ }
  }, [key2fa]);

  const save = () => {
    localStorage.setItem(key2fa, JSON.stringify({ enabled, threshold }));
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    toast.success(enabled ? `2FA enabled for withdrawals over $${threshold}` : '2FA disabled');
  };

  return (
    <div className="rounded-2xl border border-border overflow-hidden">
      <div className="px-5 py-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Shield className={`w-4 h-4 ${enabled ? 'text-blue-600' : 'text-muted-foreground'}`} />
            <h3 className="font-bold text-sm">Two-Factor Auth (2FA)</h3>
            {enabled && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-500/10 text-blue-600 font-bold border border-blue-500/20">
                Active
              </span>
            )}
          </div>
          <button onClick={() => setEnabled(v => !v)}
            className={`relative w-11 h-6 rounded-full transition-colors ${enabled ? 'bg-primary' : 'bg-muted'}`}>
            <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${enabled ? 'translate-x-5' : 'translate-x-0'}`} />
          </button>
        </div>
        {enabled ? (
          <>
            <p className="text-xs text-muted-foreground mb-3">A 6-digit code is sent to Wallet Notifications before large withdrawals.</p>
            <div className="mb-3">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 block">
                Trigger threshold (USD)
              </label>
              <div className="grid grid-cols-4 gap-2 mb-2">
                {TWO_FA_AMOUNTS.map(v => (
                  <button key={v} onClick={() => setThreshold(v)}
                    className={`py-2 rounded-xl font-bold text-xs border-2 transition-all ${
                      threshold === v ? 'border-blue-600 bg-blue-600/10 text-blue-700' : 'border-border hover:border-blue-600/30'
                    }`}>${v}</button>
                ))}
              </div>
              <input type="number" min="1" step="1" placeholder="Custom…"
                value={!(TWO_FA_AMOUNTS as readonly number[]).includes(threshold) ? threshold : ''}
                onChange={e => setThreshold(parseFloat(e.target.value) || TWO_FA_DEFAULT_THRESHOLD)}
                className="w-full h-10 px-3 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30" />
            </div>
          </>
        ) : (
          <p className="text-xs text-muted-foreground mb-3">
            Require a one-time code (sent to Wallet Notifications) before large withdrawals.
          </p>
        )}
        <button onClick={save}
          className="w-full py-2.5 bg-primary text-primary-foreground rounded-xl font-semibold text-sm flex items-center justify-center gap-2 hover:opacity-90 transition-opacity">
          {saved ? <CheckCircle2 className="w-4 h-4" /> : <Shield className="w-4 h-4" />}
          {saved ? 'Saved!' : 'Save 2FA Settings'}
        </button>
      </div>
    </div>
  );
}

// ── M-Pesa Payment History Tab ───────────────────────────────────────────
function InlineReceiptModal({ tx, currency, onClose }: { tx: any; currency: ExtCur; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const kesAmount = useMemo(() => Math.round(Number(tx.amount) * EXTRAS_USD_TO_KES), [tx.amount]);

  const copyReceipt = () => {
    const text = [
      'M-Pesa Receipt',
      `Amount: KES ${kesAmount.toLocaleString()} (${xfmt(Number(tx.amount), currency)})`,
      tx.reference ? `Receipt: ${tx.reference}` : '',
      `Date: ${new Date(tx.created_at).toLocaleString()}`,
      `Status: ${tx.status}`,
    ].filter(Boolean).join('\n');
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      toast.success('Copied!');
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-card border border-border rounded-t-3xl sm:rounded-3xl p-6 w-full max-w-sm shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-green-500/15 flex items-center justify-center">
              <CheckCircle2 className="w-4 h-4 text-green-600" />
            </div>
            <div>
              <p className="font-bold text-sm">M-Pesa Receipt</p>
              <p className="text-xs text-muted-foreground">Deposit confirmation</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-full hover:bg-muted">
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>
        <div className="text-center py-3 bg-green-500/5 border border-green-500/20 rounded-2xl mb-4">
          <p className="text-xs text-muted-foreground mb-1">Amount Deposited</p>
          <p className="text-3xl font-black text-green-600">+{xfmt(Number(tx.amount), currency)}</p>
          <p className="text-sm text-muted-foreground mt-0.5">KES {kesAmount.toLocaleString()}</p>
        </div>
        <div className="space-y-2.5 divide-y divide-border mb-4">
          {tx.reference && (
            <div className="flex justify-between items-center pt-2.5">
              <span className="text-xs text-muted-foreground">Safaricom Receipt</span>
              <span className="font-mono text-xs font-black">{tx.reference}</span>
            </div>
          )}
          <div className="flex justify-between items-center pt-2.5">
            <span className="text-xs text-muted-foreground">Date &amp; Time</span>
            <span className="text-xs font-semibold">{new Date(tx.created_at).toLocaleString()}</span>
          </div>
          <div className="flex justify-between items-center pt-2.5">
            <span className="text-xs text-muted-foreground">Status</span>
            <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
              tx.status === 'completed' ? 'bg-green-500/10 text-green-600' : 'bg-orange-500/10 text-orange-600'
            }`}>{tx.status}</span>
          </div>
        </div>
        <div className="flex gap-3">
          <button onClick={copyReceipt}
            className="flex-1 flex items-center justify-center gap-2 py-3 border border-border rounded-xl font-semibold text-sm hover:bg-muted transition-colors">
            {copied ? <CheckCircle2 className="w-4 h-4 text-green-500" /> : <span className="text-sm">📋</span>}
            {copied ? 'Copied!' : 'Copy'}
          </button>
          <button onClick={onClose}
            className="flex-1 py-3 bg-primary text-primary-foreground rounded-xl font-semibold text-sm hover:opacity-90 transition-opacity">
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

export function MpesaPaymentHistory({ userId, currency }: { userId: string; currency: ExtCur }) {
  const [txns,     setTxns]     = useState<any[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [selected, setSelected] = useState<any | null>(null);

  useEffect(() => {
    setLoading(true);
    supabase.from('wallet_transactions').select('*')
      .eq('user_id', userId).eq('type', 'deposit').eq('payment_method', 'mpesa')
      .order('created_at', { ascending: false }).limit(100)
      .then(({ data }) => { setTxns(data ?? []); setLoading(false); });
  }, [userId]);

  const { totalKes, totalUsd } = useMemo(() => ({
    totalKes: Math.round(txns.reduce((s, t) => s + Number(t.amount), 0) * EXTRAS_USD_TO_KES),
    totalUsd: txns.reduce((s, t) => s + Number(t.amount), 0),
  }), [txns]);

  return (
    <div className="space-y-4">
      {selected && <InlineReceiptModal tx={selected} currency={currency} onClose={() => setSelected(null)} />}
      <div className="grid grid-cols-2 gap-3">
        <div className="p-4 rounded-2xl bg-green-500/10 border border-green-500/20">
          <p className="text-xs text-muted-foreground mb-1">Total via M-Pesa</p>
          <p className="text-xl font-black text-green-600">{xfmt(totalUsd, currency)}</p>
          <p className="text-[10px] text-muted-foreground">KES {totalKes.toLocaleString()}</p>
        </div>
        <div className="p-4 rounded-2xl bg-blue-500/10 border border-blue-500/20">
          <p className="text-xs text-muted-foreground mb-1">Transactions</p>
          <p className="text-xl font-black text-blue-600">{txns.length}</p>
          <p className="text-[10px] text-muted-foreground">M-Pesa deposits</p>
        </div>
      </div>
      {loading ? (
        <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
      ) : txns.length === 0 ? (
        <div className="text-center py-12">
          <Smartphone className="w-12 h-12 text-muted-foreground/20 mx-auto mb-3" />
          <p className="font-semibold text-sm">No M-Pesa deposits yet</p>
          <p className="text-xs text-muted-foreground mt-1">Deposit via M-Pesa to see receipts here</p>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">M-Pesa Deposits ({txns.length})</p>
          {txns.map(tx => (
            <button key={tx.id} onClick={() => setSelected(tx)}
              className="w-full p-4 border border-border rounded-2xl bg-card hover:border-green-500/40 hover:bg-green-500/5 transition-all text-left">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-green-500/10 flex items-center justify-center shrink-0">
                  <Smartphone className="w-5 h-5 text-green-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <p className="font-semibold text-sm text-green-700 dark:text-green-400">
                      +{xfmt(Number(tx.amount), currency)}
                    </p>
                    {tx.reference && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-green-500/10 text-green-600 font-bold border border-green-500/20">
                        Receipt
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    KES {Math.round(Number(tx.amount) * EXTRAS_USD_TO_KES).toLocaleString()} · {new Date(tx.created_at).toLocaleDateString()}
                  </p>
                  {tx.reference && (
                    <p className="text-[10px] font-mono text-muted-foreground/70">{tx.reference}</p>
                  )}
                </div>
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold shrink-0 ${
                  tx.status === 'completed' ? 'bg-green-500/10 text-green-600' : 'bg-orange-500/10 text-orange-600'
                }`}>{tx.status}</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Wallet Budget Planner ────────────────────────────────────────────────
export function WalletBudgetPlanner({ userId, currency }: { userId: string; currency: ExtCur }) {
  const budgetKey = useMemo(() => `ts-budget-${userId}`, [userId]);
  const [budgets,    setBudgets]    = useState<Record<string, number>>({});
  const [txns,       setTxns]       = useState<any[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [editingCat, setEditingCat] = useState<string | null>(null);
  const [editVal,    setEditVal]    = useState('');

  useEffect(() => {
    try {
      const raw = localStorage.getItem(budgetKey);
      if (raw) setBudgets(JSON.parse(raw));
    } catch { /* ignore */ }
  }, [budgetKey]);

  useEffect(() => {
    setLoading(true);
    const since = new Date();
    since.setDate(1);
    since.setHours(0, 0, 0, 0);
    supabase.from('wallet_transactions')
      .select('type,amount,description')
      .eq('user_id', userId)
      .gte('created_at', since.toISOString())
      .then(({ data }) => { setTxns(data ?? []); setLoading(false); });
  }, [userId]);

  const spending = useMemo(() => {
    const map: Record<string, number> = { deposits: 0, withdrawals: 0, transfers: 0, boosts: 0, other: 0 };
    txns.forEach(t => {
      const amt = Number(t.amount);
      if      (t.type === 'deposit')                                   map.deposits    += amt;
      else if (t.type === 'withdrawal')                                map.withdrawals += amt;
      else if (t.type === 'transfer')                                  map.transfers   += amt;
      else if ((t.description ?? '').toLowerCase().includes('boost')) map.boosts      += amt;
      else                                                             map.other       += amt;
    });
    return map;
  }, [txns]);

  const monthLabel = useMemo(
    () => new Date().toLocaleDateString('en', { month: 'long', year: 'numeric' }),
    [],
  );

  const saveBudget = (cat: string, val: string) => {
    const v = parseFloat(val);
    if (isNaN(v) || v < 0) { setEditingCat(null); return; }
    const next = { ...budgets, [cat]: v };
    setBudgets(next);
    localStorage.setItem(budgetKey, JSON.stringify(next));
    setEditingCat(null);
    setEditVal('');
    toast.success(`Budget for ${cat}: ${xfmt(v, currency)}/month`);
    const spent = spending[cat] ?? 0;
    if (v > 0 && spent >= v * 0.9) {
      supabase.from('platform_inbox').insert({
        user_id:    userId,
        subject:    `Budget Alert: ${cat} at ${Math.round((spent / v) * 100)}%`,
        body:       `You've spent ${xfmt(spent, currency)} of your ${xfmt(v, currency)} ${cat} budget this month.`,
        type:       'warning',
        icon_emoji: '⚠️',
      }).then(() => {});
    }
  };

  return (
    <div className="border border-border rounded-2xl overflow-hidden">
      <div className="px-4 py-3 flex items-center gap-2 border-b border-border">
        <BarChart3 className="w-4 h-4 text-primary" />
        <h3 className="font-bold text-sm">Budget Planner</h3>
        <span className="text-[10px] text-muted-foreground ml-auto">{monthLabel}</span>
      </div>
      {loading ? (
        <div className="flex justify-center p-5"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>
      ) : (
        <div className="divide-y divide-border">
          {BUDGET_CATEGORIES_LIST.map(cat => {
            const spent = spending[cat] ?? 0;
            const limit = budgets[cat] ?? 0;
            const pct   = limit > 0 ? Math.min((spent / limit) * 100, 100) : 0;
            const over  = limit > 0 && spent >= limit;
            const near  = limit > 0 && pct >= 90 && !over;
            return (
              <div key={cat} className="px-4 py-3">
                <div className="flex items-center justify-between mb-1.5">
                  <p className="font-semibold text-sm capitalize">{cat}</p>
                  <div className="flex items-center gap-2">
                    {limit > 0 && (
                      <span className={`text-xs font-bold ${over ? 'text-red-500' : near ? 'text-amber-500' : 'text-muted-foreground'}`}>
                        {xfmt(spent, currency)} / {xfmt(limit, currency)}
                      </span>
                    )}
                    <button
                      onClick={() => { setEditingCat(editingCat === cat ? null : cat); setEditVal(limit > 0 ? String(limit) : ''); }}
                      className="text-[10px] text-primary font-semibold hover:underline">
                      {limit > 0 ? 'Edit' : 'Set'}
                    </button>
                  </div>
                </div>
                {editingCat === cat && (
                  <div className="flex gap-2 mb-2">
                    <input type="number" min="0" step="0.01" placeholder="Monthly limit (USD)…" value={editVal}
                      onChange={e => setEditVal(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') saveBudget(cat, editVal); if (e.key === 'Escape') setEditingCat(null); }}
                      className="flex-1 h-9 px-3 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-1 focus:ring-primary/40" />
                    <button onClick={() => saveBudget(cat, editVal)}
                      className="px-3 h-9 bg-primary text-primary-foreground rounded-lg text-xs font-bold hover:opacity-90">
                      Save
                    </button>
                    <button onClick={() => setEditingCat(null)}
                      className="px-2 h-9 border border-border rounded-lg text-xs hover:bg-muted">✕</button>
                  </div>
                )}
                {limit > 0 ? (
                  <div>
                    <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                      <div className={`h-full rounded-full transition-all ${over ? 'bg-red-500' : near ? 'bg-amber-500' : 'bg-primary'}`}
                        style={{ width: `${pct}%` }} />
                    </div>
                    {over  && <p className="text-[10px] text-red-500 font-semibold mt-0.5">Over budget!</p>}
                    {near && !over && <p className="text-[10px] text-amber-500 font-semibold mt-0.5">90% of budget used</p>}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">{xfmt(spent, currency)} spent · no limit set</p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Friend Balance Comparison (Savings Score) ────────────────────────────
export function FriendBalanceComparison({ savingsBalance, totalDeposited, currency }: {
  savingsBalance: number; totalDeposited: number; currency: ExtCur;
}) {
  const { tier, rate, tips } = useMemo(() => {
    const rate = totalDeposited > 0 ? (savingsBalance / totalDeposited) * 100 : 0;
    const tier = SAVINGS_TIERS.find(t => rate >= t.min) ?? SAVINGS_TIERS[SAVINGS_TIERS.length - 1];
    const tipList = [
      rate < 15 ? `Save 15% of deposits (${xfmt(totalDeposited * 0.15, currency)})` : null,
      rate < 25 ? 'Auto-transfer a fixed amount to Savings Pocket after each deposit' : null,
      savingsBalance < 50 ? 'Build a $50 savings buffer first' : null,
      rate >= 25 ? 'Link your Savings Pocket to a Goal for structured saving' : null,
    ].filter(Boolean) as string[];
    return { tier, rate, tips: tipList };
  }, [savingsBalance, totalDeposited, currency]);

  return (
    <div className={`rounded-2xl border ${tier.border} overflow-hidden`}>
      <div className={`px-4 py-3 flex items-center gap-2 border-b ${tier.border} ${tier.bg}`}>
        <span className="text-xl">{tier.emoji}</span>
        <div>
          <h3 className="font-bold text-sm">Savings Score</h3>
          <p className={`text-xs font-bold ${tier.color}`}>{tier.label}</p>
        </div>
        <div className="ml-auto text-right">
          <p className={`text-2xl font-black ${tier.color}`}>{rate.toFixed(1)}%</p>
          <p className="text-[10px] text-muted-foreground">of deposits saved</p>
        </div>
      </div>
      <div className="p-4 space-y-3">
        <div>
          <div className="flex justify-between text-xs mb-1">
            <span className="text-muted-foreground">Savings rate</span>
            <span className={`font-bold ${tier.color}`}>{rate.toFixed(1)}%{rate >= 25 ? ' ✓' : ''}</span>
          </div>
          <div className="h-3 bg-muted rounded-full overflow-hidden">
            <div className={`h-full rounded-full transition-all ${
              rate >= 25 ? 'bg-emerald-500' : rate >= 15 ? 'bg-blue-500' : rate >= 5 ? 'bg-amber-500' : 'bg-muted-foreground'
            }`} style={{ width: `${Math.min(rate * 2, 100)}%` }} />
          </div>
          <div className="flex justify-between text-[9px] text-muted-foreground mt-0.5">
            <span>0%</span><span>15%</span><span>25%</span><span>50%</span>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">{tier.msg}</p>
        {tips.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-xs font-semibold">Tips to improve:</p>
            {tips.map((tip, i) => (
              <div key={i} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                <span className="text-primary shrink-0 mt-0.5">→</span>
                <span>{tip}</span>
              </div>
            ))}
          </div>
        )}
        <div className="grid grid-cols-2 gap-2 pt-1">
          <div className="p-2.5 bg-muted/30 rounded-xl text-center">
            <p className="text-xs text-muted-foreground">Saved</p>
            <p className="font-black text-sm text-emerald-600">{xfmt(savingsBalance, currency)}</p>
          </div>
          <div className="p-2.5 bg-muted/30 rounded-xl text-center">
            <p className="text-xs text-muted-foreground">Total Deposited</p>
            <p className="font-black text-sm">{xfmt(totalDeposited, currency)}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Testagram wallet-to-wallet transfer ───────────────────────────────────
export function PeerWalletTransferPanel({ walletBalance, currency, onComplete }: {
  walletBalance: number; currency: ExtCur; onComplete: () => void;
}) {
  const [username, setUsername] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState<{ username: string; amount: number; transferId: string } | null>(null);

  const amountKes = Number(amount || 0);
  const walletRate = EXTRAS_USD_TO_KES;
  const debit = currency === 'KES' ? amountKes : amountKes / walletRate;
  const canSend = amountKes >= 10 && amountKes <= 10000 && debit <= walletBalance && username.trim().length >= 2 && !sending;

  const send = async () => {
    if (!canSend) return;
    setSending(true);
    try {
      const key = crypto.randomUUID();
      const { data, error } = await supabase.rpc('send_wallet_money', {
        p_recipient_username: username.trim().replace(/^@/, ''),
        p_amount_kes: Math.floor(amountKes),
        p_note: note.trim() || null,
        p_idempotency_key: key,
      });
      if (error) throw error;
      if (!data?.success) throw new Error('Transfer could not be completed');
      setDone({ username: username.trim().replace(/^@/, ''), amount: Number(data.amount_kes), transferId: data.transfer_id });
      setUsername('');
      setAmount('');
      setNote('');
      toast.success(`KES ${Number(data.amount_kes).toLocaleString()} sent to @${data.recipient_username}`);
      onComplete();
    } catch (err: any) {
      toast.error(err?.message || 'Unable to send wallet money');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="p-4 rounded-2xl bg-primary/5 border border-primary/20">
        <p className="text-sm font-bold">💸 Send to another Testagram user</p>
        <p className="text-xs text-muted-foreground mt-1">Transfer wallet funds instantly using their @username.</p>
        <p className="text-xs font-semibold mt-2">Limit: KES 10,000 per transfer · Minimum KES 10</p>
      </div>

      {done ? (
        <div className="p-5 rounded-2xl border border-green-500/20 bg-green-500/5 text-center space-y-3">
          <CheckCircle2 className="w-10 h-10 mx-auto text-green-600" />
          <p className="font-black text-lg">Money sent</p>
          <p className="text-3xl font-black text-green-600">KES {done.amount.toLocaleString()}</p>
          <p className="text-sm text-muted-foreground">Sent to <strong>@{done.username}</strong></p>
          <p className="text-[11px] font-mono text-muted-foreground break-all">Transfer: {done.transferId}</p>
          <button onClick={() => setDone(null)} className="w-full py-3 rounded-xl bg-primary text-primary-foreground font-bold">Send Another</button>
        </div>
      ) : (
        <>
          <div>
            <label className="text-sm font-semibold mb-2 block">Recipient username</label>
            <input value={username} onChange={e => setUsername(e.target.value)}
              placeholder="@username" autoComplete="off"
              className="w-full h-11 px-3 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
          </div>
          <div>
            <label className="text-sm font-semibold mb-2 block">Amount (KES)</label>
            <div className="grid grid-cols-4 gap-2 mb-2">
              {[100,500,1000,5000].map(v => (
                <button key={v} type="button" onClick={() => setAmount(String(v))}
                  className={`py-2 rounded-xl font-bold text-xs border-2 ${amount===String(v) ? 'border-primary bg-primary/10' : 'border-border hover:border-primary/40'}`}>
                  {v.toLocaleString()}
                </button>
              ))}
            </div>
            <input type="number" min="10" max="10000" step="1" value={amount}
              onChange={e => setAmount(e.target.value)}
              placeholder="Enter up to 10,000"
              className="w-full h-11 px-3 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
            <div className="flex justify-between text-xs mt-1 text-muted-foreground">
              <span>Min KES 10</span><span>Max KES 10,000</span>
            </div>
          </div>
          <div>
            <label className="text-sm font-semibold mb-2 block">Note (optional)</label>
            <input value={note} onChange={e => setNote(e.target.value)} maxLength={80}
              placeholder="What's this for?"
              className="w-full h-11 px-3 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
          </div>
          {amountKes > 10000 && <p className="text-xs text-red-500">Maximum transfer is KES 10,000.</p>}
          {amountKes > 0 && debit > walletBalance && <p className="text-xs text-red-500">Insufficient wallet balance.</p>}
          <button type="button" onClick={send} disabled={!canSend}
            className="w-full py-4 rounded-xl bg-primary text-primary-foreground font-bold disabled:opacity-50 flex items-center justify-center gap-2">
            {sending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
            {sending ? 'Sending…' : amountKes > 0 ? `Send KES ${Math.floor(amountKes).toLocaleString()}` : 'Send Money'}
          </button>
          <p className="text-[11px] text-muted-foreground text-center">The transfer is atomic: the sender is debited and the recipient credited together, or neither changes.</p>
        </>
      )}
    </div>
  );
}

// ── Direct M-Pesa Send Panel ─────────────────────────────────────────────
export function DirectMpesaSendPanel({ userId, walletBalance, pinHash, currency, onComplete }: {
  userId: string; walletBalance: number; pinHash: string | null;
  currency: ExtCur; onComplete: () => void;
}) {
  const [phone,        setPhone]        = useState('');
  const [kesAmt,       setKesAmt]       = useState('');
  const [note,         setNote]         = useState('');
  const [sending,      setSending]      = useState(false);
  const [showPin,      setShowPin]      = useState(false);
  const [pinInput,     setPinInput]     = useState('');
  const [done,         setDone]         = useState<{ kes: number; usd: number; phone: string; ref: string; timestamp: string; note: string } | null>(null);
  const [receiptCopied, setReceiptCopied] = useState(false);
  const [recentPhones, setRecentPhones] = useState<string[]>([]);
  const recentKey = useMemo(() => `ts-mpesa-recents-${userId}`, [userId]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(recentKey);
      if (raw) setRecentPhones(JSON.parse(raw));
    } catch { /* ignore */ }
  }, [recentKey]);

  const usdAmt = useMemo(() => {
    const kes = parseFloat(kesAmt || '0');
    return kes > 0 ? parseFloat((kes / EXTRAS_USD_TO_KES).toFixed(4)) : 0;
  }, [kesAmt]);

  const saveRecent = (ph: string) => {
    const next = [ph, ...recentPhones.filter(p => p !== ph)].slice(0, MPESA_RECENTS_MAX);
    setRecentPhones(next);
    localStorage.setItem(recentKey, JSON.stringify(next));
  };

  const execute = async () => {
    const kes = parseFloat(kesAmt);
    if (!kes || kes < 10) { toast.error('Minimum KES 10'); return; }
    if (usdAmt > walletBalance) { toast.error(`Insufficient balance — ${xfmt(walletBalance, currency)} available`); return; }
    if (phone.replace(/\D/g, '').length < 9) { toast.error('Enter a valid M-Pesa number'); return; }
    setSending(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token      = sessionData.session?.access_token;
      const backendUrl = import.meta.env.VITE_SUPABASE_URL;
      const res = await fetch(`${backendUrl}/functions/v1/mpesa-b2c-payout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ phone, amount: Math.floor(kes), purpose: 'direct_send' }),
      });
      const payload = await res.json();
      if (!res.ok || !payload.success) throw new Error(payload.error || 'B2C request failed');
      saveRecent(phone);
      setSending(false);
      const txRef = payload.conversation_id || payload.originator_conversation_id
        || `MPESA${Date.now().toString(36).toUpperCase().slice(-8)}`;
      setDone({ kes, usd: usdAmt, phone, ref: txRef, timestamp: new Date().toISOString(), note });
      toast.success(`KES ${Math.floor(kes).toLocaleString()} sent to ${phone}!`);
      onComplete();
    } catch (err: any) {
      setSending(false);
      toast.error(err.message || 'Failed to send. Check your M-Pesa setup.');
    }
  };

  const handlePinKey = (key: string) => {
    if (key === 'del') { setPinInput(p => p.slice(0, -1)); return; }
    if (pinInput.length >= 4) return;
    const next = pinInput + key;
    setPinInput(next);
    if (next.length === 4) {
      setTimeout(async () => {
        const h = await hashPinLocal(next);
        setPinInput(''); setShowPin(false);
        if (h !== pinHash) { toast.error('Incorrect PIN'); return; }
        execute();
      }, 120);
    }
  };

  const handleCopyReceipt = () => {
    if (!done) return;
    const lines = [
      'M-Pesa Send Receipt',
      `Recipient: ${done.phone}`,
      `Amount:    KES ${Math.floor(done.kes).toLocaleString()} (${xfmt(done.usd, currency)})`,
      `Reference: ${done.ref}`,
      `Date:      ${new Date(done.timestamp).toLocaleString()}`,
      `Status:    Sent`,
      done.note ? `Note:      ${done.note}` : '',
    ].filter(Boolean).join('\n');
    navigator.clipboard.writeText(lines).then(() => {
      setReceiptCopied(true);
      setTimeout(() => setReceiptCopied(false), 2500);
    });
  };

  const handlePrintReceipt = () => {
    if (!done) return;
    const w = window.open('', '_blank', 'width=480,height=600');
    if (!w) return;
    w.document.write(`<!DOCTYPE html><html><head><title>M-Pesa Send Receipt</title>
<style>*{box-sizing:border-box}body{font-family:Arial,sans-serif;padding:32px;max-width:400px;margin:0 auto;color:#111}
h1{font-size:20px;font-weight:900;margin-bottom:4px;color:#16a34a}h2{font-size:12px;color:#666;margin-bottom:24px;font-weight:400}
.badge{display:inline-flex;align-items:center;gap:6px;background:#dcfce7;color:#16a34a;border:1px solid #86efac;border-radius:99px;padding:4px 12px;font-size:11px;font-weight:700;margin-bottom:16px}
.amount{font-size:36px;font-weight:900;color:#16a34a;margin:8px 0}
.sub{font-size:13px;color:#666;margin-bottom:20px}
table{width:100%;border-collapse:collapse}td{padding:9px 0;border-bottom:1px solid #eee;font-size:13px}td:first-child{color:#666}td:last-child{text-align:right;font-weight:600}
.footer{margin-top:20px;font-size:11px;color:#999;text-align:center}
.btn{margin-bottom:20px;padding:8px 20px;background:#16a34a;color:white;border:none;border-radius:8px;cursor:pointer;font-weight:700;font-size:13px}
@media print{.btn{display:none}}
</style></head><body>
<div class="badge">✓ Sent Successfully</div>
<h1>M-Pesa Send Receipt</h1>
<h2>Direct wallet-to-M-Pesa transfer</h2>
<div class="amount">KES ${Math.floor(done.kes).toLocaleString()}</div>
<div class="sub">${xfmt(done.usd, currency)} deducted from wallet</div>
<button class="btn" onclick="window.print()">🖨 Print / Save PDF</button>
<table>
<tr><td>Recipient</td><td>${done.phone}</td></tr>
<tr><td>Reference</td><td><code style="font-size:11px">${done.ref}</code></td></tr>
<tr><td>Date &amp; Time</td><td>${new Date(done.timestamp).toLocaleString()}</td></tr>
<tr><td>Status</td><td style="color:#16a34a;font-weight:700">Sent</td></tr>
${done.note ? `<tr><td>Note</td><td>${done.note}</td></tr>` : ''}
</table>
<div class="footer">Testagram Wallet · Powered by Safaricom M-Pesa</div>
</body></html>`);
    w.document.close();
  };

  if (done) {
    return (
      <div className="space-y-5">
        <div className="flex flex-col items-center gap-4 p-6 bg-gradient-to-br from-green-500/10 to-emerald-400/5 border border-green-500/20 rounded-2xl text-center">
          <div className="w-16 h-16 rounded-full bg-green-500/15 flex items-center justify-center">
            <CheckCircle2 className="w-9 h-9 text-green-500" />
          </div>
          <div>
            <p className="text-lg font-black text-green-600">M-Pesa Sent!</p>
            <p className="text-4xl font-black mt-1">KES {Math.floor(done.kes).toLocaleString()}</p>
            <p className="text-sm text-muted-foreground mt-0.5">≈ {xfmt(done.usd, currency)}</p>
          </div>
        </div>
        <div className="border border-border rounded-2xl overflow-hidden bg-card">
          <div className="px-4 py-3 bg-green-500/5 border-b border-border flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-green-600" />
            <p className="font-bold text-sm">Receipt</p>
            <span className="ml-auto text-[10px] px-2 py-0.5 rounded-full bg-green-500/10 text-green-600 font-bold border border-green-500/20">Sent</span>
          </div>
          <div className="divide-y divide-border">
            <div className="flex justify-between items-center px-4 py-3">
              <span className="text-xs text-muted-foreground">Recipient</span>
              <span className="font-semibold text-sm">{done.phone}</span>
            </div>
            <div className="flex justify-between items-center px-4 py-3">
              <span className="text-xs text-muted-foreground">Amount (KES)</span>
              <span className="font-black text-sm text-green-600">KES {Math.floor(done.kes).toLocaleString()}</span>
            </div>
            <div className="flex justify-between items-center px-4 py-3">
              <span className="text-xs text-muted-foreground">Amount (Wallet)</span>
              <span className="font-semibold text-sm">{xfmt(done.usd, currency)}</span>
            </div>
            <div className="flex justify-between items-center px-4 py-3">
              <span className="text-xs text-muted-foreground">Reference</span>
              <span className="font-mono text-xs font-black">{done.ref}</span>
            </div>
            <div className="flex justify-between items-center px-4 py-3">
              <span className="text-xs text-muted-foreground">Date &amp; Time</span>
              <span className="font-semibold text-xs">{new Date(done.timestamp).toLocaleString()}</span>
            </div>
            {done.note && (
              <div className="flex justify-between items-center px-4 py-3">
                <span className="text-xs text-muted-foreground">Note</span>
                <span className="font-semibold text-xs max-w-[160px] text-right truncate">{done.note}</span>
              </div>
            )}
            <div className="flex justify-between items-center px-4 py-3">
              <span className="text-xs text-muted-foreground">Status</span>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-green-500/10 text-green-600 font-bold border border-green-500/20">Sent</span>
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <button onClick={handleCopyReceipt}
            className="flex items-center justify-center gap-2 py-3 border border-border rounded-xl font-semibold text-sm hover:bg-muted transition-colors">
            {receiptCopied ? <CheckCircle2 className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
            {receiptCopied ? 'Copied!' : 'Copy Receipt'}
          </button>
          <button onClick={handlePrintReceipt}
            className="flex items-center justify-center gap-2 py-3 border border-border rounded-xl font-semibold text-sm hover:bg-muted transition-colors">
            <Printer className="w-4 h-4" /> Print
          </button>
        </div>
        <button onClick={() => { setDone(null); setKesAmt(''); setPhone(''); setNote(''); setReceiptCopied(false); }}
          className="w-full py-3 bg-primary text-primary-foreground rounded-xl font-bold text-sm hover:opacity-90 transition-opacity">
          Send Another
        </button>
      </div>
    );
  }

  return (
    <>
      <PeerWalletTransferPanel walletBalance={walletBalance} currency={currency} onComplete={onComplete} />
      <div className="my-6 border-t border-border" />
      {showPin && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setShowPin(false)}>
          <div className="bg-card border border-border rounded-t-3xl sm:rounded-3xl p-6 w-full max-w-sm shadow-2xl"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-2 mb-5">
              <Lock className="w-4 h-4 text-primary" />
              <p className="font-bold text-sm">Enter PIN to confirm</p>
              <button onClick={() => setShowPin(false)} className="ml-auto p-1.5 rounded-full hover:bg-muted">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex justify-center gap-5 mb-5">
              {[0, 1, 2, 3].map(i => (
                <div key={i} className={`w-5 h-5 rounded-full border-2 transition-all ${
                  pinInput.length > i ? 'bg-primary border-primary scale-110' : 'border-muted-foreground/40'
                }`} />
              ))}
            </div>
            <div className="grid grid-cols-3 gap-3">
              {EXT_PIN_PAD_KEYS.map((key, i) => {
                if (!key) return <div key={i} />;
                return (
                  <button key={i} onClick={() => handlePinKey(key)}
                    className={`h-14 rounded-2xl font-bold text-xl transition-all active:scale-95 ${
                      key === 'del'
                        ? 'bg-muted text-muted-foreground hover:bg-muted/70'
                        : 'bg-muted hover:bg-primary/10 hover:text-primary'
                    }`}>
                    {key === 'del' ? '⌫' : key}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
      <div className="space-y-4">
        <div className="p-4 rounded-2xl bg-green-500/10 border border-green-500/20">
          <p className="text-sm font-semibold text-green-700 dark:text-green-400">📲 Direct M-Pesa Send</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Send KES to any Safaricom number. Deducted from your wallet instantly.
          </p>
          <p className="text-sm font-bold mt-2">Available: {xfmt(walletBalance, currency)}</p>
        </div>
        {recentPhones.length > 0 && !phone && (
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Recent</p>
            <div className="flex flex-wrap gap-2">
              {recentPhones.map(ph => (
                <button key={ph} onClick={() => setPhone(ph)}
                  className="px-3 py-1.5 border border-border rounded-xl text-xs font-semibold hover:border-green-500/40 hover:bg-green-500/5 transition-colors">
                  <Phone className="w-3 h-3 inline mr-1" />{ph}
                </button>
              ))}
            </div>
          </div>
        )}
        <div>
          <label className="text-sm font-semibold mb-2 block">Recipient M-Pesa Number</label>
          <input type="tel" placeholder="0712 345 678" value={phone} onChange={e => setPhone(e.target.value)}
            className="w-full h-11 px-3 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-green-500/30" />
        </div>
        <div>
          <label className="text-sm font-semibold mb-2 block">Amount (KES)</label>
          <div className="grid grid-cols-5 gap-2 mb-2">
            {MPESA_QUICK_KES_AMOUNTS.map(kes => {
              const disabled = kes / EXTRAS_USD_TO_KES > walletBalance;
              return (
                <button key={kes} onClick={() => !disabled && setKesAmt(String(kes))} disabled={disabled}
                  className={`py-2 rounded-xl font-bold text-xs border-2 transition-all flex flex-col items-center ${
                    kesAmt === String(kes)
                      ? 'border-green-600 bg-green-600/10 text-green-700 dark:text-green-400'
                      : disabled
                        ? 'border-border opacity-30 cursor-not-allowed'
                        : 'border-border hover:border-green-600/40'
                  }`}>
                  <span>{kes >= 1000 ? `${kes / 1000}K` : kes}</span>
                </button>
              );
            })}
          </div>
          <input type="number" min="10" step="10" placeholder="Custom KES amount…"
            value={kesAmt && !MPESA_QUICK_KES_AMOUNTS.includes(parseInt(kesAmt) as any) ? kesAmt : ''}
            onChange={e => setKesAmt(e.target.value)}
            className="w-full h-11 px-3 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-green-500/30" />
          {usdAmt > 0 && (
            <p className="text-xs text-green-600 font-semibold mt-1">≈ {xfmt(usdAmt, currency)} from wallet</p>
          )}
        </div>
        <div>
          <label className="text-sm font-semibold mb-2 block">Note (optional)</label>
          <input type="text" maxLength={80} placeholder="What's this for?" value={note}
            onChange={e => setNote(e.target.value)}
            className="w-full h-11 px-3 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-green-500/30" />
        </div>
        {usdAmt > 0 && usdAmt > walletBalance && (
          <p className="text-xs text-red-500 text-center">Exceeds your wallet balance of {xfmt(walletBalance, currency)}</p>
        )}
        <button onClick={() => pinHash ? setShowPin(true) : execute()}
          disabled={sending || !phone || !kesAmt || parseFloat(kesAmt) < 10 || usdAmt > walletBalance}
          className="w-full py-4 bg-gradient-to-r from-green-600 to-emerald-500 text-white rounded-xl font-bold text-base disabled:opacity-50 flex items-center justify-center gap-2 hover:opacity-90 transition-opacity">
          {sending ? <Loader2 className="w-5 h-5 animate-spin" /> : pinHash ? <Lock className="w-5 h-5" /> : <Send className="w-5 h-5" />}
          {sending ? 'Sending…' : `Send KES ${parseInt(kesAmt || '0').toLocaleString() || '—'} to M-Pesa`}
        </button>
        <div className="p-3 bg-muted/30 rounded-xl text-xs text-muted-foreground">
          <p><strong>Direct send</strong> bypasses the platform — funds go straight to the recipient's M-Pesa. Requires B2C payout configured in Cloud → Secrets.</p>
        </div>
      </div>
    </>
  );
}

// ── OTP expiry constant exported for WalletPage ──────────────────────────
export const WALLET_EXTRAS_OTP_EXPIRY_MS = 5 * 60 * 1000;
