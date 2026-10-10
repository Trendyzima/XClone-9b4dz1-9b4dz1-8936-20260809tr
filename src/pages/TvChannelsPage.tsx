import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {useLocation,useNavigate} from 'react-router-dom';
import {AtSign,ChevronRight,Clapperboard,Globe2,Hash,Heart,MessageCircle,Play,Radio,RefreshCw,Search,Send,Sparkles,Tv,Wifi} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {TvChannelPlayer} from '@/components/features/TvChannelPlayer';
import {TestagramLiveChannelCard} from '@/components/features/TestagramLiveChannelCard';
import {TestagramAdSlot} from '@/components/features/TestagramAdSlot';
import {supabase} from '@/lib/supabase';
import {useAuth} from '@/hooks/useAuth';
import {getMyTvReaction,getTvReactionCounts,setTvReaction,TV_REACTIONS} from '@/services/tvChannelInteractionService';
import {TV_SOURCES,loadTvSource,type TvChannel,getPrioritySourceIds} from '@/services/tvChannelCatalog';
import {createTvReply,getTvReplies,type TvReply} from '@/services/tvChannelReplyService';
import {useSEO} from '@/hooks/useSEO';

const filters=[['For you',''],['Kenya','KE'],['Africa','AF'],['International','INT'],['News','news'],['Sports','sport'],['Music','music'],['Kids','kid']];
function matchesFilter(channel:TvChannel,filter:string){
 const text=(channel.name+' '+(channel.group||'')+' '+(channel.language||'')).toLowerCase();
 if(!filter)return true;
 if(filter==='AF')return ['KE','ZA','NG','GH','UG','TZ','RW','ZM','ZW','BW','MW','MZ','ET'].includes(String(channel.country||'').toUpperCase());
 if(filter==='INT')return String(channel.country||'').toUpperCase()!=='KE';
 if(filter==='news')return /news|current affairs|journal|business|politics/i.test(text);
 if(filter==='sport')return /sport|football|soccer|cricket|tennis|basketball|rugby/i.test(text);
 if(filter==='music')return /music|radio|hits|dance|jazz|pop/i.test(text);
 if(filter==='kid')return /kid|children|cartoon|animation|family/i.test(text);
 return String(channel.country||'').toUpperCase()===filter.toUpperCase();
}

function mergeTvChannelsStable(existing:TvChannel[],incoming:TvChannel[]){
 const normalize=(value:string)=>value.toLowerCase().normalize('NFKD').replace(/[\\u0300-\\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim();
 const seenUrl=new Set<string>();
 const seenIdentity=new Set<string>();
 return [...existing,...incoming].filter(channel=>{
  const url=String(channel.url||'').toLowerCase().trim();
  const tvg=normalize(String(channel.tvg_id||''));
  const name=normalize(String(channel.name||''));
  const country=normalize(String(channel.country||''));
  const identity=tvg?'id:'+tvg:(country?'name:'+name+'|country:'+country:'url:'+url);
  if(!url||seenUrl.has(url)||seenIdentity.has(identity)) return false;
  seenUrl.add(url); seenIdentity.add(identity); return true;
 });
}

function renderReplyText(content:string,onTag:(kind:'hashtag'|'mention',value:string)=>void){
 const parts=content.split(/(#[a-zA-Z0-9_]+|@[a-zA-Z0-9_]+)/g);
 return <>{parts.map((part,i)=>part.startsWith('#')?<button key={i} onClick={()=>onTag('hashtag',part.slice(1))} className='font-semibold text-primary hover:underline'>{part}</button>:part.startsWith('@')?<button key={i} onClick={()=>onTag('mention',part.slice(1))} className='font-semibold text-primary hover:underline'>{part}</button>:<span key={i}>{part}</span>)}</>;
}

function channelTags(channel:TvChannel){
 const raw=[channel.country,channel.group,channel.language,'TestagramTV','WorldTV','LiveTV'].filter(Boolean).map(String);
 return Array.from(new Set(raw.map(value=>value.replace(/[^a-zA-Z0-9]+/g,'').toLowerCase()).filter(Boolean))).slice(0,6);
}

function ChannelTile({channel,active,onSelect}:{channel:TvChannel;active:boolean;onSelect:()=>void}){
 return <button onClick={onSelect} className={'group w-full overflow-hidden rounded-2xl border bg-card text-left transition-all hover:-translate-y-0.5 hover:shadow-lg '+(active?'ring-2 ring-primary shadow-md':'')}>
  <div className='relative aspect-video overflow-hidden bg-muted'>
   {channel.logo?<img src={channel.logo} alt='' loading='lazy' decoding='async' className='absolute inset-0 m-auto max-h-16 max-w-[48%] object-contain transition-transform group-hover:scale-105'/>:<Tv className='absolute inset-0 m-auto h-10 w-10 text-muted-foreground/50'/>}
   <div className='absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/75 to-transparent'/>
   <span className='absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-black/70 px-2 py-1 text-[10px] font-bold text-white'><span className='h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse'/>{channel.live===true?'LIVE':'PUBLIC'}</span>
   <span className='absolute bottom-2 left-2 right-2 truncate text-xs font-semibold text-white'>{channel.name}</span>
  </div>
  <div className='p-3'><p className='truncate text-sm font-semibold'>{channel.name}</p><p className='mt-1 flex items-center gap-1 truncate text-[11px] text-muted-foreground'><Globe2 className='h-3 w-3 shrink-0'/>{channel.country||'International'}{channel.group&&<> · {channel.group}</>}</p></div>
 </button>;
}

export default function TvChannelsPage(){
 const nav=useNavigate(); const {pathname}=useLocation(); const reelsMode=pathname==='/tv/reels';
 const [channels,setChannels]=useState<TvChannel[]>([]); const [testagramLive,setTestagramLive]=useState<any[]>([]);
 const [active,setActive]=useState(''); const [loading,setLoading]=useState(true);
 const [filter,setFilter]=useState(''); const [query,setQuery]=useState(''); const [notice,setNotice]=useState('');
 const [dead,setDead]=useState<Set<string>>(new Set()); const sourceLoadGeneration=useRef(0); const sourceFailures=useRef(0); const sourceChannelCount=useRef(0);
 const {user}=useAuth();
 const [tvReactionCounts,setTvReactionCounts]=useState<{emoji:string;count:number}[]>([]);
 const [myTvReaction,setMyTvReaction]=useState<string|null>(null);
 const [reactionBusy,setReactionBusy]=useState(false);
 const [tvReplies,setTvReplies]=useState<TvReply[]>([]);
 const [replyText,setReplyText]=useState('');
 const [replyBusy,setReplyBusy]=useState(false);
 const [showReplies,setShowReplies]=useState(false);
 const tvSeoData=useMemo(()=>({
  '@context':'https://schema.org',
  '@type':'CollectionPage',
  name:reelsMode?'TV Reels & Live Channel Clips on Testagram':'Live TV Channels & Public Streams on Testagram',
  description:reelsMode?'Discover live channel playback and TV content on Testagram.':'Browse public live TV channels by region and category, plus community broadcasts on Testagram.',
  url:'https://testagram.site'+pathname,
  isPartOf:{'@type':'WebSite',name:'Testagram',url:'https://testagram.site/'},
  breadcrumb:{'@type':'BreadcrumbList',itemListElement:[
   {'@type':'ListItem',position:1,name:'Home',item:'https://testagram.site/'},
   {'@type':'ListItem',position:2,name:'Live TV',item:'https://testagram.site/tv'},
   ...(reelsMode?[{'@type':'ListItem',position:3,name:'TV Reels',item:'https://testagram.site/tv/reels'}]:[])
  ]}
 }),[pathname,reelsMode]);
 useSEO({
  title:reelsMode?'TV Reels & Live Channel Clips':'Live TV Channels & Public Streams',
  description:reelsMode?'Discover live channel playback and TV content on Testagram.':'Browse public live TV channels by region and category, plus community broadcasts on Testagram.',
  url:pathname,
  structuredData:tvSeoData,
 });

 const loadSources=useCallback(async(ids:string[])=>{
  const generation=++sourceLoadGeneration.current;
  sourceFailures.current=0;
  sourceChannelCount.current=0;
  setLoading(true);
  setNotice('');
  const targets=TV_SOURCES.filter(s=>s.enabled!==false&&ids.includes(s.id));
  if(!targets.length){
   setChannels([]);
   setNotice('No live channel sources are configured. Please try again later.');
   setLoading(false);
   return;
  }

  const loadBatch=async(batch:typeof targets,timeoutMs:number)=>{
   const results=await Promise.allSettled(batch.map(source=>{
    const controller=new AbortController();
    let timeout:ReturnType<typeof setTimeout>|undefined;
    const timeoutPromise=new Promise<TvChannel[]>((_,reject)=>{
     timeout=setTimeout(()=>{
      controller.abort();
      reject(new Error(source.label+' timed out'));
     },timeoutMs);
    });
    return Promise.race([loadTvSource(source,controller.signal),timeoutPromise]).finally(()=>{
     if(timeout)clearTimeout(timeout);
    });
   }));
   if(generation!==sourceLoadGeneration.current)return;
   const good=results.flatMap(result=>result.status==='fulfilled'?result.value:[]);
   sourceFailures.current+=results.filter(result=>result.status==='rejected').length;
   if(good.length){sourceChannelCount.current+=good.length;setChannels(previous=>mergeTvChannelsStable(previous,good));}
   if(sourceFailures.current>0)setNotice(sourceFailures.current+' live source(s) could not be reached. Available channels remain usable.');
   else if(good.length)setNotice('');
   return good.length;
  };

  try{
   // Keep first paint bounded: only six highest-priority sources are awaited.
   // Remaining sources load in small background batches instead of fanning out
   // dozens of database and external playlist requests during page startup.
   await loadBatch(targets.slice(0,6),7000);
   if(generation!==sourceLoadGeneration.current)return;
   setLoading(false);

   for(let offset=6;offset<targets.length;offset+=4){
    await new Promise(resolve=>setTimeout(resolve,1200));
    if(generation!==sourceLoadGeneration.current)return;
    await loadBatch(targets.slice(offset,offset+4),9000);
    if(generation!==sourceLoadGeneration.current)return;
   }

   if(sourceChannelCount.current===0&&sourceFailures.current===0){
    setNotice('No public channels were returned by the available sources. Please try refreshing later.');
   }else if(sourceFailures.current===0){
    setNotice('');
   }
  }catch(error){
   if(generation!==sourceLoadGeneration.current)return;
   console.error('[testagram-tv] channel catalogue failed',error);
   setNotice('Live channels could not be loaded. Please try refreshing.');
   setLoading(false);
  }
 },[]);
 const loadTestagramLive=useCallback(async()=>{
  try{
   const {data,error}=await supabase.from('live_streams').select('id,user_id,title,description,category,viewer_count,started_at,user:profiles(username,avatar_url)').eq('is_live',true).order('started_at',{ascending:false}).limit(16);
   if(error)throw error;
   const unique=Array.from(new Map((data||[]).map((stream:any)=>[String(stream.user_id||stream.id),stream])).values()).slice(0,8);
   setTestagramLive(unique);
  }catch(error){
   console.warn('[testagram-tv] live broadcasts are temporarily unavailable',error);
   setTestagramLive([]);
  }
 },[]);


 useEffect(()=>{
  // Load the channel catalogue once, in parallel, then publish it as one
  // immutable-looking snapshot. Playback remains independently selected.
  void loadSources(getPrioritySourceIds());
  void loadTestagramLive();
  const ch=supabase.channel('tv-live-broadcasts').on('postgres_changes',{event:'*',schema:'public',table:'live_streams'},loadTestagramLive).subscribe();
  return()=>{sourceLoadGeneration.current+=1;void supabase.removeChannel(ch);};
 },[loadSources,loadTestagramLive]);


 const filtered=useMemo(()=>{
  const q=query.trim().toLowerCase();
  const result=channels.filter(c=>!dead.has(c.id)).filter(c=>{
   const text=(c.name+' '+(c.group||'')+' '+(c.language||'')+' '+(c.country||'')).toLowerCase();
   return matchesFilter(c,filter)&&(!q||text.includes(q));
  });
  return result;
 },[channels,dead,filter,query]);
 const filteredRef=useRef(filtered); filteredRef.current=filtered;
 const deadRef=useRef(dead); deadRef.current=dead;
 const onPlayerVisible=useCallback(()=>{},[]);

 useEffect(()=>{if(!active&&filtered[0])setActive(filtered[0].id);},[active,filtered]);
 const featured=filtered.find(c=>c.id===active)||filtered[0];

 useEffect(()=>{
  let cancelled=false;
  if(!featured)return;
  setTvReplies([]);
  void getTvReplies(featured.id).then(items=>{if(!cancelled)setTvReplies(items);}).catch(error=>{if(!cancelled)console.warn('[testagram-tv] replies unavailable',error);});
  return()=>{cancelled=true;};
 },[featured?.id]);

 useEffect(()=>{
  let cancelled=false;
  if(!featured)return;
  const loadReactions=async()=>{
   const [counts,mine]=await Promise.all([getTvReactionCounts(featured.id),getMyTvReaction(featured.id,user?.id)]);
   if(!cancelled){setTvReactionCounts(counts);setMyTvReaction(mine);}
  };
  void loadReactions().catch(error=>{if(!cancelled)console.warn('[testagram-tv] reactions unavailable',error);});
  return()=>{cancelled=true;};
 },[featured?.id,user?.id]);

 const openReplyTag=(kind:'hashtag'|'mention',value:string)=>{
  nav('/search?q='+encodeURIComponent((kind==='hashtag'?'#':'@')+value)+'&tab='+(kind==='hashtag'?'Hashtags':'People'));
 };

 const submitTvReply=async()=>{
  if(!user){nav('/login');return;}
  const clean=replyText.trim();
  if(!clean||replyBusy||!featured)return;
  setReplyBusy(true);
  try{
   const created=await createTvReply(featured.id,user.id,clean);
   setTvReplies(prev=>[created,...prev]);
   setReplyText('');
   setShowReplies(true);
  }catch{setNotice('Your reply could not be posted. Please try again.');}
  finally{setReplyBusy(false);}
 };

 const reactToChannel=async(emoji:string)=>{
  if(!user){nav('/login');return;}
  if(reactionBusy||!featured)return;
  setReactionBusy(true);
  try{
   const next=await setTvReaction(featured.id,user.id,emoji,myTvReaction);
   setMyTvReaction(next);
   setTvReactionCounts(await getTvReactionCounts(featured.id));
  }catch{setNotice('Sign in is required and the reaction could not be saved.');}
  finally{setReactionBusy(false);}
 };

 const health=useCallback((id:string,healthy:boolean)=>{
  if(healthy){setDead(prev=>{if(!prev.has(id))return prev;const n=new Set(prev);n.delete(id);return n;});return;}
  setDead(prev=>{const n=new Set(prev);n.add(id);return n;});
  setActive(current=>current===id?(filteredRef.current.find(c=>c.id!==id&&!deadRef.current.has(c.id))?.id||''):current);
 },[]);

 const refresh=()=>{setDead(new Set());setActive('');setChannels([]);setNotice('');void loadSources(getPrioritySourceIds());};
 const categories=useMemo(()=>[
  ['Kenya',filtered.filter(c=>c.country==='KE')],
  ['News',filtered.filter(c=>/news/i.test((c.group||'')+' '+c.name))],
  ['Sports',filtered.filter(c=>/sport/i.test((c.group||'')+' '+c.name))],
  ['Music',filtered.filter(c=>/music/i.test((c.group||'')+' '+c.name))],
  ['International',filtered.filter(c=>c.country!=='KE')]
 ].filter(([,items])=>(items as TvChannel[]).length>0) as [string,TvChannel[]][],[filtered]);

 if(reelsMode)return <div className='min-h-screen bg-background'><main className='mx-auto max-w-3xl px-2 py-3'>{featured?<TvChannelPlayer channel={featured} active onVisible={onPlayerVisible} onHealth={health}/>:<div className='py-20 text-center text-muted-foreground'>No live channels available.</div>}</main></div>;

 return <div className='min-h-screen bg-background'>
  <header className='sticky top-0 z-40 border-b border-border/70 bg-background/90 backdrop-blur-xl'>
   <div className='mx-auto max-w-7xl px-4 py-3 sm:px-6'>
    <div className='flex items-center gap-3'>
     <div className='flex min-w-0 flex-1 items-center gap-3'><div className='flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm'><Tv className='h-5 w-5'/></div><div className='min-w-0'><div className='flex items-center gap-2'><h1 className='truncate text-lg font-black tracking-tight sm:text-xl'>Testagram Live TV</h1><span className='hidden rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary sm:inline'>WORLDWIDE</span></div><p className='hidden text-xs text-muted-foreground sm:block'>Live channels, Testagram broadcasts and public free streams in one place.</p></div></div>
     <Button size='icon' variant='outline' onClick={()=>nav('/tv-studio')} title='Open TV Studio'><Clapperboard/></Button><Button size='icon' variant='outline' onClick={refresh} title='Refresh live channels'><RefreshCw/></Button>
    </div>
    <div className='relative mt-3'><Search className='absolute left-3 top-2.5 h-4 w-4 text-muted-foreground'/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder='Search live channels…' className='h-10 w-full rounded-xl border bg-muted/40 pl-9 pr-3 text-sm outline-none ring-primary/20 focus:ring-2'/></div>
    <div className='mt-3 flex gap-2 overflow-x-auto pb-1'>{filters.map(([label,value])=><button key={label} onClick={()=>setFilter(value)} className={'shrink-0 rounded-full px-4 py-2 text-xs font-semibold transition '+(filter===value?'bg-primary text-primary-foreground shadow-sm':'bg-muted hover:bg-muted/70')}>{label}</button>)}</div>
   </div>
  </header>

  <main className='mx-auto max-w-7xl px-4 py-5 sm:px-6'>
   {testagramLive.length>0&&<section className='mb-6'>
    <div className='mb-3 flex items-end justify-between'><div><div className='flex items-center gap-2'><Sparkles className='h-4 w-4 text-primary'/><h2 className='text-base font-black'>Live on Testagram</h2></div><p className='mt-1 text-xs text-muted-foreground'>Your community's live broadcasts appear here first.</p></div><span className='rounded-full bg-red-500/10 px-2.5 py-1 text-[10px] font-bold text-red-500'>{testagramLive.length} LIVE</span></div>
    <div className='grid gap-3 sm:grid-cols-2 lg:grid-cols-4'>{testagramLive.slice(0,4).map(stream=><TestagramLiveChannelCard key={stream.id} stream={stream}/>)}</div>
   </section>}

   <section className='mb-6' aria-label='Sponsored TV placement'><TestagramAdSlot placement='TV_CHANNELS' context={{page_path:pathname,surface:'TV_CHANNELS'}} className='mx-auto max-w-4xl'/></section>

   {featured&&<section className='mb-8 overflow-hidden rounded-3xl border bg-card shadow-sm'>
    <div className='grid lg:grid-cols-[1.7fr_1fr]'>
     <div className='relative min-h-[260px] bg-black lg:min-h-[390px]'><TvChannelPlayer channel={featured} active onVisible={onPlayerVisible} onHealth={health}/></div>
     <div className='flex flex-col justify-center bg-gradient-to-br from-primary/10 via-background to-background p-6 sm:p-8'>
      <div className='mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-primary'><Wifi className='h-4 w-4'/> Now streaming</div>
      <h2 className='text-2xl font-black tracking-tight sm:text-3xl'>{featured.name}</h2>
      <p className='mt-2 text-sm text-muted-foreground'>{featured.country||'International'}{featured.group?' · '+featured.group:''}</p>
      <p className='mt-5 text-sm leading-6 text-muted-foreground'>Only the selected channel is opened as a video stream. Channel cards remain lightweight until you choose one, keeping playback steady and conserving data.</p>
      <div className='mt-6 flex flex-wrap gap-2'><Button onClick={()=>document.getElementById('channel-browser')?.scrollIntoView({behavior:'smooth'})}><Play className='mr-2 h-4 w-4 fill-current'/>Browse channels</Button><Button variant='outline' onClick={()=>nav('/tv/reels')}>TV Reels</Button></div>
      <div className='mt-5 border-t pt-4'>
       <div className='flex items-center gap-2 text-xs font-bold'><Heart className='h-4 w-4 text-primary'/>React to this channel</div>
       <div className='mt-2 flex items-center gap-2 overflow-x-auto pb-1'>{TV_REACTIONS.map(emoji=><button key={emoji} disabled={reactionBusy} onClick={()=>void reactToChannel(emoji)} className={'shrink-0 rounded-full border px-3 py-1.5 text-sm transition hover:-translate-y-0.5 hover:bg-muted '+(myTvReaction===emoji?'border-primary bg-primary/10 shadow-sm':'')}>{emoji}<span className='ml-1 text-[11px] font-semibold'>{tvReactionCounts.find(x=>x.emoji===emoji)?.count||0}</span></button>)}</div>
       <div className='mt-3 flex flex-wrap gap-1.5'>{channelTags(featured).map(tag=><button key={tag} onClick={()=>nav('/search?q=%23'+encodeURIComponent(tag)+'&tab=Hashtags')} className='inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-semibold text-primary hover:bg-primary/15'><Hash className='h-3 w-3'/>#{tag}</button>)}<button onClick={()=>nav('/search?q=%40'+encodeURIComponent(featured.name)+'&tab=People')} className='inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-[11px] font-semibold hover:bg-muted/70'><AtSign className='h-3 w-3'/>Find mentions</button></div>
       <div className='mt-4 rounded-2xl border bg-background/70 p-3'>
        <button onClick={()=>setShowReplies(v=>!v)} className='flex w-full items-center justify-between text-xs font-bold'><span className='flex items-center gap-2'><MessageCircle className='h-4 w-4 text-primary'/>Replies</span><span className='rounded-full bg-muted px-2 py-0.5'>{tvReplies.length}</span></button>
        <div className='mt-3 flex gap-2'>
         <textarea value={replyText} onChange={e=>setReplyText(e.target.value)} maxLength={1000} rows={2} placeholder='Reply with @mentions and #hashtags…' className='min-w-0 flex-1 resize-none rounded-xl border bg-muted/30 px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-primary/20'/>
         <Button size='icon' onClick={()=>void submitTvReply()} disabled={!replyText.trim()||replyBusy} title='Post reply'><Send className='h-4 w-4'/></Button>
        </div>
        <p className='mt-1 text-[10px] text-muted-foreground'>#hashtags and @handles are detected automatically and stay connected to Testagram Search.</p>
        {showReplies&&<div className='mt-3 max-h-72 space-y-2 overflow-y-auto border-t pt-3'>
         {tvReplies.length===0?<p className='py-4 text-center text-xs text-muted-foreground'>No replies yet. Start the conversation.</p>:tvReplies.map(reply=><div key={reply.id} className='rounded-xl bg-muted/40 p-2.5'>
          <div className='flex items-center gap-2'><div className='h-6 w-6 overflow-hidden rounded-full bg-muted'>{reply.profile?.avatar_url&&<img src={reply.profile.avatar_url} alt='' className='h-full w-full object-cover'/>}</div><span className='text-[11px] font-bold'>@{reply.profile?.username||'user'}</span><span className='text-[10px] text-muted-foreground'>{new Date(reply.created_at).toLocaleString([], {month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})}</span></div>
          <div className='mt-1 whitespace-pre-wrap break-words text-xs leading-5'>{renderReplyText(reply.content,openReplyTag)}</div>
         </div>)}
        </div>}
       </div>
      </div>
     </div>
    </div>
   </section>}

   {notice&&<div className='mb-5 rounded-xl border border-primary/20 bg-primary/5 p-3 text-xs text-muted-foreground'>{notice}</div>}

   <section id='channel-browser' className='space-y-8'>
    {categories.map(([name,items])=><div key={name}>
     <div className='mb-3 flex items-center justify-between'><div><h2 className='text-lg font-black'>{name}</h2><p className='text-xs text-muted-foreground'>{items.length} live channels</p></div><button onClick={()=>setFilter(name==='Kenya'?'KE':name==='International'?'INT':name==='News'?'news':name==='Sports'?'sport':name==='Music'?'music':'')} className='flex items-center gap-1 text-xs font-semibold text-primary'>View all<ChevronRight className='h-4 w-4'/></button></div>
     <div className='grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5'>{items.slice(0,10).map(c=><ChannelTile key={c.id} channel={c} active={active===c.id} onSelect={()=>{setActive(c.id);window.scrollTo({top:0,behavior:'smooth'});}}/>)}</div>
    </div>)}
   </section>

   {!loading&&!filtered.length&&<div className='rounded-2xl border py-20 text-center text-muted-foreground'><Globe2 className='mx-auto mb-3 h-10 w-10'/><p className='font-semibold'>No channels matched</p><p className='mt-1 text-sm'>Try another country, category or search.</p></div>}
   <div className='mt-8 text-center'><p className='mt-2 text-[11px] text-muted-foreground'>Channel metadata stays stable; reactions, hashtags and mentions connect this channel to the wider Testagram discovery system. Video playback remains strictly one channel at a time.</p></div>
   {loading&&<div className='py-8 text-center text-sm text-muted-foreground'><RefreshCw className='mx-auto mb-2 h-5 w-5 animate-spin'/>Discovering live channels…</div>}
   <footer className='mt-10 border-t pt-5 text-center text-[11px] leading-5 text-muted-foreground'>Testagram does not host or copy broadcast video files. Channel availability depends on the public stream source and its rights/availability.</footer>
  </main>
 </div>;
}
