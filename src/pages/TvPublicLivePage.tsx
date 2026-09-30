import { useEffect, useRef, useState } from 'react';
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
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/supabase';
import { TestagramTvMediaSession } from '@/lib/testagramTvMedia';
import { toast } from 'sonner';

const YOUTUBE_EMBED_BASE = 'https://www.youtube.com/embed/';

function buildYouTubeEmbedUrl(videoId: string, origin: string) {
  const params = new URLSearchParams({
    autoplay: '1',
    playsinline: '1',
    mute: '1',
    enablejsapi: '1',
    origin,
  });
  return `${YOUTUBE_EMBED_BASE}${encodeURIComponent(videoId)}?${params.toString()}`;
}

function sendYouTubeCommand(iframe: HTMLIFrameElement | null, func: 'mute' | 'unMute') {
  if (!iframe?.contentWindow) return;
  iframe.contentWindow.postMessage(
    JSON.stringify({ event: 'command', func, args: [] }),
    'https://www.youtube.com',
  );
}

export default function TvPublicLivePage() {
  const { streamId } = useParams();
  const [searchParams] = useSearchParams();
  const inviteToken = searchParams.get('guest');
  const isGuest = Boolean(inviteToken);
  const videoRef = useRef<HTMLVideoElement>(null);
  const youtubeRef = useRef<HTMLIFrameElement>(null);
  const sessionRef = useRef<TestagramTvMediaSession | null>(null);
  const guestMediaRef = useRef<MediaStream | null>(null);
  const [title, setTitle] = useState('Testagram TV');
  const [connecting, setConnecting] = useState(true);
  const [live, setLive] = useState(false);
  const [muted, setMuted] = useState(true);
  const [cameraOn, setCameraOn] = useState(true);
  const [micOn, setMicOn] = useState(true);
  const [error, setError] = useState('');
  const [youtubeVideoId, setYoutubeVideoId] = useState<string | null>(null);
  const [youtubePlayerError, setYoutubePlayerError] = useState(false);

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
              setYoutubeVideoId(null);
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

          if (contract?.provider !== 'youtube') {
            throw new Error('Testagram TV is not configured for YouTube playback.');
          }

          const videoId = String(contract?.youtube?.video_id || '').trim();

          if (!videoId) {
            throw new Error('YouTube live video is not ready yet.');
          }

          setTitle(contract.title || 'Testagram TV');
          setYoutubeVideoId(videoId);
          setLive(true);
          setConnecting(false);
          setError('');
          retryCount = 0;
          return;
        }

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
          );

          sessionRef.current = session;
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
      connectingAttempt = false;

      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = null;

      void sessionRef.current?.close();
      sessionRef.current = null;

      setYoutubeVideoId(null);

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
    if (!youtubeVideoId || isGuest) return;
    sendYouTubeCommand(youtubeRef.current, muted ? 'mute' : 'unMute');
  }, [youtubeVideoId, muted, isGuest]);

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
    const youtube = youtubeRef.current;

    if (!youtube && !videoRef.current) return;

    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
        return;
      }

      await (youtube || videoRef.current)?.requestFullscreen();
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

  const leaveGuest = async () => {
    await sessionRef.current?.close();
    sessionRef.current = null;

    guestMediaRef.current?.getTracks().forEach((track) => track.stop());
    guestMediaRef.current = null;

    setLive(false);
    setError('You left the TV guest session.');
  };

  const youtubeOrigin =
    typeof window === 'undefined' ? '' : window.location.origin;

  const youtubeSrc = youtubeVideoId
    ? buildYouTubeEmbedUrl(youtubeVideoId, youtubeOrigin)
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
            {isGuest ? 'TV Guest' : title}
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
                sendYouTubeCommand(
                  youtubeRef.current,
                  nextMuted ? 'mute' : 'unMute',
                );
              }}
              disabled={!youtubeVideoId}
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
              disabled={!youtubeVideoId}
              aria-label="Fullscreen live TV"
            >
              <Maximize2 className="w-4 h-4" />
            </Button>
          </div>
        ) : null}
      </header>

      <main className="flex-1 flex flex-col items-center justify-center gap-3 p-3">
        <div className="w-full max-w-6xl flex items-center justify-between gap-3 text-xs text-zinc-500">
          <span>{isGuest ? 'Studio guest connection' : 'Testagram TV live player'}</span>
          {!isGuest && live ? (
            <span className="inline-flex items-center gap-1 text-red-400 font-semibold">
              <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
              LIVE
            </span>
          ) : null}
        </div>

        <div className="w-full max-w-6xl aspect-video bg-zinc-950 rounded-xl overflow-hidden border border-white/10">
          {youtubeVideoId && !isGuest ? (
            <iframe
              ref={youtubeRef}
              data-testagram-youtube-player="true"
              className="w-full h-full border-0"
              src={youtubeSrc}
              title={`${title} — Testagram TV Live`}
              allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
              allowFullScreen
              onLoad={() => {
                setYoutubePlayerError(false);
                sendYouTubeCommand(youtubeRef.current, muted ? 'mute' : 'unMute');
              }}
              onError={() => {
                setYoutubePlayerError(true);
              }}
            />
          ) : (
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-contain"
            />
          )}
        </div>

        <div className="w-full max-w-6xl min-h-10 flex items-center justify-center text-center">
          {connecting && (
            <div className="inline-flex items-center gap-2 text-sm text-zinc-400">
              <Loader2 className="w-5 h-5 animate-spin" />
              Connecting to Testagram TV…
            </div>
          )}

          {!connecting && youtubePlayerError && !isGuest && (
            <div className="flex flex-wrap items-center justify-center gap-3 text-sm text-zinc-300">
              <span>YouTube could not load the live player.</span>
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

          {!connecting && !error && !youtubePlayerError && !live && !isGuest && (
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
          : 'Live from Testagram TV · YouTube provides the live picture and audio inside the Testagram player. Finished recordings are not stored here.'}
      </footer>
    </div>
  );
}
