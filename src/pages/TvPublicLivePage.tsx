import { useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { Loader2, Radio, Users, Volume2, VolumeX, Share2, Maximize2, Camera, CameraOff, Mic, MicOff, PhoneOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/supabase';
import { TestagramTvMediaSession } from '@/lib/testagramTvMedia';
import { toast } from 'sonner';

export default function TvPublicLivePage() {
  const { streamId } = useParams();
  const [searchParams] = useSearchParams();
  const inviteToken = searchParams.get('guest');
  const isGuest = Boolean(inviteToken);
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const sessionRef = useRef<TestagramTvMediaSession | null>(null);
  const guestMediaRef = useRef<MediaStream | null>(null);
  const [title, setTitle] = useState('Testagram TV');
  const [viewers, setViewers] = useState(0);
  const [connecting, setConnecting] = useState(true);
  const [live, setLive] = useState(false);
  const [muted, setMuted] = useState(true);
  const [cameraOn, setCameraOn] = useState(true);
  const [micOn, setMicOn] = useState(true);
  const [error, setError] = useState('');
  const [provider, setProvider] = useState<'native-p2p' | 'youtube'>('native-p2p');
  const [youtubePlaybackUrl, setYoutubePlaybackUrl] = useState<string | null>(null);
  const recoveryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let connectingAttempt = false;

    const sleepRetry = (ms: number) => {
      if (cancelled) return;
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = setTimeout(() => { void connect(); }, ms);
    };

    const connect = async () => {
      if (cancelled || connectingAttempt || !streamId) return;
      connectingAttempt = true;
      setConnecting(true);
      setError('');
      try {
        if (!isGuest) {
          // Authenticate the viewer before the control-plane lookup. The TV
          // Edge Function requires a JWT, and anonymous auth keeps public
          // viewers frictionless while giving Realtime a valid private-channel token.
          let { data: authData } = await supabase.auth.getSession();
          if (!authData.session) {
            const { data: anonymous, error: authError } = await supabase.auth.signInAnonymously();
            if (authError || !anonymous.session) throw new Error('TV viewer authorization is unavailable.');
            authData = { session: anonymous.session };
          }
          if (authData.session?.access_token) {
            await supabase.realtime.setAuth(authData.session.access_token);
          }

          const viewerResponse = await fetch('/api/live', {
            method: 'POST',
            cache: 'no-store',
            headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache', ...(authData.session?.access_token ? { Authorization: `Bearer ${authData.session.access_token}` } : {}) },
            body: JSON.stringify({ action: 'viewer', stream_id: streamId }),
          });
          const viewerPayload = await viewerResponse.json().catch(() => null);

          // The page may be open before the producer goes live. Treat that as
          // a normal waiting state and retry automatically instead of failing.
          if (!viewerResponse.ok) {
            const code = viewerPayload?.error?.code;
            if (code === 'STREAM_ENDED' || code === 'STREAM_NOT_FOUND') {
              setLive(false);
              setConnecting(true);
              sleepRetry(1000);
              return;
            }
            throw new Error(viewerPayload?.error?.message || 'TV broadcast is unavailable.');
          }

          const contract = viewerPayload?.data;
          if (contract?.provider === 'youtube' && contract?.playback_url) {
            setProvider('youtube');
            setYoutubePlaybackUrl(contract.playback_url);
            setTitle(contract.title || 'Testagram TV');
            setLive(true);
            setConnecting(false);
            return;
          }
        }

        if (isGuest && inviteToken) {
          const { data: stream, error: streamError } = await supabase
            .from('live_streams')
            .select('id,title,is_live')
            .eq('id', streamId)
            .maybeSingle();
          if (streamError || !stream || !stream.is_live) throw new Error('This TV broadcast is no longer live.');
          if (cancelled) return;
          setTitle(stream.title || 'Testagram TV');
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
          const session = await TestagramTvMediaSession.connectGuest(streamId, inviteToken, media);
          sessionRef.current = session;
          setLive(true);
          setConnecting(false);
        } else {
          const session = await TestagramTvMediaSession.connectViewer(streamId, (media) => {
            if (videoRef.current) {
              const video = videoRef.current;
              video.srcObject = media;
              video.muted = true;
              video.defaultMuted = true;
              video.playsInline = true;
              video.autoplay = true;
              video.preload = 'auto';
              const play = () => void video.play().catch(() => undefined);
              video.addEventListener('loadedmetadata', play, { once: true });
              video.addEventListener('canplay', play, { once: true });
              play();
            }
          });

          sessionRef.current = session;
          session.setViewerCountHandler((count) => setViewers(count));

          const video = videoRef.current;
          if (video) {
            const recover = () => {
              if (recoveryTimerRef.current) clearTimeout(recoveryTimerRef.current);
              recoveryTimerRef.current = setTimeout(() => void session.requestReconnect(), 1200);
            };
            video.addEventListener('waiting', recover);
            video.addEventListener('stalled', recover);
            video.addEventListener('emptied', recover);
          }

          // Do not call the stream "LIVE" merely because signaling succeeded.
          // waitForMediaReady requires real inbound RTP packets from the producer.
          await session.waitForMediaReady('receive', 15000);
          if (cancelled) return;

          setLive(true);
          setConnecting(false);
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
          setLive(false);
          setError('');
          // A transient ICE/signaling race is recoverable. Tear down the failed
          // session and immediately establish a fresh viewer peer.
          await sessionRef.current?.close().catch(() => undefined);
          sessionRef.current = null;
          sleepRetry(750);
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
      if (recoveryTimerRef.current) clearTimeout(recoveryTimerRef.current);
      recoveryTimerRef.current = null;
      const video = videoRef.current;
      if (video) {
        video.pause();
        video.removeAttribute('src');
        video.srcObject = null;
      }
      guestMediaRef.current?.getTracks().forEach(track => track.stop());
      guestMediaRef.current = null;
    };
  }, [streamId, inviteToken, isGuest]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.muted = muted;
    if (videoRef.current && !isGuest) {
      videoRef.current.muted = muted;
      if (!muted) void videoRef.current.play().catch(() => undefined);
    }
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
        {provider === 'youtube' && youtubePlaybackUrl ? <iframe
          title="Testagram TV Live"
          src={youtubePlaybackUrl}
          className="w-full h-full border-0"
          allow="autoplay; encrypted-media; picture-in-picture"
          allowFullScreen
        /> : <video ref={videoRef} autoPlay playsInline muted={isGuest ? true : muted} className="w-full h-full object-contain" />}
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
