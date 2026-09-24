import { lazy, Suspense, useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ComposePost } from '@/components/features/ComposePost';
import { PostCard } from '@/components/features/PostCard';
import { ThreadCard } from '@/components/features/ThreadCard';

import { TopBar } from '@/components/layout/TopBar';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useSEO } from '@/hooks/useSEO';
import { useInfiniteScroll } from '@/hooks/useInfiniteScroll';
import * as federation from '@/api/federation';
import { Loader2, Sparkles, Users, ShoppingBag, BarChart3, RefreshCw, ArrowRight } from 'lucide-react';
import { FederatedOrganicInjection } from '@/components/features/FederatedOrganicDiscovery';

type Tab = 'all'|'following'|'explore'|'media'|'communities'|'polls'|'shopping'|'federated';
type Item = { type:'post'|'thread'|'community'|'poll'|'product'|'fedpost'; data:any };
const TABS: {id:Tab;label:string}[] = [
  {id:'all',label:'For you'},{id:'following',label:'Following'},{id:'explore',label:'Explore'},
  {id:'media',label:'Media'},{id:'communities',label:'Communities'},{id:'polls',label:'Polls'},
  {id:'shopping',label:'Shopping'},{id:'federated',label:'Federated'},
];
const StoriesStrip = lazy(() => import('@/components/features/StoriesStrip').then(m => ({ default: m.StoriesStrip })));
const profileSelect='user_profiles:profiles!posts_author_id_fkey(id,username,display_name,avatar_url,bio,verified_tier,follower_count,following_count,protected_account,cover_url,website,location,social_links,created_at)';

export default function HomeHubPage(){
  const {user}=useAuth(); const navigate=useNavigate();
  const [tab,setTab]=useState<Tab>('all'); const [items,setItems]=useState<Item[]>([]);
  const [loading,setLoading]=useState(true); const [loadingMore,setLoadingMore]=useState(false);
  const [refreshing,setRefreshing]=useState(false); const [hasMore,setHasMore]=useState(true); const [nextCursor,setNextCursor]=useState<string|null>(null);

  useSEO({title:'Home — Testagram',description:'One home feed for posts, videos, communities, polls, shopping and the Fediverse on Testagram.',url:'/',type:'website'});

  const fetchTab=useCallback(async(target:Tab,pageNum=0):Promise<Item[]>=>{
    if(target==='communities'){
      const {data,error}=await supabase.from('communities').select('*').order('member_count',{ascending:false}).range(0,11);
      if(error)throw error;
      return (data??[]).map((x:any)=>({type:'community',data:x}));
    }
    if(target==='polls'){
      const {data,error}=await supabase.from('polls').select('*').order('created_at',{ascending:false}).range(offset,offset+19);
      if(error)throw error;
      return (data??[]).map((x:any)=>({type:'poll',data:x}));
    }
    if(target==='shopping'){
      const {data,error}=await supabase.from('products').select('*').eq('is_active',true).order('created_at',{ascending:false}).range(offset,offset+19);
      if(error)throw error;
      return (data??[]).map((x:any)=>({type:'product',data:x}));
    }

    if(target==='all'){
      const token = (await supabase.auth.getSession()).data.session?.access_token;
      const params = new URLSearchParams({ limit: '6' });
      if (nextCursor) params.set('before', nextCursor);
      const response = await fetch('/api/home-feed?'+params.toString(), {
        headers: token ? { Authorization: 'Bearer '+token } : {},
      });
      if (!response.ok) throw new Error('Home edge feed unavailable');
      const payload = await response.json();
      const next = Array.isArray(payload?.items) ? payload.items : [];
      if (target === 'all') {
        setNextCursor(payload?.nextCursor ?? null);
        setHasMore(Boolean(payload?.hasMore) && next.length > 0);
      }
      return next.map((item:any)=>({ type:item.type, data:item.data }));
    }

    let query=supabase.from('posts').select('*, '+profileSelect).is('community_id',null).is('deleted_at',null);
    if(target==='following'&&user){
      const {data:follows,error:followsError}=await supabase.from('follows').select('following_id').eq('follower_id',user.id);
      if(followsError)throw followsError;
      const ids=(follows??[]).map((x:any)=>x.following_id);
      if(!ids.length)return [];
      query=query.in('user_id',ids);
    }
    if(target==='media')query=query.or('image_url.not.is.null,video_url.not.is.null,media_count.gt.0');
    if(target==='explore')query=query.order('likes_count',{ascending:false}).order('views_count',{ascending:false});
    else query=query.order('created_at',{ascending:false});
    const {data,error}=await query.range(offset,offset+19);
    if(error)throw error;
    return (data??[]).map((x:any)=>({type:'post' as const,data:x}));
  },[user?.id]);

  const load=useCallback(async(target:Tab)=>{setLoading(true);setNextCursor(null);setHasMore(true);try{const next=await fetchTab(target,0);setItems(next);if(target!=='all')setHasMore(next.length>=12);}catch(e){console.error('[home-hub]',e);setItems([]);setHasMore(false);}finally{setLoading(false);}},[fetchTab]);
  useEffect(()=>{void load(tab);},[tab,load]);

  const loadMore=useCallback(async()=>{if(!hasMore||loadingMore)return false;setLoadingMore(true);try{const next=await fetchTab(tab,1);setItems(prev=>[...prev,...next]);if(tab!=='all')setHasMore(next.length>=12);return next.length>0;}finally{setLoadingMore(false);}},[fetchTab,hasMore,loadingMore,tab,nextCursor]);
  const {lastElementRef}=useInfiniteScroll(loadMore);
  const refresh=async()=>{setRefreshing(true);await load(tab);setRefreshing(false);};

  return <div className="min-h-screen bg-background pb-16 lg:pb-0">
    <TopBar title="Home"/><Suspense fallback={<div className="h-20 border-b border-border bg-background" aria-hidden="true" />}><StoriesStrip/></Suspense>
    <div className="sticky top-14 z-30 bg-background/95 backdrop-blur border-b border-border"><div className="flex overflow-x-auto scrollbar-hide">
      {TABS.map(t=><button key={t.id} onClick={()=>setTab(t.id)} className={'min-w-[96px] px-4 py-3 text-sm font-semibold border-b-2 whitespace-nowrap '+(tab===t.id?'border-primary text-foreground':'border-transparent text-muted-foreground hover:bg-muted/40')}>{t.label}</button>)}
    </div></div>
    <div className="px-3 py-2 border-b border-border flex gap-2">
      <button onClick={()=>navigate('/shop')} className="flex-1 rounded-xl border border-border bg-card px-3 py-2 text-xs font-bold flex items-center justify-center gap-2"><ShoppingBag className="w-4 h-4 text-primary"/>Shopping Mall</button>
      <button onClick={()=>navigate('/polls')} className="flex-1 rounded-xl border border-border bg-card px-3 py-2 text-xs font-bold flex items-center justify-center gap-2"><BarChart3 className="w-4 h-4 text-primary"/>Community Polls</button>
    </div>
    <ComposePost onSuccess={()=>load(tab)}/>
    {!loading&&<button onClick={refresh} disabled={refreshing} className="w-full py-2 border-b border-border text-xs text-muted-foreground flex items-center justify-center gap-2"><RefreshCw className={'w-3 h-3 '+(refreshing?'animate-spin':'')}/>{refreshing?'Refreshing…':'Refresh feed'}</button>}
    {loading?<div className="py-20 flex justify-center"><Loader2 className="w-7 h-7 animate-spin text-primary"/></div>:
      items.length===0?<div className="py-20 text-center text-muted-foreground"><Sparkles className="w-10 h-10 mx-auto mb-3 opacity-30"/><p className="font-semibold">Nothing here yet</p><p className="text-sm mt-1">Explore another section or be the first to add content.</p></div>:
      <div>{items.map((item,i)=><div key={item.type+'-'+(item.data?.id??i)} ref={i===items.length-1?lastElementRef:null}>
        {item.type==='post'&&<PostCard post={item.data} onUpdate={()=>load(tab)}/>}
        {item.type==='thread'&&<ThreadCard thread={item.data}/>}
        {item.type==='fedpost'&&<PostCard post={item.data} onUpdate={()=>load(tab)}/>}
        {item.type==='community'&&<CommunityCard community={item.data} onOpen={()=>navigate('/c/'+item.data.name)}/>}
        {item.type==='poll'&&<PollCard poll={item.data} onOpen={()=>navigate('/polls')}/>}
        {item.type==='product'&&<ProductCard product={item.data} onOpen={()=>navigate('/p/'+item.data.id)}/>}
        {tab==='all'&&i===4&&<FederatedOrganicInjection surface="home"/>}
      </div>)}
      {loadingMore&&<div className="py-8 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-primary"/></div>}
      {!loadingMore&&!hasMore&&<div className="py-10 text-center text-xs text-muted-foreground">You’re all caught up.</div>}</div>}
  </div>;
}

function CommunityCard({community,onOpen}:{community:any;onOpen:()=>void}){return <button onClick={onOpen} className="w-full text-left p-4 border-b border-border hover:bg-muted/30"><div className="flex items-center gap-3"><div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center"><Users className="w-5 h-5 text-primary"/></div><div className="min-w-0"><p className="font-bold truncate">{community.display_name??community.name}</p><p className="text-xs text-muted-foreground">{Number(community.member_count??0).toLocaleString()} members</p></div><ArrowRight className="ml-auto w-4 h-4 text-muted-foreground"/></div>{community.description&&<p className="text-sm text-muted-foreground mt-3 line-clamp-2">{community.description}</p>}</button>;}

function PollCard({poll,onOpen}:{poll:any;onOpen:()=>void}){return <button onClick={onOpen} className="w-full text-left p-4 border-b border-border hover:bg-muted/30"><div className="flex items-center gap-2 mb-2"><BarChart3 className="w-4 h-4 text-primary"/><span className="font-bold text-sm">Community poll</span></div><p className="font-semibold">{poll.question??poll.title??'Community poll'}</p>{Array.isArray(poll.options)&&<div className="mt-3 space-y-2">{poll.options.slice(0,4).map((o:any,i:number)=><div key={i} className="rounded-lg bg-muted px-3 py-2 text-xs">{typeof o==='string'?o:(o.text??o.label??('Option '+(i+1)))}</div>)}</div>}</button>;}

function ProductCard({product,onOpen}:{product:any;onOpen:()=>void}){return <button onClick={onOpen} className="w-full text-left p-4 border-b border-border hover:bg-muted/30"><div className="flex gap-3"><div className="w-20 h-20 rounded-xl overflow-hidden bg-muted shrink-0">{product.image_url?<img src={product.image_url} alt="" className="w-full h-full object-cover" loading="lazy"/>:<ShoppingBag className="w-7 h-7 m-6 text-muted-foreground"/>}</div><div className="min-w-0"><p className="font-bold line-clamp-1">{product.name??'Product'}</p><p className="text-primary font-black mt-1">{'$'+Number(product.price??0).toFixed(2)}</p>{product.description&&<p className="text-xs text-muted-foreground line-clamp-2 mt-1">{product.description}</p>}<span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground mt-2"><ShoppingBag className="w-3 h-3"/>View in Shopping Mall</span></div></div></button>;}
