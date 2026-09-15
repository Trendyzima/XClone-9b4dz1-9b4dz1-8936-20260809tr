import { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useWallet } from '@/hooks/useWallet';
import { supabase } from '@/lib/supabase';
import {
  Wallet, TrendingUp, DollarSign, Loader2, Phone,
  Mail, AlertCircle, CheckCircle2, Filter, Download, X, Smartphone,
  ArrowDownLeft, ArrowUpRight, RefreshCw, Clock, ExternalLink,
  Building2, Copy, Info, WifiOff, Hourglass, BadgeCheck
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatNumber } from '@/lib/utils';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { PayPalTopUp } from '@/components/features/PayPalTopUp';

const sonnerToast = toast;
const USD_TO_KES = 130;

// ── M-Pesa Live Status Badge ────────────────────────────────────────────────
function MpesaStatusBadge({ liveStatus }: { liveStatus: 'pending' | 'completed' | 'failed' }) {
  if (liveStatus === 'completed') {
    return (
      <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 dark:bg-green-900/20 dark:text-green-400 font-medium">
        <BadgeCheck className="w-3 h-3" /> Confirmed
      </span>
    );
  }
  if (liveStatus === 'failed') {
    return (
      <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-900/20 dark:text-red-400 font-medium">
        <WifiOff className="w-3 h-3" /> Failed
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-orange-100 text-orange-700 dark:bg-orange-900/20 dark:text-orange-400 font-medium">
      <Hourglass className="w-3 h-3 animate-pulse" /> Pending
    </span>
  );
}

export function WalletDashboard() {
  const { user } = useAuth();
  const { wallet, loading: walletLoading, fetchWallet, updatePaymentMethods } = useWallet();
  const [transactions, setTransactions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Deposit form state
  const [depositAmount, setDepositAmount] = useState('');
  const [depositPhone, setDepositPhone] = useState('');
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [withdrawPhone, setWithdrawPhone] = useState('');
  const [showDeposit, setShowDeposit] = useState(false);
  const [showWithdraw, setShowWithdraw] = useState(false);
  const [processingDeposit, setProcessingDeposit] = useState(false);
  const [processingWithdraw, setProcessingWithdraw] = useState(false);

  // Polling state
  const [depositPolling, setDepositPolling] = useState(false);
  const [depositPollCount, setDepositPollCount] = useState(0);

  // Payment method settings
  const [mpesaPhone, setMpesaPhone] = useState('');
  const [paypalEmail, setPaypalEmail] = useState('');
  const [savingPayment, setSavingPayment] = useState(false);

  // Transaction filters
  const [filterType, setFilterType] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterPaymentMethod, setFilterPaymentMethod] = useState('all');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');
  const [showFilters, setShowFilters] = useState(false);

  // Live M-Pesa status per transaction — parallel arrays (esbuild guard: no Record<string,T> in state)
  const [mpesaStatusIds, setMpesaStatusIds] = useState<string[]>([]);
  const [mpesaStatusVals, setMpesaStatusVals] = useState<Array<'pending' | 'completed' | 'failed'>>([]);
  const getMpesaStatus = (id: string): 'pending' | 'completed' | 'failed' => {
    const i = mpesaStatusIds.indexOf(id);
    return i >= 0 ? mpesaStatusVals[i] : 'pending';
  };
  const setMpesaStatusFor = (id: string, val: 'pending' | 'completed' | 'failed') => {
    setMpesaStatusIds(prev => {
      const i = prev.indexOf(id);
      if (i >= 0) { setMpesaStatusVals(pv => { const n = [...pv]; n[i] = val; return n; }); return prev; }
      setMpesaStatusVals(pv => [...pv, val]);
      return [...prev, id];
    });
  };

  useEffect(() => {
    if (user) fetchTransactions();
  }, [user, filterType, filterStatus, filterPaymentMethod, filterDateFrom, filterDateTo]);

  useEffect(() => {
    if (wallet) {
      setMpesaPhone(wallet.mpesa_phone || '');
      setPaypalEmail(wallet.paypal_email || '');
      setLoading(false);
    }
  }, [wallet]);

  useEffect(() => {
    if (mpesaPhone) {
      setDepositPhone(mpesaPhone);
      setWithdrawPhone(mpesaPhone);
    }
  }, [mpesaPhone]);

  // ── Poll pending M-Pesa transactions for live status ─────────────
  const pollMpesaStatuses = async (txList: any[]) => {
    const pending = txList.filter(
      t => t.payment_method === 'mpesa' && t.status === 'pending' && t.reference
    );
    if (pending.length === 0) return;

    // Use individual setMpesaStatusFor calls (esbuild guard: no Object.keys on index-sig object)
    await Promise.allSettled(
      pending.map(async (tx) => {
        try {
          const { data } = await supabase.functions.invoke('mpesa-stk-status', {
            body: { checkout_request_id: tx.reference },
          });
          if (data?.status === 'completed') setMpesaStatusFor(tx.id, 'completed');
          else if (data?.status === 'failed' || data?.status === 'cancelled') setMpesaStatusFor(tx.id, 'failed');
          else setMpesaStatusFor(tx.id, 'pending');
        } catch {
          setMpesaStatusFor(tx.id, 'pending');
        }
      })
    );
  };

  const fetchTransactions = async () => {
    if (!user) return;
    let query = supabase
      .from('wallet_transactions')
      .select('*')
      .eq('user_id', user.id);

    if (filterType !== 'all') query = query.eq('type', filterType);
    if (filterStatus !== 'all') query = query.eq('status', filterStatus);
    if (filterPaymentMethod !== 'all') query = query.eq('payment_method', filterPaymentMethod);
    if (filterDateFrom) query = query.gte('created_at', new Date(filterDateFrom).toISOString());
    if (filterDateTo) {
      const end = new Date(filterDateTo);
      end.setHours(23, 59, 59, 999);
      query = query.lte('created_at', end.toISOString());
    }

    const { data } = await query.order('created_at', { ascending: false }).limit(100);
    setTransactions(data || []);
    if (data) pollMpesaStatuses(data);
  };

  // ─── M-Pesa Deposit via STK Push ────────────────────────────────
  const handleMpesaDeposit = async () => {
    if (!depositAmount || parseFloat(depositAmount) <= 0) { toast.error('Enter a valid amount'); return; }
    if (depositPhone.replace(/\D/g, '').length < 9) { toast.error('Enter a valid M-Pesa phone number'); return; }

    setProcessingDeposit(true);
    try {
      const kesAmount = Math.ceil(parseFloat(depositAmount) * USD_TO_KES);
      const { data, error } = await supabase.functions.invoke('mpesa-stk-push', {
        body: { phone: depositPhone, amount: kesAmount, purpose: 'deposit', metadata: { wallet_id: wallet?.id } },
      });

      if (error) {
        let msg = error.message;
        if (error instanceof FunctionsHttpError) { try { msg = await error.context?.text() || msg; } catch {} }
        throw new Error(msg);
      }

      setDepositPolling(true);
      setDepositPollCount(0);
      toast.success(data.customer_message || 'STK Push sent — check your phone!');

      let attempts = 0;
      const interval = setInterval(async () => {
        attempts++;
        setDepositPollCount(attempts);

        if (attempts >= 18) {
          clearInterval(interval);
          setDepositPolling(false);
          toast.error('Payment verification timed out. If you paid, it will be credited shortly.');
          return;
        }

        try {
          const { data: statusData } = await supabase.functions.invoke('mpesa-stk-status', {
            body: { checkout_request_id: data.checkout_request_id },
          });
          if (statusData?.status === 'completed') {
            clearInterval(interval);
            setDepositPolling(false);
            // Credit wallet via RPC (also logs transaction)
            await supabase.rpc('add_to_wallet', { p_user_id: user!.id, p_amount: parseFloat(depositAmount) });
            toast.success(`Deposit of KES ${kesAmount.toLocaleString()} confirmed! +$${parseFloat(depositAmount).toFixed(2)} added to wallet.`);
            setShowDeposit(false);
            setDepositAmount('');
            fetchWallet();
            fetchTransactions();
          } else if (statusData?.status === 'failed' || statusData?.status === 'cancelled') {
            clearInterval(interval);
            setDepositPolling(false);
            toast.error('M-Pesa payment was not completed.');
          }
        } catch { /* ignore */ }
      }, 5000);
    } catch (err: any) {
      toast.error(err.message || 'Failed to initiate deposit');
    } finally {
      setProcessingDeposit(false);
    }
  };

  // ─── M-Pesa Withdrawal via B2C ──────────────────────────────────
  const handleMpesaWithdraw = async () => {
    if (!withdrawAmount || parseFloat(withdrawAmount) <= 0) { toast.error('Enter a valid amount'); return; }
    if (parseFloat(withdrawAmount) > (wallet?.balance || 0)) { toast.error('Insufficient balance'); return; }
    if (withdrawPhone.replace(/\D/g, '').length < 9) { toast.error('Enter a valid M-Pesa phone number'); return; }

    setProcessingWithdraw(true);
    try {
      const kesAmount = Math.floor(parseFloat(withdrawAmount) * USD_TO_KES);
      const { data, error } = await supabase.functions.invoke('mpesa-b2c-payout', {
        body: { phone: withdrawPhone, amount: kesAmount, purpose: 'withdrawal' },
      });

      if (error) {
        let msg = error.message;
        if (error instanceof FunctionsHttpError) { try { msg = await error.context?.text() || msg; } catch {} }
        throw new Error(msg);
      }

      if (wallet) {
        await supabase.from('wallet_transactions').insert({
          wallet_id: wallet.id,
          user_id: user!.id,
          type: 'withdrawal',
          amount: parseFloat(withdrawAmount),
          payment_method: 'mpesa',
          status: 'pending',
          description: `M-Pesa withdrawal to ${withdrawPhone} — KES ${kesAmount.toLocaleString()}`,
        });
      }

      toast.success('Withdrawal initiated! Funds will arrive shortly.');
      setShowWithdraw(false);
      setWithdrawAmount('');
      fetchTransactions();
    } catch (err: any) {
      toast.error(err.message || 'Failed to initiate withdrawal');
    } finally {
      setProcessingWithdraw(false);
    }
  };

  const handleUpdatePaymentMethods = async () => {
    setSavingPayment(true);
    const result = await updatePaymentMethods(mpesaPhone, paypalEmail);
    setSavingPayment(false);
    if (result.success) toast.success('Payment methods updated successfully');
    else toast.error(result.error || 'Failed to update payment methods');
  };

  if (loading || walletLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!wallet) {
    return (
      <div className="text-center py-12">
        <AlertCircle className="w-16 h-16 mx-auto mb-4 text-muted-foreground" />
        <h3 className="text-lg font-semibold mb-2">Wallet Not Found</h3>
        <p className="text-muted-foreground mb-4">Creating your wallet…</p>
        <Button onClick={fetchWallet}><Wallet className="w-4 h-4 mr-2" />Create Wallet</Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">

      {/* ── Balance Card ── */}
      <div className="bg-gradient-to-br from-green-600/10 via-primary/10 to-purple-500/10 border-2 border-primary/20 rounded-2xl p-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-primary/20 rounded-full">
              <Wallet className="w-6 h-6 text-primary" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Available Balance</p>
              <h2 className="text-4xl font-bold">${formatNumber(wallet.balance || 0)}</h2>
              <p className="text-sm text-muted-foreground mt-0.5">≈ KES {(wallet.balance * USD_TO_KES).toLocaleString()}</p>
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={() => { fetchWallet(); fetchTransactions(); }}>
            <RefreshCw className="w-4 h-4" />
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Button onClick={() => setShowDeposit(!showDeposit)} className="bg-green-600 hover:bg-green-700 h-12">
            <ArrowDownLeft className="w-4 h-4 mr-2" />Deposit
          </Button>
          <Button onClick={() => setShowWithdraw(!showWithdraw)} variant="outline" className="h-12 border-2">
            <ArrowUpRight className="w-4 h-4 mr-2" />Withdraw
          </Button>
        </div>
      </div>

      {/* ── Deposit Form ── */}
      {showDeposit && (
        <div className="bg-card border-2 border-green-600/20 rounded-2xl p-6 space-y-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="p-2 bg-green-600/10 rounded-lg"><Smartphone className="w-5 h-5 text-green-600" /></div>
            <div>
              <h3 className="font-bold">M-Pesa Deposit</h3>
              <p className="text-xs text-muted-foreground">Instant STK Push — no waiting</p>
            </div>
          </div>
          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium mb-1 block">Amount (USD)</label>
              <Input type="number" placeholder="10.00" value={depositAmount}
                onChange={(e) => setDepositAmount(e.target.value)} min="1" step="0.01" className="h-12 text-lg" />
              {depositAmount && (
                <p className="text-xs text-green-600 mt-1 font-medium">
                  = KES {Math.ceil(parseFloat(depositAmount || '0') * USD_TO_KES).toLocaleString()}
                </p>
              )}
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">M-Pesa Phone Number</label>
              <Input type="tel" placeholder="0712 345 678" value={depositPhone}
                onChange={(e) => setDepositPhone(e.target.value)} className="h-12" />
            </div>
          </div>
          {depositPolling ? (
            <div className="bg-green-600/5 border border-green-600/20 rounded-xl p-4 text-center space-y-2">
              <div className="flex items-center justify-center gap-2">
                <Clock className="w-5 h-5 text-green-600 animate-spin" />
                <span className="font-semibold text-green-600">Waiting for payment…</span>
              </div>
              <p className="text-sm text-muted-foreground">Check your phone for the M-Pesa prompt and enter your PIN.</p>
              <p className="text-xs text-muted-foreground">({depositPollCount * 5}s elapsed)</p>
            </div>
          ) : (
            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => setShowDeposit(false)}>Cancel</Button>
              <Button className="flex-1 bg-green-600 hover:bg-green-700" onClick={handleMpesaDeposit}
                disabled={processingDeposit || !depositAmount || !depositPhone}>
                {processingDeposit ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Smartphone className="w-4 h-4 mr-2" />}
                Send STK Push
              </Button>
            </div>
          )}
        </div>
      )}

      {/* ── Paybill Deposit ── */}
      {showDeposit && (
        <div className="bg-card border-2 border-green-600/10 rounded-2xl p-5 space-y-3">
          <div className="flex items-center gap-2 mb-1">
            <Building2 className="w-5 h-5 text-green-700" />
            <h4 className="font-semibold text-sm">Or Deposit via Paybill</h4>
          </div>
          <div className="bg-green-600/5 border border-green-600/20 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Paybill Number</span>
              <div className="flex items-center gap-2">
                <span className="font-bold text-lg tracking-widest">174379</span>
                <button onClick={() => { navigator.clipboard.writeText('174379'); sonnerToast.success('Copied!'); }} className="p-1 hover:bg-muted rounded">
                  <Copy className="w-3.5 h-3.5 text-muted-foreground" />
                </button>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Account Number</span>
              <div className="flex items-center gap-2">
                <span className="font-bold">{user?.id?.slice(0, 8).toUpperCase() || 'WALLET'}</span>
                <button onClick={() => { navigator.clipboard.writeText(user?.id?.slice(0, 8).toUpperCase() || 'WALLET'); sonnerToast.success('Copied!'); }} className="p-1 hover:bg-muted rounded">
                  <Copy className="w-3.5 h-3.5 text-muted-foreground" />
                </button>
              </div>
            </div>
          </div>
          <div className="flex items-start gap-2 text-xs text-muted-foreground">
            <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>Go to M-Pesa → Lipa na M-Pesa → Pay Bill → enter the numbers above. Funds credit within 5 minutes.</span>
          </div>
        </div>
      )}

      {/* ── Withdraw Form ── */}
      <PayPalTopUp />

      {showWithdraw && (
        <div className="bg-card border-2 border-orange-500/20 rounded-2xl p-6 space-y-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="p-2 bg-orange-500/10 rounded-lg"><ArrowUpRight className="w-5 h-5 text-orange-500" /></div>
            <div>
              <h3 className="font-bold">Withdraw via M-Pesa</h3>
              <p className="text-xs text-muted-foreground">Funds sent directly to your M-Pesa</p>
            </div>
          </div>
          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium mb-1 block">Amount (USD) — Max ${formatNumber(wallet.balance)}</label>
              <Input type="number" placeholder="10.00" value={withdrawAmount}
                onChange={(e) => setWithdrawAmount(e.target.value)} max={wallet.balance} min="1" step="0.01" className="h-12 text-lg" />
              {withdrawAmount && (
                <p className="text-xs text-orange-500 mt-1 font-medium">
                  = KES {Math.floor(parseFloat(withdrawAmount || '0') * USD_TO_KES).toLocaleString()}
                </p>
              )}
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">M-Pesa Phone Number</label>
              <Input type="tel" placeholder="0712 345 678" value={withdrawPhone}
                onChange={(e) => setWithdrawPhone(e.target.value)} className="h-12" />
            </div>
          </div>
          <div className="bg-orange-500/5 border border-orange-500/20 rounded-lg p-3 text-xs text-muted-foreground">
            <AlertCircle className="w-4 h-4 inline mr-1 text-orange-500" />
            Withdrawals are processed within minutes. Minimum withdrawal: KES 100.
          </div>
          <div className="flex gap-3">
            <Button variant="outline" className="flex-1" onClick={() => setShowWithdraw(false)}>Cancel</Button>
            <Button className="flex-1 bg-orange-500 hover:bg-orange-600" onClick={handleMpesaWithdraw}
              disabled={processingWithdraw || !withdrawAmount || parseFloat(withdrawAmount) > wallet.balance || !withdrawPhone}>
              {processingWithdraw ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <ArrowUpRight className="w-4 h-4 mr-2" />}
              Withdraw via M-Pesa
            </Button>
          </div>
        </div>
      )}

      {/* ── Payment Methods ── */}
      <div className="bg-gradient-to-br from-blue-500/5 to-purple-500/5 border-2 border-blue-500/20 rounded-2xl p-6">
        <div className="flex items-center gap-2 mb-4">
          <DollarSign className="w-5 h-5 text-blue-600" />
          <h3 className="font-bold text-lg">Payment Methods</h3>
        </div>
        <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3 mb-4">
          <div className="flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-blue-600 mt-0.5 shrink-0" />
            <p className="text-sm text-muted-foreground">Save your M-Pesa number and PayPal email to speed up future transactions.</p>
          </div>
        </div>
        <div className="space-y-4">
          <div>
            <label className="text-sm font-semibold flex items-center gap-2 mb-2">
              <Phone className="w-4 h-4 text-green-600" />M-Pesa Phone
              {mpesaPhone && <CheckCircle2 className="w-4 h-4 text-green-600" />}
            </label>
            <Input type="tel" placeholder="+254712345678" value={mpesaPhone}
              onChange={(e) => setMpesaPhone(e.target.value)} className="border-2" />
          </div>
          <div>
            <label className="text-sm font-semibold flex items-center gap-2 mb-2">
              <Mail className="w-4 h-4 text-blue-600" />PayPal Email
              {paypalEmail && <CheckCircle2 className="w-4 h-4 text-green-600" />}
            </label>
            <Input type="email" placeholder="you@paypal.com" value={paypalEmail}
              onChange={(e) => setPaypalEmail(e.target.value)} className="border-2" />
          </div>
          <Button onClick={handleUpdatePaymentMethods}
            className="w-full bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700"
            disabled={savingPayment || (!mpesaPhone && !paypalEmail)}>
            {savingPayment ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <CheckCircle2 className="w-4 h-4 mr-2" />}
            Save Payment Methods
          </Button>
        </div>
      </div>

      {/* ── Transaction History ── */}
      <div className="bg-card border border-border rounded-2xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-lg">Transaction History</h3>
          <div className="flex gap-2">
            <Button onClick={() => { const csv = generateCSV(transactions); downloadCSV(csv, `transactions-${new Date().toISOString().split('T')[0]}.csv`); }}
              variant="outline" size="sm">
              <Download className="w-4 h-4 mr-1" />CSV
            </Button>
            <Button onClick={() => setShowFilters(!showFilters)} variant="outline" size="sm">
              <Filter className="w-4 h-4 mr-1" />Filter
            </Button>
          </div>
        </div>

        {showFilters && (
          <div className="bg-muted/50 rounded-xl p-4 mb-4 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div>
                <label className="text-xs font-semibold mb-1 block">Type</label>
                <select value={filterType} onChange={(e) => setFilterType(e.target.value)}
                  className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm">
                  <option value="all">All Types</option>
                  <option value="deposit">Deposit</option>
                  <option value="withdrawal">Withdrawal</option>
                  <option value="earnings">Earnings</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold mb-1 block">Status</label>
                <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}
                  className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm">
                  <option value="all">All</option>
                  <option value="pending">Pending</option>
                  <option value="completed">Completed</option>
                  <option value="failed">Failed</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold mb-1 block">Method</label>
                <select value={filterPaymentMethod} onChange={(e) => setFilterPaymentMethod(e.target.value)}
                  className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm">
                  <option value="all">All Methods</option>
                  <option value="mpesa">M-Pesa</option>
                  <option value="paypal">PayPal</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold mb-1 block">Date Range</label>
                <div className="flex gap-1">
                  <Input type="date" value={filterDateFrom} onChange={(e) => setFilterDateFrom(e.target.value)} className="text-xs h-9" />
                  <Input type="date" value={filterDateTo} onChange={(e) => setFilterDateTo(e.target.value)} className="text-xs h-9" />
                </div>
              </div>
            </div>
            <Button onClick={() => { setFilterType('all'); setFilterStatus('all'); setFilterPaymentMethod('all'); setFilterDateFrom(''); setFilterDateTo(''); }}
              variant="outline" size="sm" className="w-full">
              <X className="w-4 h-4 mr-2" />Clear Filters
            </Button>
          </div>
        )}

        {transactions.length === 0 ? (
          <p className="text-center text-muted-foreground py-10">No transactions yet</p>
        ) : (
          <div className="space-y-3">
            {transactions.map((tx) => (
              <div key={tx.id} className="flex items-center justify-between p-3 bg-muted/40 rounded-xl hover:bg-muted/60 transition-colors gap-2">
                <div className="flex items-center gap-3 min-w-0">
                  <div className={`p-2 rounded-full shrink-0 ${
                    tx.type === 'deposit' || tx.type === 'earnings'
                      ? 'bg-green-100 text-green-600 dark:bg-green-900/20 dark:text-green-400'
                      : 'bg-red-100 text-red-600 dark:bg-red-900/20 dark:text-red-400'
                  }`}>
                    {tx.type === 'deposit' || tx.type === 'earnings'
                      ? <ArrowDownLeft className="w-4 h-4" />
                      : <ArrowUpRight className="w-4 h-4" />}
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold capitalize text-sm truncate">{tx.type.replace(/_/g, ' ')}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {tx.payment_method ? `${tx.payment_method.toUpperCase()} · ` : ''}
                      {new Date(tx.created_at).toLocaleDateString()}
                    </p>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <p className={`text-base font-bold ${
                    tx.type === 'deposit' || tx.type === 'earnings' ? 'text-green-600' : 'text-red-500'
                  }`}>
                    {tx.type === 'deposit' || tx.type === 'earnings' ? '+' : '-'}${tx.amount}
                  </p>
                  {/* Live M-Pesa status badge for pending M-Pesa txns */}
                  {tx.payment_method === 'mpesa' && tx.status === 'pending' ? (
                    <MpesaStatusBadge liveStatus={getMpesaStatus(tx.id)} />
                  ) : (
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      tx.status === 'completed' ? 'bg-green-100 text-green-700 dark:bg-green-900/20 dark:text-green-400' :
                      tx.status === 'pending'   ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/20 dark:text-orange-400' :
                                                  'bg-red-100 text-red-700 dark:bg-red-900/20 dark:text-red-400'
                    }`}>
                      {tx.status}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function generateCSV(transactions: any[]): string {
  const headers = ['Date', 'Type', 'Amount', 'Status', 'Payment Method', 'Description'];
  const rows = transactions.map(tx => [
    new Date(tx.created_at).toLocaleString(),
    tx.type, tx.amount, tx.status,
    tx.payment_method || 'N/A',
    tx.description || ''
  ]);
  return [headers.join(','), ...rows.map(row => row.map(cell => `"${cell}"`).join(','))].join('\n');
}

function downloadCSV(csv: string, filename: string) {
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  window.URL.revokeObjectURL(url);
}

// suppress unused import warning
const _trendingUp = TrendingUp;
const _externalLink = ExternalLink;
