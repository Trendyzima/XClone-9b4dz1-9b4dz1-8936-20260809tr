import { useEffect, useRef, useState } from 'react';
const VAST_TAG = 'https://s.magsrv.com/v1/vast.php?idzone=6052130';
const IMA_SRC = 'https://imasdk.googleapis.com/js/sdkloader/ima3.js';
declare global { interface Window { google?: { ima?: any }; __testagramIma?: Promise<void> } }
function loadIma(): Promise<void> {
 if (window.google?.ima) return Promise.resolve();
 if (window.__testagramIma) return window.__testagramIma;
 window.__testagramIma = new Promise<void>((resolve,reject)=>{let s=document.querySelector<HTMLScriptElement>('script[data-testagram-ima]');const t=window.setTimeout(()=>reject(new Error('IMA timeout')),7000);const ok=()=>{window.clearTimeout(t);resolve()};const bad=()=>{window.clearTimeout(t);reject(new Error('IMA unavailable'))};if(!s){s=document.createElement('script');s.src=IMA_SRC;s.async=true;s.dataset.testagramIma='1';document.head.appendChild(s)}s.addEventListener('load',ok,{once:true});s.addEventListener('error',bad,{once:true})}).catch(e=>{window.__testagramIma=undefined;throw e});
 return window.__testagramIma;
}
export function ExoClickVastPreRoll({onComplete}:{onComplete:()=>void}) {
 const video=useRef<HTMLVideoElement>(null),container=useRef<HTMLDivElement>(null),manager=useRef<any>(null),done=useRef(false);
 const [canSkip,setCanSkip]=useState(false),[status,setStatus]=useState('Loading sponsored video…');
 useEffect(()=>{let disposed=false,started=false,startedAt=0,timeout=0,poll=0;const finish=()=>{if(disposed||done.current)return;done.current=true;clearTimeout(timeout);clearInterval(poll);try{manager.current?.destroy()}catch{}manager.current=null;onComplete()};
 timeout=window.setTimeout(()=>{if(!started)finish()},9000);
 void loadIma().then(()=>{if(disposed||!window.google?.ima||!video.current||!container.current)return;const ima=window.google.ima,display=new ima.AdDisplayContainer(container.current,video.current),loader=new ima.AdsLoader(display);
 loader.addEventListener(ima.AdsManagerLoadedEvent.Type.ADS_MANAGER_LOADED,(event:any)=>{if(disposed)return;const ads=event.getAdsManager(video.current,new ima.AdsRenderingSettings());manager.current=ads;const types=ima.AdEvent.Type;const begin=()=>{started=true;startedAt=Date.now();setStatus('Sponsored');clearTimeout(timeout);poll=window.setInterval(()=>setCanSkip(Date.now()-startedAt>=5000&&Boolean(ads.getAdSkippableState?.())),250)};ads.addEventListener(types.CONTENT_PAUSE_REQUESTED,begin);ads.addEventListener(types.STARTED,begin);ads.addEventListener(types.SKIPPED,finish);ads.addEventListener(types.COMPLETE,finish);ads.addEventListener(types.ALL_ADS_COMPLETED,finish);ads.addEventListener(ima.AdErrorEvent.Type.AD_ERROR,finish);try{ads.init(container.current.clientWidth||640,container.current.clientHeight||360,ima.ViewMode.NORMAL);ads.start()}catch{finish()}},false);
 loader.addEventListener(ima.AdErrorEvent.Type.AD_ERROR,finish,false);display.initialize();const req=new ima.AdsRequest();req.adTagUrl=VAST_TAG;req.linearAdSlotWidth=container.current.clientWidth||640;req.linearAdSlotHeight=container.current.clientHeight||360;req.nonLinearAdSlotWidth=req.linearAdSlotWidth;req.nonLinearAdSlotHeight=Math.round(req.linearAdSlotHeight/3);loader.requestAds(req)
 }).catch(finish);
 return()=>{disposed=true;clearTimeout(timeout);clearInterval(poll);try{manager.current?.destroy()}catch{}manager.current=null}
 },[onComplete]);
 return <div className="absolute inset-0 z-30 bg-black" aria-label="Sponsored video advertisement"><video ref={video} className="absolute inset-0 h-full w-full object-contain" playsInline muted/><div ref={container} className="absolute inset-0"/><span className="absolute left-3 top-3 rounded bg-black/80 px-2.5 py-1.5 text-xs font-bold text-white">Sponsored</span><span className="absolute right-3 top-3 rounded bg-black/80 px-2.5 py-1.5 text-xs text-white">{status}</span>{canSkip&&<button type="button" onClick={()=>{try{manager.current?.skip()}catch{}}} className="absolute bottom-4 right-4 z-40 rounded-lg bg-white px-4 py-2 text-sm font-bold text-black">Skip ad</button>}</div>
}