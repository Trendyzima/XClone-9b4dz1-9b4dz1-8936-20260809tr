import { useCallback, useEffect, useState } from 'react';
import { Globe, Loader2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import * as federation from '@/api/federation';
import { FederatedOrganicCard } from '@/components/features/FederatedOrganicDiscovery';

export default function FederatedOrganicDiscoveryPage() {
  const [items,setItems]=useState<any[]>([]); const [loading,setLoading]=useState(true); const [refreshing,setRefreshing]=useState(false);
  const load=useCallback(async()=>{setLoading(true);try{const r=await federation.getFederatedDiscoveryFeed({limit:12,surface:'discover'});setItems(r.items??[])}catch(e:any){toast.error(e?.message??'Federated discovery unavailable')}finally{setLoading(false)}},[]);
  useEffect(()=>{void load()},[load]);
  return <div className="min-h-screen bg-background pb-16 md:pb-0">
    <div className="sticky top-0 z-20 bg-background/95 backdrop-blur border-b border-border px-4 py-3 flex items-center gap-3"><Sparkles className="w-5 h-5 text-primary"/><div><h1 className="font-bold">Federated Discovery</h1><p className="text-[11px] text-muted-foreground">Trending public posts from across the Fediverse</p></div><button className="ml-auto p-2" onClick={async()=>{setRefreshing(true);await load();setRefreshing(false)}} disabled={refreshing}><RefreshCw className={`w-4 h-4 ${refreshing?'animate-spin':''}`}/></button></div>
    <main className="max-w-2xl mx-auto">{loading?<div className="py-20 flex justify-center"><Loader2 className="w-7 h-7 animate-spin text-primary"/></div>:items.length===0?<div className="py-20 px-6 text-center text-muted-foreground"><Globe className="w-10 h-10 mx-auto mb-3 opacity-30"/><p className="font-semibold">No federated discovery content yet</p><p className="text-sm mt-1">As public remote activity arrives, trending posts will appear here even when you do not follow the authors.</p></div>:items.map(item=><FederatedOrganicCard key={item.id??item.uri} item={item}/>)}</main>
  </div>;
}
