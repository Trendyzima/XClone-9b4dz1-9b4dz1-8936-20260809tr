import { useEffect,useState } from 'react';
import { useNavigate,useParams } from 'react-router-dom';
import { ArrowLeft,Heart,MessageCircle,Repeat2,Quote,Loader2,Send } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { listLikes } from '@/features/likes/likesService';
import { listReplies,createReply } from '@/features/replies/repliesService';
import { listReposts } from '@/features/reposts/repostsService';
import { listQuotes } from '@/features/quotes/quotesService';
import { listQuoteLikes } from '@/features/quoteLikes/quoteLikesService';

type Kind='likes'|'replies'|'reposts'|'quotes'|'quote-likes';
const META:Record<Kind,{title:string;icon:any}>={likes:{title:'Likes',icon:Heart},replies:{title:'Replies',icon:MessageCircle},reposts:{title:'Reposts',icon:Repeat2},quotes:{title:'Quotes',icon:Quote},'quote-likes':{title:'Quote Likes',icon:Heart}};

export default function PostInteractionPage({kind}:{kind:Kind}){
 const {postId}=useParams(); const navigate=useNavigate(); const {user}=useAuth();
 const [post,setPost]=useState<any>(null); const [items,setItems]=useState<any[]>([]); const [loading,setLoading]=useState(true); const [text,setText]=useState(''); const [sending,setSending]=useState(false);
 const meta=META[kind]; const Icon=meta.icon;
 useEffect(()=>{if(!postId)return;let cancelled=false;(async()=>{setLoading(true);try{
   const {data,error}=await supabase.from('posts').select('id,content,created_at,user_id,author_id,likes_count,replies_count,reposts_count,quoted_post_id,profiles!posts_author_id_fkey(id,username,display_name,avatar_url,verified)').eq('id',postId).maybeSingle();
   if(error)throw error; if(cancelled)return; setPost(data);
   let rows:any[]=[];
   if(kind==='likes')rows=await listLikes(postId,100);
   if(kind==='replies')rows=(await listReplies(postId,100)).items??[];
   if(kind==='reposts')rows=await listReposts(postId,100);
   if(kind==='quotes')rows=await listQuotes(postId,100);
   if(kind==='quote-likes')rows=await listQuoteLikes(postId,100);
   if(!cancelled)setItems(rows);
 }catch(e){console.error('[post-interaction]',kind,e);if(!cancelled)setItems([])}finally{if(!cancelled)setLoading(false)}})();return()=>{cancelled=true}},[postId,kind]);
 const sendReply=async()=>{if(!postId||!text.trim()||!user)return;setSending(true);try{await createReply(postId,text.trim());setText('');const next=(await listReplies(postId,100)).items??[];setItems(next)}catch(e){console.error(e)}finally{setSending(false)}};
 return <div className="min-h-screen bg-background">
  <div className="sticky top-0 z-20 bg-background/95 backdrop-blur border-b border-border px-4 py-3 flex items-center gap-3">
   <button onClick={()=>navigate(-1)} className="p-2 rounded-full hover:bg-muted"><ArrowLeft className="w-5 h-5"/></button><div><h1 className="font-bold">{meta.title}</h1><p className="text-xs text-muted-foreground">Independent interaction view</p></div>
  </div>
  {post&&<button onClick={()=>navigate('/post/'+post.id)} className="w-full text-left p-4 border-b border-border hover:bg-muted/20">
   <div className="flex items-center gap-2"><img src={post.profiles?.avatar_url??''} className="w-8 h-8 rounded-full bg-muted object-cover" /><span className="font-semibold text-sm">@{post.profiles?.username??'user'}</span></div>
   <p className="mt-3 text-sm whitespace-pre-wrap break-words line-clamp-5">{post.content}</p>
   <div className="flex gap-5 mt-3 text-xs text-muted-foreground"><span>{post.likes_count??0} likes</span><span>{post.replies_count??0} replies</span><span>{post.reposts_count??0} reposts</span></div>
  </button>}
  {kind==='replies'&&user&&<div className="p-3 border-b border-border flex gap-2"><input value={text} onChange={e=>setText(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();void sendReply()}}} placeholder="Write a reply…" className="flex-1 rounded-xl border border-border bg-muted/30 px-3 py-2 text-sm outline-none"/><button disabled={!text.trim()||sending} onClick={()=>void sendReply()} className="p-2 rounded-xl bg-primary text-primary-foreground disabled:opacity-40"><Send className="w-4 h-4"/></button></div>}
  <div>{loading?<div className="py-16 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-primary"/></div>:items.length===0?<div className="py-16 text-center text-muted-foreground">No {meta.title.toLowerCase()} yet.</div>:items.map((item:any)=><InteractionRow key={item.id} item={item} kind={kind} onOpenProfile={(u:string)=>u&&navigate('/profile/'+u)} onOpenPost={(id:string)=>navigate('/post/'+id)}/>)}</div>
 </div>
}

function InteractionRow({item,kind,onOpenProfile,onOpenPost}:{item:any;kind:Kind;onOpenProfile:(u:string)=>void;onOpenPost:(id:string)=>void}){
 const profile=item.profile??item.profiles??item.user_profiles??{}; const quote=item.quote; const username=profile.username??'user';
 return <div className="p-4 border-b border-border">
  <div className="flex gap-3"><button onClick={()=>onOpenProfile(username)}><img src={profile.avatar_url??''} className="w-10 h-10 rounded-full bg-muted object-cover"/></button><div className="min-w-0 flex-1">
   <button onClick={()=>onOpenProfile(username)} className="font-bold text-sm hover:underline">@{username}</button>
   {kind==='replies'&&<p className="mt-1 text-sm whitespace-pre-wrap break-words">{item.content}</p>}
   {kind==='quotes'&&<><p className="mt-1 text-sm whitespace-pre-wrap break-words">{item.content}</p><button onClick={()=>onOpenPost(item.id)} className="mt-2 w-full text-left rounded-xl border border-border p-3 text-xs text-muted-foreground">Quoted post</button></>}
   {kind==='quote-likes'&&<><p className="text-xs text-muted-foreground mt-1">liked a quote post</p>{quote?.content&&<button onClick={()=>onOpenPost(quote.id)} className="mt-2 w-full text-left rounded-xl border border-border p-3 text-sm">{quote.content}</button>}</>}
   {(kind==='likes'||kind==='reposts')&&<p className="text-xs text-muted-foreground mt-1">{kind==='likes'?'liked':'reposted'} this post</p>}
  </div></div>
 </div>
}
