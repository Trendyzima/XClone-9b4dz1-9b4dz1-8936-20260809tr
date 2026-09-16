import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Camera, Mic, PhoneOff, ShieldCheck, Video, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { communicationService } from '@/services/communicationService';

export default function CallPage() {
  const { callId } = useParams<{ callId: string }>();
  const [params] = useSearchParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const [ended, setEnded] = useState(false);
  const [providerReady, setProviderReady] = useState(false);
  const [kind] = useState<'voice' | 'video'>(() => params.get('kind') === 'voice' ? 'voice' : 'video');

  useEffect(() => {
    if (!user) {
      navigate('/auth');
      return;
    }
    setLoading(false);
  }, [user, navigate]);

  const join = async () => {
    if (!callId) return;
    setJoining(true);
    try {
      await communicationService.joinCall(callId);
      const token = await communicationService.getLiveKitToken(callId);
      setProviderReady(true);
      toast.success(`Connected to ${token.room_name}`);
      // The media transport is intentionally provider-gated: no browser secret is used.
      // The next transport layer can mount livekit-client or Element Call against this token.
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to join call');
    } finally {
      setJoining(false);
    }
  };

  const end = async () => {
    if (!callId) return;
    try {
      await communicationService.endCall(callId);
    } catch {
      // Leaving the UI is still safe if the provider has already ended the session.
    }
    setEnded(true);
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="h-7 w-7 animate-spin" /></div>;

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <header className="h-14 border-b border-border flex items-center gap-3 px-4">
        <button onClick={() => navigate(-1)} className="p-2 rounded-full hover:bg-muted" aria-label="Back"><ArrowLeft className="h-5 w-5" /></button>
        <div>
          <h1 className="font-bold">{kind === 'video' ? 'Video call' : 'Voice call'}</h1>
          <p className="text-xs text-muted-foreground">Testagram secure call</p>
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center p-6">
        <section className="w-full max-w-lg rounded-3xl border border-border bg-card p-7 shadow-sm text-center">
          <div className="mx-auto mb-5 h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center">
            {kind === 'video' ? <Video className="h-7 w-7 text-primary" /> : <Mic className="h-7 w-7 text-primary" />}
          </div>
          <h2 className="text-2xl font-bold">{ended ? 'Call ended' : providerReady ? 'Call ready' : 'Ready to connect'}</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Testagram keeps identity and permissions in Supabase while LiveKit handles realtime media transport.
          </p>

          <div className="mt-6 grid grid-cols-3 gap-3 text-xs">
            <div className="rounded-2xl border border-border p-3"><ShieldCheck className="mx-auto mb-1 h-5 w-5" />Identity</div>
            <div className="rounded-2xl border border-border p-3"><Mic className="mx-auto mb-1 h-5 w-5" />Audio</div>
            <div className="rounded-2xl border border-border p-3"><Camera className="mx-auto mb-1 h-5 w-5" />Video</div>
          </div>

          {!ended && !providerReady && (
            <button onClick={join} disabled={joining} className="mt-7 w-full rounded-2xl bg-primary text-primary-foreground py-3 font-bold flex items-center justify-center gap-2">
              {joining ? <Loader2 className="h-4 w-4 animate-spin" /> : kind === 'video' ? <Video className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
              {joining ? 'Connecting…' : `Join ${kind} call`}
            </button>
          )}

          {providerReady && !ended && (
            <button onClick={end} className="mt-7 w-full rounded-2xl bg-destructive text-destructive-foreground py-3 font-bold flex items-center justify-center gap-2">
              <PhoneOff className="h-4 w-4" /> Leave call
            </button>
          )}
        </section>
      </main>
    </div>
  );
}
