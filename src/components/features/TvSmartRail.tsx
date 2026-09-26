import {useEffect,useState} from 'react';
import {useLocation,useNavigate} from 'react-router-dom';
import {Radio,ChevronRight,RefreshCw} from 'lucide-react';
import {TV_SOURCES,loadTvSource,type TvChannel} from '@/services/tvChannelCatalog';

const HIDE=/^(\/auth)(?:\/|$)|^(\/tv)(?:\/|$)/;
let tvCache:{at:number;items:TvChannel[]}={at:0,items:[]};
let pending:Promise<TvChannel[]>|null=null;

async function loadRail(onItem:(item:TvChannel)=>void, signal:AbortSignal){
  if(tvCache.items.length&&Date.now()-tvCache.at<60000){
    for(const item of tvCache.items){if(signal.aborted)return;onItem(item);await new Promise(r=>setTimeout(r,0));}
    return;
  }
  const seen=new Set<string>();
  for(const source of TV_SOURCES.slice(0,4)){
    if(signal.aborted)return;
    try{
      const rows=await loadTvSource(source);
      for(const item of rows){
        if(signal.aborted)return;
        const key=item.url.toLowerCase();
        if(seen.has(key)||tvCache.items.some(c=>c.url.toLowerCase()===key))continue;
        seen.add(key);
        if(item.live!==true)continue;
        tvCache.items=[...tvCache.items,item].slice(0,8);
        tvCache.at=Date.now();
        onItem(item);
        await new Promise(r=>setTimeout(r,0));
        if(tvCache.items.length>=8)return;
      }
    }catch{}
  }
}

export function TvSmartRail(){
 const {pathname}=useLocation(); const nav=useNavigate(); const [items,setItems]=useState<TvChannel[]>([]); const [loading,setLoading]=useState(true);
 useEffect(()=>{
   if(HIDE.test(pathname)){setItems([]);setLoading(false);return;}
   const controller=new AbortController(); let live=true; setItems([]); setLoading(true);
   void loadRail(next=>{if(live)setItems(current=>current.some(c=>c.id===next.id)?current:[...current,next]);},controller.signal)
     .finally(()=>{if(live)setLoading(false);});
   return()=>{live=false;controller.abort();};
 },[pathname]);
 if(HIDE.test(pathname))return null;
 if(!items.length&&!loading)return null;
 return <section aria-label='Live TV' className='mx-auto w-full border-y bg-background py-3'>
   <div className='px-3 flex items-center justify-between mb-2'>
    <div><div className='flex items-center gap-2 font-semibold'><Radio className='w-4 h-4 text-red-500'/>Live TV</div><p className='text-[11px] text-muted-foreground'>Verified public live channels · offline links are filtered before display</p></div>
    <button onClick={()=>nav('/tv')} className='text-xs font-semibold flex items-center gap-1'>View all<ChevronRight className='w-3 h-3'/></button>
   </div>
   {loading&&!items.length?<div className='px-3 py-2 text-xs text-muted-foreground flex items-center gap-2'><RefreshCw className='w-3.5 h-3.5 animate-spin'/>Finding live channels…</div>:
   <div className='flex gap-2 overflow-x-auto px-3'>{items.map(c=><button key={c.id} onClick={()=>nav('/tv')} className='shrink-0 w-36 rounded-xl border bg-card overflow-hidden text-left'>
    <div className='h-20 bg-muted flex items-center justify-center'>{c.logo?<img src={c.logo} alt='' loading='lazy' className='max-h-12 max-w-[80%] object-contain'/>:<Radio className='w-6 h-6 text-muted-foreground'/>}</div>
    <div className='p-2'><div className='text-xs font-semibold line-clamp-2'>{c.name}</div><div className='text-[10px] text-muted-foreground mt-1 truncate'>{c.source}</div></div>
   </button>)}</div>}
 </section>;
}
