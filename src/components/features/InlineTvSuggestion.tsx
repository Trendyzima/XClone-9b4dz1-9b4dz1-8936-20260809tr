import {useEffect,useMemo,useState} from 'react';
import {Radio,ChevronRight,X,Play} from 'lucide-react';
import {useNavigate} from 'react-router-dom';
import {TV_SOURCES,dedupeTvChannels,loadTvSource,type TvChannel} from '@/services/tvChannelCatalog';
import {TvChannelPlayer} from './TvChannelPlayer';

const cache=new Map<string,TvChannel[]>();
const pending=new Map<string,Promise<TvChannel[]>>();
const dismissedKey='testagram_tv_inline_dismissed_v1';

function textOf(value:string){return value.toLowerCase().replace(/https?:\/\/\S+/g,' ');}
function scoreChannel(channel:TvChannel,text:string){
 const hay=textOf(text); const name=textOf(channel.name+' '+(channel.group||'')+' '+(channel.language||''));
 let score=0;
 const buckets=[
  {terms:['news','breaking','headline','politics','election','government','parliament','president','world'],bonus:8,groups:['news']},
  {terms:['sport','football','soccer','basketball','tennis','rugby','cricket','match','league','afcon','premier league'],bonus:8,groups:['sport']},
  {terms:['music','song','artist','album','concert','dj','radio'],bonus:8,groups:['music']},
  {terms:['kids','cartoon','animation','children'],bonus:8,groups:['kids']},
  {terms:['kenya','nairobi','mombasa','kisumu','uganda','tanzania','africa','ghana','nigeria','south africa'],bonus:5,groups:[]},
 ];
 for(const b of buckets) if(b.terms.some(t=>hay.includes(t))) { if(b.groups.some(g=>name.includes(g))) score+=b.bonus; }
 if(channel.country==='KE'&&/kenya|nairobi|mombasa|kisumu|ugali|safaricom/.test(hay)) score+=10;
 if(channel.country==='AF'&&/africa|kenya|uganda|tanzania|ghana|nigeria|south africa/.test(hay)) score+=6;
 if(/news|sport|music|kids|entertainment/.test(name)) score+=2;
 if(/not 24\/7|test|backup|off-air|offline/i.test(channel.name)) score-=8;
 return score;
}
async function getPool(topic:string){
 if(cache.has(topic)) return cache.get(topic)!;
 if(pending.has(topic)) return pending.get(topic)!;
 const ids=topic==='news'?['nexus-news','iptv-org-news','iptv-org-global']:topic==='sport'?['nexus-sports','iptv-org-sports','iptv-org-global']:topic==='music'?['nexus-music','iptv-org-music','iptv-org-global']:topic==='kids'?['nexus-kids','iptv-org-global']:['iptv-org-global','iptv-org-ke'];
 const promise=Promise.all(ids.map(id=>{const s=TV_SOURCES.find(x=>x.id===id);return s?loadTvSource(s).catch(()=>[]):Promise.resolve([] as TvChannel[]);})).then(rows=>{const out=dedupeTvChannels(rows.flat());cache.set(topic,out);pending.delete(topic);return out;});
 pending.set(topic,promise); return promise;
}
function topicFor(text:string){const t=textOf(text);if(/breaking|news|headline|election|government|parliament|president|world news/.test(t))return'news';if(/football|soccer|basketball|tennis|rugby|cricket|match|league|afcon|premier league/.test(t))return'sport';if(/music|song|artist|album|concert|dj|radio/.test(t))return'music';if(/kids|cartoon|animation|children/.test(t))return'kids';return'general';}
function allowed(id:string){try{const raw=localStorage.getItem(dismissedKey);return !raw?.split(',').includes(id);}catch{return true;}}
function dismiss(id:string){try{const raw=localStorage.getItem(dismissedKey);const next=new Set((raw||'').split(',').filter(Boolean));next.add(id);localStorage.setItem(dismissedKey,[...next].slice(-100).join(','));}catch{}}

export function InlineTvSuggestion({content,seed,type='post'}:{content:string;seed:string;type?:'post'|'thread'}){
 const nav=useNavigate(); const [channel,setChannel]=useState<TvChannel|null>(null); const [playing,setPlaying]=useState(false); const [hidden,setHidden]=useState(false);
 const eligible=useMemo(()=>{let h=0;for(let i=0;i<seed.length;i++)h=(h*31+seed.charCodeAt(i))>>>0;return h%5===0;},[seed]);
 useEffect(()=>{if(!eligible||hidden||!content)return;let live=true;const topic=topicFor(content);void getPool(topic).then(pool=>{if(!live)return;const ranked=pool.map(c=>({c,s:scoreChannel(c,content)})).sort((a,b)=>b.s-a.s||b.c.priority-a.c.priority);const pick=ranked.find(x=>x.s>=5)?.c||ranked[0]?.c;if(pick&&allowed(seed))setChannel(pick);});return()=>{live=false;};},[content,eligible,hidden,seed]);
 if(!eligible||hidden||!channel)return null;
 const close=()=>{setHidden(true);dismiss(seed);setPlaying(false);};
 if(playing)return <div className='mt-3' onClick={e=>e.stopPropagation()}><TvChannelPlayer channel={channel} active={true} onVisible={()=>{}}/><button onClick={close} className='mt-1 text-xs text-muted-foreground hover:text-foreground'>Hide TV suggestion</button></div>;
 return <div className='mt-3 rounded-2xl border border-border bg-muted/20 p-3' onClick={e=>e.stopPropagation()}>
  <div className='flex items-start gap-3'>
   <div className='h-11 w-11 shrink-0 rounded-xl bg-background border flex items-center justify-center overflow-hidden'>{channel.logo?<img src={channel.logo} alt='' loading='lazy' className='max-h-8 max-w-[80%] object-contain'/>:<Radio className='h-5 w-5 text-red-500'/>}</div>
   <div className='min-w-0 flex-1'><div className='flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground'><Radio className='h-3 w-3 text-red-500'/>Suggested live TV</div><div className='font-bold text-sm truncate mt-0.5'>{channel.name}</div><div className='text-[11px] text-muted-foreground truncate mt-0.5'>{channel.country||'International'} · {channel.source}</div><p className='text-xs text-muted-foreground mt-1'>This live channel may be relevant to this conversation.</p></div>
   <button onClick={close} aria-label='Dismiss TV suggestion' className='shrink-0 rounded-full p-1.5 hover:bg-muted'><X className='h-4 w-4'/></button>
  </div>
  <div className='mt-2 flex items-center gap-2'><button onClick={()=>setPlaying(true)} className='rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground flex items-center gap-1.5'><Play className='h-3 w-3 fill-current'/>Watch live</button><button onClick={()=>nav('/tv')} className='rounded-full border px-3 py-1.5 text-xs font-semibold flex items-center gap-1'>Explore TV<ChevronRight className='h-3 w-3'/></button></div>
 </div>;
}
