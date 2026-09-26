import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Room, RoomEvent, Track, createLocalTracks, LocalVideoTrack } from 'livekit-client';
import { Camera, CameraOff, Mic, MicOff, MonitorUp, Circle, Square, Radio, Users, Download, Clapperboard, Settings2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';

type Mode='studio'|'live';
export default function TvStudioPage(){
 const {streamId}=useParams(); const nav=useNavigate(); const {user}=useAuth();
 const videoRef=useRef<HTMLVideoElement>(null); const programRef=useRef<HTMLVideoElement>(null); const roomRef=useRef<Room|null>(null);
 const localStreamRef=useRef<MediaStream|null>(null); const recorderRef=useRef<MediaRecorder|null>(null); const chunksRef=useRef<Blob[]>([]);
 const [stream,setStream]=useState<any>(null); const [activeStreamId,setActiveStreamId]=useState<string|null>(streamId??null); const [mode,setMode]=useState<Mode>('studio'); const [recording,setRecording]=useState(false);
 const [live,setLive]=useState(false); const [muted,setMuted]=useState(false); const [camera,setCamera]=useState(true); const [sharing,setSharing]=useState(false);
 const [elapsed,setElapsed]=useState(0); const [viewerCount,setViewerCount]=useState(0); const [quality,setQuality]=useState('1080p');
 const [savedName,setSavedName]=useState<string|null>(null);

 useEffect(()=>{ if(!streamId)return; supabase.from('live_streams').select('*').eq('id',streamId).single().then(({data})=>setStream(data)); },[streamId]);
 useEffect(()=>()=>{ recorderRef.current?.stop(); localStreamRef.current?.getTracks().forEach(t=>t.stop()); roomRef.current?.disconnect(); },[]);
 useEffect(()=>{ if(!recording&&!live)return; const t=setInterval(()=>setElapsed(x=>x+1),1000); return()=>clearInterval(t)},[recording,live]);

 const token=async()=>{ const id=activeStreamId; if(!id)throw new Error('Broadcast id missing'); const {data,error}=await supabase.functions.invoke('livekit-tv-token',{body:{stream_id:id}}); if(error||!data?.data)throw new Error(data?.error?.message||error?.message||'Could not connect to live broadcast'); return data.data; };
 const startCamera=async()=>{
   if(localStreamRef.current)return;
   const s=await navigator.mediaDevices.getUserMedia({video:{width:{ideal:1920},height:{ideal:1080},frameRate:{ideal:30,max:30},facingMode:'user'},audio:{channelCount:1,sampleRate:48000,echoCancellation:true,noiseSuppression:true,autoGainControl:false}});
   localStreamRef.current=s; if(videoRef.current)videoRef.current.srcObject=s;
 };
 const startLive=async()=>{
   try{
    if(!user)throw new Error('Sign in to broadcast');
    let id=activeStreamId;
    if(!id){ const {data,error}=await supabase.from('live_streams').insert({user_id:user.id,title:'Testagram TV Live',description:'Live from Testagram TV Studio',category:'general',is_live:true}).select('id,title').single(); if(error||!data)throw new Error(error?.message||'Could not create broadcast'); id=data.id; setActiveStreamId(id); setStream(data); }
    await startCamera(); const info=await token(); const room=new Room({adaptiveStream:true,dynacast:true}); roomRef.current=room;
    await room.connect(info.url,info.token); const tracks=await createLocalTracks({video:false,audio:false});
    const stream=localStreamRef.current; if(!stream)throw new Error('Camera unavailable');
    const v=stream.getVideoTracks()[0],a=stream.getAudioTracks()[0];
    if(v)await room.localParticipant.publishTrack(new LocalVideoTrack(v),{name:'program-camera',simulcast:true});
    if(a){const {LocalAudioTrack}=await import('livekit-client'); await room.localParticipant.publishTrack(new LocalAudioTrack(a),{name:'program-mic'});}
    setLive(true); setMode('live'); toast.success('TV broadcast is live');
   }catch(e:any){toast.error(e?.message||'Unable to start live broadcast')}
 };
 const stopLive=async()=>{await roomRef.current?.disconnect();roomRef.current=null;setLive(false); if(activeStreamId)await supabase.from('live_streams').update({is_live:false,ended_at:new Date().toISOString()}).eq('id',activeStreamId)};
 const startRecording=async()=>{
   try{
    await startCamera(); const s=localStreamRef.current!; const type=['video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm'].find(x=>MediaRecorder.isTypeSupported(x))||'';
    const r=new MediaRecorder(s,{mimeType:type,videoBitsPerSecond:8000000,audioBitsPerSecond:128000}); chunksRef.current=[]; r.ondataavailable=e=>{if(e.data.size)chunksRef.current.push(e.data)};
    r.onstop=()=>{const blob=new Blob(chunksRef.current,{type:r.mimeType||'video/webm'}); const url=URL.createObjectURL(blob); const a=document.createElement('a'); const stamp=new Date().toISOString().replace(/[:.]/g,'-'); const name=`Testagram-TV-${stamp}.webm`; a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);setSavedName(name);toast.success('Recording saved to your device — nothing was uploaded to Testagram');};
    r.start(1000);recorderRef.current=r;setRecording(true);setElapsed(0);
   }catch(e:any){toast.error(e?.message||'Local recording is not supported on this device')}
 };
 const stopRecording=()=>{recorderRef.current?.stop();recorderRef.current=null;setRecording(false)};
 const toggleMic=()=>{const t=localStreamRef.current?.getAudioTracks()[0];if(t){t.enabled=!t.enabled;setMuted(!t.enabled)}};
 const toggleCamera=()=>{const t=localStreamRef.current?.getVideoTracks()[0];if(t){t.enabled=!t.enabled;setCamera(t.enabled)}};
 const shareScreen=async()=>{try{const s=await navigator.mediaDevices.getDisplayMedia({video:{frameRate:30},audio:true});const track=s.getVideoTracks()[0];if(videoRef.current)videoRef.current.srcObject=s;setSharing(true);track.onended=()=>{setSharing(false);if(videoRef.current&&localStreamRef.current)videoRef.current.srcObject=localStreamRef.current};}catch{}};
 const fmt=(n:number)=>`${String(Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`;
 return <div className="min-h-screen bg-zinc-950 text-white">
  <div className="max-w-7xl mx-auto p-3 md:p-6">
   <div className="flex items-center justify-between mb-4"><div><div className="flex items-center gap-2"><Clapperboard className="w-6 h-6"/><h1 className="text-2xl font-bold">Testagram TV Studio</h1>{live&&<span className="px-2 py-1 rounded-full bg-red-600 text-xs font-bold animate-pulse">LIVE</span>}</div><p className="text-sm text-zinc-400 mt-1">Broadcast live. Record locally. Your finished video never enters Testagram storage.</p></div><Button variant="outline" onClick={()=>nav('/spaces')}>Exit</Button></div>
   <div className="grid lg:grid-cols-[1fr_330px] gap-4">
    <section className="rounded-2xl overflow-hidden border border-white/10 bg-black">
     <div className="aspect-video relative flex items-center justify-center">{stream?.title&&!videoRef.current?.srcObject&&<div className="absolute inset-0 flex items-center justify-center text-zinc-500"><Radio className="w-12 h-12 mb-2"/></div>}<video ref={videoRef} autoPlay muted playsInline className="w-full h-full object-contain"/></div>
     <div className="p-3 border-t border-white/10 flex flex-wrap gap-2">
      <Button size="sm" variant={camera?'default':'destructive'} onClick={toggleCamera}><Camera className="w-4 h-4 mr-1"/>{camera?'Camera':'Camera off'}</Button>
      <Button size="sm" variant={!muted?'default':'destructive'} onClick={toggleMic}><Mic className="w-4 h-4 mr-1"/>{muted?'Mic off':'Mic'}</Button>
      <Button size="sm" variant={sharing?'secondary':'outline'} onClick={shareScreen}><MonitorUp className="w-4 h-4 mr-1"/>Screen</Button>
      {!recording?<Button size="sm" onClick={startRecording}><Circle className="w-4 h-4 mr-1"/>Record locally</Button>:<Button size="sm" variant="destructive" onClick={stopRecording}><Square className="w-4 h-4 mr-1"/>Stop & save {fmt(elapsed)}</Button>}
      {!live?<Button size="sm" className="bg-red-600 hover:bg-red-700" onClick={startLive}><Radio className="w-4 h-4 mr-1"/>Go live</Button>:<Button size="sm" variant="destructive" onClick={stopLive}>End live</Button>}
     </div>
    </section>
    <aside className="space-y-3">
     <div className="rounded-2xl border border-white/10 bg-zinc-900 p-4"><div className="flex items-center gap-2 font-semibold mb-3"><Settings2 className="w-4 h-4"/>Production controls</div><label className="text-xs text-zinc-400">Output quality</label><select value={quality} onChange={e=>setQuality(e.target.value)} className="w-full mt-1 rounded-lg bg-zinc-800 p-2"><option>1080p</option><option>720p</option><option>480p</option></select><div className="mt-4 text-xs text-zinc-400 space-y-2"><p>🎥 Camera: {camera?'on':'off'}</p><p>🎙️ Microphone: {muted?'muted':'on'}</p><p>💾 Recording: {recording?'device only':'off'}</p><p>📡 Broadcast: {live?'live to Testagram viewers':'off'}</p></div></div>
     <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4"><Download className="w-5 h-5 mb-2 text-emerald-400"/><p className="font-semibold">Local-first recording</p><p className="text-xs text-zinc-400 mt-1">The browser creates the recording locally and downloads it to the device. Testagram does not receive or store the recording.</p>{savedName&&<p className="text-xs text-emerald-400 mt-2 break-all">{savedName}</p>}</div>
     <div className="rounded-2xl border border-white/10 bg-zinc-900 p-4"><div className="flex items-center gap-2"><Users className="w-4 h-4"/><span>{viewerCount} viewers</span></div><p className="text-xs text-zinc-500 mt-2">Live viewer count can be connected to the existing stream viewer presence.</p></div>
    </aside>
   </div>
  </div>
 </div>
}