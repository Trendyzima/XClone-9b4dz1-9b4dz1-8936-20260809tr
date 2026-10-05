import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { MapPin, PackageCheck, Truck, Navigation, Loader2 } from 'lucide-react';

type Delivery = {
  id:string; order_id:string; status:string; dropoff_address:string;
  courier_lat:number|null; courier_lng:number|null; courier_updated_at:string|null;
  eta_minutes:number|null; currency:string; delivery_fee_minor:number;
};

export function MarketplaceDeliveryTracker({ deliveryId, compact=false }: { deliveryId:string; compact?:boolean }) {
  const [delivery,setDelivery]=useState<Delivery|null>(null);
  const [loading,setLoading]=useState(true);

  useEffect(() => {
    let alive=true;
    const load=async()=> {
      const {data}=await supabase.from('marketplace_deliveries').select('*').eq('id',deliveryId).maybeSingle();
      if(alive) { setDelivery(data as Delivery|null); setLoading(false); }
    };
    void load();
    const channel=supabase.channel('marketplace-delivery-'+deliveryId)
      .on('postgres_changes',{event:'UPDATE',schema:'public',table:'marketplace_deliveries',filter:'id=eq.'+deliveryId},
        payload=>{ if(alive) setDelivery(payload.new as Delivery); })
      .on('postgres_changes',{event:'INSERT',schema:'public',table:'marketplace_delivery_events',filter:'delivery_id=eq.'+deliveryId},
        ()=>void load())
      .subscribe();
    return()=>{ alive=false; void supabase.removeChannel(channel); };
  },[deliveryId]);

  if(loading) return <div className="rounded-2xl border p-4 text-sm text-muted-foreground"><Loader2 className="mr-2 inline h-4 w-4 animate-spin"/>Loading live delivery…</div>;
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
    {lat!=null&&lng!=null&&<div className="mt-3 rounded-2xl border p-4">
      <div className="flex items-center gap-2 text-sm font-semibold"><Navigation className="h-4 w-4 text-blue-600"/>Courier location is live</div>
      <p className="mt-1 text-xs text-muted-foreground">Updated {delivery.courier_updated_at?new Date(delivery.courier_updated_at).toLocaleTimeString(): 'just now'} · {lat.toFixed(5)}, {lng.toFixed(5)}</p>
      <a className="mt-3 inline-flex items-center gap-2 text-xs font-bold text-primary" target="_blank" rel="noreferrer" href={'https://www.openstreetmap.org/?mlat='+lat+'&mlon='+lng+'#map=16/'+lat+'/'+lng}><MapPin className="h-4 w-4"/>Open live position</a>
    </div>}
    {delivery.status==='delivered'&&<p className="mt-3 text-sm font-semibold text-emerald-600">Delivered successfully.</p>}
  </div>;
}