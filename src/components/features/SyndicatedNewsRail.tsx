import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { supabase } from '@/lib/supabase';

type Item={id:string;title:string;excerpt?:string|null;canonical_url:string;image_url?:string|null;published_at:string;category:string;testagram_rss_source_profiles?:{handle:string;display_name:string;avatar_url?:string|null;profile_url?:string|null}};

const HIDE=/^(\/auth|\/admin|\/settings|\/wallet|\/messages|\/notifications|\/help|\/premium|\/create-ad|\/my-ads|\/ad-|\/rewards|\/verify|\/privacy|\/terms|\/policy|\/regulator|\/sessions|\/blocked|\/appeals|\/payouts|\/revenue|\/analytics)/;

export function SyndicatedNewsRail(){
 const {pathname}=useLocation(); const [items,setItems]=useState<Item[]>([]);
 useEffect(()=>{if(HIDE.test(pathname)){setItems([]);return;} let alive=true;
  (async()=>{try{const {data,error}=await supabase.functions.invoke('testagram-rss-feed',{method:'GET',body:undefined,headers:{Accept:'application/json'}}); if(error)throw error; if(alive)setItems((data?.items??[]).slice(0,6));}catch{if(alive)setItems([])}})();
  return()=>{alive=false};
 },[pathname]);
 if(!items.length)return null;
 return <section aria-label="Syndicated news" className="border-b border-border bg-background/95 px-3 py-2">
   <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
    <span className="shrink-0 text-xs font-semibold text-muted-foreground">Live from publishers</span>
    {items.map(item=><a key={item.id} href={item.canonical_url} target="_blank" rel="noopener noreferrer" className="shrink-0 max-w-[260px] rounded-xl border border-border/70 bg-card px-3 py-2 hover:bg-accent transition-colors">
      <div className="flex items-center gap-2">
       {item.testagram_rss_source_profiles?.avatar_url?<img src={item.testagram_rss_source_profiles.avatar_url} alt="" className="h-5 w-5 rounded-full object-cover" loading="lazy"/>:<span className="h-5 w-5 rounded-full bg-muted"/>}
       <span className="text-[11px] text-muted-foreground truncate">{item.testagram_rss_source_profiles?.display_name??'Publisher'} · {item.category}</span>
      </div>
      <div className="mt-1 text-xs font-medium line-clamp-2">{item.title}</div>
    </a>)}
   </div>
 </section>;
}
