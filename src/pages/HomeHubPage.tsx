import { lazy, Suspense, useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ComposePost } from '@/components/features/ComposePost';
import { PostCard } from '@/components/features/PostCard';
import { PollCard as FeedPollCard } from '@/components/features/PollCard';
import { ThreadCard } from '@/components/features/ThreadCard';

import { TopBar } from '@/components/layout/TopBar';
import { supabase, supabasePublishableKey } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useSEO } from '@/hooks/useSEO';
import { useInfiniteScroll } from '@/hooks/useInfiniteScroll';
import * as federation from '@/api/federation';
import { Loader2, Sparkles, Users, ShoppingBag, BarChart3, RefreshCw, ArrowRight } from 'lucide-react';
import { readHomeFeedCache, writeHomeFeedCache, saveHomeScroll, mergeHomeFeedItems, isHomeFeedCacheUsable } from '@/lib/homeFeedCache';
import { FederatedOrganicCard, FederatedOrganicInjection, FederatedHashtagDiscovery } from '@/components/features/FederatedOrganicDiscovery';
import { loadPublisherFeed, PublisherFeedCard, type FeedItem } from '@/components/features/PublisherFeedStream';
import { TvPostStream } from '@/components/features/TvPostStream';
import { NewsifyTrendingRail } from '@/components/features/NewsifyTrendingRail';

const LiveSpacesDiscoveryStrip = lazy(() => import('@/components/features/LiveSpacesDiscoveryStrip').then(m => ({ default: m.LiveSpacesDiscoveryStrip })));
const SyndicatedNewsRail = lazy(() => import('@/components/features/SyndicatedNewsRail').then(m => ({ default: m.SyndicatedNewsRail })));
const TrendingVideosSection = lazy(() => import('@/components/features/TrendingVideosSection').then(m => ({ default: m.TrendingVideosSection })));
const CommunitySpotlightStrip = lazy(() => import('@/components/features/CommunitySpotlightStrip').then(m => ({ default: m.CommunitySpotlightStrip })));
const ContentSuggestionsWidget = lazy(() => import('@/components/features/ContentSuggestionsWidget').then(m => ({ default: m.ContentSuggestionsWidget })));
const UserSuggestionsWidget = lazy(() => import('@/components/features/UserSuggestionsWidget').then(m => ({ default: m.UserSuggestionsWidget })));

type Tab = 'all'|'following'|'explore'|'media'|'communities'|'polls'|'shopping'|'federated';
type Item = { type:'post'|'thread'|'community'|'poll'|'product'|'fedpost'|'publisher'; data:any };

function blendPublisherItems(nativeItems: Item[], publishers: FeedItem[], seed: string|null): Item[] {
  if (!nativeItems.length || !publishers.length) return nativeItems;
  const hash = Array.from(seed ?? 'home').reduce((n, ch) => (n * 31 + ch.charCodeAt(0)) >>> 0, 7);
  const slot = Math.min(nativeItems.length, 3 + (hash % 3));
  const publisher = publishers[hash % publishers.length];
  if (!publisher) return nativeItems;
  const existing = new Set(nativeItems.filter(item => item.type === 'publisher').map(item => String(item.data?.id)));
  if (existing.has(String(publisher.id))) return nativeItems;
  return [...nativeItems.slice(0, slot), { type:'publisher' as const, data:publisher }, ...nativeItems.slice(slot)];
}
const TABS: {id:Tab;label:string}[] = [
  {id:'all',label:'For you'},{id:'following',label:'Following'},{id:'explore',label:'Explore'},
  {id:'media',label:'Media'},{id:'communities',label:'Communities'},{id:'polls',label:'Polls'},
  {id:'shopping',label:'Shopping'},{id:'federated',label:'Federated'},
];
const StoriesStrip = lazy(() => import('@/components/features/StoriesStrip').then(m => ({ default: m.StoriesStrip })));
const profileSelect='user_profiles:profiles!posts_author_id_fkey(id,username,display_name,avatar_url,bio,verified_tier,follower_count,following_count,protected_account,cover_url,website,location,social_links,created_at)';

function HomeFeedItem({item,index,lastElementRef,tab,onUpdate,onNavigate}:{item:Item;index:number;lastElementRef:((node:HTMLElement|null)=>void)|null;tab:Tab;onUpdate:()=>void;onNavigate:(path:string)=>void}) {
  const hostRef=useRef<HTMLDivElement|null>(null);
  const [mounted,setMounted]=useState(false);
  useEffect(()=>{
    const node=hostRef.current;
    if(!node){setMounted(true);return;}
    if(typeof IntersectionObserver==='undefined'){setMounted(true);return;}
    const observer=new IntersectionObserver(([entry])=>{
      if(entry.isIntersecting){setMounted(true);observer.disconnect();}
    },{rootMargin:'700px 0px'});
    observer.observe(node);
    return()=>observer.disconnect();
  },[]);
  const ref=(node:HTMLDivElement|null)=>{
    hostRef.current=node;
    lastElementRef?.(node);
  };
  if(!mounted) return <div ref={ref} className="min-h-[180px] border-b border-border bg-background" aria-hidden="true"/>;
  return <div ref={ref}>
    {item.type==='post'&&<PostCard post={item.data} onUpdate={onUpdate}/>}
    {item.type==='thread'&&<ThreadCard thread={item.data}/>}
    {item.type==='fedpost'&&(item.data?.is_federated_discovery?<FederatedOrganicCard item={item.data}/>:<PostCard post={item.data} onUpdate={onUpdate}/>)}
    {item.type==='community'&&<CommunityCard community={item.data} onOpen={()=>onNavigate('/c/'+item.data.name)}/>}
    {item.type==='poll'&&<FeedPollCard poll={item.data} postId={item.data?.post_id} repliesCount={item.data?.replies_count ?? 0} />}
    {item.type==='product'&&<ProductCard product={item.data} onOpen={()=>onNavigate('/p/'+item.data.id)}/>}
    {item.type==='publisher'&&<PublisherFeedCard item={item.data as FeedItem}/>}
    {tab==='all'&&index>0&&index%4===0&&<FederatedOrganicInjection surface="home"/>}
  </div>;
}

export default function HomeHubPage(){
  const {user}=useAuth(); const navigate=useNavigate();
  const [tab,setTab]=useState<Tab>('all'); const [items,setItems]=useState<Item[]>([]);
  const [loading,setLoading]=useState(true); const [loadingMore,setLoadingMore]=useState(false);
  const [refreshing,setRefreshing]=useState(false); const [hasMore,setHasMore]=useState(true); const [nextCursor,setNextCursor]=useState<string|null>(null);
  const [cacheHydrated,setCacheHydrated]=useState(false); const [newCount,setNewCount]=useState(0); const nextCursorRef=useRef<string|null>(null); const scrollTimer=useRef<number|undefined>(undefined); const feedBufferRef=useRef<Item[]>([]); const feedBufferOffsetRef=useRef(0); const cacheCursorRef=useRef<string|null>(null); const prefetchingRef=useRef(false); const refreshTimerRef=useRef<number|undefined>(undefined);

  useSEO({title:'Home — Testagram',description:'One home feed for posts, videos, communities, polls, shopping and the Fediverse on Testagram.',url:'/',type:'website'});

  const fetchTab=useCallback(async(target:Tab,pageNum=0,cursorOverride: string|null = null,includeFederated=true):Promise<Item[]>=>{
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

    if(target==='federated'){
      const token = (await supabase.auth.getSession()).data.session?.access_token;
      if(!token) return [];
      const params = new URLSearchParams({ limit: '12' });
      if (cursorOverride) params.set('before', cursorOverride);
      const response = await fetch((import.meta.env.VITE_SUPABASE_URL || 'https://ffrhglgkukgsuhxenena.supabase.co') + '/functions/v1/federated-feed?' + params.toString(), {
        headers: {
          Authorization: 'Bearer ' + token,
          apikey: supabasePublishableKey,
        },
      });
      if(!response.ok) throw new Error('Federated feed unavailable');
      const payload = await response.json();
      const fedItems = Array.isArray(payload?.items) ? payload.items : [];
      setNextCursor(payload?.pagination?.nextCursor ?? null);
      nextCursorRef.current = payload?.pagination?.nextCursor ?? null;
      setHasMore(Boolean(payload?.pagination?.hasMore) && fedItems.length > 0);
      return fedItems.map((p:any)=>({
        type:'fedpost' as const,
        data:{
          ...p,
          id:p.id ?? p.uri,
          content:p.content ?? p.text ?? '',
          created_at:p.created_at ?? p.published_at ?? p.published,
          user_profiles:p.user_profiles ?? p.remote_account ?? p.actor ?? p.account ?? p.author ?? {},
          media_urls:p.media_urls ?? p.mediaUrls ?? p.attachments ?? [],
          image_url:p.image_url ?? p.preview_image_url ?? p.thumbnail_url,
          video_url:p.video_url ?? p.videoUrl,
          is_video:Boolean(p.is_video || p.video_url || p.videoUrl),
          is_federated:true,
        },
      }));
    }

    if(target==='all'){
      const token = (await supabase.auth.getSession()).data.session?.access_token;
      const params = new URLSearchParams({ limit: '6', includeFederated: includeFederated ? '1' : '0' });
      if (cursorOverride) params.set('before', cursorOverride);

      // The edge aggregator is the preferred source because it blends local,
      // following, recommendations, threads and federation. Android WebView
      // environments can occasionally fail an edge request even while the
      // canonical Supabase API is healthy. Never turn a transient aggregator
      // failure into an empty Home/For You screen: fall back to the same public
      // local data the canonical web UI can render.
      try {
        const response = await fetch('/api/home-feed?'+params.toString(), {
          headers: token ? { Authorization: 'Bearer '+token } : {},
          cache: 'no-store',
        });
        if (response.ok) {
          const payload = await response.json();
          const next = Array.isArray(payload?.items) ? payload.items : [];
          if (next.length > 0 || cursorOverride) {
            setNextCursor(payload?.nextCursor ?? null); nextCursorRef.current=payload?.nextCursor ?? null;
            setHasMore(Boolean(payload?.hasMore) && next.length > 0);
            return next.map((item:any)=>({ type:item.type, data:item.data })) as Item[];
          }
        }
      } catch (error) {
        console.warn('[home-hub] edge feed unavailable; using direct public fallback', error);
      }

      const fallbackLimit = 12;
      let fallbackPosts = supabase.from('posts')
        .select('*, '+profileSelect)
        .is('community_id', null)
        .is('deleted_at', null)
        .order('created_at', {ascending:false})
        .range(0, fallbackLimit-1);
      if (cursorOverride) {
        // The aggregator cursor is opaque, so do not guess a created_at value
        // from it. A fresh first page is safer than rendering an empty feed.
        fallbackPosts = supabase.from('posts')
          .select('*, '+profileSelect)
          .is('community_id', null)
          .is('deleted_at', null)
          .order('created_at', {ascending:false})
          .range(0, fallbackLimit-1);
      }
      const fallbackThreads = supabase.from('threads')
        .select('*')
        .eq('visibility','public')
        .is('deleted_at',null)
        .order('created_at',{ascending:false})
        .range(0, fallbackLimit-1);
      const [{data:postData,error:postError},{data:threadData,error:threadError}] =
        await Promise.all([fallbackPosts,fallbackThreads]);
      if (postError) console.warn('[home-hub] direct post fallback', postError);
      if (threadError) console.warn('[home-hub] direct thread fallback', threadError);

      const fallbackItems: Item[] = [
        ...(postData ?? []).map((post:any)=>({type:'post' as const,data:post})),
        ...(threadData ?? []).map((thread:any)=>({type:'thread' as const,data:thread})),
      ].sort((a,b)=>Date.parse(String(b.data?.created_at??''))-Date.parse(String(a.data?.created_at??'')));

      setNextCursor(null);
      nextCursorRef.current=null;
      setHasMore(fallbackItems.length > 6);
      return fallbackItems.slice(0, fallbackLimit);
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

  const hydratePublisherLayer=useCallback(async(seed:string|null = null)=>{
    try{
      const publisherItems=await loadPublisherFeed();
      if(!publisherItems.length)return;
      setItems(prev=>{
        const merged=blendPublisherItems(prev,publisherItems,seed);
        if(merged===prev)return prev;
        feedBufferRef.current=mergeHomeFeedItems(feedBufferRef.current,merged.filter(item=>item.type==='publisher'),80);
        return merged;
      });
      await persistBuffer();
    }catch(e){console.warn('[home-hub] publisher layer',e);}
  },[persistBuffer]);

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
      const next=await fetchTab('all',0,null,background);
      const previous=feedBufferRef.current;
      const previousIds=new Set(previous.map(x=>String(x.data?.id??x.data?.uri??'')));
      const fresh=next.filter(x=>!previousIds.has(String(x.data?.id??x.data?.uri??'')));
      const retained=previous.filter(x=>x.type!=='fedpost');
      feedBufferRef.current=mergeHomeFeedItems(retained,next,80);
      cacheCursorRef.current=nextCursorRef.current;
      if(background){
        setNewCount(fresh.length);
        if(fresh.length&&window.scrollY<500){setItems(prev=>{const retained=prev;const merged=[...fresh,...retained].slice(0,80);feedBufferOffsetRef.current=merged.length;return merged;});}
      }else{
        setItems(next);feedBufferRef.current=mergeHomeFeedItems([],next,80);feedBufferOffsetRef.current=next.length;cacheCursorRef.current=nextCursorRef.current;setLoading(false);
      }
      setHasMore(Boolean(cacheCursorRef.current));
      await persistBuffer();
      void hydratePublisherLayer(background ? nextCursorRef.current : null);
    }catch(e){console.error('[home-hub]',e);if(!background){
      const cached=await readHomeFeedCache().catch(()=>null);
      if(cached && isHomeFeedCacheUsable(cached)){ feedBufferRef.current=cached.items; setItems(cached.items.slice(0, Math.max(6, feedBufferOffsetRef.current||6))); setHasMore(Boolean(cached.cursor)||cached.items.length>6); }
      else {setItems([]);setHasMore(false);}
      setLoading(false);
    }}
  },[fetchTab,persistBuffer,hydratePublisherLayer]);

  useEffect(()=>{
    let active=true;
    if(tab!=='all'){void load(tab);return()=>{active=false;};}
    void readHomeFeedCache().then(cached=>{
      if(!active)return;
      if(cached?.items?.length){
        const freshCached=cached.items.filter((item:any)=>item?.type!=='fedpost'||Date.parse(String(item?.data?.created_at??item?.data?.published_at??item?.data?.published??''))>=Date.now()-24*60*60*1000);
        feedBufferRef.current=freshCached;
        feedBufferOffsetRef.current=Math.min(6,cached.items.length);
        setItems(freshCached.slice(0,6));
        cacheCursorRef.current=cached.cursor;nextCursorRef.current=cached.cursor;
        if(isHomeFeedCacheUsable(cached)){
          setHasMore(Boolean(cached.cursor)||freshCached.length>6);
        } else {
          setHasMore(freshCached.length>6);
        }
        setLoading(false);setCacheHydrated(true);
        if(cached.scrollY>0)requestAnimationFrame(()=>window.scrollTo({top:cached.scrollY,behavior:'instant' as ScrollBehavior}));
      }else {
        setCacheHydrated(true);
        void load('all').then(()=>{ window.setTimeout(()=>void load('all',true),600); });
      }
      if(cached?.items?.length)void load('all',true);
    }).catch(()=>{
      setCacheHydrated(true);
      void load('all').then(()=>{ window.setTimeout(()=>void load('all',true),600); });
    });
    const onScroll=()=>{window.clearTimeout(scrollTimer.current);scrollTimer.current=window.setTimeout(()=>saveHomeScroll(window.scrollY,items[0]?.data?.id??null),250);};
    window.addEventListener('scroll',onScroll,{passive:true});
    const scheduleRefresh=()=>{
      window.clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current=window.setTimeout(()=>{
        const active=document.activeElement;
        if(active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement){
          refreshTimerRef.current=window.setTimeout(scheduleRefresh,5000);
          return;
        }
        void load('all',true);
      },1500);
    };
    const channel=supabase.channel('home-feed-live')
      .on('postgres_changes',{event:'INSERT',schema:'public',table:'posts'},scheduleRefresh)
       .on('postgres_changes',{event:'INSERT',schema:'public',table:'threads'},scheduleRefresh)
      .on('postgres_changes',{event:'INSERT',schema:'public',table:'federated_objects'},scheduleRefresh)
      .on('postgres_changes',{event:'UPDATE',schema:'public',table:'federated_objects'},scheduleRefresh)
      .on('postgres_changes',{event:'DELETE',schema:'public',table:'federated_objects'},scheduleRefresh)
      .subscribe();
    const fallback=window.setInterval(()=>{
      if(document.visibilityState!=='visible')return;
      const active=document.activeElement;
      if(active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement)return;
      void load('all',true);
    },30000);
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
    <TopBar title="Home"/>
    <Suspense fallback={<div className="h-20 border-b border-border bg-background" aria-hidden="true" />}><StoriesStrip tv={<TvPostStream index={0} compact />} /></Suspense>

    {/* Testagram TV is a status-style live tile inside the Stories strip; the player opens only after the user taps it. */}
    <Suspense fallback={null}><LiveSpacesDiscoveryStrip/></Suspense>

    <div className="sticky top-14 z-30 bg-background/95 backdrop-blur border-b border-border"><div className="flex overflow-x-auto scrollbar-hide">
      {TABS.map(t=><button key={t.id} onClick={()=>setTab(t.id)} className={'min-w-[96px] px-4 py-3 text-sm font-semibold border-b-2 whitespace-nowrap '+(tab===t.id?'border-primary text-foreground':'border-transparent text-muted-foreground hover:bg-muted/40')}>{t.label}</button>)}
    </div></div>
    <div className="px-3 py-2 border-b border-border flex gap-2">
      <button onClick={()=>navigate('/shop')} className="flex-1 rounded-xl border border-border bg-card px-3 py-2 text-xs font-bold flex items-center justify-center gap-2"><ShoppingBag className="w-4 h-4 text-primary"/>Shopping Mall</button>
      <button onClick={()=>navigate('/polls')} className="flex-1 rounded-xl border border-border bg-card px-3 py-2 text-xs font-bold flex items-center justify-center gap-2"><BarChart3 className="w-4 h-4 text-primary"/>Community Polls</button>
    </div>
    <FederatedHashtagDiscovery surface="home" />
    <NewsifyTrendingRail />
    <ComposePost onSuccess={()=>load(tab)}/>
    {!loading&&newCount>0&&<button onClick={()=>{window.scrollTo({top:0,behavior:'smooth'});setNewCount(0)}} className="w-full py-2 bg-primary/5 text-xs font-semibold text-primary">{newCount} new post{newCount===1?'':'s'} · Tap to view</button>}
    {!loading&&<button onClick={refresh} disabled={refreshing} className="w-full py-2 border-b border-border text-xs text-muted-foreground flex items-center justify-center gap-2"><RefreshCw className={'w-3 h-3 '+(refreshing?'animate-spin':'')}/>{refreshing?'Refreshing…':'Refresh feed'}</button>}
    {loading?<div className="py-20 flex justify-center"><Loader2 className="w-7 h-7 animate-spin text-primary"/></div>:
      items.length===0?<div className="py-20 text-center text-muted-foreground"><Sparkles className="w-10 h-10 mx-auto mb-3 opacity-30"/><p className="font-semibold">Nothing here yet</p><p className="text-sm mt-1">Explore another section or be the first to add content.</p></div>:
      <div>{items.map((item,i)=><HomeFeedItem key={item.type+'-'+(item.data?.id??i)} item={item} index={i} lastElementRef={i===items.length-1?lastElementRef:null} tab={tab} onUpdate={()=>load(tab)} onNavigate={navigate}/>)}
      {loadingMore&&<div className="py-8 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-primary"/></div>}
      {!loadingMore&&!hasMore&&<div className="py-10 text-center text-xs text-muted-foreground">You’re all caught up.</div>}</div>}
  </div>;
}

function CommunityCard({community,onOpen}:{community:any;onOpen:()=>void}){return <button onClick={onOpen} className="w-full text-left p-4 border-b border-border hover:bg-muted/30"><div className="flex items-center gap-3"><div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center"><Users className="w-5 h-5 text-primary"/></div><div className="min-w-0"><p className="font-bold truncate">{community.display_name??community.name}</p><p className="text-xs text-muted-foreground">{Number(community.member_count??0).toLocaleString()} members</p></div><ArrowRight className="ml-auto w-4 h-4 text-muted-foreground"/></div>{community.description&&<p className="text-sm text-muted-foreground mt-3 line-clamp-2">{community.description}</p>}</button>;}

function ProductCard({product,onOpen}:{product:any;onOpen:()=>void}){return <button onClick={onOpen} className="w-full text-left p-4 border-b border-border hover:bg-muted/30"><div className="flex gap-3"><div className="w-20 h-20 rounded-xl overflow-hidden bg-muted shrink-0">{product.image_url?<img src={product.image_url} alt="" className="w-full h-full object-cover" loading="lazy"/>:<ShoppingBag className="w-7 h-7 m-6 text-muted-foreground"/>}</div><div className="min-w-0"><p className="font-bold line-clamp-1">{product.name??'Product'}</p><p className="text-primary font-black mt-1">{'$'+Number(product.price??0).toFixed(2)}</p>{product.description&&<p className="text-xs text-muted-foreground line-clamp-2 mt-1">{product.description}</p>}<span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground mt-2"><ShoppingBag className="w-3 h-3"/>View in Shopping Mall</span></div></div></button>;}
