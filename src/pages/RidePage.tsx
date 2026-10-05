import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Car, CheckCircle2, Clock3, LocateFixed, MapPin, Navigation, RefreshCw, ShieldCheck, Smartphone, WalletCards, CreditCard, Route, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/hooks/useAuth';
import { useWallet } from '@/hooks/useWallet';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';

type Point = { latitude:number; longitude:number; address:string };
type Ride = { id:string; status:string; fare?:number|null; currency?:string|null; distance_km?:number|null; duration_minutes?:number|null; ride_type?:string|null; pickup_address?:string; dropoff_address?:string; created_at?:string };
type Fare = { amount:number; currency:string };

const RIDE_TYPES = [
  { id:'standard', name:'Standard', description:'Everyday rides', icon:'🚗', base:150 },
  { id:'comfort', name:'Comfort', description:'Extra space', icon:'🚙', base:220 },
  { id:'xl', name:'XL', description:'Groups & luggage', icon:'🚐', base:300 },
] as const;

async function fn(name:string, body:Record<string,unknown> = {}) {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data;
}

function geolocate():Promise<GeolocationPosition> {
  return new Promise((resolve,reject) => {
    if (!navigator.geolocation) return reject(new Error('Location is not supported on this device.'));
    navigator.geolocation.getCurrentPosition(resolve,reject,{enableHighAccuracy:true,timeout:12000,maximumAge:30000});
  });
}

export default function RidePage() {
  const { user } = useAuth();
  const { wallet, loading: walletLoading, fetchWallet, walletSecurity } = useWallet();
  const [pickup,setPickup] = useState('');
  const [dropoff,setDropoff] = useState('');
  const [pickupPoint,setPickupPoint] = useState<Point|null>(null);
  const [dropoffPoint,setDropoffPoint] = useState<Point|null>(null);
  const [rideType,setRideType] = useState<(typeof RIDE_TYPES)[number]['id']>('standard');
  const [fare,setFare] = useState<Fare|null>(null);
  const [distanceKm,setDistanceKm] = useState<number|null>(null);
  const [activeRide,setActiveRide] = useState<Ride|null>(null);
  const [loading,setLoading] = useState(false);
  const [locating,setLocating] = useState(false);
  const [paying,setPaying] = useState(false);
  const [loadingRide,setLoadingRide] = useState(true);\n  const rideRequestKeyRef = useRef<string | null>(null);

  const selectedType = useMemo(() => RIDE_TYPES.find(x=>x.id===rideType)!, [rideType]);
  const canRequest = Boolean(user && pickup.trim() && dropoff.trim() && pickupPoint && dropoffPoint && fare && !loading);
  const canPay = activeRide?.status === 'completed' && Number(activeRide.fare ?? fare?.amount ?? 0) > 0;

  useEffect(() => { if(user) void loadLatestRide(); else setLoadingRide(false); }, [user?.id]);

  async function loadLatestRide() {
    setLoadingRide(true);
    try {
      const body = await fn('ride-service', { method:'GET', path:'/api/v1/rides' });
      const rides = body?.data?.rides || [];
      if(Array.isArray(rides) && rides[0]) setActiveRide(rides[0]);
    } catch(e) {
      toast.error(e instanceof Error ? e.message : 'Could not load your rides.');
    } finally { setLoadingRide(false); }
  }

  async function useMyLocation() {
    setLocating(true);
    try {
      const pos = await geolocate();
      const point = { latitude:pos.coords.latitude, longitude:pos.coords.longitude, address:'Current location' };
      setPickupPoint(point); setPickup('Current location');
      toast.success('Pickup location set');
      if(dropoff.trim()) await resolveDropoff(dropoff, point);
    } catch(e) { toast.error(e instanceof Error ? e.message : 'Unable to get your location.'); }
    finally { setLocating(false); }
  }

  async function resolveDropoff(address:string, from?:Point) {
    if(!address.trim()) return;
    const origin = from || pickupPoint;
    if(!origin) return;
    const geo = await fn('ride-geocode',{address});
    const result = geo?.data?.results?.[0];
    if(!result?.latitude || !result?.longitude) throw new Error('Destination could not be located.');
    const point = { latitude:Number(result.latitude), longitude:Number(result.longitude), address:result.formatted_address || address };
    setDropoffPoint(point); setDropoff(point.address);
    const distance = await fn('ride-distance',{from_latitude:origin.latitude,from_longitude:origin.longitude,to_latitude:point.latitude,to_longitude:point.longitude});
    const km = Number(distance?.data?.distance_km);
    if(!Number.isFinite(km) || km <= 0) throw new Error('Could not calculate route distance.');
    const priced = await fn('ride-fare',{distance_km:km,ride_type:rideType});
    setDistanceKm(km);
    setFare({amount:Number(priced?.data?.fare),currency:String(priced?.data?.currency || 'KES')});
    return point;
  }

  async function handleDropoffBlur() {
    if(!pickupPoint || !dropoff.trim()) return;
    try { await resolveDropoff(dropoff); } catch(e) { toast.error(e instanceof Error ? e.message : 'Could not locate destination.'); }
  }

  async function changeRideType(id:(typeof RIDE_TYPES)[number]['id']) {
    setRideType(id);
    if(dropoffPoint && pickupPoint) {
      try {
        const distance = await fn('ride-distance',{from_latitude:pickupPoint.latitude,from_longitude:pickupPoint.longitude,to_latitude:dropoffPoint.latitude,to_longitude:dropoffPoint.longitude});
        const priced = await fn('ride-fare',{distance_km:Number(distance?.data?.distance_km),ride_type:id});
        setDistanceKm(Number(distance?.data?.distance_km));
        setFare({amount:Number(priced?.data?.fare),currency:String(priced?.data?.currency || 'KES')});
      } catch(e) { toast.error(e instanceof Error ? e.message : 'Could not refresh fare.'); }
    }
  }

  async function requestRide(event:FormEvent) {
    event.preventDefault();
    if(!user) { toast.error('Sign in to request a ride.'); return; }
    if(!pickupPoint) { toast.error('Set your pickup location first.'); return; }
    setLoading(true);
    try {
      const destination = dropoffPoint || await resolveDropoff(dropoff);
      if(!destination || !fare) throw new Error('Please enter a valid destination and wait for the fare.');
      const body = await fn('ride-service',{
        method:'POST',
        path:'/api/v1/rides',
        payload:{
          pickup_latitude:pickupPoint.latitude,
          pickup_longitude:pickupPoint.longitude,
          dropoff_latitude:destination.latitude,
          dropoff_longitude:destination.longitude,
          pickup_address:pickup,
          dropoff_address:destination.address,
          ride_type:rideType,
          fare:fare.amount,
        },
      });
      setActiveRide(body?.data || null);
      toast.success('Ride requested');
    } catch(e) { toast.error(e instanceof Error ? e.message : 'Could not request ride.'); }
    finally { setLoading(false); }
  }

  async function payForRide() {
    if(!activeRide || !user) return;
    const amount = Number(activeRide.fare ?? fare?.amount ?? 0);
    if(activeRide.status !== 'completed') { toast.error('Payment unlocks when the ride is completed.'); return; }
    if(amount <= 0) { toast.error('This ride has no payable fare.'); return; }
    if(!wallet) { toast.error('Your Testagram Wallet is not available.'); return; }
    if(String(wallet.currency || wallet.preferred_currency || 'KES').toUpperCase() !== 'KES') {
      toast.error('Ride wallet payments currently require KES.');
      return;
    }
    if(Number(wallet.balance) < amount) { toast.error('Insufficient wallet balance. Top up your Testagram Wallet first.'); return; }
    setPaying(true);
    try {
      const { data, error } = await supabase.rpc('wallet_pay_ride',{
        p_ride_id:activeRide.id,
        p_amount:amount,
        p_currency:'KES',
        p_idempotency_key:'ride:'+activeRide.id,
      });
      if(error) throw error;
      if(!data?.ok) {\n        if(data?.code === 'RISK_BLOCKED') throw new Error('Wallet payment was blocked by Testagram risk controls. Please review your Wallet security and try again later.');\n        throw new Error('Ride payment was not completed.');\n      }
      toast.success(`Ride paid from Wallet · KES ${amount.toLocaleString()}`);
      await fetchWallet();
      await loadLatestRide();
    } catch(e) { toast.error(e instanceof Error ? e.message : 'Wallet payment failed.'); }
    finally { setPaying(false); }
  }

  return <div className="min-h-screen bg-background">
    <div className="mx-auto max-w-5xl px-4 py-5 sm:px-6">
      <div className="overflow-hidden rounded-3xl border bg-card shadow-sm">
        <div className="relative min-h-[205px] bg-gradient-to-br from-emerald-700 via-emerald-600 to-teal-500 p-6 text-white sm:p-8">
          <div className="absolute right-6 top-6 rounded-2xl bg-white/15 p-3 backdrop-blur"><Car className="h-8 w-8"/></div>
          <p className="text-xs font-black uppercase tracking-[0.2em] text-white/70">Testagram Mobility</p>
          <h1 className="mt-2 max-w-2xl text-3xl font-black sm:text-4xl">Move around your city.</h1>
          <p className="mt-2 max-w-xl text-sm leading-6 text-white/85">Request a ride, see your route and pay securely from your existing Testagram Wallet.</p>
          <div className="mt-5 flex flex-wrap gap-2 text-xs font-semibold">
            <span className="rounded-full bg-white/15 px-3 py-1.5">📍 Live location</span>
            <span className="rounded-full bg-white/15 px-3 py-1.5">💳 Wallet payment</span>
            <span className="rounded-full bg-white/15 px-3 py-1.5">🛡️ Testagram secured</span>
          </div>
        </div>

        <div className="grid gap-6 p-5 lg:grid-cols-[1.12fr_.88fr] lg:p-7">
          <form onSubmit={requestRide} className="space-y-5">
            <div><h2 className="text-lg font-bold">Where are you going?</h2><p className="mt-1 text-sm text-muted-foreground">Your route and fare are calculated inside Testagram.</p></div>
            <div className="space-y-3">
              <div className="relative">
                <MapPin className="absolute left-3 top-3 h-4 w-4 text-emerald-600"/>
                <Input value={pickup} onChange={e=>{setPickup(e.target.value);setPickupPoint(null)}} placeholder="Pickup location" className="pl-9 pr-32"/>
                <Button type="button" variant="ghost" size="sm" onClick={useMyLocation} disabled={locating} className="absolute right-1 top-1">{locating?<RefreshCw className="mr-1 h-4 w-4 animate-spin"/>:<LocateFixed className="mr-1 h-4 w-4"/>}{locating?'Locating':'Use location'}</Button>
              </div>
              <div className="relative">
                <Navigation className="absolute left-3 top-3 h-4 w-4 text-blue-600"/>
                <Input value={dropoff} onChange={e=>{setDropoff(e.target.value);setDropoffPoint(null);setFare(null)}} onBlur={handleDropoffBlur} placeholder="Destination" className="pl-9"/>
              </div>
            </div>

            {fare && <div className="rounded-2xl border bg-muted/30 p-4">
              <div className="flex items-center justify-between"><div className="flex items-center gap-2"><Route className="h-4 w-4 text-emerald-600"/><span className="text-sm font-semibold">Estimated fare</span></div><span className="text-xl font-black">KES {fare.amount.toLocaleString()}</span></div>
              <p className="mt-1 text-xs text-muted-foreground">Final fare is confirmed by the ride service when the trip is completed.</p>
            </div>}

            <div>
              <h3 className="mb-3 text-sm font-semibold">Choose a ride</h3>
              <div className="grid gap-2 sm:grid-cols-3">
                {RIDE_TYPES.map(type=><button type="button" key={type.id} onClick={()=>void changeRideType(type.id)} className={'rounded-2xl border p-3 text-left transition '+(rideType===type.id?'border-emerald-500 bg-emerald-500/10 ring-1 ring-emerald-500':'hover:bg-muted')}>
                  <span className="text-2xl">{type.icon}</span><span className="mt-2 block text-sm font-bold">{type.name}</span><span className="block text-xs text-muted-foreground">{type.description}</span><span className="mt-2 block text-[10px] font-bold text-emerald-600">From KES {type.base}</span>
                </button>)}
              </div>
            </div>

            <Button type="submit" disabled={!canRequest} className="h-12 w-full rounded-xl text-base font-bold">
              {loading?<RefreshCw className="mr-2 h-5 w-5 animate-spin"/>:<Car className="mr-2 h-5 w-5"/>}{loading?'Requesting…':'Request ride'}
            </Button>
          </form>

          <div className="space-y-4">
            <div className="rounded-2xl border bg-muted/30 p-5">
              <div className="flex items-center gap-3"><WalletCards className="h-5 w-5 text-emerald-600"/><div><p className="font-semibold">Pay with Testagram Wallet</p><p className="text-xs text-muted-foreground">{walletLoading?'Loading balance…':wallet ? `Available · KES ${Number(wallet.balance).toLocaleString()}`:'Wallet unavailable'}</p></div></div>
              <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
                <div className="rounded-xl bg-background p-3"><CreditCard className="mb-2 h-4 w-4"/><b>One-tap settlement</b><p className="mt-1 text-muted-foreground">No separate ride payment account.</p></div>
                <div className="rounded-xl bg-background p-3"><ShieldCheck className="mb-2 h-4 w-4"/><b>Ledger backed</b><p className="mt-1 text-muted-foreground">Every payment gets a wallet transaction.</p></div>
              </div>
            </div>

            {loadingRide ? <div className="rounded-2xl border p-5 text-sm text-muted-foreground"><RefreshCw className="mr-2 inline h-4 w-4 animate-spin"/>Loading your latest ride…</div> :
            activeRide ? <div className="rounded-2xl border p-5">
              <div className="flex items-center justify-between gap-3"><div className="flex items-center gap-2"><Clock3 className="h-5 w-5 text-primary"/><p className="font-bold">Latest ride</p></div><span className="rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-bold capitalize text-emerald-600">{activeRide.status}</span></div>
              <div className="mt-4 space-y-2 text-sm">
                {activeRide.pickup_address && <p className="text-muted-foreground">From <span className="font-medium text-foreground">{activeRide.pickup_address}</span></p>}
                {activeRide.dropoff_address && <p className="text-muted-foreground">To <span className="font-medium text-foreground">{activeRide.dropoff_address}</span></p>}
                <div className="grid grid-cols-2 gap-3 pt-2 text-xs"><div className="rounded-xl bg-muted/40 p-3"><b>Ride</b><p className="mt-1 text-muted-foreground capitalize">{activeRide.ride_type || 'standard'}</p></div><div className="rounded-xl bg-muted/40 p-3"><b>Fare</b><p className="mt-1 text-muted-foreground">{activeRide.fare ? `KES ${Number(activeRide.fare).toLocaleString()}` : 'Pending'}</p></div></div>
              </div>
              {canPay && <Button onClick={()=>void payForRide()} disabled={paying || walletLoading} className="mt-4 h-11 w-full rounded-xl font-bold">{paying?<RefreshCw className="mr-2 h-4 w-4 animate-spin"/>:<CheckCircle2 className="mr-2 h-4 w-4"/>}{paying?'Processing Wallet payment…':`Pay KES ${Number(activeRide.fare).toLocaleString()} from Wallet`}</Button>}
              {activeRide.status === 'completed' && !canPay && <div className="mt-4 rounded-xl bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300"><AlertCircle className="mr-1 inline h-4 w-4"/>Payment is waiting for a valid completed fare.</div>}
            </div> : <div className="rounded-2xl border p-5"><div className="flex items-center gap-3"><Smartphone className="h-5 w-5 text-primary"/><div><p className="font-semibold">Ready when you are</p><p className="text-xs text-muted-foreground">Your first ride will appear here with its live status and Wallet settlement.</p></div></div></div>}

            <div className="rounded-2xl border p-5"><div className="flex items-center gap-3"><ShieldCheck className="h-5 w-5 text-emerald-600"/><div><p className="font-semibold">Wallet protection</p><p className="text-xs text-muted-foreground">{walletSecurity?.pin_set ? 'Your wallet PIN remains the security boundary for sensitive wallet actions.' : 'Set a Wallet PIN before using sensitive payment features.'}</p></div></div></div>
          </div>
        </div>
      </div>
    </div>
  </div>;
}
