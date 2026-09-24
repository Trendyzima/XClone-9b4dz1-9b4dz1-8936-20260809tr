import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { PostCard } from '@/components/features/PostCard';
import { VerifiedTick } from '@/components/ui/VerifiedTick';
import { Loader2, Play } from 'lucide-react';
import { listProfileLikes } from '@/features/likes/likesService';
import { listProfileReplies } from '@/features/replies/repliesService';

type Section = 'posts'|'threads'|'replies'|'media'|'videos'|'likes'|'followers'|'following';
const labels: Record<Section,string> = {posts:'Posts',threads:'Threads',replies:'Replies',media:'Media',videos:'Videos',likes:'Likes',followers:'Followers',following:'Following'};
const getSection=(p:string):Section=>{const s=p.split('/').filter(Boolean).pop()?.toLowerCase() as Section;return s&&s in labels?s:'posts';};

export default function ProfileSectionPage(){
  const {username}=useParams(); const location=useLocation(); const navigate=useNavigate();
  const section=useMemo(()=>getSection(location.pathname),[location.pathname]);
  const [profile,setProfile]=useState<any>(null); const [items,setItems]=useState<any[]>([]);
  const [loading,setLoading]=useState(true); const [error,setError]=useState<string|null>(null);

  useEffect(()=>{let cancelled=false; (async()=>{
    setLoading(true);setError(null);
    const p=await supabase.from('profiles').select('*').eq('username',username??'').maybeSingle();
    if(cancelled)return;
    if(p.error||!p.data){setError('Profile not found');setLoading(false);return;}
    setProfile(p.data);
    try{
      let rows:any[]=[];
      if(section==='posts'||section==='videos'){const q=await supabase.from('posts').select('*, profiles!posts_author_id_fkey(*)').eq('author_id',p.data.id).is('deleted_at',null).order('created_at',{ascending:false});rows=q.data??[];if(section==='videos')rows=rows.filter(x=>x.is_video&&x.video_url);}
      else if(section==='threads'){const q=await supabase.from('threads').select('*').eq('owner_id',p.data.id).is('deleted_at',null).order('created_at',{ascending:false});rows=q.data??[];}
      else if(section==='replies')rows=await listProfileReplies(p.data.id,100);
      else if(section==='likes')rows=await listProfileLikes(p.data.id,100);
      else if(section==='media'){const q=await supabase.from('posts').select('*, profiles!posts_author_id_fkey(*)').eq('author_id',p.data.id).is('deleted_at',null).or('image_url.not.is.null,video_url.not.is.null,media_urls.neq.[]').order('created_at',{ascending:false});rows=q.data??[];}
      else if(section==='followers'){const q=await supabase.from('follows').select('follower:profiles!follows_follower_id_fkey(*)').eq('following_id',p.data.id);rows=(q.data??[]).map((x:any)=>x.follower).filter(Boolean);}
      else {const q=await supabase.from('follows').select('following:profiles!follows_following_id_fkey(*)').eq('follower_id',p.data.id);rows=(q.data??[]).map((x:any)=>x.following).filter(Boolean);}
      if(!cancelled){setItems(rows);setLoading(false);}
    }catch(e){if(!cancelled){setError(e instanceof Error?e.message:'Unable to load this section');setItems([]);setLoading(false);}}
  })();return()=>{cancelled=true}},[username,section]);

  if(loading)return <div className="min-h-screen flex items-center justify-center"><Loader2 className="w-7 h-7 animate-spin text-primary"/></div>;
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
    {error&&<div className="p-3 text-sm text-destructive border-b border-border">{error}</div>}
    {!items.length?<div className="p-12 text-center text-muted-foreground">No {labels[section].toLowerCase()} yet.</div>:
      section==='posts'||section==='likes'?<div>{items.map(p=><PostCard key={p.id} post={p} onUpdate={()=>{}}/>)}</div>:
      section==='media'?<div className="grid grid-cols-2 md:grid-cols-3 gap-2 p-2">{items.map(p=>{const u=p.video_url||p.image_url||p.media_urls?.[0];return <button key={p.id} onClick={()=>navigate('/post/'+p.id)} className="aspect-square rounded-lg overflow-hidden bg-muted"><img src={u} alt="" className="w-full h-full object-cover"/></button>})}</div>:
      section==='videos'?<div className="grid grid-cols-2 gap-2 p-3">{items.map(p=><button key={p.id} onClick={()=>navigate('/videos?id='+p.id)} className="relative aspect-[9/16] rounded-xl overflow-hidden bg-black"><video src={p.video_url+'#t=0.5'} muted preload="metadata" className="w-full h-full object-cover"/><Play className="absolute bottom-2 left-2 w-5 h-5 text-white fill-white"/></button>)}</div>:
      section==='threads'?<div className="divide-y divide-border">{items.map(t=><button key={t.id} onClick={()=>navigate('/thread/'+t.id)} className="w-full text-left p-4"><p className="font-bold">{t.title}</p><p className="text-sm text-muted-foreground mt-1 line-clamp-3">{t.body}</p></button>)}</div>:
      section==='replies'?<div className="divide-y divide-border">{items.map(r=><button key={r.id} onClick={()=>navigate('/post/'+r.post_id)} className="w-full text-left p-4"><p className="text-xs text-muted-foreground mb-1">Replying to @{r.posts?.profiles?.username??'user'}</p><p>{r.content}</p></button>)}</div>:
      <div className="divide-y divide-border">{items.map(u=><button key={u.id} onClick={()=>navigate('/profile/'+u.username)} className="w-full flex items-center gap-3 p-4 text-left"><div className="w-10 h-10 rounded-full bg-muted overflow-hidden">{u.avatar_url?<img src={u.avatar_url} alt="" className="w-full h-full object-cover"/>:<div className="w-full h-full flex items-center justify-center font-bold">{u.username?.[0]?.toUpperCase()}</div>}</div><span className="font-semibold">@{u.username}</span></button>)}</div>}
  </div>;
}
