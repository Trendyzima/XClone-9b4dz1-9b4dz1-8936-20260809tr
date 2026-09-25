import { useEffect, useMemo, useRef, useState } from 'react';

import { VerifiedTick } from '@/components/ui/VerifiedTick';
import { Search, X, Clock3, Hash, AtSign, Sparkles, Users, Image as ImageIcon, ListFilter, Loader2, TrendingUp, Globe2, ChevronDown, Lock } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { TopBar } from '@/components/layout/TopBar';
import { Input } from '@/components/ui/input';
import { PostCard } from '@/components/features/PostCard';
import { formatNumber } from '@/lib/utils';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { TestagramCapabilityClient, CapabilityClientError, type SearchDiscoveryPage } from '@/services/testagramCapabilityClient';
import * as federation from '@/api/federation';
import { FederatedHashtagDiscovery } from '@/components/features/FederatedOrganicDiscovery';
import { megalodonGatewayService } from '@/services/megalodonGateway';

const TABS=['Top','Latest','People','Media','Hashtags','Replies','Threads','Communities','Fediverse','Instances'];
const KEYWORDS=['technology','artificial intelligence','football','music','Kenya','Nairobi','business','gaming','science','creator economy','travel','news'];
const endpoint=(name:string)=>`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${name}`;

function client(){return new TestagramCapabilityClient({endpoint:endpoint('capability-gateway'),getAccessToken:async()=>{const {data}=await supabase.auth.getSession();return data.session?.access_token??null},clientName:'testagram-search',clientVersion:'3',timeoutMs:12000});}

export default function SearchPageV3(){
 const {user}=useAuth(); const navigate=useNavigate(); const [params,setParams]=useSearchParams();
 const initial=params.get('q')??''; const [query,setQuery]=useState(initial); const [tab,setTab]=useState(params.get('tab')??'Top');
 const [data,setData]=useState<SearchDiscoveryPage & {replies?:any[]}>({users:[],hashtags:[],posts:[],communities:[],next_cursor:null,replies:[]});
 const [fediverse,setFediverse]=useState<any[]>([]); const [fediversePosts,setFediversePosts]=useState<any[]>([]); const [threadResults,setThreadResults]=useState<any[]>([]); const [replyResults,setReplyResults]=useState<any[]>([]); const [loading,setLoading]=useState(false); const [suggestLoading,setSuggestLoading]=useState(false); const [suggest,setSuggest]=useState<SearchDiscoveryPage & {replies?:any[]}>({users:[],hashtags:[],posts:[],communities:[],next_cursor:null,replies:[]});
 const [showSuggest,setShowSuggest]=useState(false); const [recent,setRecent]=useState<string[]>([]); const [mediaOnly,setMediaOnly]=useState(false); const [verifiedOnly,setVerifiedOnly]=useState(false); const [sort,setSort]=useState('Relevance'); const [showFilters,setShowFilters]=useState(false);
 const [loadingMore,setLoadingMore]=useState(false); const [hasMore,setHasMore]=useState(true); const inputTimer=useRef<ReturnType<typeof setTimeout>|null>(null); const sentinel=useRef<HTMLDivElement|null>(null); const box=useRef<HTMLDivElement|null>(null);
 const api=useMemo(()=>client(),[]);
 useEffect(()=>{try{setRecent(JSON.parse(localStorage.getItem('tsocial_recent_searches')||'[]').slice(0,8))}catch{}},[]);
 useEffect(()=>{const close=(e:MouseEvent)=>{if(box.current&&!box.current.contains(e.target as Node))setShowSuggest(false)};document.addEventListener('mousedown',close);return()=>document.removeEventListener('mousedown',close)},[]);
 const saveRecent=(q:string)=>{const next=[q,...recent.filter(x=>x!==q)].slice(0,8);setRecent(next);try{localStorage.setItem('tsocial_recent_searches',JSON.stringify(next))}catch{}};
 const suggestFor=async(q:string)=>{if(!q.trim()){setSuggest({users:[],hashtags:[],posts:[],communities:[],next_cursor:null,replies:[]});return}setSuggestLoading(true);try{const raw=q.trim();const token=raw.replace(/^[@#]/,'');const r:any=await api.searchUnified(token,'all',8);let next:any={...r,users:(r.users??[]).slice(0,8),hashtags:(r.hashtags??[]).slice(0,8),posts:[],communities:(r.communities??[]).slice(0,4),replies:[]};if(raw.startsWith('#')||raw.startsWith('@')){
 try{
  const kind=raw.startsWith('#')?'hashtags':'people';
  const remote=await federation.searchFederatedDiscovery(raw,12,undefined,'suggest',kind as any);
  const remoteRows=raw.startsWith('#')?(remote.hashtags??[]):(remote.users??[]);
  if(raw.startsWith('#')){
   const seen=new Set((next.hashtags??[]).map((h:any)=>String(h.tag??h.name).replace(/^#/,'').toLowerCase()));
   next.hashtags=[...(next.hashtags??[]),...remoteRows.filter((h:any)=>{const name=String(h.tag??h.name??'').replace(/^#/,'').toLowerCase();return name&&!seen.has(name)}).map((h:any)=>({...h,tag:String(h.tag??h.name).replace(/^#/,'').toLowerCase(),is_federated:true}))];
  }else{
   const seen=new Set((next.users??[]).map((p:any)=>String(p.username??'').toLowerCase()));
   next.users=[...(next.users??[]),...remoteRows.filter((a:any)=>{const name=String(a.username??a.preferredUsername??'').toLowerCase();return name&&!seen.has(name)}).map((a:any)=>({...a,origin:'fediverse'}))].slice(0,8);
  }
 }catch(e){console.debug('[fediverse-suggest]',e)}
}}setSuggest(next)}catch(e){console.debug('[search-suggest]',e)}finally{setSuggestLoading(false)}};
const run=async(q=query,nextTab=tab,append=false)=>{if(!q.trim())return;const clean=q.trim();if(!append){saveRecent(clean);setLoading(true);setHasMore(true);setData({users:[],hashtags:[],posts:[],communities:[],next_cursor:null});setFediverse([]);setFediversePosts([]);setThreadResults([]);setReplyResults([]);setParams({q:clean,tab:nextTab})}else setLoadingMore(true);
  try{
   const kindMap:any={Top:'all',Latest:'latest',People:'people',Media:'media',Hashtags:'hashtags',Replies:'replies',Threads:'threads',Communities:'communities',Fediverse:'fediverse',Instances:'people'};
   const unified:any=await api.searchUnified(clean,kindMap[nextTab]??'all',50);
   const r={users:unified.users??[],hashtags:unified.hashtags??[],posts:unified.posts??[],communities:unified.communities??[],next_cursor:unified.next_cursor??null};
   setThreadResults(unified.threads??[]); setReplyResults(unified.replies??[]);
   const remoteRows=unified.fediverse??[];
   const cachedFedPosts=remoteRows.map((p:any)=>({...p,id:p.id??p.uri,uri:p.uri,user_id:p.actor_uri,author_id:p.actor_uri,created_at:p.published_at??p.updated_at,content:p.content??p.summary??'',remote_status_uri:p.uri,user_profiles:p.remote_account??{actor_uri:p.actor_uri,username:'unknown',display_name:p.remote_account?.display_name??p.remote_account?.name??p.remote_account?.preferredUsername??p.remote_account?.username??p.actor_uri,avatar_url:null},is_federated:true}));
   setData(r);
   setFediversePosts(cachedFedPosts);
   setHasMore(false);
   {
    try{
     const discoveryKind=clean.startsWith('#')?'hashtags':clean.startsWith('@')||nextTab==='People'?'people':nextTab==='Fediverse'?'posts':'all';
     const live=await federation.searchFederatedDiscovery(clean,50,undefined,'search',discoveryKind as any);
     const liveHashtags=Array.isArray(live?.hashtags)?live.hashtags:[];
     const liveUsers=Array.isArray(live?.users)?live.users:[];
     const livePosts=Array.isArray(live?.posts)?live.posts:[];
     if(liveHashtags.length) setData(prev=>{
       const seen=new Set((prev.hashtags??[]).map((h:any)=>String(h.tag??h.name??'').replace(/^#/,'').toLowerCase()));
       return {...prev,hashtags:[...(prev.hashtags??[]),...liveHashtags.filter((h:any)=>{const k=String(h.tag??h.name??'').replace(/^#/,'').toLowerCase();return k&&!seen.has(k)&&seen.add(k);})]};
     });
     if(liveUsers.length) setFediverse(prev=>{
       const seen=new Set(prev.map((a:any)=>String(a.actor_url??a.id??a.username??'').toLowerCase()));
       const rows=liveUsers.map((a:any)=>({actor_url:a.actor_url??a.url??a.id,username:a.username??a.preferredUsername??a.name,domain:a.domain??a.acct?.split('@')[1],display_name:a.display_name??a.name,bio:a.bio??a.note??a.summary,avatar_url:a.avatar_url??a.avatar,origin:'fediverse'})).filter((a:any)=>a.username);
       return [...prev,...rows.filter((a:any)=>{const k=String(a.actor_url??a.username).toLowerCase();return !seen.has(k)&&seen.add(k);})];
     });
     if(livePosts.length) setFediversePosts(prev=>{
       const seen=new Set(prev.map((p:any)=>String(p.uri??p.remote_status_uri??p.id)));
       const rows=livePosts.map((p:any)=>({
        ...p,
        id:p.id??p.uri??p.url,
        uri:p.uri??p.url,
        user_id:p.account?.id??p.actor_uri,
        author_id:p.account?.id??p.actor_uri,
        created_at:p.created_at??p.published_at,
        content:p.content??p.spoiler_text??'',
        remote_status_uri:p.uri??p.url,
        user_profiles:p.user_profiles??{
         username:p.account?.username??p.username,
         display_name:p.account?.display_name??p.account?.username,
         avatar_url:p.account?.avatar??p.account?.avatar_url,
         verified:false
        },
        is_federated:true,
        origin:'fediverse'
       }));
       return [...prev,...rows.filter((p:any)=>{const k=String(p.uri??p.id);return !seen.has(k)&&seen.add(k);})];
     });
    }catch(e){
     console.debug('[fediverse-live-search]',e);
    }
   }
  }catch(e){toast.error(e instanceof CapabilityClientError&&e.code==='RATE_LIMITED'?'Search is rate limited briefly. Try again in a moment.':'Search could not be completed')}finally{setLoading(false);setLoadingMore(false)}};
 useEffect(()=>{if(initial)run(initial,tab)},[initial]);
 useEffect(()=>{const node=sentinel.current;if(!node||!hasMore)return;const io=new IntersectionObserver(es=>{if(es[0]?.isIntersecting&&!loading&&!loadingMore&&data.next_cursor)run(query,tab,true)},{rootMargin:'700px'});io.observe(node);return()=>io.disconnect()},[data.next_cursor,loading,loadingMore,query,tab]);
 const choose=(value:string,nextTab='Top')=>{setQuery(value);setShowSuggest(false);setTab(nextTab);run(value,nextTab)};
 const posts=useMemo(()=>{const seen=new Set<string>();let rows=[...data.posts,...fediversePosts].filter((p:any)=>{const key=String(p.uri??p.remote_status_uri??p.id);if(seen.has(key))return false;seen.add(key);return true});if(mediaOnly)rows=rows.filter((p:any)=>p.media_url||p.media_type||p.is_video||p.image_url||p.video_url||(Array.isArray(p.media_urls)&&p.media_urls.length)||(Array.isArray(p.attachments)&&p.attachments.length));if(verifiedOnly)rows=rows.filter((p:any)=>p.verified||p.verified_tier||p.user_profiles?.verified||p.user_profiles?.verified_tier);if(tab==='Latest'||sort==='Latest')rows.sort((a:any,b:any)=>new Date(b.created_at).getTime()-new Date(a.created_at).getTime());if(sort==='Most liked')rows.sort((a:any,b:any)=>(b.likes_count??0)-(a.likes_count??0));if(sort==='Most viewed')rows.sort((a:any,b:any)=>(b.views_count??0)-(a.views_count??0));return rows},[data.posts,fediversePosts,tab,sort,mediaOnly]);
 const clear=()=>{setQuery('');setShowSuggest(true);setData({users:[],hashtags:[],posts:[],communities:[],next_cursor:null,replies:[]});setFediverse([]);setFediversePosts([]);setReplyResults([])};
 return <div className="min-h-screen bg-background pb-16 md:pb-0"><TopBar title="Search" showBack/><div ref={box} className="sticky top-14 z-40 bg-background/95 backdrop-blur border-b border-border"><form onSubmit={e=>{e.preventDefault();run(query)}} className="px-3 pt-3 pb-2"><div className="relative"><Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground"/><Input value={query} onChange={e=>{const v=e.target.value;setQuery(v);setShowSuggest(true);if(inputTimer.current)clearTimeout(inputTimer.current);inputTimer.current=setTimeout(()=>suggestFor(v),160)}} onFocus={()=>{setShowSuggest(true);if(query)suggestFor(query)}} placeholder="Search Testagram" className="h-12 pl-12 pr-20 rounded-full bg-muted/80 border-transparent focus-visible:ring-1 focus-visible:ring-primary"/>{query&&<button type="button" onClick={clear} className="absolute right-3 top-1/2 -translate-y-1/2 p-2 rounded-full hover:bg-background"><X className="w-4 h-4"/></button>}</div></form>
 {showSuggest&&<div className="absolute left-3 right-3 top-[68px] bg-background border border-border rounded-2xl shadow-2xl overflow-hidden max-h-[70vh] overflow-y-auto">{suggestLoading&&<div className="px-4 py-3 flex gap-2 text-xs text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin"/>Finding suggestions…</div>}{!query&&recent.length>0&&<section className="py-2"><div className="px-4 py-2 flex justify-between text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Recent searches<button className="text-primary normal-case tracking-normal" onClick={()=>{setRecent([]);localStorage.removeItem('tsocial_recent_searches')}}>Clear</button></div>{recent.map(r=><button key={r} onClick={()=>choose(r)} className="w-full px-4 py-2.5 flex items-center gap-3 hover:bg-muted text-left"><Clock3 className="w-4 h-4 text-muted-foreground"/><span className="truncate">{r}</span></button>)}</section>}
 {suggest.users.length>0&&<section className="py-2 border-t border-border"><div className="px-4 py-2 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">People</div>{suggest.users.slice(0,5).map((p:any)=><button key={p.id} onClick={()=>choose(`@${p.username}`,'People')} className="w-full px-4 py-2.5 flex items-center gap-3 hover:bg-muted text-left"><div className="w-9 h-9 rounded-full bg-muted overflow-hidden">{p.avatar_url?<img src={p.avatar_url} alt="" className="w-full h-full object-cover"/>:<div className="w-full h-full grid place-items-center font-bold">{p.username?.[0]?.toUpperCase()}</div>}</div><div className="min-w-0 flex-1"><div className="font-semibold flex items-center gap-1">@{p.username}{p.verified&&<VerifiedTick className="w-3.5 h-3.5 text-primary"/>}{p.is_protected&&<Lock className="w-3 h-3 text-muted-foreground" aria-label="Protected account"/>}</div><div className="text-xs text-muted-foreground truncate">{p.display_name||p.bio}</div><div className="text-[11px] text-muted-foreground mt-0.5">{formatNumber(p.followers_count??0)} followers</div></div><AtSign className="w-4 h-4 text-muted-foreground"/></button>)}</section>}
 {suggest.hashtags.length>0&&<section className="py-2 border-t border-border"><div className="px-4 py-2 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Topics</div>{suggest.hashtags.slice(0,6).map((h:any)=><button key={h.id} onClick={()=>choose(`#${h.tag}`,'Hashtags')} className="w-full px-4 py-2.5 flex items-center gap-3 hover:bg-muted text-left"><span className="w-8 h-8 rounded-full bg-primary/10 grid place-items-center"><Hash className="w-4 h-4 text-primary"/></span><span className="flex-1"><b>#{h.tag}</b><span className="block text-xs text-muted-foreground">{formatNumber(h.usage_count??0)} posts</span></span><TrendingUp className="w-4 h-4 text-muted-foreground"/></button>)}</section>}
 {KEYWORDS.filter(k=>k.toLowerCase().includes(query.toLowerCase())).slice(0,5).map(k=><button key={k} onClick={()=>choose(k)} className="w-full px-4 py-3 flex items-center gap-3 border-t border-border hover:bg-muted text-left"><Sparkles className="w-4 h-4 text-primary"/><span>{k}</span></button>)}
 </div>}
 <div className="flex overflow-x-auto scrollbar-hide border-t border-border">{TABS.map(t=><button key={t} onClick={()=>{setTab(t);if(query)run(query,t)}} className={`shrink-0 px-4 py-3 text-sm font-semibold border-b-2 ${tab===t?'border-primary text-foreground':'border-transparent text-muted-foreground hover:text-foreground'}`}>{t}</button>)}</div>
 </div>
 <FederatedHashtagDiscovery surface="search" />
 <div className="px-3 py-2 border-b border-border flex items-center gap-2"><button onClick={()=>setShowFilters(v=>!v)} className="px-3 py-1.5 rounded-full border border-border text-xs font-semibold flex items-center gap-1.5"><ListFilter className="w-3.5 h-3.5"/>Filters<ChevronDown className={`w-3 h-3 transition-transform ${showFilters?'rotate-180':''}`}/></button>{sort!=='Relevance'&&<span className="text-xs text-muted-foreground">{sort}</span>}{mediaOnly&&<span className="text-xs text-muted-foreground">Media</span>}{verifiedOnly&&<span className="text-xs text-muted-foreground">Verified</span>}</div>
 {showFilters&&<div className="px-3 py-3 border-b border-border bg-muted/20 grid grid-cols-2 gap-2 text-sm"><button onClick={()=>setSort('Relevance')} className={`p-2 rounded-lg border ${sort==='Relevance'?'border-primary bg-primary/10':'border-border'}`}>Relevance</button><button onClick={()=>setSort('Latest')} className={`p-2 rounded-lg border ${sort==='Latest'?'border-primary bg-primary/10':'border-border'}`}>Latest</button><button onClick={()=>setSort('Most liked')} className={`p-2 rounded-lg border ${sort==='Most liked'?'border-primary bg-primary/10':'border-border'}`}>Most liked</button><button onClick={()=>setSort('Most viewed')} className={`p-2 rounded-lg border ${sort==='Most viewed'?'border-primary bg-primary/10':'border-border'}`}>Most viewed</button><button onClick={()=>setMediaOnly(v=>!v)} className={`p-2 rounded-lg border ${mediaOnly?'border-primary bg-primary/10':'border-border'}`}>Media only</button><button onClick={()=>setVerifiedOnly(v=>!v)} className={`p-2 rounded-lg border ${verifiedOnly?'border-primary bg-primary/10':'border-border'}`}>Verified</button></div>}
 {loading&&!data.posts.length?<div className="py-16 grid place-items-center text-muted-foreground"><Loader2 className="w-7 h-7 animate-spin"/></div>:!query?<div className="py-16 text-center px-8"><Search className="w-10 h-10 mx-auto mb-3 text-muted-foreground/50"/><h2 className="font-bold text-lg">Search Testagram</h2><p className="text-sm text-muted-foreground mt-1">Find people, posts, topics, communities and the Fediverse.</p></div>:tab==='People'?<ResultPeople items={data.users} navigate={navigate}/>:tab==='Hashtags'?<ResultHashtags items={data.hashtags} navigate={navigate}/>:tab==='Replies'?<ResultReplies items={replyResults}/>:tab==='Threads'?<ResultThreads items={threadResults} navigate={navigate}/>:tab==='Communities'?<ResultCommunities items={data.communities} navigate={navigate}/>:tab==='Instances'?<ResultInstances items={data.users.filter((u:any)=>u.origin==='fediverse'&&u.domain)}/>:tab==='Fediverse'?<><ResultFediverse items={fediverse}/><div>{fediversePosts.map((post:any)=><div key={post.id??post.uri} className="relative"><SourceLabel source="Fediverse"/><PostCard post={post}/></div>)}</div></>:<><GlobalSearchResults data={{...data,posts:posts,threads:threadResults,replies:replyResults}} navigate={navigate}/><div>{posts.length?posts.map((p:any)=><div key={p.id??p.uri} className="relative"><SourceLabel source={p.is_federated?'Fediverse':'Testagram'} /><PostCard post={p}/></div>):<div className="py-16 text-center text-sm text-muted-foreground">No matching posts yet.</div>}</div></>}
 <div ref={sentinel} className="py-8 flex justify-center">{loadingMore?<Loader2 className="w-5 h-5 animate-spin text-muted-foreground"/>:hasMore&&query&&tab!=='People'&&tab!=='Hashtags'&&tab!=='Replies'&&tab!=='Threads'&&tab!=='Communities'&&tab!=='Fediverse'&&tab!=='Instances'?<span className="text-xs text-muted-foreground">Loading more as you scroll…</span>:query&&<span className="text-xs text-muted-foreground">End of results</span>}</div>
 </div>
}
function SourceLabel({source}:{source:'Testagram'|'Fediverse'}){return <div className="px-4 pt-2"><span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold ${source==='Fediverse'?'border-sky-500/20 bg-sky-500/5 text-sky-600 dark:text-sky-400':'border-primary/20 bg-primary/5 text-primary'}`}>{source}</span></div>}

function GlobalSearchResults({data,navigate}:{data:any;navigate:any}) {
 const groups=[
  ['People',data.users||[],(x:any)=>navigate('/profile/'+x.username)],
  ['Hashtags',data.hashtags||[],(x:any)=>navigate('/hashtag/'+x.tag)],
  ['Threads',data.threads||[],(x:any)=>navigate('/thread/'+x.id)],
  ['Communities',data.communities||[],(x:any)=>navigate('/c/'+(x.slug||x.name))],
  ['Spaces',data.spaces||[],(x:any)=>navigate('/spaces/'+x.id)],
  ['Trending',data.trending||[],(x:any)=>navigate('/trending/'+encodeURIComponent(x.topic))]
 ];
 return <div>{groups.map(([name,items,go]:any)=>items.length>0&&<section key={name} className="border-b border-border">
  <div className="px-4 py-3 text-xs font-bold uppercase tracking-widest text-muted-foreground">{name}</div>
  {items.slice(0,8).map((x:any)=><button key={x.id} onClick={()=>go(x)} className="w-full px-4 py-3 text-left hover:bg-muted flex items-center gap-3">
   <div className="min-w-0 flex-1"><div className="font-semibold truncate">{x.display_name||x.username||('#'+x.tag)||x.title||x.topic}</div>
   <div className="text-xs text-muted-foreground truncate">{x.description||x.bio||x.category||''}</div></div>
  </button>)}
 </section>)}</div>;
}

function ResultReplies({items}:{items:any[]}){return <div>{items.map((r:any)=><div key={r.id} className="w-full px-4 py-4 border-b border-border text-left"><div className="flex items-center gap-2"><div className="w-8 h-8 rounded-full bg-muted overflow-hidden">{r.user_profiles?.avatar_url&&<img src={r.user_profiles.avatar_url} alt="" className="w-full h-full object-cover"/>}</div><div className="font-semibold text-sm">{r.user_profiles?.display_name||r.user_profiles?.username||'User'}</div><div className="text-xs text-muted-foreground">@{r.user_profiles?.username||''}</div><span className="text-[10px] text-muted-foreground ml-auto">{r.origin==='fediverse'?'Fediverse':'Testagram'}</span></div><p className="mt-2 text-sm whitespace-pre-wrap line-clamp-5">{r.content}</p></div>)}</div>}
function ResultInstances({items}:{items:any[]}){const grouped=Array.from(new Map(items.map((x:any)=>[x.domain,x])).values());return <div>{grouped.map((x:any)=><div key={x.domain} className="px-4 py-4 border-b border-border"><div className="font-bold flex items-center gap-2"><Globe2 className="w-4 h-4 text-primary"/>{x.domain}</div><div className="text-xs text-muted-foreground mt-1">Fediverse instance · indexed accounts</div></div>)}</div>}
function ResultPeople({items,navigate}:{items:any[];navigate:any}){return <div>{items.map(p=><button key={p.id} onClick={()=>navigate(`/profile/${p.username}`)} className="w-full px-4 py-3 flex items-center gap-3 border-b border-border hover:bg-muted text-left"><div className="w-11 h-11 rounded-full bg-muted overflow-hidden">{p.avatar_url?<img src={p.avatar_url} alt="" className="w-full h-full object-cover"/>:<div className="w-full h-full grid place-items-center font-bold">{p.username?.[0]?.toUpperCase()}</div>}</div><div className="min-w-0"><div className="font-bold flex gap-1 items-center">{p.display_name||p.username}{p.verified&&<VerifiedTick className="w-4 h-4 text-primary"/>}</div><div className="text-sm text-muted-foreground">@{p.username}{p.is_protected&&" · Protected"}</div><div className="text-xs text-muted-foreground truncate">{p.bio}</div><div className="text-[11px] text-muted-foreground mt-0.5">{formatNumber(p.followers_count??0)} followers</div></div></button>)}</div>}
function ResultThreads({items,navigate}:{items:any[];navigate:any}){return <div>{items.map((t:any)=><button key={t.id} onClick={()=>navigate(`/thread/${t.id}`)} className="w-full px-4 py-4 border-b border-border text-left hover:bg-muted"><div className="flex items-center gap-2"><div className="w-8 h-8 rounded-full bg-muted overflow-hidden shrink-0">{t.profiles?.avatar_url?<img src={t.profiles.avatar_url} alt="" className="w-full h-full object-cover"/>:<span className="w-full h-full grid place-items-center text-xs font-bold">{t.profiles?.username?.[0]?.toUpperCase()}</span>}</div><div className="font-semibold text-sm">{t.profiles?.display_name||t.profiles?.username||'Profile'}</div><div className="text-xs text-muted-foreground">@{t.profiles?.username||''}</div><span className="text-[10px] text-muted-foreground ml-auto">{formatNumber(t.views_count??0)} views</span></div><p className="mt-2 text-sm line-clamp-3">{t.body}</p>{Array.isArray(t.media_urls)&&t.media_urls.length>0&&<div className="mt-2 text-xs text-primary flex items-center gap-1"><ImageIcon className="w-3.5 h-3.5"/>{t.media_urls.length} media attachment{t.media_urls.length===1?'':'s'}</div>}</button>)}</div>}
function ResultHashtags({items,navigate}:{items:any[];navigate:any}){return <div>{items.map(h=><button key={h.id} onClick={()=>navigate(`/hashtag/${h.tag}`)} className="w-full px-4 py-4 border-b border-border text-left hover:bg-muted"><div className="font-bold text-lg">#{h.tag}</div><div className="text-xs text-muted-foreground">{formatNumber(Number(h.usage_count??0)+Number(h.federated_post_count??0))} posts · {formatNumber(h.follower_count??0)} followers</div></button>)}</div>}
function ResultCommunities({items,navigate}:{items:any[];navigate:any}){return <div>{items.map(c=><button key={c.id} onClick={()=>navigate(`/c/${c.slug||c.name}`)} className="w-full px-4 py-4 border-b border-border text-left hover:bg-muted"><div className="font-bold">{c.display_name||c.name}</div><div className="text-xs text-muted-foreground">{formatNumber(c.member_count??0)} members · {formatNumber(c.post_count??0)} posts</div><p className="text-sm text-muted-foreground mt-1 line-clamp-2">{c.description}</p></button>)}</div>}
function ResultFediverse({items}:{items:any[]}){return <div>{items.map((a:any,i)=><div key={a.actor_url||i} className="px-4 py-3 border-b border-border flex items-center gap-3"><div className="w-10 h-10 rounded-full bg-muted overflow-hidden">{a.avatar_url&&<img src={a.avatar_url} alt="" className="w-full h-full object-cover"/>}</div><div className="min-w-0"><div className="font-semibold">{a.display_name||a.username}</div><div className="text-sm text-muted-foreground">@{a.username}{a.domain?`@${a.domain}`:''}</div><div className="text-xs text-muted-foreground line-clamp-2">{a.bio}</div></div><Globe2 className="w-4 h-4 ml-auto text-muted-foreground"/></div>)}</div>}
