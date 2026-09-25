import { useEffect, useState } from 'react';
import { Heart, MessageCircle, Repeat2, Share2, Bookmark } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { getReplyEngagement, toggleReplyLike, toggleReplyRepost, toggleReplyBookmark, recordReplyShare } from '@/features/replies/replyInteractionService';

export function ReplyActions({replyId,onReply}:{replyId:string;onReply:()=>void}){
 const [e,setE]=useState({likes:0,reposts:0,bookmarks:0,shares:0,replies:0,is_liked:false,is_reposted:false,is_bookmarked:false});
 const [busy,setBusy]=useState(false);
 useEffect(()=>{let live=true;getReplyEngagement(replyId).then(x=>{if(live)setE(x)}).catch(()=>{});return()=>{live=false}},[replyId]);
 const run=async(fn:()=>Promise<any>,key:'likes'|'reposts'|'bookmarks'|'shares')=>{if(busy)return;setBusy(true);try{const r=await fn();setE(x=>({...x,[key]:r.count,...(key==='likes'?{is_liked:r.active}:key==='reposts'?{is_reposted:r.active}:key==='bookmarks'?{is_bookmarked:r.active}: {})}))}catch(error){toast({title:'Action failed',description:error instanceof Error?error.message:'Please try again',variant:'destructive'})}finally{setBusy(false)}};
 const share=async()=>{try{if(navigator.share)await navigator.share({text:'View this reply',url:window.location.href});else await navigator.clipboard.writeText(window.location.href);const count=await recordReplyShare(replyId);setE(x=>({...x,shares:count}));}catch(error){if(error instanceof DOMException&&error.name==='AbortError')return;toast({title:'Share failed',description:'Could not share this reply',variant:'destructive'})}};
 return <div className="flex items-center gap-1 mt-2 text-muted-foreground">
  <button aria-label="Reply" onClick={onReply} className="inline-flex items-center gap-1 rounded-full px-2 py-1 hover:bg-muted"><MessageCircle className="w-4 h-4"/><span className="text-xs">{e.replies||''}</span></button>
  <button aria-label="Like reply" disabled={busy} onClick={()=>void run(()=>toggleReplyLike(replyId),'likes')} className={e.is_liked?'inline-flex items-center gap-1 rounded-full px-2 py-1 hover:bg-muted text-red-500':'inline-flex items-center gap-1 rounded-full px-2 py-1 hover:bg-muted'}><Heart className={e.is_liked?'w-4 h-4 fill-current':'w-4 h-4'}/><span className="text-xs">{e.likes||''}</span></button>
  <button aria-label="Repost reply" disabled={busy} onClick={()=>void run(()=>toggleReplyRepost(replyId),'reposts')} className={e.is_reposted?'inline-flex items-center gap-1 rounded-full px-2 py-1 hover:bg-muted text-green-500':'inline-flex items-center gap-1 rounded-full px-2 py-1 hover:bg-muted'}><Repeat2 className="w-4 h-4"/><span className="text-xs">{e.reposts||''}</span></button>
  <button aria-label="Share reply" onClick={()=>void share()} className="inline-flex items-center gap-1 rounded-full px-2 py-1 hover:bg-muted"><Share2 className="w-4 h-4"/><span className="text-xs">{e.shares||''}</span></button>
  <button aria-label="Bookmark reply" disabled={busy} onClick={()=>void run(()=>toggleReplyBookmark(replyId),'bookmarks')} className={e.is_bookmarked?'inline-flex items-center gap-1 rounded-full px-2 py-1 hover:bg-muted text-primary':'inline-flex items-center gap-1 rounded-full px-2 py-1 hover:bg-muted'}><Bookmark className={e.is_bookmarked?'w-4 h-4 fill-current':'w-4 h-4'}/><span className="text-xs">{e.bookmarks||''}</span></button>
 </div>;
}