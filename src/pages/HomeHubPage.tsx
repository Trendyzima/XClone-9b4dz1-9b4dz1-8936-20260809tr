import { lazy, Suspense, useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ComposePost } from '@/components/features/ComposePost';
import { PostCard } from '@/components/features/PostCard';
import { PollCard as FeedPollCard } from '@/components/features/PollCard';
import { ThreadCard } from '@/components/features/ThreadCard';

import { TopBar } from '@/components/layout/TopBar';
import { socialApi } from '@/services/socialApiClient';
import { useAuth } from '@/hooks/useAuth';
import { useSEO } from '@/hooks/useSEO';
import { useInfiniteScroll } from '@/hooks/useInfiniteScroll';
import { Loader2, Sparkles, Users, ShoppingBag, BarChart3, RefreshCw, ArrowRight } from 'lucide-react';
import { readHomeFeedCache, writeHomeFeedCache, saveHomeScroll, mergeHomeFeedItems, isHomeFeedCacheUsable, homeFeedItemIdentity, HOME_FEED_CACHE_LIMIT } from '@/lib/homeFeedCache';
import { FederatedHashtagDiscovery } from '@/components/features/FederatedOrganicDiscovery';
import { TvPostStream } from '@/components/features/TvPostStream';
import { NewsifyTrendingRail } from '@/components/features/NewsifyTrendingRail';
import { OrganicSportsStories } from '@/components/features/OrganicSportsStories';
import { FeedAdCard } from '@/components/features/FeedAdCard';

const LiveSpacesDiscoveryStrip = lazy(() => import('@/components/features/LiveSpacesDiscoveryStrip').then(m => ({ default: m.LiveSpacesDiscoveryStrip })));
const SyndicatedNewsRail = lazy(() => import('@/components/features/SyndicatedNewsRail').then(m => ({ default: m.SyndicatedNewsRail })));
const TrendingVideosSection = lazy(() => import('@/components/features/TrendingVideosSection').then(m => ({ default: m.TrendingVideosSection })));
const CommunitySpotlightStrip = lazy(() => import('@/components/features/CommunitySpotlightStrip').then(m => ({ default: m.CommunitySpotlightStrip })));
const ContentSuggestionsWidget = lazy(() => import('@/components/features/ContentSuggestionsWidget').then(m => ({ default: m.ContentSuggestionsWidget })));
const UserSuggestionsWidget = lazy(() => import('@/components/features/UserSuggestionsWidget').then(m => ({ default: m.UserSuggestionsWidget })));

type Tab = 'all'|'following'|'explore'|'media'|'communities'|'polls'|'shopping'|'federated';
type Item = { type:'post'|'thread'|'community'|'poll'|'product'|'fedpost'; data:any };

function appendUniqueFeedItems(existing: Item[], incoming: Item[], max = Number.MAX_SAFE_INTEGER): Item[] {
  const seen = new Set(existing.map(homeFeedItemIdentity).filter(Boolean));
  const out = [...existing];
  for (const item of incoming) {
    const key = homeFeedItemIdentity(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
    if (out.length >= max) break;
  }
  return out;
}

function composeForYouContent(items: Item[]): Item[] {
  if (items.length < 3) return items;

  const affinitySources = new Set([
    'following-local',
    'following-thread',
    'following-federated',
    'following-community',
    'following-hashtag-local',
  ]);
  const affinity = items.filter((item) => affinitySources.has(String(item.data?.feed_source ?? '')));
  const discovery = items.filter((item) => !affinitySources.has(String(item.data?.feed_source ?? '')));

  // X-style For You composition: keep the followed graph prominent, but
  // continuously interleave discovery so the feed does not become a wall of
  // followed posts. This is content ordering only; the existing UI is untouched.
  if (!affinity.length || !discovery.length) return items;

  const result: Item[] = [];
  const used = new Set<string>();
  let a = 0;
  let d = 0;

  const keyOf = (item: Item) => String(item.data?.id ?? item.data?.uri ?? '');
  const authorOf = (item: Item) => String(
    item.data?.author_id ??
    item.data?.user_id ??
    item.data?.owner_id ??
    item.data?.actor_uri ??
    item.data?.user_profiles?.id ??
    ''
  );

  while (result.length < items.length && (a < affinity.length || d < discovery.length)) {
    const takeAffinity = a < affinity.length && (result.length % 3 !== 2 || d >= discovery.length);
    const pool = takeAffinity ? affinity : discovery;
    const start = takeAffinity ? a : d;
    let chosenIndex = start;
    let chosen: Item | undefined;

    for (let i = start; i < pool.length; i += 1) {
      const candidate = pool[i];
      if (used.has(keyOf(candidate))) continue;
      const recent = result.slice(-2);
      const author = authorOf(candidate);
      const sameAuthor = author && recent.filter((x) => authorOf(x) === author).length >= 2;
      const source = String(candidate.data?.feed_source ?? candidate.type);
      const sameSource = recent.filter((x) => String(x.data?.feed_source ?? x.type) === source).length >= 2;
      if (!sameAuthor && !sameSource) {
        chosenIndex = i;
        chosen = candidate;
        break;
      }
    }

    if (!chosen) {
      chosen = pool[start];
      chosenIndex = start;
    }
    if (!chosen) break;

    if (takeAffinity) a = chosenIndex + 1;
    else d = chosenIndex + 1;

    const key = keyOf(chosen);
    if (used.has(key)) continue;
    used.add(key);
    result.push(chosen);
  }

  return result;
}

const TABS: {id:Tab;label:string}[] = [
  {id:'all',label:'For you'},{id:'following',label:'Following'},{id:'explore',label:'Explore'},
  {id:'media',label:'Media'},{id:'communities',label:'Communities'},{id:'polls',label:'Polls'},
  {id:'shopping',label:'Shopping'},{id:'federated',label:'Federated'},
];
const StoriesStrip = lazy(() => import('@/components/features/StoriesStrip').then(m => ({ default: m.StoriesStrip })));

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
    {item.type==='fedpost'&&<PostCard post={item.data} onUpdate={onUpdate}/>} 
    {item.type==='community'&&<CommunityCard community={item.data} onOpen={()=>onNavigate('/c/'+item.data.name)}/>}
    {item.type==='poll'&&<FeedPollCard poll={item.data} postId={item.data?.post_id} repliesCount={item.data?.replies_count ?? 0} />}
    {item.type==='product'&&<ProductCard product={item.data} onOpen={()=>onNavigate('/p/'+item.data.id)}/>}
    
  </div>;
}

export default function HomeHubPage(){
  const {user}=useAuth(); const navigate=useNavigate();
  const [tab,setTab]=useState<Tab>('all'); const [items,setItems]=useState<Item[]>([]);
  const [loading,setLoading]=useState(true); const [loadingMore,setLoadingMore]=useState(false);
  const [refreshing,setRefreshing]=useState(false); const [hasMore,setHasMore]=useState(true); const [nextCursor,setNextCursor]=useState<string|null>(null);
  const [cacheHydrated,setCacheHydrated]=useState(false); const [newCount,setNewCount]=useState(0); const [loadMoreError,setLoadMoreError]=useState<string|null>(null); const [feedLoadError,setFeedLoadError]=useState<string|null>(null); const nextCursorRef=useRef<string|null>(null); const scrollTimer=useRef<number|undefined>(undefined); const feedBufferRef=useRef<Item[]>([]); const feedBufferOffsetRef=useRef(0); const cacheCursorRef=useRef<string|null>(null); const tabPageRef=useRef(0); const refreshTimerRef=useRef<number|undefined>(undefined); 

  useSEO({title:'Home — Testagram',description:'One home feed for posts, videos, communities, polls, shopping and the Fediverse on Testagram.',url:'/',type:'website'});

  const cacheKey = `home:${user?.id ?? 'signed-out'}`;

  // The home timeline is sourced exclusively from the authenticated Testagram
  // Backend. The retired aggregator and direct-table fallback are
  // intentionally not reachable from this component.
  const fetchTab=useCallback(async(target:Tab,_pageNum=0,cursorOverride: string|null = null,_includeFederated=true):Promise<Item[]>=>{
    if (target !== 'all') {
      // These secondary discovery tabs are being moved to Backend endpoints.
      // Returning no legacy rows is safer than silently restoring direct data access.
      return [];
    }
    const page = user?.id
      ? await socialApi.getHomeFeed(24, cursorOverride ?? undefined)
      : await socialApi.getPublicHomeFeed(24, cursorOverride ?? undefined);
    const posts = Array.isArray(page?.posts) ? page.posts : [];
    const cursor = page?.next_cursor || null;
    setNextCursor(cursor);
    nextCursorRef.current = cursor;
    setHasMore(Boolean(page?.has_more && cursor));
    return posts.map((post:any)=>({
      type: 'post' as const,
      data: {
        ...post,
        author: post.author ?? post.user_profiles ?? {},
        user_profiles: post.user_profiles ?? post.author ?? {},
        profile: post.profile ?? post.author ?? post.user_profiles ?? {},
        origin: post.origin ?? 'local',
      },
    }));
  },[user?.id]);

  const persistBuffer=useCallback(async()=>{
    try{
      await writeHomeFeedCache({key:cacheKey,items:feedBufferRef.current,cursor:cacheCursorRef.current,updatedAt:Date.now(),scrollY:window.scrollY,anchorId:feedBufferRef.current[0]?.data?.id??null},cacheKey);
    }catch(error){
      // Storage quota/private browsing must not break scrolling or pagination.
      console.warn('[home-hub] feed cache write skipped',error);
    }
  },[cacheKey]);

  const load=useCallback(async(target:Tab,background=false)=>{
    if(target!=='all'){
      if(!background){setLoading(true);tabPageRef.current=0;setLoadMoreError(null);}
      try{
        const next=await fetchTab(target,0);
        setItems(next);
        if(target!=='federated')setHasMore(next.length >= (target==='communities'||target==='polls'||target==='shopping'?12:10));
      }catch(e){console.error('[home-hub]',e);if(!background){setItems([]);setHasMore(false);}}
      finally{if(!background)setLoading(false);}
      return;
    }
    if(!background)setFeedLoadError(null);
    try{
      // Background refresh reads the newest page, but its cursor must not replace
      // the continuation cursor for the already-loaded older pages.
      const continuationCursor=nextCursorRef.current;
      const next=await fetchTab('all',0,null,true);
      setFeedLoadError(null);
      if(background){
        nextCursorRef.current=continuationCursor;
        setNextCursor(continuationCursor);
      }
      const previous=feedBufferRef.current;
      const previousIds=new Set(previous.map(homeFeedItemIdentity).filter(Boolean));
      const fresh=next.filter(x=>!previousIds.has(homeFeedItemIdentity(x)));
      if(background){
        // Refresh the visible top without replacing the cursor for the already
        // buffered older pages. The cache contains only the ordered API feed;
        // publisher cards are layered into the visible list separately.
        setNewCount(fresh.length);
        if(fresh.length&&window.scrollY<500){
          setItems(prev=>appendUniqueFeedItems(fresh,prev));
        }
      }else{
        const composed = composeForYouContent(next);
        setItems(composed);
        feedBufferRef.current=mergeHomeFeedItems([],composed,Number.MAX_SAFE_INTEGER);
        feedBufferOffsetRef.current=composed.length;
        cacheCursorRef.current=nextCursorRef.current;
        setLoading(false);
      }
      setHasMore(Boolean(nextCursorRef.current)||feedBufferOffsetRef.current<feedBufferRef.current.length);
      await persistBuffer();
    }catch(e){console.error('[home-hub]',e);if(!background){
      setFeedLoadError('The Testagram Backend feed is unavailable. Please try again shortly.');
      const cached=await readHomeFeedCache(cacheKey).catch(()=>null);
      if(cached && isHomeFeedCacheUsable(cached)){ feedBufferRef.current=cached.items; feedBufferOffsetRef.current=cached.items.length; setItems(cached.items); cacheCursorRef.current=cached.cursor; nextCursorRef.current=cached.cursor; setHasMore(Boolean(cached.cursor)); }
      else {setItems([]);setHasMore(false);}
      setLoading(false);
    }}
  },[fetchTab,persistBuffer,cacheKey]);

  useEffect(()=>{
    let active=true;
    if(tab!=='all'){void load(tab);return()=>{active=false;};}
    void readHomeFeedCache(cacheKey).then(cached=>{
      if(!active)return;
      // Never render a stale or unverified cache as if it were the live feed.
      // Cache v4 is populated only by successful canonical Backend responses;
      // old cache databases are intentionally not read after the cutover.
      if(cached?.items?.length && isHomeFeedCacheUsable(cached)){
        const freshCached=cached.items;
        feedBufferRef.current=freshCached;
        feedBufferOffsetRef.current=freshCached.length;
        setItems(freshCached);
        cacheCursorRef.current=cached.cursor;nextCursorRef.current=cached.cursor;
        setHasMore(Boolean(cached.cursor));
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
    // Backend polling is the temporary refresh transport until the dedicated
    // Testagram realtime ticket channel is wired into this page.
    const fallback=window.setInterval(()=>{
      if(document.visibilityState!=='visible')return;
      const active=document.activeElement;
      if(active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement)return;
      void load('all',true);
    },30000);
    return()=>{active=false;window.removeEventListener('scroll',onScroll);window.clearTimeout(refreshTimerRef.current);window.clearInterval(fallback);};
  },[tab,user?.id]);

  useEffect(()=>{if(tab==='all'&&cacheHydrated&&items.length===0)void load('all');},[cacheHydrated,tab,user?.id,load]);
  useEffect(()=>{if(newCount>0&&window.scrollY<500)setNewCount(0);},[newCount]);

  const loadMore=useCallback(async()=>{
    if(!hasMore||loadingMore)return false;
    setLoadingMore(true);setLoadMoreError(null);
    try{
      if(tab==='all'){
        const offset=feedBufferOffsetRef.current;
        if(offset<feedBufferRef.current.length){
          const page=feedBufferRef.current.slice(offset,offset+6);
          if(!page.length){setHasMore(Boolean(nextCursorRef.current));return Boolean(nextCursorRef.current);}
          feedBufferOffsetRef.current=offset+page.length;
          setItems(prev=>appendUniqueFeedItems(prev,page));
          setHasMore(Boolean(nextCursorRef.current)||feedBufferOffsetRef.current<feedBufferRef.current.length);
          return true;
        }
        if(nextCursorRef.current){
          const next=await fetchTab('all',0,nextCursorRef.current);
          if(next.length){
            const beforeLength=feedBufferRef.current.length;
            feedBufferRef.current=appendUniqueFeedItems(feedBufferRef.current,next);
            // The persisted cache contains only the first 288 items. Keep its
            // cursor at or before that boundary so restoring cache can never
            // skip older items; a boundary-crossing page may be fetched again
            // once and deduplicated safely.
            if(beforeLength < HOME_FEED_CACHE_LIMIT && feedBufferRef.current.length <= HOME_FEED_CACHE_LIMIT){
              cacheCursorRef.current=nextCursorRef.current;
            }
            const page=feedBufferRef.current.slice(beforeLength,beforeLength+6);
            if(!page.length){setHasMore(Boolean(nextCursorRef.current));return Boolean(nextCursorRef.current);}
            feedBufferOffsetRef.current=beforeLength+page.length;
            setItems(prev=>appendUniqueFeedItems(prev,page));
            setHasMore(Boolean(nextCursorRef.current)||feedBufferOffsetRef.current<feedBufferRef.current.length);
            await persistBuffer();
            return true;
          }
        }
        cacheCursorRef.current=null;nextCursorRef.current=null;setHasMore(false);return false;
      }
      if(tab==='federated'){
        const next=await fetchTab('federated',0,nextCursor);
        if(next.length)setItems(prev=>appendUniqueFeedItems(prev,next));
        return next.length>0;
      }
      const nextPage=tabPageRef.current+1;
      const next=await fetchTab(tab,nextPage);
      if(next.length){
        tabPageRef.current=nextPage;
        setItems(prev=>appendUniqueFeedItems(prev,next));
      }
      const pageSize=tab==='communities'||tab==='polls'||tab==='shopping'?12:10;
      setHasMore(next.length>=pageSize);
      return next.length>0;
    }catch(error){
      console.error('[home-hub] load more failed',error);
      setLoadMoreError('Could not load more posts. Check your connection and retry.');
      return false;
    }finally{setLoadingMore(false);}
  },[fetchTab,hasMore,loadingMore,tab,nextCursor,persistBuffer]);

  const {lastElementRef}=useInfiniteScroll(loadMore,{hasMore});
  const refresh=async()=>{setRefreshing(true);try{await load(tab);}finally{setRefreshing(false);}};

  return <div className="tg-social-home-shell min-h-screen pb-16 lg:pb-0">
    <TopBar title="Home"/>
    <Suspense fallback={<div className="h-20 border-b border-border bg-background" aria-hidden="true" />}><StoriesStrip tv={<TvPostStream index={0} compact />} /></Suspense>

    {/* Testagram TV is a status-style live tile inside the Stories strip; the player opens only after the user taps it. */}
    <Suspense fallback={null}><LiveSpacesDiscoveryStrip/></Suspense>

    <div className="tg-home-tabs sticky top-14 z-30"><div className="flex overflow-x-auto scrollbar-hide">
      {TABS.map(t=><button key={t.id} onClick={()=>setTab(t.id)} className={'min-w-[96px] px-4 py-3 text-sm font-semibold border-b-2 whitespace-nowrap '+(tab===t.id?'border-primary text-foreground':'border-transparent text-muted-foreground hover:bg-muted/40')}>{t.label}</button>)}
    </div></div>
    {/* Keep the primary action and timeline above secondary discovery modules, as on X. */}
    <ComposePost onSuccess={()=>load(tab)}/>
    {!loading&&newCount>0&&<button onClick={()=>{window.scrollTo({top:0,behavior:'smooth'});setNewCount(0)}} className="w-full py-2 bg-primary/5 text-xs font-semibold text-primary">{newCount} new post{newCount===1?'':'s'} · Tap to view</button>}
    {!loading&&<button onClick={refresh} disabled={refreshing} className="w-full py-2 border-b border-border text-xs text-muted-foreground flex items-center justify-center gap-2"><RefreshCw className={'w-3 h-3 '+(refreshing?'animate-spin':'')}/>{refreshing?'Refreshing…':'Refresh feed'}</button>}
    {loading?<div className="py-20 flex justify-center"><Loader2 className="w-7 h-7 animate-spin text-primary"/></div>:
      items.length===0?<div className="py-20 text-center text-muted-foreground"><Sparkles className="w-10 h-10 mx-auto mb-3 opacity-30"/><p className="font-semibold">{feedLoadError?'Feed temporarily unavailable':'Nothing here yet'}</p><p className="text-sm mt-1">{feedLoadError??'Explore another section or be the first to add content.'}</p>{feedLoadError&&<button onClick={refresh} className="mt-4 rounded-full border border-border px-4 py-2 text-sm font-semibold">Retry</button>}</div>:
      <div className="tg-home-feed-list">{items.map((item,i)=>(
        <div className="tg-home-feed-row" key={item.type+'-'+(item.data?.id??i)}>
          <HomeFeedItem item={item} index={i} lastElementRef={i===items.length-1?lastElementRef:null} tab={tab} onUpdate={()=>load(tab)} onNavigate={navigate}/>
          {(tab==='all'||tab==='following'||tab==='explore'||tab==='media')&&(i+1)%8===0&&<FeedAdCard key={'sponsored-'+(i+1)} />}
          {i===5&&(tab==='all'||tab==='explore')&&(
            <div className="space-y-3 py-3" aria-label="More things to discover">
              <div className="flex gap-2 border-y border-border py-2">
                <button onClick={()=>navigate('/shop')} className="flex-1 rounded-xl border border-border bg-card px-3 py-2 text-xs font-bold flex items-center justify-center gap-2"><ShoppingBag className="w-4 h-4 text-primary"/>Shopping Mall</button>
                <button onClick={()=>navigate('/polls')} className="flex-1 rounded-xl border border-border bg-card px-3 py-2 text-xs font-bold flex items-center justify-center gap-2"><BarChart3 className="w-4 h-4 text-primary"/>Community Polls</button>
              </div>
              <FederatedHashtagDiscovery surface="home" />
              <NewsifyTrendingRail />
              <OrganicSportsStories surface="home" limit={4} compact />
              <Suspense fallback={null}><TrendingVideosSection variant="compact" /></Suspense>
              <Suspense fallback={null}><SyndicatedNewsRail /></Suspense>
              <Suspense fallback={null}><CommunitySpotlightStrip /></Suspense>
            </div>
          )}
          {i===5&&tab==='media'&&<div className="py-3"><OrganicSportsStories surface="home" limit={4} compact /></div>}
        </div>
      ))}
      {loadingMore&&<div className="py-8 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-primary"/></div>}
      {loadMoreError&&<div className="px-4 py-3 text-center text-xs text-muted-foreground">{loadMoreError}<button onClick={()=>void loadMore()} className="ml-2 font-semibold text-primary underline">Retry</button></div>}
      {!loadingMore&&hasMore&&<button onClick={()=>void loadMore()} className="w-full border-t border-border py-4 text-sm font-semibold text-primary hover:bg-muted/30">Load more</button>}
      {/* The homepage intentionally has no terminal 'caught up' state. New batches are loaded as the reader scrolls. */}</div>}
  </div>;
}

function CommunityCard({community,onOpen}:{community:any;onOpen:()=>void}){return <button onClick={onOpen} className="w-full text-left p-4 border-b border-border hover:bg-muted/30"><div className="flex items-center gap-3"><div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center"><Users className="w-5 h-5 text-primary"/></div><div className="min-w-0"><p className="font-bold truncate">{community.display_name??community.name}</p><p className="text-xs text-muted-foreground">{Number(community.member_count??0).toLocaleString()} members</p></div><ArrowRight className="ml-auto w-4 h-4 text-muted-foreground"/></div>{community.description&&<p className="text-sm text-muted-foreground mt-3 line-clamp-2">{community.description}</p>}</button>;}

function ProductCard({product,onOpen}:{product:any;onOpen:()=>void}){return <button onClick={onOpen} className="w-full text-left p-4 border-b border-border hover:bg-muted/30"><div className="flex gap-3"><div className="w-20 h-20 rounded-xl overflow-hidden bg-muted shrink-0">{product.image_url?<img src={product.image_url} alt="" className="w-full h-full object-cover" loading="lazy"/>:<ShoppingBag className="w-7 h-7 m-6 text-muted-foreground"/>}</div><div className="min-w-0"><p className="font-bold line-clamp-1">{product.name??'Product'}</p><p className="text-primary font-black mt-1">{'$'+Number(product.price??0).toFixed(2)}</p>{product.description&&<p className="text-xs text-muted-foreground line-clamp-2 mt-1">{product.description}</p>}<span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground mt-2"><ShoppingBag className="w-3 h-3"/>View in Shopping Mall</span></div></div></button>;}
