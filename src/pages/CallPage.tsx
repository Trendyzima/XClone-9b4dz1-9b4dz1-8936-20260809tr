import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Camera, Mic, PhoneOff, ShieldCheck, Video, VideoOff, MicOff, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Room, RoomEvent, Track, type RemoteTrack, type RemoteTrackPublication, type RemoteParticipant } from 'livekit-client';
import { useAuth } from '@/hooks/useAuth';
import { communicationService } from '@/services/communicationService';

export default function CallPage() {
  const { callId } = useParams<{ callId: string }>();
  const [params] = useSearchParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const [ended, setEnded] = useState(false);
  const [connected, setConnected] = useState(false);
  const [micEnabled, setMicEnabled] = useState(true);
  const [cameraEnabled, setCameraEnabled] = useState(true);
  const [participantCount, setParticipantCount] = useState(1);
  const [kind] = useState<'voice' | 'video'>(() => params.get('kind') === 'voice' ? 'voice' : 'video');
  const roomRef = useRef<Room | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteMediaRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!user) { navigate('/auth'); return; }
    setLoading(false);
    return () => {
      void roomRef.current?.disconnect();
      roomRef.current = null;
    };
  }, [user, navigate]);

  const attachRemoteTrack = (track: RemoteTrack, participant: RemoteParticipant) => {
    if (!remoteMediaRef.current || track.kind !== Track.Kind.Video) return;
    const element = track.attach();
    element.dataset.participant = participant.identity;
    element.className = 'w-full h-full object-cover rounded-3xl bg-black';
    remoteMediaRef.current.appendChild(element);
  };

  const removeRemoteTrack = (track: RemoteTrack) => track.detach().forEach(element => element.remove());

  const join = async () => {
    if (!callId) return;
    setJoining(true);
    try {
      await communicationService.joinCall(callId);
      const credentials = await communicationService.getLiveKitToken(callId);
      const room = new Room({ adaptiveStream: true, dynacast: true, disconnectOnPageLeave: true });
      room.on(RoomEvent.TrackSubscribed, attachRemoteTrack);
      room.on(RoomEvent.TrackUnsubscribed, removeRemoteTrack);
      room.on(RoomEvent.ParticipantConnected, () => setParticipantCount(room.remoteParticipants.size + 1));
      room.on(RoomEvent.ParticipantDisconnected, () => setParticipantCount(Math.max(1, room.remoteParticipants.size + 1)));
      room.on(RoomEvent.Disconnected, () => { setConnected(false); setParticipantCount(1); });
      await room.connect(credentials.url, credentials.token);
      roomRef.current = room;
      setParticipantCount(room.remoteParticipants.size + 1);
      if (kind === 'video') await room.localParticipant.enableCameraAndMicrophone();
      else await room.localParticipant.setMicrophoneEnabled(true);
      const cameraPublication = Array.from(room.localParticipant.videoTrackPublications.values()).find(pub => pub.track);
      if (cameraPublication?.track && localVideoRef.current) cameraPublication.track.attach(localVideoRef.current);
      setConnected(true);
      toast.success('Connected securely');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to join call');
      await roomRef.current?.disconnect();
      roomRef.current = null;
    } finally {
      setJoining(false);
    }
  };

  const toggleMic = async () => {
    const room = roomRef.current;
    if (!room) return;
    const next = !micEnabled;
    await room.localParticipant.setMicrophoneEnabled(next);
    setMicEnabled(next);
  };

  const toggleCamera = async () => {
    const room = roomRef.current;
    if (!room || kind !== 'video') return;
    const next = !cameraEnabled;
    await room.localParticipant.setCameraEnabled(next);
    setCameraEnabled(next);
  };

  const end = async () => {
    try { await roomRef.current?.disconnect(); } finally { roomRef.current = null; }
    if (callId) await communicationService.endCall(callId).catch(() => undefined);
    setConnected(false);
    setEnded(true);
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="h-7 w-7 animate-spin" /></div>;

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <header className="h-14 border-b border-border flex items-center gap-3 px-4">
        <button onClick={() => navigate(-1)} className="p-2 rounded-full hover:bg-muted" aria-label="Back"><ArrowLeft className="h-5 w-5" /></button>
        <div className="min-w-0"><h1 className="font-bold truncate">{kind === 'video' ? 'Video call' : 'Voice call'}</h1><p className="text-xs text-muted-foreground">{connected ? `${participantCount} participant${participantCount === 1 ? '' : 's'}` : 'Testagram secure call'}</p></div>
      </header>
      <main className="flex-1 p-3 sm:p-5 flex flex-col gap-4">
        <section className="relative flex-1 min-h-[55vh] rounded-3xl bg-black overflow-hidden border border-border">
          <div ref={remoteMediaRef} className="absolute inset-0 flex items-center justify-center" />
          {!connected && <div className="absolute inset-0 flex flex-col items-center justify-center text-white text-center p-6"><div className="h-16 w-16 rounded-full bg-white/10 flex items-center justify-center mb-5">{kind === 'video' ? <Video className="h-7 w-7" /> : <Mic className="h-7 w-7" />}</div><h2 className="text-2xl font-bold">{ended ? 'Call ended' : 'Ready to connect'}</h2><p className="mt-2 max-w-sm text-sm text-white/70">Testagram keeps identity and permissions in Supabase while LiveKit handles realtime media transport.</p></div>}
          {connected && kind === 'video' && <video ref={localVideoRef} muted autoPlay playsInline className="absolute right-3 bottom-3 w-32 sm:w-44 aspect-video object-cover rounded-2xl border border-white/20 bg-black shadow-xl" />}
        </section>
        <div className="flex items-center justify-center gap-3">
          {!connected && !ended && <button onClick={join} disabled={joining} className="rounded-full bg-primary text-primary-foreground px-7 py-3 font-bold flex items-center gap-2">{joining ? <Loader2 className="h-4 w-4 animate-spin" /> : kind === 'video' ? <Video className="h-4 w-4" /> : <Mic className="h-4 w-4" />}{joining ? 'Connecting…' : 'Join call'}</button>}
          {connected && <>
            <button onClick={toggleMic} className="h-12 w-12 rounded-full border border-border bg-card flex items-center justify-center" aria-label={micEnabled ? 'Mute microphone' : 'Unmute microphone'}>{micEnabled ? <Mic className="h-5 w-5" /> : <MicOff className="h-5 w-5" />}</button>
            {kind === 'video' && <button onClick={toggleCamera} className="h-12 w-12 rounded-full border border-border bg-card flex items-center justify-center" aria-label={cameraEnabled ? 'Turn camera off' : 'Turn camera on'}>{cameraEnabled ? <Camera className="h-5 w-5" /> : <VideoOff className="h-5 w-5" />}</button>}
            <button onClick={end} className="h-12 px-6 rounded-full bg-destructive text-destructive-foreground font-bold flex items-center gap-2"><PhoneOff className="h-5 w-5" />Leave</button>
          </>}
          {!connected && !ended && <div className="hidden sm:flex items-center gap-2 text-xs text-muted-foreground"><ShieldCheck className="h-4 w-4" />Authenticated by Testagram</div>}
        </div>
      </main>
    </div>
  );
}
