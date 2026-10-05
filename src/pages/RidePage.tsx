import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Car, CheckCircle2, Clock3, LocateFixed, MapPin, Navigation, RefreshCw, ShieldCheck, Smartphone, WalletCards } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/hooks/useAuth';
import { useWallet } from '@/hooks/useWallet';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';

type Point = { latitude:number; longitude:number; address:string };
type Ride = { id:string; status:string; fare?:number; currency?:string; distance_km?:number; duration_minutes?:number; ride_type?:string };
type Fare = { amount:number; currency:string };

const API_BASE = '';

async function api(path:string, init:RequestInit = {}) {
  const token = localStorage.getItem('ride-hailing-token') || localStorage.getItem('token') || '';
  const headers = new Headers(init.headers);
  headers.set('Content-Type','application/json');
  if (token) headers.set('Authorization','Bearer '+token);
  const response = await fetch(path,{...init,headers});
  const body = await response.json().catch(()=>({}));
  if (!response.ok) throw new Error(body?.error || body?.message || 'Ride service request failed.');
  return body;
}

function geolocate():Promise<GeolocationPosition> {
  return new Promise((resolve,reject)=>{
    if (!navigator.geolocation) return reject(new Error('Location is not supported on this device.'));
    navigator.geolocation.getCurrentPosition(resolve,reject,{enableHighAccuracy:true,timeout:12000,maximumAge:30000});
  });
}

const paymentKey = (rideId:string) => 'testagram-ride-payment:'+rideId;

export default function RidePage() {
  const { user } = useAuth();
  const { wallet, loading: walletLoading, fetchWallet } = useWallet();
  const [pickup,setPickup] = useState('');
  const [dropoff,setDropoff] = useState('');
  const [pickupPoint,setPickupPoint] = useState<Point|null>(null);
  const [rideType,setRideType] = useState('standard');
  const [activeRide,setActiveRide] = useState<Ride|null>(null);
  const [loading,setLoading] = useState(false);
  const [locating,setLocating] = useState(false);
  const [fare,setFare] = useState<Fare|null>(null);
  const [paying,setPaying] = useState(false);
  const [paidRideId,setPaidRideId] = useState<string|null>(null);
  const connected=true;

  const types=useMemo(()=>[
    {id:'standard',name:'Standard',description:'Everyday rides',icon:'🚗'},
    {id:'comfort',name:'Comfort',description:'Extra space',icon:'🚙'},
    {id:'xl',name:'XL',description:'Groups & luggage',icon:'🚐'},
  ],[]);

  useEffect(()=>{ if(user) void loadLatestRide(); },[user?.id]);

  useEffect(()=>{
    if(activeRide?.id && localStorage.getItem(paymentKey(activeRide.id))) setPaidRideId(activeRide.id);
  },[activeRide?.id]);

  async function loadLatestRide(){
    if(!connected) return;
    try {
      const body=await api('/api/v1/rides?per_page=1');
      const rides=body?.data?.rides || body?.data || [];
      if(Array.isArray(rides) && rides[0]) setActiveRide(rides[0]);
    } catch { /* Optional backend may be offline. */ }
  }

  async function useMyLocation(){
    setLocating(true);
    try {
      const pos=await geolocate();
      setPickupPoint({latitude:pos.coords.latitude,longitude:pos.coords.longitude,address:'Current location'});
      setPickup('Current location');
      toast.success('Pickup location set');
    } catch(e) { toast.error(e instanceof Error ? e.message : 'Unable to get your location.'); }
    finally { setLocating(false); }
  }

  async function geocodeAddress(address:string):Promise<Point>{
    const body=await api('/api/v1/geo/geocode?address='+encodeURIComponent(address));
    const result=body?.data?.results?.[0] || body?.results?.[0];
    if(result?.latitude == null || result?.longitude == null) throw new Error('Destination could not be located.');
    return {latitude:Number(result.latitude),longitude:Number(result.longitude),address:result.formatted_address || address};
  }

  async function estimateFare(distanceKm:number):Promise<Fare>{
    const body=await api('/api/v1/promos/calculate-fare',{
      method:'POST',
      body:JSON.stringify({distance_km:distanceKm,ride_type:rideType}),
    });
    const amount=Number(body?.data?.fare ?? body?.data?.estimated_fare ?? body?.fare ?? 0);
    if(!amount) throw new Error('Fare estimate is unavailable.');
    return {amount,currency:String(body?.data?.currency || body?.currency || 'KES')};
  }

  async function prepareTrip(){
    if(!pickup.trim() || !dropoff.trim()) throw new Error('Enter pickup and destination.');
    let origin=pickupPoint;
    if(!origin){
      const pos=await geolocate();
      origin={latitude:pos.coords.latitude,longitude:pos.coords.longitude,address:pickup};
      setPickupPoint(origin);
    }
    const destination=await geocodeAddress(dropoff);
    const distanceBody=await api('/api/v1/geo/distance',{
      method:'POST',
      body:JSON.stringify({
        from_latitude:origin.latitude,from_longitude:origin.longitude,
        to_latitude:destination.latitude,to_longitude:destination.longitude,
      }),
    });
    const distanceKm=Number(distanceBody?.data?.distance_km ?? distanceBody?.distance_km ?? 0);
    if(distanceKm<=0) throw new Error('Unable to calculate trip distance.');
    const estimate=await estimateFare(distanceKm);
    setFare(estimate);
    return {origin,destination};
  }

  async function requestRide(event:FormEvent){
    event.preventDefault();
    if(!user){ toast.error('Sign in to request a ride.'); return; }
    if(!connected){ toast.error('Ride service is not connected yet.'); return; }
    setLoading(true);
    try {
      const trip=await prepareTrip();
      const body=await api('/api/v1/rides',{
        method:'POST',
        headers:{'Idempotency-Key':crypto.randomUUID()},
        body:JSON.stringify({
          pickup_latitude:trip.origin.latitude,pickup_longitude:trip.origin.longitude,
          dropoff_latitude:trip.destination.latitude,dropoff_longitude:trip.destination.longitude,
          pickup_address:pickup,dropoff_address:trip.destination.address,ride_type:rideType,
        }),
      });
      const ride=body?.data || body?.ride;
      if(!ride?.id) throw new Error('Ride was not created.');
      setActiveRide(ride);
      if(ride.fare != null) setFare({amount:Number(ride.fare),currency:String(ride.currency || fare?.currency || 'KES')});
      toast.success('Ride requested');
    } catch(e) { toast.error(e instanceof Error ? e.message : 'Could not request ride.'); }
    finally { setLoading(false); }
  }

  async function payRideFromWallet(){
    if(!activeRide?.id || activeRide.fare == null) return;
    if(activeRide.status !== 'completed'){ toast.error('Payment becomes available when the ride is completed.'); return; }
    if(!wallet){ toast.error('Your Testagram Wallet is unavailable.'); return; }
    if(paidRideId===activeRide.id){ toast.success('This ride is already paid from your wallet.'); return; }

    const amount=Number(activeRide.fare);
    const currency=String(activeRide.currency || fare?.currency || 'KES');
    if(!Number.isFinite(amount) || amount<=0){ toast.error('Ride fare is invalid.'); return; }

    setPaying(true);
    try {
      const key=paymentKey(activeRide.id);
      const { data, error } = await supabase.rpc('wallet_pay_ride',{
        p_ride_id:activeRide.id,p_amount:amount,p_currency:currency,p_idempotency_key:key,
      });
      if(error) throw error;
      localStorage.setItem(key,JSON.stringify(data));
      setPaidRideId(activeRide.id);
      await fetchWallet();
      toast.success('Ride paid securely from your Testagram Wallet');
    } catch(e) { toast.error(e instanceof Error ? e.message : 'Wallet payment failed.'); }
    finally { setPaying(false); }
  }

  return <div className="min-h-screen bg-background">
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
      <div className="overflow-hidden rounded-3xl border bg-card shadow-sm">
        <div className="relative min-h-[200px] bg-gradient-to-br from-emerald-600 via-emerald-500 to-teal-500 p-6 text-white">
          <div className="absolute right-6 top-6 rounded-2xl bg-white/15 p-3 backdrop-blur"><Car className="h-7 w-7"/></div>
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-white/75">Testagram Mobility</p>
          <h1 className="mt-2 max-w-xl text-3xl font-black sm:text-4xl">Move around your city.</h1>
          <p className="mt-2 max-w-xl text-sm text-white/85">Request a ride, get a fare estimate, and pay the completed trip directly from your existing Testagram Wallet.</p>
        </div>

        <div className="grid gap-6 p-5 lg:grid-cols-[1.15fr_.85fr] lg:p-7">
          <form onSubmit={requestRide} className="space-y-5">
            <div><h2 className="text-lg font-bold">Where are you going?</h2><p className="mt-1 text-sm text-muted-foreground">Use GPS for pickup or enter it manually.</p></div>
            <div className="space-y-3">
              <div className="relative">
                <MapPin className="absolute left-3 top-3 h-4 w-4 text-emerald-600"/>
                <Input value={pickup} onChange={e=>setPickup(e.target.value)} placeholder="Pickup location" className="pl-9 pr-32"/>
                <Button type="button" variant="ghost" size="sm" onClick={useMyLocation} disabled={locating} className="absolute right-1 top-1">{locating?<RefreshCw className="mr-1 h-4 w-4 animate-spin"/>:<LocateFixed className="mr-1 h-4 w-4"/>}{locating?'Locating':'Use location'}</Button>
              </div>
              <div className="relative"><Navigation className="absolute left-3 top-3 h-4 w-4 text-blue-600"/><Input value={dropoff} onChange={e=>setDropoff(e.target.value)} placeholder="Destination" className="pl-9"/></div>
            </div>
            <div><h3 className="mb-3 text-sm font-semibold">Choose a ride</h3><div className="grid gap-2 sm:grid-cols-3">{types.map(type=><button type="button" key={type.id} onClick={()=>{setRideType(type.id);setFare(null);}} className={'rounded-2xl border p-3 text-left transition '+(rideType===type.id?'border-emerald-500 bg-emerald-500/10 ring-1 ring-emerald-500':'hover:bg-muted')}><span className="text-2xl">{type.icon}</span><span className="mt-2 block text-sm font-bold">{type.name}</span><span className="block text-xs text-muted-foreground">{type.description}</span></button>)}</div></div>
            {fare && <div className="rounded-2xl border bg-muted/30 p-4"><div className="flex items-center justify-between"><span className="text-sm font-semibold">Estimated fare</span><span className="text-xl font-black">{fare.currency} {fare.amount.toLocaleString()}</span></div><p className="mt-1 text-xs text-muted-foreground">The final fare is set by the ride service after completion.</p></div>}
            <Button type="submit" disabled={loading || !pickup.trim() || !dropoff.trim()} className="h-12 w-full rounded-xl text-base font-bold">{loading?<RefreshCw className="mr-2 h-5 w-5 animate-spin"/>:<Car className="mr-2 h-5 w-5"/>}{loading?'Requesting…':'Request ride'}</Button>
            
          </form>

          <div className="space-y-4">
            <div className="rounded-2xl border bg-muted/30 p-5">
              <div className="mb-4 rounded-xl border bg-background p-4"><div className="flex items-center justify-between"><span className="text-sm font-semibold">Testagram Wallet</span><span className="text-sm font-black">{walletLoading?'…':wallet?(wallet.currency || 'USD')+' '+Number(wallet.balance).toLocaleString():'Unavailable'}</span></div><p className="mt-1 text-xs text-muted-foreground">Ride payments use the same wallet balance and ledger as the rest of Testagram.</p></div>
              <div className="flex items-center gap-3"><ShieldCheck className="h-5 w-5 text-emerald-600"/><div><p className="font-semibold">Protected payment</p><p className="text-xs text-muted-foreground">Atomic debit, idempotency protection and wallet spending limits.</p></div></div>
              <div className="mt-5 grid grid-cols-2 gap-3 text-xs"><div className="rounded-xl bg-background p-3"><Clock3 className="mb-2 h-4 w-4"/><b>Live status</b><p className="mt-1 text-muted-foreground">Track ride state</p></div><div className="rounded-xl bg-background p-3"><WalletCards className="mb-2 h-4 w-4"/><b>Wallet pay</b><p className="mt-1 text-muted-foreground">One wallet for Testagram</p></div></div>
            </div>

            {activeRide && <div className="rounded-2xl border p-5">
              <div className="flex items-center justify-between"><p className="font-bold">Your latest ride</p><span className="rounded-full bg-emerald-500/10 px-2 py-1 text-xs font-semibold text-emerald-600">{activeRide.status}</span></div>
              <div className="mt-4 space-y-2 text-sm text-muted-foreground"><p>Ride: <span className="font-medium text-foreground">{activeRide.ride_type || 'Standard'}</span></p>{activeRide.fare != null && <p>Fare: <span className="font-medium text-foreground">{activeRide.currency || fare?.currency || 'KES'} {Number(activeRide.fare).toLocaleString()}</span></p>}{activeRide.distance_km != null && <p>Distance: <span className="font-medium text-foreground">{Number(activeRide.distance_km).toFixed(1)} km</span></p>}{activeRide.duration_minutes != null && <p>Duration: <span className="font-medium text-foreground">{activeRide.duration_minutes} min</span></p>}</div>
              {activeRide.status==='completed' && activeRide.fare != null && (paidRideId===activeRide.id ? <div className="mt-4 flex items-center gap-2 rounded-xl bg-emerald-500/10 p-3 text-sm font-semibold text-emerald-700 dark:text-emerald-300"><CheckCircle2 className="h-5 w-5"/> Paid from Testagram Wallet</div> : <Button type="button" onClick={()=>void payRideFromWallet()} disabled={paying || walletLoading || !wallet} className="mt-4 w-full">{paying?<RefreshCw className="mr-2 h-4 w-4 animate-spin"/>:<WalletCards className="mr-2 h-4 w-4"/>}{paying?'Processing wallet payment…':'Pay from Testagram Wallet'}</Button>)}
            </div>}

            <div className="rounded-2xl border p-5"><div className="flex items-center gap-3"><Smartphone className="h-5 w-5 text-primary"/><div><p className="font-semibold">Built for Testagram</p><p className="text-xs text-muted-foreground">Ride access lives beside Home, World TV and the rest of your sidebar.</p></div></div></div>
          </div>
        </div>
      </div>
    </div>
  </div>;
};
