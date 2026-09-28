import { useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { Loader2, Radio, Users, Volume2, VolumeX, Share2, Maximize2, Camera, CameraOff, Mic, MicOff, PhoneOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/supabase';
import { TestagramMediaSession } from '@/lib/testagramMedia';
import { toast } from 'sonner';
import Hls from 'hls.js';

export default function TvPublicLivePage() {
  const { streamId } = useParams();
  const [searchParams] = useSearchParams();
  const inviteToken = searchParams.get('guest');
  const isGuest = Boolean(inviteToken);
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const sessionRef = useRef<TestagramMediaSession | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const guestMediaRef = useRef<MediaStream | null>(null);
  const [title, setTitle] = useState('Testagram TV');
  const [viewers, setViewers] = useState(0);
  const [connecting, setConnecting] = useState(true);
  const [live, setLive] = useState(false);
  const [muted, setMuted] = useState(false);
  const [cameraOn, setCameraOn] = useState(true);
  const [micOn, setMicOn] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    const connect = async () => {
      if (!streamId) { setError('TV broadcast link is missing.'); setConnecting(false); return; }
      try {
        if (isGuest && inviteToken) {
          const { data: stream, error: streamError } = await supabase
            .from('live_streams')
            .select('id,title,is_live')
            .eq('id', streamId)
            .maybeSingle();
          if (streamError || !stream || !stream.is_live) throw new Error('This TV broadcast is no longer live.');
          if (cancelled) return;
          setTitle(stream.title || 'Testagram TV');
          const session = await TestagramMediaSession.connectGuest(streamId, inviteToken);
          sessionRef.current = session;
          const media = await navigator.mediaDevices.getUserMedia({
            video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 } },
            audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
          });
          guestMediaRef.current = media;
          if (videoRef.current) {
            videoRef.current.srcObject = media;
            videoRef.current.muted = true;
            videoRef.current.playsInline = true;
            void videoRef.current.play().catch(() => undefined);
          }
          await session.publishTracks(media);
        } else {
          // Public TV playback is Mux HLS. WebRTC/Cloudflare is intentionally
          // reserved for studio ingest; viewers must never join the ingest path.
          const session = await TestagramMediaSession.connectViewer(streamId, () => undefined);
          const playbackUrl = session.getPlaybackUrl();
          if (!playbackUrl) throw new Error('Mux playback URL is missing [STREAM_PLAYBACK_NOT_READY].');
          sessionRef.current = session;
          setTitle(session.getTitle() || 'Testagram TV');
          setViewers(session.getViewerCount());
          const video = videoRef.current;
          if (!video) throw new Error('TV player element is unavailable [PLAYER_NOT_READY].');
          video.muted = true;
          video.playsInline = true;
          video.autoplay = true;

          const play = () => void video.play().catch((e: any) => {
            if (e?.name !== 'NotAllowedError') throw new Error('Mux HLS playback could not start [PLAYBACK_START_FAILED].');
          });

          if (video.canPlayType('application/vnd.apple.mpegurl')) {
            video.src = playbackUrl;
            video.addEventListener('loadedmetadata', play, { once: true });
            video.addEventListener('error', () => { if (!cancelled) { setError('Mux HLS manifest could not be loaded [PLAYBACK_MANIFEST_FAILED].'); setConnecting(false); } }, { once: true });
          } else if (Hls.isSupported()) {
            const hls = new Hls({
              enableWorker: true,
              lowLatencyMode: true,
              backBufferLength: 6,
              maxBufferLength: 18,
              liveSyncDurationCount: 4,
              liveMaxLatencyDurationCount: 9,
              manifestLoadingMaxRetry: 4,
              levelLoadingMaxRetry: 5,
              fragLoadingMaxRetry: 5,
            });
            hlsRef.current = hls;
            hls.loadSource(playbackUrl);
            hls.attachMedia(video);
            hls.on(Hls.Events.MANIFEST_PARSED, play);
            hls.on(Hls.Events.ERROR, (_event, data) => {
              if (!data.fatal) return;
              if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
                try { hls.recoverMediaError(); return; } catch {}
              }
              setError('Mux HLS playback failed [PLAYBACK_FAILED].');
              setConnecting(false);
            });
          } else {
            throw new Error('This browser does not support HLS playback [HLS_UNSUPPORTED].');
          }
        }

        if (cancelled) {
          await sessionRef.current?.close();
          sessionRef.current = null;
          return;
        }
        setLive(true);
        setConnecting(false);
      } catch (e: any) {
        if (!cancelled) {
          setError(e?.message || (isGuest ? 'Unable to join the guest session.' : 'Unable to connect to TV broadcast.'));
          setConnecting(false);
        }
      }
    };
    void connect();
    return () => {
      cancelled = true;
      hlsRef.current?.destroy();
      hlsRef.current = null;
      void sessionRef.current?.close();
      sessionRef.current = null;
      guestMediaRef.current?.getTracks().forEach(track => track.stop());
      guestMediaRef.current = null;
    };
  }, [streamId, inviteToken, isGuest]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.muted = muted;
    if (videoRef.current && !isGuest) videoRef.current.muted = muted;
  }, [muted, isGuest]);

  const share = async () => {
    const url = window.location.origin + window.location.pathname;
    try {
      if (navigator.share) await navigator.share({ title, text: `Watch ${title} live on Testagram TV`, url });
      else { await navigator.clipboard.writeText(url); toast.success('TV link copied'); }
    } catch (e: any) {
      if (e?.name !== 'AbortError') {
        try { await navigator.clipboard.writeText(url); toast.success('TV link copied'); } catch { toast.error('Could not copy TV link'); }
      }
    }
  };

  const fullscreen = async () => {
    const el = videoRef.current;
    if (!el) return;
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await el.requestFullscreen();
    } catch { toast.error('Fullscreen is not available on this device.'); }
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
    guestMediaRef.current?.getTracks().forEach(track => track.stop());
    guestMediaRef.current = null;
    setLive(false);
    setError('You left the TV guest session.');
  };

  return <div className="min-h-screen bg-black text-white flex flex-col">
    <header className="flex items-center justify-between gap-3 px-4 py-3 border-b border-white/10 bg-zinc-950">
      <div className="min-w-0">
        <div className="flex items-center gap-2 font-semibold truncate"><Radio className="w-4 h-4 text-red-500" />{isGuest ? 'TV Guest' : title}</div>
        <div className="text-xs text-zinc-500">{isGuest ? (live ? 'CONNECTED TO STUDIO' : connecting ? 'CONNECTING…' : 'GUEST OFFLINE') : (live ? 'LIVE' : connecting ? 'CONNECTING…' : 'OFFLINE')}{!isGuest && viewers > 0 && ` · ${viewers} connection`}</div>
      </div>
      {!isGuest ? <div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => void share()}><Share2 className="w-4 h-4 mr-1" />Share</Button><Button size="sm" variant="outline" onClick={() => setMuted(v => !v)}>{muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}</Button><Button size="sm" variant="outline" onClick={() => void fullscreen()}><Maximize2 className="w-4 h-4" /></Button></div> : null}
    </header>
    <main className="flex-1 flex items-center justify-center p-3">
      <div className="w-full max-w-6xl aspect-video bg-zinc-950 rounded-xl overflow-hidden relative border border-white/10">
        <video ref={videoRef} autoPlay playsInline muted={isGuest ? true : muted} className="w-full h-full object-contain" />
        <audio ref={audioRef} autoPlay muted={muted} />
        {connecting && <div className="absolute inset-0 flex items-center justify-center bg-black/70"><Loader2 className="w-7 h-7 animate-spin" /></div>}
        {error && <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/80 text-center p-6"><Radio className="w-10 h-10 text-zinc-500" /><p>{error}</p><Button onClick={() => window.location.reload()}>Try again</Button></div>}
        {live && <div className="absolute top-3 left-3 rounded bg-red-600 px-2 py-1 text-xs font-bold flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-white animate-pulse" />{isGuest ? 'GUEST LIVE' : 'LIVE'}</div>}
        {!isGuest && live && <div className="absolute bottom-3 left-3 rounded bg-black/60 px-2 py-1 text-xs flex items-center gap-1"><Users className="w-3 h-3" />{viewers}</div>}
      </div>
    </main>
    {isGuest && <div className="p-3 flex flex-wrap justify-center gap-2 border-t border-white/10 bg-zinc-950">
      <Button disabled={!live} variant={cameraOn ? 'default' : 'destructive'} onClick={toggleCamera}>{cameraOn ? <Camera className="w-4 h-4 mr-1" /> : <CameraOff className="w-4 h-4 mr-1" />}{cameraOn ? 'Camera on' : 'Camera off'}</Button>
      <Button disabled={!live} variant={micOn ? 'default' : 'destructive'} onClick={toggleMic}>{micOn ? <Mic className="w-4 h-4 mr-1" /> : <MicOff className="w-4 h-4 mr-1" />}{micOn ? 'Mic on' : 'Mic off'}</Button>
      <Button disabled={!live} variant="destructive" onClick={() => void leaveGuest()}><PhoneOff className="w-4 h-4 mr-1" />Leave studio</Button>
    </div>}
    <footer className="px-4 py-3 text-center text-xs text-zinc-600">{isGuest ? 'Guest media is transmitted live to the Testagram TV studio. No finished recording is uploaded from this page.' : 'Live from Testagram TV · This page receives the live program stream only; finished recordings are not stored here.'}</footer>
  </div>;
}
