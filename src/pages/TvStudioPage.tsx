import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { TestagramTvMediaSession } from '@/lib/testagramTvMedia';
import { TestagramTvYouTubeSession } from '@/lib/testagramTvYouTube';
import { Camera, Mic, MonitorUp, Circle, Square, Radio, Users, Download, Clapperboard, Settings2, Activity, ShieldCheck, Upload, PictureInPicture2, Layers3, BarChart3, Copy, Share2, Hand } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import { createStudioAudioPipeline, requestStudioMicrophone, type StudioAudioPipeline } from '@/lib/studioAudio';
import { drawTvGraphics, drawTvOpeningSlate, makeDefaultGraphics, TvReplayBuffer, type TvGraphic, type TvSceneId, type TransitionType } from '@/lib/tvProduction';

type Mode = 'studio' | 'live';
type Scene = 'camera' | 'video' | 'screen';
const TV_GUEST_CAPACITY = 6;
type GuestSlotState = { slot:number; label:string; inviteUrl:string; lifecycle:'invited'|'connecting'|'connected'|'partial'|'lost'; videoReady:boolean; audioReady:boolean; peerId?:string; };
type Quality = '4k' | '1440p' | '1080p' | '720p' | '480p';

const VIDEO_PRESETS: Record<Quality, { width: number; height: number; fps: number; bitrate: number }> = {
  '4k': { width: 3840, height: 2160, fps: 30, bitrate: 30_000_000 },
  '1440p': { width: 2560, height: 1440, fps: 30, bitrate: 15_000_000 },
  '1080p': { width: 1920, height: 1080, fps: 30, bitrate: 8_000_000 },
  '720p': { width: 1280, height: 720, fps: 30, bitrate: 5_000_000 },
  '480p': { width: 854, height: 480, fps: 30, bitrate: 2_500_000 },
};
const CAMERA_CONSTRAINTS: Record<Quality, MediaTrackConstraints> = {
  '4k': { width: { min: 1920, ideal: 3840, max: 3840 }, height: { min: 1080, ideal: 2160, max: 2160 }, aspectRatio: { ideal: 16 / 9 }, frameRate: { min: 24, ideal: 30, max: 30 }, facingMode: { ideal: 'environment' } },
  '1440p': { width: { min: 1280, ideal: 2560, max: 2560 }, height: { min: 720, ideal: 1440, max: 1440 }, aspectRatio: { ideal: 16 / 9 }, frameRate: { min: 24, ideal: 30, max: 30 }, facingMode: { ideal: 'environment' } },
  '1080p': { width: { min: 1280, ideal: 1920, max: 1920 }, height: { min: 720, ideal: 1080, max: 1080 }, aspectRatio: { ideal: 16 / 9 }, frameRate: { min: 24, ideal: 30, max: 30 }, facingMode: { ideal: 'environment' } },
  '720p': { width: { min: 960, ideal: 1280, max: 1280 }, height: { min: 540, ideal: 720, max: 720 }, aspectRatio: { ideal: 16 / 9 }, frameRate: { min: 24, ideal: 30, max: 30 }, facingMode: { ideal: 'environment' } },
  '480p': { width: { min: 640, ideal: 854, max: 854 }, height: { min: 360, ideal: 480, max: 480 }, aspectRatio: { ideal: 16 / 9 }, frameRate: { ideal: 30, max: 30 }, facingMode: { ideal: 'environment' } },
};

export default function TvStudioPage({ persistentDock = false }: { persistentDock?: boolean }) {
  const { streamId } = useParams();
  const nav = useNavigate();
  const [searchParams] = useSearchParams();
  const { user } = useAuth();

  const videoRef = useRef<HTMLVideoElement>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const roomRef = useRef<TestagramTvYouTubeSession | TestagramTvMediaSession | null>(null);
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
  const productionGuestSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const productionMusicSourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const productionMusicGainRef = useRef<GainNode | null>(null);
  const productionSfxSourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const productionSfxGainRef = useRef<GainNode | null>(null);
  const productionCommentaryMeterRef = useRef<AnalyserNode | null>(null);
  const productionSourceMeterRef = useRef<AnalyserNode | null>(null);
  const productionGuestMeterRef = useRef<AnalyserNode | null>(null);
  const productionMusicMeterRef = useRef<AnalyserNode | null>(null);
  const productionSfxMeterRef = useRef<AnalyserNode | null>(null);
  const productionMasterMeterRef = useRef<AnalyserNode | null>(null);
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
  const guestVideoElementsRef = useRef<Map<number,HTMLVideoElement>>(new Map());
  const guestAudioElementsRef = useRef<Map<number,HTMLAudioElement>>(new Map());
  const guestPeerSlotsRef = useRef<Map<string,number>>(new Map());
  const guestMultiviewStreamRef = useRef<MediaStream | null>(null);
  const [replayState, setReplayState] = useState<'ready' | 'playing'>('ready');
  const [programFps, setProgramFps] = useState(0);
  const [programDropped, setProgramDropped] = useState(0);
  const programFrameRef = useRef({ last: 0, count: 0, dropped: 0 });
  const [guestConnected, setGuestConnected] = useState(false);
  const [guestVideoReady, setGuestVideoReady] = useState(false);
  const [guestAudioReady, setGuestAudioReady] = useState(false);
  const [guestLifecycle, setGuestLifecycle] = useState<'offline' | 'invited' | 'connecting' | 'connected' | 'partial' | 'lost'>('offline');
  const [guestInviteUrl, setGuestInviteUrl] = useState<string | null>(null);
  const [guestSlots, setGuestSlots] = useState<GuestSlotState[]>([]);
  const [guestSignalRequests, setGuestSignalRequests] = useState<Record<number, { kind:'raise-hand'|'add-to-point'|'second-point'; at:number }>>({});
  const guestSlotsRef = useRef<GuestSlotState[]>([]);
  guestSlotsRef.current = guestSlots;
  const [bannerText, setBannerText] = useState('');
  const [fullscreenText, setFullscreenText] = useState('');
  const [nextText, setNextText] = useState('');
  const [musicName, setMusicName] = useState<string | null>(null);
  const [sfxName, setSfxName] = useState<string | null>(null);
  const [musicLevel, setMusicLevel] = useState(0.5);
  const [sfxLevel, setSfxLevel] = useState(0.7);
  const [guestLevel, setGuestLevel] = useState(1);
  const [activeGuestSlot, setActiveGuestSlot] = useState<number | null>(null);
  const activeGuestSlotRef = useRef<number | null>(null);
  activeGuestSlotRef.current = activeGuestSlot;
  const [masterLevel, setMasterLevel] = useState(1);
  const [musicMuted, setMusicMuted] = useState(false);
  const [sfxMuted, setSfxMuted] = useState(false);
  const [guestMuted, setGuestMuted] = useState(false);
  const [programMuted, setProgramMuted] = useState(false);
  const [masterMuted, setMasterMuted] = useState(false);
  const [musicState, setMusicState] = useState<'empty' | 'ready' | 'playing' | 'paused'>('empty');
  const [sfxState, setSfxState] = useState<'empty' | 'ready' | 'playing'>('empty');
  const [audioBusMeters, setAudioBusMeters] = useState<Record<string, number>>({ mic: 0, program: 0, guest: 0, music: 0, sfx: 0, master: 0 });
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
    if (mobile || (memory > 0 && memory <= 4) || (cores > 0 && cores <= 4)) return '1080p';
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
  const [graphicsPreview, setGraphicsPreview] = useState<TvGraphic[]>(makeDefaultGraphics);
  // The compositor loop is mounted once for media stability. Refs keep the hot path current.
  const graphicsRef = useRef<TvGraphic[]>(makeDefaultGraphics());
  const graphicsPreviewRef = useRef<TvGraphic[]>(makeDefaultGraphics());
  const graphicsMasterRef = useRef(true);
  const [lowerThirdText, setLowerThirdText] = useState('');
  const [lowerThirdSecondary, setLowerThirdSecondary] = useState('');
  const [tickerText, setTickerText] = useState('');
  const [multiview, setMultiview] = useState(false);
  const [replaySeconds, setReplaySeconds] = useState(30);
  const [graphicsMaster, setGraphicsMaster] = useState(true);
  const [audioDucking, setAudioDucking] = useState(false);
  const [duckingActive, setDuckingActive] = useState(false);
  const [duckingReduction, setDuckingReduction] = useState(0);
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
  const [pollQuestion, setPollQuestion] = useState('');
  const [pollOptions, setPollOptions] = useState(['Yes','No']);
  const [cameraResolution, setCameraResolution] = useState('not started');
  const [cameraFacing, setCameraFacing] = useState<'front' | 'back'>('back');
  const [studioHealth, setStudioHealth] = useState<'ready' | 'degraded' | 'offline'>('offline');
  const [shortcutHint, setShortcutHint] = useState(false);
  const [scenePresets, setScenePresets] = useState<Record<string, { preview: TvSceneId; transition: TransitionType; duration: number; pip: boolean; graphics: TvGraphic[] }>>({});
  const transitionSnapshotRef = useRef<HTMLCanvasElement | null>(null);
  graphicsRef.current = graphics;
  graphicsPreviewRef.current = graphicsPreview;
  graphicsMasterRef.current = graphicsMaster;

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

  const getDisplayMedia = (): ((constraints?: MediaStreamConstraints) => Promise<MediaStream>) | null => {
    const mediaDevices = navigator.mediaDevices as MediaDevices | undefined;
    if (mediaDevices && typeof mediaDevices.getDisplayMedia === 'function') {
      return mediaDevices.getDisplayMedia.bind(mediaDevices);
    }
    const legacy = (navigator as Navigator & { getDisplayMedia?: (constraints?: MediaStreamConstraints) => Promise<MediaStream> }).getDisplayMedia;
    return typeof legacy === 'function' ? legacy.bind(navigator) : null;
  };

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

  const getCamera = async (requestedFacing: 'front' | 'back' = cameraFacing) => {
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
          video: { ...CAMERA_CONSTRAINTS[quality], facingMode: { ideal: requestedFacing === 'front' ? 'user' : 'environment' } },
          audio: { channelCount: { ideal: 1 }, sampleRate: { ideal: 48000 }, sampleSize: { ideal: 24 }, echoCancellation: true, noiseSuppression: true, autoGainControl: false },
        });
      } catch (error) {
        if ((error as DOMException)?.name !== 'OverconstrainedError') throw error;
        s = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: preset.width }, height: { ideal: preset.height }, aspectRatio: { ideal: 16 / 9 }, frameRate: { ideal: preset.fps, max: preset.fps }, facingMode: { ideal: requestedFacing === 'front' ? 'user' : 'environment' } },
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

  const switchCameraFacing = async (requestedFacing: 'front' | 'back') => {
    if (requestedFacing === cameraFacing) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      toast.error('This browser cannot switch cameras.');
      return;
    }
    const current = cameraStreamRef.current;
    if (!current) {
      try {
        await getCamera(requestedFacing);
        setCameraFacing(requestedFacing);
      } catch {}
      return;
    }
    const currentVideo = current.getVideoTracks()[0];
    if (!currentVideo) {
      toast.error('The active camera has no video track.');
      return;
    }

    const requestedMode = requestedFacing === 'front' ? 'user' : 'environment';
    const previousSettings = currentVideo.getSettings();
    let replacement: MediaStream | null = null;
    let nextVideo: MediaStreamTrack | null = null;

    try {
      // Do NOT rely on applyConstraints() here. Some mobile browsers resolve it
      // without actually changing the physical camera. A real getUserMedia
      // acquisition gives us a new track that can be verified before swapping.
      try {
        replacement = await navigator.mediaDevices.getUserMedia({
          video: {
            ...CAMERA_CONSTRAINTS[quality],
            facingMode: { exact: requestedMode },
          },
          audio: false,
        });
      } catch (error) {
        if ((error as DOMException)?.name !== 'OverconstrainedError') throw error;

        // A few browsers reject the full quality constraints even though the
        // requested lens exists. Retry with only the physical-camera selector.
        replacement = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { exact: requestedMode } },
          audio: false,
        });
      }

      nextVideo = replacement.getVideoTracks()[0] ?? null;
      if (!nextVideo) throw new Error('The selected camera did not provide a video track.');

      const nextSettings = nextVideo.getSettings();
      const facingVerified = nextSettings.facingMode === requestedMode;
      const deviceChanged = Boolean(
        previousSettings.deviceId &&
        nextSettings.deviceId &&
        previousSettings.deviceId !== nextSettings.deviceId,
      );

      // A switch is only committed when the browser gives us evidence that the
      // physical camera changed. This prevents the UI from saying "Front"
      // while the old rear track is still producing frames.
      if (!facingVerified && !deviceChanged) {
        throw new Error('The browser did not confirm a physical camera change. The previous camera remains active.');
      }

      // Replace the track inside the existing stream so all consumers of the
      // production camera stream keep the same MediaStream object.
      current.removeTrack(currentVideo);
      current.addTrack(nextVideo);
      currentVideo.stop();

      nextVideo.onended = () => {
        setCamera(false);
        setDeviceReady(false);
        setStudioHealth('degraded');
        if (liveRef.current && programSceneRef.current === 'camera') void takeScene('black').catch(() => undefined);
        toast.error('Camera signal lost. Testagram TV switched to a safe fallback.');
      };

      // Rebind the actual production camera element and wait for it to expose
      // a real video frame. The compositor reads this element, not the button
      // state, so this is the point where the physical lens change becomes
      // visible to Preview, Program and the live canvas.
      if (productionCameraVideoRef.current) {
        productionCameraVideoRef.current.srcObject = null;
        productionCameraVideoRef.current.srcObject = current;
        await productionCameraVideoRef.current.play().catch(() => undefined);
      }
      if (videoRef.current && videoRef.current.srcObject === current) {
        await videoRef.current.play().catch(() => undefined);
      }

      setCameraFacing(requestedFacing);
      if (nextSettings.width && nextSettings.height) {
        setCameraResolution(
          String(nextSettings.width) + '×' + nextSettings.height + ' @ ' +
          Math.round(nextSettings.frameRate || VIDEO_PRESETS[quality].fps) + 'fps',
        );
      }
      setDeviceReady(true);
      setCamera(true);
      setPermissionError(null);
      toast.success((requestedFacing === 'front' ? 'Front' : 'Back') + ' camera is now active.');
    } catch (error) {
      // Never change the facing-state indicator unless the physical track was
      // actually replaced. Clean up a failed candidate and keep the old camera.
      if (replacement && nextVideo && nextVideo !== currentVideo) {
        nextVideo.stop();
        replacement.getTracks().forEach(track => {
          if (track !== nextVideo) track.stop();
        });
      }
      const message = error instanceof DOMException && error.name === 'NotAllowedError'
        ? 'Camera permission is required to switch cameras. Allow camera access and try again.'
        : error instanceof DOMException && error.name === 'OverconstrainedError'
          ? 'The ' + requestedFacing + ' camera is not available on this device.'
          : error instanceof Error
            ? error.message
            : explainMediaError(error);
      setPermissionError(message);
      toast.error(message);
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
        const activeGuests = guestSlotsRef.current.filter(g => (g.lifecycle === 'connected' || g.lifecycle === 'partial') && g.videoReady).sort((x, y) => x.slot - y.slot);
        const hostReady = camera.readyState >= 2 && camera.videoWidth > 0;
        const guestVideos = activeGuests.map(g => guestVideoElementsRef.current.get(g.slot) || null).filter((v): v is HTMLVideoElement => Boolean(v && v.readyState >= 2 && v.videoWidth > 0));
        const sources: Array<{ kind: 'video' | 'camera' | 'guest'; media: HTMLVideoElement }> = [
          { kind: 'video', media: sourceVideo },
          ...(hostReady ? [{ kind: 'camera' as const, media: camera }] : []),
          ...guestVideos.map(media => ({ kind: 'guest' as const, media })),
        ];
        // Build the composition only from sources that actually have usable video.
        // An invitation alone must never reserve a visual cell. This keeps Preview/Program
        // packed until a guest's video track is genuinely connected and ready.
        const readySources = sources.filter(entry => entry.media.readyState >= 2 && entry.media.videoWidth > 0);
        const drawSourceTile = (entry: typeof sources[number], x: number, y: number, width: number, height: number) => {
          target.save();
          target.fillStyle = '#050505';
          target.fillRect(x, y, width, height);
          fit(target, entry.media, true, width, height);
          target.fillStyle = 'rgba(9,9,11,.78)';
          target.fillRect(x + 8, y + 8, entry.kind === 'video' ? 82 : 76, 20);
          target.fillStyle = '#fff';
          target.font = '800 10px sans-serif';
          target.fillText(entry.kind === 'video' ? 'MEDIA' : entry.kind === 'camera' ? 'HOST' : 'GUEST', x + 14, y + 22);
          target.restore();
        };
        if (readySources.length === 0) {
          target.fillStyle = '#050505';
          target.fillRect(0, 0, canvas.width, canvas.height);
        } else if (readySources.length === 1) {
          fit(target, readySources[0].media, true);
        } else if (readySources.length === 2) {
          // Uploaded media + host camera: two real sources fill the entire raster.
          const gap = Math.max(6, Math.round(canvas.width * 0.008));
          const tileW = Math.floor((canvas.width - gap) / 2);
          drawSourceTile(readySources[0], 0, 0, tileW, canvas.height);
          drawSourceTile(readySources[1], tileW + gap, 0, canvas.width - tileW - gap, canvas.height);
        } else {
          // With guests, give the media a primary tile and pack only connected guest/host
          // sources into the remaining area. No placeholder guest tile is ever rendered.
          const gap = Math.max(6, Math.round(canvas.width * 0.008));
          const mediaWidth = Math.floor(canvas.width * 0.58);
          const sideX = mediaWidth + gap;
          const sideWidth = canvas.width - sideX;
          const sideSources = readySources.slice(1);
          const sideCols = sideSources.length <= 2 ? 1 : 2;
          const sideRows = Math.ceil(sideSources.length / sideCols);
          const sideGap = gap;
          const tileW = Math.floor((sideWidth - sideGap * (sideCols - 1)) / sideCols);
          const tileH = Math.floor((canvas.height - sideGap * (sideRows - 1)) / sideRows);
          drawSourceTile(readySources[0], 0, 0, mediaWidth, canvas.height);
          sideSources.forEach((entry, index) => {
            const col = index % sideCols;
            const row = Math.floor(index / sideCols);
            drawSourceTile(entry, sideX + col * (tileW + sideGap), row * (tileH + sideGap), tileW, tileH);
          });
        }
      } else if (scene === 'screen') {
        if (screenStreamRef.current && screenVideo.srcObject !== screenStreamRef.current) screenVideo.srcObject = screenStreamRef.current;
        fit(target, screenVideo, true);
      } else if (scene === 'guest') {
        fit(target, guestVideoElementsRef.current.get(activeGuestSlotRef.current || guestSlotsRef.current[0]?.slot || 0) || remoteGuestVideoRef.current, true);
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
      const w=mv.width,h=mv.height;
      mctx.fillStyle='#09090b';mctx.fillRect(0,0,w,h);
      const guests=guestSlotsRef.current.filter(g => (g.lifecycle === 'connected' || g.lifecycle === 'partial') && g.videoReady).sort((a,b)=>a.slot-b.slot);
      const cells:any[]=[
        {scene:'camera',label:'CAMERA'}, {scene:'video',label:'VIDEO'}, {scene:'screen',label:'SCREEN'}, {scene:'replay',label:'REPLAY'}, {scene:'preview',label:'PREVIEW'}, {scene:'program',label:'PROGRAM'},
        ...guests.map(g=>({scene:'guest:'+g.slot,label:g.label.toUpperCase()})),
      ];
      const cols = cells.length <= 2 ? cells.length : cells.length <= 4 ? 2 : cells.length <= 6 ? 3 : 4;
      const rows = Math.max(1, Math.ceil(cells.length / cols));
      const gap = Math.max(4, Math.round(w * 0.006));
      const cellW = Math.floor((w - gap * (cols - 1)) / cols), cellH = Math.floor((h - gap * (rows - 1)) / rows);
      cells.forEach((item:any,i)=>{ item.x=(i%cols)*(cellW+gap); item.y=Math.floor(i/cols)*(cellH+gap); item.width=cellW; item.height=cellH; });
      const status=(scene:string)=>{
        if(scene.startsWith('guest:')) return guests.find(g=>g.slot===Number(scene.split(':')[1]))?.lifecycle.toUpperCase()||'OFFLINE';
        if(scene==='program') return liveRef.current?'ON AIR':'PROGRAM';
        if(scene==='preview') return previewSceneRef.current.toUpperCase();
        if(scene==='replay') return replayBufferRef.current.frameCount?Math.round(replayBufferRef.current.durationMs/1000)+'s READY':'EMPTY';
        if(scene==='camera') return cameraStreamRef.current?.getVideoTracks().some(x=>x.readyState==='live')?'READY':'IDLE';
        if(scene==='video') return sourceVideo&&sourceVideo.readyState>=2?'READY':'IDLE';
        if(scene==='screen') return screenStreamRef.current?.getVideoTracks().some(x=>x.readyState==='live')?'READY':'IDLE';
        return 'IDLE';
      };
      cells.slice(0,12).forEach((item:any,i)=>{
        const cell=multiviewCellCanvasRefs.current[i]??document.createElement('canvas');
        if(cell.width!==item.width)cell.width=item.width;if(cell.height!==item.height)cell.height=item.height;
        multiviewCellCanvasRefs.current[i]=cell;
        const c=cell.getContext('2d');if(!c)return;c.fillStyle='#000';c.fillRect(0,0,item.width,cellH);
        if(item.scene==='camera')fitCameraLandscape(c,camera,item.width,item.height);
        else if(item.scene==='video'&&sourceVideo)fit(c,sourceVideo,true,item.width,item.height);
        else if(item.scene==='screen')fit(c,screenVideo,true,item.width,item.height);
        else if(item.scene==='replay'){const f=replayBufferRef.current.latestCanvas();if(f)c.drawImage(f,0,0,item.width,cellH);}
        else if(item.scene==='preview'){const p=previewCanvasRef.current;if(p&&p.width)c.drawImage(p,0,0,item.width,cellH);}
        else if(item.scene==='program')c.drawImage(canvas,0,0,item.width,cellH);
        else if(item.scene.startsWith('guest:'))fit(c,guestVideoElementsRef.current.get(Number(item.scene.split(':')[1]))||null,true,item.width,item.height);
        mctx.drawImage(cell,item.x,item.y);mctx.fillStyle='rgba(9,9,11,.88)';mctx.fillRect(item.x,item.y,item.width,28);
        mctx.fillStyle='#fff';mctx.font='800 10px sans-serif';mctx.fillText(item.label,item.x+7,item.y+12);
        mctx.fillStyle=item.scene==='program'&&liveRef.current?'#f87171':'#a1a1aa';mctx.font='700 9px sans-serif';mctx.fillText(status(item.scene),item.x+7,item.y+23);
      });
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
        if (previewSceneRef.current !== 'replay' && previewSceneRef.current !== 'black') {
          drawTvGraphics(previewCtx, previewCanvas.width, previewCanvas.height, graphicsPreviewRef.current, now / 8, {
            live: liveRef.current, watermark: true, graphicsEnabled: graphicsMasterRef.current,
          });
        }
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
        drawTvGraphics(ctx, canvas.width, canvas.height, graphicsRef.current, now / 8, { live: liveRef.current, watermark: true, graphicsEnabled: graphicsMasterRef.current });
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
      if ((multiview || guestMultiviewStreamRef.current) && frameStats.count % (lightModeRef.current ? 4 : 2) === 0) renderMultiview();
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
      productionMasterMeterRef.current = audioContext.createAnalyser();
      productionMasterMeterRef.current.fftSize = 256;
      productionMasterGainRef.current.connect(productionMasterMeterRef.current).connect(limiter).connect(destination);
    }

    if (sourceVideo && !productionSourceAudioRef.current) {
      productionSourceAudioRef.current = audioContext.createMediaElementSource(sourceVideo);
      productionSourceGainRef.current = audioContext.createGain();
      productionSourceMeterRef.current = audioContext.createAnalyser();
      productionSourceMeterRef.current.fftSize = 256;
      productionSourceAudioRef.current.connect(productionSourceGainRef.current).connect(productionSourceMeterRef.current).connect(productionMasterGainRef.current);
    }
    if (productionSourceGainRef.current) {
      productionSourceGainRef.current.gain.value =
        programSceneRef.current === 'video' && !sourceVideoMuted && !programMuted ? programLevel : 0;
    }
    if (sourceVideo && sourceVideo.muted !== sourceVideoMuted) sourceVideo.muted = sourceVideoMuted;

    if (audioPipelineRef.current && !productionCommentaryGainRef.current) {
      const commentary = audioContext.createMediaStreamSource(audioPipelineRef.current.stream);
      const commentaryGain = audioContext.createGain();
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 512;
      commentary.connect(analyser).connect(commentaryGain).connect(productionMasterGainRef.current);
      productionCommentaryGainRef.current = commentaryGain;
      productionCommentaryAnalyserRef.current = analyser;
      productionCommentaryMeterRef.current = analyser;
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
        const meter = audioContext!.createAnalyser();
        meter.fftSize = 256;
        if (sourceRef === productionMusicSourceRef) productionMusicMeterRef.current = meter;
        if (sourceRef === productionSfxSourceRef) productionSfxMeterRef.current = meter;
        sourceRef.current.connect(gainRef.current).connect(meter).connect(productionMasterGainRef.current!);
      }
      gainRef.current!.gain.value = level;
    };
    wireLocalAudioBus(musicAudioRef.current, productionMusicSourceRef, productionMusicGainRef, musicLevel);
    wireLocalAudioBus(sfxAudioRef.current, productionSfxSourceRef, productionSfxGainRef, sfxLevel);

    if (duckingTimerRef.current) window.clearInterval(duckingTimerRef.current);
    if (productionCommentaryAnalyserRef.current) {
      const data = new Uint8Array(productionCommentaryAnalyserRef.current.fftSize);
      let lastUiUpdate = 0;
      duckingTimerRef.current = window.setInterval(() => {
        if (!productionCommentaryAnalyserRef.current) return;
        productionCommentaryAnalyserRef.current.getByteTimeDomainData(data);
        let sum = 0; for (const v of data) { const n = (v - 128) / 128; sum += n * n; }
        const rms = Math.sqrt(sum / data.length);
        const speech = rms > 0.035;
        const duck = audioDucking && speech;
        const time = performance.now();
        if (time - lastUiUpdate >= 200) {
          lastUiUpdate = time;
          setDuckingActive(duck);
          setDuckingReduction(duck ? 72 : 0);
        }
        const now = audioContext!.currentTime;
        const release = 0.12;
        const duckFactor = duck ? 0.28 : 1;
        if (productionSourceGainRef.current) {
          const programTarget = programSceneRef.current === 'video' && !sourceVideoMuted && !programMuted ? programLevel * duckFactor : 0;
          productionSourceGainRef.current.gain.setTargetAtTime(programTarget, now, release);
        }
            if (productionMusicGainRef.current) productionMusicGainRef.current.gain.setTargetAtTime(musicMuted ? 0 : musicLevel * duckFactor, now, release);
        if (productionSfxGainRef.current) productionSfxGainRef.current.gain.setTargetAtTime(sfxMuted ? 0 : sfxLevel * duckFactor, now, release);
        if (productionGuestGainRef.current) productionGuestGainRef.current.gain.setTargetAtTime(guestMuted ? 0 : guestLevel * duckFactor, now, release);
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
    if (!mapped && scene !== 'guest' && scene !== 'black') {
      toast.info('That scene is not available yet.');
      return;
    }
    if (scene === 'black') {
      transitionFromSceneRef.current = programSceneRef.current;
      transitionFromCanvasRef.current = sceneCanvasRef.current;
      transitionRef.current = { type: transitionType, durationMs: transitionDuration };
      transitionStartedRef.current = performance.now();
      programSceneRef.current = 'black'; setProgramScene('black'); return;
    }
    if (scene === 'guest' && (!guestConnected || !remoteGuestVideoRef.current || remoteGuestVideoRef.current.readyState < 2)) { toast.info('Guest video is not ready yet.'); return; }
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
        const requestDisplayMedia = getDisplayMedia();
        if (!requestDisplayMedia) {
          toast.info('Screen sharing is unavailable in this browser. Use Camera, Video, Guest or Replay.');
          return;
        }
        if (!screenStreamRef.current) {
          const preset = VIDEO_PRESETS[quality];
          const ss = await requestDisplayMedia({ video: { frameRate: { ideal: preset.fps, max: preset.fps }, width: { ideal: preset.width, max: preset.width }, height: { ideal: preset.height, max: preset.height }, aspectRatio: { ideal: 16 / 9 } }, audio: false });
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

  const graphicDraft = (id: string, visible: boolean): TvGraphic => {
    const base = graphicsPreviewRef.current.find(item => item.id === id) ?? graphicsRef.current.find(item => item.id === id) ?? { id, kind: 'bug' as const, text: '', visible: false, z: 100 };
    if (id === 'lower-third') return { ...base, text: lowerThirdText, secondary: lowerThirdSecondary, visible };
    if (id === 'ticker') return { ...base, text: tickerText, visible };
    if (id === 'breaking-banner') return { ...base, text: bannerText, visible };
    if (id === 'fullscreen') return { ...base, text: fullscreenText, visible };
    if (id === 'next') return { ...base, text: nextText, visible };
    return { ...base, visible };
  };
  const prepareGraphic = (id: string) => {
    setGraphicsPreview(current => current.map(item => item.id === id ? graphicDraft(id, true) : item));
    toast.success('Graphic prepared in Preview. TAKE it when ready.');
  };
  const takeGraphic = (id: string) => {
    const prepared = graphicsPreviewRef.current.find(item => item.id === id);
    if (!prepared?.visible) { toast.info('Prepare this graphic in Preview first.'); return; }
    setGraphics(current => current.map(item => item.id === id ? { ...prepared, visible: graphicsMaster } : item));
    toast.success(graphicsMaster ? 'Graphic TAKEN to Program.' : 'Graphic prepared; Graphics Master is OFF.');
  };
  const clearGraphic = (id: string) => {
    setGraphics(current => current.map(item => item.id === id ? { ...item, visible: false } : item));
    setGraphicsPreview(current => current.map(item => item.id === id ? { ...item, visible: false } : item));
  };
  const stopReplay = () => {
    if (!replayPlayingRef.current) return;
    replayPlayingRef.current = false;
    replayPlaybackStartRef.current = null;
    replayPlaybackBaseRef.current = null;
    setReplayState('ready');
    const restore = transitionFromSceneRef.current;
    programSceneRef.current = restore;
    setProgramScene(restore);
    toast.info('Replay stopped; previous Program scene restored.');
  };

  const loadLocalAudio = (kind: 'music' | 'sfx', file?: File) => {
    if (!file || !file.type.startsWith('audio/')) { toast.error('Choose an audio file.'); return; }
    const url = URL.createObjectURL(file);
    if (kind === 'music') {
      if (musicUrlRef.current) URL.revokeObjectURL(musicUrlRef.current);
      musicUrlRef.current = url; setMusicName(file.name);
      const el = musicAudioRef.current ?? new Audio();
      el.loop = true; el.preload = 'auto'; el.src = url; el.volume = 1; musicAudioRef.current = el;
      el.onplay = () => setMusicState('playing');
      el.onpause = () => setMusicState('paused');
      el.onended = () => setMusicState('ready');
      setMusicState('ready');
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
      el.onplay = () => setSfxState('playing');
      el.onended = () => setSfxState('ready');
      setSfxState('ready');
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

  const playMusic = async () => {
    const el = musicAudioRef.current;
    if (!el) { toast.info('Load a music track first.'); return; }
    if (productionAudioContextRef.current?.state === 'suspended') await productionAudioContextRef.current.resume();
    await el.play().catch(() => toast.info('Tap Play again after allowing audio playback.'));
  };
  const pauseMusic = () => { musicAudioRef.current?.pause(); };
  const stopMusic = () => { const el = musicAudioRef.current; if (!el) return; el.pause(); el.currentTime = 0; setMusicState('ready'); };
  const triggerSfx = async () => {
    const el = sfxAudioRef.current;
    if (!el) { toast.info('Load an SFX file first.'); return; }
    if (productionAudioContextRef.current?.state === 'suspended') await productionAudioContextRef.current.resume();
    el.currentTime = 0;
    await el.play().catch(() => toast.info('Tap Trigger SFX again after allowing audio playback.'));
  };
  const stopSfx = () => { const el = sfxAudioRef.current; if (!el) return; el.pause(); el.currentTime = 0; setSfxState('ready'); };

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

  const toggleSourceVideoAudio = () => {
    if (!sourceVideoRef.current) {
      toast.info('Load a video into Preview first.');
      return;
    }
    const nextMuted = !sourceVideoMuted;
    setSourceVideoMuted(nextMuted);
    sourceVideoRef.current.muted = nextMuted;
    const gain = productionSourceGainRef.current;
    if (gain) {
      const context = productionAudioContextRef.current;
      const target = programSceneRef.current === 'video' && !programMuted && !nextMuted ? programLevel : 0;
      if (context) gain.gain.setTargetAtTime(target, context.currentTime, 0.02);
      else gain.gain.value = target;
    }
    toast.success(nextMuted ? 'Uploaded video audio muted' : 'Uploaded video audio unmuted');
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

  const publishTvPoll = async () => {
    const id = activeStreamId;
    const question = pollQuestion.trim();
    const options = pollOptions.map(x => x.trim()).filter(Boolean).slice(0, 4);
    if (!id || !user || !live || question.length < 1 || options.length < 2) {
      toast.error('Start the live broadcast and provide a question plus at least two choices.');
      return;
    }
    try {
      await supabase.from('tv_live_polls').update({ status: 'closed', closed_at: new Date().toISOString() }).eq('stream_id', id).eq('status', 'open').eq('host_user_id', user.id);
      const payload = options.map((text, index) => ({ id: String.fromCharCode(97 + index), text }));
      const { data, error } = await supabase.from('tv_live_polls').insert({
        stream_id: id, host_user_id: user.id, question, options: payload, status: 'open',
      }).select('id').single();
      if (error) throw error;
      const channel = supabase.channel('tv-meetup-' + id);
      await new Promise<void>((resolve) => channel.subscribe(status => { if (status === 'SUBSCRIBED' || status === 'CHANNEL_ERROR') resolve(); }));
      await channel.send({ type: 'broadcast', event: 'poll_changed', payload: { poll_id: data.id } });
      void supabase.removeChannel(channel);
      toast.success('Live vote published');
      setPollQuestion('');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not publish live vote');
    }
  };

  const startLive = async () => {
    if (live || roomRef.current || broadcastStage !== 'idle') return;
    setBroadcastError(null);
    setBroadcastDiagnostics(null);
    setBroadcastStage('preparing');
    let session: TestagramTvYouTubeSession | TestagramTvMediaSession | null = null;
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
        if (verifyResponse.ok && verifyPayload?.data?.on_air) {
          throw new Error(
            'A Testagram TV broadcast is already ON AIR in another studio session. End that broadcast before starting a new one.',
          );
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
        body: JSON.stringify({ action: 'start', provider: 'youtube', stream_id: id }),
      });
      const startPayload = await startResponse.json().catch(() => null);
      const provider = 'youtube' as const;
      const youtubeStart = startPayload?.data?.youtube;
      const youtubeToken = typeof youtubeStart?.encoder_token === 'string' ? youtubeStart.encoder_token : '';
      if (!startResponse.ok || !youtubeToken) {
        throw new Error(String(startPayload?.error?.message || 'YouTube live delivery could not be started.'));
      }

      session = await TestagramTvYouTubeSession.connect({
        streamId: id,
        encoderToken: youtubeToken,
        program,
        quality,

        videoBitsPerSecond: VIDEO_PRESETS[quality].bitrate,
        onStatus: (next, detail) => {
          setBroadcastDiagnostics(prev => ({
            ...(prev || {}),
            provider: 'youtube',
            encoder_status: next,
            youtube_status: next,
            detail: detail || null,
          }));
          if (next === 'reconnecting') setBroadcastStage('connecting');
        },
      });

      roomRef.current = session;

      // Guest WebRTC is an optional interactive feature. It must never block
      // the primary YouTube ON AIR path. Start it in the background after the
      // public delivery transport is connected.
      if (!guestRoomRef.current) {
      setGuestLifecycle('connecting');
      void TestagramTvMediaSession.connectHostGuestBridge(id, program).then(nextGuestSession => {
        if (!liveRef.current && !roomRef.current) {
          void nextGuestSession.close().catch(() => undefined);
          return;
        }
        guestSession = nextGuestSession;
        nextGuestSession.setGuestSignalHandler((signal, slot) => {
          setGuestSignalRequests(prev => ({ ...prev, [slot]: { kind: signal, at: Date.now() } }));
          const label = signal === 'raise-hand' ? 'raised a hand' : signal === 'add-to-point' ? 'wants to add to the point' : 'seconds the point and wants to add';
          toast.info('Guest ' + slot + ' ' + label + '.');
        });
        nextGuestSession.setRemoteTrackHandler(track => {
          track.onended = () => {
            productionGuestSourceRef.current?.disconnect();
            productionGuestSourceRef.current = null;
            productionGuestGainRef.current?.disconnect();
            productionGuestGainRef.current = null;
            if (remoteGuestVideoRef.current) remoteGuestVideoRef.current.srcObject = null;
            if (remoteGuestAudioRef.current) remoteGuestAudioRef.current.srcObject = null;
            setGuestConnected(false);
            setGuestVideoReady(false);
            setGuestAudioReady(false);
            setGuestLifecycle('lost');
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
            setGuestVideoReady(true);
            setGuestConnected(true);
            setGuestLifecycle(guestAudioReady ? 'connected' : 'partial');
            setSourceHealth(prev => ({ ...prev, guest: 'ready' }));
          } else if (track.kind === 'audio') {
            const stream = new MediaStream([track]);
            if (remoteGuestAudioRef.current) {
              remoteGuestAudioRef.current.srcObject = stream;
              remoteGuestAudioRef.current.muted = true;
              remoteGuestAudioRef.current.autoplay = true;
              void remoteGuestAudioRef.current.play().catch(() => undefined);
            }
            const audioContext = productionAudioContextRef.current;
            const masterGain = productionMasterGainRef.current;
            setGuestAudioReady(true);
            setGuestConnected(true);
            setGuestLifecycle(guestVideoReady ? 'connected' : 'partial');
            if (audioContext && masterGain) {
              try {
                productionGuestSourceRef.current?.disconnect();
                productionGuestSourceRef.current = audioContext.createMediaStreamSource(stream);
                if (!productionGuestGainRef.current) productionGuestGainRef.current = audioContext.createGain();
                if (!productionGuestMeterRef.current) { productionGuestMeterRef.current = audioContext.createAnalyser(); productionGuestMeterRef.current.fftSize = 256; }
                productionGuestGainRef.current.gain.value = guestMuted ? 0 : guestLevel;
                productionGuestSourceRef.current.connect(productionGuestGainRef.current).connect(productionGuestMeterRef.current).connect(masterGain);
              } catch (error) {
                setBroadcastDiagnostics(prev => ({ ...(prev || {}), guest_audio_error: error instanceof Error ? error.message : String(error) }));
              }
            }
          }
        });
        guestRoomRef.current = nextGuestSession;
      }).catch(error => {
        setGuestConnected(false);
        setGuestVideoReady(false);
        setGuestAudioReady(false);
        setGuestLifecycle('offline');
        setSourceHealth(prev => ({ ...prev, guest: 'idle' }));
        setBroadcastDiagnostics(prev => ({ ...(prev || {}), guest_bridge: 'offline', guest_bridge_error: error instanceof Error ? error.message : String(error) }));
      });
      } else {
        guestSession = guestRoomRef.current;
        setGuestLifecycle(guestConnected ? (guestVideoReady && guestAudioReady ? 'connected' : 'partial') : 'connecting');
      }

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
          const youtube = verifyPayload.data.health?.youtube || verifyPayload.data.youtube || {};
          setYoutubeStatus(String(youtube.status || 'disabled'));
          setBroadcastDiagnostics(prev => ({
            ...(prev || {}),
            provider: 'youtube',
            encoder_status: roomRef.current?.getStatus?.() || 'encoding',
            youtube_status: youtube.status || 'disabled',
            youtube_stream_status: verifyPayload.data.youtube_stream_status || youtube.stream_status || null,
            youtube_broadcast_status: verifyPayload.data.youtube_broadcast_status || youtube.broadcast_status || null,
            youtube_error: youtube.error || null,
            on_air: Boolean(verifyPayload.data.on_air),
          }));
          if (verifyPayload.data.on_air) {
            onAir = true;
            break;
          }
        }
        await new Promise(resolve => window.setTimeout(resolve, 2000));
      }
      if (!onAir) {
        throw new Error(
          `YouTube Live has not reached ON AIR within 60s. ${lastHealth ? JSON.stringify(lastHealth) : 'No YouTube health response.'}`,
        );
      }

      setBroadcastStage('on-air');
      setViewerCount(0);
      liveRef.current = true;
      setLive(true);
      setMode('live');
      setStatus('live');
      setElapsed(0);
      setBroadcastError(null);
      toast.success(`Testagram TV is ON AIR · YouTube: ${youtubeStatus}`);
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
      setGuestVideoReady(false);
      setGuestAudioReady(false);
      setGuestLifecycle('offline');
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

  const attachGuestPreviewSession = (nextGuestSession: TestagramTvMediaSession) => {
    nextGuestSession.setGuestSignalHandler((signal, slot) => {
      setGuestSignalRequests(prev => ({ ...prev, [slot]: { kind: signal, at: Date.now() } }));
      const label = signal === 'raise-hand' ? 'raised a hand' : signal === 'add-to-point' ? 'wants to add to the point' : 'seconds the point and wants to add';
      toast.info('Guest ' + slot + ' ' + label + '.', { duration: 5000 });
    });
    nextGuestSession.setRemotePeerLeaveHandler((_peerId, _role, guestSlot) => {
      if (!guestSlot) return;
      const video = guestVideoElementsRef.current.get(guestSlot);
      if (video) { video.pause(); video.srcObject = null; }
      const audio = guestAudioElementsRef.current.get(guestSlot);
      if (audio) { audio.pause(); audio.srcObject = null; }
      guestPeerSlotsRef.current.forEach((slot, peerId) => { if (slot === guestSlot) guestPeerSlotsRef.current.delete(peerId); });
      setGuestSlots(current => current.filter(g => g.slot !== guestSlot));
      if (activeGuestSlotRef.current === guestSlot) setActiveGuestSlot(null);
    });
    nextGuestSession.setRemoteTrackHandler((track, peerId, guestSlot) => {
      if (!guestSlot || guestSlot > TV_GUEST_CAPACITY) return;
      guestPeerSlotsRef.current.set(peerId, guestSlot);
      const current = guestSlotsRef.current.find(g => g.slot === guestSlot);
      const label = current?.label || 'Guest ' + guestSlot;
      if (track.kind === 'video') {
        let video = guestVideoElementsRef.current.get(guestSlot);
        if (!video) {
          video = document.createElement('video');
          video.autoplay = true; video.playsInline = true; video.muted = true; video.style.display = 'none';
          document.body.appendChild(video); guestVideoElementsRef.current.set(guestSlot, video);
        }
        video.srcObject = new MediaStream([track]); void video.play().catch(() => undefined);
        setGuestSlots(prev => {
          const prior = prev.find(g => g.slot === guestSlot);
          const next = prior || { slot: guestSlot, label, inviteUrl: '', lifecycle: 'partial' as const, videoReady: false, audioReady: false };
          return prev.filter(g => g.slot !== guestSlot).concat({ ...next, peerId, videoReady: true, lifecycle: next.audioReady ? 'connected' : 'partial' }).sort((a,b) => a.slot-b.slot);
        });
        setActiveGuestSlot(slot => slot || guestSlot); setGuestConnected(true); setGuestVideoReady(true); setGuestLifecycle('partial');
        setSourceHealth(prev => ({ ...prev, guest: 'ready' }));
      } else if (track.kind === 'audio') {
        let audio = guestAudioElementsRef.current.get(guestSlot);
        if (!audio) {
          audio = document.createElement('audio');
          audio.autoplay = true; audio.style.display = 'none';
          document.body.appendChild(audio); guestAudioElementsRef.current.set(guestSlot, audio);
        }
        const media = new MediaStream([track]); audio.srcObject = media; void audio.play().catch(() => undefined);
        const audioContext = productionAudioContextRef.current, masterGain = productionMasterGainRef.current;
        if (audioContext && masterGain) {
          try {
            productionGuestSourceRef.current?.disconnect();
            productionGuestSourceRef.current = audioContext.createMediaStreamSource(media);
            if (!productionGuestGainRef.current) productionGuestGainRef.current = audioContext.createGain();
            productionGuestGainRef.current.gain.value = guestMuted ? 0 : guestLevel;
            productionGuestSourceRef.current.connect(productionGuestGainRef.current).connect(masterGain);
          } catch (error) {
            setBroadcastDiagnostics(prev => ({ ...(prev || {}), guest_audio_error: error instanceof Error ? error.message : String(error) }));
          }
        }
        setGuestSlots(prev => {
          const prior = prev.find(g => g.slot === guestSlot);
          const next = prior || { slot: guestSlot, label, inviteUrl: '', lifecycle: 'partial' as const, videoReady: false, audioReady: false };
          return prev.filter(g => g.slot !== guestSlot).concat({ ...next, peerId, audioReady: true, lifecycle: next.videoReady ? 'connected' : 'partial' }).sort((a,b) => a.slot-b.slot);
        });
        setActiveGuestSlot(slot => slot || guestSlot); setGuestConnected(true); setGuestAudioReady(true); setGuestLifecycle('connected');
      }
    });
    guestRoomRef.current = nextGuestSession;
  };

  const createGuestInvite = async () => {
    if (guestSlotsRef.current.length >= TV_GUEST_CAPACITY) { toast.error('All six multiview guest slots are occupied.'); return; }
    try {
      let streamId = activeStreamId || stream?.id || null;
      if (!streamId) {
        if (!user) { toast.info('Sign in to invite a guest.'); return; }
        const { data, error } = await supabase.from('live_streams').insert({ user_id: user.id, title: broadcastTitle, description: broadcastDescription, category: broadcastCategory, is_live: false, tv_provider: 'youtube' }).select('id,title,description,category,is_live,tv_provider').single();
        if (error || !data) throw new Error(error?.message || 'Could not prepare a TV preview session.');
        streamId = data.id; setActiveStreamId(streamId); setStream(data);
      }
      const { data: auth } = await supabase.auth.getSession();
      const response = await fetch('/api/live', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(auth.session?.access_token ? { Authorization: 'Bearer ' + auth.session.access_token } : {}) }, body: JSON.stringify({ action: 'create-guest', stream_id: streamId }) });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.data?.invite_token) throw new Error(String(payload?.error?.message || 'Could not create guest invitation.'));
      const slot = Number(payload.data.guest_slot || 0); if (!slot) throw new Error('No guest slot was allocated.');
      if (!guestRoomRef.current) {
        await ensureStudio(); const program = await createProductionProgram(); setGuestLifecycle('connecting');
        const session = await TestagramTvMediaSession.connectHostGuestBridge(streamId, program); attachGuestPreviewSession(session);
      }
      const url = window.location.origin + '/tv/live/' + streamId + '?guest=' + encodeURIComponent(payload.data.invite_token);
      const label = String(payload.data.guest_label || 'Guest ' + slot);
      setGuestSlots(prev => prev.concat({ slot, label, inviteUrl: url, lifecycle: 'invited', videoReady: false, audioReady: false }).sort((a,b) => a.slot-b.slot));
      setActiveGuestSlot(slot); setGuestInviteUrl(url); setGuestConnected(false); setGuestVideoReady(false); setGuestAudioReady(false); setGuestLifecycle('invited');
      setSourceHealth(prev => ({ ...prev, guest: 'idle' }));
      try { await navigator.clipboard.writeText(url); toast.success(label + ' link copied'); } catch { toast.success(label + ' link ready'); }
    } catch (e: any) { setGuestLifecycle('offline'); toast.error(e?.message || 'Could not create guest invitation'); }
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
    setGuestVideoReady(false);
    setGuestAudioReady(false);
    setGuestLifecycle('offline');
    setBroadcastStage('idle');
    setBroadcastDiagnostics(null);
    setGuestInviteUrl(null);
    remoteGuestVideoRef.current?.pause();
    remoteGuestVideoRef.current = null;
    remoteGuestAudioRef.current?.pause();
    remoteGuestAudioRef.current.srcObject = null;
    productionGuestSourceRef.current?.disconnect();
    productionGuestSourceRef.current = null;
    productionGuestGainRef.current?.disconnect();
    productionGuestGainRef.current = null;
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

  const toggleMic = async () => {
    try {
      if (!cameraStreamRef.current) await activateScene('camera');
      const t = cameraStreamRef.current?.getAudioTracks()[0];
      if (!t) { toast.info('Microphone is not available. Tap Preview first and allow microphone access.'); return; }
      t.enabled = !t.enabled;
      setMuted(!t.enabled);
      if (productionCommentaryGainRef.current) productionCommentaryGainRef.current.gain.value = t.enabled ? commentaryLevel : 0;
    } catch (e: any) {
      toast.error(e?.message || 'Could not access the microphone');
    }
  };

  const toggleCamera = async () => {
    try {
      if (!cameraStreamRef.current) await activateScene('camera');
      const t = cameraStreamRef.current?.getVideoTracks()[0];
      if (!t) { toast.info('Camera is not available. Tap Preview first and allow camera access.'); return; }
      if (liveRef.current && programSceneRef.current === 'camera' && t.enabled) {
        await takeScene('black');
      }
      t.enabled = !t.enabled;
      setCamera(t.enabled);
      if (t.enabled && programSceneRef.current === 'black' && !liveRef.current) {
        setPreviewScene('camera');
        previewSceneRef.current = 'camera';
      }
    } catch (e: any) {
      toast.error(e?.message || 'Could not access the camera');
    }
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
      const requestDisplayMedia = getDisplayMedia();
      if (!requestDisplayMedia) {
        toast.info('Screen sharing is unavailable in this browser. Camera, Video, Guest and Replay scenes are still available.');
        return;
      }
      const preset = VIDEO_PRESETS[quality];
      const s = await requestDisplayMedia({
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
        const youtube = health.youtube || payload.data.youtube || {};
        setBroadcastDiagnostics({
          provider: 'dual',
          encoder_status: encoder,
          cloudflare_status: health.cloudflare_input_status || payload.data.cloudflare_input_status || 'unknown',
          youtube_status: youtube.status || 'disabled',
          youtube_stream_status: payload.data.youtube_stream_status || youtube.stream_status || 'unknown',
          youtube_broadcast_status: payload.data.youtube_broadcast_status || youtube.broadcast_status || 'unknown',
          youtube_error: youtube.error || null,
          on_air: Boolean(payload.data.on_air),
        });
        setYoutubeStatus(String(youtube.status || 'disabled'));
        if (!payload.data.on_air) {
          setStudioHealth('degraded');
          toast.error('YouTube Live delivery is not currently ON AIR.');
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
        await fetch('/api/live', { method: 'POST', headers, body: JSON.stringify({ action: 'heartbeat', stream_id: activeStreamId, connection_state: roomRef.current?.getStatus() === 'encoding' ? 'connected' : 'degraded', peer_id: 'youtube-browser-encoder' }) });
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
    if (productionMusicGainRef.current) productionMusicGainRef.current.gain.value = musicMuted ? 0 : musicLevel;
    if (productionSfxGainRef.current) productionSfxGainRef.current.gain.value = sfxMuted ? 0 : sfxLevel;
    if (productionGuestGainRef.current) productionGuestGainRef.current.gain.value = guestMuted ? 0 : guestLevel;
    if (productionMasterGainRef.current) productionMasterGainRef.current.gain.value = masterMuted ? 0 : masterLevel;
  }, [musicLevel, sfxLevel, guestLevel, masterLevel, musicMuted, sfxMuted, guestMuted, masterMuted]);

  useEffect(() => {
    const readMeter = (analyser: AnalyserNode | null) => {
      if (!analyser) return 0;
      const data = new Uint8Array(analyser.fftSize);
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (const value of data) { const n = (value - 128) / 128; sum += n * n; }
      const rms = Math.sqrt(sum / data.length);
      if (!Number.isFinite(rms) || rms <= 0.00001) return 0;
      return Math.max(0, Math.min(100, Math.round(((20 * Math.log10(rms) + 60) / 60) * 100)));
    };
    const id = window.setInterval(() => setAudioBusMeters({
      mic: readMeter(productionCommentaryMeterRef.current),
      program: readMeter(productionSourceMeterRef.current),
      guest: readMeter(productionGuestMeterRef.current),
      music: readMeter(productionMusicMeterRef.current),
      sfx: readMeter(productionSfxMeterRef.current),
      master: readMeter(productionMasterMeterRef.current),
    }), 120);
    return () => window.clearInterval(id);
  }, []);

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
        void (roomRef.current && 'recover' in roomRef.current ? roomRef.current.recover() : Promise.resolve()).catch(() => setStudioHealth('degraded'));
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  const fmt = (n: number) => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
  const guestLabel = guestLifecycle === 'connected' ? 'CONNECTED' : guestLifecycle === 'partial' ? 'PARTIAL · WAITING FOR MEDIA' : guestLifecycle === 'connecting' ? 'CONNECTING' : guestLifecycle === 'invited' ? 'INVITE ACTIVE' : guestLifecycle === 'lost' ? 'SIGNAL LOST' : 'OFFLINE';

  const activeGuestVideoSlots = guestSlots
    .filter(g => (g.lifecycle === 'connected' || g.lifecycle === 'partial') && g.videoReady)
    .sort((a, b) => a.slot - b.slot);

  const previewSceneSlots: Array<{ scene: TvSceneId; guestSlot?: number; label: string; detail: string; ready: boolean; active: boolean }> = [
    { scene: 'camera', label: 'CAMERA', detail: sourceHealth.camera === 'ready' ? 'Live camera' : 'Start camera', ready: sourceHealth.camera === 'ready', active: previewScene === 'camera' },
    { scene: 'video', label: 'VIDEO', detail: uploadedVideoName || 'Load media', ready: sourceHealth.video === 'ready', active: previewScene === 'video' },
    { scene: 'screen', label: 'SCREEN', detail: sharing ? 'Screen ready' : 'Share screen', ready: sourceHealth.screen === 'ready', active: previewScene === 'screen' },
    ...activeGuestVideoSlots.map(g => ({
      scene: 'guest' as TvSceneId,
      guestSlot: g.slot,
      label: g.label.toUpperCase(),
      detail: 'Guest camera ready',
      ready: true,
      active: previewScene === 'guest' && activeGuestSlot === g.slot,
    })),
    { scene: 'replay', label: 'REPLAY', detail: replayBufferRef.current.frameCount ? Math.round(replayBufferRef.current.durationMs / 1000) + 's buffered' : 'Buffer empty', ready: replayBufferRef.current.frameCount > 0, active: previewScene === 'replay' },
    { scene: 'black', label: 'BLACK', detail: 'Clear programme', ready: true, active: previewScene === 'black' },
  ];

  const playPreviewSlot = async (scene: TvSceneId, guestSlot?: number) => {
    if (scene === 'guest' && guestSlot != null) {
      setActiveGuestSlot(guestSlot);
      activeGuestSlotRef.current = guestSlot;
    }
    previewSceneRef.current = scene;
    setPreviewScene(scene);
    await takeScene(scene);
  };

  if (persistentDock) {
    return (
      <div className="fixed inset-x-0 top-0 z-[160] border-b border-white/10 bg-zinc-950/95 shadow-2xl backdrop-blur-xl">
        <div className="mx-auto w-full max-w-5xl px-2 py-2 sm:px-3">
          <div className="flex items-center justify-between gap-2 mb-2">
            <div className="flex min-w-0 items-center gap-2">
              <span className="text-[10px] font-black tracking-[0.18em] text-zinc-300">TESTAGRAM TV</span>
              <span className={live ? "rounded-full bg-red-600 px-2 py-0.5 text-[9px] font-bold text-white" : "rounded-full bg-zinc-800 px-2 py-0.5 text-[9px] font-bold text-zinc-300"}>{live ? "● ON AIR" : "● PREVIEW"}</span>
              <span className="hidden sm:inline text-[9px] text-zinc-500">{studioHealth === 'ready' ? 'SIGNAL READY' : studioHealth === 'degraded' ? 'SIGNAL DEGRADED' : 'SIGNAL OFFLINE'}</span>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Button size="sm" variant={recording ? 'destructive' : 'outline'} onClick={() => recording ? stopRecording() : void startRecording()} disabled={saving || (!deviceReady && !recording)}>{recording ? 'STOP REC' : 'REC'}</Button>
              <Button size="sm" variant={live ? 'destructive' : 'default'} onClick={() => live ? void stopLive() : void startLive()} disabled={saving}>{live ? 'STOP LIVE' : 'GO LIVE'}</Button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="relative aspect-video overflow-hidden rounded-lg border border-blue-500/30 bg-black">
              <canvas ref={previewCanvasRef} className="h-full w-full object-contain" />
              <span className="absolute left-1.5 top-1.5 rounded bg-zinc-950/90 px-1.5 py-0.5 text-[8px] font-bold tracking-wider">PREVIEW · {previewScene.toUpperCase()}</span>
            </div>
            <div className="relative aspect-video overflow-hidden rounded-lg border border-red-500/30 bg-black">
              {status === 'idle' && <div className="absolute inset-0 z-10 flex flex-col items-center justify-center text-zinc-500"><Radio className="mb-1 h-5 w-5" /><span className="text-[9px]">Tap Preview to start camera + mic</span></div>}
              <video ref={videoRef} autoPlay muted playsInline className="h-full w-full object-contain" />
              {multiview && <canvas ref={multiviewCanvasRef} width={640} height={360} className="absolute inset-0 h-full w-full object-contain pointer-events-none" />}
              <div className="absolute left-1.5 top-1.5 flex gap-1"><span className="rounded bg-red-600/90 px-1.5 py-0.5 text-[8px] font-bold">{live ? '● LIVE · PROGRAM' : 'PROGRAM'}</span><span className={studioHealth === 'ready' ? 'rounded bg-emerald-600/90 px-1.5 py-0.5 text-[8px] font-bold' : 'rounded bg-zinc-700/90 px-1.5 py-0.5 text-[8px] font-bold'}>{studioHealth.toUpperCase()}</span></div>
            </div>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <Button size="sm" onClick={() => void activateScene('camera')} disabled={saving}><Camera className="mr-1 h-3.5 w-3.5" />Preview</Button>
            <Button size="sm" variant="outline" onClick={() => void toggleMic()} disabled={!deviceReady}>{muted ? 'Unmute mic' : 'Mute mic'}</Button>
            <Button size="sm" variant="outline" onClick={() => void toggleCamera()} disabled={!deviceReady}>{camera ? 'Camera on' : 'Camera off'}</Button>
            <Button size="sm" variant="outline" onClick={() => void takeScene('camera')} disabled={previewScene !== 'camera' || sourceHealth.camera !== 'ready'}>TAKE CAMERA</Button>
            <Button size="sm" variant="outline" onClick={() => nav(activeStreamId ? '/tv-studio/'+activeStreamId+'/guests' : '/tv-studio')}>Guest Control</Button>
            <span className="ml-auto text-[9px] text-zinc-500">Mic {Math.round(audioBusMeters.mic)}% · Master {Math.round(audioBusMeters.master)}% · {viewerCount} viewers</span>
          </div>
        </div>
      </div>
    );  }

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
                {broadcastStage === 'connecting' && 'Connecting Testagram live encoder…'}
                {broadcastStage === 'verifying' && 'Verifying Testagram live media; YouTube is checked independently…'}
                {broadcastStage === 'on-air' && 'ON AIR'}
              </div>
              {broadcastStage === 'on-air' && (
                <p className="mt-2 text-xs text-zinc-300">
                  <span className="font-semibold text-emerald-300">Testagram: ON AIR</span>
                  <span className="mx-1">·</span>
                  <span className={youtubeStatus === 'broadcasting' ? 'font-semibold text-emerald-300' : 'font-semibold text-amber-300'}>YouTube: {youtubeStatus}</span>
                </p>
              )}
              <p className="mt-1 text-xs text-blue-200/80">
                {broadcastStage === 'preparing' && 'Checking camera, microphone and production A/V tracks.'}
                {broadcastStage === 'authorizing' && 'Creating the private broadcast session and requesting media authorization.'}
                {broadcastStage === 'connecting' && 'Waiting for the Testagram encoder transport to become ready.'}
                {broadcastStage === 'verifying' && 'Validating Testagram live media. YouTube remains an independent output and may be starting or reconnecting.'}
                {broadcastStage === 'on-air' && 'Producer is transmitting one program bus. Testagram TV and YouTube use the YouTube Live delivery path.'}
              </p>
              {broadcastDiagnostics?.provider === 'youtube' ? (
                <p className="mt-2 text-[10px] text-zinc-300">YouTube encoder: {String(broadcastDiagnostics.encoder_status || 'starting')} · video: {String(broadcastDiagnostics.youtube_video_id || 'preparing')}</p>
              ) : broadcastDiagnostics ? (
                <p className="mt-2 text-[10px] text-zinc-300">{broadcastDiagnostics.mediaReachedViewer ? `Viewer media: confirmed · video packets: ${String(broadcastDiagnostics.viewerVideoPackets ?? broadcastDiagnostics.videoPackets ?? 0)} · audio packets: ${String(broadcastDiagnostics.viewerAudioPackets ?? broadcastDiagnostics.audioPackets ?? 0)} · ${String(broadcastDiagnostics.viewerWidth ?? broadcastDiagnostics.width ?? 0)}×${String(broadcastDiagnostics.viewerHeight ?? broadcastDiagnostics.height ?? 0)}` : `Producer tracks: ${broadcastDiagnostics.mediaReady ? 'live' : 'checking'} · Viewer media: awaiting first inbound RTP`}</p>
              ) : null}
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
                <span className="absolute top-2 right-2 rounded bg-blue-600/90 px-2 py-1 text-[9px] font-black tracking-wider">CLICK A SLOT → PROGRAM</span>
              </div>
              <div className="aspect-video relative rounded-lg overflow-hidden border border-red-500/30 bg-black">
                {status === 'idle' && <div className="absolute inset-0 z-10 flex flex-col items-center justify-center text-zinc-500"><Radio className="w-10 h-10 mb-2" /><span>Program monitor</span><span className="text-xs mt-1">Tap Preview to start the camera and microphone</span></div>}
                <div className="absolute bottom-2 left-2 flex gap-1 pointer-events-none">
                  <span className={`rounded px-2 py-1 text-[9px] font-bold ${studioHealth === 'ready' ? 'bg-emerald-500/90' : studioHealth === 'degraded' ? 'bg-amber-500/90' : 'bg-zinc-700/90'}`}>SIGNAL {studioHealth.toUpperCase()}</span>
                  {live && <span className="rounded bg-zinc-950/90 border border-zinc-700 px-2 py-1 text-[9px] font-bold">ENC {String(broadcastDiagnostics?.encoder_status || 'starting').toUpperCase()}</span>}
                </div>
                <video ref={videoRef} autoPlay muted playsInline className="w-full h-full object-contain" />
                <video ref={remoteGuestVideoRef} autoPlay muted playsInline className="hidden" aria-hidden="true" />
                <audio ref={remoteGuestAudioRef} autoPlay muted className="hidden" aria-hidden="true" />
                {multiview && <canvas ref={multiviewCanvasRef} width={640} height={360} className="absolute inset-0 w-full h-full object-contain pointer-events-none" />}
                <div className="absolute top-2 left-2 flex gap-2 pointer-events-none">
                  <span className="rounded bg-red-600/90 px-2 py-1 text-[10px] font-bold tracking-wider">{live ? '● LIVE · TESTAGRAM TV' : 'TESTAGRAM TV · PROGRAM'}</span>
                  {sharing && <span className="rounded bg-blue-600/90 px-2 py-1 text-[10px] font-bold">SCREEN</span>}
                </div>
              </div>
            </div>
            <div className="border-t border-zinc-800/80 bg-zinc-950/90 p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div>
                  <div className="text-[10px] font-black tracking-[0.18em] text-zinc-300">PREVIEW SCENE BANK</div>
                  <div className="text-[10px] text-zinc-500">Every slot is a ready-to-feed source. Tap once to take it to Program.</div>
                </div>
                <span className="rounded-full border border-blue-500/30 bg-blue-500/10 px-2 py-1 text-[9px] font-bold text-blue-300">{previewSceneSlots.length} SLOTS</span>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
                {previewSceneSlots.map(slot => (
                  <button
                    key={slot.scene}
                    type="button"
                    onClick={() => void playPreviewSlot(slot.scene, slot.guestSlot)}
                    disabled={saving || !slot.ready}
                    className={`group min-w-0 rounded-xl border p-2 text-left transition-all ${slot.active ? 'border-blue-400 bg-blue-500/15 ring-1 ring-blue-400/40' : 'border-white/10 bg-black/30 hover:border-white/25 hover:bg-white/5'} disabled:cursor-not-allowed disabled:opacity-50`}
                    aria-label={`Take ${slot.label} to Program`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] font-black tracking-wider">{slot.label}</span>
                      <span className={`h-2 w-2 rounded-full ${slot.ready ? 'bg-emerald-400' : 'bg-zinc-600'}`} />
                    </div>
                    <div className="mt-1 truncate text-[9px] text-zinc-500">{slot.detail}</div>
                    <div className={`mt-2 text-[9px] font-black ${slot.active ? 'text-blue-300' : 'text-zinc-400'}`}>{slot.active ? 'PROGRAM READY' : 'TAKE →'}</div>
                  </button>
                ))}
              </div>
            </div>
            <div className="p-3 border-t border-zinc-800/80 flex flex-wrap gap-2">
              <Button size="sm" disabled={saving} onClick={() => void activateScene('camera')}><Camera className="w-4 h-4 mr-1" />{deviceReady ? 'Preview' : 'Start preview'}</Button>
              <Button size="sm" variant="outline" onClick={() => setShortcutHint(v => !v)}>Shortcuts</Button>
              <Button size="sm" variant={camera ? 'default' : 'destructive'} onClick={() => void toggleCamera()}><Camera className="w-4 h-4 mr-1" />{camera ? 'Camera' : 'Camera off'}</Button>
              <div className="mt-3 rounded-lg border border-white/10 bg-black/30 p-2.5">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div><div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">Camera</div><div className="text-[10px] text-zinc-500">Choose the physical camera used by the production bus.</div></div>
                  <span className="text-[10px] font-semibold uppercase text-emerald-300">{cameraFacing}</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Button size="sm" variant={cameraFacing === 'front' ? 'default' : 'outline'} disabled={!deviceReady || saving} onClick={() => void switchCameraFacing('front')}><Camera className="mr-1 h-4 w-4" />Front camera</Button>
                  <Button size="sm" variant={cameraFacing === 'back' ? 'default' : 'outline'} disabled={!deviceReady || saving} onClick={() => void switchCameraFacing('back')}><Camera className="mr-1 h-4 w-4" />Back camera</Button>
                </div>
              </div>
              <Button size="sm" variant={!muted ? 'default' : 'destructive'} onClick={() => void toggleMic()}><Mic className="w-4 h-4 mr-1" />{muted ? 'Mic off' : 'Mic'}</Button>
              <Button size="sm" variant={sharing ? 'secondary' : 'outline'} onClick={() => void shareScreen()}><MonitorUp className="w-4 h-4 mr-1" />{sharing ? 'Stop screen' : 'Screen'}</Button>
              {!recording ? <Button size="sm" disabled={saving} onClick={() => void startRecording()}><Circle className="w-4 h-4 mr-1" />Record locally</Button> : <Button size="sm" variant="destructive" onClick={stopRecording}><Square className="w-4 h-4 mr-1" />Stop & save</Button>}
              {!live ? <Button size="sm" disabled={broadcastStage !== 'idle'} className="bg-red-600 hover:bg-red-700" onClick={() => void startLive()}><Radio className="w-4 h-4 mr-1" />{broadcastStage === 'idle' ? 'Go live' : broadcastStage === 'on-air' ? 'ON AIR' : 'Connecting…'}</Button> : <><Button size="sm" variant="outline" onClick={() => void shareLiveLink()}><Radio className="w-4 h-4 mr-1" />Share TV</Button><Button size="sm" variant="destructive" onClick={() => void stopLive()}>End live</Button></>}
            </div>
          </section>

          <aside className="space-y-3">
            <section className="rounded-2xl border border-white/10 bg-black/35 p-3 sm:p-4 space-y-4 shadow-2xl">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 font-semibold"><Layers3 className="w-4 h-4 text-red-400" />Program / scenes</div>
                  <p className="mt-1 text-[11px] text-zinc-500">Build the preview, then TAKE it to Program. Only Program reaches the broadcast bus.</p>
                </div>
                <div className="shrink-0 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-emerald-300">
                  {live ? 'ON AIR' : 'PROGRAM'} · {programScene}
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                {([
                  ['camera','Camera',Camera,sourceHealth.camera === 'ready'],
                  ['video','Video',Upload,Boolean(sourceVideoRef.current)],
                  ['screen','Screen',MonitorUp,Boolean(screenStreamRef.current)],
                  ['guest','Guest',Users,guestSlots.some(g=>g.videoReady||g.audioReady)],
                  ['replay','Replay',Clapperboard,replayBufferRef.current.frameCount > 0],
                ] as const).map(([scene,label,Icon,ready]) => {
                  const selected = previewScene === scene;
                  const available = scene === 'camera' || scene === 'video' || scene === 'screen' || scene === 'guest' || scene === 'replay';
                  return (
                    <button key={scene} type="button" aria-label={scene === 'guest' ? 'Generate guest invitation' : label} onPointerDown={() => {
                      if (scene === 'guest') void createGuestInvite();
                    }} onClick={() => {
                      if (scene === 'camera' || scene === 'video') void activateScene(scene);
                      else if (scene === 'guest') { if (guestConnected) { setPreviewScene('guest'); previewSceneRef.current = 'guest'; } }
                      else if (scene === 'screen') void shareScreen();
                      else { setPreviewScene('replay'); previewSceneRef.current = 'replay'; }
                    }} className={`group rounded-xl border p-3 text-left transition ${selected ? 'border-red-500/60 bg-red-500/10 ring-1 ring-red-500/30' : 'border-white/10 bg-zinc-900/70 hover:border-white/20 hover:bg-zinc-900'}`}>
                      <div className="flex items-center justify-between gap-2">
                        <Icon className={`h-4 w-4 ${selected ? 'text-red-400' : 'text-zinc-400'}`} />
                        <span className={`h-2 w-2 rounded-full ${ready ? 'bg-emerald-400' : 'bg-zinc-600'}`} />
                      </div>
                      <div className="mt-2 text-xs font-semibold">{label}</div>
                      <div className="mt-0.5 text-[9px] uppercase tracking-wide text-zinc-500">{scene === 'screen' && !getDisplayMedia() ? 'Tap to check' : scene === 'guest' && !guestConnected ? (guestLifecycle === 'connecting' ? 'Connecting…' : 'Invite guest') : selected ? 'Preview' : ready ? 'Ready' : 'Idle'}</div>
                    </button>
                  );
                })}
              </div>

              <input ref={videoFileInputRef} type="file" accept="video/*" className="hidden" onChange={e => void loadProductionVideo(e.target.files?.[0])} />
              <div className="rounded-xl border border-white/10 bg-zinc-950/50 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">Preview source</div>
                    <div className="mt-1 flex items-center gap-2 text-sm font-medium">
                    <span>{previewScene.toUpperCase()}</span>
                    <span className={`h-2 w-2 rounded-full ${previewScene === 'camera' ? sourceHealth.camera === 'ready' : previewScene === 'video' ? sourceHealth.video === 'ready' : previewScene === 'screen' ? sourceHealth.screen === 'ready' : previewScene === 'guest' ? sourceHealth.guest === 'ready' : replayBufferRef.current.frameCount > 0 ? 'bg-emerald-400' : 'bg-zinc-600'}`} />
                  </div>
                    <div className="mt-0.5 text-[10px] text-zinc-500">
                      {previewScene === 'camera' ? 'Live camera feed' : previewScene === 'video' ? (uploadedVideoName || 'Choose a local video') : previewScene === 'screen' ? (sharing ? 'Screen capture active' : 'Screen capture not started') : previewScene === 'guest' ? (guestConnected ? 'Guest camera connected' : 'Waiting for guest') : 'Replay buffer'}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    {previewScene === 'video' && !sourceVideoRef.current && <Button size="sm" variant="outline" onClick={() => videoFileInputRef.current?.click()}><Upload className="w-4 h-4 mr-1" />Choose video</Button>}
                    {previewScene === 'video' && sourceVideoRef.current && <Button size="sm" variant="outline" onClick={() => void toggleProductionVideo()}>{sourceVideoPlaying ? 'Pause' : 'Play'}</Button>}
                    {previewScene === 'video' && sourceVideoRef.current && <Button size="sm" variant={sourceVideoMuted ? 'destructive' : 'outline'} onClick={toggleSourceVideoAudio} aria-pressed={sourceVideoMuted}>{sourceVideoMuted ? 'Unmute audio' : 'Mute audio'}</Button>}
                    {previewScene === 'video' && sourceVideoRef.current && <Button size="sm" variant="outline" onClick={() => setPipEnabled(v => !v)}><PictureInPicture2 className="w-4 h-4 mr-1" />PiP {pipEnabled ? 'On' : 'Off'}</Button>}
                    {previewScene === 'screen' && <Button size="sm" variant="outline" onClick={() => void shareScreen()}>{sharing ? 'Stop screen' : 'Start screen'}</Button>}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <label className="space-y-1.5"><span className="flex justify-between text-[10px] font-semibold uppercase tracking-wide text-zinc-500"><span>Video audio</span><span>{sourceVideoMuted ? 'MUTED' : Math.round(programLevel * 100) + '%'}</span></span><input aria-label="Video audio level" type="range" min="0" max="1" step="0.05" value={programLevel} onChange={e => {
                  const nextLevel = Number(e.target.value);
                  setProgramLevel(nextLevel);
                  if (productionSourceGainRef.current && !sourceVideoMuted && !programMuted && programSceneRef.current === 'video') {
                    productionSourceGainRef.current.gain.value = nextLevel;
                  }
                }} className="w-full" /><Button type="button" size="sm" variant={sourceVideoMuted ? 'destructive' : 'outline'} onClick={toggleSourceVideoAudio} disabled={!sourceVideoRef.current}>{sourceVideoMuted ? 'UNMUTE VIDEO' : 'MUTE VIDEO'}</Button></label>
                <label className="space-y-1.5"><span className="flex justify-between text-[10px] font-semibold uppercase tracking-wide text-zinc-500"><span>Commentary</span><span>{Math.round(commentaryLevel * 100)}%</span></span><input aria-label="Commentary voice level" type="range" min="0" max="1.5" step="0.05" value={commentaryLevel} onChange={e => setCommentaryLevel(Number(e.target.value))} className="w-full" /></label>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <Button size="sm" className="font-semibold" disabled={previewScene !== 'black' && ((previewScene === 'camera' && sourceHealth.camera !== 'ready') || (previewScene === 'video' && sourceHealth.video !== 'ready') || (previewScene === 'screen' && sourceHealth.screen !== 'ready') || (previewScene === 'guest' && sourceHealth.guest !== 'ready') || (previewScene === 'replay' && replayBufferRef.current.frameCount === 0))} onClick={() => void takeScene(previewScene)}>TAKE {previewScene.toUpperCase()}</Button>
                <Button size="sm" variant="outline" onClick={() => void takeScene('black')}>DIP TO BLACK</Button>
                <label className="flex items-center gap-2 rounded-lg bg-zinc-900 px-2"><span className="text-[9px] uppercase text-zinc-500">Transition</span><select aria-label="Transition type" value={transitionType} onChange={e => setTransitionType(e.target.value as TransitionType)} className="min-w-0 flex-1 bg-transparent p-2 text-xs outline-none"><option value="cut">CUT</option><option value="fade">FADE</option><option value="dip">DIP</option></select></label>
                <label className="flex items-center gap-2 rounded-lg bg-zinc-900 px-2"><span className="text-[9px] uppercase text-zinc-500">Duration</span><select aria-label="Transition duration" value={transitionDuration} onChange={e => setTransitionDuration(Number(e.target.value))} className="min-w-0 flex-1 bg-transparent p-2 text-xs outline-none"><option value="150">150ms</option><option value="300">300ms</option><option value="500">500ms</option><option value="1000">1s</option></select></label>
              </div>

              <div className="rounded-xl border border-white/10 bg-zinc-950/50 p-3 space-y-3">
                <div className="flex items-center justify-between gap-2"><div><div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">Scene presets</div><div className="text-[10px] text-zinc-600">Recall preview + transition + graphics together.</div></div><Button size="sm" variant="outline" onClick={() => saveScenePreset(window.prompt('Preset name') || '')}>Save preset</Button></div>
                <div className="flex flex-wrap gap-2">{Object.keys(scenePresets).map(name => <button key={name} type="button" className="rounded-lg border border-white/10 bg-zinc-900 px-2.5 py-1.5 text-[10px] hover:border-white/20" onClick={() => loadScenePreset(name)}>{name}</button>)}{!Object.keys(scenePresets).length && <span className="text-[10px] text-zinc-600">No presets yet.</span>}</div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {(['camera','video','screen','guest'] as const).map(source => <div key={source} className={`rounded-lg border border-white/5 px-2 py-2 text-center ${sourceHealth[source] === 'ready' ? 'bg-emerald-500/10 text-emerald-300' : sourceHealth[source] === 'lost' ? 'bg-red-500/10 text-red-300' : 'bg-zinc-900 text-zinc-500'}`}><div className="text-[9px] uppercase tracking-wide">{source}</div><div className="text-[10px] font-semibold">{sourceHealth[source]}</div></div>)}
              </div>
            </section>
            <div className="space-y-3">
                <div className="rounded-lg bg-black/30 p-2 space-y-2">
                  <div className="flex items-center gap-2 text-xs font-semibold"><BarChart3 className="w-4 h-4" />LIVE VIEWER VOTE</div>
                  <input value={pollQuestion} onChange={e => setPollQuestion(e.target.value)} placeholder="Question for viewers" className="w-full rounded bg-zinc-800 p-2 text-xs" disabled={!live} />
                  <div className="grid grid-cols-2 gap-2">
                    {pollOptions.map((option, index) => <input key={index} value={option} onChange={e => setPollOptions(prev => prev.map((x, i) => i === index ? e.target.value : x))} placeholder={'Choice '+(index+1)} className="rounded bg-zinc-800 p-2 text-xs" disabled={!live} />)}
                  </div>
                  <div className="flex gap-2">
                    {pollOptions.length < 4 && <Button size="sm" variant="outline" disabled={!live} onClick={() => setPollOptions(prev => [...prev, ''])}>Add choice</Button>}
                    <Button size="sm" disabled={!live || pollOptions.filter(x => x.trim()).length < 2} onClick={() => void publishTvPoll()}>Publish vote</Button>
                  </div>
                  <p className="text-[10px] text-zinc-500">Viewers see the vote beside the live player and can vote once per broadcast poll.</p>
                </div>
                <div className="rounded-lg bg-black/30 p-2 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div><div className="text-xs font-semibold">GRAPHICS</div><div className="text-[10px] text-zinc-500">Prepare in Preview, then TAKE to Program.</div></div>
                    <Button size="sm" variant={graphicsMaster ? 'default' : 'outline'} onClick={() => setGraphicsMaster(v => !v)}>{graphicsMaster ? 'GRAPHICS ON' : 'GRAPHICS OFF'}</Button>
                  </div>
                  <input value={lowerThirdText} onChange={e => setLowerThirdText(e.target.value.slice(0,54))} placeholder="Lower third name/title" className="w-full rounded bg-zinc-800 p-2 text-xs" />
                  <input value={lowerThirdSecondary} onChange={e => setLowerThirdSecondary(e.target.value.slice(0,76))} placeholder="Lower third secondary" className="w-full rounded bg-zinc-800 p-2 text-xs" />
                  <input value={tickerText} onChange={e => setTickerText(e.target.value.slice(0,180))} placeholder="Ticker text" className="w-full rounded bg-zinc-800 p-2 text-xs" />
                  <input value={bannerText} onChange={e => setBannerText(e.target.value.slice(0,100))} placeholder="Breaking banner headline" className="w-full rounded bg-zinc-800 p-2 text-xs" />
                  <input value={fullscreenText} onChange={e => setFullscreenText(e.target.value.slice(0,54))} placeholder="Full-frame title" className="w-full rounded bg-zinc-800 p-2 text-xs" />
                  <input value={nextText} onChange={e => setNextText(e.target.value.slice(0,48))} placeholder="Coming up / next segment" className="w-full rounded bg-zinc-800 p-2 text-xs" />
                  <div className="space-y-1">
                    {[
                      ['lower-third','Lower 3rd'],['ticker','Ticker'],['station-bug','Bug'],['breaking-banner','Banner'],['fullscreen','Full Frame'],['next','Next'],
                    ].map(([id,label]) => <div key={id} className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-1 rounded bg-zinc-900 p-1">
                      <span className="px-1 text-[10px]">{label} <b className={graphics.find(x => x.id === id)?.visible && graphicsMaster ? 'text-emerald-300' : 'text-zinc-600'}>{graphics.find(x => x.id === id)?.visible && graphicsMaster ? 'ON AIR' : 'OFF'}</b></span>
                      <Button size="sm" variant="ghost" onClick={() => prepareGraphic(id)}>Preview</Button>
                      <Button size="sm" variant="outline" onClick={() => takeGraphic(id)}>TAKE</Button>
                      <Button size="sm" variant="ghost" onClick={() => clearGraphic(id)}>Clear</Button>
                    </div>)}
                  </div>
                </div>
                <div className="rounded-lg bg-black/30 p-2 space-y-2">
                  <div className="flex items-center justify-between"><span className="text-xs font-semibold">REPLAY</span><span className="text-[10px] text-zinc-500">{Math.min(60, Math.round(replayBufferRef.current.durationMs / 1000))}s available · {replayState.toUpperCase()}</span></div>
                  <div className="grid grid-cols-3 gap-2 text-[10px]">
                    {[15,30,60].map(seconds => <button key={seconds} className={`rounded bg-zinc-800 p-2 ${replaySeconds === seconds ? 'ring-1 ring-emerald-400' : ''}`} onClick={() => setReplaySeconds(seconds)}>{seconds}s window</button>)}
                  </div>
                  <div className="flex gap-2"><Button size="sm" variant={replayState === 'playing' ? 'default' : 'outline'} disabled={!replayBufferRef.current.frameCount || replayState === 'playing'} onClick={() => void takeScene('replay')}>PLAY REPLAY</Button><Button size="sm" variant="outline" disabled={replayState !== 'playing'} onClick={stopReplay}>STOP</Button></div>
                  <div className="text-[10px] text-zinc-500">Master buffer stays at 60 seconds; the selected window only changes playback selection.</div>
                </div>
                <div className="rounded-lg bg-black/30 p-2 space-y-2">
                  <div className="flex items-center justify-between"><div className="text-xs font-semibold">AUDIO BUSES</div><span className="text-[10px] text-zinc-500">0 = silent · 100 = peak</span></div>
                  {[
                    ['mic','MIC',muted,() => void toggleMic(),commentaryLevel,setCommentaryLevel],
                    ['program','PROGRAM',programMuted,() => setProgramMuted(v => !v),programLevel,setProgramLevel],
                    ['guest','GUEST',guestMuted,() => setGuestMuted(v => !v),guestLevel,setGuestLevel],
                    ['music','MUSIC',musicMuted,() => setMusicMuted(v => !v),musicLevel,setMusicLevel],
                    ['sfx','SFX',sfxMuted,() => setSfxMuted(v => !v),sfxLevel,setSfxLevel],
                  ].map(([id,label,isMuted,toggle,level,setLevel]) => <div key={String(id)} className="rounded bg-zinc-900 p-2">
                    <div className="flex items-center gap-2"><span className="w-16 text-[10px] font-semibold">{String(label)}</span><div className="h-2 flex-1 overflow-hidden rounded bg-zinc-800"><div className="h-full bg-emerald-400 transition-all" style={{width: (audioBusMeters[String(id)] || 0) + '%'}} /></div><span className="w-7 text-right text-[9px] text-zinc-500">{audioBusMeters[String(id)] || 0}</span><Button size="sm" variant={Boolean(isMuted) ? 'destructive' : 'outline'} onClick={toggle as any}>{isMuted ? 'MUTE' : 'ON'}</Button></div>
                    <input aria-label={String(label)+' level'} type="range" min="0" max="1" step="0.05" value={Number(level)} onChange={e => (setLevel as any)(Number(e.target.value))} className="w-full" />
                  </div>)}
                  <div className="rounded bg-zinc-900 p-2"><div className="flex items-center gap-2"><span className="w-16 text-[10px] font-semibold">MASTER</span><div className="h-2 flex-1 overflow-hidden rounded bg-zinc-800"><div className="h-full bg-emerald-400 transition-all" style={{width: audioBusMeters.master + '%'}} /></div><span className="w-7 text-right text-[9px]">{audioBusMeters.master}</span><Button size="sm" variant={masterMuted ? 'destructive' : 'outline'} onClick={() => setMasterMuted(v => !v)}>{masterMuted ? 'MUTE' : 'ON'}</Button></div><input aria-label="Master level" type="range" min="0" max="1" step="0.05" value={masterLevel} onChange={e => setMasterLevel(Number(e.target.value))} className="w-full" /></div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded bg-zinc-900 p-2"><div className="text-[10px] text-zinc-500">Music · {musicState.toUpperCase()}</div><div className="mt-1 flex gap-1"><Button size="sm" disabled={!musicName} onClick={() => void playMusic()}>Play</Button><Button size="sm" variant="outline" disabled={musicState !== 'playing'} onClick={pauseMusic}>Pause</Button><Button size="sm" variant="outline" disabled={!musicName} onClick={stopMusic}>Stop</Button></div><div className="mt-1 text-[9px] text-zinc-600 truncate">{musicName || 'No track loaded'}</div></div>
                    <div className="rounded bg-zinc-900 p-2"><div className="text-[10px] text-zinc-500">SFX · {sfxState.toUpperCase()}</div><div className="mt-1 flex gap-1"><Button size="sm" disabled={!sfxName} onClick={() => void triggerSfx()}>Trigger</Button><Button size="sm" variant="outline" disabled={sfxState !== 'playing'} onClick={stopSfx}>Stop</Button></div><div className="mt-1 text-[9px] text-zinc-600 truncate">{sfxName || 'No SFX loaded'}</div></div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="rounded bg-zinc-800 p-2 text-[10px]">Load music<input type="file" accept="audio/*" className="block w-full mt-1" onChange={e => loadLocalAudio('music', e.target.files?.[0])} /></label>
                    <label className="rounded bg-zinc-800 p-2 text-[10px]">Load SFX<input type="file" accept="audio/*" className="block w-full mt-1" onChange={e => loadLocalAudio('sfx', e.target.files?.[0])} /></label>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Button size="sm" variant={multiview ? 'default' : 'outline'} onClick={() => setMultiview(v => !v)}>Multiview</Button>
                  <Button type="button" size="sm" variant="outline" aria-label="Generate guest link" title="Generate the next guest link" onClick={() => void createGuestInvite()} disabled={guestSlots.length >= TV_GUEST_CAPACITY}><Users className="w-4 h-4 mr-1" />{guestSlots.length>=TV_GUEST_CAPACITY?'Guest slots full':'Guest '+(guestSlots.length+1)}</Button>
                  <Button type="button" size="sm" variant={Object.keys(guestSignalRequests).length ? 'default' : 'outline'} className={Object.keys(guestSignalRequests).length ? 'relative bg-amber-500 text-black hover:bg-amber-400' : ''} onClick={() => nav(activeStreamId ? '/tv-studio/'+activeStreamId+'/guests' : '/tv-studio')}><ShieldCheck className="w-4 h-4 mr-1" />Guest Control{Object.keys(guestSignalRequests).length > 0 && <span className="ml-1 rounded-full bg-black px-1.5 py-0.5 text-[9px] font-bold text-amber-300">{Object.keys(guestSignalRequests).length} SPEAK</span>}</Button>
                  <Button size="sm" variant={replayState === 'playing' ? 'default' : 'outline'} disabled={!replayBufferRef.current.frameCount} onClick={() => void takeScene('replay')}>REPLAY</Button>
                  <Button size="sm" variant={audioDucking ? 'default' : 'outline'} onClick={() => { setAudioDucking(v => !v); if (audioDucking) { setDuckingActive(false); setDuckingReduction(0); } }}>Auto ducking</Button>
                </div>
                <div className="rounded-lg border border-white/10 bg-zinc-900/70 px-2.5 py-2 text-[10px]">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold">AUTO DUCKING</span>
                    <span className={audioDucking ? 'text-emerald-300 font-bold' : 'text-zinc-500'}>{audioDucking ? 'ON' : 'OFF'}</span>
                  </div>
                  <div className="mt-1 text-zinc-500">{duckingActive ? 'Speech detected · Program / Guest / Music / SFX ducked' : audioDucking ? 'Monitoring commentary for speech' : 'Manual mixer levels'}</div>
                  {audioDucking && <div className="mt-1 text-zinc-400">Gain reduction: {duckingReduction}%</div>}
                </div>
                {guestInviteUrl && <div className="rounded-lg border border-blue-500/20 bg-blue-500/10 p-2 text-[10px] space-y-2">
                  <div className="font-semibold text-blue-300">GUEST LINK READY · {guestSlots.find(g => g.inviteUrl === guestInviteUrl)?.label || 'Guest'}</div>
                  <div className="break-all rounded bg-black/40 p-2 text-zinc-300">{guestInviteUrl}</div>
                  <div className="flex gap-2"><Button size="sm" onClick={() => {void navigator.clipboard.writeText(guestInviteUrl);toast.success('Guest link copied');}}><Copy className="w-4 h-4 mr-1"/>Copy</Button><Button size="sm" variant="outline" onClick={() => {if(navigator.share)void navigator.share({title:'Testagram TV guest invitation',text:'Join my Testagram TV guest slot',url:guestInviteUrl});else{void navigator.clipboard.writeText(guestInviteUrl);toast.success('Guest link copied');}}}><Share2 className="w-4 h-4 mr-1"/>Share</Button></div>
                </div>}
                {Object.keys(guestSignalRequests).length > 0 && <div className="rounded-xl border border-amber-400/40 bg-amber-400/10 p-3 text-[10px] space-y-2 shadow-lg shadow-amber-500/5" role="status" aria-live="polite">
                  <div className="flex items-center justify-between gap-2"><div className="flex items-center gap-2 font-bold text-amber-200"><Hand className="w-4 h-4" />SPEAKING REQUESTS</div><span className="rounded-full bg-amber-400/20 px-2 py-0.5 font-bold text-amber-200">{Object.keys(guestSignalRequests).length} waiting</span></div>
                  <div className="text-zinc-400">Guests are signaling quietly. No guest is opened to the program until you approve.</div>
                </div>}
                {guestSlots.length > 0 && <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-2 text-[10px] space-y-2"><div className="font-semibold text-emerald-300">GUEST SLOTS · {guestSlots.length}/{TV_GUEST_CAPACITY}</div>{guestSlots.map(guest => <div key={guest.slot} className="rounded bg-zinc-950/60 p-2"><div className="flex items-center justify-between"><button type="button" className="font-semibold" onClick={() => {setActiveGuestSlot(guest.slot);setPreviewScene('guest');previewSceneRef.current='guest';}}>{guest.label}</button><span>{guest.lifecycle.toUpperCase()}</span></div>
                  {guestSignalRequests[guest.slot] && <div className="mt-2 rounded-lg border border-amber-400/30 bg-amber-400/10 p-2" role="status" aria-live="polite"><div className="flex items-center gap-2 text-[10px] font-bold text-amber-200"><Hand className="w-3.5 h-3.5" />{guestSignalRequests[guest.slot].kind === 'raise-hand' ? 'RAISED HAND' : guestSignalRequests[guest.slot].kind === 'add-to-point' ? 'WANTS TO ADD TO POINT' : 'SECONDS POINT · WANTS TO ADD'}</div><div className="mt-1 text-[10px] text-zinc-400">Guest {guest.slot} is requesting a chance to speak.</div><div className="mt-2 flex gap-1"><Button size="sm" onClick={() => {void guestRoomRef.current?.sendGuestControl(guest.slot,'grant-speak');setGuestSignalRequests(prev => {const next={...prev};delete next[guest.slot];return next;});toast.success(guest.label+' may speak now.');}}>Allow to speak</Button><Button size="sm" variant="outline" onClick={() => {void guestRoomRef.current?.sendGuestControl(guest.slot,'deny-speak');setGuestSignalRequests(prev => {const next={...prev};delete next[guest.slot];return next;});}}>Not now</Button></div></div>}
                  <div className="mt-1 break-all text-zinc-500">{guest.inviteUrl}</div>{guest.inviteUrl && <div className="mt-1 flex gap-1"><Button size="sm" onClick={() => {void navigator.clipboard?.writeText(guest.inviteUrl);toast.success(guest.label+' link copied');}}>Copy</Button><Button size="sm" variant="outline" onClick={() => {if(navigator.share)void navigator.share({title:guest.label,text:'Join '+guest.label+' on Testagram TV',url:guest.inviteUrl}).catch(()=>undefined);else{void navigator.clipboard?.writeText(guest.inviteUrl);toast.success('Guest link copied');}}}>Share</Button></div>}</div>)}</div>}
              </div>
            <div className="rounded-2xl border border-white/10 bg-zinc-900 p-4">
              <div className="flex items-center gap-2 font-semibold mb-3"><Settings2 className="w-4 h-4" />Production controls</div>
              <label className="text-xs text-zinc-400">Capture quality</label>
              <select value={quality} disabled={live || recording} onChange={e => setQuality(e.target.value as Quality)} className="w-full mt-1 rounded-lg bg-zinc-800 p-2">
                <option value="4k">4K UHD (3840×2160)</option><option value="1440p">1440p QHD (2560×1440)</option><option value="1080p">1080p Full HD</option><option value="720p">720p HD</option><option value="480p">480p</option>
              </select>
              <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-lg bg-black/30 p-2"><Activity className="w-3.5 h-3.5 mb-1 text-emerald-400" /><span>{quality === '4k' ? '4K UHD' : quality}</span><p className="text-zinc-500">production output</p></div>
                <div className="rounded-lg bg-black/30 p-2"><Mic className="w-3.5 h-3.5 mb-1 text-emerald-400" /><span>48 kHz</span><p className="text-zinc-500">processed audio</p></div>
                <div className="rounded-lg bg-black/30 p-2"><Users className="w-3.5 h-3.5 mb-1 text-blue-400" /><span>{viewerCount}</span><p className="text-zinc-500">live viewers</p></div>
                <div className="rounded-lg bg-black/30 p-2"><ShieldCheck className="w-3.5 h-3.5 mb-1 text-emerald-400" /><span>Local</span><p className="text-zinc-500">recording storage</p></div>
              </div>
              <div className="mt-2 text-[10px] text-zinc-500">Replay buffer: {replayBufferRef.current.frameCount} frames / {Math.round(replayBufferRef.current.durationMs / 1000)}s · Guest: {guestLabel} · Video {guestVideoReady ? 'ready' : 'waiting'} · Audio {guestAudioReady ? 'ready' : 'waiting'}</div>
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
