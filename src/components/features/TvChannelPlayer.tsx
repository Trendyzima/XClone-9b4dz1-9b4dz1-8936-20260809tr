import {useCallback,useEffect,useRef,useState} from 'react';
import Hls from 'hls.js';
import {Volume2,VolumeX,Radio,Maximize2,RefreshCw,Play,Globe2,Gauge} from 'lucide-react';
import type {TvChannel} from '@/services/tvChannelCatalog';
import {Button} from '@/components/ui/button';
import {supabaseUrl} from '@/lib/supabase';

type Props={channel:TvChannel;active:boolean;onVisible:(id:string,visible:boolean)=>void;onHealth?:(id:string,healthy:boolean)=>void;};

export function TvChannelPlayer({channel,active,onVisible,onHealth}:Props){
 const ref=useRef<HTMLVideoElement>(null); const wrap=useRef<HTMLDivElement>(null); const hls=useRef<Hls|null>(null);
 const retryRef=useRef(0); const retryTimer=useRef<ReturnType<typeof setTimeout>|null>(null); const startRef=useRef<(()=>void)|null>(null); const proxyFallbackRef=useRef(false); const bandwidthTimerRef=useRef<ReturnType<typeof setInterval>|null>(null);
 const playbackUrlRef=useRef(channel.url);
 const [dataSaver,setDataSaver]=useState(()=>{try{return localStorage.getItem('testagram-tv-data-saver')==='on';}catch{return false;}}); const [muted,setMuted]=useState(()=>{try{return localStorage.getItem('testagram-tv-audio')!=='on';}catch{return true;}}); const audioPreferenceRef=useRef(muted); const [error,setError]=useState(false); const [starting,setStarting]=useState(false); const [needsGesture,setNeedsGesture]=useState(false);
 const networkProfile=useCallback(()=>{const n=(navigator as any).connection;const type=String(n?.effectiveType||'').toLowerCase();const save=Boolean(n?.saveData)||dataSaver;const constrained=save||type==='slow-2g'||type==='2g';const moderate=type==='3g';return {save,constrained,moderate};},[dataSaver]);
 const proxyUrl=useCallback(()=>supabaseUrl+'/functions/v1/tv-stream-proxy?url='+encodeURIComponent(channel.url),[channel.url]);

 useEffect(()=>{const el=wrap.current;if(!el)return;const io=new IntersectionObserver(([e])=>onVisible(channel.id,e.isIntersecting&&e.intersectionRatio>=.58),{threshold:[0,.25,.58,.85]});io.observe(el);return()=>io.disconnect();},[channel.id,onVisible]);

 const cleanup=useCallback(()=>{if(retryTimer.current)clearTimeout(retryTimer.current);retryTimer.current=null;hls.current?.destroy();hls.current=null;const v=ref.current;if(v){v.pause();v.removeAttribute('src');v.load();}},[]);
 const healthy=useCallback(()=>{setStarting(false);setError(false);setNeedsGesture(false);retryRef.current=0;onHealth?.(channel.id,true);},[channel.id,onHealth]);

 const retry=useCallback(()=>{if(!active)return;if(retryTimer.current)clearTimeout(retryTimer.current);const isHls=/\.m3u8(?:$|[?#])/i.test(channel.url);if(!isHls&&retryRef.current>=3){setStarting(false);setError(true);onHealth?.(channel.id,false);return;}if(isHls&&retryRef.current>=4){setStarting(false);setError(true);onHealth?.(channel.id,false);return;}retryRef.current++;retryTimer.current=setTimeout(()=>active&&startRef.current?.(),700*Math.pow(2,Math.min(retryRef.current-1,3)));},[active,channel.id,channel.url,onHealth]);

 const start=useCallback(()=>{
  const video=ref.current;if(!video||!active)return;cleanup();setStarting(true);setError(false);setNeedsGesture(false);
  window.dispatchEvent(new CustomEvent('testagram-tv-play',{detail:channel.id}));video.playsInline=true;video.autoplay=true;video.defaultMuted=audioPreferenceRef.current;video.muted=audioPreferenceRef.current;video.volume=1;
  const play=()=>{video.muted=audioPreferenceRef.current;video.defaultMuted=audioPreferenceRef.current;video.volume=1;void video.play().then(()=>{setNeedsGesture(false);healthy();}).catch((e:any)=>{if(e?.name==='NotAllowedError'){setNeedsGesture(true);setStarting(false);return;}retry();});};
  const directUrl=channel.url;
  const looksLikeHls=/\.m3u8(?:$|[?#])/i.test(directUrl);
  const network=networkProfile(); const playbackUrl=looksLikeHls||proxyFallbackRef.current?proxyUrl():directUrl;
  const looksLikeFile=/\.(mp4|webm|ogg)(?:$|[?#])/i.test(directUrl);
  if(looksLikeFile){
    video.src=playbackUrl;
    video.addEventListener('loadedmetadata',play,{once:true});
    video.addEventListener('canplay',healthy,{once:true});
    video.addEventListener('playing',healthy,{once:true});
    video.addEventListener('error',()=>{if(!proxyFallbackRef.current){proxyFallbackRef.current=true;retryRef.current=0;startRef.current?.();}else retry();},{once:true});
    void video.play().catch((e:any)=>{if(e?.name!=='NotAllowedError')retry();else{setNeedsGesture(true);setStarting(false);}});
    return;
  }
  if(looksLikeHls&&Hls.isSupported()){const h=new Hls({enableWorker:true,lowLatencyMode:false,startFragPrefetch:false,initialLiveManifestSize:network.constrained?5:network.moderate?4:3,backBufferLength:network.constrained?6:12,maxBufferLength:network.constrained?75:network.moderate?60:45,maxMaxBufferLength:network.constrained?150:network.moderate?120:90,maxBufferSize:network.constrained?64*1024*1024:128*1024*1024,maxBufferHole:0.5,highBufferWatchdogPeriod:network.constrained?5:3,nudgeOffset:0.15,nudgeMaxRetry:5,liveSyncDurationCount:network.constrained?8:network.moderate?7:6,liveMaxLatencyDurationCount:network.constrained?16:network.moderate?14:12,manifestLoadingMaxRetry:6,levelLoadingMaxRetry:6,fragLoadingMaxRetry:7,fragLoadingRetryDelay:1200,fragLoadingMaxRetryTimeout:12000});hls.current=h;h.loadSource(playbackUrl);h.attachMedia(video); if(network.constrained){h.startLevel=0;h.autoLevelCapping=0;}else if(network.moderate){h.startLevel=0;h.autoLevelCapping=1;}h.on(Hls.Events.MANIFEST_PARSED,()=>setStarting(true)); h.on(Hls.Events.LEVEL_SWITCHED,(_,d)=>{if(network.constrained&&d.level>0)h.nextLevel=0;});h.on(Hls.Events.FRAG_BUFFERED,()=>{const b=video.buffered;const ahead=b.length?b.end(b.length-1)-video.currentTime:0;if(ahead>=5)healthy();});h.on(Hls.Events.ERROR,(_,d)=>{if(!d.fatal)return;if(d.type===Hls.ErrorTypes.MEDIA_ERROR){try{h.recoverMediaError();return;}catch{}}retry();});return;}
  if(looksLikeHls&&video.canPlayType('application/vnd.apple.mpegurl')){video.src=playbackUrl;video.addEventListener('canplay',healthy,{once:true});video.addEventListener('error',()=>{if(!proxyFallbackRef.current){proxyFallbackRef.current=true;retryRef.current=0;startRef.current?.();}else retry();},{once:true});void video.play().catch((e:any)=>{if(e?.name!=='NotAllowedError')retry();});return;}
  setStarting(false);setError(true);onHealth?.(channel.id,false);
 },[active,channel.id,channel.url,cleanup,healthy,retry,onHealth,proxyUrl,networkProfile]);
 startRef.current=start;

 useEffect(()=>{retryRef.current=0;proxyFallbackRef.current=false;playbackUrlRef.current=channel.url;if(active){start();return cleanup;}cleanup();setError(false);setStarting(false);setNeedsGesture(false);},[active,channel.url,start,cleanup]);

 useEffect(()=>{const onOnline=()=>{retryRef.current=0;if(active)startRef.current?.();};const onOffline=()=>setStarting(true);window.addEventListener('online',onOnline);window.addEventListener('offline',onOffline);return()=>{window.removeEventListener('online',onOnline);window.removeEventListener('offline',onOffline);};},[active]);
 useEffect(()=>{const n=(navigator as any).connection;if(!n?.addEventListener)return;const changed=()=>{if(active){retryRef.current=0;startRef.current?.();}};n.addEventListener('change',changed);return()=>n.removeEventListener('change',changed);},[active,dataSaver]);
 useEffect(()=>{const video=ref.current;if(!video)return;const syncAudio=()=>{const isMuted=video.muted||video.volume===0;audioPreferenceRef.current=isMuted;setMuted(isMuted);};video.addEventListener('volumechange',syncAudio);return()=>video.removeEventListener('volumechange',syncAudio);},[]);
 useEffect(()=>{const video=ref.current;if(!video)return;const recoverable=()=>{if(active&&!starting)setStarting(true);retry();};video.addEventListener('waiting',recoverable);video.addEventListener('stalled',recoverable);return()=>{video.removeEventListener('waiting',recoverable);video.removeEventListener('stalled',recoverable);};},[active,retry,starting]);
 useEffect(()=>()=>{if(bandwidthTimerRef.current)clearInterval(bandwidthTimerRef.current);},[]);
 useEffect(()=>{const stop=(e:Event)=>{if((e as CustomEvent<string>).detail===channel.id)return;cleanup();setStarting(false);};window.addEventListener('testagram-tv-play',stop);return()=>window.removeEventListener('testagram-tv-play',stop);},[channel.id,cleanup]);

 const enableAudio=useCallback(async()=>{const v=ref.current;if(!v)return;audioPreferenceRef.current=false;v.defaultMuted=false;v.muted=false;v.volume=1;try{await v.play();setMuted(false);setNeedsGesture(false);try{localStorage.setItem('testagram-tv-audio','on');}catch{}}catch{setNeedsGesture(true);}},[]);
 const toggle=()=>{const v=ref.current;if(!v)return;const next=!muted;if(next){v.muted=true;setMuted(true);try{localStorage.setItem('testagram-tv-audio','off');}catch{}}else{void enableAudio();}};
 const fullscreen=()=>{(ref.current as any)?.requestFullscreen?.();};

 return <article ref={wrap} className='snap-start overflow-hidden rounded-2xl border bg-card shadow-sm'>
  <div className='relative aspect-video bg-gradient-to-br from-muted via-background to-muted'>
   {channel.logo&&<img src={channel.logo} alt='' loading='lazy' decoding='async' className='absolute inset-0 m-auto max-h-20 max-w-[42%] object-contain opacity-80' />}
   {active&&<video ref={ref} preload="auto" muted={muted} playsInline autoPlay className='absolute inset-0 h-full w-full object-contain bg-black' />}
   {!active&&<div className='absolute inset-0 bg-gradient-to-t from-black/75 via-black/10 to-transparent'><button onClick={()=>onVisible(channel.id,true)} className='absolute inset-0 flex items-center justify-center'><span className='rounded-full bg-background/95 p-4 shadow-lg'><Play className='h-7 w-7 fill-current'/></span></button></div>}
   {starting&&<div className='absolute inset-0 flex items-center justify-center pointer-events-none'><div className='rounded-full bg-black/70 px-3 py-2 text-xs text-white flex items-center gap-2'><RefreshCw className='w-4 h-4 animate-spin'/>Connecting…</div></div>}
   {error&&<div className='absolute inset-0 flex items-center justify-center bg-black/75 p-4 text-center text-white'><div><Radio className='mx-auto mb-2'/><p className='font-semibold'>Stream unavailable</p><p className='text-xs text-white/70 mt-1'>This source could not be played. The next channel remains available.</p></div></div>}
   {needsGesture&&!error&&<button onClick={()=>void enableAudio()} className='absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-black/80 px-4 py-2 text-sm font-semibold text-white'>Tap to enable sound</button>}
   <div className='absolute left-3 top-3 flex items-center gap-2 rounded-full bg-black/70 px-2.5 py-1 text-[11px] font-bold text-white'><span className='h-2 w-2 rounded-full bg-red-500 animate-pulse'/>LIVE</div>
  </div>
  <div className='p-3'>
   <div className='flex items-start justify-between gap-3'><div className='min-w-0'><h2 className='font-bold line-clamp-2'>{channel.name}</h2><div className='mt-1 flex items-center gap-2 text-xs text-muted-foreground'><Globe2 className='h-3.5 w-3.5'/><span>{channel.country||'International'}</span>{channel.group&&<><span>•</span><span className='truncate'>{channel.group}</span></>}</div></div><div className='flex shrink-0 gap-1'><Button size='icon' variant='outline' onClick={toggle} aria-label={muted?'Unmute channel':'Mute channel'} title={muted?'Enable channel sound':'Mute channel'}>{muted?<VolumeX/>:<Volume2/>}</Button><Button size='icon' variant='outline' onClick={fullscreen} aria-label='Fullscreen'><Maximize2/></Button></div></div>
   <div className='mt-2 flex items-center justify-between gap-2'><div className='text-[11px] text-muted-foreground truncate'>Source: {channel.source}</div><Button size='sm' variant={dataSaver?'default':'outline'} className='h-7 shrink-0 px-2 text-[11px]' onClick={()=>{const next=!dataSaver;setDataSaver(next);try{localStorage.setItem('testagram-tv-data-saver',next?'on':'off');}catch{};retryRef.current=0;if(active)startRef.current?.();}} title={dataSaver?'Data saver is on':'Use data saver on slow connections'}><Gauge className='mr-1 h-3.5 w-3.5'/>{dataSaver?'Data saver':'Save data'}</Button></div>
  </div>
 </article>;
}
