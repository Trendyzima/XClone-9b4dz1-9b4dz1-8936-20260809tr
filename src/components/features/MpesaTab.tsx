// MpesaTab — Full M-Pesa management: Deposits, Withdrawal History, Live Status Polling, Spend Limit
import { useState, useEffect, useRef, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { Loader2, Smartphone, ArrowUpRight, RefreshCw, X, Shield, Settings2, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { MpesaPaymentHistory } from '@/components/features/WalletExtras';

// ── Types (esbuild-safe: no type alias in export position) ──────────────
type CurrencyCode = 'USD' | 'KES' | 'EUR';

const USD_TO_KES = 130;

// ── Pure formatter (module-level) ────────────────────────────────────────
function fmtUsd(usd: number, cur: CurrencyCode): string {
  if (cur === 'KES') return `KES ${Math.round(usd * USD_TO_KES).toLocaleString()}`;
  if (cur === 'EUR') return `€${(usd * 0.92).toFixed(2)}`;
  return `$${usd.toFixed(2)}`;
}

// ── B2C Status config (module-level, esbuild-safe) ───────────────────────
const B2C_STATUS_CFG = {
  pending:   { label: 'Pending',   cls: 'bg-orange-500/10 text-orange-600 border-orange-500/20' },
  completed: { label: 'Completed', cls: 'bg-green-500/10 text-green-600 border-green-500/20'   },
  success:   { label: 'Completed', cls: 'bg-green-500/10 text-green-600 border-green-500/20'   },
  failed:    { label: 'Failed',    cls: 'bg-red-500/10 text-red-500 border-red-500/20'          },
  cancelled: { label: 'Cancelled', cls: 'bg-red-500/10 text-red-500 border-red-500/20'          },
};

function B2CStatusBadge({ status }: { status: string }) {
  const cfg = B2C_STATUS_CFG[status as keyof typeof B2C_STATUS_CFG] ?? B2C_STATUS_CFG.pending;
  return (
    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${cfg.cls}`}>{cfg.label}</span>
  );
}

// ── B2C Status Poller — auto-polls pending withdrawals every 8s ─────────
function B2CStatusPoller({ userId }: { userId: string }) {
  const [txns, setTxns] = useState([] as any[]);
  const [loading, setLoading] = useState(true);
  const [polling, setPolling] = useState(false);
  const pollRef = useRef(null as ReturnType<typeof setInterval> | null);

  const fetchLatestB2C = async () => {
    const { data } = await supabase
      .from('wallet_transactions')
      .select('*')
      .eq('user_id', userId)
      .eq('type', 'withdrawal').eq('provider', 'mpesa_b2c')
      .order('created_at', { ascending: false })
      .limit(5);
    setTxns(data ?? []);
    setLoading(false);
    return data ?? [];
  };

  useEffect(() => {
    setLoading(true);
    fetchLatestB2C().then(data => {
      // Auto-start polling if there's a pending transaction in the last 10 min
      const hasPending = data.some((t: any) => {
        if (t.status !== 'pending') return false;
        const ageMs = Date.now() - new Date(t.created_at).getTime();
        return ageMs < 10 * 60 * 1000;
      });
      if (hasPending) startPolling();
    });
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [userId]);

  const startPolling = () => {
    if (pollRef.current) return;
    setPolling(true);
    pollRef.current = setInterval(async () => {
      const data = await fetchLatestB2C();
      const stillPending = data.some((t: any) => t.status === 'pending');
      if (!stillPending) {
        clearInterval(pollRef.current!);
        pollRef.current = null;
        setPolling(false);
      }
    }, 8000);
  };

  const stopPolling = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    setPolling(false);
  };

  const refresh = () => {
    setLoading(true);
    fetchLatestB2C();
  };

  if (loading) return (
    <div className="flex justify-center py-8">
      <Loader2 className="w-6 h-6 animate-spin text-primary" />
    </div>
  );

  if (txns.length === 0) return (
    <div className="text-center py-12">
      <Smartphone className="w-12 h-12 text-muted-foreground/20 mx-auto mb-3" />
      <p className="text-sm font-semibold">No withdrawals yet</p>
      <p className="text-xs text-muted-foreground mt-1">Initiate a withdrawal to track its live status here</p>
    </div>
  );

  const hasPending = txns.some((t: any) => t.status === 'pending');

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center gap-2">
        <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground flex-1">Recent Payouts</p>
        {hasPending && !polling && (
          <button onClick={startPolling}
            className="flex items-center gap-1.5 text-xs text-primary font-semibold hover:underline">
            <RefreshCw className="w-3 h-3" /> Start Polling
          </button>
        )}
        {polling && (
          <div className="flex items-center gap-1.5 text-xs text-primary font-semibold">
            <Loader2 className="w-3 h-3 animate-spin" />
            <span>Checking every 8s…</span>
            <button onClick={stopPolling} className="text-muted-foreground hover:text-foreground ml-0.5">
              <X className="w-3 h-3" />
            </button>
          </div>
        )}
        <button onClick={refresh} className="p-1 rounded-lg hover:bg-muted transition-colors text-muted-foreground">
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Live tracking banner */}
      {polling && hasPending && (
        <div className="flex items-center gap-2.5 px-3 py-2.5 bg-primary/5 border border-primary/20 rounded-xl">
          <div className="w-2 h-2 rounded-full bg-primary animate-pulse shrink-0" />
          <p className="text-xs font-semibold text-primary">Live tracking — status updates automatically every 8s</p>
        </div>
      )}

      {txns.map((txn: any) => {
        const isPending = txn.status === 'pending';
        const isOk = txn.status === 'completed' || txn.status === 'success';
        const ageMs = Date.now() - new Date(txn.created_at).getTime();
        const ageMin = Math.floor(ageMs / 60000);
        const isFresh = isPending && ageMs < 10 * 60 * 1000;
        return (
          <div key={txn.id} className={`p-4 rounded-2xl border ${isFresh ? 'border-primary/30 bg-primary/5' : 'border-border bg-card'}`}>
            <div className="flex items-start justify-between gap-2 mb-2.5">
              <div className="flex items-center gap-2.5">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${isPending ? 'bg-orange-500/10' : isOk ? 'bg-green-500/10' : 'bg-red-500/10'}`}>
                  <Smartphone className={`w-5 h-5 ${isPending ? 'text-orange-600' : isOk ? 'text-green-600' : 'text-red-500'}`} />
                </div>
                <div>
                  <p className="font-bold text-sm">M-Pesa Payout</p>
                  <p className="text-[10px] text-muted-foreground">{txn.metadata?.phone}</p>
                </div>
              </div>
              <B2CStatusBadge status={txn.status} />
            </div>

            <div className="flex items-center justify-between">
              <p className="text-2xl font-black">KES {Number(txn.amount).toLocaleString()}</p>
              <p className="text-xs text-muted-foreground">
                {ageMin < 60 ? `${ageMin}m ago` : new Date(txn.created_at).toLocaleDateString()}
              </p>
            </div>

            {txn.provider_capture_id && (
              <div className="mt-2 flex items-center gap-1.5">
                <span className="text-[10px] text-muted-foreground">Receipt:</span>
                <span className="font-mono text-[10px] font-bold">{txn.provider_capture_id}</span>
              </div>
            )}

            {isFresh && (
              <div className="mt-2.5 flex items-center gap-1.5 text-[11px] text-primary font-semibold">
                <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                Waiting for M-Pesa confirmation…
              </div>
            )}

            {isPending && ageMs >= 10 * 60 * 1000 && (
              <div className="mt-2.5 flex items-center gap-1.5 text-[11px] text-orange-600 font-semibold">
                <AlertCircle className="w-3.5 h-3.5" />
                Taking longer than usual — contact support if funds aren't received
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Withdrawal History — last 10 B2C payout transactions ────────────────
function WithdrawalHistoryTab({ userId, currency }: { userId: string; currency: CurrencyCode }) {
  const [txns, setTxns] = useState([] as any[]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    supabase
      .from('wallet_transactions')
      .select('*')
      .eq('user_id', userId)
      .eq('type', 'withdrawal').eq('provider', 'mpesa_b2c')
      .order('created_at', { ascending: false })
      .limit(10)
      .then(({ data }) => { setTxns(data ?? []); setLoading(false); });
  }, [userId]);

  const { totalKes, pendingCount, completedCount } = useMemo(() => {
    const completed = txns.filter((t: any) => t.status === 'completed' || t.status === 'success');
    return {
      totalKes: completed.reduce((s: number, t: any) => s + Number(t.amount), 0),
      completedCount: completed.length,
      pendingCount: txns.filter((t: any) => t.status === 'pending').length,
    };
  }, [txns]);

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-3 gap-2">
        <div className="p-3 rounded-2xl bg-orange-500/10 border border-orange-500/20 text-center">
          <p className="text-xs text-muted-foreground mb-1">Total Sent</p>
          <p className="text-base font-black text-orange-600">KES {totalKes.toLocaleString()}</p>
          <p className="text-[9px] text-muted-foreground mt-0.5">≈ {fmtUsd(totalKes / USD_TO_KES, currency)}</p>
        </div>
        <div className="p-3 rounded-2xl bg-green-500/10 border border-green-500/20 text-center">
          <p className="text-xs text-muted-foreground mb-1">Completed</p>
          <p className="text-2xl font-black text-green-600">{completedCount}</p>
        </div>
        <div className="p-3 rounded-2xl bg-muted/50 border border-border text-center">
          <p className="text-xs text-muted-foreground mb-1">Pending</p>
          <p className={`text-2xl font-black ${pendingCount > 0 ? 'text-orange-600' : 'text-foreground'}`}>{pendingCount}</p>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
        </div>
      ) : txns.length === 0 ? (
        <div className="text-center py-12">
          <ArrowUpRight className="w-12 h-12 text-muted-foreground/20 mx-auto mb-3" />
          <p className="text-sm font-semibold">No withdrawal history</p>
          <p className="text-xs text-muted-foreground mt-1">Your M-Pesa payouts will appear here</p>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Last {txns.length} Withdrawals</p>
          {txns.map((txn: any) => {
            const isOk = txn.status === 'completed' || txn.status === 'success';
            const isPending = txn.status === 'pending';
            return (
              <div key={txn.id} className="p-3.5 rounded-2xl border border-border bg-card hover:bg-muted/30 transition-colors">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${isOk ? 'bg-green-500/10' : isPending ? 'bg-orange-500/10' : 'bg-red-500/10'}`}>
                    <Smartphone className={`w-4 h-4 ${isOk ? 'text-green-600' : isPending ? 'text-orange-600' : 'text-red-500'}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <p className="font-semibold text-sm">KES {Number(txn.amount).toLocaleString()}</p>
                      <B2CStatusBadge status={txn.status} />
                    </div>
                    <p className="text-xs text-muted-foreground">{txn.metadata?.phone}</p>
                    {txn.provider_capture_id && (
                      <p className="text-[10px] font-mono text-muted-foreground">Receipt: {txn.provider_capture_id}</p>
                    )}
                    <p className="text-[10px] text-muted-foreground mt-0.5">{new Date(txn.created_at).toLocaleString()}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className={`text-base font-black ${isOk ? 'text-red-500' : 'text-muted-foreground/60'}`}>
                      -{fmtUsd(Number(txn.amount) / USD_TO_KES, currency)}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Spend Limit Card (standalone, mirrors WalletPage's SpendLimitCard) ───
function SpendLimitPanel({ userId, wallet, onSaved }: { userId: string; wallet: any; onSaved: () => void }) {
  const [enabled, setEnabled] = useState(wallet?.spend_limit_enabled ?? false);
  const [limitUsd, setLimitUsd] = useState(wallet?.daily_spend_limit ? String(wallet.daily_spend_limit) : '');
  const [saving, setSaving] = useState(false);
  const [todaySpent, setTodaySpent] = useState(0);

  useEffect(() => {
    const since = new Date(); since.setHours(0, 0, 0, 0);
    supabase.from('wallet_transactions').select('amount')
      .eq('user_id', userId).eq('type', 'withdrawal').gte('created_at', since.toISOString())
      .then(({ data }) => {
        setTodaySpent((data ?? []).reduce((s: number, t: any) => s + Number(t.amount), 0));
      });
  }, [userId]);

  const { limitVal, progress, nearLimit, atLimit } = useMemo(() => {
    const limitVal = parseFloat(limitUsd || '0');
    const progress = enabled && limitVal > 0 ? Math.min((todaySpent / limitVal) * 100, 100) : 0;
    return {
      limitVal,
      progress,
      nearLimit: progress >= 80,
      atLimit: progress >= 100,
    };
  }, [limitUsd, enabled, todaySpent]);

  const handleSave = async () => {
    setSaving(true);
    const { error } = await supabase.from('wallets').update({
      spend_limit_enabled: enabled,
      daily_spend_limit: limitUsd ? parseFloat(limitUsd) : null,
    }).eq('user_id', userId);
    setSaving(false);
    if (error) { toast.error('Failed to save spend limit'); return; }
    toast.success(enabled ? `Daily limit set to $${parseFloat(limitUsd || '0').toFixed(2)}` : 'Spend limit disabled');
    onSaved();
  };

  return (
    <div className="space-y-4">
      {/* Info card */}
      <div className="p-4 rounded-2xl bg-primary/5 border border-primary/20">
        <div className="flex items-center gap-2 mb-2">
          <Shield className="w-5 h-5 text-primary" />
          <p className="font-bold text-sm">Daily Spend Limit</p>
          {enabled && (
            <span className="ml-auto text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary font-bold border border-primary/20">
              Active — ${parseFloat(limitUsd || '0').toFixed(2)}/day
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          Blocks M-Pesa withdrawals once your daily total exceeds this limit. Resets at midnight.
        </p>
      </div>

      {/* Toggle */}
      <div className={`rounded-2xl border overflow-hidden ${atLimit ? 'border-red-500/40 bg-red-500/5' : nearLimit ? 'border-orange-500/40 bg-orange-500/5' : 'border-border'}`}>
        <div className="px-5 py-4">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Shield className={`w-4 h-4 ${enabled ? 'text-primary' : 'text-muted-foreground'}`} />
              <h3 className="font-bold text-sm">Limit Enforcement</h3>
            </div>
            <button onClick={() => setEnabled((v: boolean) => !v)}
              className={`relative w-11 h-6 rounded-full transition-colors ${enabled ? 'bg-primary' : 'bg-muted'}`}>
              <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${enabled ? 'translate-x-5' : 'translate-x-0'}`} />
            </button>
          </div>

          {enabled ? (
            <>
              <div className="mb-3">
                <label className="text-xs text-muted-foreground mb-1.5 block">Limit per day (USD)</label>
                <div className="grid grid-cols-4 gap-2 mb-2">
                  {['10', '25', '50', '100'].map(v => (
                    <button key={v} onClick={() => setLimitUsd(v)}
                      className={`py-2 rounded-xl font-bold text-xs border-2 transition-all ${limitUsd === v ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:border-primary/30'}`}>
                      ${v}
                    </button>
                  ))}
                </div>
                <input type="number" min="1" step="1" placeholder="Custom limit…"
                  value={limitUsd && !['10', '25', '50', '100'].includes(limitUsd) ? limitUsd : ''}
                  onChange={e => setLimitUsd(e.target.value)}
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
                  <div className="h-2.5 bg-muted rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${atLimit ? 'bg-red-500' : nearLimit ? 'bg-orange-500' : 'bg-primary'}`}
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                  {atLimit && (
                    <p className="text-xs text-red-500 font-semibold flex items-center gap-1">
                      <AlertCircle className="w-3 h-3" /> Withdrawals blocked until midnight
                    </p>
                  )}
                  {nearLimit && !atLimit && (
                    <p className="text-xs text-orange-600 font-semibold">
                      ${(limitVal - todaySpent).toFixed(2)} remaining today
                    </p>
                  )}
                </div>
              )}

              <p className="text-xs text-muted-foreground mb-4">
                Withdrawals exceeding this limit will be blocked until midnight (server time).
              </p>
            </>
          ) : (
            <p className="text-xs text-muted-foreground mb-4">
              Enable to cap daily withdrawals to a specific USD amount. Protects against accidental large transfers.
            </p>
          )}

          <button onClick={handleSave} disabled={saving || (enabled && !limitUsd)}
            className="w-full py-2.5 bg-primary text-primary-foreground rounded-xl font-semibold text-sm disabled:opacity-50 flex items-center justify-center gap-2 hover:opacity-90 transition-opacity">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Settings2 className="w-4 h-4" />}
            {saving ? 'Saving…' : 'Save Limit'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Sub-tab config (module-level, esbuild-safe) ──────────────────────────
const MPESA_SUB_TABS = ['deposits', 'withdrawals', 'status', 'limit'] as const;
type MpesaSubTab = typeof MPESA_SUB_TABS[number];

const MPESA_SUB_LABELS: Record<MpesaSubTab, string> = {
  deposits:    '📥 Deposits',
  withdrawals: '📤 Withdrawals',
  status:      '🔄 Live Status',
  limit:       '🛡️ Spend Limit',
};

// ── Main export ───────────────────────────────────────────────────────────
export function MpesaFullTab({ userId, currency, wallet, onSaved }: {
  userId: string;
  currency: string;
  wallet: any;
  onSaved: () => void;
}) {
  const [sub, setSub] = useState('deposits' as MpesaSubTab);
  const cur = currency as CurrencyCode;

  return (
    <div className="space-y-4">
      {/* Sub-tab pills */}
      <div className="flex gap-1.5 overflow-x-auto scrollbar-hide pb-0.5">
        {MPESA_SUB_TABS.map(t => (
          <button key={t} onClick={() => setSub(t)}
            className={`shrink-0 px-3 py-1.5 rounded-full border text-xs font-semibold transition-all ${
              sub === t
                ? 'border-primary bg-primary text-primary-foreground shadow-sm'
                : 'border-border bg-muted/30 text-muted-foreground hover:border-primary/40'
            }`}>
            {MPESA_SUB_LABELS[t]}
          </button>
        ))}
      </div>

      {sub === 'deposits'    && <MpesaPaymentHistory userId={userId} currency={cur} />}
      {sub === 'withdrawals' && <WithdrawalHistoryTab userId={userId} currency={cur} />}
      {sub === 'status'      && <B2CStatusPoller userId={userId} />}
      {sub === 'limit'       && <SpendLimitPanel userId={userId} wallet={wallet} onSaved={onSaved} />}
    </div>
  );
}
