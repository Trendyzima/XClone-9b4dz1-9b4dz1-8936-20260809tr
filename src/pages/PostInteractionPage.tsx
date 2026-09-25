import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Heart, MessageCircle, Repeat2, Quote, Loader2, Send, RefreshCw } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { getInteractionCounts } from '@/services/postInteractionService';
import { useAuth } from '@/hooks/useAuth';
import { listLikes } from '@/features/likes/likesService';
import { listReplies, createReply } from '@/features/replies/repliesService';
import { listReposts } from '@/features/reposts/repostsService';
import { listQuotes, quotePost } from '@/features/quotes/quotesService';
import { ReplyActions } from '@/components/features/ReplyActions';
import { listQuoteLikes } from '@/features/quoteLikes/quoteLikesService';
import * as federation from '@/api/federation';
import { federatedObjectToPost } from '@/features/federation/federatedPostAdapter';

type Kind='likes'|'replies'|'reposts'|'quotes'|'quote-likes';
const META:Record<Kind,{title:string;icon:any}>={likes:{title:'Likes',icon:Heart},replies:{title:'Replies',icon:MessageCircle},reposts:{title:'Reposts / Retweets',icon:Repeat2},quotes:{title:'Quotes',icon:Quote},'quote-likes':{title:'Quote Likes',icon:Heart}};

export default function PostInteractionPage({kind}:{kind:Kind}){
 const {postId:routePostId}=useParams(); const [searchParams]=useSearchParams(); const postId=routePostId || searchParams.get('post_uri') || ''; const navigate=useNavigate(); const {user}=useAuth();
 const [post,setPost]=useState<any>(null); const [items,setItems]=useState<any[]>([]);
 const [counts,setCounts]=useState({likes:0,reposts:0,replies:0,quotes:0,views:0});
 const [loading,setLoading]=useState(true); const [error,setError]=useState<string|null>(null);
 const [text,setText]=useState(''); const [sending,setSending]=useState(false); const [retry,setRetry]=useState(0);
 const meta=META[kind]; const Icon=meta.icon;

 const load=useCallback(async()=>{
  if(!postId)return;
  setLoading(true); setError(null);
  try{
   let next:any[]=[];
   if(/^https:\/\//i.test(postId)){
    const remote=await federation.getFederatedObject(postId);
    const object=remote?.object??remote;
    if(!object?.id)throw new Error('Remote ActivityPub object not found');
    const normalized=await federatedObjectToPost(object,federation.getFederatedObject);
    const liveCounts=await getInteractionCounts(postId);
    setPost(normalized);
    setCounts({
      likes:Number(object.likes?.totalItems??liveCounts.likes??0),
      replies:Number(object.replies?.totalItems??liveCounts.replies??0),
      reposts:Number(object.shares?.totalItems??liveCounts.reposts??0),
      quotes:Number(liveCounts.quotes??0),
      views:Number(liveCounts.views??0),
    });
    if(kind==='replies'){
      const remoteReplies=await listReplies(postId,100);
      setItems(remoteReplies.items??[]);
    }else{
      setItems([]);
    }
    return;
   }
   const postResult=await supabase.from('posts').select('id,content,created_at,user_id,author_id,likes_count,replies_count,reposts_count,quoted_post_id,deleted_at').eq('id',postId).maybeSingle();
   if(postResult.error)throw postResult.error;
   if(!postResult.data){throw new Error('Post not found');}
   const p=postResult.data;
   const authorId=p.author_id??p.user_id;
   let profile:any=null;
   if(authorId){
    const profileResult=await supabase.from('profiles').select('id,username,display_name,full_name,avatar_url,verified').eq('id',authorId).maybeSingle();
    if(profileResult.error)console.warn('[post-interaction] author enrichment failed',profileResult.error);
    profile=profileResult.data??null;
   }
   const normalized={...p,author_id:authorId,profiles:profile,user_profiles:profile};
   const liveCounts=await getInteractionCounts(postId);
   setPost(normalized); setCounts(liveCounts);

   if(kind==='likes')next=await listLikes(postId,100);
   else if(kind==='replies')next=(await listReplies(postId,100)).items??[];
   else if(kind==='reposts')next=await listReposts(postId,100);
   else if(kind==='quotes')next=await listQuotes(postId,100);
   else next=await listQuoteLikes(postId,100);
   setItems(next);
  }catch(e){
   console.error('[post-interaction]',kind,e);
   setError(e instanceof Error?e.message:'Unable to load interaction');
   setItems([]);
  }finally{setLoading(false)}
 },[postId,kind,retry]);

 useEffect(()=>{void load()},[load]);

 useEffect(()=>{
  if(!postId)return;
  const channel=supabase.channel('post-interactions-'+postId+'-'+kind)
   .on('postgres_changes',{event:'*',schema:'public',table:'post_reactions',filter:'post_id=eq.'+postId},()=>void load())
   .on('postgres_changes',{event:'*',schema:'public',table:'replies',filter:'post_id=eq.'+postId},()=>void load())
   .on('postgres_changes',{event:'*',schema:'public',table:'reposts',filter:'post_id=eq.'+postId},()=>void load())
   .subscribe();
  return()=>{void supabase.removeChannel(channel)};
 },[postId,kind,load]);

 const sendReply=async()=>{
  if(!postId||!text.trim()||!user||sending)return;
  setSending(true);
  try{
   const result=await createReply(postId,text.trim());
   setText('');
   const refreshed=await listReplies(postId,100);
   const next=refreshed.items??[];
   setItems(kind==='replies'?next:items);
   const returnedCount=Number((result as any)?.replies_count);
   setCounts(c=>({...c,replies:Number.isFinite(returnedCount)&&returnedCount>0?returnedCount:c.replies+1}));
  }catch(e){setError(e instanceof Error?e.message:'Reply failed')}
  finally{setSending(false)}
 };

 if(loading)return <div className="min-h-screen flex items-center justify-center"><Loader2 className="w-7 h-7 animate-spin text-primary"/></div>;
 if(!post)return <div className="min-h-screen p-8 text-center"><p className="font-semibold">{error??'Post not found'}</p><button className="mt-4 px-4 py-2 rounded-full border" onClick={()=>setRetry(x=>x+1)}><RefreshCw className="inline w-4 h-4 mr-1"/>Retry</button></div>;

 return <div className="min-h-screen bg-background">
  <div className="sticky top-0 z-20 bg-background/95 backdrop-blur border-b border-border px-4 py-3 flex items-center gap-3">
   <button onClick={()=>navigate(-1)} className="p-2 rounded-full hover:bg-muted" aria-label="Back"><ArrowLeft className="w-5 h-5"/></button>
   <div className="min-w-0"><h1 className="font-bold">{meta.title}</h1><p className="text-xs text-muted-foreground">{counts.likes} likes · {counts.replies} replies · {counts.reposts} reposts</p></div>
  </div>
  <button onClick={()=>navigate(/^https:\/\//i.test(post.id) ? `/post-remote?post_uri=${encodeURIComponent(post.id)}` : '/post/'+post.id)} className="w-full text-left p-4 border-b border-border hover:bg-muted/20">
   <div className="flex items-center gap-2"><img src={post.profiles?.avatar_url??''} alt="" className="w-8 h-8 rounded-full bg-muted object-cover"/><span className="font-semibold text-sm">{post.profiles?.display_name||post.profiles?.full_name||post.profiles?.username||'Profile'}</span>{(post.profiles?.username||post.profiles?.preferredUsername)&&<span className="text-xs text-muted-foreground">@{String(post.profiles?.username||post.profiles?.preferredUsername).replace(/^@/,'')}</span>}</div>
   <p className="mt-3 text-sm whitespace-pre-wrap break-words">{post.content}</p>
   <div className="flex gap-5 mt-3 text-xs text-muted-foreground"><span>{counts.likes} likes</span><span>{counts.replies} replies</span><span>{counts.reposts} reposts</span><span>{counts.quotes} quotes</span></div>
  </button>
  {error&&<div className="px-4 py-3 border-b border-border text-sm text-destructive flex items-center justify-between gap-3"><span>{error}</span><button onClick={()=>setRetry(x=>x+1)} className="rounded-full border px-3 py-1 text-xs font-semibold">Retry</button></div>}
  {kind==='replies'&&user&&<div className="p-3 border-b border-border flex gap-2 sticky top-[65px] z-10 bg-background/95 backdrop-blur">
   <input value={text} onChange={e=>setText(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();void sendReply()}}} placeholder="Write a reply…" className="flex-1 rounded-xl border border-border bg-muted/30 px-3 py-2 text-sm outline-none"/>
   <button disabled={!text.trim()||sending} onClick={()=>void sendReply()} className="px-4 rounded-xl bg-primary text-primary-foreground disabled:opacity-40">{sending?<Loader2 className="w-4 h-4 animate-spin"/>:<Send className="w-4 h-4"/>}</button>
  </div>}
  <div>{items.length===0?<div className="py-16 text-center text-muted-foreground"><Icon className="w-9 h-9 mx-auto mb-3 opacity-30"/><p>No {meta.title.toLowerCase()} yet.</p>{kind==='replies'&&<p className="text-xs mt-1">Be the first to reply.</p>}</div>:items.map((item:any)=><InteractionRow key={item.id} item={item} kind={kind} onOpenProfile={(u:string)=>u&&navigate('/profile/'+u)} onOpenPost={(id:string)=>navigate('/post/'+id)} onOpenReplyChain={(replyId:string)=>navigate(/^https:\/\//i.test(postId) ? `/post-remote/reply/${encodeURIComponent(replyId)}?post_uri=${encodeURIComponent(postId)}` : `/post/${postId}/reply/${encodeURIComponent(replyId)}`)}/>)}</div>
 </div>;
}

function InteractionRow({item,kind,onOpenProfile,onOpenPost,onOpenReplyChain}:{item:any;kind:Kind;onOpenProfile:(u:string)=>void;onOpenPost:(id:string)=>void;onOpenReplyChain:(id:string)=>void}){
 const profile=item.profile??item.profiles??item.user_profiles??item.posts?.profiles??{}; const quote=item.quote; const username=profile.username??profile.preferredUsername??profile.acct??''; const displayName=profile.display_name??profile.full_name??profile.name??username??'Profile'; const initial=String(displayName).trim().slice(0,1).toUpperCase()||'P';
 return <div className="p-4 border-b border-border">
  <div className="flex gap-3">
   <button onClick={()=>onOpenProfile(username)} aria-label={'Open @'+username}><div className="w-10 h-10 rounded-full bg-muted overflow-hidden flex items-center justify-center shrink-0">{profile.avatar_url?<img src={profile.avatar_url} alt={displayName} className="w-full h-full object-cover" loading="lazy"/>:<span className="text-xs font-bold text-muted-foreground">{initial}</span>}</div></button>
   <div className="min-w-0 flex-1">
    <button onClick={()=>onOpenProfile(username)} className="font-bold text-sm hover:underline">{displayName}{username&&<span className="ml-1 font-normal text-muted-foreground">@{String(username).replace(/^@/,'')}</span>}</button>
    {kind==='replies'&&<><button onClick={()=>onOpenReplyChain(item.id)} className="mt-1 text-left w-full text-sm whitespace-pre-wrap break-words hover:bg-muted/30 rounded-lg p-1">{item.content}<span className="block text-[11px] text-primary mt-2">Open reply chain →</span></button><ReplyActions replyId={item.id} onReply={()=>onOpenReplyChain(item.id)} /></>}
    {kind==='quotes'&&<><p className="mt-1 text-sm whitespace-pre-wrap break-words">{item.content}</p><button onClick={()=>onOpenPost(item.id)} className="mt-2 w-full text-left rounded-xl border border-border p-3 text-xs text-muted-foreground">Quoted post</button></>}
    {kind==='quote-likes'&&<><p className="text-xs text-muted-foreground mt-1">liked a quote post</p>{quote?.content&&<button onClick={()=>onOpenPost(quote.id)} className="mt-2 w-full text-left rounded-xl border border-border p-3 text-sm">{quote.content}</button>}</>}
    {(kind==='likes'||kind==='reposts')&&<p className="text-xs text-muted-foreground mt-1">{kind==='likes'?'liked':'reposted'} this post</p>}
   </div>
  </div>
 </div>;
}
