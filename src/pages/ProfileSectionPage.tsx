import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { PostCard } from '@/components/features/PostCard';
import { VerifiedTick } from '@/components/ui/VerifiedTick';
import { Loader2, Play, RefreshCw } from 'lucide-react';
import { listProfileLikes } from '@/features/likes/likesService';
import { listProfileRepliesPage } from '@/features/replies/repliesService';

type Section = 'posts'|'threads'|'replies'|'media'|'videos'|'likes'|'followers'|'following';
const labels: Record<Section,string> = {posts:'Posts',threads:'Threads',replies:'Replies',media:'Media',videos:'Videos',likes:'Likes',followers:'Followers',following:'Following'};
const getSection=(p:string):Section=>{const s=p.split('/').filter(Boolean).pop()?.toLowerCase() as Section;return s&&s in labels?s:'posts';};

export default function ProfileSectionPage({section: sectionProp}: {section?: Section}){
  const {username}=useParams(); const location=useLocation(); const navigate=useNavigate();
  const pathSection=useMemo(()=>getSection(location.pathname),[location.pathname]);
  const section=sectionProp ?? pathSection;
  const [profile,setProfile]=useState<any>(null); const [items,setItems]=useState<any[]>([]);
  const [loading,setLoading]=useState(true); const [loadingMore,setLoadingMore]=useState(false); const [error,setError]=useState<string|null>(null); const [retryKey,setRetryKey]=useState(0); const [nextCursor,setNextCursor]=useState<string|null>(null); const loadMoreRef=useRef<HTMLDivElement|null>(null);

  useEffect(()=>{let cancelled=false; (async()=>{
    setLoading(true);setError(null);
    const p=await supabase.from('profiles').select('*').eq('username',username??'').maybeSingle();
    if(cancelled)return;
    if(p.error||!p.data){setError('Profile not found');setLoading(false);return;}
    setProfile(p.data);
    try{
      let rows:any[]=[];
      if(section==='posts'||section==='videos'){const q=await supabase.from('posts').select('*').or(`author_id.eq.${p.data.id},user_id.eq.${p.data.id}`).is('deleted_at',null).order('created_at',{ascending:false}).limit(100);if(q.error)throw q.error;rows=(q.data??[]).map((row:any)=>({...row,author_id:row.author_id??row.user_id,profiles:p.data}));if(section==='videos')rows=rows.filter((x:any)=>x.is_video&&x.video_url);}
      else if(section==='threads'){const q=await supabase.from('threads').select('*').eq('owner_id',p.data.id).is('deleted_at',null).order('created_at',{ascending:false}).limit(100);if(q.error)throw q.error;rows=q.data??[];}
      else if(section==='replies'){const first=await listProfileRepliesPage(p.data.id,20);rows=first.items;setNextCursor(first.next_cursor);}
      else if(section==='likes'){rows=await listProfileLikes(p.data.id,100);}
      else if(section==='media'){const q=await supabase.from('posts').select('*').or(`author_id.eq.${p.data.id},user_id.eq.${p.data.id}`).is('deleted_at',null).or('image_url.not.is.null,video_url.not.is.null,media_count.gt.0').order('created_at',{ascending:false}).limit(100);if(q.error)throw q.error;rows=(q.data??[]).map((row:any)=>({...row,author_id:row.author_id??row.user_id,profiles:p.data}));}
      else if(section==='followers'){const q=await supabase.from('follows').select('follower_id').eq('following_id',p.data.id).eq('status','accepted').limit(100);if(q.error)throw q.error;const ids=(q.data??[]).map((x:any)=>x.follower_id).filter(Boolean);if(ids.length){const pr=await supabase.from('profiles').select('*').in('id',ids);if(pr.error)throw pr.error;rows=pr.data??[];}}
      else {const q=await supabase.from('follows').select('following_id').eq('follower_id',p.data.id).eq('status','accepted').limit(100);if(q.error)throw q.error;const ids=(q.data??[]).map((x:any)=>x.following_id).filter(Boolean);if(ids.length){const pr=await supabase.from('profiles').select('*').in('id',ids);if(pr.error)throw pr.error;rows=pr.data??[];}}
      if(!cancelled){setItems(rows);setLoading(false);}
    }catch(e){if(!cancelled){setError(e instanceof Error?e.message:'Unable to load this section');setItems([]);setLoading(false);}}
  })();return()=>{cancelled=true}},[username,section,retryKey]);

  if(loading)return <div className="min-h-screen flex items-center justify-center"><Loader2 className="w-7 h-7 animate-spin text-primary"/></div>;
  const loadMoreReplies=useCallback(async()=>{
    if(section!=='replies'||!profile?.id||!nextCursor||loadingMore)return;
    setLoadingMore(true);
    try{const page=await listProfileRepliesPage(profile.id,20,nextCursor);setItems(prev=>[...prev,...page.items]);setNextCursor(page.next_cursor);}
    catch(e){setError(e instanceof Error?e.message:'Unable to load more replies');}
    finally{setLoadingMore(false);}
  },[section,profile?.id,nextCursor,loadingMore]);
  useEffect(()=>{if(section!=='replies'||!nextCursor||!loadMoreRef.current)return;const el=loadMoreRef.current;const observer=new IntersectionObserver(entries=>{if(entries[0]?.isIntersecting)void loadMoreReplies()},{rootMargin:'500px'});observer.observe(el);return()=>observer.disconnect();},[section,nextCursor,loadMoreReplies]);

  if(!profile)return <div className="p-8 text-center text-muted-foreground">{error??'Profile not found'}</div>;
  const base='/profile/'+encodeURIComponent(profile.username);
  return <div className="min-h-screen">
    <header className="border-b border-border p-4">
      <button onClick={()=>navigate(base)} className="flex gap-3 items-center text-left">
        <div className="w-12 h-12 rounded-full overflow-hidden bg-muted">{profile.avatar_url?<img src={profile.avatar_url} alt="" className="w-full h-full object-cover"/>:<div className="w-full h-full flex items-center justify-center font-bold">{profile.username?.[0]?.toUpperCase()}</div>}</div>
        <div><div className="flex items-center gap-1 font-bold">@{profile.username}{profile.verified&&<VerifiedTick className="w-4 h-4 text-primary"/>}</div><p className="text-xs text-muted-foreground">{(profile.follower_count??0).toLocaleString()} followers · {(profile.following_count??0).toLocaleString()} following</p></div>
      </button>
      <nav className="flex gap-1 overflow-x-auto mt-4 scrollbar-hide">{(Object.keys(labels) as Section[]).map(k=><button key={k} onClick={()=>navigate(base+'/'+k)} className={`shrink-0 px-3 py-2 rounded-full text-xs font-semibold ${k===section?'bg-primary text-primary-foreground':'text-muted-foreground hover:bg-muted'}`}>{labels[k]}</button>)}</nav>
    </header>
    {error&&<div className="p-3 border-b border-border flex items-center justify-between gap-3"><span className="text-sm text-destructive">{error}</span><button onClick={()=>setRetryKey(x=>x+1)} className="shrink-0 inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold"><RefreshCw className="w-3.5 h-3.5"/>Retry</button></div>}
    {!items.length?<div className="p-12 text-center text-muted-foreground">No {labels[section].toLowerCase()} yet.</div>:
      section==='posts'||section==='likes'?<div>{items.map(p=><PostCard key={p.id} post={p} onUpdate={()=>{}}/>)}</div>:
      section==='media'?<div className="grid grid-cols-2 md:grid-cols-3 gap-2 p-2">{items.map(p=>{const u=p.video_url||p.image_url||p.media_urls?.[0];return <button key={p.id} onClick={()=>navigate('/post/'+p.id)} className="aspect-square rounded-lg overflow-hidden bg-muted"><img src={u} alt="" className="w-full h-full object-cover"/></button>})}</div>:
      section==='videos'?<div className="grid grid-cols-2 gap-2 p-3">{items.map(p=><button key={p.id} onClick={()=>navigate('/videos?id='+p.id)} className="relative aspect-[9/16] rounded-xl overflow-hidden bg-black"><video src={p.video_url+'#t=0.5'} muted preload="metadata" className="w-full h-full object-cover"/><Play className="absolute bottom-2 left-2 w-5 h-5 text-white fill-white"/></button>)}</div>:
      section==='threads'?<div className="divide-y divide-border">{items.map(t=><button key={t.id} onClick={()=>navigate('/thread/'+t.id)} className="w-full text-left p-4"><p className="font-bold">{t.title}</p><p className="text-sm text-muted-foreground mt-1 line-clamp-3">{t.body}</p></button>)}</div>:
      section==='replies'?<div className="divide-y divide-border">{items.map((r:any)=>{
        const replyAuthor=r.profile??profile;
        const parentAuthor=r.posts?.profiles;
        return <article key={r.id} className="p-4 hover:bg-muted/20 transition-colors">
          <div className="flex items-start gap-3">
            <button onClick={()=>replyAuthor?.username&&navigate('/profile/'+encodeURIComponent(replyAuthor.username))} aria-label="Open profile" className="shrink-0 w-11 h-11 rounded-full overflow-hidden bg-muted ring-1 ring-border">
              {replyAuthor?.avatar_url?<img src={replyAuthor.avatar_url} alt="" className="w-full h-full object-cover" loading="lazy"/>:<span className="w-full h-full flex items-center justify-center font-bold">{(replyAuthor?.display_name||replyAuthor?.full_name||replyAuthor?.username||'?').slice(0,1).toUpperCase()}</span>}
            </button>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 min-w-0">
                <button onClick={()=>replyAuthor?.username&&navigate('/profile/'+encodeURIComponent(replyAuthor.username))} className="min-w-0 text-left">
                  <span className="font-bold truncate inline-block max-w-[14rem] align-bottom">{replyAuthor?.display_name||replyAuthor?.full_name||'User'}</span>
                  {replyAuthor?.verified&&<VerifiedTick className="inline-block w-4 h-4 text-primary ml-1 align-[-2px]"/>}
                  <span className="text-muted-foreground text-sm ml-1">@{replyAuthor?.username||'user'}</span>
                </button>
                <span className="text-xs text-muted-foreground shrink-0">· {r.created_at?new Date(r.created_at).toLocaleDateString():''}</span>
              </div>
              {replyAuthor?.bio&&<p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{replyAuthor.bio}</p>}
              <button onClick={()=>navigate('/post/'+r.post_id)} className="mt-3 w-full text-left rounded-2xl border border-border bg-card p-4 hover:bg-muted/30 transition-colors">
                <p className="text-xs text-muted-foreground mb-2">Replying to {parentAuthor?.username?'@'+parentAuthor.username:'a post'}</p>
                <p className="text-sm whitespace-pre-wrap break-words leading-6">{r.content}</p>
                <div className="mt-3 flex items-center gap-4 text-xs text-muted-foreground">
                  <span>Open reply chain →</span>
                  {r.parent_reply_id&&<span>Reply</span>}
                </div>
              </button>
              {r.posts?.profiles&&<div className="mt-2 px-1 text-xs text-muted-foreground truncate">Original post by @{r.posts.profiles.username||'user'}</div>}
            </div>
          </div>
        </article>
      })}{nextCursor&&<div ref={loadMoreRef} className="py-6 flex justify-center text-xs text-muted-foreground">{loadingMore?'Loading more replies…':'Scroll for more replies'}</div>}</div>:
      <div className="divide-y divide-border">{items.map(u=><button key={u.id} onClick={()=>navigate('/profile/'+u.username)} className="w-full flex items-center gap-3 p-4 text-left"><div className="w-10 h-10 rounded-full bg-muted overflow-hidden">{u.avatar_url?<img src={u.avatar_url} alt="" className="w-full h-full object-cover"/>:<div className="w-full h-full flex items-center justify-center font-bold">{u.username?.[0]?.toUpperCase()}</div>}</div><span className="font-semibold">@{u.username}</span></button>)}</div>}
  </div>;
}
