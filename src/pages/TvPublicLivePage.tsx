import { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import { useParams, useSearchParams } from 'react-router-dom';
import {
  Loader2,
  Radio,
  Volume2,
  VolumeX,
  Share2,
  Maximize2,
  Camera,
  CameraOff,
  Mic,
  MicOff,
  PhoneOff,
  Hand,
  MessageCirclePlus,
  ThumbsUp,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/supabase';
import { TestagramTvMediaSession } from '@/lib/testagramTvMedia';
import { toast } from 'sonner';
import { TvMeetupPanel } from '@/components/features/TvMeetupPanel';

  useEffect(() => {
    if (isGuest || !bunnyPlaybackUrl) return;
    const video = bunnyVideoRef.current;
    if (!video) return;
    let hls: Hls | null = null;
    video.muted = muted;
    video.playsInline = true;
    const play = () => { void video.play().catch(() => undefined); };
    if (Hls.isSupported()) {
      hls = new Hls({ enableWorker: true, lowLatencyMode: true, backBufferLength: 30, liveSyncDurationCount: 3, maxBufferLength: 12 });
      hls.loadSource(bunnyPlaybackUrl);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, play);
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (!data?.fatal) return;
        setBunnyPlayerError(true);
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) hls?.startLoad();
        else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) hls?.recoverMediaError();
      });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = bunnyPlaybackUrl;
      video.addEventListener('loadedmetadata', play, { once: true });
    }
    return () => {
      hls?.destroy();
      video.pause();
      video.removeAttribute('src');
      video.load();
    };
  }, [bunnyPlaybackUrl, muted, isGuest]);

export default function TvPublicLivePage() {
  const { streamId } = useParams();
  const [searchParams] = useSearchParams();
  const inviteToken = searchParams.get('guest');
  const isGuest = Boolean(inviteToken);
  const videoRef = useRef<HTMLVideoElement>(null);
  const nativeVideoRef = useRef<HTMLVideoElement>(null);
  const nativeSessionRef = useRef<TestagramTvMediaSession | null>(null);
  const studioMultiviewRef = useRef<HTMLVideoElement>(null);
  const bunnyVideoRef = useRef<HTMLVideoElement>(null);
  const sessionRef = useRef<TestagramTvMediaSession | null>(null);
  const guestMediaRef = useRef<MediaStream | null>(null);
  const [title, setTitle] = useState('Testagram TV');
  const [connecting, setConnecting] = useState(true);
  const [live, setLive] = useState(false);
  const [muted, setMuted] = useState(true);
  const [cameraOn, setCameraOn] = useState(true);
  const [micOn, setMicOn] = useState(true);
  const [error, setError] = useState('');
  const [bunnyPlaybackUrl, setBunnyPlaybackUrl] = useState<string | null>(null);
  const [bunnyPlayerError, setBunnyPlayerError] = useState(false);
  const [nativeLive, setNativeLive] = useState(false);
  const [nativeError, setNativeError] = useState('');
  const [guestSlot, setGuestSlot] = useState<number | null>(null);
  const [speakingGranted, setSpeakingGranted] = useState(false);
  const [sentGuestSignal, setSentGuestSignal] = useState<'raise-hand' | 'add-to-point' | 'second-point' | null>(null);

  useEffect(() => {
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let connectingAttempt = false;
    let retryCount = 0;

    const sleepRetry = (ms: number) => {
      if (cancelled) return;
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = setTimeout(() => {
        void connect();
      }, ms);
    };

    const connect = async () => {
      if (cancelled || connectingAttempt || !streamId) return;
      connectingAttempt = true;
      setConnecting(true);
      setError('');
      setYoutubePlayerError(false);

      try {
        if (!isGuest) {
          const viewerUrl = `/api/live?action=viewer&stream_id=${encodeURIComponent(streamId)}`;
          const viewerResponse = await fetch(viewerUrl, {
            method: 'GET',
            cache: 'default',
          });

          const viewerPayload = await viewerResponse.json().catch(() => null);

          if (!viewerResponse.ok) {
            const code = viewerPayload?.error?.code;

            if (
              code === 'STREAM_ENDED' ||
              code === 'STREAM_NOT_FOUND' ||
              code === 'TV_MEDIA_NOT_READY'
            ) {
              setLive(false);
              setBunnyPlaybackUrl(null);
              setConnecting(true);

              if (code === 'TV_MEDIA_NOT_READY') {
                setError(
                  retryCount > 8
                    ? 'Live video is still connecting — retrying automatically.'
                    : '',
                );
              }

              sleepRetry(
                code === 'TV_MEDIA_NOT_READY'
                  ? Math.min(5000, 500 + retryCount * 350)
                  : 1500,
              );
              retryCount += 1;
              return;
            }

            throw new Error(
              viewerPayload?.error?.message || 'TV broadcast is unavailable.',
            );
          }

          const contract = viewerPayload?.data;
          if (contract?.provider !== 'bunny') {
            throw new Error('Testagram TV is not configured for Bunny playback.');
          }
          const playbackUrl = String(contract?.bunny?.playback_url || '').trim();
          if (!playbackUrl) {
            throw new Error('Bunny live playback is not ready yet.');
          }
          setTitle(contract.title || 'Testagram TV');
          setBunnyPlaybackUrl(playbackUrl);
          setNativeLive(false);
          setNativeError('');
          setLive(true);
          setConnecting(false);
          setError('');
          retryCount = 0;
          return;
        if (isGuest && inviteToken) {
          const { data: stream, error: streamError } = await supabase
            .from('live_streams')
            .select('id,title,is_live')
            .eq('id', streamId)
            .maybeSingle();

          if (streamError || !stream || !stream.is_live) {
            throw new Error('This TV broadcast is no longer live.');
          }

          if (cancelled) return;

          setTitle(stream.title || 'Testagram TV');

          const media = await navigator.mediaDevices.getUserMedia({
            video: {
              width: { ideal: 1280 },
              height: { ideal: 720 },
              frameRate: { ideal: 30, max: 30 },
            },
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
            },
          });

          guestMediaRef.current = media;

          if (videoRef.current) {
            videoRef.current.srcObject = media;
            videoRef.current.muted = true;
            videoRef.current.playsInline = true;
            void videoRef.current.play().catch(() => undefined);
          }

          const session = await TestagramTvMediaSession.connectGuest(
            streamId,
            inviteToken,
            media,
            (remote) => {
              const player = studioMultiviewRef.current;
              if (player && player.srcObject !== remote) {
                player.srcObject = remote;
                player.muted = true;
                player.playsInline = true;
                void player.play().catch(() => undefined);
              }
            },
          );
          sessionRef.current = session;
          session.setGuestControlHandler((control) => {
            if (control === 'grant-speak') {
              setSpeakingGranted(true);
              const track = guestMediaRef.current?.getAudioTracks()[0];
              if (track) { track.enabled = true; setMicOn(true); }
              toast.success('The host has given you a chance to speak.');
            } else if (control === 'deny-speak') {
              setSpeakingGranted(false);
              toast.info('The host has not opened the floor yet.');
            } else if (control === 'mute') {
              const track = guestMediaRef.current?.getAudioTracks()[0];
              if (track) { track.enabled = false; setMicOn(false); }
              toast.info('The studio muted your microphone.');
            } else if (control === 'unmute') {
              const track = guestMediaRef.current?.getAudioTracks()[0];
              if (track) { track.enabled = true; setMicOn(true); }
              toast.info('The studio enabled your microphone.');
            } else if (control === 'block') {
              void sessionRef.current?.close();
              guestMediaRef.current?.getTracks().forEach(track => track.stop());
              guestMediaRef.current = null;
              setLive(false);
              setError('The studio has blocked this guest slot.');
              toast.error('You have been blocked from the TV guest slot.');
            } else {
              toast.info('The studio has unblocked your guest slot. Reload to reconnect.');
            }
          });
          setGuestSlot(Number((session as any).guestSlot || 0) || null);
          setLive(true);
          setConnecting(false);
          return;
        }

        throw new Error('TV viewer mode is unavailable.');
      } catch (e: unknown) {
        if (!cancelled) {
          setLive(false);
          retryCount += 1;
          setError(
            retryCount > 8
              ? 'Live video is reconnecting automatically.'
              : '',
          );

          await sessionRef.current?.close().catch(() => undefined);
          sessionRef.current = null;
          sleepRetry(Math.min(5000, 750 + retryCount * 350));
        }
      } finally {
        connectingAttempt = false;
      }
    };

    void connect();

    return () => {
      cancelled = true;
      void nativeSessionRef.current?.close().catch(() => undefined);
      nativeSessionRef.current = null;
      connectingAttempt = false;

      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = null;

      void sessionRef.current?.close();
      sessionRef.current = null;

      setBunnyPlaybackUrl(null);

      const video = videoRef.current;
      if (video) {
        video.pause();
        video.removeAttribute('src');
        video.srcObject = null;
      }

      guestMediaRef.current?.getTracks().forEach((track) => track.stop());
      guestMediaRef.current = null;
    };
  }, [streamId, inviteToken, isGuest]);

  useEffect(() => {
    if (!bunnyPlaybackUrl || isGuest) return;
    if (bunnyVideoRef.current) bunnyVideoRef.current.muted = muted;
  }, [bunnyPlaybackUrl, muted, isGuest]);

  const share = async () => {
    const url = window.location.origin + window.location.pathname;

    try {
      if (navigator.share) {
        await navigator.share({
          title,
          text: `Watch ${title} live on Testagram TV`,
          url,
        });
      } else {
        await navigator.clipboard.writeText(url);
        toast.success('TV link copied');
      }
    } catch (e: unknown) {
      if (e instanceof DOMException && e.name === 'AbortError') return;

      try {
        await navigator.clipboard.writeText(url);
        toast.success('TV link copied');
      } catch {
        toast.error('Could not copy TV link');
      }
    }
  };

  const fullscreen = async () => {
    const bunny = bunnyRef.current;

    if (!bunny && !videoRef.current) return;

    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
        return;
      }

      await (bunny || videoRef.current)?.requestFullscreen();
    } catch {
      toast.error('Fullscreen is not available on this device.');
    }
  };

  const toggleCamera = () => {
    if (!isGuest) return;

    const track = guestMediaRef.current?.getVideoTracks()[0];
    if (!track) return;

    track.enabled = !track.enabled;
    setCameraOn(track.enabled);
  };

  const toggleMic = () => {
    if (!isGuest) return;

    const track = guestMediaRef.current?.getAudioTracks()[0];
    if (!track) return;

    track.enabled = !track.enabled;
    setMicOn(track.enabled);
  };

  const sendGuestSignal = async (signal: 'raise-hand' | 'add-to-point' | 'second-point') => {
    if (!isGuest || !live || !sessionRef.current) return;
    try {
      await sessionRef.current.sendGuestSignal(signal);
      setSentGuestSignal(signal);
      const label = signal === 'raise-hand' ? 'Raise hand' : signal === 'add-to-point' ? 'Add to point' : 'Second point';
      toast.success(label + ' sent to the host.');
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Could not send speaking signal.');
    }
  };

  const leaveGuest = async () => {
    await sessionRef.current?.close();
    sessionRef.current = null;

    guestMediaRef.current?.getTracks().forEach((track) => track.stop());
    guestMediaRef.current = null;

    setLive(false);
    setError('You left the TV guest session.');
  };

  const bunnyOrigin =
    typeof window === 'undefined' ? '' : window.location.origin;

  const bunnyPlaybackUrl = bunnyPlaybackUrl
    ? buildBunnyEmbedUrl(bunnyPlaybackUrl, bunnyOrigin)
    : '';

  const viewerStatus = isGuest
    ? live
      ? 'CONNECTED TO STUDIO'
      : connecting
        ? 'CONNECTING…'
        : 'GUEST OFFLINE'
    : live
      ? 'LIVE'
      : connecting
        ? 'CONNECTING…'
        : 'OFFLINE';

  return (
    <div className="min-h-screen bg-black text-white flex flex-col">
      <header className="flex items-center justify-between gap-3 px-4 py-3 border-b border-white/10 bg-zinc-950">
        <div className="min-w-0">
          <div className="flex items-center gap-2 font-semibold truncate">
            <Radio className="w-4 h-4 text-red-500" />
            {isGuest ? (guestSlot ? 'TV Guest ' + guestSlot : 'TV Guest') : title}
          </div>
          <div className="text-xs text-zinc-500">
            {viewerStatus}
          </div>
        </div>

        {!isGuest ? (
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => void share()}
            >
              <Share2 className="w-4 h-4 mr-1" />
              Share
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                const nextMuted = !muted;
                setMuted(nextMuted);
                sendBunnyCommand(
                  bunnyRef.current,
                  nextMuted ? 'mute' : 'unMute',
                );
              }}
              disabled={!bunnyPlaybackUrl}
              aria-label={muted ? 'Unmute live TV' : 'Mute live TV'}
            >
              {muted ? (
                <VolumeX className="w-4 h-4" />
              ) : (
                <Volume2 className="w-4 h-4" />
              )}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void fullscreen()}
              disabled={!bunnyPlaybackUrl}
              aria-label="Fullscreen live TV"
            >
              <Maximize2 className="w-4 h-4" />
            </Button>
          </div>
        ) : null}
      </header>

      <main className="flex-1 flex flex-col items-center justify-center gap-3 p-3">
        <div className="w-full max-w-6xl flex items-center justify-between gap-3 text-xs text-zinc-500">
          <span>{isGuest ? (guestSlot ? 'Studio guest slot ' + guestSlot : 'Studio guest connection') : 'Testagram TV live player'}</span>
          {!isGuest && live ? (
            <span className="inline-flex items-center gap-1 text-red-400 font-semibold">
              <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
              LIVE
            </span>
          ) : null}
        </div>

        <div className="w-full max-w-6xl aspect-video bg-zinc-950 rounded-xl overflow-hidden border border-white/10">
          {!isGuest ? (
            <video
              ref={bunnyVideoRef}
              data-testagram-bunny-player="true"
              className="w-full h-full object-contain bg-black"
              autoPlay
              playsInline
              muted={muted}
              controls
              onError={() => setBunnyPlayerError(true)}
            />
          ) : nativeLive ? (
            <video ref={nativeVideoRef} className="w-full h-full object-contain bg-black" autoPlay playsInline controls />
          ) : null} useRef, useState } from 'react';
import Hls from 'hls.js';
import { useParams, useSearchParams } from 'react-router-dom';
import {
  Loader2,
  Radio,
  Volume2,
  VolumeX,
  Share2,
  Maximize2,
  Camera,
  CameraOff,
  Mic,
  MicOff,
  PhoneOff,
  Hand,
  MessageCirclePlus,
  ThumbsUp,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/supabase';
import { TestagramTvMediaSession } from '@/lib/testagramTvMedia';
import { toast } from 'sonner';
import { TvMeetupPanel } from '@/components/features/TvMeetupPanel';

  useEffect(() => {
    if (isGuest || !bunnyPlaybackUrl) return;
    const video = bunnyVideoRef.current;
    if (!video) return;
    let hls: Hls | null = null;
    video.muted = muted;
    video.playsInline = true;
    const play = () => { void video.play().catch(() => undefined); };
    if (Hls.isSupported()) {
      hls = new Hls({ enableWorker: true, lowLatencyMode: true, backBufferLength: 30, liveSyncDurationCount: 3, maxBufferLength: 12 });
      hls.loadSource(bunnyPlaybackUrl);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, play);
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (!data?.fatal) return;
        setBunnyPlayerError(true);
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) hls?.startLoad();
        else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) hls?.recoverMediaError();
      });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = bunnyPlaybackUrl;
      video.addEventListener('loadedmetadata', play, { once: true });
    }
    return () => {
      hls?.destroy();
      video.pause();
      video.removeAttribute('src');
      video.load();
    };
  }, [bunnyPlaybackUrl, muted, isGuest]);

export default function TvPublicLivePage() {
  const { streamId } = useParams();
  const [searchParams] = useSearchParams();
  const inviteToken = searchParams.get('guest');
  const isGuest = Boolean(inviteToken);
  const videoRef = useRef<HTMLVideoElement>(null);
  const nativeVideoRef = useRef<HTMLVideoElement>(null);
  const nativeSessionRef = useRef<TestagramTvMediaSession | null>(null);
  const studioMultiviewRef = useRef<HTMLVideoElement>(null);
  const bunnyVideoRef = useRef<HTMLVideoElement>(null);
  const sessionRef = useRef<TestagramTvMediaSession | null>(null);
  const guestMediaRef = useRef<MediaStream | null>(null);
  const [title, setTitle] = useState('Testagram TV');
  const [connecting, setConnecting] = useState(true);
  const [live, setLive] = useState(false);
  const [muted, setMuted] = useState(true);
  const [cameraOn, setCameraOn] = useState(true);
  const [micOn, setMicOn] = useState(true);
  const [error, setError] = useState('');
  const [bunnyPlaybackUrl, setBunnyPlaybackUrl] = useState<string | null>(null);
  const [bunnyPlayerError, setBunnyPlayerError] = useState(false);
  const [nativeLive, setNativeLive] = useState(false);
  const [nativeError, setNativeError] = useState('');
  const [guestSlot, setGuestSlot] = useState<number | null>(null);
  const [speakingGranted, setSpeakingGranted] = useState(false);
  const [sentGuestSignal, setSentGuestSignal] = useState<'raise-hand' | 'add-to-point' | 'second-point' | null>(null);

  useEffect(() => {
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let connectingAttempt = false;
    let retryCount = 0;

    const sleepRetry = (ms: number) => {
      if (cancelled) return;
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = setTimeout(() => {
        void connect();
      }, ms);
    };

    const connect = async () => {
      if (cancelled || connectingAttempt || !streamId) return;
      connectingAttempt = true;
      setConnecting(true);
      setError('');
      setYoutubePlayerError(false);

      try {
        if (!isGuest) {
          const viewerUrl = `/api/live?action=viewer&stream_id=${encodeURIComponent(streamId)}`;
          const viewerResponse = await fetch(viewerUrl, {
            method: 'GET',
            cache: 'default',
          });

          const viewerPayload = await viewerResponse.json().catch(() => null);

          if (!viewerResponse.ok) {
            const code = viewerPayload?.error?.code;

            if (
              code === 'STREAM_ENDED' ||
              code === 'STREAM_NOT_FOUND' ||
              code === 'TV_MEDIA_NOT_READY'
            ) {
              setLive(false);
              setBunnyPlaybackUrl(null);
              setConnecting(true);

              if (code === 'TV_MEDIA_NOT_READY') {
                setError(
                  retryCount > 8
                    ? 'Live video is still connecting — retrying automatically.'
                    : '',
                );
              }

              sleepRetry(
                code === 'TV_MEDIA_NOT_READY'
                  ? Math.min(5000, 500 + retryCount * 350)
                  : 1500,
              );
              retryCount += 1;
              return;
            }

            throw new Error(
              viewerPayload?.error?.message || 'TV broadcast is unavailable.',
            );
          }

          const contract = viewerPayload?.data;
          if (contract?.provider !== 'bunny') {
            throw new Error('Testagram TV is not configured for Bunny playback.');
          }
          const playbackUrl = String(contract?.bunny?.playback_url || '').trim();
          if (!playbackUrl) {
            throw new Error('Bunny live playback is not ready yet.');
          }
          setTitle(contract.title || 'Testagram TV');
          setBunnyPlaybackUrl(playbackUrl);
          setNativeLive(false);
          setNativeError('');
          setLive(true);
          setConnecting(false);
          setError('');
          retryCount = 0;
          return;
        if (isGuest && inviteToken) {
          const { data: stream, error: streamError } = await supabase
            .from('live_streams')
            .select('id,title,is_live')
            .eq('id', streamId)
            .maybeSingle();

          if (streamError || !stream || !stream.is_live) {
            throw new Error('This TV broadcast is no longer live.');
          }

          if (cancelled) return;

          setTitle(stream.title || 'Testagram TV');

          const media = await navigator.mediaDevices.getUserMedia({
            video: {
              width: { ideal: 1280 },
              height: { ideal: 720 },
              frameRate: { ideal: 30, max: 30 },
            },
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
            },
          });

          guestMediaRef.current = media;

          if (videoRef.current) {
            videoRef.current.srcObject = media;
            videoRef.current.muted = true;
            videoRef.current.playsInline = true;
            void videoRef.current.play().catch(() => undefined);
          }

          const session = await TestagramTvMediaSession.connectGuest(
            streamId,
            inviteToken,
            media,
            (remote) => {
              const player = studioMultiviewRef.current;
              if (player && player.srcObject !== remote) {
                player.srcObject = remote;
                player.muted = true;
                player.playsInline = true;
                void player.play().catch(() => undefined);
              }
            },
          );
          sessionRef.current = session;
          session.setGuestControlHandler((control) => {
            if (control === 'grant-speak') {
              setSpeakingGranted(true);
              const track = guestMediaRef.current?.getAudioTracks()[0];
              if (track) { track.enabled = true; setMicOn(true); }
              toast.success('The host has given you a chance to speak.');
            } else if (control === 'deny-speak') {
              setSpeakingGranted(false);
              toast.info('The host has not opened the floor yet.');
            } else if (control === 'mute') {
              const track = guestMediaRef.current?.getAudioTracks()[0];
              if (track) { track.enabled = false; setMicOn(false); }
              toast.info('The studio muted your microphone.');
            } else if (control === 'unmute') {
              const track = guestMediaRef.current?.getAudioTracks()[0];
              if (track) { track.enabled = true; setMicOn(true); }
              toast.info('The studio enabled your microphone.');
            } else if (control === 'block') {
              void sessionRef.current?.close();
              guestMediaRef.current?.getTracks().forEach(track => track.stop());
              guestMediaRef.current = null;
              setLive(false);
              setError('The studio has blocked this guest slot.');
              toast.error('You have been blocked from the TV guest slot.');
            } else {
              toast.info('The studio has unblocked your guest slot. Reload to reconnect.');
            }
          });
          setGuestSlot(Number((session as any).guestSlot || 0) || null);
          setLive(true);
          setConnecting(false);
          return;
        }

        throw new Error('TV viewer mode is unavailable.');
      } catch (e: unknown) {
        if (!cancelled) {
          setLive(false);
          retryCount += 1;
          setError(
            retryCount > 8
              ? 'Live video is reconnecting automatically.'
              : '',
          );

          await sessionRef.current?.close().catch(() => undefined);
          sessionRef.current = null;
          sleepRetry(Math.min(5000, 750 + retryCount * 350));
        }
      } finally {
        connectingAttempt = false;
      }
    };

    void connect();

    return () => {
      cancelled = true;
      void nativeSessionRef.current?.close().catch(() => undefined);
      nativeSessionRef.current = null;
      connectingAttempt = false;

      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = null;

      void sessionRef.current?.close();
      sessionRef.current = null;

      setBunnyPlaybackUrl(null);

      const video = videoRef.current;
      if (video) {
        video.pause();
        video.removeAttribute('src');
        video.srcObject = null;
      }

      guestMediaRef.current?.getTracks().forEach((track) => track.stop());
      guestMediaRef.current = null;
    };
  }, [streamId, inviteToken, isGuest]);

  useEffect(() => {
    if (!bunnyPlaybackUrl || isGuest) return;
    if (bunnyVideoRef.current) bunnyVideoRef.current.muted = muted;
  }, [bunnyPlaybackUrl, muted, isGuest]);

  const share = async () => {
    const url = window.location.origin + window.location.pathname;

    try {
      if (navigator.share) {
        await navigator.share({
          title,
          text: `Watch ${title} live on Testagram TV`,
          url,
        });
      } else {
        await navigator.clipboard.writeText(url);
        toast.success('TV link copied');
      }
    } catch (e: unknown) {
      if (e instanceof DOMException && e.name === 'AbortError') return;

      try {
        await navigator.clipboard.writeText(url);
        toast.success('TV link copied');
      } catch {
        toast.error('Could not copy TV link');
      }
    }
  };

  const fullscreen = async () => {
    const bunny = bunnyRef.current;

    if (!bunny && !videoRef.current) return;

    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
        return;
      }

      await (bunny || videoRef.current)?.requestFullscreen();
    } catch {
      toast.error('Fullscreen is not available on this device.');
    }
  };

  const toggleCamera = () => {
    if (!isGuest) return;

    const track = guestMediaRef.current?.getVideoTracks()[0];
    if (!track) return;

    track.enabled = !track.enabled;
    setCameraOn(track.enabled);
  };

  const toggleMic = () => {
    if (!isGuest) return;

    const track = guestMediaRef.current?.getAudioTracks()[0];
    if (!track) return;

    track.enabled = !track.enabled;
    setMicOn(track.enabled);
  };

  const sendGuestSignal = async (signal: 'raise-hand' | 'add-to-point' | 'second-point') => {
    if (!isGuest || !live || !sessionRef.current) return;
    try {
      await sessionRef.current.sendGuestSignal(signal);
      setSentGuestSignal(signal);
      const label = signal === 'raise-hand' ? 'Raise hand' : signal === 'add-to-point' ? 'Add to point' : 'Second point';
      toast.success(label + ' sent to the host.');
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Could not send speaking signal.');
    }
  };

  const leaveGuest = async () => {
    await sessionRef.current?.close();
    sessionRef.current = null;

    guestMediaRef.current?.getTracks().forEach((track) => track.stop());
    guestMediaRef.current = null;

    setLive(false);
    setError('You left the TV guest session.');
  };

  const bunnyOrigin =
    typeof window === 'undefined' ? '' : window.location.origin;

  const bunnyPlaybackUrl = bunnyPlaybackUrl
    ? buildBunnyEmbedUrl(bunnyPlaybackUrl, bunnyOrigin)
    : '';

  const viewerStatus = isGuest
    ? live
      ? 'CONNECTED TO STUDIO'
      : connecting
        ? 'CONNECTING…'
        : 'GUEST OFFLINE'
    : live
      ? 'LIVE'
      : connecting
        ? 'CONNECTING…'
        : 'OFFLINE';

  return (
    <div className="min-h-screen bg-black text-white flex flex-col">
      <header className="flex items-center justify-between gap-3 px-4 py-3 border-b border-white/10 bg-zinc-950">
        <div className="min-w-0">
          <div className="flex items-center gap-2 font-semibold truncate">
            <Radio className="w-4 h-4 text-red-500" />
            {isGuest ? (guestSlot ? 'TV Guest ' + guestSlot : 'TV Guest') : title}
          </div>
          <div className="text-xs text-zinc-500">
            {viewerStatus}
          </div>
        </div>

        {!isGuest ? (
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => void share()}
            >
              <Share2 className="w-4 h-4 mr-1" />
              Share
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                const nextMuted = !muted;
                setMuted(nextMuted);
                sendBunnyCommand(
                  bunnyRef.current,
                  nextMuted ? 'mute' : 'unMute',
                );
              }}
              disabled={!bunnyPlaybackUrl}
              aria-label={muted ? 'Unmute live TV' : 'Mute live TV'}
            >
              {muted ? (
                <VolumeX className="w-4 h-4" />
              ) : (
                <Volume2 className="w-4 h-4" />
              )}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void fullscreen()}
              disabled={!bunnyPlaybackUrl}
              aria-label="Fullscreen live TV"
            >
              <Maximize2 className="w-4 h-4" />
            </Button>
          </div>
        ) : null}
      </header>

      <main className="flex-1 flex flex-col items-center justify-center gap-3 p-3">
        <div className="w-full max-w-6xl flex items-center justify-between gap-3 text-xs text-zinc-500">
          <span>{isGuest ? (guestSlot ? 'Studio guest slot ' + guestSlot : 'Studio guest connection') : 'Testagram TV live player'}</span>
          {!isGuest && live ? (
            <span className="inline-flex items-center gap-1 text-red-400 font-semibold">
              <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
              LIVE
            </span>
          ) : null}
        </div>

        <div className="w-full max-w-6xl aspect-video bg-zinc-950 rounded-xl overflow-hidden border border-white/10">
          {nativeLive && !isGuest ? (
            <video
              ref={nativeVideoRef}
              data-testagram-native-player="true"
              className="w-full h-full object-contain bg-black"
              autoPlay
              playsInline
              controls
              onError={() => setNativeLive(false)}
            />
          ) : bunnyPlaybackUrl && !isGuest ? (
            <iframe
              ref={bunnyRef}
              data-testagram-bunny-player="true"
              className="w-full h-full border-0"
              src={bunnyPlaybackUrl}
              title={`${title} — Testagram TV Live`}
              allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
              allowFullScreen
              onLoad={() => {
                setYoutubePlayerError(false);
                sendBunnyCommand(bunnyRef.current, muted ? 'mute' : 'unMute');
              }}
              onError={() => {
                setYoutubePlayerError(true);
              }}
            />
          ) : isGuest ? (
            <div className="relative w-full h-full bg-zinc-950">
              <video ref={studioMultiviewRef} autoPlay playsInline muted className="w-full h-full object-contain" />
              <div className="absolute right-3 bottom-3 w-32 sm:w-44 aspect-video overflow-hidden rounded-lg border border-white/30 bg-black shadow-2xl">
                <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
                <span className="absolute left-1.5 bottom-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[9px] font-bold">YOU · GUEST {guestSlot || ''}</span>
              </div>
              {!live && !connecting && <div className="absolute inset-0 flex items-center justify-center text-sm text-zinc-500">Waiting for the studio multiview…</div>}
            </div>
          ) : (
            <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-contain" />
          )}
        </div>

        {!isGuest && live && streamId ? <div className="w-full max-w-6xl"><TvMeetupPanel streamId={streamId} /></div> : null}

        <div className="w-full max-w-6xl min-h-10 flex items-center justify-center text-center">
          {nativeError && !nativeLive && bunnyPlaybackUrl && !isGuest && (
            <div className="text-[10px] text-zinc-500">Native Testagram media unavailable here; using CDN-backed live playback.</div>
          )}
          {connecting && (
            <div className="inline-flex items-center gap-2 text-sm text-zinc-400">
              <Loader2 className="w-5 h-5 animate-spin" />
              Connecting to Testagram TV…
            </div>
          )}

          {!connecting && bunnyPlayerError && !isGuest && (
            <div className="flex flex-wrap items-center justify-center gap-3 text-sm text-zinc-300">
              <span>Bunny could not load the live player.</span>
              <Button
                size="sm"
                variant="outline"
                onClick={() => window.location.reload()}
              >
                Try again
              </Button>
            </div>
          )}

          {!connecting && error && (
            <div className="flex flex-wrap items-center justify-center gap-3 text-sm text-zinc-300">
              <span>{error}</span>
              <Button
                size="sm"
                variant="outline"
                onClick={() => window.location.reload()}
              >
                Try again
              </Button>
            </div>
          )}

          {!connecting && !error && !bunnyPlayerError && !live && !isGuest && (
            <span className="text-sm text-zinc-500">
              Testagram TV is offline.
            </span>
          )}
        </div>
      </main>

      {isGuest && (
        <div className="p-3 flex flex-wrap justify-center gap-2 border-t border-white/10 bg-zinc-950">
          <Button
            disabled={!live}
            variant={cameraOn ? 'default' : 'destructive'}
            onClick={toggleCamera}
          >
            {cameraOn ? (
              <Camera className="w-4 h-4 mr-1" />
            ) : (
              <CameraOff className="w-4 h-4 mr-1" />
            )}
            {cameraOn ? 'Camera on' : 'Camera off'}
          </Button>

          <Button
            disabled={!live}
            variant={micOn ? 'default' : 'destructive'}
            onClick={toggleMic}
          >
            {micOn ? (
              <Mic className="w-4 h-4 mr-1" />
            ) : (
              <MicOff className="w-4 h-4 mr-1" />
            )}
            {micOn ? 'Mic on' : 'Mic off'}
          </Button>

          <div className="w-full max-w-2xl rounded-xl border border-white/10 bg-zinc-900/70 p-3">
            <div className="flex items-center gap-2 text-xs font-semibold"><Hand className="w-4 h-4 text-amber-300" />ASK TO SPEAK</div>
            <p className="mt-1 text-[10px] text-zinc-500">Send a polite, non-verbal cue to the host. The host decides when to open your mic.</p>
            <div className="mt-2 grid grid-cols-3 gap-2">
              <Button size="sm" disabled={!live} variant={sentGuestSignal === 'raise-hand' ? 'default' : 'outline'} onClick={() => void sendGuestSignal('raise-hand')}><Hand className="w-4 h-4 mr-1" />Raise hand</Button>
              <Button size="sm" disabled={!live} variant={sentGuestSignal === 'add-to-point' ? 'default' : 'outline'} onClick={() => void sendGuestSignal('add-to-point')}><MessageCirclePlus className="w-4 h-4 mr-1" />Add to point</Button>
              <Button size="sm" disabled={!live} variant={sentGuestSignal === 'second-point' ? 'default' : 'outline'} onClick={() => void sendGuestSignal('second-point')}><ThumbsUp className="w-4 h-4 mr-1" />Second point</Button>
            </div>
            {sentGuestSignal && <div className="mt-2 text-[10px] text-emerald-300">Signal sent · waiting for the host {speakingGranted ? '· you may speak' : '· mic remains under host control'}.</div>}
          </div>

          <Button
            disabled={!live}
            variant="destructive"
            onClick={() => void leaveGuest()}
          >
            <PhoneOff className="w-4 h-4 mr-1" />
            Leave studio
          </Button>
        </div>
      )}

      <footer className="px-4 py-3 text-center text-xs text-zinc-600">
        {isGuest
          ? 'Guest media is transmitted live to the Testagram TV studio. No finished recording is uploaded from this page.'
          : 'Live from Testagram TV · Bunny provides the live picture and audio inside the Testagram player. Finished recordings are not stored here.'}
      </footer>
    </div>
  );
}
