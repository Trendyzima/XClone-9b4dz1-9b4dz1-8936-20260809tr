import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, FilePlus2, Loader2, X } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { supabase, supabasePublishableKey, supabaseUrl } from '@/lib/supabase';
import { uploadTestagramMedia } from '@/services/mediaClient';
import { requireAccessToken } from '@/services/backendClient';
import { toast } from 'sonner';

const MAX_CHARS=500;
const MAX_FILES=20;
const MAX_FILE_BYTES=20*1024*1024;

type MediaAsset={url:string;name:string;type:string;size:number};

export default function CreateThreadPage(){
  const {user}=useAuth(); const navigate=useNavigate();
  const [body,setBody]=useState(''); const [files,setFiles]=useState<File[]>([]); const [previews,setPreviews]=useState<string[]>([]);
  const [posting,setPosting]=useState(false); const fileRef=useRef<HTMLInputElement>(null);

  useEffect(()=>{if(!user)navigate('/auth');},[user,navigate]);
  useEffect(()=>()=>previews.forEach(url=>URL.revokeObjectURL(url)),[previews]);

  const addFiles=(incoming:File[])=>{
    const room=MAX_FILES-files.length;
    const valid=incoming.filter(f=>f.size>0&&f.size<=MAX_FILE_BYTES).slice(0,room);
    if(incoming.some(f=>f.size>MAX_FILE_BYTES))toast.error('Each attachment must be 20 MiB or smaller');
    if(incoming.length>room)toast.error(`You can attach up to ${MAX_FILES} files to one thread post`);
    setFiles(p=>[...p,...valid]);
    setPreviews(p=>[...p,...valid.map(f=>URL.createObjectURL(f))]);
  };
  const removeFile=(i:number)=>{URL.revokeObjectURL(previews[i]);setFiles(p=>p.filter((_,n)=>n!==i));setPreviews(p=>p.filter((_,n)=>n!==i));};

  const publish=async()=>{
    if(!user||(!body.trim()&&!files.length))return;
    setPosting(true);
    try{
      const accessToken = await requireAccessToken();
      const { data: tokenUser, error: tokenUserError } = await supabase.auth.getUser(accessToken);
      if (tokenUserError || !tokenUser.user || tokenUser.user.id !== user.id) throw new Error('Authentication session changed. Please retry.');

      const threadResponse = await fetch(supabaseUrl.replace(/\/$/, '') + '/rest/v1/threads?select=id', {
        method: 'POST',
        headers: { apikey: supabasePublishableKey, Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json', Accept: 'application/json', Prefer: 'return=representation' },
        body: JSON.stringify({owner_id:user.id,body:body.trim(),visibility:'public',media_urls:[]}),
      });
      const threadRaw = await threadResponse.text();
      let threadRows:any = null; try { threadRows = threadRaw ? JSON.parse(threadRaw) : null; } catch { threadRows = null; }
      if (!threadResponse.ok) {
        const message = Array.isArray(threadRows) ? threadRows[0]?.message : threadRows?.message;
        throw new Error(message || (threadResponse.status === 401 || threadResponse.status === 403 ? 'Authentication required' : 'Could not create thread'));
      }
      const data = Array.isArray(threadRows) ? threadRows[0] : threadRows;
      if (!data?.id) throw new Error('Thread creation returned no id');
      const mediaUrls:MediaAsset[]=[];
      try {
        for(const file of files) {
          const uploaded=await uploadTestagramMedia(file,null,data.id,accessToken);
          mediaUrls.push({url:uploaded.public_url||'',name:file.name,type:file.type||'application/octet-stream',size:file.size});
        }
        if(mediaUrls.length) {
          const updateResponse=await fetch(supabaseUrl.replace(/\/$/,'') + '/rest/v1/threads?id=eq.' + data.id + '&owner_id=eq.' + user.id,{method:'PATCH',headers:{apikey:supabasePublishableKey,Authorization:'Bearer '+accessToken,'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({media_urls:mediaUrls})});
          if(!updateResponse.ok){const raw=await updateResponse.text().catch(()=> '');throw new Error(raw||('Thread media update failed ('+updateResponse.status+')'));}
        }
      } catch(uploadError) {
        await supabase.from('threads').update({deleted_at:new Date().toISOString()}).eq('id',data.id).eq('owner_id',user.id);
        throw uploadError;
      }
      toast.success('Thread posted');
      navigate(`/thread/${data.id}`);
    }catch(error:any){console.error(error);toast.error(error?.message||'Could not post thread');}
    finally{setPosting(false);}
  };

  if(!user)return null;
  const remaining=MAX_CHARS-body.length;
  return <div className="min-h-screen bg-background">
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-background/90 px-4 backdrop-blur-xl">
      <button onClick={()=>navigate(-1)} className="rounded-full p-2 hover:bg-muted" aria-label="Back"><ArrowLeft className="h-5 w-5"/></button>
      <h1 className="text-base font-bold">New thread</h1>
      <button onClick={publish} disabled={posting||(!body.trim()&&!files.length)} className="ml-auto rounded-full bg-primary px-4 py-1.5 text-sm font-bold text-primary-foreground disabled:opacity-40">{posting?<Loader2 className="h-4 w-4 animate-spin"/>:'Post'}</button>
    </header>
    <main className="px-4 py-5">
      <div className="flex gap-3">
        <div className="h-10 w-10 shrink-0 overflow-hidden rounded-full bg-muted flex items-center justify-center font-bold">{user.avatar?<img src={user.avatar} alt="" className="h-full w-full object-cover"/>:user.username.slice(0,1).toUpperCase()}</div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{user.username}</p>
          <textarea autoFocus value={body} maxLength={MAX_CHARS} onChange={e=>setBody(e.target.value)} placeholder="What's new?" rows={7} className="mt-2 w-full resize-none bg-transparent text-lg leading-7 outline-none placeholder:text-muted-foreground/60"/>
          {previews.length>0&&<div className="flex snap-x snap-mandatory gap-2 overflow-x-auto overscroll-x-contain pb-1 [scrollbar-width:none]">{previews.map((url,i)=><div key={url} className="relative min-w-[82%] snap-center overflow-hidden rounded-2xl border border-border bg-muted/20 p-2 sm:min-w-[62%]"><p className="truncate pr-8 text-xs text-muted-foreground">{files[i]?.name}</p>{files[i]?.type.startsWith('image/')?<img src={url} alt="" className="mt-2 max-h-72 w-full rounded-xl object-contain"/>:files[i]?.type.startsWith('video/')?<video src={url} controls className="mt-2 max-h-72 w-full rounded-xl"/>:files[i]?.type.startsWith('audio/')?<audio src={url} controls className="mt-2 w-full"/>:<a href={url} target="_blank" rel="noreferrer" className="mt-2 flex items-center gap-2 rounded-xl bg-background p-3 text-sm text-primary"><FilePlus2 className="h-5 w-5"/>{files[i]?.name}</a>}<button onClick={()=>removeFile(i)} className="absolute right-2 top-2 rounded-full bg-black/70 p-1 text-white" aria-label="Remove attachment"><X className="h-4 w-4"/></button></div>)}</div>}
          <div className="mt-3 flex items-center justify-between border-t border-border pt-3">
            <button onClick={()=>fileRef.current?.click()} disabled={files.length>=MAX_FILES} className="rounded-full p-2 text-primary hover:bg-primary/10 disabled:opacity-40" aria-label="Attach media"><FilePlus2 className="h-5 w-5"/></button>
            <input ref={fileRef} type="file" accept="*/*" multiple hidden onChange={e=>{addFiles(Array.from(e.target.files??[]));e.currentTarget.value='';}}/>
            <span className={`text-xs ${remaining<50?'text-orange-500 font-semibold':'text-muted-foreground'}`}>{remaining}</span>
          </div>
        </div>
      </div>
      <div className="mt-8 rounded-2xl border border-border bg-muted/20 p-4 text-xs text-muted-foreground">
        <p className="font-semibold text-foreground">Public thread · infinite conversation</p>
        <p className="mt-1">Reply to any post, quote any point, and attach photos, video, audio, GIFs, documents or other files at every step.</p>
      </div>
    </main>
  </div>;
}
