import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { MapPin, PackageCheck, Truck, Navigation, Loader2, ShieldCheck, PartyPopper } from 'lucide-react';
import { toast } from 'sonner';

type Delivery = {
  id:string; order_id:string; buyer_id:string; seller_id:string; status:string; dropoff_address:string;
  courier_id:string|null; courier_lat:number|null; courier_lng:number|null; courier_updated_at:string|null;
  eta_minutes:number|null; currency:string; delivery_fee_minor:number; payment_status:string;
  payment_confirmed_at:string|null; delivery_verified_at:string|null; payout_status:string; courier_payout_minor:number;
};

type Agent = { user_id:string; active:boolean; blocked_at:string|null };

export function MarketplaceDeliveryTracker({ deliveryId, compact=false }: { deliveryId:string; compact?:boolean }) {
  const { user } = useAuth();
  const [delivery,setDelivery]=useState<Delivery|null>(null);
  const [agent,setAgent]=useState<Agent|null>(null);
  const [sharing,setSharing]=useState(false);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [withdrawResult,setWithdrawResult]=useState<{gross:number;fee:number;net:number;currency:string}|null>(null);
  const [deliveryCode,setDeliveryCode]=useState('');
  const [codeBusy,setCodeBusy]=useState(false);
  const [issuedCode,setIssuedCode]=useState<string|null>(null);

  useEffect(() => {
    let alive=true;
    const load=async()=> {
      const {data}=await supabase.from('marketplace_deliveries').select('*').eq('id',deliveryId).maybeSingle();
      if(alive) setDelivery(data as Delivery|null);
      if(alive) setLoading(false);
    };
    void load();
    if(user) void supabase.from('marketplace_delivery_agents').select('user_id,active,blocked_at').eq('user_id',user.id).maybeSingle().then(({data})=>{ if(alive) setAgent(data as Agent|null); });
    const channel=supabase.channel('marketplace-delivery-'+deliveryId)
      .on('postgres_changes',{event:'UPDATE',schema:'public',table:'marketplace_deliveries',filter:'id=eq.'+deliveryId},
        payload=>{ if(alive) setDelivery(payload.new as Delivery); })
      .on('postgres_changes',{event:'INSERT',schema:'public',table:'marketplace_delivery_events',filter:'delivery_id=eq.'+deliveryId},
        ()=>void load())
      .subscribe();
    return()=>{ alive=false; void supabase.removeChannel(channel); };
  },[deliveryId,user]);

  useEffect(()=>{
    if(!user||!delivery||delivery.courier_id!==user.id||delivery.status==='delivered'||delivery.status==='cancelled'||!sharing) return;
    const watch=navigator.geolocation?.watchPosition(async p=>{
      const {error}=await supabase.rpc('update_marketplace_delivery_location',{
        p_delivery_id:delivery.id,p_lat:p.coords.latitude,p_lng:p.coords.longitude,
        p_status:delivery.status==='assigned'?'in_transit':delivery.status,p_eta_minutes:delivery.eta_minutes
      });
      if(error) toast.error('Live location update blocked by delivery controls.');
    },()=>undefined,{enableHighAccuracy:true,maximumAge:5000,timeout:15000});
    return()=>{if(watch!=null) navigator.geolocation.clearWatch(watch);};
  },[user,delivery,sharing]);

  const issueDeliveryCode=async()=>{
    if(!delivery||!isBuyer||codeBusy) return;
    setCodeBusy(true);
    const {data,error}=await supabase.rpc('issue_marketplace_delivery_code',{p_delivery_id:delivery.id});
    setCodeBusy(false);
    if(error){toast.error(error.message.replace(/_/g,' ').toLowerCase());return;}
    setIssuedCode(String(data?.code||''));
    toast.success('Secure delivery code generated. Give it to the courier only after you receive the package.');
  };

  const verifyDeliveryCode=async()=>{
    if(!delivery||!isCourier||codeBusy) return;
    setCodeBusy(true);
    const {error}=await supabase.rpc('verify_marketplace_delivery_code',{p_delivery_id:delivery.id,p_code:deliveryCode.trim()});
    setCodeBusy(false);
    if(error){toast.error(error.message.replace(/_/g,' ').toLowerCase());return;}
    setDeliveryCode('');
    toast.success('Delivery verified. Buyer confirmation can now release seller escrow.');
  };

  const confirmDelivery=async()=>{
    if(!delivery||!user||user.id!==delivery.buyer_id||busy) return;
    setBusy(true);
    const {data,error}=await supabase.rpc('confirm_marketplace_delivery',{p_delivery_id:delivery.id});
    setBusy(false);
    if(error){toast.error(error.message.replace(/_/g,' ').toLowerCase());return;}
    if(data?.payout_status==='paid') toast.success('Delivery confirmed. Courier payout released — congratulations to the deliverer! 🎉');
    else toast.success('Delivery confirmed. Platform payment is recorded; payout is being held for review.');
  };

  const withdrawEarnings=async()=>{
    if(!user||busy) return;
    setBusy(true);
    const {data,error}=await supabase.rpc('withdraw_marketplace_earnings');
    setBusy(false);
    if(error){toast.error(error.message.replace(/_/g,' ').toLowerCase());return;}
    setWithdrawResult({gross:Number(data?.gross_amount||0),fee:Number(data?.platform_fee||0),net:Number(data?.net_amount||0),currency:String(data?.currency||delivery?.currency||'KES')});
    toast.success('Withdrawal complete. 10% platform fee retained and 90% released to your Wallet.');
  };

  const reportBypass=async()=>{
    if(!delivery||!user||user.id===delivery.courier_id||busy) return;
    setBusy(true);
    const {data,error}=await supabase.rpc('report_marketplace_delivery_violation',{
      p_delivery_id:delivery.id,p_violation_type:'off_platform_payment',p_severity:100,
      p_evidence:'User reported a payment or collection attempt outside the Testagram platform.'
    });
    setBusy(false);
    if(error){toast.error(error.message.replace(/_/g,' ').toLowerCase());return;}
    toast.error(data?.blocked?'Courier blocked pending platform review.':'Report recorded for investigation.');
  };

  if(loading) return <div className="rounded-2xl border p-4 text-sm text-muted-foreground"><Loader2 className="mr-2 inline h-4 w-4 animate-spin"/>Loading live delivery…</div>;
  if(!delivery) return <div className="rounded-2xl border p-4 text-sm text-muted-foreground">Delivery tracking is unavailable.</div>;

  const active=delivery.status!=='delivered'&&delivery.status!=='cancelled';
  const lat=delivery.courier_lat, lng=delivery.courier_lng;
  const isCourier=user?.id===delivery.courier_id;
  const isBuyer=user?.id===delivery.buyer_id;

  return <div className={compact?'rounded-2xl border p-4':'rounded-3xl border bg-card p-5 shadow-sm'}>
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-2"><Truck className="h-5 w-5 text-primary"/><div><p className="font-bold">Live delivery tracking</p><p className="text-xs text-muted-foreground">{delivery.status.replace(/_/g,' ')}</p></div></div>
      {delivery.eta_minutes!=null&&active&&<span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-bold">{delivery.eta_minutes} min ETA</span>}
    </div>

    <div className="mt-3 flex flex-wrap gap-2">
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-bold text-emerald-600"><ShieldCheck className="h-3.5 w-3.5"/>Payment {delivery.payment_status}</span>
      {delivery.payout_status==='paid'&&<span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-3 py-1 text-xs font-bold text-primary">Payout released</span>}
      {delivery.payout_status==='blocked'&&<span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-3 py-1 text-xs font-bold text-destructive">Payout blocked</span>}
    </div>

    <div className="mt-4 rounded-2xl bg-muted/40 p-4">
      <div className="flex items-center gap-3 text-sm"><PackageCheck className="h-4 w-4 text-emerald-600"/><span className="font-semibold">Deliver to</span></div>
      <p className="mt-2 text-sm text-muted-foreground">{delivery.dropoff_address}</p>
      {delivery.payment_confirmed_at&&<p className="mt-2 text-[11px] text-muted-foreground">Platform payment verified {new Date(delivery.payment_confirmed_at).toLocaleString()}.</p>}
    </div>

    {delivery.status==='pending'&&user&&<div className="mt-3 flex flex-wrap gap-2">
      <button className="rounded-xl bg-primary px-4 py-2 text-xs font-bold disabled:opacity-50" disabled={!!agent?.blocked_at||agent?.active===false&&!!agent} onClick={async()=>{
        if(!agent){
          const {data:registration,error}=await supabase.rpc('register_marketplace_delivery_agent',{p_display_name:user.email||'Testagram Courier',p_phone:null});
          if(error||registration?.blocked){toast.error(registration?.reason||'Courier registration failed.');return;}
        }
        const {error}=await supabase.rpc('claim_marketplace_delivery',{p_delivery_id:delivery.id});
        if(error){toast.error(error.message.replace(/_/g,' ').toLowerCase());return;}
        toast.success('Delivery accepted. Keep all payment on Testagram.');
      }}>Accept delivery</button>
      <span className="self-center text-xs text-muted-foreground">Platform-paid deliveries only.</span>
    </div>}

    {isCourier&&delivery.status!=='delivered'&&delivery.status!=='cancelled'&&<button className="mt-3 rounded-xl border px-4 py-2 text-xs font-bold" onClick={()=>setSharing(v=>!v)}>{sharing?'Stop sharing location':'Start live location'}</button>}

    {isBuyer&&delivery.status!=='delivered'&&delivery.status!=='cancelled'&&delivery.courier_id&&<div className="mt-3 space-y-2">
      <button disabled={codeBusy} onClick={()=>void issueDeliveryCode()} className="w-full rounded-xl border border-primary/30 px-4 py-3 text-xs font-black text-primary disabled:opacity-50">{codeBusy?'Generating secure code…':'Generate secure delivery code'}</button>
      {issuedCode&&<div className="rounded-2xl border bg-primary/5 p-4 text-center"><p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Give this code to the courier after you receive the package</p><p className="mt-2 text-3xl font-black tracking-[0.35em]">{issuedCode}</p><p className="mt-1 text-[11px] text-muted-foreground">One-time · expires in 60 minutes</p></div>}
    </div>}
    {isCourier&&delivery.status!=='delivered'&&delivery.status!=='cancelled'&&delivery.courier_id===user?.id&&<div className="mt-3 space-y-2">
      <input inputMode="numeric" maxLength={6} value={deliveryCode} onChange={e=>setDeliveryCode(e.target.value.replace(/\D/g,'').slice(0,6))} placeholder="6-digit buyer delivery code" className="w-full rounded-xl border bg-background px-4 py-3 text-sm text-center tracking-[0.3em] font-bold" />
      <button disabled={codeBusy||deliveryCode.length!==6} onClick={()=>void verifyDeliveryCode()} className="w-full rounded-xl bg-emerald-600 px-4 py-3 text-xs font-black text-white disabled:opacity-50">{codeBusy?'Verifying…':'Verify code & mark delivered'}</button>
    </div>}
    {isBuyer&&delivery.status==='delivered'&&delivery.delivery_verified_at&&<button disabled={busy} onClick={()=>void confirmDelivery()} className="mt-3 w-full rounded-xl bg-emerald-600 px-4 py-3 text-xs font-black text-white disabled:opacity-50">{busy?'Confirming securely…':'Confirm receipt & release seller escrow'}</button>}

    {delivery.courier_id&&user&&user.id!==delivery.courier_id&&active&&<button disabled={busy} onClick={()=>void reportBypass()} className="mt-2 w-full rounded-xl border border-destructive/30 px-4 py-2 text-xs font-bold text-destructive disabled:opacity-50">Report off-platform payment / cash request</button>}

    {lat!=null&&lng!=null&&<div className="mt-3 rounded-2xl border p-4">
      <div className="flex items-center gap-2 text-sm font-semibold"><Navigation className="h-4 w-4 text-blue-600"/>Courier location is live</div>
      <p className="mt-1 text-xs text-muted-foreground">Updated {delivery.courier_updated_at?new Date(delivery.courier_updated_at).toLocaleTimeString(): 'just now'} · {lat.toFixed(5)}, {lng.toFixed(5)}</p>
      <a className="mt-3 inline-flex items-center gap-2 text-xs font-bold text-primary" target="_blank" rel="noreferrer" href={'https://www.openstreetmap.org/?mlat='+lat+'&mlon='+lng+'#map=16/'+lat+'/'+lng}><MapPin className="h-4 w-4"/>Open live position</a>
    </div>}

    {isCourier&&withdrawResult&&<div className="mt-4 rounded-2xl border bg-primary/5 p-4 text-sm"><p className="font-black">Earnings moved to Wallet</p><p className="mt-1 text-xs text-muted-foreground">Gross {withdrawResult.currency} {withdrawResult.gross.toFixed(2)} · Testagram 10% {withdrawResult.currency} {withdrawResult.fee.toFixed(2)} · You received {withdrawResult.currency} {withdrawResult.net.toFixed(2)}.</p></div>}
    {isCourier&&delivery.status==='delivered'&&delivery.payout_status==='pending'&&<button disabled={busy} onClick={()=>void withdrawEarnings()} className="mt-4 w-full rounded-xl bg-primary px-4 py-3 text-xs font-black text-primary-foreground disabled:opacity-50">{busy?'Releasing earnings securely…':'Withdraw earnings to my Wallet (90%)'}</button>}

    {delivery.status==='delivered'&&isCourier&&delivery.payout_status==='paid'&&<div className="mt-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 p-4 text-center"><PartyPopper className="mx-auto h-7 w-7 text-emerald-600"/><p className="mt-2 font-black text-emerald-700 dark:text-emerald-400">Congratulations! 🎉</p><p className="text-xs text-muted-foreground">Delivery confirmed and your platform payout has been released to your Wallet.</p></div>}
    {delivery.status==='delivered'&&delivery.payout_status==='blocked'&&<p className="mt-3 text-sm font-semibold text-destructive">Delivery completed, but payout is blocked because the courier account is under payment-policy review.</p>}
    {delivery.status==='delivered'&&delivery.payout_status!=='blocked'&&delivery.payout_status!=='paid'&&<p className="mt-3 text-sm font-semibold text-muted-foreground">Delivered successfully. Payout is pending platform review.</p>}
  </div>;
}
