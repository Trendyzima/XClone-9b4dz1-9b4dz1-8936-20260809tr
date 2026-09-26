import {useEffect,useRef,useState} from 'react';
import Hls from 'hls.js';
import {Volume2,VolumeX,Radio,Maximize2} from 'lucide-react';
import type {TvChannel} from '@/services/tvChannelCatalog';
import {Button} from '@/components/ui/button';
export function TvChannelPlayer({channel,active,onVisible}:{channel:TvChannel;active:boolean;onVisible:(id:string,visible:boolean)=>void}){
 const ref=useRef<HTMLVideoElement>(null); const wrap=useRef<HTMLDivElement>(null); const hls=useRef<Hls|null>(null); const [muted,setMuted]=useState(true); const [error,setError]=useState(false);
 useEffect(()=>{const el=wrap.current;if(!el)return;const io=new IntersectionObserver(([e])=>onVisible(channel.id,e.isIntersecting&&e.intersectionRatio>=.65),{threshold:[.2,.65,.9]});io.observe(el);return()=>io.disconnect();},[channel.id,onVisible]);
 useEffect(()=>{const video=ref.current;if(!video)return; if(!active){video.pause();return;} setError(false);
  const play=()=>void video.play().catch(()=>undefined);
  if(video.canPlayType('application/vnd.apple.mpegurl')){video.src=channel.url;video.addEventListener('loadedmetadata',play,{once:true});return()=>{video.pause();video.removeAttribute('src');video.load();};}
  if(Hls.isSupported()){const h=new Hls({enableWorker:true,lowLatencyMode:true,maxBufferLength:12,maxMaxBufferLength:24});hls.current=h;h.loadSource(channel.url);h.attachMedia(video);h.on(Hls.Events.MANIFEST_PARSED,play);h.on(Hls.Events.ERROR,(_,data)=>{if(data.fatal)setError(true);});return()=>{h.destroy();hls.current=null;video.pause();};}
  setError(true); return;
 },[active,channel.url]);
 const toggle=()=>{setMuted(v=>{const n=!v;if(ref.current)ref.current.muted=n;return n;});};
 const fullscreen=()=>{const e=ref.current as any;e?.requestFullscreen?.();};
 return <div ref={wrap} className='relative h-[calc(100svh-150px)] min-h-[520px] snap-start bg-black overflow-hidden rounded-2xl'>
  <video ref={ref} muted={muted} playsInline autoPlay preload='metadata' className='h-full w-full object-contain' />
  <div className='absolute inset-x-0 top-0 p-4 bg-gradient-to-b from-black/70 to-transparent pointer-events-none'><div className='flex items-center gap-2'><Radio className='w-4 h-4 text-red-400'/><span className='text-xs font-bold uppercase'>LIVE TV</span><span className='text-xs opacity-70'>{channel.source}</span></div><h2 className='text-lg font-bold mt-1 line-clamp-2'>{channel.name}</h2></div>
  {error&&<div className='absolute inset-0 flex items-center justify-center bg-black/70 p-6 text-center'><div><Radio className='mx-auto mb-2'/><p className='font-semibold'>Stream unavailable</p><p className='text-xs text-white/60 mt-1'>This public source may be offline. Scroll for another channel.</p></div></div>}
  <div className='absolute bottom-0 inset-x-0 p-4 bg-gradient-to-t from-black/80 to-transparent flex items-end justify-between'><div className='flex gap-2'><Button size='icon' variant='secondary' onClick={toggle} aria-label={muted?'Unmute':'Mute'}>{muted?<VolumeX/>:<Volume2/>}</Button><Button size='icon' variant='secondary' onClick={fullscreen} aria-label='Fullscreen'><Maximize2/></Button></div><span className='text-xs px-2 py-1 rounded-full bg-black/60'>Tap sound to listen</span></div>
 </div>;
}