import { useState } from 'react';
import { Wallet, RefreshCw, ArrowDownLeft, History } from 'lucide-react';
import { useWallet } from '@/hooks/useWallet';
import { backendCapabilities } from '@/services/testagramCapabilityClient';
import { toast } from 'sonner';
export function WalletDashboard(){
 const {wallet,loading,fetchWallet}=useWallet();
 const [amount,setAmount]=useState('100');const [phone,setPhone]=useState('');const [busy,setBusy]=useState(false);
 const deposit=async()=>{const value=Number(amount);if(!wallet?.id||!Number.isFinite(value)||value<10){toast.error('Enter a valid amount (minimum KES 10).');return;}setBusy(true);try{await backendCapabilities.call('testagram.wallet.mpesa.stk_push',{wallet_id:wallet.id,amount_kes:value,phone});toast.success('M-Pesa prompt requested. Complete it on your phone.');await fetchWallet();}catch(e){toast.error(e instanceof Error?e.message:'M-Pesa request failed.');}finally{setBusy(false);}};
 return <section className="rounded-2xl border bg-card p-5 space-y-4">
  <div className="flex items-center justify-between"><h2 className="font-semibold flex items-center gap-2"><Wallet className="h-5 w-5"/> Wallet</h2><button onClick={()=>void fetchWallet()} disabled={loading} className="text-sm flex items-center gap-1"><RefreshCw className="h-4 w-4"/> Refresh</button></div>
  <p className="text-2xl font-bold">{loading ? 'Loading…' : wallet ? `KES ${Number(wallet.balance).toLocaleString()}` : 'Unavailable'}</p>
  <p className="text-xs text-muted-foreground">Verified Backend ledger balance. New wallets begin at zero.</p>
  <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]"><input className="rounded-lg border bg-background px-3 py-2" value={phone} onChange={e=>setPhone(e.target.value)} placeholder="M-Pesa phone"/><input className="rounded-lg border bg-background px-3 py-2" type="number" min="10" value={amount} onChange={e=>setAmount(e.target.value)} placeholder="Amount KES"/><button onClick={()=>void deposit()} disabled={busy||loading} className="rounded-lg bg-primary px-4 py-2 text-primary-foreground disabled:opacity-50">{busy?'Sending…':'Deposit'}</button></div>
 </section>;
}
