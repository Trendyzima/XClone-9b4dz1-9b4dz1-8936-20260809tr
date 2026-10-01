import { useState, useEffect, useRef } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { Radio, Mic, MicOff, Users, X, Loader2, Headphones } from 'lucide-react';
import { formatNumber } from '@/lib/utils';
import { LiveAudioBroadcaster } from './LiveAudioBroadcaster';
import { LiveAudioPlayer } from './LiveAudioPlayer';
import { SpaceRecordingsPlaylist } from './SpaceRecordingsPlaylist';
import { TestagramMediaSession } from '@/lib/testagramMedia';

interface JoinSpaceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  spaceId: string | null;
}

export function JoinSpaceDialog({ open, onOpenChange, spaceId }: JoinSpaceDialogProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [space, setSpace] = useState<any>(null);
  const [isMuted, setIsMuted] = useState(true);
  const [role, setRole] = useState<'listener' | 'speaker'>('listener');
  const [speakerRequestStatus, setSpeakerRequestStatus] = useState<'none' | 'pending' | 'approved' | 'denied'>('none');
  const [joined, setJoined] = useState(false);
  const [liveConnected, setLiveConnected] = useState(false);

  useEffect(() => {
    if (spaceId && open) {
      fetchSpace();
    }
  }, [spaceId, open]);

  const fetchSpace = async () => {
    if (!spaceId) return;

    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('spaces')
        .select(`
          *,
          host:user_profiles!spaces_host_id_fkey(*)
        `)
        .eq('id', spaceId)
        .single();

      if (error) throw error;
      setSpace(data);
    } catch (error: any) {
      console.error('Error fetching space:', error);
      toast({
        title: 'Error',
        description: 'Failed to load space',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };
  const mediaSessionRef = useRef<TestagramMediaSession | null>(null);
  const localMediaStreamRef = useRef<MediaStream | null>(null);
  const liveAudioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (!joined || !space?.is_live || !spaceId || !user || space.host?.id === user.id) return;
    let cancelled = false;
    setLiveConnected(false);
    const connect = async () => {
      try {
        let local: MediaStream | undefined;
        if (role === 'speaker') {
          local = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
          });
          localMediaStreamRef.current = local;
          local.getAudioTracks().forEach(track => { track.enabled = !isMuted; });
        }
        const session = await TestagramMediaSession.connectSpace(spaceId, role, local, remote => {
          setLiveConnected(true);
          if (!liveAudioRef.current) return;
          liveAudioRef.current.srcObject = remote;
          liveAudioRef.current.muted = false;
          void liveAudioRef.current.play().catch(() => undefined);
        });
        if (cancelled) {
          await session.close();
          local?.getTracks().forEach(track => track.stop());
          return;
        }
        mediaSessionRef.current = session;
      } catch (e) {
        if (!cancelled) toast({ title: 'Audio connection unavailable', description: e instanceof Error ? e.message : 'Native media connection failed.', variant: 'destructive' });
      }
    };
    void connect();
    return () => {
      cancelled = true;
      void mediaSessionRef.current?.close();
      mediaSessionRef.current = null;
      setLiveConnected(false);
      localMediaStreamRef.current?.getTracks().forEach(track => track.stop());
      localMediaStreamRef.current = null;
      if (liveAudioRef.current) liveAudioRef.current.srcObject = null;
    };
  }, [joined, space?.is_live, spaceId, role, user?.id, space?.host?.id]);

  useEffect(() => {
    if (!joined || !spaceId || !user || space.host?.id === user.id) return;
    let cancelled = false;
    const syncRole = async () => {
      const [{ data: participant }, { data: request }] = await Promise.all([
        supabase.from('space_participants').select('role').eq('space_id', spaceId).eq('user_id', user.id).is('left_at', null).maybeSingle(),
        supabase.from('audio_space_speaker_requests').select('status').eq('space_id', spaceId).eq('user_id', user.id).maybeSingle(),
      ]);
      if (cancelled) return;
      if (participant?.role === 'speaker') setRole('speaker');
      setSpeakerRequestStatus((request?.status as any) || 'none');
    };
    void syncRole();
    const timer = window.setInterval(() => void syncRole(), 2500);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [joined, spaceId, user?.id, space?.host?.id]);

  useEffect(() => {
    localMediaStreamRef.current?.getAudioTracks().forEach(track => { track.enabled = !isMuted; });
  }, [isMuted]);

  const handleJoin = async () => {
    if (!user || !spaceId) return;
    setLoading(true);
    try {
      const { error } = await supabase.rpc('join_audio_space', { p_space_id: spaceId });
      if (error) throw error;
      setRole('listener');
      setSpeakerRequestStatus('none');
      setJoined(true);
      toast({ title: 'Joined Space', description: `You're now ${role === 'listener' ? 'listening to' : 'speaking in'} this Space` });
      await fetchSpace();
    } catch (error: any) {
      console.error('Error joining space:', error);
      toast({ title: 'Error', description: error.message || 'Failed to join space', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const handleLeave = async () => {
    if (!user || !spaceId) return;
    try {
      const { error } = await supabase.rpc('leave_audio_space', { p_space_id: spaceId });
      if (error) throw error;
      setJoined(false);
      onOpenChange(false);
      toast({ title: 'Left Space', description: 'You have left the audio space' });
    } catch (error: any) {
      console.error('Error leaving space:', error);
      toast({ title: 'Error', description: error.message || 'Failed to leave space', variant: 'destructive' });
    }
  };

  if (loading && !space) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-lg">
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
              <span>LIVE</span>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onOpenChange(false)}
              className="h-8 w-8"
            >
              <X className="w-4 h-4" />
            </Button>
          </DialogTitle>
        </DialogHeader>

        {space && (<>
          <audio ref={liveAudioRef} autoPlay playsInline className="hidden" />
          <div className="space-y-6">
            <div>
              <h2 className="text-2xl font-bold mb-2">{space.title}</h2>
              {space.description && (
                <p className="text-muted-foreground">{space.description}</p>
              )}
            </div>

            <div className="flex items-center justify-between p-4 bg-muted/50 rounded-lg">
              <div className="flex items-center space-x-3">
                <div className="w-12 h-12 rounded-full bg-background overflow-hidden">
                  {space.host?.avatar_url ? (
                    <img
                      src={space.host.avatar_url}
                      alt={space.host.username}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center font-bold text-lg">
                      {space.host?.username[0]?.toUpperCase()}
                    </div>
                  )}
                </div>
                <div>
                  <p className="font-semibold">{space.host?.username}</p>
                  <p className="text-sm text-muted-foreground">Host</p>
                </div>
              </div>
              <div className="flex items-center space-x-1 text-muted-foreground">
                <Users className="w-4 h-4" />
                <span className="text-sm">{formatNumber(space.listener_count)}</span>
              </div>
            </div>

            {!joined ? (
              <div className="space-y-4">
                <div className="flex items-center space-x-2">
                  <Button variant="default" className="flex-1" disabled>
                    <Users className="w-4 h-4 mr-2" />
                    Listen
                  </Button>
                  <Button
                    variant="outline"
                    className="flex-1"
                    onClick={async () => {
                      if (!joined) {
                        await handleJoin();
                        return;
                      }
                      const { error } = await supabase.rpc('request_audio_space_speaker', { p_space_id: spaceId });
                      if (error) {
                        toast({ title: 'Speaker request failed', description: error.message, variant: 'destructive' });
                        return;
                      }
                      setSpeakerRequestStatus('pending');
                      toast({ title: 'Request sent', description: 'The host will decide whether to bring you on stage.' });
                    }}
                  >
                    <Mic className="w-4 h-4 mr-2" />
                    Request to speak
                  </Button>
                </div>

                <Button onClick={handleJoin} className="w-full" size="lg" disabled={loading}>
                  {loading ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Joining...
                    </>
                  ) : (
                    <>
                      <Radio className="w-4 h-4 mr-2" />
                      Join Space
                    </>
                  )}
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center justify-center p-8 bg-muted/50 rounded-lg">
                  <div className="text-center">
                    <div className="w-16 h-16 rounded-full bg-primary/20 flex items-center justify-center mx-auto mb-4">
                      {isMuted ? (
                        <MicOff className="w-8 h-8 text-primary" />
                      ) : (
                        <Mic className="w-8 h-8 text-primary animate-pulse" />
                      )}
                    </div>
                    <p className="font-semibold mb-1">
                      {role === 'listener' ? 'Listening' : isMuted ? 'Muted' : 'Speaking'}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      You're in this Space as a {role}
                    </p>
                    {role === 'listener' && speakerRequestStatus !== 'approved' && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="mt-3"
                        disabled={speakerRequestStatus === 'pending'}
                        onClick={async () => {
                          const { error } = await supabase.rpc('request_audio_space_speaker', { p_space_id: spaceId });
                          if (error) {
                            toast({ title: 'Speaker request failed', description: error.message, variant: 'destructive' });
                            return;
                          }
                          setSpeakerRequestStatus('pending');
                          toast({ title: 'Request sent', description: 'Waiting for the host.' });
                        }}
                      >
                        <Mic className="w-4 h-4 mr-2" />
                        {speakerRequestStatus === 'pending' ? 'Speaker request pending' : 'Request to speak'}
                      </Button>
                    )}
                  </div>
                </div>

                {/* Live Audio Broadcasting (Host Only) */}
                {space.host?.id === user?.id && (
                  <LiveAudioBroadcaster
                    spaceId={spaceId!}
                    isHost={space.host?.id === user?.id}
                  />
                )}

                <div className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs ${liveConnected ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400' : 'border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-400'}`}>
                  <span className={`w-2 h-2 rounded-full ${liveConnected ? 'bg-emerald-500' : 'bg-amber-500 animate-pulse'}`} />
                  <span className="font-semibold">{liveConnected ? 'Live audio connected' : 'Connecting to live audio…'}</span>
                  <span className="ml-auto text-muted-foreground">Testagram native transport</span>
                </div>

                {/* Replay is deliberately separate from the live transport. */}
                <LiveAudioPlayer
                  spaceId={spaceId!}
                  isLive={space.is_live}
                />

                {/* Recordings Playlist */}
                <div className="border border-border rounded-lg p-4 bg-background">
                  <SpaceRecordingsPlaylist spaceId={spaceId!} />
                </div>

                <div className="flex items-center space-x-2">
                  {role === 'speaker' && (
                    <Button
                      variant="outline"
                      onClick={() => setIsMuted(!isMuted)}
                      className="flex-1"
                    >
                      {isMuted ? (
                        <>
                          <Mic className="w-4 h-4 mr-2" />
                          Unmute
                        </>
                      ) : (
                        <>
                          <MicOff className="w-4 h-4 mr-2" />
                          Mute
                        </>
                      )}
                    </Button>
                  )}
                  <Button
                    variant="destructive"
                    onClick={handleLeave}
                    className="flex-1"
                  >
                    Leave Space
                  </Button>
                </div>

                <p className="text-xs text-center text-muted-foreground">
                  💡 Tip: Recordings are saved automatically and can be played back anytime
                </p>
              </div>
            )}
          </div>
        </>)}
      </DialogContent>
    </Dialog>
  );
}
