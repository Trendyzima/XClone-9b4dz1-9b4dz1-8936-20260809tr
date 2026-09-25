import { useEffect, useState } from 'react';
import { Heart, MessageCircle, Repeat2, Share2, Bookmark, Quote, MoreHorizontal, Copy } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { getReplyEngagement, toggleReplyLike, toggleReplyRepost, toggleReplyBookmark, recordReplyShare, toggleReplyReaction, createReplyQuote } from '@/features/replies/replyInteractionService';

type Props={replyId:string;onReply:()=>void;onOpenProfile?:()=>void;profileUsername?:string};
const REACTIONS=['❤️','😂','😮','😢','🔥'];

export function ReplyActions({replyId,onReply,onOpenProfile,profileUsername}:Props){
 const [e,setE]=useState({likes:0,reposts:0,bookmarks:0,shares:0,replies:0,quotes:0,reaction_total:0,is_liked:false,is_reposted:false,is_bookmarked:false,user_reactions:[] as string[]});
 const [busy,setBusy]=useState(false);
 const [more,setMore]=useState(false);
 useEffect(()=>{let live=true;getReplyEngagement(replyId).then(x=>{if(live)setE(x)}).catch(()=>{});return()=>{live=false}},[replyId]);
 const run=async(fn:()=>Promise<any>,key:'likes'|'reposts'|'bookmarks')=>{if(busy)return;setBusy(true);try{const r=await fn();setE(x=>({...x,[key]:r.count,...(key==='likes'?{is_liked:r.active}:key==='reposts'?{is_reposted:r.active}:{is_bookmarked:r.active})}))}catch(error){toast({title:'Action failed',description:error instanceof Error?error.message:'Please try again',variant:'destructive'})}finally{setBusy(false)}};
 const react=async(emoji:string)=>{if(busy)return;setBusy(true);try{const r=await toggleReplyReaction(replyId,emoji);setE(x=>({...x,reaction_total:Math.max(0,x.reaction_total+(r.active?1:-1)),user_reactions:r.active?[...x.user_reactions,emoji]:x.user_reactions.filter(v=>v!==emoji)}));}catch(error){toast({title:'Reaction failed',description:error instanceof Error?error.message:'Please try again',variant:'destructive'})}finally{setBusy(false)}};
 const share=async()=>{try{if(navigator.share)await navigator.share({text:'View this reply',url:window.location.href});else await navigator.clipboard.writeText(window.location.href);const count=await recordReplyShare(replyId);setE(x=>({...x,shares:count}));}catch(error){if(error instanceof DOMException&&error.name==='AbortError')return;toast({title:'Share failed',description:'Could not share this reply',variant:'destructive'})}};
 const quote=async()=>{const content=window.prompt('Add a quote to this reply','');if(content===null)return;setBusy(true);try{await createReplyQuote(replyId,content.trim());setE(x=>({...x,quotes:x.quotes+1}));toast({title:'Reply quoted'});}catch(error){toast({title:'Quote failed',description:error instanceof Error?error.message:'Could not quote this reply',variant:'destructive'})}finally{setBusy(false)}};
 const copy=()=>{navigator.clipboard.writeText(window.location.href).then(()=>toast({title:'Reply link copied'})).catch(()=>toast({title:'Copy failed',variant:'destructive'}));setMore(false)};
 return <div className="relative flex flex-wrap items-center gap-1 mt-2 text-muted-foreground">
  <button aria-label="Reply" onClick={onReply} className="inline-flex items-center gap-1 rounded-full px-2 py-1 hover:bg-muted"><MessageCircle className="w-4 h-4"/><span className="text-xs">{e.replies||''}</span></button>
  <button aria-label="Like reply" disabled={busy} onClick={()=>void run(()=>toggleReplyLike(replyId),'likes')} className={e.is_liked?'inline-flex items-center gap-1 rounded-full px-2 py-1 hover:bg-muted text-red-500':'inline-flex items-center gap-1 rounded-full px-2 py-1 hover:bg-muted'}><Heart className={e.is_liked?'w-4 h-4 fill-current':'w-4 h-4'}/><span className="text-xs">{e.likes||''}</span></button>
  <button aria-label="Repost reply" disabled={busy} onClick={()=>void run(()=>toggleReplyRepost(replyId),'reposts')} className={e.is_reposted?'inline-flex items-center gap-1 rounded-full px-2 py-1 hover:bg-muted text-green-500':'inline-flex items-center gap-1 rounded-full px-2 py-1 hover:bg-muted'}><Repeat2 className="w-4 h-4"/><span className="text-xs">{e.reposts||''}</span></button>
  <button aria-label="Quote reply" disabled={busy} onClick={()=>void quote()} className="inline-flex items-center gap-1 rounded-full px-2 py-1 hover:bg-muted"><Quote className="w-4 h-4"/><span className="text-xs">{e.quotes||''}</span></button>
  <button aria-label="Share reply" onClick={()=>void share()} className="inline-flex items-center gap-1 rounded-full px-2 py-1 hover:bg-muted"><Share2 className="w-4 h-4"/><span className="text-xs">{e.shares||''}</span></button>
  <button aria-label="Bookmark reply" disabled={busy} onClick={()=>void run(()=>toggleReplyBookmark(replyId),'bookmarks')} className={e.is_bookmarked?'inline-flex items-center gap-1 rounded-full px-2 py-1 hover:bg-muted text-primary':'inline-flex items-center gap-1 rounded-full px-2 py-1 hover:bg-muted'}><Bookmark className={e.is_bookmarked?'w-4 h-4 fill-current':'w-4 h-4'}/><span className="text-xs">{e.bookmarks||''}</span></button>
  <div className="flex items-center gap-0.5">{REACTIONS.map(emoji=><button key={emoji} aria-label={emoji+' reaction'} disabled={busy} onClick={()=>void react(emoji)} className={e.user_reactions.includes(emoji)?'rounded-full px-1 py-1 bg-muted text-sm':'rounded-full px-1 py-1 hover:bg-muted text-sm'}>{emoji}</button>)}{e.reaction_total>0&&<span className="text-xs ml-1">{e.reaction_total}</span>}</div>
  {onOpenProfile&&<button aria-label={profileUsername?'Open @'+profileUsername:'Open profile'} onClick={onOpenProfile} className="rounded-full p-1.5 hover:bg-muted">↗</button>}
  <button aria-label="More reply actions" onClick={()=>setMore(v=>!v)} className="rounded-full p-1.5 hover:bg-muted"><MoreHorizontal className="w-4 h-4"/></button>
  {more&&<div className="absolute right-0 top-9 z-30 min-w-40 rounded-xl border border-border bg-background shadow-lg p-1"><button onClick={copy} className="w-full text-left px-3 py-2 rounded-lg text-sm hover:bg-muted flex items-center gap-2"><Copy className="w-4 h-4"/>Copy link</button>{onOpenProfile&&<button onClick={()=>{setMore(false);onOpenProfile();}} className="w-full text-left px-3 py-2 rounded-lg text-sm hover:bg-muted">View profile</button>}</div>}
 </div>;
}
