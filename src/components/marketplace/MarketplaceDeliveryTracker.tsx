import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { MapPin, PackageCheck, Truck, Navigation, Loader2 } from 'lucide-react';

type Delivery = {
  id:string; order_id:string; status:string; dropoff_address:string;
  courier_lat:number|null; courier_lng:number|null; courier_updated_at:string|null;
  eta_minutes:number|null; currency:string; delivery_fee_minor:number;
};

export function MarketplaceDeliveryTracker({ deliveryId, compact=false }: { deliveryId:string; compact?:boolean }) {
  const { user } = useAuth();
  const [delivery,setDelivery]=useState<Delivery|null>(null);
  const [agent,setAgent]=useState(false);
  const [sharing,setSharing]=useState(false);
  const [loading,setLoading]=useState(true);

  useEffect(() => {
    let alive=true;
    const load=async()=> {
      const {data}=await supabase.from('marketplace_deliveries').select('*').eq('id',deliveryId).maybeSingle();
      if(alive) { setDelivery(data as Delivery|null); setLoading(false); }
    };
    void load();
    if(user) void supabase.from('marketplace_delivery_agents').select('user_id').eq('user_id',user.id).maybeSingle().then(({data})=>setAgent(!!data));
    const channel=supabase.channel('marketplace-delivery-'+deliveryId)
      .on('postgres_changes',{event:'UPDATE',schema:'public',table:'marketplace_deliveries',filter:'id=eq.'+deliveryId},
        payload=>{ if(alive) setDelivery(payload.new as Delivery); })
      .on('postgres_changes',{event:'INSERT',schema:'public',table:'marketplace_delivery_events',filter:'delivery_id=eq.'+deliveryId},
        ()=>void load())
      .subscribe();
    return()=>{ alive=false; void supabase.removeChannel(channel); };
  },[deliveryId]);

  if(loading) return <div className="rounded-2xl border p-4 text-sm text-muted-foreground"><Loader2 className="mr-2 inline h-4 w-4 animate-spin"/>Loading live delivery…</div>;
  useEffect(()=>{ if(!user||!delivery||delivery.courier_id!==user.id||delivery.status==='delivered'||delivery.status==='cancelled'||!sharing) return; const watch=navigator.geolocation?.watchPosition(async p=>{ await supabase.rpc('update_marketplace_delivery_location',{p_delivery_id:delivery.id,p_lat:p.coords.latitude,p_lng:p.coords.longitude,p_status:delivery.status==='assigned'?'in_transit':delivery.status,p_eta_minutes:delivery.eta_minutes}); },()=>undefined,{enableHighAccuracy:true,maximumAge:5000,timeout:15000}); return()=>{if(watch!=null) navigator.geolocation.clearWatch(watch);}; },[user,delivery,sharing]);

  if(!delivery) return <div className="rounded-2xl border p-4 text-sm text-muted-foreground">Delivery tracking is unavailable.</div>;

  const active=delivery.status!=='delivered'&&delivery.status!=='cancelled';
  const lat=delivery.courier_lat, lng=delivery.courier_lng;
  return <div className={compact?'rounded-2xl border p-4':'rounded-3xl border bg-card p-5 shadow-sm'}>
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-2"><Truck className="h-5 w-5 text-primary"/><div><p className="font-bold">Live delivery tracking</p><p className="text-xs text-muted-foreground">{delivery.status.replaceAll('_',' ')}</p></div></div>
      {delivery.eta_minutes!=null&&active&&<span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-bold">{delivery.eta_minutes} min ETA</span>}
    </div>
    <div className="mt-4 rounded-2xl bg-muted/40 p-4">
      <div className="flex items-center gap-3 text-sm"><PackageCheck className="h-4 w-4 text-emerald-600"/><span className="font-semibold">Deliver to</span></div>
      <p className="mt-2 text-sm text-muted-foreground">{delivery.dropoff_address}</p>
    </div>
    {delivery.status==='pending'&&user&&<div className="mt-3 flex flex-wrap gap-2"><button className="rounded-xl bg-primary px-4 py-2 text-xs font-bold text-primary-foreground" onClick={async()=>{if(!agent){const {error}=await supabase.from('marketplace_delivery_agents').upsert({user_id:user.id,display_name:user.email||'Testagram Courier'});if(error)return;} await supabase.rpc('claim_marketplace_delivery',{p_delivery_id:delivery.id});}}>Accept delivery</button><span className="self-center text-xs text-muted-foreground">Courier partners can accept and track this order.</span></div>}
    {delivery.courier_id===user?.id&&delivery.status!=='delivered'&&delivery.status!=='cancelled'&&<button className="mt-3 rounded-xl border px-4 py-2 text-xs font-bold" onClick={()=>setSharing(v=>!v)}>{sharing?'Stop sharing location':'Start live location'}</button>}
    {lat!=null&&lng!=null&&<div className="mt-3 rounded-2xl border p-4">
      <div className="flex items-center gap-2 text-sm font-semibold"><Navigation className="h-4 w-4 text-blue-600"/>Courier location is live</div>
      <p className="mt-1 text-xs text-muted-foreground">Updated {delivery.courier_updated_at?new Date(delivery.courier_updated_at).toLocaleTimeString(): 'just now'} · {lat.toFixed(5)}, {lng.toFixed(5)}</p>
      <a className="mt-3 inline-flex items-center gap-2 text-xs font-bold text-primary" target="_blank" rel="noreferrer" href={'https://www.openstreetmap.org/?mlat='+lat+'&mlon='+lng+'#map=16/'+lat+'/'+lng}><MapPin className="h-4 w-4"/>Open live position</a>
    </div>}
    {delivery.status==='delivered'&&<p className="mt-3 text-sm font-semibold text-emerald-600">Delivered successfully.</p>}
  </div>;
}