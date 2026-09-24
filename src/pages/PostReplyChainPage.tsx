import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Loader2, MessageCircle, Send } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { listReplies, createReply, type ReplyItem } from '@/features/replies/repliesService';
import { getInteractionCounts } from '@/services/postInteractionService';
import { useAuth } from '@/hooks/useAuth';

export default function PostReplyChainPage(){
 const {postId,replyId}=useParams(); const navigate=useNavigate(); const {user}=useAuth();
 const [post,setPost]=useState<any>(null); const [replies,setReplies]=useState<ReplyItem[]>([]); const [counts,setCounts]=useState({likes:0,reposts:0,replies:0,quotes:0,views:0}); const [loading,setLoading]=useState(true); const [text,setText]=useState(''); const [replyingTo,setReplyingTo]=useState<string|undefined>(replyId);
 const load=async()=>{if(!postId)return;setLoading(true);try{
   const [p,r,c]=await Promise.all([
     supabase.from('posts').select('id,content,created_at,user_id,author_id,profiles!posts_author_id_fkey(id,username,display_name,avatar_url,verified)').eq('id',postId).maybeSingle(),
     listReplies(postId,100),
     getInteractionCounts(postId)
   ]);
   if(p.error)throw p.error; setPost(p.data); setReplies(r.items); setCounts(c);
 }finally{setLoading(false)}};
 useEffect(()=>{void load()},[postId]);
 const byId=useMemo(()=>new Map(replies.map(r=>[r.id,r])),[replies]);
 const chain=useMemo(()=>{const selected=byId.get(replyId||''); if(!selected)return replies.slice(-1,0); const path:ReplyItem[]=[]; const seen=new Set<string>(); let cur:ReplyItem|undefined=selected; while(cur&&!seen.has(cur.id)){path.unshift(cur);seen.add(cur.id);cur=cur.parent_reply_id?byId.get(cur.parent_reply_id):undefined;} const children=replies.filter(r=>r.parent_reply_id===selected.id).sort((a,b)=>a.created_at.localeCompare(b.created_at)); return [...path,...children]},[replies,replyId,byId]);
 const send=async()=>{if(!postId||!text.trim()||!user)return;try{await createReply(postId,text.trim(),replyingTo);setText('');await load()}catch(e){console.error(e)}};
 if(loading)return <div className="min-h-screen flex items-center justify-center"><Loader2 className="w-7 h-7 animate-spin text-primary"/></div>;
 return <div className="min-h-screen bg-background pb-20">
  <header className="sticky top-0 z-20 bg-background/95 backdrop-blur border-b border-border px-4 py-3 flex items-center gap-3"><button onClick={()=>navigate(-1)} className="p-2 rounded-full hover:bg-muted"><ArrowLeft className="w-5 h-5"/></button><div><h1 className="font-bold">Reply chain</h1><p className="text-xs text-muted-foreground">{counts.replies} replies · {counts.likes} likes · {counts.reposts} reposts · {counts.quotes} quotes</p></div></header>
  {post&&<button onClick={()=>navigate('/post/'+post.id)} className="w-full text-left p-4 border-b border-border"><div className="flex items-center gap-2"><img src={post.profiles?.avatar_url||''} alt="" className="w-9 h-9 rounded-full bg-muted object-cover"/><b>@{post.profiles?.username??'user'}</b></div><p className="mt-3 whitespace-pre-wrap">{post.content}</p><div className="flex gap-4 mt-3 text-xs text-muted-foreground"><span>{counts.likes} likes</span><span>{counts.reposts} reposts</span><span>{counts.quotes} quotes</span><span>{counts.replies} replies</span></div></button>}
  <main className="max-w-2xl mx-auto">{chain.length?chain.map((r,i)=><article key={r.id} className="relative px-5 py-4 border-b border-border"><div className="flex gap-3"><div className="shrink-0 flex flex-col items-center"><div className="w-9 h-9 rounded-full bg-muted overflow-hidden">{r.profile?.avatar_url&&<img src={r.profile.avatar_url} alt="" className="w-full h-full object-cover"/>}</div>{i<chain.length-1&&<div className="w-px flex-1 bg-border mt-1"/>}</div><div className="min-w-0 flex-1"><div className="text-sm"><b>@{r.profile?.username??'user'}</b><span className="text-muted-foreground ml-2">{new Date(r.created_at).toLocaleString()}</span></div><p className="mt-1 whitespace-pre-wrap break-words">{r.content}</p><button onClick={()=>setReplyingTo(r.id)} className="mt-2 text-xs text-primary inline-flex items-center gap-1"><MessageCircle className="w-3.5 h-3.5"/>Reply in this chain</button></div></div></article>):<div className="p-12 text-center text-muted-foreground">This reply is no longer visible.</div>}</main>
  {user&&<div className="fixed bottom-0 left-0 right-0 md:static md:max-w-2xl md:mx-auto bg-background/95 backdrop-blur border-t border-border p-3 flex gap-2"><input value={text} onChange={e=>setText(e.target.value)} placeholder={replyingTo?'Reply to this reply…':'Write a reply…'} className="flex-1 rounded-xl border border-border bg-muted/30 px-3 py-2 text-sm"/><button disabled={!text.trim()} onClick={()=>void send()} className="p-2 rounded-xl bg-primary text-primary-foreground disabled:opacity-40"><Send className="w-4 h-4"/></button></div>}
 </div>;
}