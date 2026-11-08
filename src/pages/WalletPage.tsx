import { useCallback, useEffect, useState } from 'react';
import { Wallet, RefreshCw, ArrowDownToLine, ArrowLeftRight, History, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { walletApi } from '@/services/walletApi';
import { useSEO } from '@/hooks/useSEO';
import { TopBar } from '@/components/layout/TopBar';

type WalletSnapshot = { wallet?: { id?: string; balance?: number | string; currency?: string }; transactions?: any[] };

type WalletPageProps = { initialTab?: string; standaloneTitle?: string };

export default function WalletPage({ initialTab = 'overview', standaloneTitle = 'Wallet' }: WalletPageProps) {
  useSEO({ title: 'Wallet | Testagram', description: 'Manage your Testagram wallet and transaction history.' });
  const [snapshot, setSnapshot] = useState<WalletSnapshot>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [amount, setAmount] = useState('100');
  const [phone, setPhone] = useState('');
  const [recipient, setRecipient] = useState('');
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true); setError('');
    try { setSnapshot(await walletApi.getSnapshot(50)); }
    catch (e) { setError(e instanceof Error ? e.message : 'Wallet could not be loaded.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const startDeposit = async () => {
    const value = Number(amount);
    if (!Number.isFinite(value) || value < 10) { toast.error('Minimum deposit is KES 10.'); return; }
    setBusy(true);
    try {
      if (!snapshot.wallet?.id) throw new Error('Your wallet is not available yet.');
      const result = await walletApi.requestMpesaTopUp({ amountKes: value, phone, currency: (snapshot.wallet?.currency ?? 'KES') as 'KES' | 'USD' });
      toast.success(result.status === 'settled' ? 'Deposit confirmed.' : 'M-Pesa request sent. Check your phone to complete payment.');
      await refresh();
    } catch (e) { toast.error(e instanceof Error ? e.message : 'M-Pesa request failed.'); }
    finally { setBusy(false); }
  };

  const sendTransfer = async () => {
    const value = Number(amount);
    if (!recipient.trim() || !Number.isFinite(value) || value <= 0) { toast.error('Enter a recipient and valid amount.'); return; }
    setBusy(true);
    try {
      const handle = recipient.trim().replace(/^@/, '').toLowerCase();
      const recipientId = (await walletApi.resolveRecipient(handle)).user_id;
      const result = await walletApi.transfer(recipientId, value, 'Wallet transfer');
      toast.success(result.status === 'completed' ? 'Transfer completed.' : 'Transfer submitted.'); await refresh();
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Transfer failed.'); }
    finally { setBusy(false); }
  };

  const balance = Number(snapshot.wallet?.balance ?? 0);
  const transactions = snapshot.transactions ?? [];
  return <div className="min-h-screen bg-background">
    <TopBar title={standaloneTitle} />
    <main data-wallet-tab={initialTab} className="mx-auto w-full max-w-4xl px-4 py-8 space-y-6">
      <header className="flex items-center justify-between gap-3">
        <div><h1 className="text-2xl font-bold flex items-center gap-2"><Wallet className="h-6 w-6" /> {standaloneTitle}</h1><p className="text-sm text-muted-foreground">Your balance and transactions are managed by Testagram Backend.</p></div>
        <button onClick={() => void refresh()} disabled={loading} className="rounded-xl border px-3 py-2 text-sm flex items-center gap-2"><RefreshCw className="h-4 w-4" /> Refresh</button>
      </header>
      {error && <div role="alert" className="rounded-xl border border-destructive/40 p-4 text-sm flex gap-2"><AlertCircle className="h-5 w-5 shrink-0" />{error}</div>}
      <section className="rounded-2xl border bg-card p-6">
        <p className="text-sm text-muted-foreground">Available balance ({snapshot.wallet?.currency ?? 'KES'})</p>
        <p className="text-3xl font-bold mt-2">{loading ? 'Loading…' : `KES ${balance.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}`}</p>
        <p className="text-xs text-muted-foreground mt-2">New wallet balances start at zero. Only verified Backend ledger entries change this amount.</p>
      </section>
      <section className="grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl border bg-card p-5 space-y-3">
          <h2 className="font-semibold flex items-center gap-2"><ArrowDownToLine className="h-4 w-4" /> Deposit with M-Pesa</h2>
          <label className="block text-sm">Phone number<input className="mt-1 w-full rounded-lg border bg-background p-2" value={phone} onChange={e=>setPhone(e.target.value)} placeholder="2547XXXXXXXX" /></label>
          <label className="block text-sm">Amount (KES)<input className="mt-1 w-full rounded-lg border bg-background p-2" type="number" min="10" value={amount} onChange={e=>setAmount(e.target.value)} /></label>
          <button onClick={()=>void startDeposit()} disabled={busy||loading} className="w-full rounded-xl bg-primary px-4 py-2 text-primary-foreground disabled:opacity-50">{busy?'Please wait…':'Request M-Pesa payment'}</button>
        </div>
        <div className="rounded-2xl border bg-card p-5 space-y-3">
          <h2 className="font-semibold flex items-center gap-2"><ArrowLeftRight className="h-4 w-4" /> Send wallet funds</h2>
          <label className="block text-sm">Recipient username or ID<input className="mt-1 w-full rounded-lg border bg-background p-2" value={recipient} onChange={e=>setRecipient(e.target.value)} placeholder="@username" /></label>
          <label className="block text-sm">Amount ({snapshot.wallet?.currency ?? 'KES'})<input className="mt-1 w-full rounded-lg border bg-background p-2" type="number" min="1" value={amount} onChange={e=>setAmount(e.target.value)} /></label>
          <button onClick={()=>void sendTransfer()} disabled={busy||loading} className="w-full rounded-xl border px-4 py-2 disabled:opacity-50">{busy?'Please wait…':'Send transfer'}</button>
        </div>
      </section>
      <section className="rounded-2xl border bg-card p-5">
        <h2 className="font-semibold flex items-center gap-2 mb-4"><History className="h-4 w-4" /> Transaction history</h2>
        {transactions.length===0 ? <p className="text-sm text-muted-foreground">No ledger transactions yet.</p> : <div className="divide-y">{transactions.map((tx,i)=><div key={tx.id??i} className="flex items-center justify-between gap-3 py-3 text-sm"><div><p className="font-medium">{tx.kind??tx.type??'Transaction'}</p><p className="text-xs text-muted-foreground">{tx.created_at?new Date(tx.created_at).toLocaleString():''} · {tx.status??'recorded'}</p></div><p className="font-semibold tabular-nums">{tx.currency??'KES'} {Number(tx.amount??0).toLocaleString()}</p></div>)}</div>}
      </section>
    </main>
  </div>;
}
