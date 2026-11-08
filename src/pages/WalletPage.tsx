import { useCallback, useEffect, useState } from 'react';
import { backendCapabilities } from '@/services/backendClient';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { Wallet, RefreshCw, Smartphone, ArrowLeftRight, ShieldCheck, Clock3 } from 'lucide-react';

type WalletSnapshot = { id: string; user_id: string; balance: string | number; currency: string; status: string };
type WalletTransaction = { id: string; kind: string; amount: string | number; currency: string; status?: string; created_at: string; note?: string };
type TopUpResult = { status: string; checkout_request_id?: string };

export default function WalletPage() {
  const { user } = useAuth();
  const [wallet, setWallet] = useState<WalletSnapshot | null>(null);
  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [phone, setPhone] = useState('');
  const [amount, setAmount] = useState('');
  const [recipient, setRecipient] = useState('');
  const [transferAmount, setTransferAmount] = useState('');
  const [checkoutId, setCheckoutId] = useState('');
  const [topUpIdempotencyKey, setTopUpIdempotencyKey] = useState('');
  const [topUpStatus, setTopUpStatus] = useState('');
  const [pollCount, setPollCount] = useState(0);

  const refresh = useCallback(async () => {
    if (!user) { setWallet(null); setTransactions([]); setLoading(false); return; }
    try {
      setLoading(true);
      const [balance, history] = await Promise.all([
        backendCapabilities.call<WalletSnapshot>('testagram.wallet.balance', { currency: 'KES' }),
        backendCapabilities.call<{ items?: WalletTransaction[] }>('testagram.wallet.transactions.list', { limit: 50 }),
      ]);
      setWallet(balance);
      setTransactions(Array.isArray(history.items) ? history.items : []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Wallet service is unavailable');
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    if (!checkoutId || topUpStatus !== 'pending') return;
    const timer = window.setInterval(async () => {
      setPollCount(value => value + 1);
      try {
        const result = await backendCapabilities.call<TopUpResult>('testagram.wallet.mpesa.status', { checkout_request_id: checkoutId });
        if (result.status === 'settled' || result.status === 'failed') {
          setTopUpStatus(result.status);
          setTopUpIdempotencyKey('');
          window.clearInterval(timer);
          await refresh();
          toast[result.status === 'settled' ? 'success' : 'error'](result.status === 'settled' ? 'M-Pesa payment verified and wallet credited.' : 'M-Pesa payment failed. No wallet credit was made.');
        }
      } catch {
        // A temporary status API failure is not proof of payment or failure.
      }
    }, 3000);
    return () => window.clearInterval(timer);
  }, [checkoutId, topUpStatus, refresh]);

  const startTopUp = async () => {
    const kes = Number(amount);
    if (!Number.isInteger(kes) || kes < 10 || kes > 150000) { toast.error('Enter a whole KES amount between 10 and 150,000.'); return; }
    if (!phone.trim()) { toast.error('Enter your Kenyan M-Pesa phone number.'); return; }
    setBusy(true);
    try {
      const requestKey = topUpIdempotencyKey || crypto.randomUUID();
      setTopUpIdempotencyKey(requestKey);
      const result = await backendCapabilities.call<TopUpResult>('testagram.wallet.mpesa.stk_push', {
        phone, amount_kes: kes, currency: 'KES', idempotency_key: requestKey,
      });
      if (!result.checkout_request_id) throw new Error('Backend did not return a payment reference. Check wallet status before retrying.');
      setCheckoutId(result.checkout_request_id);
      setTopUpStatus(result.status || 'pending');
      setPollCount(0);
      toast.success('STK Push requested. Complete the prompt on your phone.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to start M-Pesa top-up';
      const code = typeof error === 'object' && error && 'code' in error ? String((error as { code?: unknown }).code ?? '') : '';
      const definitiveFailure = ['INVALID_PHONE','INVALID_CURRENCY','INVALID_AMOUNT','INVALID_IDEMPOTENCY_KEY','MPESA_NOT_CONFIGURED','FX_RATE_UNAVAILABLE','MPESA_REQUEST_REJECTED'].includes(code) ||
        (code === 'MPESA_PROVIDER_UNAVAILABLE' && /authentication failed/i.test(message));
      if (definitiveFailure) setTopUpIdempotencyKey('');
      toast.error(message);
    } finally {
      setBusy(false);
    }
  };

  const sendTransfer = async () => {
    const value = Number(transferAmount);
    if (!recipient.trim() || !Number.isFinite(value) || value <= 0) { toast.error('Enter a recipient ID and a valid amount.'); return; }
    setBusy(true);
    try {
      await backendCapabilities.call('testagram.wallet.transfer', {
        recipient_id: recipient.trim(), amount: value.toFixed(2), idempotency_key: crypto.randomUUID(), note: '',
      });
      toast.success('Wallet transfer completed.');
      setRecipient(''); setTransferAmount('');
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Transfer could not be completed');
    } finally {
      setBusy(false);
    }
  };

  const balance = Number(wallet?.balance ?? 0);
  return (
    <main className="mx-auto w-full max-w-4xl space-y-6 px-4 py-8">
      <header className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">Testagram</p>
          <h1 className="text-2xl font-semibold">Wallet</h1>
          <p className="text-sm text-muted-foreground">Backend-owned balance and verified transactions.</p>
        </div>
        <Button variant="outline" onClick={() => void refresh()} disabled={loading}><RefreshCw className="mr-2 h-4 w-4" />Refresh</Button>
      </header>
      <section className="rounded-2xl border bg-card p-6">
        <div className="flex items-center gap-2 text-sm text-muted-foreground"><Wallet className="h-4 w-4" /> Available balance</div>
        <div className="mt-2 text-4xl font-semibold tabular-nums">{loading ? 'Loading…' : 'KES ' + balance.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
        <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground"><ShieldCheck className="h-4 w-4" /> New ledger starts at zero; only Backend-verified credits change the balance.</div>
        {wallet?.status && <p className="mt-2 text-xs text-muted-foreground">Wallet status: {wallet.status}</p>}
      </section>
      <div className="grid gap-4 md:grid-cols-2">
        <section className="space-y-3 rounded-2xl border bg-card p-5">
          <h2 className="flex items-center gap-2 font-semibold"><Smartphone className="h-4 w-4" /> M-Pesa top-up</h2>
          <p className="text-sm text-muted-foreground">The Backend verifies Safaricom settlement before crediting your wallet.</p>
          <label className="block text-sm">Phone number</label>
          <Input value={phone} onChange={event => setPhone(event.target.value)} placeholder="07… or 2547…" />
          <label className="block text-sm">Amount (KES)</label>
          <Input inputMode="numeric" value={amount} onChange={event => setAmount(event.target.value)} placeholder="e.g. 500" />
          <Button className="w-full" onClick={() => void startTopUp()} disabled={busy || topUpStatus === 'pending'}>{busy ? 'Working…' : 'Request STK Push'}</Button>
          {topUpStatus && <p className="text-sm">Payment status: <strong>{topUpStatus}</strong></p>}
          {checkoutId && <p className="break-all text-xs text-muted-foreground">Checkout reference: {checkoutId}</p>}
          {topUpStatus === 'pending' && <p className="flex items-center gap-2 text-xs text-muted-foreground"><Clock3 className="h-3 w-3" /> Checking provider settlement ({pollCount} checks). Do not submit again.</p>}
        </section>
        <section className="space-y-3 rounded-2xl border bg-card p-5">
          <h2 className="flex items-center gap-2 font-semibold"><ArrowLeftRight className="h-4 w-4" /> Transfer</h2>
          <p className="text-sm text-muted-foreground">Transfers are authorized, balanced and recorded by the Backend ledger.</p>
          <label className="block text-sm">Recipient account ID</label>
          <Input value={recipient} onChange={event => setRecipient(event.target.value)} placeholder="Recipient UUID" />
          <label className="block text-sm">Amount (KES)</label>
          <Input inputMode="decimal" value={transferAmount} onChange={event => setTransferAmount(event.target.value)} placeholder="e.g. 100" />
          <Button className="w-full" variant="outline" onClick={() => void sendTransfer()} disabled={busy || balance <= 0}>Send transfer</Button>
          <p className="text-xs text-muted-foreground">Withdrawals and payouts are disabled until the Backend payout and reconciliation flow is implemented. No legacy Supabase payout route is used.</p>
        </section>
      </div>
      <section className="rounded-2xl border bg-card p-5">
        <h2 className="font-semibold">Transactions</h2>
        {transactions.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">No wallet transactions yet.</p> : (
          <div className="mt-3 divide-y">
            {transactions.map(item => <div key={item.id} className="flex items-center justify-between gap-3 py-3 text-sm">
              <div><p className="font-medium">{item.kind.replaceAll('_', ' ')}</p><p className="text-xs text-muted-foreground">{new Date(item.created_at).toLocaleString()}{item.note ? ' · ' + item.note : ''}</p></div>
              <div className="text-right"><p className="font-semibold tabular-nums">{item.currency} {Number(item.amount).toLocaleString()}</p><p className="text-xs text-muted-foreground">{item.status ?? 'completed'}</p></div>
            </div>)}
          </div>
        )}
      </section>
    </main>
  );
}
