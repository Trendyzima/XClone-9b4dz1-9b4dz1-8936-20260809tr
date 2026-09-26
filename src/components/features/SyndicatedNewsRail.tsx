import {useEffect,useState} from 'react';
import {useLocation,useNavigate} from 'react-router-dom';
import {ExternalLink,Newspaper,Heart,Flame,Laugh,ThumbsUp} from 'lucide-react';
import {supabaseUrl} from '@/lib/supabase';

type Item={id:string;title:string;excerpt?:string|null;canonical_url:string;image_url?:string|null;favicon_url?:string|null;published_at:string;category:string;testagram_rss_source_profiles?:{handle:string;display_name:string;avatar_url?:string|null;profile_url?:string|null}};
type ReactionKey='❤️'|'🔥'|'😂'|'👍';
const REACTIONS:{key:ReactionKey;Icon:typeof Heart;label:string}[]=[
 {key:'❤️',Icon:Heart,label:'Love'},{key:'🔥',Icon:Flame,label:'Fire'},{key:'😂',Icon:Laugh,label:'Funny'},{key:'👍',Icon:ThumbsUp,label:'Like'},
];
const REACTION_KEY='testagram_rss_temporary_reactions_v1';
const HIDE=/^(\/auth|\/admin|\/settings|\/wallet|\/messages|\/notifications|\/help|\/premium|\/create-ad|\/my-ads|\/ad-|\/rewards|\/verify|\/privacy|\/terms|\/policy|\/regulator|\/sessions|\/blocked|\/appeals|\/payouts|\/revenue|\/analytics)/;
let rssCache:{at:number;items:Item[]}={at:0,items:[]};
let rssPending:Promise<Item[]>|null=null;
function readTemporaryReactions():Record<string,ReactionKey>{try{const raw=sessionStorage.getItem(REACTION_KEY);const parsed=raw?JSON.parse(raw):{};return parsed&&typeof parsed==='object'?parsed:{}}catch{return {}}}
function writeTemporaryReactions(value:Record<string,ReactionKey>){try{sessionStorage.setItem(REACTION_KEY,JSON.stringify(value))}catch{}}
async function loadRail(){
 if(rssCache.items.length&&Date.now()-rssCache.at<60000)return rssCache.items;
 if(rssPending)return rssPending;
 rssPending=fetch(supabaseUrl+'/functions/v1/testagram-rss-feed?limit=6',{headers:{Accept:'application/json'},credentials:'omit'})
  .then(async response=>{if(!response.ok)throw new Error('RSS rail HTTP '+response.status);const data=await response.json();const items=Array.isArray(data?.items)?data.items.slice(0,6):[];rssCache={at:Date.now(),items};return items;})
  .catch(()=>rssCache.items)
  .finally(()=>{rssPending=null;});
 return rssPending;
}
export function SyndicatedNewsRail(){
 const {pathname}=useLocation();const nav=useNavigate();const [items,setItems]=useState<Item[]>([]);const [loading,setLoading]=useState(true);const [reactions,setReactions]=useState<Record<string,ReactionKey>>(readTemporaryReactions);
 useEffect(()=>{if(HIDE.test(pathname)){setItems([]);setLoading(false);return;}let alive=true;setLoading(true);void loadRail().then(next=>{if(alive){setItems(next);setLoading(false);}});return()=>{alive=false}},[pathname]);
 if(HIDE.test(pathname))return null;
 if(!items.length&&!loading)return null;
 const react=(id:string,key:ReactionKey)=>setReactions(previous=>{const next={...previous};if(next[id]===key)delete next[id];else next[id]=key;writeTemporaryReactions(next);return next});
 return <section aria-label='Syndicated news' className='border-b border-border bg-background/95 px-3 py-3'>
  <div className='mb-2 flex items-center justify-between gap-3'><div className='flex items-center gap-2'><Newspaper className='h-4 w-4'/><span className='text-sm font-semibold'>Live from publishers</span></div><span className='text-[11px] text-muted-foreground'>Opens inside Testagram</span></div>
  {loading&&!items.length?<div className='text-[11px] text-muted-foreground'>Loading current headlines…</div>:
  <div className='flex gap-3 overflow-x-auto no-scrollbar pb-1'>{items.map(item=>{const profile=item.testagram_rss_source_profiles;return <div key={item.id} className='group shrink-0 w-[280px] overflow-hidden rounded-2xl border border-border bg-card shadow-sm'>
   <button type='button' onClick={()=>nav('/news/'+encodeURIComponent(item.id))} className='block w-full text-left transition hover:bg-accent/40'>
    {item.image_url?<img src={item.image_url} alt='' loading='lazy' className='h-28 w-full object-cover'/>:<div className='flex h-20 items-center gap-2 bg-muted px-3 text-xs text-muted-foreground'><Newspaper className='h-5 w-5'/><span>Publisher story</span></div>}
    <div className='p-3'><div className='flex items-center gap-2'>{item.favicon_url?<img src={item.favicon_url} alt='' loading='lazy' onError={e=>{e.currentTarget.style.display='none'}} className='h-5 w-5 rounded object-contain'/>:null}<span className='truncate text-[11px] font-semibold'>Feed from {profile?.display_name??'Publisher'}</span><span className='text-[10px] text-muted-foreground'>· {item.category}</span></div><div className='mt-2 line-clamp-3 text-sm font-semibold leading-snug'>{item.title}</div><div className='mt-2 flex items-center gap-1 text-[10px] text-muted-foreground'><span>Read in Testagram</span><ExternalLink className='h-3 w-3 rotate-180 opacity-60'/></div></div>
   </button>
   <div className='flex items-center gap-0.5 border-t border-border px-2 py-1.5'>{REACTIONS.map(({key,Icon,label})=><button key={key} type='button' title={label} aria-label={label+' temporary reaction'} aria-pressed={reactions[item.id]===key} onClick={()=>react(item.id,key)} className={'flex h-7 w-8 items-center justify-center rounded-full '+(reactions[item.id]===key?'bg-primary/10 text-primary':'text-muted-foreground hover:bg-muted')}><Icon className='h-3.5 w-3.5'/></button>)}<span className='ml-1 text-[9px] text-muted-foreground'>temporary</span></div>
  </div>})}</div>}
 </section>;
}