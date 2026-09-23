import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Heart, Loader2, MessageCircle, Quote, Repeat2, Send } from 'lucide-react';
import { TopBar } from '@/components/layout/TopBar';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import { listThreadLikes, toggleThreadLike } from '@/features/threadLikes/threadLikesService';
import { listThreadReposts, toggleThreadRepost } from '@/features/threadReposts/threadRepostsService';
import { listThreadQuotes, createThreadQuote } from '@/features/threadQuotes/threadQuotesService';
import { listThreadReplies, createThreadReply } from '@/features/threadReplies/threadRepliesService';
import { listThreadQuoteLikes, toggleThreadQuoteLike } from '@/features/threadQuoteLikes/threadQuoteLikesService';
import { listThreadReplyLikes, toggleThreadReplyLike } from '@/features/threadReplyLikes/threadReplyLikesService';
import { toast } from 'sonner';

type Mode='likes'|'reposts'|'replies'|'quotes'|'quote-likes'|'reply-likes';
function Avatar({p}:{p:any}){return <div className="h-10 w-10 shrink-0 overflow-hidden rounded-full bg-muted flex items-center justify-center font-bold">{p?.avatar_url?<img src={p.avatar_url} alt="" className="h-full w-full object-cover"/>:(p?.display_name||p?.username||'?').slice(0,1).toUpperCase()}</div>}

export default function ThreadInteractionPage(){
 const {threadId,quoteId,replyId}=useParams(); const {user}=useAuth(); const navigate=useNavigate();
 const mode=(window.location.pathname.includes('/quote-likes')?'quote-likes':window.location.pathname.includes('/reply-likes')?'reply-likes':window.location.pathname.split('/').includes('reposts')?'reposts':window.location.pathname.split('/').includes('quotes')?'quotes':window.location.pathname.split('/').includes('replies')?'replies':'likes') as Mode;
 const [thread,setThread]=useState<any>(null); const [items,setItems]=useState<any[]>([]); const [loading,setLoading]=useState(true); const [sending,setSending]=useState(false); const [text,setText]=useState('');
 const load=useCallback(async()=>{setLoading(true);try{
   if(threadId){const {data,error}=await supabase.from('threads').select('id,owner_id,body,created_at,likes_count,reposts_count,quotes_count,replies_count').eq('id',threadId).is('deleted_at',null).single();if(error)throw error;setThread(data);}
   if(mode==='likes'&&threadId)setItems(await listThreadLikes(threadId));
   else if(mode==='reposts'&&threadId)setItems(await listThreadReposts(threadId));
   else if(mode==='quotes'&&threadId)setItems(await listThreadQuotes(threadId));
   else if(mode==='replies'&&threadId)setItems(await listThreadReplies(threadId));
   else if(mode==='quote-likes'&&quoteId)setItems(await listThreadQuoteLikes(quoteId));
   else if(mode==='reply-likes'&&replyId)setItems(await listThreadReplyLikes(replyId));
 }catch(e){console.error('[ThreadInteraction]',e);toast.error('Could not load this interaction');}finally{setLoading(false);}},[threadId,quoteId,replyId,mode]);
 useEffect(()=>{void load();},[load]);
 const requireAuth=()=>{if(!user){navigate('/auth');return false;}return true};
 const submit=async()=>{if(!requireAuth()||!text.trim()||!threadId)return;setSending(true);try{if(mode==='replies')await createThreadReply(threadId,user!.id,text);else if(mode==='quotes')await createThreadQuote(threadId,user!.id,text);else return;setText('');toast.success(mode==='replies'?'Reply posted':'Quote posted');await load();}catch(e:any){toast.error(e?.message||'Action failed');}finally{setSending(false);}};
 const toggle=async(item:any)=>{if(!requireAuth())return;try{
   if(mode==='likes'&&threadId)await toggleThreadLike(threadId,user!.id);
   else if(mode==='reposts'&&threadId)await toggleThreadRepost(threadId,user!.id);
   else if(mode==='quote-likes'&&quoteId)await toggleThreadQuoteLike(quoteId,user!.id);
   else if(mode==='reply-likes'&&replyId)await toggleThreadReplyLike(replyId,user!.id);
   await load();
 }catch(e:any){toast.error(e?.message||'Reaction failed');}};
 const title=mode==='likes'?'Likes':mode==='reposts'?'Reposts & Retweets':mode==='replies'?'Replies':mode==='quotes'?'Quotes':mode==='quote-likes'?'Quote likes':'Reply likes';
 const icon=mode==='likes'?<Heart className="h-5 w-5"/>:mode==='reposts'?<Repeat2 className="h-5 w-5"/>:mode==='quotes'?<Quote className="h-5 w-5"/>:<MessageCircle className="h-5 w-5"/>;
 return <div className="min-h-screen bg-background pb-20 md:pb-0"><TopBar title={title} showBack/>
   {thread&&<button onClick={()=>navigate('/thread/'+thread.id)} className="w-full border-b border-border px-4 py-4 text-left hover:bg-muted/20"><div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground"><ArrowLeft className="h-3.5 w-3.5"/>Thread</div><p className="line-clamp-3 text-sm leading-6">{thread.body}</p></button>}
   {loading?<div className="flex justify-center py-20"><Loader2 className="h-7 w-7 animate-spin text-primary"/></div>:<div className="divide-y divide-border">
    {mode==='replies'||mode==='quotes'?<div className="border-b border-border p-4"><Textarea value={text} onChange={e=>setText(e.target.value.slice(0,500))} placeholder={mode==='replies'?'Continue this conversation…':'Add your thought to this quote…'} className="min-h-24 resize-none"/><div className="mt-3 flex justify-end"><Button onClick={()=>void submit()} disabled={sending||!text.trim()} className="rounded-full">{sending?<Loader2 className="mr-2 h-4 w-4 animate-spin"/>:<Send className="mr-2 h-4 w-4"/>}{mode==='replies'?'Reply':'Quote'}</Button></div></div>:null}
    {items.length===0?<div className="px-6 py-20 text-center text-sm text-muted-foreground">{icon}<p className="mt-3">No {title.toLowerCase()} yet.</p></div>:items.map((item:any)=><article key={item.id} className="flex gap-3 px-4 py-4"><Avatar p={item.profile}/><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><span className="font-semibold">{item.profile?.display_name||item.profile?.username||'Testagram user'}</span><span className="text-xs text-muted-foreground">@{item.profile?.username||'user'}</span></div>{item.content&&<p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6">{item.content}</p>}{(mode==='quote-likes'||mode==='reply-likes')&&<button onClick={()=>void toggle(item)} className="mt-2 rounded-full px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-pink-600"><Heart className="mr-1 inline h-3.5 w-3.5"/>Like</button>}</div></article>)}
   </div>}
 </div>;
}