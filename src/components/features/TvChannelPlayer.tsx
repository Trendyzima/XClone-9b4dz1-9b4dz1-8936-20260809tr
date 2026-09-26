import {useCallback,useEffect,useRef,useState} from 'react';
import Hls from 'hls.js';
import {Volume2,VolumeX,Radio,Maximize2,RefreshCw} from 'lucide-react';
import type {TvChannel} from '@/services/tvChannelCatalog';
import {Button} from '@/components/ui/button';

type Props={
 channel:TvChannel;
 active:boolean;
 onVisible:(id:string,visible:boolean)=>void;
 onHealth?:(id:string,healthy:boolean)=>void;
};

const RETRIES=3;

export function TvChannelPlayer({channel,active,onVisible,onHealth}:Props){
 const ref=useRef<HTMLVideoElement>(null);
 const wrap=useRef<HTMLDivElement>(null);
 const hls=useRef<Hls|null>(null);
 const retryRef=useRef(0);
 const retryTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
 const [muted,setMuted]=useState(true);
 const [error,setError]=useState(false);
 const [starting,setStarting]=useState(false);
 const [needsGesture,setNeedsGesture]=useState(false);

 useEffect(()=>{
  const el=wrap.current;if(!el)return;
  const io=new IntersectionObserver(([e])=>onVisible(channel.id,e.isIntersecting&&e.intersectionRatio>=.65),{threshold:[.2,.65,.9]});
  io.observe(el);
  return()=>io.disconnect();
 },[channel.id,onVisible]);

 const cleanup=useCallback(()=>{
  if(retryTimer.current) clearTimeout(retryTimer.current);
  retryTimer.current=null;
  hls.current?.destroy();
  hls.current=null;
  const video=ref.current;
  if(video){video.pause();video.removeAttribute('src');video.load();}
 },[]);

 const markHealthy=useCallback(()=>{
  setStarting(false);setError(false);setNeedsGesture(false);retryRef.current=0;onHealth?.(channel.id,true);
 },[channel.id,onHealth]);

 const retry=useCallback(()=>{
  if(!active||retryRef.current>=RETRIES){setStarting(false);setError(true);onHealth?.(channel.id,false);return;}
  retryRef.current+=1;
  const delay=900*Math.pow(2,retryRef.current-1);
  retryTimer.current=setTimeout(()=>{ if(active) setError(false); },delay);
 },[active,channel.id,onHealth]);

 const start=useCallback(()=>{
  const video=ref.current;if(!video||!active)return;
  cleanup();setStarting(true);
  // A single global playback lease prevents two live channels from consuming
  // audio/network at the same time, even while IntersectionObservers overlap.
  window.dispatchEvent(new CustomEvent('testagram-tv-play', { detail: channel.id }));setError(false);setNeedsGesture(false);
  video.playsInline=true;
  video.autoplay=true;
  // Start silently so mobile autoplay is deterministic. Sound is always opt-in.
  video.muted=true;
  const play=()=>{
   window.dispatchEvent(new CustomEvent('testagram-tv-play', { detail: channel.id }));
   void video.play().then(markHealthy).catch((e:any)=>{
    setStarting(false);
    if(e?.name==='NotAllowedError'){
     // Browsers may block sound autoplay. Keep the stream playing silently and expose
     // a one-tap sound control; once the user has interacted, unmuted playback is retried.
     video.muted=true;setMuted(true);setNeedsGesture(true);
     void video.play().then(markHealthy).catch(()=>retry());
    }else retry();
   });
  };
  if(video.canPlayType('application/vnd.apple.mpegurl')){
   video.src=channel.url;
   const onMeta=()=>play();
   const onCanPlay=()=>markHealthy();
   const onError=()=>retry();
   video.addEventListener('loadedmetadata',onMeta,{once:true});
   video.addEventListener('canplay',onCanPlay,{once:true});
   video.addEventListener('error',onError,{once:true});
   return;
  }
  if(Hls.isSupported()){
   const h=new Hls({
    enableWorker:true,
    lowLatencyMode:true,
    backBufferLength:6,
    maxBufferLength:10,
    maxMaxBufferLength:20,
    liveSyncDurationCount:3,
    liveMaxLatencyDurationCount:6,
    manifestLoadingMaxRetry:2,
    levelLoadingMaxRetry:3,
    fragLoadingMaxRetry:3,
    startLevel:-1,
   });
   hls.current=h;
   h.loadSource(channel.url);
   h.attachMedia(video);
   h.on(Hls.Events.MANIFEST_PARSED,()=>play());
   h.on(Hls.Events.FRAG_BUFFERED,()=>markHealthy());
   h.on(Hls.Events.ERROR,(_,data)=>{
    if(!data.fatal)return;
    if(data.type===Hls.ErrorTypes.MEDIA_ERROR){try{h.recoverMediaError();return;}catch{}}
    if(data.type===Hls.ErrorTypes.NETWORK_ERROR){try{h.startLoad(-1);return;}catch{}}
    retry();
   });
   return;
  }
  setStarting(false);setError(true);onHealth?.(channel.id,false);
 },[active,channel.id,channel.url,cleanup,markHealthy,muted,retry,onHealth]);

 useEffect(()=>{
  retryRef.current=0;
  if(!active){cleanup();setError(false);setStarting(false);setNeedsGesture(false);return;}
  start();
  return cleanup;
 },[active,channel.url,start,cleanup]);

 useEffect(()=>{
  const stopOther=(event:Event)=>{
   const id=(event as CustomEvent<string>).detail;
   if(id===channel.id)return;
   const video=ref.current;
   if(video && !video.paused){video.pause();video.removeAttribute('src');video.load();}
   if(hls.current){hls.current.destroy();hls.current=null;}
   setStarting(false);
  };
  window.addEventListener('testagram-tv-play',stopOther);
  return()=>window.removeEventListener('testagram-tv-play',stopOther);
 },[channel.id]);

 const toggle=()=>{
  const video=ref.current;if(!video)return;
  const next=!muted;
  video.muted=next;setMuted(next);
  if(!next){setNeedsGesture(false);void video.play().catch(()=>setNeedsGesture(true));}
 };

 const fullscreen=()=>{const e=ref.current as any;e?.requestFullscreen?.();};

 return <div ref={wrap} className='relative h-[calc(100svh-150px)] min-h-[520px] snap-start bg-black overflow-hidden rounded-2xl'>
  <video ref={ref} muted={muted} playsInline autoPlay preload='auto' className='h-full w-full object-contain' />
  {starting&&!error&&<div className='absolute inset-0 flex items-center justify-center pointer-events-none'><div className='rounded-full bg-black/60 px-4 py-2 text-xs flex items-center gap-2'><RefreshCw className='w-4 h-4 animate-spin'/>Connecting to live channel…</div></div>}
  <div className='absolute inset-x-0 top-0 p-4 bg-gradient-to-b from-black/70 to-transparent pointer-events-none'><div className='flex items-center gap-2'><Radio className='w-4 h-4 text-red-400'/><span className='text-xs font-bold uppercase'>LIVE TV</span><span className='text-xs opacity-70'>{channel.source}</span></div><h2 className='text-lg font-bold mt-1 line-clamp-2'>{channel.name}</h2></div>
  {error&&<div className='absolute inset-0 flex items-center justify-center bg-black/80 p-6 text-center'><div><Radio className='mx-auto mb-2'/><p className='font-semibold'>Channel unavailable</p><p className='text-xs text-white/60 mt-1'>Testagram tried to recover this live source. Scroll for the next verified channel.</p></div></div>}
  {needsGesture&&!error&&<button onClick={toggle} className='absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-black/75 px-5 py-3 text-sm font-semibold shadow-xl'>Tap for live sound</button>}
  <div className='absolute bottom-0 inset-x-0 p-4 bg-gradient-to-t from-black/80 to-transparent flex items-end justify-between'><div className='flex gap-2'><Button size='icon' variant='secondary' onClick={toggle} aria-label={muted?'Unmute':'Mute'}>{muted?<VolumeX/>:<Volume2/>}</Button><Button size='icon' variant='secondary' onClick={fullscreen} aria-label='Fullscreen'><Maximize2/></Button></div><span className='text-xs px-2 py-1 rounded-full bg-black/60'>{muted?'Tap sound to listen':'LIVE • sound on'}</span></div>
 </div>;
}
