import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Mic, Square, Loader2, Radio } from 'lucide-react';


interface LiveAudioBroadcasterProps {
  spaceId: string;
  isHost: boolean;
  onBroadcastStart?: (url: string) => void;
  onBroadcastStop?: () => void;
}

export function LiveAudioBroadcaster({ 
  spaceId, 
  isHost,
  onBroadcastStart, 
  onBroadcastStop 
}: LiveAudioBroadcasterProps) {
  const { toast } = useToast();
  const [isBroadcasting, setIsBroadcasting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);


  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    return () => { void stopBroadcast(); };
  }, []);

  const startBroadcast = async () => {
    if (!isHost) {
      toast({
        title: 'Permission denied',
        description: 'Only the host can broadcast',
        variant: 'destructive',
      });
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        } 
      });
      
      streamRef.current = stream;
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm;codecs=opus',
        audioBitsPerSecond: 128000,
      });
      
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        await uploadRecording(audioBlob);
      };

      mediaRecorder.start(5000); // Record in 5-second chunks
      setIsBroadcasting(true);
      setRecordingTime(0);

      await supabase.from('spaces').update({ is_recording: true }).eq('id', spaceId);

      timerRef.current = window.setInterval(() => {
        setRecordingTime((prev) => prev + 1);
      }, 1000);

      toast({ title: 'Broadcasting started', description: 'Your audio is now live' });
      onBroadcastStart?.('live');
    } catch (error: any) {
      console.error('Error starting broadcast:', error);
      toast({
        title: 'Error',
        description: 'Failed to access microphone. Please check permissions.',
        variant: 'destructive',
      });
    }
  };

  const stopBroadcast = async () => {
    if (mediaRecorderRef.current && isBroadcasting) {
      mediaRecorderRef.current.stop();
      setIsBroadcasting(false);

      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }

      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
      }

      await supabase.from('spaces').update({ is_recording: false }).eq('id', spaceId);

      onBroadcastStop?.();
    }
  };

  const uploadRecording = async (audioBlob: Blob) => {
    setUploading(true);
    try {
      const fileName = `spaces/${spaceId}/${Date.now()}.webm`;
      const { error: uploadError } = await supabase.storage.from('posts').upload(fileName, audioBlob, { cacheControl: '31536000', upsert: false });

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage.from('posts').getPublicUrl(fileName);

      const { error: dbError } = await supabase.from('space_recordings').insert({
        space_id: spaceId,
        user_id: (await supabase.auth.getUser()).data.user?.id,
        title: `Recording ${new Date().toLocaleString()}`,
        audio_url: publicUrl,
        duration: recordingTime,
      });

      if (dbError) throw dbError;

      toast({ title: 'Recording saved', description: 'Your broadcast has been saved' });
    } catch (error: any) {
      console.error('Error uploading recording:', error);
      toast({ title: 'Error', description: 'Failed to save recording', variant: 'destructive' });
    } finally {
      setUploading(false);
    }
  };

  const formatTime = (seconds: number) => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return hrs > 0 ? `${hrs}:${mins.toString().padStart(2,'0')}:${secs.toString().padStart(2,'0')}` : `${mins}:${secs.toString().padStart(2,'0')}`;
  };

  if (!isHost) return null;

  return (
    <div className="border border-border rounded-lg p-4 bg-background space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold flex items-center">
          <Radio className="w-4 h-4 mr-2" />
          Live Broadcast
        </p>
        {isBroadcasting && (
          <div className="flex items-center space-x-2">
            <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
            <span className="text-sm font-mono">{formatTime(recordingTime)}</span>
          </div>
        )}
      </div>

      {!isBroadcasting && !uploading && (
        <Button onClick={startBroadcast} className="w-full" size="lg">
          <Mic className="w-4 h-4 mr-2" /> Start Broadcasting
        </Button>
      )}

      {isBroadcasting && (
        <Button onClick={stopBroadcast} variant="destructive" className="w-full" size="lg">
          <Square className="w-4 h-4 mr-2" /> Stop Broadcast
        </Button>
      )}

      {uploading && (
        <div className="flex items-center justify-center space-x-2 py-3">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span className="text-sm text-muted-foreground">Saving recording...</span>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        {isBroadcasting 
          ? 'Your audio is being broadcast live to all listeners. Recording will be saved automatically.'
          : 'Click to start broadcasting live audio. The recording will be saved for playback.'}
      </p>
    </div>
  );
}
