import { lazy, Suspense, useState, useEffect, useCallback, useRef } from 'react';
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
import { readHomeFeedCache, writeHomeFeedCache, saveHomeScroll, mergeHomeFeedItems } from '@/lib/homeFeedCache';

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
  const [cacheHydrated,setCacheHydrated]=useState(false); const [newCount,setNewCount]=useState(0); const nextCursorRef=useRef<string|null>(null); const scrollTimer=useRef<number|undefined>(undefined); const feedBufferRef=useRef<Item[]>([]); const feedBufferOffsetRef=useRef(0); const cacheCursorRef=useRef<string|null>(null); const prefetchingRef=useRef(false); const refreshTimerRef=useRef<number|undefined>(undefined);

  useSEO({title:'Home — Testagram',description:'One home feed for posts, videos, communities, polls, shopping and the Fediverse on Testagram.',url:'/',type:'website'});

  const fetchTab=useCallback(async(target:Tab,pageNum=0,cursorOverride: string|null = null):Promise<Item[]>=>{
    const offset=pageNum*12;
    if(target==='communities'){
      const {data,error}=await supabase.from('communities').select('*').order('member_count',{ascending:false}).range(0,11);
      if(error)throw error;
      return (data??[]).map((x:any)=>({type:'community',data:x}));
    }
    if(target==='polls'){
      const {data,error}=await supabase.from('polls').select('*').order('created_at',{ascending:false}).range(offset,offset+11);
      if(error)throw error;
      return (data??[]).map((x:any)=>({type:'poll',data:x}));
    }
    if(target==='shopping'){
      const {data,error}=await supabase.from('products').select('*').eq('is_active',true).order('created_at',{ascending:false}).range(offset,offset+11);
      if(error)throw error;
      return (data??[]).map((x:any)=>({type:'product',data:x}));
    }

    if(target==='all'){
      const token = (await supabase.auth.getSession()).data.session?.access_token;
      const params = new URLSearchParams({ limit: '6' });
      if (cursorOverride) params.set('before', cursorOverride);
      const response = await fetch('/api/home-feed?'+params.toString(), {
        headers: token ? { Authorization: 'Bearer '+token } : {},
      });
      if (!response.ok) throw new Error('Home edge feed unavailable');
      const payload = await response.json();
      const next = Array.isArray(payload?.items) ? payload.items : [];
      if (target === 'all') {
        setNextCursor(payload?.nextCursor ?? null); nextCursorRef.current=payload?.nextCursor ?? null;
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

  const persistBuffer=useCallback(async()=>{
    await writeHomeFeedCache({key:'home',items:feedBufferRef.current,cursor:cacheCursorRef.current,updatedAt:Date.now(),scrollY:window.scrollY,anchorId:items[0]?.data?.id??null});
  },[items]);

  const prefetchNext=useCallback(async()=>{
    if(tab!=='all'||prefetchingRef.current||!cacheCursorRef.current)return;
    prefetchingRef.current=true;
    try{
      const next=await fetchTab('all',0,cacheCursorRef.current);
      if(next.length){
        feedBufferRef.current=mergeHomeFeedItems(feedBufferRef.current,next,80);
        cacheCursorRef.current=nextCursorRef.current;
        setHasMore(Boolean(cacheCursorRef.current));
        await persistBuffer();
      }else{cacheCursorRef.current=null;nextCursorRef.current=null;setHasMore(false);}
    }catch(e){console.warn('[home-hub] background prefetch',e)}
    finally{prefetchingRef.current=false;}
  },[fetchTab,persistBuffer,tab]);

  const load=useCallback(async(target:Tab,background=false)=>{
    if(target!=='all'){
      if(!background)setLoading(true);
      try{const next=await fetchTab(target,0);setItems(next);setHasMore(next.length>=12);}
      catch(e){console.error('[home-hub]',e);if(!background){setItems([]);setHasMore(false);}}
      finally{if(!background)setLoading(false);}
      return;
    }
    try{
      const next=await fetchTab('all',0);
      const previous=feedBufferRef.current;
      const previousIds=new Set(previous.map(x=>String(x.data?.id??x.data?.uri??'')));
      const fresh=next.filter(x=>!previousIds.has(String(x.data?.id??x.data?.uri??'')));
      feedBufferRef.current=mergeHomeFeedItems(previous,next,80);
      cacheCursorRef.current=nextCursorRef.current;
      if(background){
        setNewCount(fresh.length);
        if(fresh.length&&window.scrollY<500){setItems(prev=>{const merged=[...fresh,...prev].slice(0,80);feedBufferOffsetRef.current=merged.length;return merged;});}
      }else{
        setItems(next);feedBufferRef.current=mergeHomeFeedItems([],next,80);feedBufferOffsetRef.current=next.length;cacheCursorRef.current=nextCursorRef.current;setLoading(false);
      }
      setHasMore(Boolean(cacheCursorRef.current));
      await persistBuffer();
      void prefetchNext();
    }catch(e){console.error('[home-hub]',e);if(!background){setItems([]);setHasMore(false);setLoading(false);}}
  },[fetchTab,persistBuffer,prefetchNext]);

  useEffect(()=>{
    let active=true;
    if(tab!=='all'){void load(tab);return()=>{active=false;};}
    void readHomeFeedCache().then(cached=>{
      if(!active)return;
      if(cached?.items?.length){
        feedBufferRef.current=cached.items;
        feedBufferOffsetRef.current=Math.min(6,cached.items.length);
        setItems(cached.items.slice(0,6));
        cacheCursorRef.current=cached.cursor;nextCursorRef.current=cached.cursor;
        setHasMore(Boolean(cached.cursor)||cached.items.length>6);setLoading(false);setCacheHydrated(true);
        if(cached.scrollY>0)requestAnimationFrame(()=>window.scrollTo({top:cached.scrollY,behavior:'instant' as ScrollBehavior}));
        void prefetchNext();
      }else {setCacheHydrated(true);void load('all');}
      if(cached?.items?.length)void load('all',true);
    }).catch(()=>{setCacheHydrated(true);void load('all');});
    const onScroll=()=>{window.clearTimeout(scrollTimer.current);scrollTimer.current=window.setTimeout(()=>saveHomeScroll(window.scrollY,items[0]?.data?.id??null),250);};
    window.addEventListener('scroll',onScroll,{passive:true});
    const scheduleRefresh=()=>{window.clearTimeout(refreshTimerRef.current);refreshTimerRef.current=window.setTimeout(()=>void load('all',true),1500);};
    const channel=supabase.channel('home-feed-live')
      .on('postgres_changes',{event:'INSERT',schema:'public',table:'posts'},scheduleRefresh)
      .on('postgres_changes',{event:'INSERT',schema:'public',table:'threads'},scheduleRefresh)
      .subscribe();
    const fallback=window.setInterval(()=>{if(document.visibilityState==='visible')void load('all',true);},60000);
    return()=>{active=false;window.removeEventListener('scroll',onScroll);window.clearTimeout(refreshTimerRef.current);window.clearInterval(fallback);void supabase.removeChannel(channel);};
  },[tab]);

  useEffect(()=>{if(tab==='all'&&cacheHydrated&&items.length===0)void load('all');},[cacheHydrated,tab]);
  useEffect(()=>{if(newCount>0&&window.scrollY<500)setNewCount(0);},[newCount]);

  const loadMore=useCallback(async()=>{
    if(!hasMore||loadingMore)return false;setLoadingMore(true);
    try{
      if(tab==='all'){
        const offset=feedBufferOffsetRef.current;
        if(offset<feedBufferRef.current.length){
          const next=feedBufferRef.current.slice(offset,offset+6);
          feedBufferOffsetRef.current=offset+next.length;setItems(prev=>[...prev,...next]);
          if(feedBufferOffsetRef.current+3>=feedBufferRef.current.length)void prefetchNext();
          return next.length>0;
        }
        if(cacheCursorRef.current){
          const next=await fetchTab('all',0,cacheCursorRef.current);
          if(next.length){
            feedBufferRef.current=mergeHomeFeedItems(feedBufferRef.current,next,80);
            cacheCursorRef.current=nextCursorRef.current;
            const page=feedBufferRef.current.slice(offset,offset+6);
            feedBufferOffsetRef.current=offset+page.length;setItems(prev=>[...prev,...page]);await persistBuffer();
            return page.length>0;
          }
        }
        setHasMore(false);return false;
      }
      const next=await fetchTab(tab,1,nextCursor);setItems(prev=>[...prev,...next]);setHasMore(next.length>=12);return next.length>0;
    }finally{setLoadingMore(false);}
  },[fetchTab,hasMore,loadingMore,tab,nextCursor,prefetchNext,persistBuffer]);

  const {lastElementRef}=useInfiniteScroll(loadMore);
  const refresh=async()=>{setRefreshing(true);try{await load(tab);}finally{setRefreshing(false);}};

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
    {!loading&&newCount>0&&<button onClick={()=>{window.scrollTo({top:0,behavior:'smooth'});setNewCount(0)}} className="w-full py-2 bg-primary/5 text-xs font-semibold text-primary">{newCount} new post{newCount===1?'':'s'} · Tap to view</button>}
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
