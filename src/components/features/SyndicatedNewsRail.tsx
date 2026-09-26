import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { supabaseUrl } from '@/lib/supabase';

type Item={id:string;title:string;excerpt?:string|null;canonical_url:string;image_url?:string|null;published_at:string;category:string;testagram_rss_source_profiles?:{handle:string;display_name:string;avatar_url?:string|null;profile_url?:string|null}};

const HIDE=/^(\/auth|\/admin|\/settings|\/wallet|\/messages|\/notifications|\/help|\/premium|\/create-ad|\/my-ads|\/ad-|\/rewards|\/verify|\/privacy|\/terms|\/policy|\/regulator|\/sessions|\/blocked|\/appeals|\/payouts|\/revenue|\/analytics)/;
let rssCache:{at:number;items:Item[]}={at:0,items:[]};
let rssPending:Promise<Item[]>|null=null;

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
 const {pathname}=useLocation(); const [items,setItems]=useState<Item[]>([]); const [loading,setLoading]=useState(true);
 useEffect(()=>{if(HIDE.test(pathname)){setItems([]);setLoading(false);return;}let alive=true;setLoading(true);void loadRail().then(next=>{if(alive){setItems(next);setLoading(false);}});return()=>{alive=false};},[pathname]);
 if(HIDE.test(pathname))return null;
 if(!items.length&&!loading)return null;
 return <section aria-label='Syndicated news' className='border-b border-border bg-background/95 px-3 py-2'>
   <div className='flex items-center gap-2 overflow-x-auto no-scrollbar'>
    <span className='shrink-0 text-xs font-semibold text-muted-foreground'>Live from publishers</span>
    {loading&&!items.length?<span className='text-[11px] text-muted-foreground'>Loading current headlines…</span>:items.map(item=><a key={item.id} href={item.canonical_url} target='_blank' rel='noopener noreferrer' className='shrink-0 max-w-[260px] rounded-xl border border-border/70 bg-card px-3 py-2 hover:bg-accent transition-colors'>
      <div className='flex items-center gap-2'>{item.testagram_rss_source_profiles?.avatar_url?<img src={item.testagram_rss_source_profiles.avatar_url} alt='' className='h-5 w-5 rounded-full object-cover' loading='lazy'/>:<span className='h-5 w-5 rounded-full bg-muted'/>}<span className='text-[11px] text-muted-foreground truncate'>{item.testagram_rss_source_profiles?.display_name??'Publisher'} · {item.category}</span></div>
      <div className='mt-1 text-xs font-medium line-clamp-2'>{item.title}</div>
    </a>)}
   </div>
 </section>;
}
