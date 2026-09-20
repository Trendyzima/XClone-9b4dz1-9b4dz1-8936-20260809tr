import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useNavigate } from 'react-router-dom';
import { Play, Pause, Headphones, Calendar, Clock, Loader2, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatDistanceToNow } from 'date-fns';
import { useToast } from '@/hooks/use-toast';

interface SpaceRecordingsPlaylistProps {
  spaceId: string;
}

export function SpaceRecordingsPlaylist({ spaceId }: SpaceRecordingsPlaylistProps) {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [recordings, setRecordings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [audioElement, setAudioElement] = useState<HTMLAudioElement | null>(null);

  useEffect(() => {
    fetchRecordings();
  }, [spaceId]);

  useEffect(() => {
    // Cleanup audio on unmount
    return () => {
      if (audioElement) {
        audioElement.pause();
        audioElement.src = '';
      }
    };
  }, [audioElement]);

  const fetchRecordings = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('space_recordings')
        .select(`
          *,
          user_profiles:user_id(username, avatar_url)
        `)
        .eq('space_id', spaceId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setRecordings(data || []);
    } catch (error: any) {
      console.error('Error fetching recordings:', error);
      toast({
        title: 'Error',
        description: 'Failed to load recordings',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const togglePlay = (recording: any) => {
    if (playingId === recording.id) {
      // Stop current audio
      if (audioElement) {
        audioElement.pause();
        audioElement.currentTime = 0;
      }
      setPlayingId(null);
    } else {
      // Stop previous audio if any
      if (audioElement) {
        audioElement.pause();
        audioElement.src = '';
      }

      // Create new audio element
      const audio = new Audio(recording.audio_url);
      audio.addEventListener('ended', () => {
        setPlayingId(null);
      });
      
      audio.addEventListener('error', () => {
        toast({
          title: 'Playback error',
          description: 'Failed to play recording',
          variant: 'destructive',
        });
        setPlayingId(null);
      });

      audio.play().catch((error) => {
        console.error('Error playing audio:', error);
        toast({
          title: 'Playback error',
          description: 'Failed to play recording',
          variant: 'destructive',
        });
      });

      setAudioElement(audio);
      setPlayingId(recording.id);
    }
  };

  const formatDuration = (seconds: number) => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    if (hrs > 0) {
      return `${hrs}h ${mins}m`;
    }
    return `${mins}m ${secs}s`;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  if (recordings.length === 0) {
    return (
      <div className="text-center py-8">
        <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mx-auto mb-4">
          <Headphones className="w-8 h-8 text-muted-foreground" />
        </div>
        <p className="text-muted-foreground">No recordings yet</p>
        <p className="text-sm text-muted-foreground mt-1">
          Recordings from this space will appear here
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold flex items-center">
          <Headphones className="w-4 h-4 mr-2" />
          Recordings ({recordings.length})
        </h3>
      </div>

      <div className="space-y-2">
        {recordings.map((recording) => (
          <div
            key={recording.id}
            className={`border border-border rounded-lg p-4 transition-colors ${
              playingId === recording.id ? 'bg-primary/5 border-primary' : 'bg-background hover:bg-muted/5'
            }`}
          >
            <div className="flex items-start justify-between">
              <div className="flex-1 min-w-0 mr-3">
                <div className="flex items-center space-x-2 mb-2">
                  <div className="w-8 h-8 rounded-full bg-muted overflow-hidden flex-shrink-0">
                    {recording.user_profiles?.avatar_url ? (
                      <img
                        src={recording.user_profiles.avatar_url}
                        alt={recording.user_profiles.username}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-xs font-bold">
                        {recording.user_profiles?.username[0]?.toUpperCase()}
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm truncate">
                      {recording.user_profiles?.username}
                    </p>
                  </div>
                </div>

                <div className="flex items-center space-x-3 text-xs text-muted-foreground">
                  <div className="flex items-center space-x-1">
                    <Calendar className="w-3 h-3" />
                    <span>{formatDistanceToNow(new Date(recording.created_at), { addSuffix: true })}</span>
                  </div>
                  {recording.duration > 0 && (
                    <div className="flex items-center space-x-1">
                      <Clock className="w-3 h-3" />
                      <span>{formatDuration(recording.duration)}</span>
                    </div>
                  )}
                </div>
              </div>

              <Button
                onClick={() => togglePlay(recording)}
                size="icon"
                variant={playingId === recording.id ? 'default' : 'outline'}
                className="rounded-full h-10 w-10 flex-shrink-0"
              >
                {playingId === recording.id ? (
                  <Pause className="w-5 h-5" />
                ) : (
                  <Play className="w-5 h-5" />
                )}
              </Button>
              <Button
                onClick={() => navigate(`/space-recording/${recording.id}`)}
                size="icon"
                variant="ghost"
                className="rounded-full h-10 w-10 flex-shrink-0"
                title="Open full player"
              >
                <ExternalLink className="w-4 h-4" />
              </Button>
            </div>

            {playingId === recording.id && (
              <div className="mt-3 pt-3 border-t border-border">
                <div className="flex items-center space-x-2">
                  <div className="w-2 h-2 bg-primary rounded-full animate-pulse" />
                  <span className="text-xs text-primary font-semibold">Now Playing</span>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
