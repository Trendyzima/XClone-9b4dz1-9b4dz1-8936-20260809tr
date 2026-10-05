import { useMemo, useState } from 'react';
import { ArrowDownToLine, ArrowUpFromLine, PiggyBank, ShieldCheck, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';

const LIMIT = 20000;

type Props = {
  userId: string;
  walletBalance: number;
  savingsBalance: number;
  currency?: string;
  onRefresh?: () => Promise<unknown> | void;
};

export function WalletSavingsCard({ userId, walletBalance, savingsBalance, currency = 'KES', onRefresh }: Props) {
  const [mode, setMode] = useState<'save' | 'withdraw' | null>(null);
  const [amount, setAmount] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const remaining = Math.max(0, LIMIT - savingsBalance);
  const progress = Math.min(100, (savingsBalance / LIMIT) * 100);
  const numericAmount = Number(amount);
  const maxForMode = mode === 'save' ? Math.min(walletBalance, remaining) : savingsBalance;
  const validAmount = Number.isFinite(numericAmount) && numericAmount > 0 && numericAmount <= maxForMode;
  const label = useMemo(() => mode === 'save' ? 'Save money' : 'Withdraw savings', [mode]);

  const reset = () => { setMode(null); setAmount(''); setConfirming(false); };

  const submit = async () => {
    if (!mode || !validAmount) return;
    setSaving(true);
    try {
      const key = 'savings:' + mode + ':' + userId + ':' + crypto.randomUUID();
      const rpc = mode === 'save' ? 'save_to_wallet_savings' : 'withdraw_from_wallet_savings';
      const { data, error } = await supabase.rpc(rpc, {
        p_amount: Number(numericAmount.toFixed(2)),
        p_idempotency_key: key,
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.reason || 'Savings operation failed');
      await onRefresh?.();
      toast.success(mode === 'save'
        ? 'KES ' + numericAmount.toLocaleString() + ' moved to Savings'
        : 'KES ' + numericAmount.toLocaleString() + ' returned to Wallet');
      reset();
    } catch (err: any) {
      toast.error(err?.message || 'Savings operation failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="rounded-2xl border border-emerald-500/20 bg-gradient-to-br from-emerald-500/10 via-background to-primary/5 p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-500/15">
            <PiggyBank className="h-5 w-5 text-emerald-600" />
          </div>
          <div>
            <p className="text-sm font-bold">Savings</p>
            <p className="text-xs text-muted-foreground">Keep up to KES 20,000 separate from spending</p>
          </div>
        </div>
        <div className="rounded-full bg-emerald-500/10 px-2 py-1 text-[10px] font-bold text-emerald-700 dark:text-emerald-400">
          {Math.round(progress)}%
        </div>
      </div>

      <div className="mt-5 flex items-end justify-between">
        <div>
          <p className="text-3xl font-black">{currency === 'KES' ? 'KES ' : currency + ' '}{savingsBalance.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}</p>
          <p className="mt-1 text-xs text-muted-foreground">KES {remaining.toLocaleString()} remaining capacity</p>
        </div>
        <ShieldCheck className="mb-1 h-5 w-5 text-emerald-600" aria-label="Protected savings account" />
      </div>

      <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-emerald-500 transition-all duration-500" style={{ width: progress + '%' }} />
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
        <span>KES 0</span><span>KES 20,000</span>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <button type="button" onClick={() => { setMode('save'); setAmount(''); setConfirming(false); }} disabled={remaining <= 0 || walletBalance <= 0}
          className="flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-3 py-2.5 text-xs font-bold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40">
          <ArrowDownToLine className="h-4 w-4" /> Save
        </button>
        <button type="button" onClick={() => { setMode('withdraw'); setAmount(''); setConfirming(false); }} disabled={savingsBalance <= 0}
          className="flex items-center justify-center gap-2 rounded-xl border border-border bg-background px-3 py-2.5 text-xs font-bold transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40">
          <ArrowUpFromLine className="h-4 w-4" /> Withdraw
        </button>
      </div>

      {mode && (
        <div className="mt-4 rounded-2xl border border-border bg-background/80 p-4">
          {!confirming ? (
            <>
              <div className="mb-3 flex items-center justify-between">
                <p className="font-bold">{label}</p>
                <button type="button" onClick={reset} className="rounded-full p-1 hover:bg-muted"><X className="h-4 w-4" /></button>
              </div>
              <label className="text-xs font-semibold text-muted-foreground">Amount (KES)</label>
              <input inputMode="decimal" min="1" max={maxForMode} value={amount}
                onChange={e => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="0.00"
                className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-3 text-lg font-bold outline-none focus:ring-2 focus:ring-primary/30" />
              <div className="mt-2 flex justify-between text-[11px] text-muted-foreground">
                <span>Available: KES {maxForMode.toLocaleString()}</span>
                {mode === 'save' && <span>Capacity: KES {remaining.toLocaleString()}</span>}
              </div>
              <button type="button" disabled={!validAmount} onClick={() => setConfirming(true)}
                className="mt-4 w-full rounded-xl bg-primary px-4 py-3 text-sm font-bold text-primary-foreground disabled:opacity-40">Review</button>
            </>
          ) : (
            <>
              <p className="text-sm font-bold">Confirm {mode === 'save' ? 'savings deposit' : 'savings withdrawal'}</p>
              <p className="mt-2 text-sm text-muted-foreground">
                {mode === 'save'
                  ? 'Move KES ' + numericAmount.toLocaleString() + ' from your spendable wallet into Savings?'
                  : 'Move KES ' + numericAmount.toLocaleString() + ' from Savings back into your spendable wallet?'}
              </p>
              {mode === 'save' && <p className="mt-2 text-xs text-muted-foreground">Savings after this: KES {(savingsBalance + numericAmount).toLocaleString()} / KES 20,000</p>}
              <div className="mt-4 grid grid-cols-2 gap-2">
                <button type="button" onClick={() => setConfirming(false)} className="rounded-xl border border-border px-3 py-2.5 text-xs font-bold">Back</button>
                <button type="button" disabled={saving} onClick={submit} className="rounded-xl bg-primary px-3 py-2.5 text-xs font-bold text-primary-foreground disabled:opacity-50">
                  {saving ? 'Processing…' : 'Confirm'}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
