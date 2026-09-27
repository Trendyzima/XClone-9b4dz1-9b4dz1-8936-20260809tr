import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Room, RoomEvent, Track } from 'livekit-client';
import { Loader2, Radio, Users, Volume2, VolumeX, Share2, Maximize2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';

export default function TvPublicLivePage() {
  const { streamId } = useParams();
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const roomRef = useRef<Room | null>(null);
  const [title, setTitle] = useState('Testagram TV');
  const [viewers, setViewers] = useState(0);
  const [connecting, setConnecting] = useState(true);
  const [live, setLive] = useState(false);
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    const connect = async () => {
      if (!streamId) { setError('TV broadcast link is missing.'); setConnecting(false); return; }
      try {
        const { data: stream, error: streamError } = await supabase.from('live_streams').select('id,title,is_live').eq('id', streamId).maybeSingle();
        if (streamError || !stream || !stream.is_live) throw new Error('This TV broadcast is no longer live.');
        if (cancelled) return;
        setTitle(stream.title || 'Testagram TV');
        const { data, error: tokenError } = await supabase.functions.invoke('livekit-tv-token', { body: { stream_id: streamId, role: 'viewer' } });
        if (tokenError || !data?.data?.token || !data?.data?.url) throw new Error(data?.error?.message || tokenError?.message || 'Unable to connect to this TV broadcast.');
        const room = new Room({ adaptiveStream: true, dynacast: true });
        roomRef.current = room;
        const attach = (track: any) => {
          if (track.kind === Track.Kind.Video && videoRef.current) { track.attach(videoRef.current); void videoRef.current.play().catch(() => undefined); }
          if (track.kind === Track.Kind.Audio && audioRef.current) { track.attach(audioRef.current); audioRef.current.muted = muted; void audioRef.current.play().catch(() => undefined); }
        };
        room.on(RoomEvent.TrackSubscribed, track => attach(track));
        room.on(RoomEvent.TrackUnsubscribed, track => track.detach());
        room.on(RoomEvent.ParticipantConnected, () => setViewers(room.remoteParticipants.size));
        room.on(RoomEvent.ParticipantDisconnected, () => setViewers(room.remoteParticipants.size));
        await room.connect(data.data.url, data.data.token);
        for (const participant of room.remoteParticipants.values()) for (const publication of participant.trackPublications.values()) {
          if (!publication.isSubscribed) await publication.setSubscribed(true);
          if (publication.track) attach(publication.track);
        }
        if (cancelled) { await room.disconnect(); return; }
        setViewers(room.remoteParticipants.size); setLive(true); setConnecting(false);
      } catch (e: any) { if (!cancelled) { setError(e?.message || 'Unable to connect to TV broadcast.'); setConnecting(false); } }
    };
    void connect();
    return () => { cancelled = true; roomRef.current?.disconnect(); roomRef.current = null; };
  }, [streamId]);

  useEffect(() => { if (audioRef.current) audioRef.current.muted = muted; if (videoRef.current) videoRef.current.muted = muted; }, [muted]);
  const share = async () => { const url = window.location.href; try { if (navigator.share) await navigator.share({ title, text: `Watch ${title} live on Testagram TV`, url }); else { await navigator.clipboard.writeText(url); toast.success('TV link copied'); } } catch (e: any) { if (e?.name !== 'AbortError') { try { await navigator.clipboard.writeText(url); toast.success('TV link copied'); } catch { toast.error('Could not copy TV link'); } } } };
  const fullscreen = async () => { const el = videoRef.current; if (!el) return; try { if (document.fullscreenElement) await document.exitFullscreen(); else await el.requestFullscreen(); } catch { toast.error('Fullscreen is not available on this device.'); } };
  return <div className="min-h-screen bg-black text-white flex flex-col"><header className="flex items-center justify-between gap-3 px-4 py-3 border-b border-white/10 bg-zinc-950"><div className="min-w-0"><div className="flex items-center gap-2 font-semibold truncate"><Radio className="w-4 h-4 text-red-500" />{title}</div><div className="text-xs text-zinc-500">{live ? 'LIVE' : connecting ? 'CONNECTING…' : 'OFFLINE'} · {viewers} viewers</div></div><div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => void share()}><Share2 className="w-4 h-4 mr-1" />Share</Button><Button size="sm" variant="outline" onClick={() => setMuted(v => !v)}>{muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}</Button><Button size="sm" variant="outline" onClick={() => void fullscreen()}><Maximize2 className="w-4 h-4" /></Button></div></header><main className="flex-1 flex items-center justify-center p-3"><div className="w-full max-w-6xl aspect-video bg-zinc-950 rounded-xl overflow-hidden relative border border-white/10"><video ref={videoRef} autoPlay playsInline muted={muted} className="w-full h-full object-contain" /><audio ref={audioRef} autoPlay muted={muted} />{connecting && <div className="absolute inset-0 flex items-center justify-center bg-black/70"><Loader2 className="w-7 h-7 animate-spin" /></div>}{error && <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/80 text-center p-6"><Radio className="w-10 h-10 text-zinc-500" /><p>{error}</p><Button onClick={() => window.location.reload()}>Try again</Button></div>}{live && <div className="absolute top-3 left-3 rounded bg-red-600 px-2 py-1 text-xs font-bold flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-white animate-pulse" />LIVE</div>}{live && <div className="absolute bottom-3 left-3 rounded bg-black/60 px-2 py-1 text-xs flex items-center gap-1"><Users className="w-3 h-3" />{viewers}</div>}</div></main><footer className="px-4 py-3 text-center text-xs text-zinc-600">Live from Testagram TV · This page receives the live program stream only; finished recordings are not stored here.</footer></div>;
}
