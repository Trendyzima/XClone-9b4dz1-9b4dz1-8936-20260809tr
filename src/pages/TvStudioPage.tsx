import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Room, RoomEvent, LocalAudioTrack, LocalVideoTrack } from 'livekit-client';
import { Camera, Mic, MonitorUp, Circle, Square, Radio, Users, Download, Clapperboard, Settings2, Activity, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import { createStudioAudioPipeline, requestStudioMicrophone, type StudioAudioPipeline } from '@/lib/studioAudio';

type Mode = 'studio' | 'live';
type Quality = '1080p' | '720p' | '480p';

const VIDEO_PRESETS: Record<Quality, { width: number; height: number; fps: number; bitrate: number }> = {
  '1080p': { width: 1920, height: 1080, fps: 30, bitrate: 8_000_000 },
  '720p': { width: 1280, height: 720, fps: 30, bitrate: 5_000_000 },
  '480p': { width: 854, height: 480, fps: 30, bitrate: 2_500_000 },
};

export default function TvStudioPage() {
  const { streamId } = useParams();
  const nav = useNavigate();
  const { user } = useAuth();

  const videoRef = useRef<HTMLVideoElement>(null);
  const roomRef = useRef<Room | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const programStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const audioPipelineRef = useRef<StudioAudioPipeline | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const downloadUrlRef = useRef<string | null>(null);

  const [stream, setStream] = useState<any>(null);
  const [activeStreamId, setActiveStreamId] = useState<string | null>(streamId ?? null);
  const [mode, setMode] = useState<Mode>('studio');
  const [recording, setRecording] = useState(false);
  const [live, setLive] = useState(false);
  const [muted, setMuted] = useState(false);
  const [camera, setCamera] = useState(true);
  const [sharing, setSharing] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [viewerCount, setViewerCount] = useState(0);
  const [quality, setQuality] = useState<Quality>('1080p');
  const [savedName, setSavedName] = useState<string | null>(null);
  const [audioLevel, setAudioLevel] = useState(0);

  useEffect(() => {
    if (!streamId) return;
    void supabase.from('live_streams').select('*').eq('id', streamId).single().then(({ data }) => setStream(data));
  }, [streamId]);

  useEffect(() => {
    return () => {
      recorderRef.current?.stop();
      roomRef.current?.disconnect();
      screenStreamRef.current?.getTracks().forEach(t => t.stop());
      cameraStreamRef.current?.getTracks().forEach(t => t.stop());
      void audioPipelineRef.current?.stop();
      if (downloadUrlRef.current) URL.revokeObjectURL(downloadUrlRef.current);
    };
  }, []);

  useEffect(() => {
    if (!recording && !live) return;
    const t = window.setInterval(() => setElapsed(x => x + 1), 1000);
    return () => window.clearInterval(t);
  }, [recording, live]);

  useEffect(() => {
    if (!audioPipelineRef.current) return;
    const id = window.setInterval(() => setAudioLevel(audioPipelineRef.current?.getLevel() ?? 0), 120);
    return () => window.clearInterval(id);
  }, [camera, muted, sharing, live, recording]);

  const token = async (requestedId?: string) => {
    const id = requestedId ?? activeStreamId;
    if (!id) throw new Error('Broadcast id missing');
    const { data, error } = await supabase.functions.invoke('livekit-tv-token', { body: { stream_id: id } });
    if (error || !data?.data) throw new Error(data?.error?.message || error?.message || 'Could not connect to live broadcast');
    return data.data;
  };

  const getCamera = async () => {
    const preset = VIDEO_PRESETS[quality];
    const s = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: preset.width }, height: { ideal: preset.height }, frameRate: { ideal: preset.fps, max: preset.fps }, facingMode: 'user' },
      audio: { channelCount: { ideal: 1 }, sampleRate: { ideal: 48000 }, sampleSize: { ideal: 24 }, echoCancellation: true, noiseSuppression: true, autoGainControl: false },
    });
    cameraStreamRef.current = s;
    return s;
  };

  const ensureStudio = async () => {
    if (!cameraStreamRef.current) await getCamera();
    if (!audioPipelineRef.current && cameraStreamRef.current) {
      audioPipelineRef.current = await createStudioAudioPipeline(cameraStreamRef.current);
    }
    return cameraStreamRef.current!;
  };

  const rebuildProgramStream = () => {
    const source = screenStreamRef.current ?? cameraStreamRef.current;
    const video = source?.getVideoTracks()[0];
    const audio = audioPipelineRef.current?.stream.getAudioTracks()[0];
    if (!video || !audio) throw new Error('Camera/microphone is not ready');
    const program = new MediaStream([video, audio]);
    programStreamRef.current = program;
    if (videoRef.current) videoRef.current.srcObject = source ?? program;
    return program;
  };

  const publishProgram = async (room: Room, program: MediaStream) => {
    const video = program.getVideoTracks()[0];
    const audio = program.getAudioTracks()[0];
    if (video) await room.localParticipant.publishTrack(new LocalVideoTrack(video), { name: 'program-video', simulcast: true });
    if (audio) await room.localParticipant.publishTrack(new LocalAudioTrack(audio), { name: 'program-audio' });
  };

  const startLive = async () => {
    try {
      if (!user) throw new Error('Sign in to broadcast');
      const cameraStream = await ensureStudio();
      const program = rebuildProgramStream();
      let id = activeStreamId;

      if (!id) {
        const { data, error } = await supabase.from('live_streams').insert({
          user_id: user.id, title: 'Testagram TV Live', description: 'Live from Testagram TV Studio',
          category: 'general', is_live: true,
        }).select('id,title').single();
        if (error || !data) throw new Error(error?.message || 'Could not create broadcast');
        id = data.id;
        setActiveStreamId(id);
        setStream(data);
      }

      const info = await token(id);
      const room = new Room({ adaptiveStream: true, dynacast: true });
      roomRef.current = room;
      room.on(RoomEvent.ParticipantConnected, () => setViewerCount(room.remoteParticipants.size));
      room.on(RoomEvent.ParticipantDisconnected, () => setViewerCount(room.remoteParticipants.size));
      await room.connect(info.url, info.token);
      await publishProgram(room, program);
      setViewerCount(room.remoteParticipants.size);
      setLive(true);
      setMode('live');
      setElapsed(0);
      void cameraStream;
      toast.success('TV broadcast is live');
    } catch (e: any) {
      toast.error(e?.message || 'Unable to start live broadcast');
    }
  };

  const stopLive = async () => {
    await roomRef.current?.disconnect();
    roomRef.current = null;
    setViewerCount(0);
    setLive(false);
    if (activeStreamId) {
      await supabase.from('live_streams').update({ is_live: false, ended_at: new Date().toISOString() }).eq('id', activeStreamId);
    }
  };

  const startRecording = async () => {
    try {
      await ensureStudio();
      const program = rebuildProgramStream();
      const preset = VIDEO_PRESETS[quality];
      const mime = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find(x => MediaRecorder.isTypeSupported(x)) ?? '';
      const recorder = new MediaRecorder(program, {
        ...(mime ? { mimeType: mime } : {}),
        videoBitsPerSecond: preset.bitrate,
        audioBitsPerSecond: 192_000,
      });
      chunksRef.current = [];
      recorder.ondataavailable = e => { if (e.data.size) chunksRef.current.push(e.data); };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'video/webm' });
        const url = URL.createObjectURL(blob);
        downloadUrlRef.current = url;
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const name = `Testagram-TV-${stamp}.webm`;
        const a = document.createElement('a');
        a.href = url; a.download = name; a.rel = 'noopener'; a.click();
        setSavedName(name);
        toast.success('Recording saved to your device — no video was uploaded to Testagram');
      };
      recorder.start(1000);
      recorderRef.current = recorder;
      setRecording(true);
      setElapsed(0);
    } catch (e: any) {
      toast.error(e?.message || 'Local recording is not supported on this device');
    }
  };

  const stopRecording = () => {
    recorderRef.current?.stop();
    recorderRef.current = null;
    setRecording(false);
  };

  const toggleMic = () => {
    const t = audioPipelineRef.current?.stream.getAudioTracks()[0];
    if (t) { t.enabled = !t.enabled; setMuted(!t.enabled); }
  };

  const toggleCamera = () => {
    const t = cameraStreamRef.current?.getVideoTracks()[0];
    if (t) { t.enabled = !t.enabled; setCamera(t.enabled); }
  };

  const shareScreen = async () => {
    try {
      if (sharing) {
        screenStreamRef.current?.getTracks().forEach(t => t.stop());
        screenStreamRef.current = null;
        setSharing(false);
        rebuildProgramStream();
        return;
      }
      const preset = VIDEO_PRESETS[quality];
      const s = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: preset.fps }, audio: false });
      screenStreamRef.current = s;
      const track = s.getVideoTracks()[0];
      track.onended = () => {
        screenStreamRef.current = null;
        setSharing(false);
        if (cameraStreamRef.current) rebuildProgramStream();
      };
      setSharing(true);
      const program = rebuildProgramStream();

      const room = roomRef.current;
      const publication = room?.localParticipant.videoTrackPublications.values().next().value;
      if (publication?.track && room) await publication.track.replaceTrack?.(track);
      void program;
    } catch (e: any) {
      if (e?.name !== 'NotAllowedError') toast.error('Screen sharing could not start');
    }
  };

  const fmt = (n: number) => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <div className="max-w-7xl mx-auto p-3 md:p-6">
        <header className="flex items-center justify-between mb-4 gap-3">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <Clapperboard className="w-6 h-6" />
              <h1 className="text-2xl font-bold">Testagram TV Studio</h1>
              {live && <span className="px-2 py-1 rounded-full bg-red-600 text-xs font-bold animate-pulse">LIVE</span>}
              {recording && <span className="px-2 py-1 rounded-full bg-white/10 text-xs font-bold">REC {fmt(elapsed)}</span>}
            </div>
            <p className="text-sm text-zinc-400 mt-1">Broadcast to Testagram while your finished production stays on your device.</p>
          </div>
          <Button variant="outline" onClick={() => nav('/spaces')}>Exit</Button>
        </header>

        <div className="grid lg:grid-cols-[1fr_330px] gap-4">
          <section className="rounded-2xl overflow-hidden border border-white/10 bg-black shadow-2xl">
            <div className="aspect-video relative flex items-center justify-center">
              {!cameraStreamRef.current && <div className="absolute inset-0 flex flex-col items-center justify-center text-zinc-500"><Radio className="w-12 h-12 mb-2" /><span>Studio preview</span></div>}
              <video ref={videoRef} autoPlay muted playsInline className="w-full h-full object-contain" />
              <div className="absolute top-3 left-3 flex gap-2 pointer-events-none">
                {live && <span className="px-2.5 py-1 rounded-full bg-red-600/90 text-xs font-bold">● LIVE</span>}
                {sharing && <span className="px-2.5 py-1 rounded-full bg-blue-600/90 text-xs font-bold">SCREEN</span>}
              </div>
            </div>
            <div className="p-3 border-t border-white/10 flex flex-wrap gap-2">
              <Button size="sm" onClick={() => void ensureStudio()}><Camera className="w-4 h-4 mr-1" />Preview</Button>
              <Button size="sm" variant={camera ? 'default' : 'destructive'} onClick={toggleCamera}><Camera className="w-4 h-4 mr-1" />{camera ? 'Camera' : 'Camera off'}</Button>
              <Button size="sm" variant={!muted ? 'default' : 'destructive'} onClick={toggleMic}><Mic className="w-4 h-4 mr-1" />{muted ? 'Mic off' : 'Mic'}</Button>
              <Button size="sm" variant={sharing ? 'secondary' : 'outline'} onClick={() => void shareScreen()}><MonitorUp className="w-4 h-4 mr-1" />{sharing ? 'Stop screen' : 'Screen'}</Button>
              {!recording ? <Button size="sm" onClick={() => void startRecording()}><Circle className="w-4 h-4 mr-1" />Record locally</Button> : <Button size="sm" variant="destructive" onClick={stopRecording}><Square className="w-4 h-4 mr-1" />Stop & save</Button>}
              {!live ? <Button size="sm" className="bg-red-600 hover:bg-red-700" onClick={() => void startLive()}><Radio className="w-4 h-4 mr-1" />Go live</Button> : <Button size="sm" variant="destructive" onClick={() => void stopLive()}>End live</Button>}
            </div>
          </section>

          <aside className="space-y-3">
            <div className="rounded-2xl border border-white/10 bg-zinc-900 p-4">
              <div className="flex items-center gap-2 font-semibold mb-3"><Settings2 className="w-4 h-4" />Production controls</div>
              <label className="text-xs text-zinc-400">Capture quality</label>
              <select value={quality} disabled={live || recording} onChange={e => setQuality(e.target.value as Quality)} className="w-full mt-1 rounded-lg bg-zinc-800 p-2">
                <option>1080p</option><option>720p</option><option>480p</option>
              </select>
              <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-lg bg-black/30 p-2"><Activity className="w-3.5 h-3.5 mb-1 text-emerald-400" /><span>{quality}</span><p className="text-zinc-500">capture</p></div>
                <div className="rounded-lg bg-black/30 p-2"><Mic className="w-3.5 h-3.5 mb-1 text-emerald-400" /><span>48 kHz</span><p className="text-zinc-500">processed audio</p></div>
                <div className="rounded-lg bg-black/30 p-2"><Users className="w-3.5 h-3.5 mb-1 text-blue-400" /><span>{viewerCount}</span><p className="text-zinc-500">live viewers</p></div>
                <div className="rounded-lg bg-black/30 p-2"><ShieldCheck className="w-3.5 h-3.5 mb-1 text-emerald-400" /><span>Local</span><p className="text-zinc-500">recording storage</p></div>
              </div>
              <div className="mt-4 h-2 rounded-full bg-white/10 overflow-hidden"><div className="h-full bg-emerald-400 transition-all" style={{ width: `${Math.min(100, audioLevel)}%` }} /></div>
              <p className="text-[10px] text-zinc-500 mt-1">Microphone level • browser noise suppression + studio gate/compressor</p>
            </div>

            <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4">
              <Download className="w-5 h-5 mb-2 text-emerald-400" />
              <p className="font-semibold">Device-only recording</p>
              <p className="text-xs text-zinc-400 mt-1">Recorded media is assembled in the browser and downloaded locally. It is never uploaded as a recording asset.</p>
              {savedName && <p className="text-xs text-emerald-400 mt-2 break-all">{savedName}</p>}
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
