import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';
import { Play, Pause, Volume2, VolumeX } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface LiveAudioPlayerProps {
  spaceId: string;
  isLive?: boolean;
}

export function LiveAudioPlayer({ spaceId, isLive = false }: LiveAudioPlayerProps) {
  const { toast } = useToast();
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(100);
  const [currentRecording, setCurrentRecording] = useState<any>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    fetchRecordings();
    if (!isLive) return;
    const interval = window.setInterval(fetchRecordings, 10000);
    return () => window.clearInterval(interval);
  }, [spaceId, isLive]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume / 100;
  }, [volume]);

  const fetchRecordings = async () => {
    try {
      const { data, error } = await supabase
        .from('space_recordings')
        .select('*')
        .eq('space_id', spaceId)
        .order('created_at', { ascending: false })
        .limit(1);
      if (error) throw error;
      if (data?.length) {
        setCurrentRecording(prev => prev ?? data[0]);
      }
    } catch (error) {
      console.error('[Audio Space] recording fetch failed', error);
    }
  };

  const togglePlayback = async () => {
    if (!audioRef.current || !currentRecording) return;
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
      return;
    }
    try {
      await audioRef.current.play();
      setIsPlaying(true);
    } catch (error) {
      console.error('[Audio Space] replay failed', error);
      toast({ title: 'Playback error', description: 'Failed to play the recording.', variant: 'destructive' });
    }
  };

  const toggleMute = () => {
    if (!audioRef.current) return;
    audioRef.current.muted = !isMuted;
    setIsMuted(!isMuted);
  };

  // Live audio is delivered by JoinSpaceDialog's native TestagramMediaSession.
  // Do not pretend the newest replay file is the live stream.
  if (isLive) {
    return (
      <div className="border border-red-500/20 rounded-lg p-4 bg-red-500/5">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-60 animate-ping" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500" />
          </span>
          <span className="text-sm font-bold">LIVE AUDIO</span>
          <span className="text-xs text-muted-foreground ml-auto">Native Testagram transport</span>
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          Live voice is delivered directly through the Space media session. Recordings appear here after they are saved.
        </p>
      </div>
    );
  }

  if (!currentRecording) {
    return (
      <div className="border border-border rounded-lg p-4 bg-muted/30 text-center">
        <p className="text-sm text-muted-foreground">No recordings available yet</p>
      </div>
    );
  }

  return (
    <div className="border border-border rounded-lg p-4 bg-background space-y-3">
      <audio
        ref={audioRef}
        src={currentRecording.audio_url}
        onEnded={() => setIsPlaying(false)}
        onError={() => toast({ title: 'Audio error', description: 'Failed to load the recording.', variant: 'destructive' })}
        className="hidden"
      />

      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <Button onClick={togglePlayback} size="icon" variant="outline" className="rounded-full h-10 w-10">
            {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
          </Button>
          <div>
            <p className="text-sm font-semibold">Replay</p>
            <p className="text-xs text-muted-foreground">Latest saved Space recording</p>
          </div>
        </div>
        <div className="flex items-center space-x-2">
          <Button onClick={toggleMute} size="icon" variant="ghost" className="h-8 w-8">
            {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          </Button>
          <input type="range" value={volume} onChange={e => setVolume(Number(e.target.value))} min="0" max="100" step="1" className="w-20 h-1 bg-muted rounded-lg appearance-none cursor-pointer accent-primary" />
        </div>
      </div>
    </div>
  );
}
