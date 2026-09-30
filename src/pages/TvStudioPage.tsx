import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { TestagramTvMediaSession } from '@/lib/testagramTvMedia';
import { TestagramTvCloudflareSession } from '@/lib/testagramTvCloudflare';
import { TestagramTvYouTubeSession } from '@/lib/testagramTvYouTube';
import { Camera, Mic, MonitorUp, Circle, Square, Radio, Users, Download, Clapperboard, Settings2, Activity, ShieldCheck, Upload, PictureInPicture2, Layers3 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import { createStudioAudioPipeline, requestStudioMicrophone, type StudioAudioPipeline } from '@/lib/studioAudio';
import { drawTvGraphics, drawTvOpeningSlate, makeDefaultGraphics, TvReplayBuffer, type TvGraphic, type TvSceneId, type TransitionType } from '@/lib/tvProduction';

type Mode = 'studio' | 'live';
type Scene = 'camera' | 'video' | 'screen';
type Quality = '4k' | '1080p' | '720p' | '480p';

const VIDEO_PRESETS: Record<Quality, { width: number; height: number; fps: number; bitrate: number }> = {
  '4k': { width: 3840, height: 2160, fps: 30, bitrate: 24_000_000 },
  '1080p': { width: 1920, height: 1080, fps: 30, bitrate: 8_000_000 },
  '720p': { width: 1280, height: 720, fps: 30, bitrate: 5_000_000 },
  '480p': { width: 854, height: 480, fps: 30, bitrate: 2_500_000 },
};
const CAMERA_CONSTRAINTS: Record<Quality, MediaTrackConstraints> = {
  '4k': { width: { min: 1920, ideal: 3840, max: 3840 }, height: { min: 1080, ideal: 2160, max: 2160 }, aspectRatio: { ideal: 16 / 9 }, frameRate: { min: 24, ideal: 30, max: 30 }, facingMode: { ideal: 'environment' } },
  '1080p': { width: { min: 1280, ideal: 1920, max: 1920 }, height: { min: 720, ideal: 1080, max: 1080 }, aspectRatio: { ideal: 16 / 9 }, frameRate: { min: 24, ideal: 30, max: 30 }, facingMode: { ideal: 'environment' } },
  '720p': { width: { min: 960, ideal: 1280, max: 1280 }, height: { min: 540, ideal: 720, max: 720 }, aspectRatio: { ideal: 16 / 9 }, frameRate: { min: 24, ideal: 30, max: 30 }, facingMode: { ideal: 'environment' } },
  '480p': { width: { min: 640, ideal: 854, max: 854 }, height: { min: 360, ideal: 480, max: 480 }, aspectRatio: { ideal: 16 / 9 }, frameRate: { ideal: 30, max: 30 }, facingMode: { ideal: 'environment' } },
};

export default function TvStudioPage() {
  const { streamId } = useParams();
  const nav = useNavigate();
  const [searchParams] = useSearchParams();
  const { user } = useAuth();

  const videoRef = useRef<HTMLVideoElement>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const roomRef = useRef<TestagramTvCloudflareSession | TestagramTvMediaSession | null>(null);
  const guestRoomRef = useRef<TestagramTvMediaSession | null>(null);
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
  const productionCanvasStreamRef = useRef<MediaStream | null>(null);
  const productionCanvasQualityRef = useRef<string | null>(null);
  const productionVideoTrackRef = useRef<MediaStreamTrack | null>(null);
  const screenVideoRef = useRef<HTMLVideoElement | null>(null);
  const productionAudioTrackRef = useRef<MediaStreamTrack | null>(null);
  const productionMasterGainRef = useRef<GainNode | null>(null);
  const productionGuestGainRef = useRef<GainNode | null>(null);
  const productionMusicSourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const productionMusicGainRef = useRef<GainNode | null>(null);
  const productionSfxSourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const productionSfxGainRef = useRef<GainNode | null>(null);
  const musicAudioRef = useRef<HTMLAudioElement | null>(null);
  const sfxAudioRef = useRef<HTMLAudioElement | null>(null);
  const musicUrlRef = useRef<string | null>(null);
  const sfxUrlRef = useRef<string | null>(null);
  const productionLimiterRef = useRef<DynamicsCompressorNode | null>(null);
  const productionCommentaryAnalyserRef = useRef<AnalyserNode | null>(null);
  const duckingTimerRef = useRef<number | null>(null);
  const remoteGuestVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteGuestAudioRef = useRef<HTMLAudioElement | null>(null);
  const transitionFromCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const transitionFromSceneRef = useRef<TvSceneId>('camera');
  const replayFramesRef = useRef<HTMLCanvasElement[]>([]);
  const replayIndexRef = useRef(0);
  const replayPlayingRef = useRef(false);
  const replayPlaybackStartRef = useRef<number | null>(null);
  const replayPlaybackBaseRef = useRef<number | null>(null);
  const multiviewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const transitionIncomingCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const multiviewCellCanvasRefs = useRef<HTMLCanvasElement[]>([]);
  const [replayState, setReplayState] = useState<'ready' | 'playing'>('ready');
  const [programFps, setProgramFps] = useState(0);
  const [programDropped, setProgramDropped] = useState(0);
  const programFrameRef = useRef({ last: 0, count: 0, dropped: 0 });
  const [guestConnected, setGuestConnected] = useState(false);
  const [guestInviteUrl, setGuestInviteUrl] = useState<string | null>(null);
  const [bannerText, setBannerText] = useState('');
  const [fullscreenText, setFullscreenText] = useState('');
  const [nextText, setNextText] = useState('');
  const [musicName, setMusicName] = useState<string | null>(null);
  const [sfxName, setSfxName] = useState<string | null>(null);
  const [musicLevel, setMusicLevel] = useState(0.5);
  const [sfxLevel, setSfxLevel] = useState(0.7);
  const pipEnabledRef = useRef(true);
  const previewSceneRef = useRef<TvSceneId>('camera');
  const programSceneRef = useRef<TvSceneId>('camera');
  const transitionRef = useRef({ type: 'cut' as TransitionType, durationMs: 300 });
  const transitionStartedRef = useRef<number | null>(null);
  const replayBufferRef = useRef(new TvReplayBuffer(
    60_000,
    typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ? 1000 : 500,
    typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ? 360 : 480,
    typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ? 203 : 270,
  ));
  const openingSlateUntilRef = useRef<number | null>(null);
  const openingSlatePlayedRef = useRef(false);
  const liveRef = useRef(false);
  const lightModeRef = useRef(false);
  const renderClockRef = useRef(0);

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
  const [quality, setQuality] = useState<Quality>(() => {
    if (typeof navigator === 'undefined') return '1080p';
    const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    const memory = Number((navigator as any).deviceMemory || 0);
    const cores = Number(navigator.hardwareConcurrency || 0);
    // Keep mobile/low-power devices responsive. Cloudflare Stream live delivery is capped
    // at 1080p, so spending 1080p/4K browser CPU on a constrained device
    // only to downscale it again is counterproductive.
    if (mobile || (memory > 0 && memory <= 4) || (cores > 0 && cores <= 4)) return '720p';
    return '1080p';
  });
  const [savedName, setSavedName] = useState<string | null>(null);
  const [audioLevel, setAudioLevel] = useState(0);
  const [audioPeak, setAudioPeak] = useState(0);
  const [audioClipping, setAudioClipping] = useState(false);
  const [sourceHealth, setSourceHealth] = useState<Record<string, 'ready' | 'lost' | 'idle'>>({ camera: 'idle', video: 'idle', screen: 'idle', guest: 'idle' });
  const [status, setStatus] = useState<'idle' | 'preview' | 'recording' | 'live'>('idle');
  const [saving, setSaving] = useState(false);
  const [recordingHint, setRecordingHint] = useState('Record locally on this device. Testagram never uploads the finished video.');
  const [permissionError, setPermissionError] = useState<string | null>(null);
  const [broadcastError, setBroadcastError] = useState<string | null>(null);
  const [broadcastStage, setBroadcastStage] = useState<'idle' | 'preparing' | 'authorizing' | 'connecting' | 'verifying' | 'on-air'>('idle');
  const [broadcastDiagnostics, setBroadcastDiagnostics] = useState<Record<string, unknown> | null>(null);
  const [youtubeStatus, setYoutubeStatus] = useState<string>("disabled");
  const [productionSource, setProductionSource] = useState<'camera' | 'video'>('camera');
  const [activeScene, setActiveScene] = useState<Scene>('camera');
  const [previewScene, setPreviewScene] = useState<TvSceneId>('camera');
  const [programScene, setProgramScene] = useState<TvSceneId>('camera');
  const [transitionType, setTransitionType] = useState<TransitionType>('cut');
  const [transitionDuration, setTransitionDuration] = useState(300);
  const [graphics, setGraphics] = useState<TvGraphic[]>(makeDefaultGraphics);
  const [lowerThirdText, setLowerThirdText] = useState('');
  const [lowerThirdSecondary, setLowerThirdSecondary] = useState('');
  const [tickerText, setTickerText] = useState('');
  const [multiview, setMultiview] = useState(false);
  const [replaySeconds, setReplaySeconds] = useState(30);
  const [audioDucking, setAudioDucking] = useState(false);
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
  const [cameraResolution, setCameraResolution] = useState('not started');
  const [studioHealth, setStudioHealth] = useState<'ready' | 'degraded' | 'offline'>('offline');
  const [shortcutHint, setShortcutHint] = useState(false);
  const [scenePresets, setScenePresets] = useState<Record<string, { preview: TvSceneId; transition: TransitionType; duration: number; pip: boolean; graphics: TvGraphic[] }>>({});
  const transitionSnapshotRef = useRef<HTMLCanvasElement | null>(null);
  const broadcastTitle = searchParams.get('title')?.trim().slice(0, 100) || 'Testagram TV Live';
  const broadcastDescription = searchParams.get('description')?.trim().slice(0, 500) || 'Live from Testagram TV Studio';
  const broadcastCategory = searchParams.get('category')?.trim().slice(0, 50) || 'general';

  useEffect(() => {
    const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    const memory = Number((navigator as any).deviceMemory || 0);
    const cores = Number(navigator.hardwareConcurrency || 0);
    const light = mobile || (memory > 0 && memory <= 4) || (cores > 0 && cores <= 4);
    lightModeRef.current = light;
  }, []);

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
      if (duckingTimerRef.current) window.clearInterval(duckingTimerRef.current);
      remoteGuestVideoRef.current?.pause();
      remoteGuestAudioRef.current?.pause();
      sourceVideoRef.current?.pause();
      if (sourceVideoUrlRef.current) URL.revokeObjectURL(sourceVideoUrlRef.current);
      if (musicUrlRef.current) URL.revokeObjectURL(musicUrlRef.current);
      if (sfxUrlRef.current) URL.revokeObjectURL(sfxUrlRef.current);
      if (downloadUrlRef.current) URL.revokeObjectURL(downloadUrlRef.current);
      roomRef.current?.close();
      guestRoomRef.current?.close();
      musicAudioRef.current?.pause();
      sfxAudioRef.current?.pause();
      cameraStreamRef.current?.getTracks().forEach(track => track.stop());
      screenStreamRef.current?.getTracks().forEach(track => track.stop());
      productionVideoStreamRef.current?.getTracks().forEach(track => track.stop());
      productionCanvasStreamRef.current?.getTracks().forEach(track => track.stop());
      screenVideoRef.current?.pause();
      if (screenVideoRef.current) screenVideoRef.current.srcObject = null;
      audioPipelineRef.current?.stop().catch(() => undefined);
      productionAudioContextRef.current?.close().catch(() => undefined);
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    };
  }, []);

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
      let s: MediaStream;
      try {
        s = await navigator.mediaDevices.getUserMedia({
          video: CAMERA_CONSTRAINTS[quality],
          audio: { channelCount: { ideal: 1 }, sampleRate: { ideal: 48000 }, sampleSize: { ideal: 24 }, echoCancellation: true, noiseSuppression: true, autoGainControl: false },
        });
      } catch (error) {
        if ((error as DOMException)?.name !== 'OverconstrainedError') throw error;
        s = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: preset.width }, height: { ideal: preset.height }, aspectRatio: { ideal: 16 / 9 }, frameRate: { ideal: preset.fps, max: preset.fps }, facingMode: { ideal: 'environment' } },
          audio: { channelCount: { ideal: 1 }, sampleRate: { ideal: 48000 }, sampleSize: { ideal: 24 }, echoCancellation: true, noiseSuppression: true, autoGainControl: false },
        });
      }
      const track = s.getVideoTracks()[0];
      if (track) {
        try { await track.applyConstraints({ aspectRatio: { ideal: 16 / 9 }, frameRate: { ideal: preset.fps, max: preset.fps } }); } catch {}
        const settings = track.getSettings();
        if (settings.width && settings.height) {
          setCameraResolution(`${settings.width}×${settings.height} @ ${Math.round(settings.frameRate || preset.fps)}fps`);
          if (quality === '4k' && (settings.width < 3840 || settings.height < 2160)) {
            setPermissionError(`4K was requested, but this camera/browser supplied ${settings.width}×${settings.height}. Testagram will keep the production bus stable rather than falsely claiming native 4K.`);
          }
        }
      }
      cameraStreamRef.current = s;
      const cameraTrack = s.getVideoTracks()[0];
      const audioTrack = s.getAudioTracks()[0];
      if (cameraTrack) cameraTrack.onended = () => {
        setCamera(false);
        setDeviceReady(false);
        setStudioHealth('degraded');
        if (liveRef.current && programSceneRef.current === 'camera') {
          void takeScene('black').catch(() => undefined);
        }
        toast.error('Camera signal lost. Testagram TV switched to a safe fallback.');
      };
      if (audioTrack) audioTrack.onended = () => {
        setMuted(true);
        setStudioHealth('degraded');
        if (liveRef.current) toast.error('Microphone signal lost. Broadcast remains live with the audio bus muted.');
      };
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
    // Do not bind the raw camera track to the Program monitor. The Program
    // monitor must always receive the landscape production canvas stream.
    return cameraStream;
  };

  const rebuildProgramStream = () => {
    return createProductionProgram();
  };

  const createProductionProgram = async () => {
    await ensureStudio();
    const preset = VIDEO_PRESETS[quality];
    const canvas = sceneCanvasRef.current ?? document.createElement('canvas');
    canvas.width = preset.width;
    canvas.height = preset.height;
    sceneCanvasRef.current = canvas;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Could not create the production canvas.');

    const camera = productionCameraVideoRef.current ?? document.createElement('video');
    camera.muted = true; camera.playsInline = true; camera.srcObject = cameraStreamRef.current;
    productionCameraVideoRef.current = camera;
    await camera.play().catch(() => undefined);

    const sourceVideo = sourceVideoRef.current;
    if (sourceVideo && sourceVideo.readyState < 2) {
      await new Promise<void>(resolve => {
        const done = () => resolve();
        sourceVideo.addEventListener('loadeddata', done, { once: true });
        window.setTimeout(resolve, 1500);
      });
    }

    const screenVideo = screenVideoRef.current ?? document.createElement('video');
    screenVideo.muted = true; screenVideo.playsInline = true;
    screenVideoRef.current = screenVideo;
    if (screenStreamRef.current) {
      screenVideo.srcObject = screenStreamRef.current;
      await screenVideo.play().catch(() => undefined);
    }

    // Every TV output is a true landscape 16:9 raster. Camera sources that
    // arrive portrait are cropped into that raster instead of being letterboxed
    // as a portrait video. This keeps both preview and program buses landscape.
    const fit = (target: CanvasRenderingContext2D, media: HTMLVideoElement | null, contain = true, targetWidth = canvas.width, targetHeight = canvas.height) => {
      if (!media || media.readyState < 2 || !media.videoWidth || !media.videoHeight) return;
      const w = targetWidth, h = targetHeight;
      const ratio = media.videoWidth / media.videoHeight;
      const targetRatio = w / h;
      let dw = w, dh = h, dx = 0, dy = 0;
      if (contain) {
        if (ratio > targetRatio) { dh = w / ratio; dy = (h - dh) / 2; }
        else { dw = h * ratio; dx = (w - dw) / 2; }
      } else {
        if (ratio > targetRatio) { dw = h * ratio; dx = (w - dw) / 2; }
        else { dh = w * ratio; dy = (h - dh) / 2; }
      }
      target.drawImage(media, dx, dy, dw, dh);
    };

    const fitCameraLandscape = (target: CanvasRenderingContext2D, media: HTMLVideoElement | null, targetWidth = canvas.width, targetHeight = canvas.height) => {
      if (!media || media.readyState < 2 || !media.videoWidth || !media.videoHeight) return;
      const w = targetWidth, h = targetHeight;
      const sourceRatio = media.videoWidth / media.videoHeight;
      const targetRatio = w / h;
      // Portrait camera tracks must never become a portrait TV frame. Crop the
      // source to the 16:9 program raster while preserving its natural rotation.
      let sx = 0, sy = 0, sw = media.videoWidth, sh = media.videoHeight;
      if (sourceRatio < targetRatio) {
        // Portrait source (e.g. 1080x1920): keep the full sensor width and
        // crop its height to exactly the 16:9 raster. The previous calculation
        // expanded sw beyond videoWidth, which could produce an incorrectly
        // oriented/partially sampled recording on mobile browsers.
        sw = media.videoWidth;
        sh = media.videoWidth / targetRatio;
        sy = (media.videoHeight - sh) / 2;
      } else if (sourceRatio > targetRatio) {
        // Landscape source wider than 16:9: keep full height and crop width.
        sh = media.videoHeight;
        sw = media.videoHeight * targetRatio;
        sx = (media.videoWidth - sw) / 2;
      }
      target.drawImage(media, sx, sy, sw, sh, 0, 0, w, h);
    };

    const renderScene = (target: CanvasRenderingContext2D, scene: TvSceneId) => {
      target.fillStyle = '#000'; target.fillRect(0, 0, canvas.width, canvas.height);
      if (scene === 'camera') {
        fitCameraLandscape(target, camera);
      } else if (scene === 'video' && sourceVideo) {
        fit(target, sourceVideo, true);
        if (pipEnabledRef.current && camera.readyState >= 2 && camera.videoWidth) {
          const pw = Math.round(canvas.width * 0.28), ph = Math.round(pw * (camera.videoHeight / camera.videoWidth));
          const px = canvas.width - pw - 28, py = canvas.height - ph - 28;
          target.save(); target.shadowColor = 'rgba(0,0,0,.65)'; target.shadowBlur = 18;
          target.fillStyle = '#000'; target.fillRect(px - 5, py - 5, pw + 10, ph + 10); target.restore();
          target.drawImage(camera, px, py, pw, ph);
        }
      } else if (scene === 'screen') {
        if (screenStreamRef.current && screenVideo.srcObject !== screenStreamRef.current) screenVideo.srcObject = screenStreamRef.current;
        fit(target, screenVideo, true);
      } else if (scene === 'guest') {
        fit(target, remoteGuestVideoRef.current, true);
      } else if (scene === 'replay') {
        const frames = replayBufferRef.current.getFrames(replaySeconds * 1000);
        const frame = frames[Math.min(replayIndexRef.current, Math.max(frames.length - 1, 0))];
        if (frame) target.drawImage(frame.canvas, 0, 0, canvas.width, canvas.height);
      }
    };

    const renderMultiview = () => {
      const mv = multiviewCanvasRef.current;
      if (!mv || !multiview) return;
      const mctx = mv.getContext('2d'); if (!mctx) return;
      const w = mv.width, h = mv.height;
      mctx.fillStyle = '#09090b'; mctx.fillRect(0, 0, w, h);
      const cells: Array<[TvSceneId, number, number]> = [
        ['camera',0,0],['video',w/2,0],['screen',0,h/2],['replay',w/2,h/2]
      ];
      for (const [scene,x,y] of cells) {
        const cellIndex = (x ? 1 : 0) + (y ? 2 : 0);
        const cell = multiviewCellCanvasRefs.current[cellIndex] ?? document.createElement('canvas');
        if (cell.width !== w / 2) cell.width = w / 2;
        if (cell.height !== h / 2) cell.height = h / 2;
        multiviewCellCanvasRefs.current[cellIndex] = cell;
        const cctx = cell.getContext('2d'); if (!cctx) continue;
        cctx.fillStyle = '#000'; cctx.fillRect(0,0,cell.width,cell.height);
        if (scene === 'camera') fitCameraLandscape(cctx,camera);
        else if (scene === 'video' && sourceVideo) fit(cctx,sourceVideo,true);
        else if (scene === 'screen') fit(cctx,screenVideo,true);
        else {
          const frame = replayBufferRef.current.latestCanvas();
          if (frame) cctx.drawImage(frame,0,0,cell.width,cell.height);
        }
        mctx.drawImage(cell,x,y);
        mctx.fillStyle='#fff'; mctx.font='600 12px sans-serif'; mctx.fillText(scene.toUpperCase(),x+8,y+18);
      }
    };

    const fromCanvas = transitionFromCanvasRef.current;
    const previewCanvas = previewCanvasRef.current;
    const previewCtx = previewCanvas?.getContext('2d');
    const draw = () => {
      const now = performance.now();
      const targetFrameMs = lightModeRef.current ? 1000 / 24 : 1000 / 30;
      if (renderClockRef.current && now - renderClockRef.current < targetFrameMs) {
        sceneAnimationRef.current = requestAnimationFrame(draw);
        return;
      }
      renderClockRef.current = now;
      const frameStats = programFrameRef.current;
      if (frameStats.last) {
        const delta = now - frameStats.last;
        const expectedFrameMs = lightModeRef.current ? 1000 / 24 : 1000 / 30;
        if (delta > expectedFrameMs * 1.5) {
          frameStats.dropped += Math.max(0, Math.round(delta / expectedFrameMs) - 1);
        }
      }
      frameStats.last = now; frameStats.count += 1;
      const activeProgram = programSceneRef.current;
      const transition = transitionRef.current;
      let progress = 1;
      if (transitionStartedRef.current != null && transition.type !== 'cut') {
        progress = Math.min(1, (now - transitionStartedRef.current) / Math.max(transition.durationMs, 1));
        if (progress >= 1) transitionStartedRef.current = null;
      }
      if (replayPlayingRef.current) {
        const frames = replayBufferRef.current.getFrames(replaySeconds * 1000);
        if (frames.length) {
          const started = replayPlaybackStartRef.current ?? now;
          const base = replayPlaybackBaseRef.current ?? frames[0].timestamp;
          const target = base + (now - started);
          let idx = replayIndexRef.current;
          while (idx + 1 < frames.length && frames[idx + 1].timestamp <= target) idx += 1;
          replayIndexRef.current = idx;
          if (idx >= frames.length - 1) {
            replayPlayingRef.current = false; replayPlaybackStartRef.current = null; replayPlaybackBaseRef.current = null;
            setReplayState('ready'); programSceneRef.current = transitionFromSceneRef.current; setProgramScene(transitionFromSceneRef.current);
          }
        }
      }
      const incoming = transitionIncomingCanvasRef.current ?? document.createElement('canvas');
      if (incoming.width !== canvas.width) incoming.width = canvas.width;
      if (incoming.height !== canvas.height) incoming.height = canvas.height;
      transitionIncomingCanvasRef.current = incoming;
      const ictx = incoming.getContext('2d')!;
      renderScene(ictx, activeProgram);
      // The preview is a monitoring surface, not part of the program bus.
      // Render it at a reduced cadence to keep the full-resolution program
      // compositor and encoder responsive on phones and low-power laptops.
      if (previewCanvas && previewCtx && frameStats.count % (lightModeRef.current ? 3 : 2) === 0) {
        if (previewCanvas.width !== 640) previewCanvas.width = 640;
        if (previewCanvas.height !== 360) previewCanvas.height = 360;
        previewCtx.fillStyle = '#000';
        previewCtx.fillRect(0, 0, 640, 360);
        renderScene(previewCtx, previewSceneRef.current);
      }

      if (transitionStartedRef.current != null && transition.type !== 'cut' && fromCanvas) {
        if (transition.type === 'fade') {
          ctx.globalAlpha = 1; ctx.drawImage(fromCanvas,0,0);
          ctx.globalAlpha = progress; ctx.drawImage(incoming,0,0); ctx.globalAlpha = 1;
        } else {
          const first = progress < 0.5 ? 1 - progress * 2 : 0;
          const second = progress < 0.5 ? 0 : (progress - 0.5) * 2;
          ctx.globalAlpha = first; ctx.drawImage(fromCanvas,0,0);
          ctx.globalAlpha = second; ctx.drawImage(incoming,0,0); ctx.globalAlpha = 1;
        }
      } else {
        ctx.drawImage(incoming,0,0);
      }

      if (activeProgram !== 'replay' && activeProgram !== 'black') {
        drawTvGraphics(ctx, canvas.width, canvas.height, graphics, now / 8, { live: liveRef.current, watermark: true });
        const slateUntil = openingSlateUntilRef.current;
        if (slateUntil && now < slateUntil) {
          drawTvOpeningSlate(ctx, canvas.width, canvas.height, 1 - ((slateUntil - now) / 2600));
        } else if (slateUntil) {
          openingSlateUntilRef.current = null;
        }
      }
      if (replayBufferRef.current.shouldCapture(now) && programSceneRef.current !== 'replay') replayBufferRef.current.push(canvas, now);
      // Multiview is diagnostic UI; keep it off the hot path and update it
      // less frequently than the program bus.
      if (multiview && frameStats.count % (lightModeRef.current ? 4 : 2) === 0) renderMultiview();
      sceneAnimationRef.current = requestAnimationFrame(draw);
    };

    if (sceneAnimationRef.current) cancelAnimationFrame(sceneAnimationRef.current);
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
    if (!destination) destination = productionAudioDestinationRef.current = audioContext.createMediaStreamDestination();

    if (!productionMasterGainRef.current) productionMasterGainRef.current = audioContext.createGain();
    if (!productionLimiterRef.current) {
      const limiter = audioContext.createDynamicsCompressor();
      limiter.threshold.value = -1; limiter.knee.value = 0; limiter.ratio.value = 20; limiter.attack.value = 0.001; limiter.release.value = 0.08;
      productionLimiterRef.current = limiter;
      productionMasterGainRef.current.connect(limiter).connect(destination);
    }

    if (sourceVideo && !productionSourceAudioRef.current) {
      productionSourceAudioRef.current = audioContext.createMediaElementSource(sourceVideo);
      productionSourceGainRef.current = audioContext.createGain();
      productionSourceAudioRef.current.connect(productionSourceGainRef.current).connect(productionMasterGainRef.current);
    }
    if (productionSourceGainRef.current) {
      productionSourceGainRef.current.gain.value = programSceneRef.current === 'video' && !sourceVideoMuted ? programLevel : 0;
    }

    if (audioPipelineRef.current && !productionCommentaryGainRef.current) {
      const commentary = audioContext.createMediaStreamSource(audioPipelineRef.current.stream);
      const commentaryGain = audioContext.createGain();
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 512;
      commentary.connect(analyser).connect(commentaryGain).connect(productionMasterGainRef.current);
      productionCommentaryGainRef.current = commentaryGain;
      productionCommentaryAnalyserRef.current = analyser;
    }
    if (productionCommentaryGainRef.current) productionCommentaryGainRef.current.gain.value = muted ? 0 : commentaryLevel;

    const wireLocalAudioBus = (
      element: HTMLAudioElement | null,
      sourceRef: { current: MediaElementAudioSourceNode | null },
      gainRef: { current: GainNode | null },
      level: number,
    ) => {
      if (!element) return;
      if (!sourceRef.current) {
        sourceRef.current = audioContext!.createMediaElementSource(element);
        gainRef.current = audioContext!.createGain();
        sourceRef.current.connect(gainRef.current).connect(productionMasterGainRef.current!);
      }
      gainRef.current!.gain.value = level;
    };
    wireLocalAudioBus(musicAudioRef.current, productionMusicSourceRef, productionMusicGainRef, musicLevel);
    wireLocalAudioBus(sfxAudioRef.current, productionSfxSourceRef, productionSfxGainRef, sfxLevel);

    if (duckingTimerRef.current) window.clearInterval(duckingTimerRef.current);
    if (productionCommentaryAnalyserRef.current && productionSourceGainRef.current) {
      const data = new Uint8Array(productionCommentaryAnalyserRef.current.fftSize);
      duckingTimerRef.current = window.setInterval(() => {
        if (!productionCommentaryAnalyserRef.current || !productionSourceGainRef.current) return;
        productionCommentaryAnalyserRef.current.getByteTimeDomainData(data);
        let sum = 0; for (const v of data) { const n=(v-128)/128; sum += n*n; }
        const rms = Math.sqrt(sum / data.length);
        const target = audioDucking && programSceneRef.current === 'video' && rms > 0.035 ? programLevel * 0.28 : (programSceneRef.current === 'video' && !sourceVideoMuted ? programLevel : 0);
        productionSourceGainRef.current.gain.setTargetAtTime(target, audioContext!.currentTime, 0.045);
      }, 40);
    }

    const runtimeFps = quality === '4k' ? preset.fps : (lightModeRef.current ? 24 : preset.fps);
    const productionKey = `${quality}:${runtimeFps}`;
    if (productionCanvasQualityRef.current !== productionKey) {
      productionCanvasStreamRef.current?.getTracks().forEach(track => track.stop());
      // Capture only the fixed landscape production raster. Never hand the
      // raw camera MediaStream to MediaRecorder or the live transport.
      productionCanvasStreamRef.current = canvas.captureStream(runtimeFps);
      const capturedTrack = productionCanvasStreamRef.current.getVideoTracks()[0];
      if (capturedTrack) capturedTrack.contentHint = 'motion';
      productionCanvasQualityRef.current = productionKey;
      productionVideoTrackRef.current = productionCanvasStreamRef.current.getVideoTracks()[0] ?? null;
    }
    const audioTrack = destination.stream.getAudioTracks()[0];
    const videoTrack = productionVideoTrackRef.current;
    if (!audioTrack || !videoTrack) throw new Error('Could not create the production A/V tracks.');
    productionAudioTrackRef.current = audioTrack;
    programStreamRef.current = new MediaStream([videoTrack, audioTrack]);

    if (videoRef.current) {
      videoRef.current.srcObject = programStreamRef.current;
      videoRef.current.muted = true; void videoRef.current.play().catch(() => undefined);
    }
    return programStreamRef.current;
  };

  const sceneToScene = (scene: TvSceneId): Scene | null => {
    if (scene === 'camera' || scene === 'video' || scene === 'screen') return scene;
    return null;
  };

  const takeScene = async (scene: TvSceneId = previewScene) => {
    if (scene === 'replay') {
      const frames = replayBufferRef.current.getFrames(replaySeconds * 1000);
      if (!frames.length) { toast.info('Replay buffer is empty.'); return; }
      transitionFromSceneRef.current = programSceneRef.current;
      if (sceneCanvasRef.current) {
        const source = sceneCanvasRef.current;
        const snapshot = transitionSnapshotRef.current ?? document.createElement('canvas');
        if (snapshot.width !== source.width) snapshot.width = source.width;
        if (snapshot.height !== source.height) snapshot.height = source.height;
        snapshot.getContext('2d')?.drawImage(source, 0, 0);
        transitionSnapshotRef.current = snapshot;
        transitionFromCanvasRef.current = snapshot;
      } else transitionFromCanvasRef.current = null;
      replayFramesRef.current = frames.map(f => f.canvas);
      replayIndexRef.current = 0; replayPlayingRef.current = true; setReplayState('playing');
      replayPlaybackStartRef.current = performance.now(); replayPlaybackBaseRef.current = frames[0].timestamp;
      transitionRef.current = { type: transitionType, durationMs: transitionDuration };
      transitionStartedRef.current = performance.now();
      programSceneRef.current = 'replay'; setProgramScene('replay');
      return;
    }
    const mapped = sceneToScene(scene);
    if (!mapped && scene !== 'black') { toast.info('Guest is available when a marked TV guest publishes a camera track.'); return; }
    if (scene === 'black') {
      transitionFromSceneRef.current = programSceneRef.current;
      transitionFromCanvasRef.current = sceneCanvasRef.current;
      transitionRef.current = { type: transitionType, durationMs: transitionDuration };
      transitionStartedRef.current = performance.now();
      programSceneRef.current = 'black'; setProgramScene('black'); return;
    }
    if (scene === 'guest' && !remoteGuestVideoRef.current) { toast.info('No TV guest is connected.'); return; }
    transitionFromSceneRef.current = programSceneRef.current;
    if (sceneCanvasRef.current) {
      const source = sceneCanvasRef.current;
      const snapshot = transitionSnapshotRef.current ?? document.createElement('canvas');
      if (snapshot.width !== source.width) snapshot.width = source.width;
      if (snapshot.height !== source.height) snapshot.height = source.height;
      snapshot.getContext('2d')?.drawImage(source, 0, 0);
      transitionSnapshotRef.current = snapshot;
      transitionFromCanvasRef.current = snapshot;
    } else transitionFromCanvasRef.current = null;
    if (mapped) await activateScene(mapped, true);
    transitionRef.current = { type: transitionType, durationMs: transitionDuration };
    transitionStartedRef.current = transitionType === 'cut' ? null : performance.now();
    programSceneRef.current = scene; setProgramScene(scene);
  };

  const activateScene = async (scene: Scene, fromTake = false) => {
    try {
      if (!fromTake && !openingSlatePlayedRef.current && !openingSlateUntilRef.current) {
        openingSlatePlayedRef.current = true;
        openingSlateUntilRef.current = performance.now() + 2600;
      }
      if (scene === 'camera') {
        await ensureStudio();
        setProductionSource('camera');
      } else if (scene === 'video') {
        if (!sourceVideoRef.current) { videoFileInputRef.current?.click(); return; }
        await ensureStudio(); await sourceVideoRef.current.play().catch(() => undefined);
        setSourceVideoPlaying(!sourceVideoRef.current.paused); setProductionSource('video');
      } else {
        if (!navigator.mediaDevices?.getDisplayMedia) { toast.info('Screen sharing is not supported by this browser. Camera, video, guest and replay scenes remain available.'); return; }
        if (!screenStreamRef.current) {
          const preset = VIDEO_PRESETS[quality];
          const ss = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: preset.fps, max: preset.fps }, width: { ideal: preset.width, max: preset.width }, height: { ideal: preset.height, max: preset.height }, aspectRatio: { ideal: 16 / 9 } }, audio: false });
          screenStreamRef.current = ss;
          const track = ss.getVideoTracks()[0];
          track.onended = () => { screenStreamRef.current = null; setSharing(false); void activateScene('camera'); };
          setSharing(true);
        }
      }
      setActiveScene(scene);
      if (!fromTake) {
        const id = scene as TvSceneId;
        setPreviewScene(id); previewSceneRef.current = id;
      }
      await createProductionProgram();
      setStatus('preview');
    } catch (e: any) { toast.error(e?.message || 'Could not prepare scene'); }
  };

  const loadLocalAudio = (kind: 'music' | 'sfx', file?: File) => {
    if (!file || !file.type.startsWith('audio/')) { toast.error('Choose an audio file.'); return; }
    const url = URL.createObjectURL(file);
    if (kind === 'music') {
      if (musicUrlRef.current) URL.revokeObjectURL(musicUrlRef.current);
      musicUrlRef.current = url; setMusicName(file.name);
      const el = musicAudioRef.current ?? new Audio();
      el.loop = true; el.preload = 'auto'; el.src = url; el.volume = 1; musicAudioRef.current = el;
      void el.play().catch(() => undefined);
      if (productionAudioContextRef.current?.state === 'suspended') void productionAudioContextRef.current.resume();
      if (productionAudioContextRef.current && productionMasterGainRef.current) {
        if (!productionMusicSourceRef.current) productionMusicSourceRef.current = productionAudioContextRef.current.createMediaElementSource(el);
        if (!productionMusicGainRef.current) {
          productionMusicGainRef.current = productionAudioContextRef.current.createGain();
          productionMusicSourceRef.current.connect(productionMusicGainRef.current).connect(productionMasterGainRef.current);
        }
        productionMusicGainRef.current.gain.value = musicLevel;
      }
    } else {
      if (sfxUrlRef.current) URL.revokeObjectURL(sfxUrlRef.current);
      sfxUrlRef.current = url; setSfxName(file.name);
      const el = sfxAudioRef.current ?? new Audio();
      el.preload = 'auto'; el.src = url; el.volume = 1; sfxAudioRef.current = el;
      void el.play().catch(() => undefined);
      if (productionAudioContextRef.current?.state === 'suspended') void productionAudioContextRef.current.resume();
      if (productionAudioContextRef.current && productionMasterGainRef.current) {
        if (!productionSfxSourceRef.current) productionSfxSourceRef.current = productionAudioContextRef.current.createMediaElementSource(el);
        if (!productionSfxGainRef.current) {
          productionSfxGainRef.current = productionAudioContextRef.current.createGain();
          productionSfxSourceRef.current.connect(productionSfxGainRef.current).connect(productionMasterGainRef.current);
        }
        productionSfxGainRef.current.gain.value = sfxLevel;
      }
    }
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
    setActiveScene('video');
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

  const assertProductionReady = async (program: MediaStream) => {
    const preset = VIDEO_PRESETS[quality];
    await new Promise<void>(resolve => window.setTimeout(resolve, 150));
    const videoTrack = program.getVideoTracks()[0];
    const audioTrack = program.getAudioTracks()[0];
    if (!videoTrack || videoTrack.readyState !== 'live') throw new Error('ON AIR blocked: the production video bus is not live.');
    if (!audioTrack || audioTrack.readyState !== 'live') throw new Error('ON AIR blocked: the production audio bus is not live.');
    if (sceneCanvasRef.current?.width !== preset.width || sceneCanvasRef.current?.height !== preset.height) {
      throw new Error(`ON AIR blocked: production raster is not ${preset.width}×${preset.height}.`);
    }
    const cameraTrack = cameraStreamRef.current?.getVideoTracks()[0];
    if (!cameraTrack || cameraTrack.readyState !== 'live') throw new Error('ON AIR blocked: camera track is not live.');
    return { width: preset.width, height: preset.height, fps: preset.fps };
  };

  const startLive = async () => {
    if (live || roomRef.current || broadcastStage !== 'idle') return;
    setBroadcastError(null);
    setBroadcastDiagnostics(null);
    setBroadcastStage('preparing');
    let session: TestagramTvCloudflareSession | TestagramTvYouTubeSession | TestagramTvMediaSession | null = null;
    let guestSession: TestagramTvMediaSession | null = null;
    let id: string | null = null;
    let createdBroadcast = false;
    try {
      if (!user) throw new Error('Sign in to broadcast');
      await ensureStudio();
      const program = await createProductionProgram();
      await assertProductionReady(program);
      setBroadcastStage('authorizing');

      const { data: existing, error: existingError } = await supabase
        .from('live_streams')
        .select('id,title,description,category,is_live,tv_provider')
        .eq('user_id', user.id)
        .eq('is_live', true)
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (existingError) throw new Error(existingError.message);

      if (existing?.id) {
        const { data: auth } = await supabase.auth.getSession();
        const headers = { 'Content-Type': 'application/json', ...(auth.session?.access_token ? { Authorization: `Bearer ${auth.session.access_token}` } : {}) };
        const verifyResponse = await fetch('/api/live', {
          method: 'POST',
          headers,
          body: JSON.stringify({ action: 'verify', stream_id: existing.id }),
        });
        const verifyPayload = await verifyResponse.json().catch(() => null);
        if (existing.tv_provider === 'cloudflare' && verifyResponse.ok && verifyPayload?.data?.on_air) {
          throw new Error('A Testagram TV broadcast is already ON AIR in another studio session. End that broadcast before starting a new one.');
        }
        await fetch('/api/live', { method: 'POST', headers, body: JSON.stringify({ action: 'stop', stream_id: existing.id }) }).catch(() => undefined);
      }

      if (!id) {
        const { data, error } = await supabase.from('live_streams').insert({
          user_id: user.id,
          title: broadcastTitle,
          description: broadcastDescription,
          category: broadcastCategory,
          is_live: false,
          tv_provider: 'youtube',
        }).select('id,title,description,category,is_live,tv_provider').single();
        if (error || !data) throw new Error(error?.message || 'Could not create broadcast.');
        id = data.id;
        createdBroadcast = true;
        setActiveStreamId(id);
        setStream(data);
      }

      setBroadcastStage('connecting');
      const { data: auth } = await supabase.auth.getSession();
      const headers = { 'Content-Type': 'application/json', ...(auth.session?.access_token ? { Authorization: `Bearer ${auth.session.access_token}` } : {}) };
      const startResponse = await fetch('/api/live', {
        method: 'POST',
        headers,
        body: JSON.stringify({ action: 'start', stream_id: id }),
      });
      let startPayload = await startResponse.json().catch(() => null);
      let provider: 'youtube' | 'cloudflare' | 'native-p2p' = 'youtube';

      // YouTube is the public TV delivery provider. Testagram still owns the
      // studio, control plane and encoder; YouTube owns public live playback.
      const youtubeStart = startPayload?.data?.youtube;
      const youtubeToken = typeof youtubeStart?.encoder_token === 'string' ? youtubeStart.encoder_token : '';
      if (startResponse.ok && youtubeToken) {
        session = await TestagramTvYouTubeSession.connect({
          streamId: id,
          encoderToken: youtubeToken,
          program,
          videoBitsPerSecond: VIDEO_PRESETS[quality].bitrate,
          onStatus: (next, detail) => {
            setBroadcastDiagnostics({ provider: 'youtube', encoder_status: next, detail: detail || null, youtube_video_id: youtubeStart?.video_id || null });
            if (next === 'reconnecting') setBroadcastStage('connecting');
          },
        });
        roomRef.current = session;
      } else {
        const errorMessage = String(startPayload?.error?.message || '');
        const nativeResponse = await fetch('/api/live', {
          method: 'POST',
          headers,
          body: JSON.stringify({ action: 'start', provider: 'native-p2p', stream_id: id }),
        });
        const nativePayload = await nativeResponse.json().catch(() => null);
        if (!nativeResponse.ok) throw new Error(errorMessage || nativePayload?.error?.message || 'YouTube TV delivery could not be started.');
        provider = 'native-p2p';
        try {
          session = await TestagramTvMediaSession.connectHostExisting(id, program);
          roomRef.current = session;
        } catch (nativeError) {
          await fetch('/api/live', { method: 'POST', headers, body: JSON.stringify({ action: 'stop', stream_id: id }) }).catch(() => undefined);
          throw nativeError;
        }
        setBroadcastDiagnostics({
          provider: 'native-p2p',
          fallback: true,
          youtube: 'not_ready',
          message: 'YouTube delivery was unavailable; native Testagram WebRTC is carrying the broadcast.',
        });
      }

      // Interactive guests continue to use the Supabase Realtime/WebRTC bridge.
      guestSession = await TestagramTvMediaSession.connectHostGuestBridge(id, program);
      guestSession.setRemoteTrackHandler(track => {
        track.onended = () => {
          setGuestConnected(false);
          setSourceHealth(prev => ({ ...prev, guest: 'lost' }));
          if (liveRef.current && programSceneRef.current === 'guest') void takeScene('black').catch(() => undefined);
          toast.warning('Guest signal lost. Testagram TV removed the guest from Program safely.');
        };
        if (track.kind === 'video') {
          const stream = new MediaStream([track]);
          if (remoteGuestVideoRef.current) {
            remoteGuestVideoRef.current.srcObject = stream;
            remoteGuestVideoRef.current.muted = true;
            remoteGuestVideoRef.current.playsInline = true;
            void remoteGuestVideoRef.current.play().catch(() => undefined);
          }
        } else if (track.kind === 'audio') {
          const stream = new MediaStream([track]);
          if (remoteGuestAudioRef.current) {
            remoteGuestAudioRef.current.srcObject = stream;
            remoteGuestAudioRef.current.muted = false;
            remoteGuestAudioRef.current.autoplay = true;
            void remoteGuestAudioRef.current.play().catch(() => undefined);
          }
        }
        setGuestConnected(true);
        setSourceHealth(prev => ({ ...prev, guest: 'ready' }));
      });
      guestRoomRef.current = guestSession;

      setBroadcastStage('verifying');
      const verifyDeadline = Date.now() + 60_000;
      let onAir = false;
      let lastHealth: any = null;
      while (Date.now() < verifyDeadline) {
        const verifyResponse = await fetch('/api/live', {
          method: 'POST',
          headers,
          body: JSON.stringify({ action: 'verify', stream_id: id }),
        });
        const verifyPayload = await verifyResponse.json().catch(() => null);
        if (verifyResponse.ok && verifyPayload?.data) {
          lastHealth = verifyPayload.data.health || null;
          setYoutubeStatus(String(verifyPayload.data.health?.youtube?.status || verifyPayload.data.youtube?.status || "disabled"));
          if (verifyPayload.data.provider === 'native-p2p') setBroadcastDiagnostics(prev => ({ ...(prev || {}), provider: 'native-p2p', fallback: true, cloudflare: 'not_provisioned' }));
          if (verifyPayload.data.on_air) {
            onAir = true;
            break;
          }
        }
        await new Promise(resolve => window.setTimeout(resolve, 2000));
      }
      if (!onAir) {
        throw new Error(provider === 'native-p2p'
          ? 'Testagram native TV transport did not reach ON AIR within 60s.'
          : `YouTube has not reached ON AIR within 60s.${lastHealth?.youtube_stream_status ? ` YouTube stream=${lastHealth.youtube_stream_status}.` : ''}`);
      }

      setBroadcastStage('on-air');
      setViewerCount(0);
      liveRef.current = true;
      setLive(true);
      setMode('live');
      setStatus('live');
      setElapsed(0);
      setBroadcastError(null);
      toast.success(provider === 'youtube' ? `Testagram TV is ON AIR through YouTube at up to ${Math.min(VIDEO_PRESETS[quality].width, 1920)}×${Math.min(VIDEO_PRESETS[quality].height, 1080)} / ${VIDEO_PRESETS[quality].fps}fps` : 'Testagram TV is ON AIR through native Testagram WebRTC');
    } catch (e: any) {
      if (guestSession) await guestSession.close().catch(() => undefined);
      if (session) {
        setBroadcastDiagnostics(session.getDiagnostics());
        await session.close().catch(() => undefined);
      }
      if (id && user) {
        const { data: auth } = await supabase.auth.getSession();
        await fetch('/api/live', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(auth.session?.access_token ? { Authorization: `Bearer ${auth.session.access_token}` } : {}) },
          body: JSON.stringify({ action: 'stop', stream_id: id }),
        }).catch(() => undefined);
      }
      guestRoomRef.current = null;
      roomRef.current = null;
      setGuestConnected(false);
      setViewerCount(0);
      setLive(false);
      setMode('studio');
      setStatus(cameraStreamRef.current ? 'preview' : 'idle');
      if (createdBroadcast) setActiveStreamId(null);
      const message = e?.message || 'Unable to start live broadcast';
      setBroadcastError(message);
      setBroadcastStage('idle');
      toast.error(message);
    }
  };

  const createGuestInvite = async () => {
    if (!activeStreamId || !live) { toast.info('Go live first, then invite a guest.'); return; }
    try {
      const { data: auth } = await supabase.auth.getSession();
      const response = await fetch('/api/live', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(auth.session?.access_token ? { Authorization: `Bearer ${auth.session.access_token}` } : {}) },
        body: JSON.stringify({ action: 'create-guest', stream_id: activeStreamId }),
      });
      const data = await response.json();
      const error = response.ok ? null : new Error('Guest invitation request failed');
      if (error || !data?.data?.invite_token) throw new Error(data?.error?.message || error?.message || 'Could not create guest invitation');
      const url = `${window.location.origin}/tv/live/${activeStreamId}?guest=${encodeURIComponent(data.data.invite_token)}`;
      setGuestInviteUrl(url);
      try { await navigator.clipboard.writeText(url); toast.success('Guest invitation copied'); } catch { toast.success('Guest invitation created'); }
    } catch (e: any) { toast.error(e?.message || 'Could not create guest invitation'); }
  };

  const shareLiveLink = async () => {
    if (!activeStreamId) { toast.info('Go live first to create a shareable TV link.'); return; }
    const url = `${window.location.origin}/tv/live/${activeStreamId}`;
    try {
      if (navigator.share) await navigator.share({ title: stream?.title || broadcastTitle || 'Testagram TV', text: 'Watch this Testagram TV broadcast live', url });
      else { await navigator.clipboard.writeText(url); toast.success('Shareable TV link copied'); }
    } catch (e: any) {
      if (e?.name !== 'AbortError') { try { await navigator.clipboard.writeText(url); toast.success('Shareable TV link copied'); } catch { toast.error('Could not copy TV link'); } }
    }
  };

  const stopLive = async () => {
    const activeSession = roomRef.current;
    const activeGuestSession = guestRoomRef.current;
    if (activeGuestSession) await activeGuestSession.close().catch(() => undefined);
    if (activeSession) await activeSession.close().catch(() => undefined);

    if (activeStreamId && user) {
      const { data: auth } = await supabase.auth.getSession();
      await fetch('/api/live', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(auth.session?.access_token ? { Authorization: `Bearer ${auth.session.access_token}` } : {}) },
        body: JSON.stringify({ action: 'stop', stream_id: activeStreamId }),
      }).catch(() => undefined);
    }

    roomRef.current = null;
    guestRoomRef.current = null;
    setViewerCount(0);
    setGuestConnected(false);
    setBroadcastStage('idle');
    setBroadcastDiagnostics(null);
    setGuestInviteUrl(null);
    remoteGuestVideoRef.current?.pause();
    remoteGuestVideoRef.current = null;
    remoteGuestAudioRef.current?.pause();
    remoteGuestAudioRef.current = null;
    liveRef.current = false;
    setLive(false);
    if (!recording) setStatus(cameraStreamRef.current ? 'preview' : 'idle');
    productionVideoTrackRef.current = null;
    productionAudioTrackRef.current = null;
    if (activeStreamId) {
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

  const shareScreen = async () => {
    if (sharing) {
      screenStreamRef.current?.getTracks().forEach(t => t.stop());
      screenStreamRef.current = null;
      setSharing(false);
      await activateScene('camera');
      return;
    }
    try {
      const preset = VIDEO_PRESETS[quality];
      const s = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: preset.fps, width: { ideal: preset.width }, height: { ideal: preset.height } },
        audio: false,
      });
      screenStreamRef.current = s;
      const track = s.getVideoTracks()[0];
      track.onended = () => {
        screenStreamRef.current = null;
        setSharing(false);
        void activateScene('camera');
      };
      setSharing(true);
      await activateScene('screen');
    } catch (e: any) {
      if (e?.name !== 'NotAllowedError') toast.error(e?.message || 'Screen sharing could not start');
    }
  };

  useEffect(() => {
    const id = window.setInterval(() => {
      const stats = programFrameRef.current;
      setProgramFps(stats.count);
      setProgramDropped(stats.dropped);
      const cameraLive = cameraStreamRef.current?.getVideoTracks()[0]?.readyState === 'live';
      const audioLive = cameraStreamRef.current?.getAudioTracks()[0]?.readyState === 'live';
      const programLive = programStreamRef.current?.getVideoTracks()[0]?.readyState === 'live' && programStreamRef.current?.getAudioTracks()[0]?.readyState === 'live';
      setStudioHealth(!deviceReady ? 'offline' : cameraLive && audioLive && programLive && stats.dropped < 12 ? 'ready' : 'degraded');
      stats.count = 0;
      stats.dropped = 0;
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!live || !activeStreamId || !user) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const { data: auth } = await supabase.auth.getSession();
        const headers = { 'Content-Type': 'application/json', ...(auth.session?.access_token ? { Authorization: 'Bearer ' + auth.session.access_token } : {}) };
        const response = await fetch('/api/live', { method: 'POST', headers, body: JSON.stringify({ action: 'verify', stream_id: activeStreamId }) });
        const payload = await response.json().catch(() => null);
        if (cancelled || !response.ok || !payload?.data) return;
        const health = payload.data.health || {};
        const encoder = roomRef.current?.getStatus() || 'stopped';
        setBroadcastDiagnostics({ provider: 'cloudflare', encoder_status: encoder, cloudflare_status: health.cloudflare_input_status || payload.data.cloudflare_input_status || 'unknown', on_air: Boolean(payload.data.on_air), youtube_status: health.youtube?.status || payload.data.youtube?.status || 'disabled' });
        setYoutubeStatus(String(health.youtube?.status || payload.data.youtube?.status || 'disabled'));
        if (!payload.data.on_air) {
          setStudioHealth('degraded');
          toast.error('Live output health changed. Testagram TV is checking the encoder and Cloudflare Stream connection.');
        }
      } catch {}
    };
    void poll();
    const id = window.setInterval(() => void poll(), 10000);
    return () => { cancelled = true; window.clearInterval(id); };
  }, [live, activeStreamId, user]);

  useEffect(() => {
    if (!live || !activeStreamId || !user) return;
    let cancelled = false;
    const heartbeat = async () => {
      try {
        const { data: auth } = await supabase.auth.getSession();
        const headers = { 'Content-Type': 'application/json', ...(auth.session?.access_token ? { Authorization: 'Bearer ' + auth.session.access_token } : {}) };
        await fetch('/api/live', { method: 'POST', headers, body: JSON.stringify({ action: 'heartbeat', stream_id: activeStreamId, connection_state: roomRef.current?.getStatus() === 'encoding' ? 'connected' : 'degraded', peer_id: 'cloudflare-browser-encoder' }) });
      } catch {}
    };
    void heartbeat();
    const id = window.setInterval(() => { if (!cancelled) void heartbeat(); }, 15000);
    return () => { cancelled = true; window.clearInterval(id); };
  }, [live, activeStreamId, user]);

  useEffect(() => {
    const id = window.setInterval(() => {
      setElapsed(prev => (recording || live ? prev + 1 : 0));
      const meter = audioPipelineRef.current?.getMeter();
      if (meter) {
        setAudioLevel(meter.level);
        setAudioPeak(meter.peak);
        setAudioClipping(meter.clipped);
      }
    }, 1000);
    return () => window.clearInterval(id);
  }, [recording, live]);

  useEffect(() => {
    if (productionMusicGainRef.current) productionMusicGainRef.current.gain.value = musicLevel;
    if (productionSfxGainRef.current) productionSfxGainRef.current.gain.value = sfxLevel;
  }, [musicLevel, sfxLevel]);

  useEffect(() => {
    replayBufferRef.current = new TvReplayBuffer(replaySeconds * 1000, lightModeRef.current ? 1000 : 500);
  }, [replaySeconds]);

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

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(target.tagName)) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key === '1') { event.preventDefault(); void activateScene('camera'); }
      else if (key === '2') { event.preventDefault(); if (sourceVideoRef.current) void activateScene('video'); else toast.info('Load a video first.'); }
      else if (key === '3') { event.preventDefault(); void shareScreen(); }
      else if (key === '4') { event.preventDefault(); setPreviewScene('guest'); previewSceneRef.current = 'guest'; }
      else if (key === 'b') { event.preventDefault(); void takeScene('black'); }
      else if (key === 't' || key === 'enter') { event.preventDefault(); void takeScene(previewSceneRef.current); }
      else if (key === 'r') { event.preventDefault(); void takeScene('replay'); }
      else if (key === 'm') { event.preventDefault(); toggleMic(); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [previewScene]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const saved = JSON.parse(localStorage.getItem('testagram-tv-scene-presets') || '{}');
      if (saved && typeof saved === 'object') setScenePresets(saved);
    } catch {}
  }, []);

  const saveScenePreset = (name: string) => {
    const key = name.trim().slice(0, 32);
    if (!key) return;
    const next = { ...scenePresets, [key]: { preview: previewSceneRef.current, transition: transitionType, duration: transitionDuration, pip: pipEnabled, graphics } };
    setScenePresets(next);
    try { localStorage.setItem('testagram-tv-scene-presets', JSON.stringify(next)); } catch {}
    toast.success('Scene preset saved: ' + key);
  };

  const loadScenePreset = (name: string) => {
    const preset = scenePresets[name];
    if (!preset) return;
    setPreviewScene(preset.preview); previewSceneRef.current = preset.preview;
    setTransitionType(preset.transition); setTransitionDuration(preset.duration);
    setPipEnabled(preset.pip); pipEnabledRef.current = preset.pip;
    setGraphics(preset.graphics);
    toast.success('Preset loaded: ' + name);
  };

  useEffect(() => {
    const monitor = window.setInterval(() => {
      const cameraLive = cameraStreamRef.current?.getVideoTracks()[0]?.readyState === 'live';
      const videoReady = Boolean(sourceVideoRef.current && sourceVideoRef.current.readyState >= 2 && !sourceVideoRef.current.ended);
      const screenLive = screenStreamRef.current?.getVideoTracks()[0]?.readyState === 'live';
      const guestLive = Boolean(remoteGuestVideoRef.current?.srcObject && remoteGuestVideoRef.current.readyState >= 2);
      setSourceHealth({ camera: cameraLive ? 'ready' : cameraStreamRef.current ? 'lost' : 'idle', video: videoReady ? 'ready' : sourceVideoRef.current ? 'lost' : 'idle', screen: screenLive ? 'ready' : screenStreamRef.current ? 'lost' : 'idle', guest: guestConnected ? (guestLive ? 'ready' : 'lost') : 'idle' });
      if (liveRef.current) {
        const current = programSceneRef.current;
        const lost = (current === 'camera' && !cameraLive) || (current === 'video' && !videoReady) || (current === 'screen' && !screenLive) || (current === 'guest' && !guestLive);
        if (lost) {
          setStudioHealth('degraded');
          void takeScene('black').catch(() => undefined);
        }
      }
    }, 1000);
    return () => window.clearInterval(monitor);
  }, [guestConnected]);

  useEffect(() => {
    const onVisibility = () => {
      if (!liveRef.current) return;
      if (document.visibilityState === 'hidden') {
        setStudioHealth('degraded');
        toast.warning('Studio tab is backgrounded. Broadcast health is being protected.');
      } else {
        void audioPipelineRef.current?.context.resume().catch(() => undefined);
        void roomRef.current?.recover().catch(() => setStudioHealth('degraded'));
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  const fmt = (n: number) => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;

  return (
    <div className="tv-studio min-h-screen bg-zinc-950 text-zinc-100">
      <style>{`
        .tv-studio button.border-input { color:#f4f4f5 !important; background:#18181b !important; border-color:#3f3f46 !important; }
        .tv-studio button.border-input:hover { color:#fff !important; background:#27272a !important; }
        .tv-studio button.bg-secondary { color:#f4f4f5 !important; background:#27272a !important; }
        .tv-studio button.bg-secondary:hover { background:#3f3f46 !important; color:#fff !important; }
        .tv-studio select { color:#f4f4f5; background:#27272a; border-color:#3f3f46; }
        .tv-studio input[type="text"], .tv-studio input[type="file"] { color:#f4f4f5; }
        .tv-studio button { min-height:36px; }
        @media (max-width: 768px) { .tv-studio .max-w-7xl { padding-bottom:5rem; } }
      `}</style>
      <div className="max-w-7xl mx-auto p-3 md:p-6">
        <header className="flex items-center justify-between mb-4 gap-3">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <Clapperboard className="w-6 h-6" />
              <div>
                <h1 className="text-2xl font-black tracking-tight">TESTAGRAM TV <span className="text-zinc-500 font-semibold">Studio</span></h1>
                <div className="text-[10px] uppercase tracking-[0.28em] text-red-400 font-bold mt-0.5">Broadcast Control Room</div>
              </div>
              {!recording ? <Button size="sm" className="bg-red-600 hover:bg-red-700 text-zinc-100" disabled={saving} onClick={() => void startRecording()}><Circle className="w-4 h-4 mr-1" />REC to device</Button> : <Button size="sm" variant="destructive" onClick={stopRecording}><Square className="w-4 h-4 mr-1" />STOP & SAVE</Button>}
              {live && <span className="px-2 py-1 rounded-full bg-red-600 text-xs font-bold animate-pulse">LIVE</span>}{live && <Button size="sm" variant="outline" onClick={() => void shareLiveLink()}><Radio className="w-4 h-4 mr-1" />Share TV</Button>}
              {recording && <span className="px-2 py-1 rounded-full bg-zinc-700/50 text-xs font-bold">REC {fmt(elapsed)}</span>}
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
          {broadcastStage !== 'idle' && !broadcastError && (
            <div className="mb-3 rounded-xl border border-blue-500/30 bg-blue-500/10 p-3 text-sm text-blue-100">
              <div className="flex items-center gap-2 font-semibold">
                <Activity className="w-4 h-4 animate-pulse" />
                {broadcastStage === 'preparing' && 'Preparing the TV program…'}
                {broadcastStage === 'authorizing' && 'Authorizing the broadcast…'}
                {broadcastStage === 'connecting' && 'Connecting TV signaling + WebRTC…'}
                {broadcastStage === 'verifying' && 'Verifying WebRTC connection and live media…'}
                {broadcastStage === 'on-air' && 'ON AIR'}
              </div>
              {broadcastStage === 'on-air' && <p className="mt-2 text-xs text-zinc-300">Cloudflare: <span className="font-semibold text-emerald-300">ON AIR</span> · YouTube: <span className={youtubeStatus === 'broadcasting' ? 'font-semibold text-emerald-300' : 'font-semibold text-amber-300'}>{youtubeStatus}</span></p>}
              <p className="mt-1 text-xs text-blue-200/80">
                {broadcastStage === 'preparing' && 'Checking camera, microphone and production A/V tracks.'}
                {broadcastStage === 'authorizing' && 'Creating the private broadcast session and requesting media authorization.'}
                {broadcastStage === 'connecting' && 'Waiting for the signaling channel and WebRTC answer.'}
                {broadcastStage === 'verifying' && 'Validating live camera/microphone tracks and preparing the producer WebRTC session.'}
                {broadcastStage === 'on-air' && 'Producer is transmitting. Public viewers attach automatically and the studio marks media delivery healthy after inbound RTP is confirmed.'}
              </p>
              {broadcastDiagnostics && <p className="mt-2 text-[10px] text-zinc-300">{broadcastDiagnostics.mediaReachedViewer ? <>Viewer media: confirmed · video packets: {String(broadcastDiagnostics.viewerVideoPackets ?? broadcastDiagnostics.videoPackets ?? 0)} · audio packets: {String(broadcastDiagnostics.viewerAudioPackets ?? broadcastDiagnostics.audioPackets ?? 0)} · {String(broadcastDiagnostics.viewerWidth ?? broadcastDiagnostics.width ?? 0)}×{String(broadcastDiagnostics.viewerHeight ?? broadcastDiagnostics.height ?? 0)}</> : <>Producer tracks: {broadcastDiagnostics.mediaReady ? 'live' : 'checking'} · Viewer media: awaiting first inbound RTP</>}</p>}
            </div>
          )}
          {broadcastError && (
            <div className="mb-3 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-100">
              <div className="font-semibold">Broadcast connection failed</div>
              <p className="mt-1 text-xs text-red-200/80">{broadcastError}</p>
              <div className="mt-2"><Button size="sm" onClick={() => void startLive()}>Try broadcast again</Button></div>
            </div>
          )}
          <section className="rounded-2xl overflow-hidden border border-zinc-800/80 bg-black shadow-2xl">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 bg-zinc-950 p-2">
              <div className="aspect-video relative rounded-lg overflow-hidden border border-blue-500/30 bg-black">
                <canvas ref={previewCanvasRef} className="w-full h-full object-contain" />
                <span className="absolute top-2 left-2 rounded bg-zinc-950/90 border border-zinc-700/70 px-2 py-1 text-[10px] font-bold tracking-wider">TESTAGRAM TV · PREVIEW · {previewScene.toUpperCase()}</span>
              </div>
              <div className="aspect-video relative rounded-lg overflow-hidden border border-red-500/30 bg-black">
                {status === 'idle' && <div className="absolute inset-0 z-10 flex flex-col items-center justify-center text-zinc-500"><Radio className="w-10 h-10 mb-2" /><span>Program monitor</span><span className="text-xs mt-1">Tap Preview to start the camera and microphone</span></div>}
                <div className="absolute bottom-2 left-2 flex gap-1 pointer-events-none">
                  <span className={`rounded px-2 py-1 text-[9px] font-bold ${studioHealth === 'ready' ? 'bg-emerald-500/90' : studioHealth === 'degraded' ? 'bg-amber-500/90' : 'bg-zinc-700/90'}`}>SIGNAL {studioHealth.toUpperCase()}</span>
                  {live && <span className="rounded bg-zinc-950/90 border border-zinc-700 px-2 py-1 text-[9px] font-bold">ENC {String(broadcastDiagnostics?.encoder_status || 'starting').toUpperCase()}</span>}
                </div>
                <video ref={videoRef} autoPlay muted playsInline className="w-full h-full object-contain" />
                {multiview && <canvas ref={multiviewCanvasRef} width={640} height={360} className="absolute inset-0 w-full h-full object-contain pointer-events-none" />}
                <div className="absolute top-2 left-2 flex gap-2 pointer-events-none">
                  <span className="rounded bg-red-600/90 px-2 py-1 text-[10px] font-bold tracking-wider">{live ? '● LIVE · TESTAGRAM TV' : 'TESTAGRAM TV · PROGRAM'}</span>
                  {sharing && <span className="rounded bg-blue-600/90 px-2 py-1 text-[10px] font-bold">SCREEN</span>}
                </div>
              </div>
            </div>
            <div className="p-3 border-t border-zinc-800/80 flex flex-wrap gap-2">
              <Button size="sm" disabled={saving} onClick={() => void activateScene('camera')}><Camera className="w-4 h-4 mr-1" />Preview</Button>
              <Button size="sm" variant="outline" onClick={() => setShortcutHint(v => !v)}>Shortcuts</Button>
              <Button size="sm" variant={camera ? 'default' : 'destructive'} onClick={toggleCamera}><Camera className="w-4 h-4 mr-1" />{camera ? 'Camera' : 'Camera off'}</Button>
              <Button size="sm" variant={!muted ? 'default' : 'destructive'} onClick={toggleMic}><Mic className="w-4 h-4 mr-1" />{muted ? 'Mic off' : 'Mic'}</Button>
              <Button size="sm" variant={sharing ? 'secondary' : 'outline'} onClick={() => void shareScreen()}><MonitorUp className="w-4 h-4 mr-1" />{sharing ? 'Stop screen' : 'Screen'}</Button>
              {!recording ? <Button size="sm" disabled={saving} onClick={() => void startRecording()}><Circle className="w-4 h-4 mr-1" />Record locally</Button> : <Button size="sm" variant="destructive" onClick={stopRecording}><Square className="w-4 h-4 mr-1" />Stop & save</Button>}
              {!live ? <Button size="sm" disabled={broadcastStage !== 'idle'} className="bg-red-600 hover:bg-red-700" onClick={() => void startLive()}><Radio className="w-4 h-4 mr-1" />{broadcastStage === 'idle' ? 'Go live' : broadcastStage === 'on-air' ? 'ON AIR' : 'Connecting…'}</Button> : <><Button size="sm" variant="outline" onClick={() => void shareLiveLink()}><Radio className="w-4 h-4 mr-1" />Share TV</Button><Button size="sm" variant="destructive" onClick={() => void stopLive()}>End live</Button></>}
            </div>
          </section>

          <aside className="space-y-3">
                          <div className="rounded-xl border border-white/10 bg-black/30 p-3 space-y-3">
                <div className="flex items-center gap-2 font-semibold text-sm"><Layers3 className="w-4 h-4" />Program / scenes</div>
                <div className="grid grid-cols-4 gap-2">
                  <Button size="sm" variant={previewScene === 'camera' ? 'default' : 'outline'} onClick={() => void activateScene('camera')}><Camera className="w-4 h-4 mr-1" />Camera</Button>
                  <Button size="sm" variant={activeScene === 'video' ? 'default' : 'outline'} onClick={() => void activateScene('video')}><Upload className="w-4 h-4 mr-1" />Video</Button>
                  <Button size="sm" variant={previewScene === 'screen' ? 'default' : 'outline'} onClick={() => void shareScreen()}><MonitorUp className="w-4 h-4 mr-1" />Screen</Button>
                  <Button size="sm" variant={previewScene === 'guest' ? 'default' : 'outline'} disabled={!guestConnected} onClick={() => setPreviewScene('guest')}>Guest</Button>
                </div>
                <input ref={videoFileInputRef} type="file" accept="video/*" className="hidden" onChange={e => void loadProductionVideo(e.target.files?.[0])} />
                {uploadedVideoName && <div className="text-[11px] text-zinc-400 truncate">{uploadedVideoName}</div>}
                {activeScene === 'video' && sourceVideoRef.current && <div className="grid grid-cols-2 gap-2">
                  <Button size="sm" variant="outline" onClick={() => void toggleProductionVideo()}>{sourceVideoPlaying ? 'Pause video' : 'Play video'}</Button>
                  <Button size="sm" variant="outline" onClick={() => setPipEnabled(v => !v)}><PictureInPicture2 className="w-4 h-4 mr-1" />PiP {pipEnabled ? 'on' : 'off'}</Button>
                </div>}
                <div><div className="flex justify-between text-[11px] text-zinc-400"><span>Video audio</span><span>{Math.round(programLevel * 100)}%</span></div><input type="range" min="0" max="1" step="0.05" value={programLevel} onChange={e => setProgramLevel(Number(e.target.value))} className="w-full" /></div>
                <div><div className="flex justify-between text-[11px] text-zinc-400"><span>Commentary voice</span><span>{Math.round(commentaryLevel * 100)}%</span></div><input type="range" min="0" max="1.5" step="0.05" value={commentaryLevel} onChange={e => setCommentaryLevel(Number(e.target.value))} className="w-full" /></div>
                <p className="text-[10px] text-zinc-500">Preview → TAKE → Program. Graphics and transitions are rendered into the program bus.</p>
                <div className="rounded-lg bg-black/30 p-2 space-y-2">
                  <div className="flex items-center justify-between"><span className="text-xs font-semibold">SCENE PRESETS</span><Button size="sm" variant="outline" onClick={() => saveScenePreset(window.prompt('Preset name') || '')}>Save</Button></div>
                  <div className="flex flex-wrap gap-1">
                    {Object.keys(scenePresets).map(name => <button key={name} className="rounded bg-zinc-800 px-2 py-1 text-[10px] hover:bg-zinc-700" onClick={() => loadScenePreset(name)}>{name}</button>)}
                    {!Object.keys(scenePresets).length && <span className="text-[10px] text-zinc-500">Save a camera/video/screen setup for one-tap recall.</span>}
                  </div>
                </div>
                <div className="grid grid-cols-4 gap-1 text-[9px] uppercase tracking-wide">
                  {(['camera','video','screen','guest'] as const).map(source => <span key={source} className={`rounded px-2 py-1 text-center ${sourceHealth[source] === 'ready' ? 'bg-emerald-500/15 text-emerald-300' : sourceHealth[source] === 'lost' ? 'bg-red-500/15 text-red-300' : 'bg-zinc-800 text-zinc-500'}`}>{source}: {sourceHealth[source]}</span>)}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Button size="sm" variant="outline" onClick={() => void takeScene(previewScene)}>TAKE {previewScene.toUpperCase()}</Button>
                  <Button size="sm" variant="outline" onClick={() => void takeScene('black')}>DIP TO BLACK</Button>
                  <select value={transitionType} onChange={e => setTransitionType(e.target.value as TransitionType)} className="rounded-lg bg-zinc-800 p-2 text-xs">
                    <option value="cut">CUT</option><option value="fade">FADE</option><option value="dip">DIP</option>
                  </select>
                  <select value={transitionDuration} onChange={e => setTransitionDuration(Number(e.target.value))} className="rounded-lg bg-zinc-800 p-2 text-xs">
                    <option value="150">150ms</option><option value="300">300ms</option><option value="500">500ms</option><option value="1000">1s</option>
                  </select>
                </div>
                <div className="rounded-lg bg-black/30 p-2 space-y-2">
                  <div className="flex items-center justify-between text-xs font-semibold"><span>PROGRAM / PREVIEW</span><span className="text-emerald-400">ON AIR: {programScene}</span></div>
                  <div className="grid grid-cols-2 gap-2 text-[11px]">
                    <button className="rounded bg-zinc-800 p-2" onClick={() => { setPreviewScene('camera'); previewSceneRef.current='camera'; }}>Preview Camera</button>
                    <button className="rounded bg-zinc-800 p-2" onClick={() => { setPreviewScene('video'); previewSceneRef.current='video'; }}>Preview Video</button>
                    <button className="rounded bg-zinc-800 p-2" onClick={() => { setPreviewScene('screen'); previewSceneRef.current='screen'; }}>Preview Screen</button>
                    <button className="rounded bg-zinc-800 p-2" onClick={() => { setPreviewScene('replay'); previewSceneRef.current='replay'; }}>Preview Replay</button>
                    <button className="rounded bg-zinc-800 p-2" disabled={!guestConnected} onClick={() => { setPreviewScene('guest'); previewSceneRef.current='guest'; }}>Preview Guest</button>
                  </div>
                </div>
                <div className="rounded-lg bg-black/30 p-2 space-y-2">
                  <div className="text-xs font-semibold">GRAPHICS</div>
                  <input value={lowerThirdText} onChange={e => setLowerThirdText(e.target.value)} placeholder="Lower third name/title" className="w-full rounded bg-zinc-800 p-2 text-xs" />
                  <input value={lowerThirdSecondary} onChange={e => setLowerThirdSecondary(e.target.value)} placeholder="Lower third secondary" className="w-full rounded bg-zinc-800 p-2 text-xs" />
                  <input value={tickerText} onChange={e => setTickerText(e.target.value)} placeholder="Ticker / breaking news" className="w-full rounded bg-zinc-800 p-2 text-xs" />
                  <input value={bannerText} onChange={e => setBannerText(e.target.value)} placeholder="Breaking banner" className="w-full rounded bg-zinc-800 p-2 text-xs" />
                  <input value={fullscreenText} onChange={e => setFullscreenText(e.target.value)} placeholder="Fullscreen title" className="w-full rounded bg-zinc-800 p-2 text-xs" />
                  <input value={nextText} onChange={e => setNextText(e.target.value)} placeholder="Coming up / next segment" className="w-full rounded bg-zinc-800 p-2 text-xs" />
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-1">
                    <Button size="sm" variant="outline" onClick={() => setGraphics(g => g.map(x => x.id === 'lower-third' ? { ...x, text: lowerThirdText, secondary: lowerThirdSecondary, visible: true } : x))}>Lower 3rd</Button>
                    <Button size="sm" variant="outline" onClick={() => setGraphics(g => g.map(x => x.id === 'lower-third' ? { ...x, visible: false } : x))}>Hide 3rd</Button>
                    <Button size="sm" variant="outline" onClick={() => setGraphics(g => g.map(x => x.id === 'ticker' ? { ...x, text: tickerText, visible: true } : x))}>Ticker</Button>
                    <Button size="sm" variant="outline" onClick={() => setGraphics(g => g.map(x => x.id === 'ticker' ? { ...x, visible: false } : x))}>Hide ticker</Button>
                    <Button size="sm" variant="outline" onClick={() => setGraphics(g => g.map(x => x.id === 'station-bug' ? { ...x, visible: !x.visible } : x))}>Bug</Button>
                    <Button size="sm" variant="outline" onClick={() => setGraphics(g => g.map(x => x.id === 'breaking-banner' ? { ...x, text: bannerText, visible: true } : x))}>Banner</Button>
                    <Button size="sm" variant="outline" onClick={() => setGraphics(g => g.map(x => x.id === 'breaking-banner' ? { ...x, visible: false } : x))}>Hide banner</Button>
                    <Button size="sm" variant="outline" onClick={() => setGraphics(g => g.map(x => x.id === 'fullscreen' ? { ...x, text: fullscreenText, visible: true } : x))}>Fullscreen</Button>
                    <Button size="sm" variant="outline" onClick={() => setGraphics(g => g.map(x => x.id === 'fullscreen' ? { ...x, visible: false } : x))}>Hide full</Button>
                    <Button size="sm" variant="outline" onClick={() => setGraphics(g => g.map(x => x.id === 'next' ? { ...x, text: nextText, visible: true } : x))}>Next</Button>
                    <Button size="sm" variant="outline" onClick={() => setGraphics(g => g.map(x => x.id === 'next' ? { ...x, visible: false } : x))}>Hide next</Button>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2 text-[10px]">
                  {[15,30,60].map(seconds => <button key={seconds} className={`rounded bg-zinc-800 p-2 ${replaySeconds === seconds ? 'ring-1 ring-emerald-400' : ''}`} onClick={() => setReplaySeconds(seconds)}>{seconds}s Replay</button>)}
                </div>
                <div className="rounded-lg bg-black/30 p-2 space-y-2">
                  <div className="text-xs font-semibold">AUDIO BUSES</div>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="rounded bg-zinc-800 p-2 text-[10px]">Music<input type="file" accept="audio/*" className="block w-full mt-1" onChange={e => loadLocalAudio('music', e.target.files?.[0])} /><span className="text-zinc-500">{musicName || 'none'}</span></label>
                    <label className="rounded bg-zinc-800 p-2 text-[10px]">SFX<input type="file" accept="audio/*" className="block w-full mt-1" onChange={e => loadLocalAudio('sfx', e.target.files?.[0])} /><span className="text-zinc-500">{sfxName || 'none'}</span></label>
                  </div>
                  <div><span className="text-[10px] text-zinc-400">Music</span><input type="range" min="0" max="1" step="0.05" value={musicLevel} onChange={e => setMusicLevel(Number(e.target.value))} className="w-full" /></div>
                  <div><span className="text-[10px] text-zinc-400">SFX</span><input type="range" min="0" max="1" step="0.05" value={sfxLevel} onChange={e => setSfxLevel(Number(e.target.value))} className="w-full" /></div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Button size="sm" variant={multiview ? 'default' : 'outline'} onClick={() => setMultiview(v => !v)}>Multiview</Button>
                  <Button size="sm" variant="outline" onClick={() => void createGuestInvite()} disabled={!live}>Invite Guest</Button>
                  <Button size="sm" variant={replayState === 'playing' ? 'default' : 'outline'} disabled={!replayBufferRef.current.frameCount} onClick={() => void takeScene('replay')}>REPLAY</Button>
                  <Button size="sm" variant={audioDucking ? 'default' : 'outline'} onClick={() => setAudioDucking(v => !v)}>Auto ducking</Button>
                </div>
                {guestInviteUrl && <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 p-2 text-[10px]">
                  <div className="font-semibold text-emerald-300">Guest invite ready · expires in 60 minutes</div>
                  <div className="mt-1 break-all text-zinc-400">{guestInviteUrl}</div>
                  <Button size="sm" className="mt-2" onClick={() => { void navigator.clipboard?.writeText(guestInviteUrl); toast.success('Guest invite copied'); }}>Copy invite</Button>
                </div>}
              </div>
            <div className="rounded-2xl border border-white/10 bg-zinc-900 p-4">
              <div className="flex items-center gap-2 font-semibold mb-3"><Settings2 className="w-4 h-4" />Production controls</div>
              <label className="text-xs text-zinc-400">Capture quality</label>
              <select value={quality} disabled={live || recording} onChange={e => setQuality(e.target.value as Quality)} className="w-full mt-1 rounded-lg bg-zinc-800 p-2">
                <option value="4k">4K UHD (3840×2160)</option><option value="1080p">1080p Full HD</option><option value="720p">720p HD</option><option value="480p">480p</option>
              </select>
              <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-lg bg-black/30 p-2"><Activity className="w-3.5 h-3.5 mb-1 text-emerald-400" /><span>{quality === '4k' ? '4K UHD' : quality}</span><p className="text-zinc-500">production output</p></div>
                <div className="rounded-lg bg-black/30 p-2"><Mic className="w-3.5 h-3.5 mb-1 text-emerald-400" /><span>48 kHz</span><p className="text-zinc-500">processed audio</p></div>
                <div className="rounded-lg bg-black/30 p-2"><Users className="w-3.5 h-3.5 mb-1 text-blue-400" /><span>{viewerCount}</span><p className="text-zinc-500">live viewers</p></div>
                <div className="rounded-lg bg-black/30 p-2"><ShieldCheck className="w-3.5 h-3.5 mb-1 text-emerald-400" /><span>Local</span><p className="text-zinc-500">recording storage</p></div>
              </div>
              <div className="mt-2 text-[10px] text-zinc-500">Replay buffer: {replayBufferRef.current.frameCount} frames / {Math.round(replayBufferRef.current.durationMs / 1000)}s · Guest: {guestConnected ? 'ready' : 'offline'}</div>
              <div className="mt-1 text-[10px] text-zinc-500">Render: {programFps} FPS · delayed {programDropped}</div>
              <div className="mt-4 flex items-center justify-between text-[10px] text-zinc-500"><span>Studio signal</span><span className={`uppercase tracking-wider font-semibold ${studioHealth === 'ready' ? 'text-emerald-400' : studioHealth === 'degraded' ? 'text-amber-400' : 'text-zinc-500'}`}>{studioHealth}</span></div>
              <div className="mt-1 h-2 rounded-full bg-zinc-700/50 overflow-hidden"><div className="h-full bg-emerald-400 transition-all" style={{ width: `${Math.min(100, audioLevel)}%` }} /></div>
              <p className="text-[10px] text-zinc-500 mt-1">Camera: {cameraResolution} · browser noise suppression + studio gate/compressor</p>
              <div className="mt-2 flex items-center gap-2 text-[10px]">
                <span>Audio</span><div className="h-2 flex-1 rounded bg-zinc-800 overflow-hidden"><div className="h-full bg-emerald-500 transition-all" style={{ width: audioPeak + '%' }} /></div>
                <span className={audioClipping ? 'text-red-400 font-bold' : 'text-zinc-500'}>{audioClipping ? 'CLIP' : Math.round(audioPeak) + '%'}</span>
              </div>
              {shortcutHint && <div className="mt-3 rounded-lg border border-white/10 bg-black/40 p-2 text-[10px] text-zinc-400">Hotkeys: <b>1</b> Camera · <b>2</b> Video · <b>3</b> Screen · <b>4</b> Guest · <b>T/Enter</b> Take · <b>R</b> Replay · <b>B</b> Black · <b>M</b> Mic</div>}
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
