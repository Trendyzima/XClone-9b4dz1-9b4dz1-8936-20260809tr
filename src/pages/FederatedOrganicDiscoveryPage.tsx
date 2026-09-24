import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Globe, Loader2, UserPlus, RefreshCw, Sparkles } from 'lucide-react';
import * as federation from '@/api/federation';
import { toast } from 'sonner';

function stripHtml(value: unknown) { return String(value ?? '').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim(); }
function actorFrom(item:any) {
  const raw=item.raw_object?.attributedTo; const uri=String(item.actor_uri || (typeof raw==='string'?raw:raw?.id) || '');
  const fallback=uri.split('/').filter(Boolean).pop() || 'remote-user';
  return item.remote_account ?? { actor_uri:uri, username:fallback, display_name:fallback, domain: (()=>{try{return new URL(uri).hostname}catch{return ''}})() };
}

export function FederatedOrganicCard({ item, onFollow }: { item:any; onFollow?: (actor:string)=>void }) {
  const navigate=useNavigate(); const [following,setFollowing]=useState(false); const actor=actorFrom(item);
  const follow=async(e:React.MouseEvent)=>{e.stopPropagation(); if(following)return; try{await federation.follow(actor.actor_uri);setFollowing(true);onFollow?.(actor.actor_uri);toast.success('Follow request sent')}catch(err:any){toast.error(err?.message??'Follow failed')}};
  return <article className="border-b border-border bg-card">
    <div className="px-4 pt-3 flex items-center gap-3">
      <button onClick={()=>navigate(`/fediverse/profile/posts?actor=${encodeURIComponent(actor.actor_uri)}`)} className="flex items-center gap-2 min-w-0 text-left">
        <div className="w-9 h-9 rounded-full bg-primary/10 overflow-hidden shrink-0">{actor.avatar_url?<img src={actor.avatar_url} alt="" className="w-full h-full object-cover" loading="lazy"/>:<Globe className="w-5 h-5 m-2 text-primary"/>}</div>
        <div className="min-w-0"><p className="font-semibold text-sm truncate">{actor.display_name||actor.username}</p><p className="text-[11px] text-muted-foreground truncate">@{actor.username}{actor.domain?`@${actor.domain}`:''}</p></div>
      </button>
      <span className="ml-auto text-[10px] text-muted-foreground flex items-center gap-1 shrink-0"><Globe className="w-3 h-3"/>Fediverse</span>
      <button onClick={follow} disabled={following} className="px-2.5 py-1 rounded-full border border-primary/30 text-primary text-xs font-semibold disabled:opacity-60"><UserPlus className="inline w-3 h-3 mr-1"/>{following?'Following':'Follow'}</button>
    </div>
    <button onClick={()=>item.url&&window.open(item.url,'_blank','noopener,noreferrer')} className="w-full text-left px-4 py-3">
      {item.content_warning&&<p className="text-xs text-muted-foreground mb-2">Content warning: {item.content_warning}</p>}
      <p className="text-sm whitespace-pre-wrap leading-relaxed">{stripHtml(item.content||item.summary)||'Remote post'}</p>
      {Array.isArray(item.attachments)&&item.attachments.length>0&&<p className="text-[11px] text-muted-foreground mt-2">{item.attachments.length} media attachment{item.attachments.length===1?'':'s'}</p>}
      <p className="text-[10px] text-muted-foreground mt-2">{item.published_at?new Date(item.published_at).toLocaleString():''} · {actor.domain||'remote instance'}</p>
    </button>
  </article>;
}

export function FederatedOrganicInjection({ surface = 'home' }: { surface?: string }) {
  const [item, setItem] = useState<any | null>(null);
  useEffect(() => { let active=true; federation.getFederatedDiscoveryFeed({limit:1,surface}).then(r=>{if(active)setItem(r.items?.[0]??null)}).catch(()=>{}); return ()=>{active=false}; }, [surface]);
  if (!item) return null;
  return <div className="border-y border-border bg-card"><div className="px-4 py-2 flex items-center gap-2 text-[11px] text-muted-foreground"><Sparkles className="w-3.5 h-3.5 text-primary"/>Suggested from the Fediverse</div><FederatedOrganicCard item={item}/></div>;
}

export default function FederatedOrganicDiscoveryPage() {
  const [items,setItems]=useState<any[]>([]); const [loading,setLoading]=useState(true); const [refreshing,setRefreshing]=useState(false);
  const load=useCallback(async()=>{setLoading(true);try{const r=await federation.getFederatedDiscoveryFeed({limit:12,surface:'discover'});setItems(r.items??[])}catch(e:any){toast.error(e?.message??'Federated discovery unavailable')}finally{setLoading(false)}},[]);
  useEffect(()=>{void load()},[load]);
  return <div className="min-h-screen bg-background pb-16 md:pb-0">
    <div className="sticky top-0 z-20 bg-background/95 backdrop-blur border-b border-border px-4 py-3 flex items-center gap-3"><Sparkles className="w-5 h-5 text-primary"/><div><h1 className="font-bold">Federated Discovery</h1><p className="text-[11px] text-muted-foreground">Trending public posts from across the Fediverse</p></div><button className="ml-auto p-2" onClick={async()=>{setRefreshing(true);await load();setRefreshing(false)}} disabled={refreshing}><RefreshCw className={`w-4 h-4 ${refreshing?'animate-spin':''}`}/></button></div>
    <main className="max-w-2xl mx-auto">{loading?<div className="py-20 flex justify-center"><Loader2 className="w-7 h-7 animate-spin text-primary"/></div>:items.length===0?<div className="py-20 px-6 text-center text-muted-foreground"><Globe className="w-10 h-10 mx-auto mb-3 opacity-30"/><p className="font-semibold">No federated discovery content yet</p><p className="text-sm mt-1">As public remote activity arrives, trending posts will appear here even when you do not follow the authors.</p></div>:items.map(item=><FederatedOrganicCard key={item.id??item.uri} item={item}/>)}</main>
  </div>;
}
