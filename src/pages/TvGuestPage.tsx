import { useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { Room, RoomEvent } from 'livekit-client';
import { Camera, CameraOff, Loader2, Mic, MicOff, Radio, PhoneOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';

export default function TvGuestPage() {
  const { streamId } = useParams();
  const [params] = useSearchParams();
  const roomRef = useRef<Room | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [connecting, setConnecting] = useState(true);
  const [connected, setConnected] = useState(false);
  const [cameraOn, setCameraOn] = useState(true);
  const [micOn, setMicOn] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    const connect = async () => {
      const invite = params.get('invite');
      if (!streamId || !invite) {
        setError('This guest invitation is missing or incomplete.');
        setConnecting(false);
        return;
      }
      try {
        const { data, error: tokenError } = await supabase.functions.invoke('livekit-tv-token', {
          body: { stream_id: streamId, role: 'guest', invite_token: invite },
        });
        if (tokenError || !data?.data?.token || !data?.data?.url) {
          throw new Error(data?.error?.message || tokenError?.message || 'This guest invitation is invalid or expired.');
        }
        const room = new Room({ adaptiveStream: true, dynacast: true });
        roomRef.current = room;
        room.on(RoomEvent.Disconnected, () => {
          if (!cancelled) { setConnected(false); setConnecting(false); }
        });
        await room.connect(data.data.url, data.data.token);
        await room.localParticipant.enableCameraAndMicrophone();
        if (cancelled) { await room.disconnect(); return; }
        const cameraPub = room.localParticipant.getTrackPublicationByName?.('camera');
        const cameraTrack = cameraPub?.track;
        if (cameraTrack && videoRef.current) {
          cameraTrack.attach(videoRef.current);
          void videoRef.current.play().catch(() => undefined);
        }
        setConnected(true);
        setConnecting(false);
      } catch (e: any) {
        if (!cancelled) {
          setError(e?.message || 'Could not join the TV guest session.');
          setConnecting(false);
        }
      }
    };
    void connect();
    return () => { cancelled = true; roomRef.current?.disconnect(); roomRef.current = null; };
  }, [streamId, params]);

  const toggleCamera = async () => {
    const room = roomRef.current;
    if (!room) return;
    const next = !cameraOn;
    await room.localParticipant.setCameraEnabled(next);
    setCameraOn(next);
  };

  const toggleMic = async () => {
    const room = roomRef.current;
    if (!room) return;
    const next = !micOn;
    await room.localParticipant.setMicrophoneEnabled(next);
    setMicOn(next);
  };

  const leave = async () => {
    await roomRef.current?.disconnect();
    roomRef.current = null;
    setConnected(false);
    toast.success('You left the TV guest session.');
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-white flex items-center justify-center p-4">
      <div className="w-full max-w-3xl rounded-2xl border border-white/10 bg-zinc-900 overflow-hidden shadow-2xl">
        <header className="p-4 border-b border-white/10 flex items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 font-semibold"><Radio className="w-4 h-4 text-red-500" />Testagram TV Guest</div>
            <p className="text-xs text-zinc-500 mt-1">{connected ? 'You are live in the broadcaster’s guest room.' : 'Camera and microphone are private until you join.'}</p>
          </div>
          {connected && <span className="rounded-full bg-red-600 px-2 py-1 text-[10px] font-bold">CONNECTED</span>}
        </header>
        <div className="aspect-video bg-black relative">
          <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-contain" />
          {connecting && <div className="absolute inset-0 flex items-center justify-center bg-black/80"><Loader2 className="w-8 h-8 animate-spin" /></div>}
          {error && <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center bg-black/90"><Radio className="w-10 h-10 text-zinc-500" /><p>{error}</p><Button onClick={() => window.location.reload()}>Try again</Button></div>}
        </div>
        <div className="p-4 flex flex-wrap gap-2 justify-center">
          <Button disabled={!connected} variant={cameraOn ? 'default' : 'destructive'} onClick={() => void toggleCamera()}>{cameraOn ? <Camera className="w-4 h-4 mr-1" /> : <CameraOff className="w-4 h-4 mr-1" />}{cameraOn ? 'Camera on' : 'Camera off'}</Button>
          <Button disabled={!connected} variant={micOn ? 'default' : 'destructive'} onClick={() => void toggleMic()}>{micOn ? <Mic className="w-4 h-4 mr-1" /> : <MicOff className="w-4 h-4 mr-1" />}{micOn ? 'Mic on' : 'Mic off'}</Button>
          <Button disabled={!connected} variant="destructive" onClick={() => void leave()}><PhoneOff className="w-4 h-4 mr-1" />Leave studio</Button>
        </div>
        <p className="px-4 pb-4 text-center text-[11px] text-zinc-500">Your camera and microphone are sent live to the Testagram TV studio only. No finished recording is uploaded by this guest page.</p>
      </div>
    </div>
  );
}
