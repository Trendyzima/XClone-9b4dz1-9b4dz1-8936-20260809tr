import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Room, RoomEvent, LocalAudioTrack, LocalVideoTrack } from 'livekit-client';
import { Camera, Mic, MonitorUp, Circle, Square, Radio, Users, Download, Clapperboard, Settings2, Activity, ShieldCheck, Upload, PictureInPicture2, Layers3 } from 'lucide-react';
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
  const sourceVideoRef = useRef<HTMLVideoElement | null>(null);
  const sourceVideoUrlRef = useRef<string | null>(null);
  const sceneCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const sceneAnimationRef = useRef<number | null>(null);
  const productionAudioContextRef = useRef<AudioContext | null>(null);
  const productionAudioDestinationRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const productionSourceAudioRef = useRef<MediaElementAudioSourceNode | null>(null);
  const productionSourceGainRef = useRef<GainNode | null>(null);
  const productionCommentaryGainRef = useRef<GainNode | null>(null);
  const productionVideoStreamRef = useRef<MediaStream | null>(null);
  const videoFileInputRef = useRef<HTMLInputElement | null>(null);
  const productionCameraVideoRef = useRef<HTMLVideoElement | null>(null);
  const productionKeyRef = useRef<string | null>(null);
  const pipEnabledRef = useRef(true);

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
  const [productionSource, setProductionSource] = useState<'camera' | 'video'>('camera');
  const [uploadedVideoName, setUploadedVideoName] = useState<string | null>(null);
  const [pipEnabled, setPipEnabled] = useState(true);
  const [sourceVideoPlaying, setSourceVideoPlaying] = useState(false);
  const [sourceVideoMuted, setSourceVideoMuted] = useState(false);
  const [commentaryLevel, setCommentaryLevel] = useState(1);
  const [programLevel, setProgramLevel] = useState(0.85);
  const [landscapeLocked, setLandscapeLocked] = useState(false);
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

  const readPermissionState = async () => {
    const states: { camera: PermissionState | 'unsupported'; microphone: PermissionState | 'unsupported' } = {
      camera: 'unsupported',
      microphone: 'unsupported',
    };
    if (!navigator.permissions?.query) return states;
    for (const name of ['camera', 'microphone'] as const) {
      try {
        const result = await navigator.permissions.query({ name } as PermissionDescriptor);
        states[name] = result.state;
        (name === 'camera' ? setCameraPermission : setMicrophonePermission)(result.state);
      } catch {
        // Some browsers do not expose media permission state.
      }
    }
    return states;
  };

  const showPermissionHelp = () => {
    const isAndroid = /Android/i.test(navigator.userAgent);
    const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
    const isChrome = /Chrome|CriOS/i.test(navigator.userAgent) && !/Edg|OPR/i.test(navigator.userAgent);
    if (isAndroid && isChrome) {
      setPermissionError('Android Chrome: tap the tune/lock icon beside testagram.site → Permissions → Camera → Allow and Microphone → Allow. If blocked, open Site settings, reset the blocked permission, reload Testagram, then tap Preview.');
    } else if (isIOS) {
      setPermissionError('iPhone/iPad: open Settings → Safari (or your browser) → Camera and Microphone → Allow, then return to Testagram and reload the page.');
    } else {
      setPermissionError('Open browser site permissions for testagram.site and set Camera and Microphone to Allow. If blocked, reset the site permissions, reload Testagram, then tap Preview.');
    }
  };

  useEffect(() => {
    void readPermissionState();
    return () => {
      if (sceneAnimationRef.current) cancelAnimationFrame(sceneAnimationRef.current);
      sourceVideoRef.current?.pause();
      if (sourceVideoUrlRef.current) URL.revokeObjectURL(sourceVideoUrlRef.current);
      roomRef.current?.disconnect();
      cameraStreamRef.current?.getTracks().forEach(track => track.stop());
      screenStreamRef.current?.getTracks().forEach(track => track.stop());
      productionVideoStreamRef.current?.getTracks().forEach(track => track.stop());
      audioPipelineRef.current?.stop().catch(() => undefined);
      productionAudioContextRef.current?.close().catch(() => undefined);
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    };
  }, []);

  const token = async (requestedId?: string) => {
    const id = requestedId ?? activeStreamId;
    if (!id) throw new Error('Broadcast id missing');
    const { data, error } = await supabase.functions.invoke('livekit-tv-token', { body: { stream_id: id } });
    if (error || !data?.data) throw new Error(data?.error?.message || error?.message || 'Could not connect to live broadcast');
    return data.data;
  };

  const getCamera = async () => {
    const permission = await readPermissionState();
    if (!window.isSecureContext) throw new Error('Camera and microphone require a secure HTTPS connection.');
    if (permission.camera === 'denied' || permission.microphone === 'denied') {
      const denied = [permission.camera === 'denied' ? 'camera' : '', permission.microphone === 'denied' ? 'microphone' : ''].filter(Boolean).join(' and ');
      const message = `Browser permission for ${denied} is blocked for Testagram. Open this site’s permissions, set ${denied} to Allow, then reload the page.`;
      setPermissionError(message);
      throw new Error(message);
    }
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser does not support camera/microphone capture. Use a current browser over HTTPS.');
    const preset = VIDEO_PRESETS[quality];
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: preset.width }, height: { ideal: preset.height }, frameRate: { ideal: preset.fps, max: preset.fps }, facingMode: 'user' },
        audio: { channelCount: { ideal: 1 }, sampleRate: { ideal: 48000 }, sampleSize: { ideal: 24 }, echoCancellation: true, noiseSuppression: true, autoGainControl: false },
      });
      cameraStreamRef.current = s;
      setDeviceReady(true);
      setPermissionError(null);
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
    const cameraStream = cameraStreamRef.current!;
    if (videoRef.current && !videoRef.current.srcObject && productionSource === 'camera') {
      videoRef.current.srcObject = cameraStream;
      videoRef.current.muted = true;
      void videoRef.current.play().catch(() => undefined);
    }
    return cameraStream;
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

  const createProductionProgram = async () => {
    if (productionSource !== 'video' || !sourceVideoRef.current) return rebuildProgramStream();
    await ensureStudio();
    const productionKey = quality + ':' + (sourceVideoUrlRef.current ?? '');
    if (programStreamRef.current && productionKeyRef.current === productionKey) return programStreamRef.current;
    if (sceneAnimationRef.current) cancelAnimationFrame(sceneAnimationRef.current);
    productionVideoStreamRef.current?.getTracks().forEach(track => track.stop());
    const sourceVideo = sourceVideoRef.current;
    if (sourceVideo.readyState < 2) {
      await new Promise<void>(resolve => {
        const done = () => resolve();
        sourceVideo.addEventListener('loadeddata', done, { once: true });
      });
    }
    const preset = VIDEO_PRESETS[quality];
    const canvas = sceneCanvasRef.current ?? document.createElement('canvas');
    canvas.width = preset.width;
    canvas.height = preset.height;
    sceneCanvasRef.current = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not create the production canvas.');

    const camera = productionCameraVideoRef.current ?? document.createElement('video');
    camera.muted = true;
    camera.playsInline = true;
    camera.srcObject = cameraStreamRef.current;
    productionCameraVideoRef.current = camera;
    await camera.play().catch(() => undefined);
    pipEnabledRef.current = pipEnabled;

    const draw = () => {
      const w = canvas.width, h = canvas.height;
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, w, h);
      const ratio = sourceVideo.videoWidth && sourceVideo.videoHeight ? sourceVideo.videoWidth / sourceVideo.videoHeight : 16 / 9;
      const target = w / h;
      let dw = w, dh = h, dx = 0, dy = 0;
      if (ratio > target) { dh = w / ratio; dy = (h - dh) / 2; }
      else { dw = h * ratio; dx = (w - dw) / 2; }
      ctx.drawImage(sourceVideo, dx, dy, dw, dh);

      if (pipEnabledRef.current && camera.readyState >= 2 && camera.videoWidth) {
        const pw = Math.round(w * 0.28);
        const ph = Math.round(pw * (camera.videoHeight / camera.videoWidth));
        const px = w - pw - 28, py = h - ph - 28;
        ctx.save();
        ctx.shadowColor = 'rgba(0,0,0,.6)';
        ctx.shadowBlur = 18;
        ctx.fillStyle = '#000';
        ctx.fillRect(px - 4, py - 4, pw + 8, ph + 8);
        ctx.restore();
        ctx.drawImage(camera, px, py, pw, ph);
      }
      sceneAnimationRef.current = requestAnimationFrame(draw);
    };
    draw();

    const audioCtor = window.AudioContext || (window as any).webkitAudioContext;
    if (!audioCtor) throw new Error('This browser does not support live audio mixing.');
    let audioContext = productionAudioContextRef.current;
    if (!audioContext || audioContext.state === 'closed') {
      audioContext = new audioCtor({ latencyHint: 'interactive', sampleRate: 48000 });
      productionAudioContextRef.current = audioContext;
    }
    if (audioContext.state === 'suspended') await audioContext.resume();

    let destination = productionAudioDestinationRef.current;
    if (!destination) {
      destination = audioContext.createMediaStreamDestination();
      productionAudioDestinationRef.current = destination;
    }

    if (!productionSourceAudioRef.current) {
      productionSourceAudioRef.current = audioContext.createMediaElementSource(sourceVideo);
      productionSourceGainRef.current = audioContext.createGain();
      productionSourceAudioRef.current.connect(productionSourceGainRef.current).connect(destination);
    }
    productionSourceGainRef.current!.gain.value = sourceVideoMuted ? 0 : programLevel;

    if (audioPipelineRef.current && !productionCommentaryGainRef.current) {
      const commentary = audioContext.createMediaStreamSource(audioPipelineRef.current.stream);
      const commentaryGain = audioContext.createGain();
      commentary.connect(commentaryGain).connect(destination);
      productionCommentaryGainRef.current = commentaryGain;
    }
    if (productionCommentaryGainRef.current) {
      productionCommentaryGainRef.current.gain.value = muted ? 0 : commentaryLevel;
    }

    const canvasStream = canvas.captureStream(preset.fps);
    const audioTrack = destination.stream.getAudioTracks()[0];
    if (!audioTrack) throw new Error('Could not create the mixed program audio.');
    const program = new MediaStream([canvasStream.getVideoTracks()[0], audioTrack]);
    productionVideoStreamRef.current = canvasStream;
    programStreamRef.current = program;
    productionKeyRef.current = productionKey;
    if (videoRef.current) {
      videoRef.current.srcObject = program;
      videoRef.current.muted = true;
      void videoRef.current.play().catch(() => undefined);
    }
    return program;
  };

  const loadProductionVideo = async (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith('video/')) { toast.error('Choose a video file.'); return; }
    if (file.size > 2 * 1024 * 1024 * 1024) { toast.error('Video exceeds the 2 GB browser production limit.'); return; }
    if (sourceVideoUrlRef.current) URL.revokeObjectURL(sourceVideoUrlRef.current);
    const url = URL.createObjectURL(file);
    sourceVideoUrlRef.current = url;
    const video = sourceVideoRef.current ?? document.createElement('video');
    video.src = url;
    video.preload = 'auto';
    video.playsInline = true;
    video.muted = false;
    sourceVideoRef.current = video;
    setUploadedVideoName(file.name);
    setProductionSource('video');
    await video.play().catch(() => undefined);
    setSourceVideoPlaying(!video.paused);
    setStatus('preview');
    toast.success('Video loaded locally. It will be sent through the live program, not stored on Testagram.');
  };

  const toggleProductionVideo = async () => {
    const video = sourceVideoRef.current;
    if (!video) return;
    if (video.paused) await video.play().catch(() => undefined);
    else video.pause();
    setSourceVideoPlaying(!video.paused);
  };

  const publishProgram = async (room: Room, program: MediaStream) => {
    const video = program.getVideoTracks()[0];
    const audio = program.getAudioTracks()[0];
    if (video) await room.localParticipant.publishTrack(new LocalVideoTrack(video), { name: 'program-video', simulcast: true });
    if (audio) await room.localParticipant.publishTrack(new LocalAudioTrack(audio), { name: 'program-audio' });
  };

  const startLive = async () => {
    if (live || roomRef.current) return;
    try {
      if (!user) throw new Error('Sign in to broadcast');
      const cameraStream = await ensureStudio();
      const program = await createProductionProgram();
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
      await roomRef.current?.disconnect().catch(() => undefined);
      roomRef.current = null;
      setViewerCount(0);
      setLive(false);
      setMode('studio');
      setStatus(cameraStreamRef.current ? 'preview' : 'idle');
      const failedId = activeStreamId;
      if (failedId && user) {
        await supabase.from('live_streams').update({ is_live: false, ended_at: new Date().toISOString(), stream_url: null }).eq('id', failedId).eq('user_id', user.id);
        setActiveStreamId(null);
      }
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
      const program = await createProductionProgram();
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
    const recorder = recorderRef.current;
    if (!recorder) return;
    if (recorder.state !== 'inactive') recorder.stop();
    recorderRef.current = null;
    setRecording(false);
    if (!live) setStatus(cameraStreamRef.current ? 'preview' : 'idle');
  };

  const toggleMic = () => {
    const t = cameraStreamRef.current?.getAudioTracks()[0];
    if (t) {
      t.enabled = !t.enabled;
      setMuted(!t.enabled);
      if (productionCommentaryGainRef.current) productionCommentaryGainRef.current.gain.value = t.enabled ? commentaryLevel : 0;
    }
  };

  const toggleCamera = () => {
    const t = cameraStreamRef.current?.getVideoTracks()[0];
    if (t) { t.enabled = !t.enabled; setCamera(t.enabled); }
  };

  const replacePublishedVideoTrack = async (track: MediaStreamTrack) => {
    const room = roomRef.current;
    if (!room) return;
    const publication = Array.from(room.localParticipant.videoTrackPublications.values()).find(p => p.trackName === 'program-video') ?? Array.from(room.localParticipant.videoTrackPublications.values())[0];
    if (publication?.track) await publication.track.replaceTrack(track);
  };

  const shareScreen = async () => {
    try {
      if (productionSource === 'video') {
        toast.info('Screen sharing replaces the video scene. Switch to Camera after stopping screen share to restore the uploaded-video scene.');
      }
      if (sharing) {
        screenStreamRef.current?.getTracks().forEach(t => t.stop());
        screenStreamRef.current = null;
        setSharing(false);
        const cameraTrack = cameraStreamRef.current?.getVideoTracks()[0];
        if (cameraTrack) {
          const program = rebuildProgramStream();
          await replacePublishedVideoTrack(program.getVideoTracks()[0] ?? cameraTrack);
        }
        return;
      }
      const preset = VIDEO_PRESETS[quality];
      const s = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: preset.fps }, audio: false });
      screenStreamRef.current = s;
      const track = s.getVideoTracks()[0];
      track.onended = () => {
        void (async () => {
          screenStreamRef.current = null;
          setSharing(false);
          const cameraTrack = cameraStreamRef.current?.getVideoTracks()[0];
          if (cameraTrack) {
            const program = rebuildProgramStream();
            await replacePublishedVideoTrack(program.getVideoTracks()[0] ?? cameraTrack);
          }
        })();
      };
      setSharing(true);
      setProductionSource('camera');
      const program = rebuildProgramStream();
      await replacePublishedVideoTrack(program.getVideoTracks()[0] ?? track);
      void program;
    } catch (e: any) {
      if (e?.name !== 'NotAllowedError') toast.error('Screen sharing could not start');
    }
  };

  useEffect(() => {
    const id = window.setInterval(() => {
      setElapsed(prev => (recording || live ? prev + 1 : 0));
      const level = audioPipelineRef.current?.getLevel();
      if (level != null) setAudioLevel(level);
    }, 1000);
    return () => window.clearInterval(id);
  }, [recording, live]);

  useEffect(() => {
    pipEnabledRef.current = pipEnabled;
  }, [pipEnabled]);

  useEffect(() => {
    const sourceGain = productionSourceGainRef.current;
    const commentaryGain = productionCommentaryGainRef.current;
    if (sourceGain) sourceGain.gain.value = sourceVideoMuted ? 0 : programLevel;
    if (commentaryGain) commentaryGain.gain.value = muted ? 0 : commentaryLevel;
  }, [programLevel, commentaryLevel, muted, sourceVideoMuted]);

  const toggleLandscape = async () => {
    try {
      const root = document.documentElement as any;
      if (root.requestFullscreen && !document.fullscreenElement) await root.requestFullscreen();
      const orientation = (screen as any).orientation;
      if (orientation?.lock) await orientation.lock('landscape').catch(() => undefined);
      setLandscapeLocked(true);
    } catch {
      toast.info('Use your device orientation controls to keep the TV production in landscape.');
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
          <div className="flex items-center gap-2"><Button size="sm" variant="outline" onClick={() => void toggleLandscape()}>Landscape</Button><Button variant="outline" onClick={() => nav('/spaces')}>Exit</Button></div>
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
                          <div className="rounded-xl border border-white/10 bg-black/30 p-3 space-y-3">
                <div className="flex items-center gap-2 font-semibold text-sm"><Layers3 className="w-4 h-4" />Program / scenes</div>
                <div className="grid grid-cols-2 gap-2">
                  <Button size="sm" disabled={live || recording} variant={productionSource === 'camera' ? 'default' : 'outline'} onClick={() => { setProductionSource('camera'); if (sourceVideoRef.current) sourceVideoRef.current.pause(); }}><Camera className="w-4 h-4 mr-1" />Camera</Button>
                  <Button size="sm" disabled={live || recording} variant={productionSource === 'video' ? 'default' : 'outline'} onClick={() => videoFileInputRef.current?.click()}><Upload className="w-4 h-4 mr-1" />Video</Button>
                </div>
                <input ref={videoFileInputRef} type="file" accept="video/*" className="hidden" onChange={e => void loadProductionVideo(e.target.files?.[0])} />
                {uploadedVideoName && <div className="text-[11px] text-zinc-400 truncate">{uploadedVideoName}</div>}
                {productionSource === 'video' && sourceVideoRef.current && <div className="grid grid-cols-2 gap-2">
                  <Button size="sm" variant="outline" onClick={() => void toggleProductionVideo()}>{sourceVideoPlaying ? 'Pause video' : 'Play video'}</Button>
                  <Button size="sm" variant="outline" onClick={() => setPipEnabled(v => !v)}><PictureInPicture2 className="w-4 h-4 mr-1" />PiP {pipEnabled ? 'on' : 'off'}</Button>
                </div>}
                <div><div className="flex justify-between text-[11px] text-zinc-400"><span>Video audio</span><span>{Math.round(programLevel * 100)}%</span></div><input type="range" min="0" max="1" step="0.05" value={programLevel} onChange={e => setProgramLevel(Number(e.target.value))} className="w-full" /></div>
                <div><div className="flex justify-between text-[11px] text-zinc-400"><span>Commentary voice</span><span>{Math.round(commentaryLevel * 100)}%</span></div><input type="range" min="0" max="1.5" step="0.05" value={commentaryLevel} onChange={e => setCommentaryLevel(Number(e.target.value))} className="w-full" /></div>
                <p className="text-[10px] text-zinc-500">Live program audio mixes the uploaded video's audio and the commentator microphone simultaneously.</p>
              </div>
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
