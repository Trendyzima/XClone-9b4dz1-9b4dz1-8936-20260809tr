import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {useNavigate,useLocation} from 'react-router-dom';
import {Globe2,Search,RefreshCw,Radio,Clapperboard,ChevronRight} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {TvChannelPlayer} from '@/components/features/TvChannelPlayer';
import {TestagramLiveChannelCard} from '@/components/features/TestagramLiveChannelCard';
import {supabase} from '@/lib/supabase';
import {TV_SOURCES,dedupeTvChannels,loadTvSource,type TvChannel} from '@/services/tvChannelCatalog';
const filters=[['For you',''],['Kenya','KE'],['Africa','AF'],['International','INT'],['News','news'],['Sports','sport'],['Music','music'],['Kids','kid']];
export default function TvChannelsPage(){
 const nav=useNavigate(); const {pathname}=useLocation(); const reelsMode=pathname==='/tv/reels'; const [channels,setChannels]=useState<TvChannel[]>([]);
 const [testagramLive,setTestagramLive]=useState<any[]>([]); const [active,setActive]=useState(''); const [loading,setLoading]=useState(true); const [sourceIndex,setSourceIndex]=useState(0); const [filter,setFilter]=useState(''); const [query,setQuery]=useState(''); const [notice,setNotice]=useState(''); const [dead,setDead]=useState<Set<string>>(new Set()); const loaded=useRef(new Set<string>()); const sentinel=useRef<HTMLDivElement>(null);
 const loadSources=useCallback(async(ids:string[])=>{const targets=TV_SOURCES.filter(s=>s.enabled!==false&&ids.includes(s.id)&&!loaded.current.has(s.id));if(!targets.length)return;setLoading(true);const results=await Promise.allSettled(targets.map(s=>loadTvSource(s)));const good=results.flatMap(r=>r.status==='fulfilled'?r.value:[]);targets.forEach(s=>loaded.current.add(s.id));setChannels(prev=>dedupeTvChannels([...prev,...good]));const failed=results.filter(r=>r.status==='rejected').length;if(failed)setNotice(failed+' source(s) could not be reached; other live sources remain available.');setLoading(false);},[]);
 useEffect(()=>{void loadSources(['iptv-org-global','free-tv-global','iptv-org-ke']); const loadTestagramLive=async()=>{const {data}=await supabase.from('live_streams').select('id,title,description,category,viewer_count,started_at,user:profiles(username,avatar_url)').eq('is_live',true).order('started_at',{ascending:false}).limit(8);setTestagramLive(data||[]);};void loadTestagramLive();const ch=supabase.channel('tv-live-broadcasts').on('postgres_changes',{event:'*',schema:'public',table:'live_streams'},loadTestagramLive).subscribe();return()=>{void supabase.removeChannel(ch);};},[loadSources]);
 useEffect(()=>{const el=sentinel.current;if(!el)return;const io=new IntersectionObserver(([entry])=>{if(entry.isIntersecting&&!loading)void loadMore();},{rootMargin:'700px'});io.observe(el);return()=>io.disconnect();},[loading,sourceIndex,loadSources]);
 const filtered=useMemo(()=>{const q=query.trim().toLowerCase();return channels.filter(c=>!dead.has(c.id)).filter(c=>{const text=(c.name+' '+(c.group||'')+' '+(c.language||'')).toLowerCase();const country=filter==='AF'?['KE','ZA','NG','GH','UG','TZ','RW','ZM','ZW','BW'].includes(c.country||''):filter?c.country===filter||text.includes(filter.toLowerCase()):true;return country&&(!q||text.includes(q));}).sort((a,b)=>Number(/not 24\/7/i.test(a.name))-Number(/not 24\/7/i.test(b.name)));},[channels,filter,query]);
 useEffect(()=>{if(!active&&filtered[0])setActive(filtered[0].id);},[active,filtered]);
 const visible=(id:string,v:boolean)=>{if(v)setActive(id);};
 const health=(id:string,healthy:boolean)=>{
  if(healthy){
   setDead(prev=>{if(!prev.has(id))return prev;const next=new Set(prev);next.delete(id);return next;});
  }else{
   setDead(prev=>{const next=new Set(prev);next.add(id);return next;});
   setActive(current=>current===id ? (filtered.find(c=>c.id!==id && !dead.has(c.id))?.id || '') : current);
  }
 };
 const loadMore=async()=>{let nextIndex=sourceIndex+1;
while(nextIndex<TV_SOURCES.length&&TV_SOURCES[nextIndex].enabled===false) nextIndex++;
if(nextIndex<TV_SOURCES.length){setSourceIndex(nextIndex);await loadSources([TV_SOURCES[nextIndex].id]);}};
 const sourceLabel=TV_SOURCES.find(s=>s.id===TV_SOURCES[sourceIndex]?.id)?.label;
 return <div className={reelsMode?'h-[100svh] overflow-hidden bg-black':'min-h-screen bg-background'}>
  <header className='sticky top-0 z-30 border-b bg-background/95 backdrop-blur p-3'><div className='max-w-3xl mx-auto flex items-center justify-between gap-3'><div><div className='flex items-center gap-2'><Radio className='w-5 h-5 text-red-500'/><h1 className='font-bold text-xl'>{reelsMode?'TV Reels':'Testagram TV'}</h1></div><p className='text-xs text-muted-foreground'>{reelsMode?'Swipe vertically through live channels · one stream at a time':'Live channels · vertical viewing · no stream files stored by Testagram'}</p></div><div className='flex gap-2'><Button size='icon' variant='outline' onClick={()=>nav('/tv-studio')} title='Open TV Studio'><Clapperboard/></Button><Button size='icon' variant='outline' onClick={()=>{loaded.current.clear();setDead(new Set());setActive('');setChannels([]);setSourceIndex(0);void loadSources(['iptv-org-global','free-tv-global','iptv-org-ke']);}} title='Refresh'><RefreshCw/></Button></div></div>
   <div className='max-w-3xl mx-auto mt-3 relative'><Search className='absolute left-3 top-2.5 w-4 h-4 text-muted-foreground'/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder='Search channels, news, sports, music…' className='w-full rounded-xl border bg-muted/40 py-2 pl-9 pr-3 outline-none'/></div>
   <div className='max-w-3xl mx-auto mt-3 flex gap-2 overflow-x-auto pb-1'>{filters.map(([label,value])=><button key={label} onClick={()=>setFilter(value)} className={'shrink-0 rounded-full px-4 py-2 text-sm '+(filter===value?'bg-primary text-primary-foreground':'bg-muted')}>{label}</button>)}</div>
  </header>
  <main className='max-w-3xl mx-auto px-2 sm:px-3 py-3'>
   {testagramLive.length>0&&<section className='mb-5 space-y-3'><div className='flex items-center justify-between px-1'><div><h2 className='font-black text-lg flex items-center gap-2'><span className='w-2 h-2 rounded-full bg-red-500 animate-pulse'/>Testagram Live</h2><p className='text-xs text-muted-foreground'>Live broadcasts from Testagram TV Studio — no recordings are stored here.</p></div><span className='text-xs font-bold text-red-500'>{testagramLive.length} live</span></div><div className='space-y-3'>{testagramLive.map(stream=><TestagramLiveChannelCard key={stream.id} stream={stream}/>)}</div></section>}
   {notice&&<div className='mb-3 rounded-xl border p-3 text-xs text-muted-foreground'>{notice}</div>}
   {!loading&&!filtered.length?<div className='py-20 text-center text-muted-foreground'><Globe2 className='mx-auto w-10 h-10 mb-3'/><p className='font-semibold'>No channels matched</p><p className='text-sm mt-1'>Try another country, category or source.</p></div>:
    <div className={'snap-y snap-mandatory '+(reelsMode?'space-y-0':'space-y-3')}>{filtered.map(channel=><TvChannelPlayer key={channel.id} channel={channel} active={active===channel.id} onVisible={visible} onHealth={health}/>)}
      {filtered.length>0&&<div ref={sentinel} className='snap-start py-10 text-center'><Button onClick={()=>void loadMore()} disabled={loading||sourceIndex>=TV_SOURCES.length-1}><ChevronRight className='mr-2'/>Load more channels</Button><p className='text-xs text-muted-foreground mt-2'>{sourceLabel||'More public channel sources'} are loaded only as needed.</p></div>}
    </div>}
   {loading&&<div className='py-10 text-center text-sm text-muted-foreground'><RefreshCw className='mx-auto mb-2 w-5 h-5 animate-spin'/>Discovering live channels…</div>}
  </main>
 </div>;
}