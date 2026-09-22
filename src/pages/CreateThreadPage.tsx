import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Image as ImageIcon, Loader2, X } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';

const MAX_CHARS=500;

export default function CreateThreadPage(){
  const {user}=useAuth(); const navigate=useNavigate();
  const [body,setBody]=useState(''); const [files,setFiles]=useState<File[]>([]); const [previews,setPreviews]=useState<string[]>([]);
  const [posting,setPosting]=useState(false); const fileRef=useRef<HTMLInputElement>(null);

  useEffect(()=>{if(!user)navigate('/auth');},[user,navigate]);
  useEffect(()=>()=>previews.forEach(url=>URL.revokeObjectURL(url)),[previews]);

  const addFiles=(incoming:File[])=>{
    const valid=incoming.filter(f=>f.type.startsWith('image/')&&f.size<=10*1024*1024).slice(0,4-files.length);
    if(incoming.length!==valid.length)toast.error('Use up to 4 images, 10 MiB each');
    setFiles(p=>[...p,...valid]);
    setPreviews(p=>[...p,...valid.map(f=>URL.createObjectURL(f))]);
  };
  const removeFile=(i:number)=>{URL.revokeObjectURL(previews[i]);setFiles(p=>p.filter((_,n)=>n!==i));setPreviews(p=>p.filter((_,n)=>n!==i));};

  const publish=async()=>{
    if(!user||!body.trim())return;
    setPosting(true);
    try{
      const mediaUrls:string[]=[];
      for(const [i,file] of files.entries()){
        const ext=file.name.split('.').pop()?.toLowerCase()||'jpg';
        const path=`threads/${user.id}/${crypto.randomUUID()}-${i}.${ext}`;
        const {error}=await supabase.storage.from('posts').upload(path,file,{contentType:file.type,upsert:false});
        if(error)throw error;
        mediaUrls.push(supabase.storage.from('posts').getPublicUrl(path).data.publicUrl);
      }
      const {data,error}=await supabase.from('threads').insert({owner_id:user.id,body:body.trim(),visibility:'public',media_urls:mediaUrls}).select('id').single();
      if(error)throw error;
      toast.success('Thread posted');
      navigate(`/thread/${data.id}`);
    }catch(error:any){console.error(error);toast.error(error?.message||'Could not post thread');}
    finally{setPosting(false);}
  };

  if(!user)return null;
  const remaining=MAX_CHARS-body.length;
  return <div className="min-h-screen bg-background">
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-background/90 px-4 backdrop-blur-xl">
      <button onClick={()=>navigate(-1)} className="rounded-full p-2 hover:bg-muted"><ArrowLeft className="h-5 w-5"/></button>
      <h1 className="text-base font-bold">New thread</h1>
      <button onClick={publish} disabled={posting||!body.trim()} className="ml-auto rounded-full bg-primary px-4 py-1.5 text-sm font-bold text-primary-foreground disabled:opacity-40">{posting?<Loader2 className="h-4 w-4 animate-spin"/>:'Post'}</button>
    </header>
    <main className="px-4 py-5">
      <div className="flex gap-3">
        <div className="h-10 w-10 shrink-0 overflow-hidden rounded-full bg-muted flex items-center justify-center font-bold">{user.avatar?<img src={user.avatar} alt="" className="h-full w-full object-cover"/>:user.username.slice(0,1).toUpperCase()}</div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{user.username}</p>
          <textarea autoFocus value={body} maxLength={MAX_CHARS} onChange={e=>setBody(e.target.value)} placeholder="What's new?" rows={8} className="mt-2 w-full resize-none bg-transparent text-lg leading-7 outline-none placeholder:text-muted-foreground/60"/>
          {previews.length>0&&<div className={`grid gap-2 ${previews.length>1?'grid-cols-2':''}`}>{previews.map((url,i)=><div key={url} className="relative overflow-hidden rounded-2xl border border-border"><img src={url} alt="" className="max-h-80 w-full object-cover"/><button onClick={()=>removeFile(i)} className="absolute right-2 top-2 rounded-full bg-black/70 p-1 text-white"><X className="h-4 w-4"/></button></div>)}</div>}
          <div className="mt-3 flex items-center justify-between border-t border-border pt-3">
            <button onClick={()=>fileRef.current?.click()} disabled={files.length>=4} className="rounded-full p-2 text-primary hover:bg-primary/10 disabled:opacity-40" aria-label="Add photos"><ImageIcon className="h-5 w-5"/></button>
            <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={e=>{addFiles(Array.from(e.target.files??[]));e.currentTarget.value='';}}/>
            <span className={`text-xs ${remaining<50?'text-orange-500 font-semibold':'text-muted-foreground'}`}>{remaining}</span>
          </div>
        </div>
      </div>
      <div className="mt-8 rounded-2xl border border-border bg-muted/20 p-4 text-xs text-muted-foreground">
        <p className="font-semibold text-foreground">Public thread</p>
        <p className="mt-1">Anyone on Testagram can reply, repost, quote and like this conversation.</p>
      </div>
    </main>
  </div>;
}
