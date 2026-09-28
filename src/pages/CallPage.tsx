import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Camera, Mic, PhoneOff, ShieldCheck, Video, VideoOff, MicOff, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { communicationService } from '@/services/communicationService';
import { TestagramMediaSession } from '@/lib/testagramMedia';

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
  const sessionRef = useRef<TestagramMediaSession | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteMediaRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!user) { navigate('/auth'); return; }
    setLoading(false);
    return () => {
      void sessionRef.current?.close();
      sessionRef.current = null;
      localStreamRef.current?.getTracks().forEach(track => track.stop());
      localStreamRef.current = null;
    };
  }, [user, navigate]);

  const attachRemoteTrack = (track: MediaStreamTrack) => {
    if (!remoteMediaRef.current) return;
    if (remoteMediaRef.current.querySelector('[data-track-id="' + track.id + '"]')) return;
    if (track.kind === 'video') {
      const element = document.createElement('video');
      element.dataset.trackId = track.id;
      element.autoplay = true;
      element.playsInline = true;
      element.className = 'w-full h-full object-cover rounded-3xl bg-black';
      element.srcObject = new MediaStream([track]);
      remoteMediaRef.current.appendChild(element);
      void element.play().catch(() => undefined);
    } else {
      const element = document.createElement('audio');
      element.dataset.trackId = track.id;
      element.autoplay = true;
      element.srcObject = new MediaStream([track]);
      remoteMediaRef.current.appendChild(element);
      void element.play().catch(() => undefined);
    }
  };

  const join = async () => {
    if (!callId) return;
    setJoining(true);
    try {
      await communicationService.joinCall(callId);
      const local = await navigator.mediaDevices.getUserMedia({
        video: kind === 'video' ? { width: { ideal: 1280, max: 1920 }, height: { ideal: 720, max: 1080 }, frameRate: { ideal: 30, max: 30 } } : false,
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      });
      localStreamRef.current = local;
      local.getAudioTracks().forEach(track => { track.enabled = true; });
      local.getVideoTracks().forEach(track => { track.enabled = kind === 'video'; });
      const session = await TestagramMediaSession.connectCall(callId, local, stream => {
        for (const track of stream.getTracks()) attachRemoteTrack(track);
      });
      session.setParticipantCountHandler(count => setParticipantCount(Math.max(1, count)));
      sessionRef.current = session;
      setConnected(true);
      toast.success('Connected to Testagram native media');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to join call');
      await sessionRef.current?.close();
      sessionRef.current = null;
      localStreamRef.current?.getTracks().forEach(track => track.stop());
      localStreamRef.current = null;
    } finally { setJoining(false); }
  };

  const toggleMic = () => {
    const track = localStreamRef.current?.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setMicEnabled(track.enabled);
  };

  const toggleCamera = () => {
    if (kind !== 'video') return;
    const track = localStreamRef.current?.getVideoTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setCameraEnabled(track.enabled);
  };

  const end = async () => {
    try { await sessionRef.current?.close(); } finally { sessionRef.current = null; }
    localStreamRef.current?.getTracks().forEach(track => track.stop());
    localStreamRef.current = null;
    if (callId) await communicationService.endCall(callId).catch(() => undefined);
    setConnected(false);
    setEnded(true);
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="h-7 w-7 animate-spin" /></div>;

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <header className="h-14 border-b border-border flex items-center gap-3 px-4">
        <button onClick={() => navigate(-1)} className="p-2 rounded-full hover:bg-muted" aria-label="Back"><ArrowLeft className="h-5 w-5" /></button>
        <div className="min-w-0"><h1 className="font-bold truncate">{kind === 'video' ? 'Video call' : 'Voice call'}</h1><p className="text-xs text-muted-foreground">{connected ? String(participantCount) + ' participant' + (participantCount === 1 ? '' : 's') : 'Testagram native secure call'}</p></div>
      </header>
      <main className="flex-1 p-3 sm:p-5 flex flex-col gap-4">
        <section className="relative flex-1 min-h-[55vh] rounded-3xl bg-black overflow-hidden border border-border">
          <div ref={remoteMediaRef} className="absolute inset-0 grid grid-cols-1 sm:grid-cols-2 gap-2 p-2" />
          {!connected && <div className="absolute inset-0 flex flex-col items-center justify-center text-white text-center p-6"><div className="h-16 w-16 rounded-full bg-white/10 flex items-center justify-center mb-5">{kind === 'video' ? <Video className="h-7 w-7" /> : <Mic className="h-7 w-7" />}</div><h2 className="text-2xl font-bold">{ended ? 'Call ended' : 'Ready to connect'}</h2><p className="mt-2 max-w-sm text-sm text-white/70">Testagram identity and permissions stay in Testagram; realtime media is handled by the Testagram-owned WebRTC media engine.</p></div>}
          {connected && kind === 'video' && <video ref={el => { if (el && localStreamRef.current) el.srcObject = localStreamRef.current; }} muted autoPlay playsInline className="absolute right-3 bottom-3 w-32 sm:w-44 aspect-video object-cover rounded-2xl border border-white/20 bg-black shadow-xl" />}
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
