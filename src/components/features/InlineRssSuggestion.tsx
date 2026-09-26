import {useEffect,useMemo,useState} from 'react';
import {ExternalLink,Newspaper,X} from 'lucide-react';
import {supabase} from '@/lib/supabase';

type FeedItem={id:string;canonical_url:string;title:string;excerpt?:string|null;author?:string|null;image_url?:string|null;category:string;country_code?:string|null;published_at:string;testagram_rss_source_profiles?:{display_name?:string;avatar_url?:string|null}};
const cache=new Map<string,FeedItem[]>();
const pending=new Map<string,Promise<FeedItem[]>>();
const dismissedKey='testagram_rss_inline_dismissed_v1';

const clean=(s:string)=>s.toLowerCase().replace(/https?:\/\/\S+/g,' ');
function topicFor(text:string){const t=clean(text);if(/breaking|news|headline|election|government|parliament|president|world/.test(t))return'news';if(/football|soccer|basketball|tennis|rugby|cricket|match|league|afcon|premier league/.test(t))return'sports';if(/music|song|artist|album|concert|dj|radio/.test(t))return'music';if(/movie|film|actor|celebrity|entertainment|tv show/.test(t))return'entertainment';if(/technology|tech|ai|software|startup|iphone|android|cyber/.test(t))return'technology';if(/business|market|stock|economy|money|finance/.test(t))return'business';return'news';}
async function getFeed(category:string){
 if(cache.has(category))return cache.get(category)!;
 if(pending.has(category))return pending.get(category)!;
 const p=supabase.functions.invoke('testagram-rss-feed',{body:undefined}).then(()=>[] as FeedItem[]).catch(()=>[] as FeedItem[]);
 const url=supabase.functions.invoke('testagram-rss-feed',{body:undefined});
 const q=url.then(async()=>{const {data,error}=await supabase.functions.invoke('testagram-rss-feed',{method:'GET'} as any);if(error)throw error;const items=(data?.items||[]) as FeedItem[];cache.set(category,items);return items;}).catch(()=>[]);
 pending.set(category,q);return q;
}
function allowed(id:string){try{return !(localStorage.getItem(dismissedKey)||'').split(',').includes(id)}catch{return true}}
function dismiss(id:string){try{const s=new Set((localStorage.getItem(dismissedKey)||'').split(',').filter(Boolean));s.add(id);localStorage.setItem(dismissedKey,[...s].slice(-100).join(','))}catch{}}
export function InlineRssSuggestion({content,seed,type='post'}:{content:string;seed:string;type?:'post'|'thread'}){
 const [item,setItem]=useState<FeedItem|null>(null);const [hidden,setHidden]=useState(false);
 const eligible=useMemo(()=>{let h=0;for(let i=0;i<seed.length;i++)h=(h*31+seed.charCodeAt(i))>>>0;return h%6===0},[seed]);
 useEffect(()=>{if(!eligible||hidden||!content)return;let live=true;const category=topicFor(content);void getFeed(category).then(items=>{if(!live)return;const words=clean(content).split(/\s+/).filter(x=>x.length>3).slice(0,18);const ranked=items.map(x=>{const hay=clean(x.title+' '+(x.excerpt||''));let score=0;for(const w of words)if(hay.includes(w))score+=2; if(x.country_code==='KE'&&/kenya|nairobi|mombasa|africa/.test(clean(content)))score+=4; if(x.category===category)score+=2;return{x,score}}).sort((a,b)=>b.score-a.score);const pick=ranked.find(x=>x.score>2)?.x||items[0];if(pick&&allowed(seed))setItem(pick)});return()=>{live=false}},[content,eligible,hidden,seed]);
 if(!eligible||hidden||!item)return null;
 const close=()=>{setHidden(true);dismiss(seed)};
 return <div className='mt-3 rounded-2xl border border-border bg-muted/20 p-3' onClick={e=>e.stopPropagation()}>
  <div className='flex gap-3'>
   {item.image_url?<img src={item.image_url} alt='' loading='lazy' className='h-16 w-24 rounded-xl object-cover shrink-0'/>:<div className='h-16 w-24 rounded-xl bg-background flex items-center justify-center shrink-0'><Newspaper className='h-5 w-5 text-primary'/></div>}
   <div className='min-w-0 flex-1'><div className='flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground'><Newspaper className='h-3 w-3'/>Suggested from {item.testagram_rss_source_profiles?.display_name||'RSS feed'}</div><div className='font-bold text-sm mt-0.5 line-clamp-2'>{item.title}</div><div className='text-[11px] text-muted-foreground mt-1'>{item.country_code||'International'} · {item.category}</div></div>
   <button onClick={close} aria-label='Dismiss news suggestion' className='shrink-0 rounded-full p-1.5 hover:bg-muted'><X className='h-4 w-4'/></button>
  </div>
  <div className='mt-2 flex items-center gap-2'><a href={item.canonical_url} target='_blank' rel='noopener noreferrer' className='rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground inline-flex items-center gap-1.5'>Read article <ExternalLink className='h-3 w-3'/></a><span className='text-[10px] text-muted-foreground'>Suggested, not promoted</span></div>
 </div>
}