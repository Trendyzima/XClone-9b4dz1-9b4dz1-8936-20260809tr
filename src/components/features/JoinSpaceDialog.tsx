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
  const [joined, setJoined] = useState(false);

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


  const liveKitRef = useRef<any>(null);
  useEffect(() => {
    if (!joined || !space?.is_live || !spaceId) return;
    let cancelled = false;
    let room: any = null;
    const connect = async () => {
      try {
        const { data, error } = await supabase.functions.invoke('livekit-space-token', { body: { space_id: spaceId } });
        if (error || !data?.ok || !data?.data?.token) throw error || new Error(data?.error?.message || 'Live audio connection unavailable');
        const mod = await import('livekit-client');
        room = new mod.Room({ adaptiveStream: true, dynacast: true });
        await room.connect(data.data.url, data.data.token);
        if (cancelled) { await room.disconnect(); return; }
        liveKitRef.current = room;
      } catch (e) {
        console.error('LiveKit connection failed', e);
        if (!cancelled) toast({ title: 'Audio connection unavailable', description: 'You are still joined; retrying audio is available when the room is ready.', variant: 'destructive' });
      }
    };
    void connect();
    return () => { cancelled = true; void room?.disconnect(); liveKitRef.current = null; };
  }, [joined, space?.is_live, spaceId]);

  const handleJoin = async () => {
    if (!user || !spaceId) return;
    setLoading(true);
    try {
      const { error } = await supabase.rpc('join_audio_space', { p_space_id: spaceId });
      if (error) throw error;
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

        {space && (
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
                  <Button
                    variant={role === 'listener' ? 'default' : 'outline'}
                    onClick={() => setRole('listener')}
                    className="flex-1"
                  >
                    <Users className="w-4 h-4 mr-2" />
                    Listen
                  </Button>
                  <Button
                    variant={role === 'speaker' ? 'default' : 'outline'}
                    onClick={() => setRole('speaker')}
                    className="flex-1"
                  >
                    <Mic className="w-4 h-4 mr-2" />
                    Speak
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
                  </div>
                </div>

                {/* Live Audio Broadcasting (Host Only) */}
                {space.host?.id === user?.id && (
                  <LiveAudioBroadcaster
                    spaceId={spaceId!}
                    isHost={space.host?.id === user?.id}
                  />
                )}

                {/* Live Audio Player (All Participants) */}
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
        )}
      </DialogContent>
    </Dialog>
  );
}
