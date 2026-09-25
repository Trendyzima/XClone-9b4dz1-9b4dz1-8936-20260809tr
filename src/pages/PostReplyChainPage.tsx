import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Loader2, Send } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { getReplyChain, createReply, type ReplyItem } from '@/features/replies/repliesService';
import { getInteractionCounts } from '@/services/postInteractionService';
import { ReplyActions } from '@/components/features/ReplyActions';
import { useAuth } from '@/hooks/useAuth';
import * as federation from '@/api/federation';
import { federatedObjectToPost, resolveFederatedReplies } from '@/features/federation/federatedPostAdapter';

export default function PostReplyChainPage(){
 const {postId,replyId}=useParams(); const navigate=useNavigate(); const {user}=useAuth();
 const [post,setPost]=useState<any>(null); const [replies,setReplies]=useState<ReplyItem[]>([]); const [counts,setCounts]=useState({likes:0,reposts:0,replies:0,quotes:0,views:0}); const [loading,setLoading]=useState(true); const [error,setError]=useState<string|null>(null); const [text,setText]=useState(''); const [replyingTo,setReplyingTo]=useState<string|undefined>(replyId);
 const load=async()=>{if(!postId||!replyId)return;setLoading(true);setError(null);try{
   if (/^https:\/\//i.test(postId)) {
     const remote = await federation.getFederatedObject(postId);
     const object = remote?.object ?? remote;
     const normalized = await federatedObjectToPost(object, federation.getFederatedObject);
     setPost(normalized);
     const remoteReplies = await resolveFederatedReplies(object.replies, federation.getFederatedObject);
     const items = remoteReplies.map((r:any)=>({id:String(r.id),content:String(r.content??r.name??r.summary??''),created_at:r.published??r.created??new Date().toISOString(),parent_reply_id:undefined,profile:{username:typeof r.attributedTo==='string'?r.attributedTo.split('/').filter(Boolean).pop()||'':String(r.attributedTo?.preferredUsername??r.attributedTo?.acct??'').replace(/^@/,''),display_name:typeof r.attributedTo==='object'?(r.attributedTo?.name??r.attributedTo?.displayName):undefined,avatar_url:typeof r.attributedTo==='object'?(r.attributedTo?.icon?.url??r.attributedTo?.icon):undefined}}));
     setReplies(items); setCounts({likes:Number(object.likes?.totalItems??0),reposts:Number(object.shares?.totalItems??0),replies:items.length||Number(object.replies?.totalItems??0),quotes:0,views:0});
     return;
   }
   const [p,r,c]=await Promise.all([
     supabase.from('posts').select('id,content,created_at,user_id,author_id,profiles!posts_author_id_fkey(id,username,display_name,avatar_url,cover_url,bio,website_url,location,verified_tier,follower_count,following_count,posts_count,account_type,visibility,creator_tier,is_creator,created_at)').eq('id',postId).maybeSingle(),
     getInteractionCounts(postId)
   ]);
   if(p.error)throw p.error;
   const localPost = p.data ? { ...p.data, user_profiles: p.data.profiles ?? null } : null;
   setPost(localPost); setCounts(c); const chainItems=await getReplyChain(replyId,200); if(!chainItems.some(item=>item.id===replyId))throw new Error('Reply not found or no longer visible'); setReplies(chainItems);
 }catch(e){console.error('[reply-chain]',e);setError(e instanceof Error?e.message:'Unable to load reply chain');setReplies([]);}finally{setLoading(false)}};
 useEffect(()=>{void load()},[postId,replyId]);
 const selected=replies.find(r=>r.id===replyId)||replies[0]; const selectedProfile=selected?.profile; const profileUsername=String(selectedProfile?.username||'').replace(/^@/,''); const profileName=String(selectedProfile?.display_name||selectedProfile?.full_name||selectedProfile?.username||'Profile'); const openProfile=()=>profileUsername&&navigate('/profile/'+profileUsername);
 const send=async()=>{if(!postId||!text.trim()||!user)return;try{await createReply(postId,text.trim(),replyingTo);setText('');await load()}catch(e){console.error(e)}};
 if(loading)return <div className="min-h-screen flex items-center justify-center"><Loader2 className="w-7 h-7 animate-spin text-primary"/></div>;

 return (
  <div className="min-h-screen bg-background pb-20">
   <header className="sticky top-0 z-20 bg-background/95 backdrop-blur border-b border-border px-4 py-3 flex items-center gap-3">
    <button onClick={()=>navigate(-1)} className="p-2 rounded-full hover:bg-muted"><ArrowLeft className="w-5 h-5"/></button>
    <div><h1 className="font-bold">Reply chain</h1><p className="text-xs text-muted-foreground">{counts.replies} replies · {counts.likes} likes · {counts.reposts} reposts · {counts.quotes} quotes</p></div>
   </header>

   {post ? (
    <button onClick={()=>navigate('/post/'+(post.is_federated ? encodeURIComponent(post.id) : post.id))} className="w-full text-left p-4 border-b border-border">
     <div className="flex items-center gap-2">
      <img src={post.profiles?.avatar_url||''} alt="" className="w-9 h-9 rounded-full bg-muted object-cover"/>
      <b>{post.profiles?.display_name||post.profiles?.full_name||post.profiles?.username||'Profile'}</b>
      {(post.profiles?.username||post.profiles?.preferredUsername) && <span className="text-muted-foreground ml-1">@{String(post.profiles?.username||post.profiles?.preferredUsername).replace(/^@/,'')}</span>}
     </div>
     <p className="mt-3 whitespace-pre-wrap">{post.content}</p>
     <div className="flex gap-4 mt-3 text-xs text-muted-foreground"><span>{counts.likes} likes</span><span>{counts.reposts} reposts</span><span>{counts.quotes} quotes</span><span>{counts.replies} replies</span></div>
    </button>
   ) : null}

   {selected ? (
    <section className="p-4 border-b border-border">
     <button onClick={openProfile} className="w-full text-left">
      {selectedProfile?.cover_url ? <img src={selectedProfile.cover_url} alt="" className="w-full h-28 rounded-2xl object-cover bg-muted"/> : null}
      <div className="flex items-end gap-3 relative">
       <div className="w-16 h-16 rounded-full border-4 border-background bg-muted overflow-hidden flex items-center justify-center shrink-0">
        {selectedProfile?.avatar_url ? <img src={selectedProfile.avatar_url} alt={profileName} className="w-full h-full object-cover"/> : <span className="text-xl font-bold">{profileName.slice(0,1).toUpperCase()}</span>}
       </div>
       <div className="pb-1 min-w-0"><h2 className="font-bold truncate">{profileName}</h2>{profileUsername && <p className="text-sm text-muted-foreground">@{profileUsername}</p>}</div>
      </div>
      {selectedProfile?.bio ? <p className="mt-3 text-sm whitespace-pre-wrap break-words">{selectedProfile.bio}</p> : null}
      <div className="flex flex-wrap gap-4 mt-3 text-xs text-muted-foreground">
       <span><b className="text-foreground">{Number(selectedProfile?.follower_count??0)}</b> followers</span>
       <span><b className="text-foreground">{Number(selectedProfile?.following_count??0)}</b> following</span>
       <span><b className="text-foreground">{Number(selectedProfile?.posts_count??0)}</b> posts</span>
      </div>
     </button>
    </section>
   ) : null}

   <main className="max-w-2xl mx-auto">
    {replies.length ? replies.map((r,i) => {
     const username=String(r.profile?.username||r.profile?.preferredUsername||r.profile?.acct||'').replace(/^@/,'');
     const name=r.profile?.display_name||r.profile?.full_name||r.profile?.name||username||'Profile';
     const openReplyProfile=()=>username&&navigate('/profile/'+username);
     return (
      <article key={r.id} className="relative px-5 py-4 border-b border-border">
       <div className="flex gap-3">
        <div className="shrink-0 flex flex-col items-center">
         <button onClick={openReplyProfile} className="w-9 h-9 rounded-full bg-muted overflow-hidden flex items-center justify-center">
          {r.profile?.avatar_url ? <img src={r.profile.avatar_url} alt={name} className="w-full h-full object-cover" loading="lazy"/> : <span className="text-xs font-bold text-muted-foreground">{String(name).slice(0,1).toUpperCase()}</span>}
         </button>
         {i<replies.length-1 ? <div className="w-px flex-1 bg-border mt-1"/> : null}
        </div>
        <div className="min-w-0 flex-1">
         <div className="text-sm">
          <button onClick={openReplyProfile} className="font-bold hover:underline">{name}</button>
          {username ? <span className="text-muted-foreground ml-1">@{username}</span> : null}
          <span className="text-muted-foreground ml-2">{new Date(r.created_at).toLocaleString()}</span>
         </div>
         <p className="mt-1 whitespace-pre-wrap break-words">{r.content}</p>
         <ReplyActions replyId={r.id} profileUsername={username} onOpenProfile={openReplyProfile} onReply={()=>setReplyingTo(r.id)}/>
        </div>
       </div>
      </article>
     );
    }) : (
     <div className="p-12 text-center text-muted-foreground">{error||'This reply is no longer visible.'}<button onClick={()=>void load()} className="block mx-auto mt-3 rounded-full border px-4 py-2 text-sm">Retry</button></div>
    )}
   </main>

   {user ? (
    <div className="fixed bottom-0 left-0 right-0 md:static md:max-w-2xl md:mx-auto bg-background/95 backdrop-blur border-t border-border p-3 flex gap-2">
     <input value={text} onChange={e=>setText(e.target.value)} placeholder={replyingTo?'Reply to this reply…':'Write a reply…'} className="flex-1 rounded-xl border border-border bg-muted/30 px-3 py-2 text-sm"/>
     <button disabled={!text.trim()} onClick={()=>void send()} className="p-2 rounded-xl bg-primary text-primary-foreground disabled:opacity-40"><Send className="w-4 h-4"/></button>
    </div>
   ) : null}
  </div>
 );
}