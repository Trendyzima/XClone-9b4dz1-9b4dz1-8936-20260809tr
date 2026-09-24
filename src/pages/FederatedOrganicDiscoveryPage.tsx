import { useCallback, useEffect, useRef, useState } from 'react';
import { Globe, Loader2, RefreshCw, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import * as federation from '@/api/federation';
import { FederatedOrganicCard } from '@/components/features/FederatedOrganicDiscovery';

export default function FederatedOrganicDiscoveryPage() {
  const [items,setItems]=useState<any[]>([]); const [loading,setLoading]=useState(true); const [loadingMore,setLoadingMore]=useState(false); const [refreshing,setRefreshing]=useState(false); const [nextCursor,setNextCursor]=useState<string|null>(null); const sentinelRef=useRef<HTMLDivElement|null>(null);
  const load=useCallback(async(cursor?:string)=>{cursor?setLoadingMore(true):setLoading(true);try{const r=await federation.getFederatedDiscoveryFeed({limit:12,surface:'discover',cursor});setItems(prev=>cursor?[...prev,...(r.items??[])]:r.items??[]);setNextCursor(r.nextCursor??null)}catch(e:any){toast.error(e?.message??'Federated discovery unavailable')}finally{cursor?setLoadingMore(false):setLoading(false)}},[]);
  useEffect(()=>{void load()},[load]);
  useEffect(()=>{const node=sentinelRef.current;if(!node||!nextCursor||loading||loadingMore)return;const observer=new IntersectionObserver(entries=>{if(entries[0]?.isIntersecting)void load(nextCursor)},{rootMargin:'700px'});observer.observe(node);return()=>observer.disconnect()},[nextCursor,loading,loadingMore,load]);
  return <div className="min-h-screen bg-background pb-16 md:pb-0">
    <div className="sticky top-0 z-20 bg-background/95 backdrop-blur border-b border-border px-4 py-3 flex items-center gap-3"><Sparkles className="w-5 h-5 text-primary"/><div><h1 className="font-bold">Federated Discovery</h1><p className="text-[11px] text-muted-foreground">Trending public posts from across the Fediverse</p></div><button className="ml-auto p-2" onClick={async()=>{setRefreshing(true);setNextCursor(null);await load();setRefreshing(false)}} disabled={refreshing}><RefreshCw className={`w-4 h-4 ${refreshing?'animate-spin':''}`}/></button></div>
    <main className="max-w-2xl mx-auto">{loading?<div className="py-20 flex justify-center"><Loader2 className="w-7 h-7 animate-spin text-primary"/></div>:items.length===0?<div className="py-20 px-6 text-center text-muted-foreground"><Globe className="w-10 h-10 mx-auto mb-3 opacity-30"/><p className="font-semibold">No federated discovery content yet</p><p className="text-sm mt-1">As public remote activity arrives, trending posts will appear here even when you do not follow the authors.</p></div>:items.map(item=><FederatedOrganicCard key={item.id??item.uri} item={item}/>)}<div ref={sentinelRef} className="h-12 flex items-center justify-center">{loadingMore&&<Loader2 className="w-5 h-5 animate-spin text-muted-foreground"/>}</div></main>
  </div>;
}
