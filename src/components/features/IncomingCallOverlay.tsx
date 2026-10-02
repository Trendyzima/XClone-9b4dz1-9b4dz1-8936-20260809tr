import { useEffect, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import { Phone, PhoneCall, PhoneOff, ShieldCheck, Video } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import { communicationService } from '@/services/communicationService';

type IncomingCall = {
  callId: string;
  conversationId: string;
  kind: 'voice' | 'video';
  callerId: string;
  name: string;
  username?: string | null;
  avatarUrl?: string | null;
  phone?: string | null;
  phoneVerified: boolean;
};

function playRingTone(contextRef: MutableRefObject<AudioContext | null>) {
  try {
    const AudioContextCtor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) return;
    const context = contextRef.current ?? new AudioContextCtor();
    contextRef.current = context;
    if (context.state === 'suspended') void context.resume().catch(() => undefined);
    const now = context.currentTime;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(880, now);
    oscillator.frequency.setValueAtTime(660, now + 0.18);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.18, now + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.42);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.45);
  } catch {
    // Browser autoplay policies may block synthesized audio until the user interacts.
  }
}

export function IncomingCallOverlay() {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [incoming, setIncoming] = useState<IncomingCall | null>(null);
  const [busy, setBusy] = useState(false);
  const audioContextRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    if (!user) {
      setIncoming(null);
      return;
    }

    const channel = supabase
      .channel('incoming-calls:' + user.id, { config: { private: true, broadcast: { self: false } } })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'calls' }, payload => {
        const row = payload.new as Record<string, unknown>;
        if (String(row.created_by ?? '') === user.id || String(row.status ?? '') !== 'ringing') return;
        const metadata = row.metadata && typeof row.metadata === 'object'
          ? row.metadata as Record<string, unknown>
          : {};
        const conversationId = String(row.conversation_id ?? '');
        const callId = String(row.id ?? row.call_id ?? '');
        if (!conversationId || !callId) return;
        const kind = row.kind === 'voice' ? 'voice' : 'video';
        setIncoming({
          callId,
          conversationId,
          kind,
          callerId: String(row.created_by ?? ''),
          name: String(metadata.caller_display_name ?? 'Testagram user'),
          username: metadata.caller_username ? String(metadata.caller_username) : null,
          avatarUrl: metadata.caller_avatar_url ? String(metadata.caller_avatar_url) : null,
          phone: metadata.caller_phone ? String(metadata.caller_phone) : null,
          phoneVerified: metadata.caller_phone_verified === true && Boolean(metadata.caller_phone),
        });
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'calls' }, payload => {
        const row = payload.new as Record<string, unknown>;
        const callId = String(row.id ?? row.call_id ?? '');
        if (incoming?.callId === callId && String(row.status ?? '') !== 'ringing') setIncoming(null);
      })
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [user?.id, incoming?.callId]);

  useEffect(() => {
    if (!incoming || location.pathname.startsWith('/call/')) return;
    playRingTone(audioContextRef);
    const ringTimer = window.setInterval(() => playRingTone(audioContextRef), 1700);
    const vibrationTimer = window.setInterval(() => {
      try { navigator.vibrate?.([500, 250, 500]); } catch {}
    }, 1700);
    return () => {
      window.clearInterval(ringTimer);
      window.clearInterval(vibrationTimer);
      try { navigator.vibrate?.(0); } catch {}
    };
  }, [incoming?.callId, location.pathname]);

  const decline = async () => {
    if (!incoming || busy) return;
    setBusy(true);
    try { await communicationService.endCall(incoming.callId); } catch {}
    setIncoming(null);
    setBusy(false);
  };

  const accept = () => {
    if (!incoming || busy) return;
    setBusy(true);
    const call = incoming;
    setIncoming(null);
    navigate('/call/' + encodeURIComponent(call.callId)
      + '?kind=' + call.kind
      + '&conversation=' + encodeURIComponent(call.conversationId)
      + '&initiator=0');
  };

  if (!incoming || location.pathname.startsWith('/call/')) return null;

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Incoming call">
      <div className="w-full max-w-sm overflow-hidden rounded-[2rem] border border-white/10 bg-background shadow-2xl">
        <div className="relative px-6 pb-7 pt-10 text-center">
          <div className="absolute inset-x-0 top-0 h-28 bg-primary/10" />
          <div className="relative mx-auto flex h-24 w-24 items-center justify-center overflow-hidden rounded-full border-4 border-background bg-primary/10 text-3xl font-black text-primary shadow-xl ring-4 ring-primary/20">
            {incoming.avatarUrl ? <img src={incoming.avatarUrl} alt="" className="h-full w-full object-cover" /> : incoming.name.slice(0, 1).toUpperCase()}
          </div>
          <div className="mt-5 flex items-center justify-center gap-2 text-xs font-semibold uppercase tracking-wider text-primary">
            <PhoneCall className="h-4 w-4 animate-pulse" />
            Incoming {incoming.kind} call
          </div>
          <h2 className="mt-2 text-2xl font-black">{incoming.name}</h2>
          {incoming.phoneVerified ? (
            <div className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1.5 text-sm font-semibold text-primary">
              <ShieldCheck className="h-4 w-4" />
              <span>{incoming.phone}</span>
            </div>
          ) : (
            <p className="mt-1 text-sm text-muted-foreground">{incoming.username ? '@' + incoming.username : 'Testagram user'}</p>
          )}
          <p className="mt-4 text-xs text-muted-foreground">Verified mobile numbers are shown only when the number is verified by Testagram Auth.</p>
        </div>

        <div className="grid grid-cols-2 gap-3 border-t p-5">
          <button onClick={() => void decline()} disabled={busy} className="flex items-center justify-center gap-2 rounded-full bg-destructive px-5 py-3.5 font-bold text-destructive-foreground shadow-lg disabled:opacity-50">
            <PhoneOff className="h-5 w-5" />
            Decline
          </button>
          <button onClick={accept} disabled={busy} className="flex items-center justify-center gap-2 rounded-full bg-emerald-600 px-5 py-3.5 font-bold text-white shadow-lg disabled:opacity-50">
            {incoming.kind === 'video' ? <Video className="h-5 w-5" /> : <Phone className="h-5 w-5" />}
            Accept
          </button>
        </div>
      </div>
    </div>
  );
}
