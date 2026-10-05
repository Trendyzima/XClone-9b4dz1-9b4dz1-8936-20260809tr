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
  if (path.startsWith('/api/v1/geo/')) {
    const endpoint=path.includes('/geocode?') ? 'ride-geocode' : path.includes('/distance') ? 'ride-distance' : '';
    if (!endpoint) throw new Error('Unsupported ride service operation.');
    const url=endpoint==='ride-geocode'
      ? supabase.functions.invoke('ride-geocode',{body:{address:new URLSearchParams(path.split('?')[1] || '').get('address') || ''}})
      : supabase.functions.invoke('ride-distance',{body:JSON.parse(String(init.body || '{}'))});
    const {data,error}=await url;
    if(error) throw error;
    return data;
  }
  if (path.startsWith('/api/v1/promos/calculate-fare')) {
    const {data,error}=await supabase.functions.invoke('ride-fare',{body:JSON.parse(String(init.body || '{}'))});
    if(error) throw error;
    return data;
  }
  if (path.startsWith('/api/v1/rides')) {
    const {data,error}=await supabase.functions.invoke('ride-service',{body:{
      method:init.method || 'GET',
      path,
      payload:init.body ? JSON.parse(String(init.body)) : undefined,
      idempotency_key:new Headers(init.headers).get('Idempotency-Key') || undefined
    }});
    if(error) throw error;
    return data;
  }
  throw new Error('Unsupported ride service operation.');
}
