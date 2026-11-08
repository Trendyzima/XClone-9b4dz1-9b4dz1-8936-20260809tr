// M-Pesa wallet views backed exclusively by the authenticated Testagram Backend.
import { useEffect, useRef, useState } from 'react';
import { Loader2, Smartphone, ArrowUpRight, RefreshCw, X, Shield, AlertCircle } from 'lucide-react';
import { MpesaPaymentHistory } from '@/components/features/WalletExtras';
import { walletApi, type WalletTransaction } from '@/services/walletApi';

type CurrencyCode = 'USD' | 'KES' | 'EUR';
type MpesaSubTab = 'deposits' | 'withdrawals' | 'status' | 'limit';

const labels: Record<MpesaSubTab, string> = {
  deposits: '📥 Deposits',
  withdrawals: '📤 Withdrawals',
  status: '🔄 Live Status',
  limit: '🛡️ Spend Limit',
};

function StatusBadge({ status }: { status?: string }) {
  const value = status ?? 'pending';
  const styles: Record<string, string> = {
    pending: 'bg-orange-500/10 text-orange-600 border-orange-500/20',
    initiating: 'bg-orange-500/10 text-orange-600 border-orange-500/20',
    settled: 'bg-green-500/10 text-green-600 border-green-500/20',
    completed: 'bg-green-500/10 text-green-600 border-green-500/20',
    failed: 'bg-red-500/10 text-red-500 border-red-500/20',
  };
  return <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${styles[value] ?? styles.pending}`}>{value}</span>;
}

function MpesaTopUpStatusPoller({ userId }: { userId: string }) {
  const [txns, setTxns] = useState<WalletTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [polling, setPolling] = useState(false);
  const [pollError, setPollError] = useState('');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchLatest = async () => {
    const result = await walletApi.listTransactions(100);
    const items = result.items.filter(tx => tx.kind === 'deposit' && tx.provider === 'mpesa');
    setTxns(items);
    setLoading(false);
    return items;
  };

  const stopPolling = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
    setPolling(false);
  };

  const startPolling = () => {
    if (pollRef.current) return;
    setPolling(true);
    pollRef.current = setInterval(async () => {
      try {
        const items = await fetchLatest();
        const pending = items.filter(tx => tx.status === 'pending' || tx.status === 'initiating');
        await Promise.all(pending.filter(tx => tx.checkout_request_id).map(tx =>
          walletApi.getMpesaTopUpStatus(tx.checkout_request_id!).catch(error => {
            setPollError(error instanceof Error ? error.message : 'Could not refresh M-Pesa status');
            return null;
          }),
        ));
        const refreshed = await fetchLatest();
        if (!refreshed.some(tx => tx.status === 'pending' || tx.status === 'initiating')) stopPolling();
      } catch (error) {
        setPollError(error instanceof Error ? error.message : 'Could not refresh M-Pesa status');
      }
    }, 8000);
  };

  useEffect(() => {
    let active = true;
    setLoading(true);
    walletApi.listTransactions(100).then(result => {
      if (!active) return;
      const items = result.items.filter(tx => tx.kind === 'deposit' && tx.provider === 'mpesa');
      setTxns(items);
      setLoading(false);
      if (items.some(tx => tx.status === 'pending' || tx.status === 'initiating')) startPolling();
    }).catch(error => {
      if (!active) return;
      setPollError(error instanceof Error ? error.message : 'Could not load M-Pesa transactions');
      setLoading(false);
    });
    return () => { active = false; stopPolling(); };
  }, [userId]);

  if (loading) return <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;
  if (!txns.length) return <div className="text-center py-12"><Smartphone className="w-12 h-12 text-muted-foreground/20 mx-auto mb-3" /><p className="text-sm font-semibold">No M-Pesa deposits yet</p><p className="text-xs text-muted-foreground mt-1">Verified STK Push deposits will appear here.</p></div>;

  return <div className="space-y-3">
    <div className="flex items-center gap-2">
      <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground flex-1">Recent M-Pesa deposits</p>
      {polling && <span className="flex items-center gap-1 text-xs text-primary"><Loader2 className="w-3 h-3 animate-spin" /> Live status</span>}
      <button onClick={() => { setLoading(true); void fetchLatest().catch(e => setPollError(e instanceof Error ? e.message : 'Refresh failed')).finally(() => setLoading(false)); }} className="p-1 rounded-lg hover:bg-muted text-muted-foreground"><RefreshCw className="w-3.5 h-3.5" /></button>
      {polling && <button onClick={stopPolling} className="p-1 text-muted-foreground"><X className="w-3.5 h-3.5" /></button>}
    </div>
    {pollError && <p role="alert" className="text-xs text-orange-600">{pollError}</p>}
    {txns.map(tx => <div key={tx.id} className="p-4 rounded-2xl border border-border bg-card">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2"><Smartphone className="w-5 h-5 text-primary" /><div><p className="font-bold text-sm">M-Pesa deposit</p><p className="text-[10px] text-muted-foreground">{tx.phone || 'Safaricom STK Push'}</p></div></div>
        <StatusBadge status={tx.status} />
      </div>
      <div className="mt-3 flex justify-between items-center"><p className="text-xl font-black">{tx.currency} {Number(tx.amount).toLocaleString()}</p><p className="text-xs text-muted-foreground">{new Date(tx.created_at).toLocaleString()}</p></div>
      {tx.receipt_number && <p className="mt-2 text-[10px] text-muted-foreground">M-Pesa receipt: <span className="font-mono font-bold">{tx.receipt_number}</span></p>}
      {tx.checkout_request_id && <p className="mt-1 text-[10px] text-muted-foreground">Checkout: <span className="font-mono">{tx.checkout_request_id}</span></p>}
    </div>)}
  </div>;
}

function WithdrawalHistoryTab() {
  const [txns, setTxns] = useState<WalletTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    walletApi.listTransactions(100).then(result => {
      if (active) setTxns(result.items.filter(tx => tx.kind === 'withdrawal' && tx.provider === 'mpesa_b2c'));
    }).catch(() => { if (active) setTxns([]); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  if (loading) return <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;
  if (!txns.length) return <div className="rounded-2xl border border-border p-5 text-center space-y-2"><ArrowUpRight className="w-8 h-8 mx-auto text-muted-foreground/40" /><p className="text-sm font-semibold">M-Pesa payouts are not enabled yet</p><p className="text-xs text-muted-foreground">The current Backend supports verified STK deposits and wallet transfers. B2C payout settlement must be implemented before withdrawals can be offered.</p></div>;
  return <div className="space-y-2">{txns.map(tx => <div key={tx.id} className="rounded-xl border p-3 flex justify-between"><div><p className="font-semibold">{tx.currency} {Number(tx.amount).toLocaleString()}</p><p className="text-xs text-muted-foreground">{new Date(tx.created_at).toLocaleString()}</p></div><StatusBadge status={tx.status} /></div>)}</div>;
}

function SpendLimitPanel({ wallet }: { wallet: any }) {
  return <div className="rounded-2xl border border-orange-500/20 bg-orange-500/5 p-4 space-y-2">
    <div className="flex items-center gap-2"><Shield className="w-5 h-5 text-orange-600" /><p className="font-bold text-sm">Daily spend limit</p></div>
    <p className="text-xs text-muted-foreground">Spend-limit settings are not yet enforced by the canonical Backend wallet ledger. This control is intentionally read-only until server-side limits and transaction enforcement are implemented.</p>
    {wallet?.daily_spend_limit != null && <p className="text-xs text-muted-foreground">Legacy setting detected: {wallet.daily_spend_limit}. It is not treated as an active security control.</p>}
    <div className="flex items-center gap-2 text-xs text-orange-700"><AlertCircle className="w-4 h-4" /> No client-side-only limit will be presented as financial protection.</div>
  </div>;
}

export function MpesaFullTab({ userId, currency: _currency, wallet, onSaved: _onSaved }: {
  userId: string;
  currency: string;
  wallet: any;
  onSaved: () => void;
}) {
  const [sub, setSub] = useState<MpesaSubTab>('deposits');
  return <div className="space-y-4">
    <div className="flex gap-1.5 overflow-x-auto scrollbar-hide pb-0.5">
      {(Object.keys(labels) as MpesaSubTab[]).map(tab => <button key={tab} onClick={() => setSub(tab)}
        className={`shrink-0 px-3 py-1.5 rounded-full border text-xs font-semibold transition-all ${sub === tab ? 'border-primary bg-primary text-primary-foreground shadow-sm' : 'border-border bg-muted/30 text-muted-foreground hover:border-primary/40'}`}>
        {labels[tab]}
      </button>)}
    </div>
    {sub === 'deposits' && <MpesaPaymentHistory userId={userId} currency={_currency as CurrencyCode} />}
    {sub === 'withdrawals' && <WithdrawalHistoryTab />}
    {sub === 'status' && <MpesaTopUpStatusPoller userId={userId} />}
    {sub === 'limit' && <SpendLimitPanel wallet={wallet} />}
  </div>;
}
