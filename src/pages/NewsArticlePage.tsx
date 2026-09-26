import {useEffect,useState} from 'react';
import {useNavigate,useParams} from 'react-router-dom';
import {ArrowLeft,Clock,Newspaper} from 'lucide-react';
import {supabaseUrl} from '@/lib/supabase';

type Item={id:string;title:string;excerpt?:string|null;canonical_url:string;image_url?:string|null;favicon_url?:string|null;published_at:string;category:string;author?:string|null;testagram_rss_source_profiles?:{display_name:string;avatar_url?:string|null}};

export default function NewsArticlePage(){
 const {id}=useParams(); const nav=useNavigate(); const [item,setItem]=useState<Item|null>(null); const [loading,setLoading]=useState(true); const [error,setError]=useState('');
 useEffect(()=>{let alive=true;setLoading(true);setError('');
  fetch(supabaseUrl+'/functions/v1/testagram-rss-feed?id='+encodeURIComponent(id??''),{headers:{Accept:'application/json'},credentials:'omit'})
   .then(async r=>{if(!r.ok)throw new Error('Unable to load story');const d=await r.json();return d?.items?.[0]??null;})
   .then(next=>{if(!alive)return;if(!next){setError('This publisher story is no longer available in the live feed.');return;}setItem(next);})
   .catch(e=>{if(alive)setError(e instanceof Error?e.message:'Unable to load story');})
   .finally(()=>{if(alive)setLoading(false);});
  return()=>{alive=false};
 },[id]);
 return <main className='mx-auto w-full max-w-2xl px-3 pb-10'>
  <button type='button' onClick={()=>nav(-1)} className='my-3 inline-flex items-center gap-2 rounded-full border px-3 py-2 text-sm font-medium'><ArrowLeft className='h-4 w-4'/>Back</button>
  {loading?<div className='rounded-2xl border bg-card p-6 text-sm text-muted-foreground'>Loading publisher story…</div>:
   error?<div className='rounded-2xl border bg-card p-6'><div className='font-semibold'>Story unavailable</div><p className='mt-2 text-sm text-muted-foreground'>{error}</p></div>:
   item?<article className='overflow-hidden rounded-2xl border bg-card shadow-sm'>
    {item.image_url?<img src={item.image_url} alt='' className='max-h-[360px] w-full object-cover'/>:null}
    <div className='p-5'>
     <div className='flex items-center gap-2 text-xs text-muted-foreground'>
      {item.favicon_url?<img src={item.favicon_url} alt='' className='h-5 w-5 rounded object-contain'/>:<Newspaper className='h-4 w-4'/>}
      <span className='font-semibold text-foreground'>{item.testagram_rss_source_profiles?.display_name??'Publisher'}</span>
      <span>· {item.category}</span>
     </div>
     <h1 className='mt-4 text-2xl font-bold leading-tight'>{item.title}</h1>
     <div className='mt-3 flex items-center gap-2 text-xs text-muted-foreground'><Clock className='h-3.5 w-3.5'/>{new Date(item.published_at).toLocaleString()}</div>
     {item.author?<div className='mt-2 text-xs text-muted-foreground'>By {item.author}</div>:null}
     {item.excerpt?<p className='mt-6 whitespace-pre-wrap text-[15px] leading-7'>{item.excerpt}</p>:<p className='mt-6 text-sm text-muted-foreground'>The publisher did not provide an article excerpt in its RSS feed.</p>}
     <div className='mt-7 rounded-xl bg-muted/60 p-3 text-xs text-muted-foreground'>This is a live publisher feed surfaced inside Testagram. The story remains on its publisher’s site; Testagram does not copy or permanently store the article.</div>
    </div>
   </article>:null}
 </main>;
}