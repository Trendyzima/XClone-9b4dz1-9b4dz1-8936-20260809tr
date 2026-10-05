import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Car, Clock3, LocateFixed, MapPin, Navigation, RefreshCw, ShieldCheck, Smartphone, WalletCards } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/hooks/useAuth';
import { useWallet } from '@/hooks/useWallet';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';

type Point = { latitude:number; longitude:number; address:string };
type Ride = { id:string; status:string; fare?:number; estimated_fare?:number; distance_km?:number; duration_minutes?:number; ride_type?:string };

const API_BASE = (import.meta.env.VITE_RIDE_HAILING_API_URL as string | undefined)?.replace(/\/+$/,'') || '';

async function api(path:string, init:RequestInit = {}) {
  if (!API_BASE) throw new Error('Ride service is not connected yet.');
  const token = localStorage.getItem('ride-hailing-token') || localStorage.getItem('token') || '';
  const headers = new Headers(init.headers);
  headers.set('Content-Type','application/json');
  if (token) headers.set('Authorization','Bearer '+token);
  const response = await fetch(API_BASE+path,{...init,headers});
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
  const [fareEstimate,setFareEstimate] = useState<number|null>(null);
  const [fareCurrency,setFareCurrency] = useState('KES');
  const [paying,setPaying] = useState(false);
  const [payment,setPayment] = useState<any>(null);
  const connected=Boolean(API_BASE);

  const types=useMemo(()=>[
    {id:'standard',name:'Standard',description:'Everyday rides',icon:'🚗'},
    {id:'comfort',name:'Comfort',description:'Extra space',icon:'🚙'},
    {id:'xl',name:'XL',description:'Groups & luggage',icon:'🚐'},
  ],[]);

  useEffect(()=>{ if(!user) return; void loadLatestRide(); void fetchWallet(); },[user?.id,fetchWallet]);

  async function payRideWithWallet(){
    if(!activeRide?.id) return;
    if(!connected){ toast.error('Ride service is not connected.'); return; }
    setPaying(true);
    try {
      const body=await api('/api/v1/payments/process',{method:'POST',body:JSON.stringify({ride_id:activeRide.id,method:'wallet'})});
      toast.success('Ride paid from your Testagram wallet');
      setActiveRide(body?.data?.ride || body?.ride || activeRide);
      await loadWallet();
    } catch(e){ toast.error(e instanceof Error ? e.message : 'Wallet payment failed.'); }
    finally { setPaying(false); }
  }

  async function geocodeAddress(address:string){
    const body=await api('/api/v1/geo/geocode?address='+encodeURIComponent(address));
    const result=body?.data?.results?.[0] || body?.results?.[0];
    if(!result?.latitude || !result?.longitude) throw new Error('Destination could not be located.');
    return {latitude:Number(result.latitude),longitude:Number(result.longitude),address:result.formatted_address || address};
  }

  async function loadLatestRide(){
    try {
      const body=await api('/api/v1/rides?per_page=1');
      const rides=body?.data?.rides || body?.data || [];
      if(Array.isArray(rides) && rides[0]) setActiveRide(rides[0]);
    } catch { /* The page remains usable when the optional ride backend is offline. */ }
  }

  async function useMyLocation(){
    setLocating(true);
    try {
      const pos=await geolocate();
      const point={latitude:pos.coords.latitude,longitude:pos.coords.longitude,address:'Current location'};
      setPickupPoint(point); setPickup('Current location');
      toast.success('Pickup location set');
    } catch(e) { toast.error(e instanceof Error ? e.message : 'Unable to get your location.'); }
    finally { setLocating(false); }
  }

async function estimateFare(distanceKm:number, type:string){
    const body=await api('/api/v1/promos/calculate-fare',{method:'POST',body:JSON.stringify({distance_km:distanceKm,ride_type:type})});
    return Number(body?.data?.fare ?? body?.data?.estimated_fare ?? body?.fare ?? 0);
  }

  async function payRideFromWallet(ride:Ride){
    if(!ride?.id || ride.fare == null) throw new Error('Ride fare is not available yet.');
    if(!wallet) throw new Error('Your Testagram Wallet is unavailable.');
    const amount=Number(ride.fare);
    if(Number(wallet.balance) < amount) throw new Error('Insufficient Testagram Wallet balance.');
    setPaying(true);
    try {
      const { data, error } = await supabase.rpc('wallet_pay_ride', {
        p_ride_id: ride.id,
        p_amount: amount,
        p_currency: rideCurrency(ride),
        p_idempotency_key: crypto.randomUUID(),
      });
      if(error) throw error;
      setPayment(data);
      await fetchWallet();
      toast.success('Ride paid from your Testagram Wallet');
    } finally { setPaying(false); }
  }

  function rideCurrency(ride:Ride){ return fareCurrency || 'KES'; }

  async function requestRide(event:FormEvent){
    event.preventDefault();
    if(!user){ toast.error('Sign in to request a ride.'); return; }
    if(!pickup.trim() || !dropoff.trim()){ toast.error('Enter pickup and destination.'); return; }
    if(!connected){ toast.error('Ride service is not connected yet.'); return; }
    setLoading(true);
    try {
      let point=pickupPoint;
      if(!point){ const pos=await geolocate(); point={latitude:pos.coords.latitude,longitude:pos.coords.longitude,address:pickup}; }
      const destination=await geocodeAddress(dropoff);
      const body=await api('/api/v1/rides',{method:'POST',body:JSON.stringify({
        pickup_latitude:point.latitude,pickup_longitude:point.longitude,
        dropoff_latitude:destination.latitude,dropoff_longitude:destination.longitude,
        pickup_address:pickup,dropoff_address:dropoff,ride_type:rideType
      })});
      const ride=body?.data || body?.ride || null;
      setActiveRide(ride);
      if(ride?.fare != null) setFareEstimate(Number(ride.fare));
      toast.success('Ride requested');
      await fetchWallet();
    } catch(e){ toast.error(e instanceof Error ? e.message : 'Could not request ride.'); }
    finally { setLoading(false); }
  }

  return <div className="min-h-screen bg-background">
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
      <div className="overflow-hidden rounded-3xl border bg-card shadow-sm">
        <div className="relative min-h-[190px] bg-gradient-to-br from-emerald-600 via-emerald-500 to-teal-500 p-6 text-white">
          <div className="absolute right-6 top-6 rounded-2xl bg-white/15 p-3 backdrop-blur"><Car className="h-7 w-7"/></div>
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-white/75">Testagram Mobility</p>
          <h1 className="mt-2 max-w-xl text-3xl font-black sm:text-4xl">Move around your city.</h1>
          <p className="mt-2 max-w-xl text-sm text-white/85">Request a ride, follow its status, and keep mobility alongside your Testagram experience.</p>
        </div>

        <div className="grid gap-6 p-5 lg:grid-cols-[1.15fr_.85fr] lg:p-7">
          <form onSubmit={requestRide} className="space-y-5">
            <div>
              <h2 className="text-lg font-bold">Where are you going?</h2>
              <p className="mt-1 text-sm text-muted-foreground">Set your pickup and destination.</p>
            </div>
            <div className="space-y-3">
              <div className="relative">
                <MapPin className="absolute left-3 top-3 h-4 w-4 text-emerald-600"/>
                <Input value={pickup} onChange={e=>setPickup(e.target.value)} placeholder="Pickup location" className="pl-9 pr-32"/>
                <Button type="button" variant="ghost" size="sm" onClick={useMyLocation} disabled={locating} className="absolute right-1 top-1">{locating?<RefreshCw className="mr-1 h-4 w-4 animate-spin"/>:<LocateFixed className="mr-1 h-4 w-4"/>}{locating?'Locating':'Use location'}</Button>
              </div>
              <div className="relative">
                <Navigation className="absolute left-3 top-3 h-4 w-4 text-blue-600"/>
                <Input value={dropoff} onChange={e=>setDropoff(e.target.value)} placeholder="Destination" className="pl-9"/>
              </div>
            </div>

            <div>
              <h3 className="mb-3 text-sm font-semibold">Choose a ride</h3>
              <div className="grid gap-2 sm:grid-cols-3">
                {types.map(type=><button type="button" key={type.id} onClick={()=>setRideType(type.id)} className={'rounded-2xl border p-3 text-left transition '+(rideType===type.id?'border-emerald-500 bg-emerald-500/10 ring-1 ring-emerald-500':'hover:bg-muted')}>
                  <span className="text-2xl">{type.icon}</span><span className="mt-2 block text-sm font-bold">{type.name}</span><span className="block text-xs text-muted-foreground">{type.description}</span>
                </button>)}
              </div>
            </div>

            <Button type="submit" disabled={loading || !pickup.trim() || !dropoff.trim()} className="h-12 w-full rounded-xl text-base font-bold">
              {loading?<RefreshCw className="mr-2 h-5 w-5 animate-spin"/>:<Car className="mr-2 h-5 w-5"/>}{loading?'Requesting…':'Request ride'}
            </Button>
            {!connected && <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">Ride UI is installed, but the Go ride-hailing backend is not configured in this deployment. Set <code>VITE_RIDE_HAILING_API_URL</code> to your secured API gateway before enabling live requests.</div>}
          </form>

          <div className="space-y-4">
            <div className="rounded-2xl border bg-muted/30 p-5">
              <div className="mb-4 rounded-xl border bg-background p-4"><div className="flex items-center justify-between"><span className="text-sm font-semibold">Testagram Wallet</span><span className="text-sm font-black">{walletLoading?'…':wallet?`KES ${Number(wallet.balance).toLocaleString()}`:'Unavailable'}</span></div><p className="mt-1 text-xs text-muted-foreground">Ride payments use your existing Testagram Wallet balance. No separate ride wallet.</p></div>
              <div className="flex items-center gap-3"><ShieldCheck className="h-5 w-5 text-emerald-600"/><div><p className="font-semibold">Ride safety</p><p className="text-xs text-muted-foreground">Use the platform's verified ride flow and never share payment credentials in chat.</p></div></div>
              <div className="mt-5 grid grid-cols-2 gap-3 text-xs"><div className="rounded-xl bg-background p-3"><Clock3 className="mb-2 h-4 w-4"/><b>Live status</b><p className="mt-1 text-muted-foreground">Track ride state</p></div><div className="rounded-xl bg-background p-3"><WalletCards className="mb-2 h-4 w-4"/><b>Wallet ready</b><p className="mt-1 text-muted-foreground">Pay through API</p></div></div>
            </div>
            {wallet && <div className="rounded-2xl border bg-emerald-500/5 p-5"><div className="flex items-center justify-between"><div><p className="text-sm font-semibold">Testagram Wallet</p><p className="mt-1 text-2xl font-black">{Number(wallet.balance).toFixed(2)} {wallet.currency}</p></div><WalletCards className="h-6 w-6 text-emerald-600"/></div><p className="mt-2 text-xs text-muted-foreground">Ride payments are charged directly from your Testagram Wallet.</p></div>}
            {activeRide && <div className="rounded-2xl border p-5"><div className="flex items-center justify-between"><p className="font-bold">Your latest ride</p><span className="rounded-full bg-emerald-500/10 px-2 py-1 text-xs font-semibold text-emerald-600">{activeRide.status}</span></div><div className="mt-4 space-y-2 text-sm text-muted-foreground"><p>Ride: <span className="font-medium text-foreground">{activeRide.ride_type || 'Standard'}</span></p>{activeRide.fare != null && <p>Fare: <span className="font-medium text-foreground">{activeRide.fare}</span></p>}{activeRide.duration_minutes != null && <p>ETA: <span className="font-medium text-foreground">{activeRide.duration_minutes} min</span></p>}</div>{activeRide.status==='completed' && <Button type="button" onClick={payRideWithWallet} disabled={paying} className="mt-4 w-full">{paying?<RefreshCw className="mr-2 h-4 w-4 animate-spin"/>:<WalletCards className="mr-2 h-4 w-4"/>}{paying?'Processing…':'Pay from wallet'}</Button>}</div>}
            <div className="rounded-2xl border p-5"><div className="flex items-center gap-3"><Smartphone className="h-5 w-5 text-primary"/><div><p className="font-semibold">Built for Testagram</p><p className="text-xs text-muted-foreground">Ride access now lives beside Home, World TV and the rest of your sidebar.</p></div></div></div>
          </div>
        </div>
      </div>
    </div>
  </div>;
}
