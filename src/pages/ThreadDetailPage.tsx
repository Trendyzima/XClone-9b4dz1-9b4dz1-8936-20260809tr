import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Bookmark, Check, Eye, FilePlus2, Heart, Loader2, MessageCircle, MoreHorizontal, Quote, Repeat2, Share2, Trash2, X } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { TopBar } from '@/components/layout/TopBar';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import { uploadTestagramMedia } from '@/services/mediaClient';
import { formatNumber } from '@/lib/utils';
import { useSEO } from '@/hooks/useSEO';
import { toast } from 'sonner';

type Profile={id:string;username:string;avatar_url:string|null;verified:boolean;display_name?:string|null};
type MediaAsset={url:string;name?:string;type?:string;size?:number};
type Thread={id:string;owner_id:string;body:string;visibility:string;created_at:string;likes_count:number;reposts_count:number;quotes_count:number;replies_count:number;views_count:number;media_urls:MediaAsset[];reply_to_id:string|null;root_thread_id:string|null;profiles?:Profile};
type QuoteItem={id:string;thread_id:string;user_id:string;content:string;media_urls:MediaAsset[];created_at:string;profiles?:Profile};

const MAX_FILE_BYTES=25*1024*1024;
const MAX_FILES=8;

function normalizeMedia(value:any):MediaAsset[]{return Array.isArray(value)?value.map((x:any)=>typeof x==='string'?{url:x}:x).filter((x:any)=>x?.url):[];}
function Avatar({profile}:{profile?:Profile}){return <div className="h-10 w-10 shrink-0 overflow-hidden rounded-full bg-muted flex items-center justify-center font-bold">{profile?.avatar_url?<img src={profile.avatar_url} alt="" className="h-full w-full object-cover"/>:(profile?.username||'?').slice(0,1).toUpperCase()}</div>}

function Media({items}:{items:MediaAsset[]}){
 return <div className="mt-3 space-y-2">{items.map((m,i)=>{const type=m.type||'';return <div key={m.url+i} className="overflow-hidden rounded-2xl border border-border bg-muted/20">
  {type.startsWith('image/')?<img src={m.url} alt={m.name||''} loading="lazy" className="max-h-[560px] w-full object-contain"/>:
   type.startsWith('video/')?<video src={m.url} controls preload="metadata" className="max-h-[560px] w-full"/>:
   type.startsWith('audio/')?<audio src={m.url} controls className="w-full p-3"/>:
   <a href={m.url} target="_blank" rel="noreferrer" className="flex items-center gap-3 p-4 text-sm text-primary"><FilePlus2 className="h-5 w-5"/><span className="min-w-0 truncate">{m.name||'Open attachment'}</span></a>}
 </div>})}</div>;
}

function ThreadNode({thread,depth,onReply,onQuote,onLike,onRepost,onBookmark,liked,reposted,bookmarked,quotes}:{thread:Thread;depth:number;onReply:(id:string)=>void;onQuote:(id:string)=>void;onLike:(id:string)=>void;onRepost:(id:string)=>void;onBookmark:(id:string)=>void;liked:boolean;reposted:boolean;bookmarked:boolean;quotes:QuoteItem[]}){
 const navigate=useNavigate(); const p=thread.profiles;
 return <article className="relative px-4 py-5">
  {depth>0&&<div className="absolute left-8 top-0 bottom-0 w-px bg-border"/>}
  <div className="relative flex gap-3">
   <button onClick={()=>navigate('/profile/'+(p?.username||''))}><Avatar profile={p}/></button>
   <div className="min-w-0 flex-1">
    <div className="flex items-start gap-2"><button onClick={()=>navigate('/profile/'+(p?.username||''))} className="text-left"><div className="flex items-center gap-1.5"><span className="font-bold">{p?.display_name||p?.username||'Testagram user'}</span>{p?.verified&&<Check className="h-4 w-4 rounded-full bg-primary p-0.5 text-primary-foreground"/>}</div><span className="text-xs text-muted-foreground">@{p?.username||'user'}</span></button><span className="pt-0.5 text-xs text-muted-foreground">· {formatDistanceToNow(new Date(thread.created_at),{addSuffix:true})}</span><button className="ml-auto rounded-full p-1.5 hover:bg-muted" aria-label="More"><MoreHorizontal className="h-4 w-4"/></button></div>
    <p className="mt-3 whitespace-pre-wrap break-words text-[15px] leading-7">{thread.body}</p>
    <Media items={thread.media_urls}/>
    <div className="mt-4 flex max-w-[620px] items-center justify-between text-muted-foreground">
      <button onClick={()=>onReply(thread.id)} className="flex items-center gap-1.5 rounded-full p-1.5 hover:text-primary" aria-label="Reply"><MessageCircle className="h-5 w-5"/>{thread.replies_count>0&&<span className="text-xs">{formatNumber(thread.replies_count)}</span>}</button>
      <button onClick={()=>onRepost(thread.id)} className={'flex items-center gap-1.5 rounded-full p-1.5 '+(reposted?'text-green-600':'hover:text-green-600')} aria-label="Repost"><Repeat2 className="h-5 w-5"/>{thread.reposts_count>0&&<span className="text-xs">{formatNumber(thread.reposts_count)}</span>}</button>
      <button onClick={()=>onLike(thread.id)} className={'flex items-center gap-1.5 rounded-full p-1.5 '+(liked?'text-pink-600':'hover:text-pink-600')} aria-label="Like"><Heart className={'h-5 w-5 '+(liked?'fill-current':'')}/>{thread.likes_count>0&&<span className="text-xs">{formatNumber(thread.likes_count)}</span>}</button>
      <button onClick={()=>onQuote(thread.id)} className="flex items-center gap-1.5 rounded-full p-1.5 hover:text-primary" aria-label="Quote"><Quote className="h-5 w-5"/>{thread.quotes_count>0&&<span className="text-xs">{formatNumber(thread.quotes_count)}</span>}</button>
      <button onClick={()=>onBookmark(thread.id)} className={'rounded-full p-1.5 '+(bookmarked?'text-primary':'hover:text-primary')} aria-label="Bookmark"><Bookmark className={'h-5 w-5 '+(bookmarked?'fill-current':'')}/></button>
      <span className="flex items-center gap-1 text-xs"><Eye className="h-4 w-4"/>{formatNumber(thread.views_count)}</span>
    </div>
    {quotes.length>0&&<div className="mt-3 space-y-2">{quotes.slice(0,5).map(q=><div key={q.id} className="rounded-2xl border border-border p-3 text-sm"><div className="flex items-center gap-2"><Avatar profile={q.profiles}/><span className="font-semibold">{q.profiles?.display_name||q.profiles?.username||'User'}</span><span className="text-xs text-muted-foreground">quoted this</span></div>{q.content&&<p className="mt-2 whitespace-pre-wrap">{q.content}</p>}<Media items={q.media_urls}/></div>)}</div>}
   </div>
  </div>
 </article>;
}

export default function ThreadDetailPage(){
 const {id}=useParams(); const {user}=useAuth(); const navigate=useNavigate(); const fileRef=useRef<HTMLInputElement>(null);
 const [root,setRoot]=useState<Thread|null>(null); const [nodes,setNodes]=useState<Thread[]>([]); const [quotes,setQuotes]=useState<QuoteItem[]>([]);
 const [loading,setLoading]=useState(true); const [replyTarget,setReplyTarget]=useState<string|null>(null); const [quoteTarget,setQuoteTarget]=useState<string|null>(null); const [replyText,setReplyText]=useState(''); const [replyFiles,setReplyFiles]=useState<File[]>([]); const [replyPreviews,setReplyPreviews]=useState<string[]>([]); const [sending,setSending]=useState(false);
 const [liked,setLiked]=useState<Set<string>>(new Set()); const [reposted,setReposted]=useState<Set<string>>(new Set()); const [bookmarked,setBookmarked]=useState<Set<string>>(new Set());

 useSEO({title:root?.body?.slice(0,60)||'Thread',description:'Infinite conversation on Testagram',url:id?'/thread/'+id:undefined,type:'article'});

 const load=useCallback(async()=>{
  if(!id)return; setLoading(true);
  try{
   const {data,error}=await supabase.from('threads').select('id,owner_id,body,visibility,created_at,likes_count,reposts_count,quotes_count,replies_count,views_count,media_urls,reply_to_id,root_thread_id').eq('id',id).is('deleted_at',null).single();
   if(error)throw error;
   const r={...(data as Thread),media_urls:normalizeMedia(data.media_urls),reply_to_id:data.reply_to_id??null,root_thread_id:data.root_thread_id??null};
   const allIds=r.root_thread_id?([r.root_thread_id,id]):[id];
   const rootId=r.root_thread_id||id;
   const {data:children}=await supabase.from('threads').select('id,owner_id,body,visibility,created_at,likes_count,reposts_count,quotes_count,replies_count,views_count,media_urls,reply_to_id,root_thread_id').eq('root_thread_id',rootId).is('deleted_at',null).order('created_at',{ascending:true}).limit(1000);
   const rows=[r,...((children??[]) as any[]).filter(x=>x.id!==r.id).map(x=>({...x,media_urls:normalizeMedia(x.media_urls)}))] as Thread[];
   const ids=[...new Set(rows.map(x=>x.owner_id))]; const profileRows:Profile[]=ids.length?(((await supabase.from('profiles').select('id,username,avatar_url,verified,display_name').in('id',ids)).data ?? []) as Profile[]):[]; const pm=new Map<string,Profile>(profileRows.map((p)=>[p.id,p])); rows.forEach(x=>x.profiles=pm.get(x.owner_id));
   setRoot(r); setNodes(rows.filter(x=>x.id!==r.id));
   const quoteIds=rows.map(x=>x.id);
   const {data:qrows}=quoteIds.length?await supabase.from('thread_quotes').select('id,thread_id,user_id,content,media_urls,created_at').in('thread_id',quoteIds).order('created_at',{ascending:false}).limit(500):{data:[]};
   const qids=[...new Set((qrows??[]).map((q:any)=>q.user_id))]; const quoteProfiles:Profile[]=qids.length?(((await supabase.from('profiles').select('id,username,avatar_url,verified,display_name').in('id',qids)).data ?? []) as Profile[]):[]; const qpm=new Map<string,Profile>(quoteProfiles.map((p)=>[p.id,p]));
   setQuotes((qrows??[]).map((q:any)=>({...q,media_urls:normalizeMedia(q.media_urls),profiles:qpm.get(q.user_id)})));
   if(user){const ids2=rows.map(x=>x.id);const [l,rr,b]=await Promise.all([supabase.from('thread_likes').select('thread_id').eq('user_id',user.id).in('thread_id',ids2),supabase.from('thread_reposts').select('thread_id').eq('user_id',user.id).in('thread_id',ids2),supabase.from('thread_bookmarks').select('thread_id').eq('user_id',user.id).in('thread_id',ids2)]);setLiked(new Set((l.data??[]).map((x:any)=>x.thread_id)));setReposted(new Set((rr.data??[]).map((x:any)=>x.thread_id)));setBookmarked(new Set((b.data??[]).map((x:any)=>x.thread_id)));}
   if(user){const key='ts-thread-view-'+id;if(!sessionStorage.getItem(key)){const {data:viewCount}=await supabase.rpc('testagram_record_thread_view',{p_thread_id:id});if(typeof viewCount==='number')setRoot(x=>x?{...x,views_count:viewCount}:x);sessionStorage.setItem(key,'1');}}
   void allIds;
  }catch(e){console.error('Thread detail error',e);toast.error('Thread not found');navigate('/threads');}finally{setLoading(false);}
 },[id,user?.id,navigate]);
 useEffect(()=>{void load();},[load]);
 useEffect(()=>()=>replyPreviews.forEach(x=>URL.revokeObjectURL(x)),[replyPreviews]);

 const requireAuth=()=>{if(!user){navigate('/auth');return false}return true};
 const mutate=async(kind:'like'|'repost'|'bookmark',threadId:string)=>{
  if(!requireAuth())return;
  const active=kind==='like'?!liked.has(threadId):kind==='repost'?!reposted.has(threadId):!bookmarked.has(threadId);
  const table=kind==='like'?'thread_likes':kind==='repost'?'thread_reposts':'thread_bookmarks';
  const setter=kind==='like'?setLiked:kind==='repost'?setReposted:setBookmarked;
  setter(prev=>{const n=new Set(prev);active?n.add(threadId):n.delete(threadId);return n;});
  const key=kind==='like'?'likes_count':kind==='repost'?'reposts_count':null;
  if(key){setRoot(x=>x?.id===threadId?{...x,[key]:Math.max(0,x[key]+(active?1:-1))}:x);setNodes(x=>x.map(n=>n.id===threadId?{...n,[key]:Math.max(0,n[key]+(active?1:-1))}:n));}
  const res=active?await supabase.from(table).insert({thread_id:threadId,user_id:user!.id}):await supabase.from(table).delete().eq('thread_id',threadId).eq('user_id',user!.id);
  if(res.error){setter(prev=>{const n=new Set(prev);active?n.delete(threadId):n.add(threadId);return n;});toast.error(kind+' failed');}
 };
 const addFiles=(incoming:File[])=>{const room=MAX_FILES-replyFiles.length;const valid=incoming.filter(f=>f.size<=MAX_FILE_BYTES).slice(0,room);if(incoming.some(f=>f.size>MAX_FILE_BYTES))toast.error('Each attachment must be 25 MiB or smaller');setReplyFiles(p=>[...p,...valid]);setReplyPreviews(p=>[...p,...valid.map(f=>URL.createObjectURL(f))]);};
 const removeFile=(i:number)=>{URL.revokeObjectURL(replyPreviews[i]);setReplyFiles(p=>p.filter((_,n)=>n!==i));setReplyPreviews(p=>p.filter((_,n)=>n!==i));};
 const uploadFiles=async(files:File[],threadId:string)=>{
  const out:MediaAsset[]=[];
  for(const file of files){
    const uploaded=await uploadTestagramMedia(file,null,threadId);
    out.push({url:uploaded.public_url||'',name:file.name,type:file.type||'application/octet-stream',size:file.size});
  }
  return out;
};

 const reply=async()=>{if(!requireAuth()||(!replyTarget&&!quoteTarget)||(!replyText.trim()&&!replyFiles.length))return;setSending(true);try{
  if(quoteTarget){
    const {data:q,error}=await supabase.from('thread_quotes').insert({thread_id:quoteTarget,user_id:user!.id,content:replyText.trim(),media_urls:[]}).select('id').single();
    if(error)throw error;
    const media=await uploadFiles(replyFiles,quoteTarget);
    if(media.length){const {error:updateError}=await supabase.from('thread_quotes').update({media_urls:media}).eq('id',q.id).eq('user_id',user!.id);if(updateError)throw updateError;}
    toast.success('Quote posted');
  }else{
    const rootId=root?.id||replyTarget!;
    const {data:newThread,error}=await supabase.from('threads').insert({owner_id:user!.id,body:replyText.trim(),visibility:'public',reply_to_id:replyTarget,root_thread_id:rootId,media_urls:[]}).select('id').single();
    if(error)throw error;
    const media=await uploadFiles(replyFiles,newThread.id);
    if(media.length){const {error:updateError}=await supabase.from('threads').update({media_urls:media}).eq('id',newThread.id).eq('owner_id',user!.id);if(updateError)throw updateError;}
    toast.success('Reply added to the thread');
  }
  setReplyText('');setReplyFiles([]);setReplyPreviews([]);setReplyTarget(null);setQuoteTarget(null);await load();
 }catch(e:any){toast.error(e?.message||'Post failed');}finally{setSending(false);}};
 const remove=async()=>{if(!root||!user||root.owner_id!==user.id)return;if(!window.confirm('Delete this thread?'))return;const {error}=await supabase.from('threads').update({deleted_at:new Date().toISOString()}).eq('id',root.id).eq('owner_id',user.id);if(error)toast.error('Could not delete thread');else navigate('/threads');};

 const ordered=useMemo(()=>{const byParent=new Map<string,Thread[]>();nodes.forEach(n=>{const k=n.reply_to_id||root?.id||'';const a=byParent.get(k)||[];a.push(n);byParent.set(k,a);});const out:Thread[]=[];const walk=(parent:string,depth:number)=>{for(const n of byParent.get(parent)||[]){out.push({...n});walk(n.id,depth+1);}};if(root)walk(root.id,1);return out;},[nodes,root]);
 const quoteMap=useMemo(()=>{const m=new Map<string,QuoteItem[]>();quotes.forEach(q=>{const a=m.get(q.thread_id)||[];a.push(q);m.set(q.thread_id,a);});return m;},[quotes]);

 if(loading)return <div className="min-h-screen bg-background"><TopBar title="Thread" showBack/><div className="flex justify-center py-24"><Loader2 className="h-7 w-7 animate-spin text-primary"/></div></div>;
 if(!root)return null;

 return <div className="min-h-screen bg-background pb-20 md:pb-0"><TopBar title="Thread" showBack/><main>
  <ThreadNode thread={root} depth={0} onReply={setReplyTarget} onQuote={(x)=>void quote(x)} onLike={(x)=>void mutate('like',x)} onRepost={(x)=>void mutate('repost',x)} onBookmark={(x)=>void mutate('bookmark',x)} liked={liked.has(root.id)} reposted={reposted.has(root.id)} bookmarked={bookmarked.has(root.id)} quotes={quoteMap.get(root.id)||[]}/>
  {ordered.map((n,i)=><ThreadNode key={n.id+i} thread={n} depth={1} onReply={setReplyTarget} onQuote={(x)=>void quote(x)} onLike={(x)=>void mutate('like',x)} onRepost={(x)=>void mutate('repost',x)} onBookmark={(x)=>void mutate('bookmark',x)} liked={liked.has(n.id)} reposted={reposted.has(n.id)} bookmarked={bookmarked.has(n.id)} quotes={quoteMap.get(n.id)||[]}/>)}
  <section className="border-t border-border px-4 py-5"><div className="mb-3 flex items-center gap-2 text-sm font-bold"><MessageCircle className="h-4 w-4"/>Continue the thread</div>
   <Button onClick={()=>setReplyTarget(root.id)} className="rounded-full">Reply to this thread</Button>
  </section>
  {replyTarget&&<div className="sticky bottom-0 z-20 border-t border-border bg-background/95 p-4 backdrop-blur-xl"><div className="mx-auto max-w-3xl">
   <div className="mb-2 text-xs font-semibold text-muted-foreground">{quoteTarget?'Quoting a post in this thread':'Replying in the thread'}</div>
   <Textarea autoFocus value={replyText} onChange={e=>setReplyText(e.target.value.slice(0,500))} placeholder={quoteTarget?'Add your thought to this quote…':'Continue the conversation…'} className="min-h-24 resize-none"/>
   {replyPreviews.length>0&&<div className="mt-2 space-y-2">{replyPreviews.map((url,i)=><div key={url} className="flex items-center gap-2 rounded-xl bg-muted p-2"><span className="min-w-0 flex-1 truncate text-xs">{replyFiles[i]?.name}</span><button onClick={()=>removeFile(i)} aria-label="Remove attachment"><X className="h-4 w-4"/></button></div>)}</div>}
   <div className="mt-2 flex items-center justify-between"><button onClick={()=>fileRef.current?.click()} className="rounded-full p-2 text-primary hover:bg-primary/10" aria-label="Attach media"><FilePlus2 className="h-5 w-5"/></button><input ref={fileRef} type="file" accept="*/*" multiple hidden onChange={e=>{addFiles(Array.from(e.target.files??[]));e.currentTarget.value='';}}/><div className="flex gap-2"><Button variant="ghost" onClick={()=>{setReplyTarget(null);setQuoteTarget(null)}}>Cancel</Button><Button onClick={()=>void reply()} disabled={sending||(!replyText.trim()&&!replyFiles.length)} className="rounded-full">{sending?<Loader2 className="h-4 w-4 animate-spin"/>:'Reply'}</Button></div></div>
  </div></div>}
  {user?.id===root.owner_id&&<div className="px-4 pb-6"><button onClick={()=>void remove()} className="flex items-center gap-2 text-sm text-destructive"><Trash2 className="h-4 w-4"/>Delete thread</button></div>}
 </main></div>;
}
