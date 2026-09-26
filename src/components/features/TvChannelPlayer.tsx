import {useCallback,useEffect,useRef,useState} from 'react';
import Hls from 'hls.js';
import {Volume2,VolumeX,Radio,Maximize2,RefreshCw,Play,Globe2} from 'lucide-react';
import type {TvChannel} from '@/services/tvChannelCatalog';
import {Button} from '@/components/ui/button';
import {supabaseUrl} from '@/lib/supabase';

type Props={channel:TvChannel;active:boolean;onVisible:(id:string,visible:boolean)=>void;onHealth?:(id:string,healthy:boolean)=>void;};

export function TvChannelPlayer({channel,active,onVisible,onHealth}:Props){
 const ref=useRef<HTMLVideoElement>(null); const wrap=useRef<HTMLDivElement>(null); const hls=useRef<Hls|null>(null);
 const retryRef=useRef(0); const retryTimer=useRef<ReturnType<typeof setTimeout>|null>(null); const startRef=useRef<(()=>void)|null>(null);
 const playbackUrlRef=useRef(channel.url);
 const [muted,setMuted]=useState(true); const [error,setError]=useState(false); const [starting,setStarting]=useState(false); const [needsGesture,setNeedsGesture]=useState(false);
 const proxyUrl=useCallback(()=>supabaseUrl+'/functions/v1/tv-stream-proxy?url='+encodeURIComponent(channel.url),[channel.url]);

 useEffect(()=>{const el=wrap.current;if(!el)return;const io=new IntersectionObserver(([e])=>onVisible(channel.id,e.isIntersecting&&e.intersectionRatio>=.58),{threshold:[0,.25,.58,.85]});io.observe(el);return()=>io.disconnect();},[channel.id,onVisible]);

 const cleanup=useCallback(()=>{if(retryTimer.current)clearTimeout(retryTimer.current);retryTimer.current=null;hls.current?.destroy();hls.current=null;const v=ref.current;if(v){v.pause();v.removeAttribute('src');v.load();}},[]);
 const healthy=useCallback(()=>{setStarting(false);setError(false);setNeedsGesture(false);retryRef.current=0;onHealth?.(channel.id,true);},[channel.id,onHealth]);

 const retry=useCallback(()=>{if(!active)return;if(playbackUrlRef.current===channel.url){playbackUrlRef.current=proxyUrl();retryRef.current=0;}else if(retryRef.current>=3){setStarting(false);setError(true);onHealth?.(channel.id,false);return;}retryRef.current++;retryTimer.current=setTimeout(()=>active&&startRef.current?.(),700*Math.pow(2,retryRef.current-1));},[active,channel.id,channel.url,onHealth,proxyUrl]);

 const start=useCallback(()=>{
  const video=ref.current;if(!video||!active)return;cleanup();setStarting(true);setError(false);setNeedsGesture(false);
  window.dispatchEvent(new CustomEvent('testagram-tv-play',{detail:channel.id}));video.playsInline=true;video.autoplay=true;video.muted=true;
  const play=()=>{void video.play().then(healthy).catch((e:any)=>{if(e?.name==='NotAllowedError'){setNeedsGesture(true);setStarting(false);return;}retry();});};
  const directUrl=playbackUrlRef.current;
  const looksLikeHls=/\.m3u8(?:$|[?#])/i.test(directUrl);
  const looksLikeFile=/\.(mp4|webm|ogg)(?:$|[?#])/i.test(directUrl);
  if(video.canPlayType('application/vnd.apple.mpegurl')||looksLikeFile){
    video.src=directUrl;
    video.addEventListener('loadedmetadata',play,{once:true});
    video.addEventListener('canplay',healthy,{once:true});
    video.addEventListener('playing',healthy,{once:true});
    video.addEventListener('error',retry,{once:true});
    if(looksLikeFile) void video.play().catch((e:any)=>{if(e?.name!=='NotAllowedError')retry();else{setNeedsGesture(true);setStarting(false);}});
    return;
  }
  if(Hls.isSupported()&&!looksLikeFile){const h=new Hls({enableWorker:true,lowLatencyMode:true,backBufferLength:4,maxBufferLength:8,maxMaxBufferLength:16,liveSyncDurationCount:3,liveMaxLatencyDurationCount:6,manifestLoadingMaxRetry:2,levelLoadingMaxRetry:3,fragLoadingMaxRetry:3});hls.current=h;h.loadSource(playbackUrlRef.current);h.attachMedia(video);h.on(Hls.Events.MANIFEST_PARSED,play);h.on(Hls.Events.FRAG_BUFFERED,healthy);h.on(Hls.Events.ERROR,(_,d)=>{if(!d.fatal)return;if(d.type===Hls.ErrorTypes.MEDIA_ERROR&&playbackUrlRef.current!==channel.url){try{h.recoverMediaError();return;}catch{}}retry();});return;}
  if(!looksLikeHls){video.src=directUrl;video.addEventListener('canplay',healthy,{once:true});video.addEventListener('error',retry,{once:true});void video.play().catch(()=>{});return;}
  setStarting(false);setError(true);onHealth?.(channel.id,false);
 },[active,channel.id,channel.url,cleanup,healthy,retry,onHealth]);
 startRef.current=start;

 useEffect(()=>{retryRef.current=0;playbackUrlRef.current=channel.url;if(active){start();return cleanup;}cleanup();setError(false);setStarting(false);setNeedsGesture(false);},[active,channel.url,start,cleanup]);

 useEffect(()=>{const stop=(e:Event)=>{if((e as CustomEvent<string>).detail===channel.id)return;cleanup();setStarting(false);};window.addEventListener('testagram-tv-play',stop);return()=>window.removeEventListener('testagram-tv-play',stop);},[channel.id,cleanup]);

 const toggle=()=>{const v=ref.current;if(!v)return;const next=!muted;v.muted=next;setMuted(next);if(!next)void v.play().catch(()=>setNeedsGesture(true));};
 const fullscreen=()=>{(ref.current as any)?.requestFullscreen?.();};

 return <article ref={wrap} className='snap-start overflow-hidden rounded-2xl border bg-card shadow-sm'>
  <div className='relative aspect-video bg-gradient-to-br from-muted via-background to-muted'>
   {channel.logo&&<img src={channel.logo} alt='' loading='lazy' decoding='async' className='absolute inset-0 m-auto max-h-20 max-w-[42%] object-contain opacity-80' />}
   {active&&<video ref={ref} muted={muted} playsInline autoPlay preload='none' className='absolute inset-0 h-full w-full object-contain bg-black' />}
   {!active&&<div className='absolute inset-0 bg-gradient-to-t from-black/75 via-black/10 to-transparent'><button onClick={()=>onVisible(channel.id,true)} className='absolute inset-0 flex items-center justify-center'><span className='rounded-full bg-background/95 p-4 shadow-lg'><Play className='h-7 w-7 fill-current'/></span></button></div>}
   {starting&&<div className='absolute inset-0 flex items-center justify-center pointer-events-none'><div className='rounded-full bg-black/70 px-3 py-2 text-xs text-white flex items-center gap-2'><RefreshCw className='w-4 h-4 animate-spin'/>Connecting…</div></div>}
   {error&&<div className='absolute inset-0 flex items-center justify-center bg-black/75 p-4 text-center text-white'><div><Radio className='mx-auto mb-2'/><p className='font-semibold'>Stream unavailable</p><p className='text-xs text-white/70 mt-1'>This source could not be played. The next channel remains available.</p></div></div>}
   {needsGesture&&!error&&<button onClick={toggle} className='absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-black/80 px-4 py-2 text-sm font-semibold text-white'>Tap to enable sound</button>}
   <div className='absolute left-3 top-3 flex items-center gap-2 rounded-full bg-black/70 px-2.5 py-1 text-[11px] font-bold text-white'><span className='h-2 w-2 rounded-full bg-red-500 animate-pulse'/>LIVE</div>
  </div>
  <div className='p-3'>
   <div className='flex items-start justify-between gap-3'><div className='min-w-0'><h2 className='font-bold line-clamp-2'>{channel.name}</h2><div className='mt-1 flex items-center gap-2 text-xs text-muted-foreground'><Globe2 className='h-3.5 w-3.5'/><span>{channel.country||'International'}</span>{channel.group&&<><span>•</span><span className='truncate'>{channel.group}</span></>}</div></div><div className='flex shrink-0 gap-1'><Button size='icon' variant='outline' onClick={toggle} aria-label={muted?'Unmute':'Mute'}>{muted?<VolumeX/>:<Volume2/>}</Button><Button size='icon' variant='outline' onClick={fullscreen} aria-label='Fullscreen'><Maximize2/></Button></div></div>
   <div className='mt-2 text-[11px] text-muted-foreground truncate'>Source: {channel.source}</div>
  </div>
 </article>;
}
