import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Bookmark, Check, Eye, FilePlus2, Heart, Loader2, MessageCircle, MoreHorizontal, Quote, Repeat2, Trash2 } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { TopBar } from '@/components/layout/TopBar';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import { formatNumber } from '@/lib/utils';
import { useSEO } from '@/hooks/useSEO';
import { toast } from 'sonner';
import { FeedAdCard } from '@/components/features/FeedAdCard';
import { DynamicAd } from '@/components/features/DynamicAd';
import { getThreadLikeState,toggleThreadLike } from '@/features/threadLikes/threadLikesService';
import { toggleThreadRepost, getThreadRepostState } from '@/features/threadReposts/threadRepostsService';

type Profile={id:string;username:string;avatar_url:string|null;verified:boolean;display_name?:string|null};
type MediaAsset={url:string;name?:string;type?:string;size?:number};
type Thread={id:string;owner_id:string;body:string;visibility:string;created_at:string;likes_count:number;reposts_count:number;quotes_count:number;replies_count:number;views_count:number;media_urls:MediaAsset[];profiles?:Profile};
function normalizeMedia(v:any):MediaAsset[]{return Array.isArray(v)?v.map((x:any)=>typeof x==='string'?{url:x}:x).filter((x:any)=>x?.url):[];}
function Avatar({profile}:{profile?:Profile}){return <div className="h-11 w-11 shrink-0 overflow-hidden rounded-full bg-muted flex items-center justify-center font-bold">{profile?.avatar_url?<img src={profile.avatar_url} alt="" className="h-full w-full object-cover"/>:(profile?.username||'?').slice(0,1).toUpperCase()}</div>}
function Media({items}:{items:MediaAsset[]}){if(!items.length)return null;return <div className="mt-4 grid gap-2">{items.map((m,i)=><div key={m.url+i} className="overflow-hidden rounded-2xl border border-border bg-muted/20">{m.type?.startsWith('image/')?<img src={m.url} alt={m.name||''} loading="lazy" className="max-h-[620px] w-full object-contain"/>:m.type?.startsWith('video/')?<video src={m.url} controls preload="metadata" className="max-h-[620px] w-full"/>:m.type?.startsWith('audio/')?<audio src={m.url} controls className="w-full p-3"/>:<a href={m.url} target="_blank" rel="noreferrer" className="flex items-center gap-3 p-4 text-sm text-primary"><FilePlus2 className="h-5 w-5"/>{m.name||'Open attachment'}</a>}</div>)}</div>}

export default function ThreadDetailPage(){
 const {id}=useParams(); const {user}=useAuth(); const navigate=useNavigate(); const [thread,setThread]=useState<Thread|null>(null); const [liked,setLiked]=useState(false); const [reposted,setReposted]=useState(false); const [loading,setLoading]=useState(true);
 useSEO({title:thread?.body?.slice(0,60)||'Thread',description:'Thread on Testagram',url:id?'/thread/'+id:undefined,type:'article'});
 useEffect(()=>{if(!id)return;void (async()=>{try{const {data,error}=await supabase.from('threads').select('id,owner_id,body,visibility,created_at,likes_count,reposts_count,quotes_count,replies_count,views_count,media_urls').eq('id',id).is('deleted_at',null).single();if(error)throw error;const owner=await supabase.from('profiles').select('id,username,avatar_url,verified,display_name').eq('id',data.owner_id).maybeSingle();setThread({...data,media_urls:normalizeMedia(data.media_urls),profiles:owner.data??undefined});if(user){setLiked(await getThreadLikeState(id,user.id));setReposted(await getThreadRepostState(id,user.id));}}catch(e){console.error('[ThreadDetail]',e);toast.error('Thread not found');navigate('/threads');}finally{setLoading(false);}})();},[id,user?.id,navigate]);
 const requireAuth=()=>{if(!user){navigate('/auth');return false;}return true};
 const like=async()=>{if(!thread||!requireAuth())return;try{const active=await toggleThreadLike(thread.id,user!.id);setLiked(active);setThread(t=>t?{...t,likes_count:Math.max(0,t.likes_count+(active?1:-1))}:t);}catch(e:any){toast.error(e?.message||'Like failed');}};
 const repost=async()=>{if(!thread||!requireAuth())return;try{const active=await toggleThreadRepost(thread.id,user!.id);setReposted(active);setThread(t=>t?{...t,reposts_count:Math.max(0,t.reposts_count+(active?1:-1))}:t);}catch(e:any){toast.error(e?.message||'Repost failed');}};
 const remove=async()=>{if(!thread||!user||thread.owner_id!==user.id)return;if(!window.confirm('Delete this thread?'))return;const {error}=await supabase.from('threads').update({deleted_at:new Date().toISOString()}).eq('id',thread.id).eq('owner_id',user.id);if(error)toast.error('Could not delete thread');else navigate('/threads');};
 if(loading)return <div className="min-h-screen bg-background"><TopBar title="Thread" showBack/><div className="flex justify-center py-24"><Loader2 className="h-7 w-7 animate-spin text-primary"/></div></div>;
 if(!thread)return null;
 return <div className="min-h-screen bg-background pb-20 md:pb-0"><TopBar title="Thread" showBack/><main>
  <article className="px-4 py-5"><div className="flex gap-3"><button onClick={()=>navigate('/profile/'+(thread.profiles?.username||''))}><Avatar profile={thread.profiles}/></button><div className="min-w-0 flex-1">
   <div className="flex items-start gap-2"><button onClick={()=>navigate('/profile/'+(thread.profiles?.username||''))} className="text-left"><div className="flex items-center gap-1.5"><span className="font-bold">{thread.profiles?.display_name||thread.profiles?.full_name||thread.profiles?.username||'Profile'}</span>{thread.profiles?.verified&&<Check className="h-4 w-4 rounded-full bg-primary p-0.5 text-primary-foreground"/>}</div><span className="text-xs text-muted-foreground">{thread.profiles?.username ? '@'+String(thread.profiles.username).replace(/^@/,'') : ''}</span></button><span className="pt-0.5 text-xs text-muted-foreground">· {formatDistanceToNow(new Date(thread.created_at),{addSuffix:true})}</span><button className="ml-auto rounded-full p-1.5 hover:bg-muted" aria-label="More"><MoreHorizontal className="h-4 w-4"/></button></div>
   <p className="mt-4 whitespace-pre-wrap break-words text-[16px] leading-7">{thread.body}</p><Media items={thread.media_urls}/>
   <div className="mt-5 grid grid-cols-6 items-center text-muted-foreground">
    <button onClick={()=>navigate('/thread/'+thread.id+'/replies')} className="flex items-center gap-1.5 rounded-full p-2 hover:text-primary"><MessageCircle className="h-5 w-5"/>{formatNumber(thread.replies_count)}</button>
    <button onClick={()=>void repost()} className={'flex items-center gap-1.5 rounded-full p-2 '+(reposted?'text-green-600':'hover:text-green-600')}><Repeat2 className="h-5 w-5"/>{formatNumber(thread.reposts_count)}</button>
    <button onClick={()=>void like()} className={'flex items-center gap-1.5 rounded-full p-2 '+(liked?'text-pink-600':'hover:text-pink-600')}><Heart className={'h-5 w-5 '+(liked?'fill-current':'')}/>{formatNumber(thread.likes_count)}</button>
    <button onClick={()=>navigate('/thread/'+thread.id+'/quotes')} className="flex items-center gap-1.5 rounded-full p-2 hover:text-primary"><Quote className="h-5 w-5"/>{formatNumber(thread.quotes_count)}</button>
    <button onClick={()=>navigate('/thread/'+thread.id+'/likes')} className="rounded-full p-2 text-xs hover:bg-muted">View likes</button>
    {thread.owner_id===user?.id?<button onClick={()=>void remove()} className="rounded-full p-2 hover:text-destructive"><Trash2 className="h-5 w-5"/></button>:<button className="rounded-full p-2 hover:text-primary"><Bookmark className="h-5 w-5"/></button>}
   </div>
  </div></div></article>
  <DynamicAd location="feed_inline" className="border-y border-border px-4 py-3"/><FeedAdCard/>
  <section className="border-t border-border px-4 py-8 text-center"><h2 className="font-bold">This conversation is independent</h2><p className="mt-1 text-sm text-muted-foreground">Replies, reposts, quotes and reactions each have their own page and data contract.</p><Button onClick={()=>navigate('/thread/'+thread.id+'/replies')} className="mt-4 rounded-full"><MessageCircle className="mr-2 h-4 w-4"/>Open replies</Button></section>
 </main></div>;
}