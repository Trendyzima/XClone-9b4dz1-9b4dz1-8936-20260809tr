import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bookmark, Check, Heart, Image as ImageIcon, Loader2, MessageCircle, MoreHorizontal, Plus, Repeat2, Search, Quote, Sparkles, UserPlus, X } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { TopBar } from '@/components/layout/TopBar';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { formatNumber } from '@/lib/utils';
import { useSEO } from '@/hooks/useSEO';
import { toast } from 'sonner';

type Tab = 'For you' | 'Following' | 'Saved';
type Profile = { id:string; username:string; avatar_url:string|null; verified:boolean; display_name?:string|null };
type Thread = { id:string; owner_id:string; body:string; visibility:string; created_at:string; likes_count:number; reposts_count:number; quotes_count:number; replies_count:number; views_count:number; media_urls:string[]; profiles?:Profile };
const TABS:Tab[]=['For you','Following','Saved'];

function Avatar({profile}:{profile?:Profile}) {
  const initial=(profile?.display_name||profile?.username||'?').slice(0,1).toUpperCase();
  return <div className="h-10 w-10 shrink-0 overflow-hidden rounded-full bg-muted flex items-center justify-center text-sm font-bold">{profile?.avatar_url?<img src={profile.avatar_url} alt="" className="h-full w-full object-cover"/>:initial}</div>;
}

function ThreadCard({thread,liked,reposted,bookmarked,onLike,onRepost,onBookmark}:{thread:Thread;liked:boolean;reposted:boolean;bookmarked:boolean;onLike:()=>void;onRepost:()=>void;onBookmark:()=>void}) {
  const navigate=useNavigate(); const profile=thread.profiles; const open=()=>navigate(`/thread/${thread.id}`);
  return <article className="px-4 py-4 transition-colors hover:bg-muted/20">
    <div className="flex gap-3">
      <button onClick={()=>navigate(`/profile/${profile?.username||''}`)}><Avatar profile={profile}/></button>
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          <button onClick={()=>navigate(`/profile/${profile?.username||''}`)} className="min-w-0 text-left">
            <div className="flex items-center gap-1.5"><span className="truncate font-semibold text-[15px]">{profile?.display_name||profile?.username||'Testagram user'}</span>{profile?.verified&&<Check className="h-3.5 w-3.5 rounded-full bg-primary p-0.5 text-primary-foreground"/>}</div>
            <span className="text-xs text-muted-foreground">@{profile?.username||'user'}</span>
          </button>
          <span className="pt-0.5 text-xs text-muted-foreground">· {formatDistanceToNow(new Date(thread.created_at),{addSuffix:true})}</span>
          <button className="ml-auto rounded-full p-1.5 text-muted-foreground hover:bg-muted" aria-label="More"><MoreHorizontal className="h-4 w-4"/></button>
        </div>
        <button onClick={open} className="mt-2 block w-full text-left">
          <p className="whitespace-pre-wrap break-words text-[15px] leading-6">{thread.body}</p>
          {thread.media_urls?.length>0&&<div className={`mt-3 grid gap-1.5 overflow-hidden rounded-2xl border border-border ${thread.media_urls.length>1?'grid-cols-2':'grid-cols-1'}`}>{thread.media_urls.slice(0,4).map(url=><img key={url} src={url} alt="" loading="lazy" className="max-h-[420px] w-full object-cover"/>)}</div>}
        </button>
        <div className="mt-3 flex max-w-[520px] items-center justify-between text-muted-foreground">
          <button onClick={open} className="flex items-center gap-1.5 rounded-full p-1.5 hover:text-primary"><MessageCircle className="h-[18px] w-[18px]"/>{thread.replies_count>0&&<span className="text-xs">{formatNumber(thread.replies_count)}</span>}</button>
          <button onClick={onRepost} className={`flex items-center gap-1.5 rounded-full p-1.5 ${reposted?'text-green-600':'hover:text-green-600'}`}><Repeat2 className="h-[18px] w-[18px]"/>{thread.reposts_count>0&&<span className="text-xs">{formatNumber(thread.reposts_count)}</span>}</button>
          <button onClick={onLike} className={`flex items-center gap-1.5 rounded-full p-1.5 ${liked?'text-pink-600':'hover:text-pink-600'}`}><Heart className={`h-[18px] w-[18px] ${liked?'fill-current':''}`}/>{thread.likes_count>0&&<span className="text-xs">{formatNumber(thread.likes_count)}</span>}</button>
          <button onClick={open} className="flex items-center gap-1 rounded-full p-1.5 hover:text-primary" aria-label="Quote"><Quote className="h-[17px] w-[17px]"/>{thread.quotes_count>0&&<span className="text-xs">{formatNumber(thread.quotes_count)}</span>}</button>
          <button onClick={onBookmark} className={`rounded-full p-1.5 ${bookmarked?'text-primary':'hover:text-primary'}`}><Bookmark className={`h-[18px] w-[18px] ${bookmarked?'fill-current':''}`}/></button>
        </div>
      </div>
    </div>
  </article>;
}

export default function ThreadsPage() {
  const {user}=useAuth(); const navigate=useNavigate();
  const [tab,setTab]=useState<Tab>('For you'); const [threads,setThreads]=useState<Thread[]>([]);
  const [liked,setLiked]=useState<Set<string>>(new Set()); const [reposted,setReposted]=useState<Set<string>>(new Set()); const [bookmarked,setBookmarked]=useState<Set<string>>(new Set());
  const [loading,setLoading]=useState(true); const [refreshing,setRefreshing]=useState(false); const [search,setSearch]=useState('');

  useSEO({title:'Threads — Testagram',description:'Join conversations on Testagram. Share thoughts, reply, repost and discover people you follow.',url:'/threads',type:'website',keywords:'threads, conversations, social, Testagram'});

  const loadThreads=useCallback(async()=>{
    setRefreshing(true);
    try{
      let ids:string[]|null=null;
      if(tab==='Following'){
        if(!user){setThreads([]);return;}
        const {data}=await supabase.from('follows').select('following_id').eq('follower_id',user.id).limit(500);
        ids=(data??[]).map((r:any)=>r.following_id).filter(Boolean); if(!ids.length){setThreads([]);return;}
      }
      if(tab==='Saved'){
        if(!user){setThreads([]);return;}
        const {data}=await supabase.from('thread_bookmarks').select('thread_id').eq('user_id',user.id).order('created_at',{ascending:false}).limit(100);
        ids=(data??[]).map((r:any)=>r.thread_id).filter(Boolean); if(!ids.length){setThreads([]);return;}
      }
      let query=supabase.from('threads').select('id, owner_id, body, visibility, created_at, likes_count, reposts_count, quotes_count, replies_count, views_count, media_urls').eq('visibility','public').is('deleted_at',null).order('created_at',{ascending:false}).limit(60);
      if(tab==='Following'&&ids)query=query.in('owner_id',ids);
      if(tab==='Saved'&&ids)query=query.in('id',ids);
      const {data,error}=await query; if(error)throw error;
      const rows=(data??[]) as Thread[]; const ownerIds=[...new Set(rows.map(r=>r.owner_id))];
      const profiles:Profile[]=ownerIds.length?(((await supabase.from('profiles').select('id, username, avatar_url, verified, display_name').in('id',ownerIds)).data ?? []) as Profile[]):[];
      const byId=new Map(profiles.map((p:any)=>[p.id,p]));
      setThreads(rows.map(r=>({...r,media_urls:Array.isArray(r.media_urls)?r.media_urls:[],profiles:byId.get(r.owner_id)})));
      if(user&&rows.length){
        const ids2=rows.map(r=>r.id);
        const [l,r,b]=await Promise.all([
          supabase.from('thread_likes').select('thread_id').eq('user_id',user.id).in('thread_id',ids2),
          supabase.from('thread_reposts').select('thread_id').eq('user_id',user.id).in('thread_id',ids2),
          supabase.from('thread_bookmarks').select('thread_id').eq('user_id',user.id).in('thread_id',ids2)
        ]);
        setLiked(new Set((l.data??[]).map((x:any)=>x.thread_id))); setReposted(new Set((r.data??[]).map((x:any)=>x.thread_id))); setBookmarked(new Set((b.data??[]).map((x:any)=>x.thread_id)));
      }
    }catch(error){console.error('Threads feed error',error);toast.error('Could not load Threads');}
    finally{setLoading(false);setRefreshing(false);}
  },[tab,user?.id]);

  useEffect(()=>{void loadThreads();},[loadThreads]);

  const mutate=(setter:React.Dispatch<React.SetStateAction<Set<string>>>,id:string,active:boolean)=>setter(prev=>{const n=new Set(prev);active?n.add(id):n.delete(id);return n;});
  const toggleLike=async(thread:Thread)=>{if(!user){navigate('/auth');return;}const active=!liked.has(thread.id);mutate(setLiked,thread.id,active);setThreads(p=>p.map(t=>t.id===thread.id?{...t,likes_count:Math.max(0,t.likes_count+(active?1:-1))}:t));const res=active?await supabase.from('thread_likes').insert({thread_id:thread.id,user_id:user.id}):await supabase.from('thread_likes').delete().eq('thread_id',thread.id).eq('user_id',user.id);if(res.error){mutate(setLiked,thread.id,!active);setThreads(p=>p.map(t=>t.id===thread.id?{...t,likes_count:Math.max(0,t.likes_count+(active?-1:1))}:t));toast.error('Like failed');}};
  const toggleRepost=async(thread:Thread)=>{if(!user){navigate('/auth');return;}const active=!reposted.has(thread.id);mutate(setReposted,thread.id,active);setThreads(p=>p.map(t=>t.id===thread.id?{...t,reposts_count:Math.max(0,t.reposts_count+(active?1:-1))}:t));const res=active?await supabase.from('thread_reposts').insert({thread_id:thread.id,user_id:user.id}):await supabase.from('thread_reposts').delete().eq('thread_id',thread.id).eq('user_id',user.id);if(res.error){mutate(setReposted,thread.id,!active);setThreads(p=>p.map(t=>t.id===thread.id?{...t,reposts_count:Math.max(0,t.reposts_count+(active?-1:1))}:t));toast.error('Repost failed');}};
  const toggleBookmark=async(thread:Thread)=>{if(!user){navigate('/auth');return;}const active=!bookmarked.has(thread.id);mutate(setBookmarked,thread.id,active);const res=active?await supabase.from('thread_bookmarks').insert({thread_id:thread.id,user_id:user.id}):await supabase.from('thread_bookmarks').delete().eq('thread_id',thread.id).eq('user_id',user.id);if(res.error){mutate(setBookmarked,thread.id,!active);toast.error('Bookmark failed');}else toast.success(active?'Saved to your reading list':'Removed from saved');};

  const visible=useMemo(()=>{const q=search.trim().toLowerCase();return q?threads.filter(t=>(t.body||'').toLowerCase().includes(q)||(t.profiles?.username||'').toLowerCase().includes(q)):threads;},[threads,search]);

  return <div className="min-h-screen bg-background pb-20 md:pb-0">
    <TopBar title="Threads"/>
    <div className="border-b border-border bg-background/95 backdrop-blur-xl">
      <div className="flex items-center justify-between px-3">
        <div className="flex min-w-0 flex-1">{TABS.map(item=><button key={item} onClick={()=>setTab(item)} className={`relative flex-1 px-3 py-4 text-sm font-semibold ${tab===item?'text-foreground':'text-muted-foreground hover:text-foreground'}`}>{item}{tab===item&&<span className="absolute inset-x-8 bottom-0 h-1 rounded-full bg-foreground"/>}</button>)}</div>
        <div className="flex items-center gap-1"><button onClick={()=>setSearch(v=>v?'':' ')} className="rounded-full p-2 hover:bg-muted" aria-label="Search threads"><Search className="h-4 w-4"/></button><button onClick={()=>void loadThreads()} className="rounded-full p-2 hover:bg-muted" aria-label="Refresh">{refreshing?<Loader2 className="h-4 w-4 animate-spin"/>:<Sparkles className="h-4 w-4"/>}</button></div>
      </div>
      {search!==''&&<div className="px-4 pb-3"><div className="flex items-center gap-2 rounded-2xl bg-muted/60 px-3 py-2"><Search className="h-4 w-4 text-muted-foreground"/><input autoFocus value={search.trim()} onChange={e=>setSearch(e.target.value)} placeholder="Search Threads" className="min-w-0 flex-1 bg-transparent text-sm outline-none"/><button onClick={()=>setSearch('')}><X className="h-4 w-4 text-muted-foreground"/></button></div></div>}
    </div>
    {user&&<button onClick={()=>navigate('/threads/create')} className="flex w-full gap-3 border-b border-border px-4 py-4 text-left hover:bg-muted/20"><Avatar profile={{id:user.id,username:user.username,avatar_url:user.avatar,verified:false}}/><div className="flex-1"><p className="text-[15px] text-muted-foreground">What's new, @{user.username}?</p><div className="mt-3 flex items-center justify-between"><div className="flex items-center gap-3 text-primary"><ImageIcon className="h-5 w-5"/><span className="text-xs text-muted-foreground">Share a thought, photo or link</span></div><span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-bold text-primary">Post</span></div></div></button>}
    <div className="divide-y divide-border">
      {loading?<div className="flex justify-center py-20"><Loader2 className="h-7 w-7 animate-spin text-primary"/></div>:visible.length===0?<div className="px-6 py-20 text-center"><div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-muted"><MessageCircle className="h-6 w-6 text-muted-foreground"/></div><h2 className="font-bold">{tab==='Following'?'Follow people to fill your feed':tab==='Saved'?'Your saved threads will appear here':'Start the conversation'}</h2><p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">{tab==='Following'?'Discover creators and follow people whose conversations you want to see.':tab==='Saved'?'Tap the bookmark on any thread to keep it for later.':'Share a thought and give the community something to respond to.'}</p>{tab==='Following'&&<Button onClick={()=>navigate('/discover')} className="mt-5 rounded-full"><UserPlus className="mr-2 h-4 w-4"/>Discover people</Button>}{tab==='For you'&&user&&<Button onClick={()=>navigate('/threads/create')} className="mt-5 rounded-full"><Plus className="mr-2 h-4 w-4"/>Create a thread</Button>}</div>:visible.map(thread=><ThreadCard key={thread.id} thread={thread} liked={liked.has(thread.id)} reposted={reposted.has(thread.id)} bookmarked={bookmarked.has(thread.id)} onLike={()=>void toggleLike(thread)} onRepost={()=>void toggleRepost(thread)} onBookmark={()=>void toggleBookmark(thread)}/>)}
    </div>
  </div>;
}
