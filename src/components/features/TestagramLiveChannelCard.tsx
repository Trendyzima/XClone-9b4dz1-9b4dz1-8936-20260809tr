import {useEffect,useRef,useState} from 'react';
import {Room,RoomEvent,Track} from 'livekit-client';
import {Radio,Volume2,VolumeX,Maximize2,Users,ExternalLink} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {supabase} from '@/lib/supabase';
import {useNavigate} from 'react-router-dom';

type Props={stream:any};
export function TestagramLiveChannelCard({stream}:Props){
 const nav=useNavigate(); const videoRef=useRef<HTMLVideoElement>(null); const audioHost=useRef<HTMLDivElement>(null); const roomRef=useRef<Room|null>(null);
 const [muted,setMuted]=useState(true); const [connected,setConnected]=useState(false); const [error,setError]=useState(false); const [viewers,setViewers]=useState(Number(stream.viewer_count||0));
 const [channelHandle,setChannelHandle]=useState<string|null>(null);
 useEffect(()=>{void (async()=>{const {data}=await supabase.from('channel_profiles').select('handle').eq('channel_key','tv:'+stream.id).maybeSingle();setChannelHandle(data?.handle??null)})();},[stream.id]);
 useEffect(()=>{
  let cancelled=false;
  const connect=async()=>{
   try{
    const {data,error:tokenError}=await supabase.functions.invoke('livekit-tv-token',{body:{stream_id:stream.id}});
    if(cancelled||tokenError||!data?.data) throw tokenError||new Error('Live connection unavailable');
    const room=new Room({adaptiveStream:true,dynacast:true}); roomRef.current=room;
    const count=()=>setViewers(room.remoteParticipants.size);
    room.on(RoomEvent.ParticipantConnected,count); room.on(RoomEvent.ParticipantDisconnected,count);
    room.on(RoomEvent.TrackSubscribed,(track:any)=>{
      if(cancelled)return;
      if(track.kind===Track.Kind.Video&&videoRef.current){track.attach(videoRef.current);void videoRef.current.play().catch(()=>{});}
      if(track.kind===Track.Kind.Audio&&audioHost.current){const a=document.createElement('audio');a.autoplay=true;a.dataset.sid=track.sid;audioHost.current.appendChild(a);track.attach(a);void a.play().catch(()=>{});}
    });
    await room.connect(data.data.url,data.data.token);
    if(cancelled){await room.disconnect();return;}
    room.remoteParticipants.forEach(p=>p.trackPublications.forEach(pub=>{if(!pub.track)return;const track:any=pub.track;if(track.kind===Track.Kind.Video&&videoRef.current)track.attach(videoRef.current);if(track.kind===Track.Kind.Audio&&audioHost.current){const a=document.createElement('audio');a.autoplay=true;a.dataset.sid=track.sid;audioHost.current.appendChild(a);track.attach(a);}}));
    setConnected(true);setError(false);count();
   }catch{if(!cancelled){setConnected(false);setError(true);}}
  };
  void connect();
  return()=>{cancelled=true;roomRef.current?.disconnect();roomRef.current=null;if(audioHost.current)audioHost.current.replaceChildren();if(videoRef.current)videoRef.current.srcObject=null;};
 },[stream.id]);
 const toggle=()=>{const next=!muted;setMuted(next);if(videoRef.current){videoRef.current.muted=next;void videoRef.current.play().catch(()=>{});}};
 return <article className="overflow-hidden rounded-2xl border bg-card shadow-sm">
  <div className="relative aspect-video bg-black">
   <video ref={videoRef} muted={muted} playsInline autoPlay controls className="absolute inset-0 w-full h-full object-contain" />
   <div ref={audioHost} className="hidden"/>
   <div className="absolute left-3 top-3 flex items-center gap-2 rounded-full bg-red-600 px-2.5 py-1 text-[11px] font-black text-white"><span className="h-2 w-2 rounded-full bg-white animate-pulse"/>TESTAGRAM LIVE</div>
   {!connected&&<div className="absolute inset-0 flex items-center justify-center bg-black/65 text-white text-sm">{error?'Live connection unavailable':'Connecting to live broadcast…'}</div>}
  </div>
  <div className="p-3">
   <div className="flex items-start gap-3">
    <div className="min-w-0 flex-1"><h2 className="font-bold line-clamp-2">{stream.title}</h2><p className="text-xs text-muted-foreground mt-1">{stream.description||'Live from Testagram TV Studio'}</p><div className="mt-2 flex items-center gap-3 text-[11px] text-muted-foreground"><span className="flex items-center gap-1"><Users className="w-3.5 h-3.5"/>{viewers} watching</span><span className="text-red-500 font-semibold">LIVE</span></div></div>
    <div className="flex gap-1 shrink-0">{channelHandle&&<Button size="sm" variant="outline" onClick={()=>nav('/channel/'+channelHandle)} aria-label="Open channel profile">Profile</Button>}<Button size="icon" variant="outline" onClick={toggle} aria-label={muted?'Unmute':'Mute'}>{muted?<VolumeX/>:<Volume2/>}</Button><Button size="icon" variant="outline" onClick={()=>videoRef.current?.requestFullscreen?.()} aria-label="Fullscreen"><Maximize2/></Button></div>
   </div>
   <button onClick={()=>nav('/stream/'+stream.id)} className="mt-3 w-full rounded-xl border py-2 text-xs font-bold flex items-center justify-center gap-1.5 hover:bg-muted"><ExternalLink className="w-3.5 h-3.5"/>Open live room</button>
  </div>
 </article>;
}
