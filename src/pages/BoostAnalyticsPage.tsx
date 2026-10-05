import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { TopBar } from '@/components/layout/TopBar';
import { PageAdBanner } from '@/components/features/AdSenseAd';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { ArrowLeft, BarChart3, DollarSign, Eye, Loader2, Pause, Play, Plus, RefreshCw, Target, TrendingUp } from 'lucide-react';
import { formatNumber } from '@/lib/utils';

export default function BoostAnalyticsPage(){
  const {postId}=useParams<{postId:string}>(); const {user}=useAuth(); const navigate=useNavigate();
  const [boost,setBoost]=useState<any>(null); const [post,setPost]=useState<any>(null); const [all,setAll]=useState<any[]>([]);
  const [loading,setLoading]=useState(true); const [amount,setAmount]=useState('500'); const [busy,setBusy]=useState(false);
  useEffect(()=>{if(!user){navigate('/auth');return;}void load();},[user?.id,postId]);
  const load=async()=>{setLoading(true);const [{data:b},{data:p},{data:a}]=await Promise.all([
    supabase.from('boosts').select('*').eq('post_id',postId).eq('user_id',user!.id).order('created_at',{ascending:false}).limit(1).maybeSingle(),
    supabase.from('posts').select('id,content,image_url,video_url').eq('id',postId).maybeSingle(),
    supabase.from('boosts').select('*').eq('user_id',user!.id).order('created_at',{ascending:false}).limit(30)
  ]);setBoost(b);setPost(p);setAll(a??[]);setLoading(false);};
  const pause=async()=>{if(!boost)return;setBusy(true);const next=boost.status==='active'?'paused':'active';const {data,error}=await supabase.from('boosts').update({status:next}).eq('id',boost.id).eq('user_id',user!.id).select('*').single();setBusy(false);if(error)toast.error(error.message);else{setBoost(data);setAll(v=>v.map(x=>x.id===data.id?data:x));toast.success(next==='active'?'Campaign resumed':'Campaign paused');}};
  const topup=async()=>{if(!boost)return;const kes=Math.round(Number(amount));if(!Number.isFinite(kes)||kes<100){toast.error('Enter at least KES 100');return;}setBusy(true);const {data,error}=await supabase.rpc('add_boost_budget',{p_boost_id:boost.id,p_amount_minor:kes*100});setBusy(false);if(error)toast.error(error.message);else{setBoost(data);setAll(v=>v.map(x=>x.id===data.id?data:x));toast.success(`KES ${kes.toLocaleString()} added from Wallet`);}};
  if(loading)return <div className="min-h-screen flex items-center justify-center"><Loader2 className="animate-spin"/></div>;
  if(!boost)return <div className="min-h-screen"><TopBar title="Boost Analytics" showBack/><PageAdBanner/><main className="max-w-xl mx-auto p-6 text-center py-20"><Target className="mx-auto w-12 h-12 opacity-30"/><h1 className="text-xl font-bold mt-3">No boost campaign found</h1><button onClick={()=>navigate(-1)} className="mt-5 rounded-xl border px-4 py-2"><ArrowLeft className="inline w-4 h-4 mr-2"/>Back</button></main></div>;
  const budget=Number(boost.budget_minor||0)/100, spent=Number(boost.spent_minor||0)/100;
  const ctr=Number(boost.impressions)>0?(Number(boost.clicks||0)/Number(boost.impressions)*100):0;
  const pct=budget>0?Math.min(100,spent/budget*100):0;
  return <div className="min-h-screen bg-background pb-20"><TopBar title="Boost Analytics" showBack/><PageAdBanner/><main className="max-w-3xl mx-auto p-4 space-y-5">
    <section className="rounded-2xl border border-primary/20 bg-primary/5 p-5"><div className="flex justify-between gap-3"><div><p className="text-xs text-muted-foreground uppercase font-bold">{boost.status}</p><h1 className="text-xl font-black mt-1">{post?.content?.slice(0,100)||'Boost campaign'}</h1><p className="text-xs text-muted-foreground mt-2">Objective: {boost.boost_type}</p></div><button onClick={load} className="p-2 rounded-xl border"><RefreshCw className="w-4 h-4"/></button></div><div className="mt-4 h-2 rounded-full bg-muted overflow-hidden"><div className="h-full bg-primary" style={{width:`${pct}%`}}/></div><div className="flex justify-between text-xs text-muted-foreground mt-1"><span>KES {spent.toLocaleString()} spent</span><span>KES {budget.toLocaleString()} funded</span></div></section>
    <section className="grid grid-cols-2 md:grid-cols-4 gap-3">{[[Eye,'Impressions',formatNumber(boost.impressions||0)],[TrendingUp,'Clicks',formatNumber(boost.clicks||0)],[BarChart3,'CTR',`${ctr.toFixed(2)}%`],[DollarSign,'Budget',`KES ${budget.toLocaleString()}`]].map(([I,l,v]:any)=><div key={l} className="rounded-2xl border p-4"><I className="w-5 h-5 text-primary mb-2"/><p className="text-xl font-black">{v}</p><p className="text-xs text-muted-foreground">{l}</p></div>)}</section>
    <section className="rounded-2xl border p-5"><h2 className="font-bold mb-4">Campaign controls</h2><div className="flex flex-wrap gap-2"><button disabled={busy} onClick={pause} className="rounded-xl border px-4 py-2 font-semibold">{boost.status==='active'?<><Pause className="inline w-4 h-4 mr-2"/>Pause</>:<><Play className="inline w-4 h-4 mr-2"/>Resume</>}</button><div className="flex gap-2"><input value={amount} onChange={e=>setAmount(e.target.value)} type="number" min="100" step="100" className="w-28 rounded-xl border px-3 py-2" placeholder="KES"/><button disabled={busy} onClick={topup} className="rounded-xl bg-primary text-primary-foreground px-4 py-2 font-semibold"><Plus className="inline w-4 h-4 mr-1"/>Add budget</button></div></div><p className="text-xs text-muted-foreground mt-3">Every top-up is a Wallet debit to the Testagram PLATFORM account and is recorded in the double-entry ledger.</p></section>
    <section className="rounded-2xl border p-5"><h2 className="font-bold mb-3">Your campaigns</h2><div className="space-y-2">{all.map(b=><button key={b.id} onClick={()=>navigate(`/boost-analytics/${b.post_id}`)} className="w-full text-left rounded-xl border p-3 hover:bg-muted/40"><div className="flex justify-between"><span className="font-semibold">{b.boost_type}</span><span className="text-xs text-muted-foreground">{b.status}</span></div><p className="text-xs text-muted-foreground mt-1">KES {(Number(b.budget_minor||0)/100).toLocaleString()} · {formatNumber(b.impressions||0)} impressions</p></button>)}</div></section>
  </main></div>;
}