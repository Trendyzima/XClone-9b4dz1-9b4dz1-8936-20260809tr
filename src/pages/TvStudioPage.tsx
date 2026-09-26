import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
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
  const [searchParams] = useSearchParams();
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
  const [status, setStatus] = useState<'idle' | 'preview' | 'recording' | 'live'>('idle');
  const [saving, setSaving] = useState(false);
  const [recordingHint, setRecordingHint] = useState('Record locally on this device. Testagram never uploads the finished video.');
  const [permissionError, setPermissionError] = useState<string | null>(null);
  const [cameraPermission, setCameraPermission] = useState<PermissionState | 'unsupported'>('unsupported');
  const [microphonePermission, setMicrophonePermission] = useState<PermissionState | 'unsupported'>('unsupported');
  const [deviceReady, setDeviceReady] = useState(false);
  const broadcastTitle = searchParams.get('title')?.trim().slice(0, 100) || 'Testagram TV Live';
  const broadcastDescription = searchParams.get('description')?.trim().slice(0, 500) || 'Live from Testagram TV Studio';
  const broadcastCategory = searchParams.get('category')?.trim().slice(0, 50) || 'general';

  const explainMediaError = (error: any) => {
    const name = error?.name;
    if (!window.isSecureContext) return 'Camera and microphone require a secure HTTPS connection.';
    if (name === 'NotAllowedError' || name === 'PermissionDeniedError') return 'Browser permission for camera/microphone was denied. Open the Testagram site permissions, allow Camera and Microphone, then return and tap Preview again.';
    if (name === 'NotFoundError') return 'No usable camera or microphone was found. Connect a device and try again.';
    if (name === 'NotReadableError' || name === 'TrackStartError') return 'Camera or microphone is already being used by another app or tab. Close it and try again.';
    if (name === 'OverconstrainedError') return 'The selected capture settings are not supported by this device. Try 720p.';
    return error?.message || 'Could not start the studio camera and microphone.';
  };

  const showPermissionHelp = () => setPermissionError('Android Chrome: tap the lock/tune icon beside testagram.site → Permissions → Camera and Microphone → Allow, then return to Testagram and tap Preview.');


  useEffect(() => {
    if (!streamId) return;
    void supabase.from('live_streams').select('*').eq('id', streamId).single().then(({ data }) => setStream(data));
  }, [streamId]);

  useEffect(() => {
    return () => {
      recorderRef.current?.stop();
      roomRef.current?.disconnect();
      roomRef.current = null;
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
    await refreshPermissionState();
    if (!window.isSecureContext) throw new Error('Camera and microphone require HTTPS. Open https://testagram.site/spaces in a secure browser tab.');
    if (cameraPermission === 'denied' || microphonePermission === 'denied') {
      const denied = [cameraPermission === 'denied' ? 'camera' : '', microphonePermission === 'denied' ? 'microphone' : ''].filter(Boolean).join(' and ');
      const message = `Browser permission for ${denied} is blocked for Testagram. Open this site’s permissions, set ${denied} to Allow, then reload the page. The browser will not show a permission prompt while it remains blocked.`;
      setPermissionError(message);
      throw new Error(message);
    }
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser does not support camera/microphone capture. Use current Chrome, Edge, Firefox, or Safari over HTTPS.');
    const preset = VIDEO_PRESETS[quality];
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: preset.width }, height: { ideal: preset.height }, frameRate: { ideal: preset.fps, max: preset.fps }, facingMode: 'user' },
        audio: { channelCount: { ideal: 1 }, sampleRate: { ideal: 48000 }, sampleSize: { ideal: 24 }, echoCancellation: true, noiseSuppression: true, autoGainControl: false },
      });
      cameraStreamRef.current = s;
      setDeviceReady(true);
      setPermissionError(null);
      await refreshPermissionState();
      return s;
    } catch (error) {
      setDeviceReady(false);
      const message = explainMediaError(error);
      setPermissionError(message);
      throw new Error(message);
    }
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
          user_id: user.id, title: broadcastTitle, description: broadcastDescription,
          category: broadcastCategory, is_live: true,
        }).select('id,title').single();
        if (error || !data) throw new Error(error?.message || 'Could not create broadcast');
        id = data.id;
        setActiveStreamId(id);
        setStream(data);
        // This is only a transport locator. It is never a video URL or stored recording.
        await supabase.from('live_streams').update({ stream_url: `livekit://tv/${id}` }).eq('id', id);
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
      setStatus('live');
      setElapsed(0);
      void cameraStream;
      toast.success('TV broadcast is live');
    } catch (e: any) {
      const message = e?.message || 'Unable to start live broadcast';
      setPermissionError(message);
      toast.error(message);
    }
  };

  const stopLive = async () => {
    await roomRef.current?.disconnect();
    roomRef.current = null;
    setViewerCount(0);
    setLive(false);
    if (!recording) setStatus(cameraStreamRef.current ? 'preview' : 'idle');
    if (activeStreamId) {
      // Keep only broadcast metadata. End the control-plane record and remove the LiveKit locator;
      // no recording/blob/video URL is persisted by this studio.
      await supabase.from('live_streams').update({
        is_live: false,
        ended_at: new Date().toISOString(),
        stream_url: null,
      }).eq('id', activeStreamId).eq('user_id', user?.id ?? '');
      setActiveStreamId(null);
      setStream((prev: any) => prev ? { ...prev, is_live: false, ended_at: new Date().toISOString(), stream_url: null } : null);
    }
  };

  const startRecording = async () => {
    try {
      await ensureStudio();
      const program = rebuildProgramStream();
      const preset = VIDEO_PRESETS[quality];
      const mime = [
        'video/webm;codecs=vp9,opus',
        'video/webm;codecs=vp8,opus',
        'video/webm',
        'video/mp4;codecs=h264,aac',
        'video/mp4',
      ].find(x => MediaRecorder.isTypeSupported(x)) ?? '';
      const recorder = new MediaRecorder(program, {
        ...(mime ? { mimeType: mime } : {}),
        videoBitsPerSecond: preset.bitrate,
        audioBitsPerSecond: 192_000,
      });
      chunksRef.current = [];
      recorder.ondataavailable = e => { if (e.data.size) chunksRef.current.push(e.data); };
      recorder.onstop = () => {
        void (async () => {
          const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'video/webm' });
          const stamp = new Date().toISOString().replace(/[:.]/g, '-');
          const extension = recorder.mimeType.includes('mp4') ? 'mp4' : 'webm';
          const name = `Testagram-TV-${stamp}.${extension}`;
          setSaving(true);
          try {
            const picker = (window as any).showSaveFilePicker;
            if (typeof picker === 'function') {
              const handle = await picker({
                suggestedName: name,
                types: [{ description: 'Testagram TV recording', accept: extension === 'mp4' ? { 'video/mp4': ['.mp4'] } : { 'video/webm': ['.webm'] } }],
              });
              const writable = await handle.createWritable();
              await writable.write(blob);
              await writable.close();
            } else {
              const url = URL.createObjectURL(blob);
              downloadUrlRef.current = url;
              const a = document.createElement('a');
              a.href = url; a.download = name; a.rel = 'noopener';
              document.body.appendChild(a);
              a.click();
              a.remove();
            }
            setSavedName(name);
            setRecordingHint('Saved locally. To reuse it on Testagram, choose the saved file yourself — it is not kept on Testagram servers.');
            toast.success('Recording saved to your device. Testagram did not upload or publish it.');
          } catch (saveError: any) {
            if (saveError?.name !== 'AbortError') toast.error(saveError?.message || 'Could not save the local recording');
          } finally {
            setSaving(false);
            chunksRef.current = [];
            if (!live) setStatus(cameraStreamRef.current ? 'preview' : 'idle');
          }
        })();
      };
      recorder.start(1000);
      recorderRef.current = recorder;
      setRecording(true);
      setStatus('recording');
      setElapsed(0);
    } catch (e: any) {
      const message = explainMediaError(e);
      setPermissionError(message);
      setRecordingHint(message);
      toast.error(message);
    }
  };

  const stopRecording = () => {
    recorderRef.current?.stop();
    recorderRef.current = null;
    setRecording(false);
    if (!live) setStatus(cameraStreamRef.current ? 'preview' : 'idle');
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
              {!recording ? <Button size="sm" className="bg-red-600 hover:bg-red-700 text-white" disabled={saving} onClick={() => void startRecording()}><Circle className="w-4 h-4 mr-1" />REC to device</Button> : <Button size="sm" variant="destructive" onClick={stopRecording}><Square className="w-4 h-4 mr-1" />STOP & SAVE</Button>}
              {live && <span className="px-2 py-1 rounded-full bg-red-600 text-xs font-bold animate-pulse">LIVE</span>}
              {recording && <span className="px-2 py-1 rounded-full bg-white/10 text-xs font-bold">REC {fmt(elapsed)}</span>}
            </div>
            <p className="text-sm text-zinc-400 mt-1">Broadcast live to Testagram. Finished recordings stay on your phone/computer — never in Testagram storage.</p>
          </div>
          <Button variant="outline" onClick={() => nav('/spaces')}>Exit</Button>
        </header>

        <div className="grid lg:grid-cols-[1fr_330px] gap-4">
          {permissionError && (
            <div className="mb-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-100">
              <div className="font-semibold">Camera / microphone access needs attention</div>
              <p className="mt-1 text-xs text-amber-200/80">{permissionError}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button size="sm" onClick={() => void ensureStudio().then(() => setStatus('preview')).catch(() => undefined)}>Try again</Button>
                <Button size="sm" variant="outline" onClick={showPermissionHelp}>How to allow access</Button>
              </div>
            </div>
          )}
          <section className="rounded-2xl overflow-hidden border border-white/10 bg-black shadow-2xl">
            <div className="aspect-video relative flex items-center justify-center">
              {status === 'idle' && <div className="absolute inset-0 flex flex-col items-center justify-center text-zinc-500"><Radio className="w-12 h-12 mb-2" /><span>Studio preview</span><span className="text-xs mt-1">Tap Preview to start the camera and microphone</span></div>}
              <video ref={videoRef} autoPlay muted playsInline className="w-full h-full object-contain" />
              <div className="absolute top-3 left-3 flex gap-2 pointer-events-none">
                {live && <span className="px-2.5 py-1 rounded-full bg-red-600/90 text-xs font-bold">● LIVE</span>}
                {sharing && <span className="px-2.5 py-1 rounded-full bg-blue-600/90 text-xs font-bold">SCREEN</span>}
              </div>
            </div>
            <div className="p-3 border-t border-white/10 flex flex-wrap gap-2">
              <Button size="sm" disabled={saving} onClick={() => void ensureStudio().then(() => setStatus('preview'))}><Camera className="w-4 h-4 mr-1" />Preview</Button>
              <Button size="sm" variant={camera ? 'default' : 'destructive'} onClick={toggleCamera}><Camera className="w-4 h-4 mr-1" />{camera ? 'Camera' : 'Camera off'}</Button>
              <Button size="sm" variant={!muted ? 'default' : 'destructive'} onClick={toggleMic}><Mic className="w-4 h-4 mr-1" />{muted ? 'Mic off' : 'Mic'}</Button>
              <Button size="sm" variant={sharing ? 'secondary' : 'outline'} onClick={() => void shareScreen()}><MonitorUp className="w-4 h-4 mr-1" />{sharing ? 'Stop screen' : 'Screen'}</Button>
              {!recording ? <Button size="sm" disabled={saving} onClick={() => void startRecording()}><Circle className="w-4 h-4 mr-1" />Record locally</Button> : <Button size="sm" variant="destructive" onClick={stopRecording}><Square className="w-4 h-4 mr-1" />Stop & save</Button>}
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
              <div className="mt-4 flex items-center justify-between text-[10px] text-zinc-500"><span>Studio signal</span><span className="uppercase tracking-wider">{deviceReady ? status : 'waiting for device'}</span></div>
              <div className="mt-1 h-2 rounded-full bg-white/10 overflow-hidden"><div className="h-full bg-emerald-400 transition-all" style={{ width: `${Math.min(100, audioLevel)}%` }} /></div>
              <p className="text-[10px] text-zinc-500 mt-1">Microphone level • browser noise suppression + studio gate/compressor</p>
            </div>

            <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4">
              <Download className="w-5 h-5 mb-2 text-emerald-400" />
              <div className="flex items-center justify-between gap-2"><p className="font-semibold">Device-only recording</p>{saving && <span className="text-[10px] text-emerald-400 animate-pulse">SAVING…</span>}</div>
              <p className="text-xs text-zinc-400 mt-1">{recordingHint}</p>
              {savedName && <p className="text-xs text-emerald-400 mt-2 break-all">{savedName}</p>}
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
