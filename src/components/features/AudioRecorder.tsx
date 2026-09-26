import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Mic, Square, Play, Pause, Loader2, SlidersHorizontal } from 'lucide-react';
import { createStudioAudioPipeline, requestStudioMicrophone, chooseAudioMimeType, type StudioAudioPipeline } from '@/lib/studioAudio';

interface AudioRecorderProps {
  spaceId: string;
  onRecordingComplete?: (url: string) => void;
}

export function AudioRecorder({ spaceId, onRecordingComplete }: AudioRecorderProps) {
  const { toast } = useToast();
  const [isRecording, setIsRecording] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [recordingTime, setRecordingTime] = useState(0);
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const timerRef = useRef<number | null>(null);
  const pipelineRef = useRef<StudioAudioPipeline | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
      if (mediaRecorderRef.current && isRecording) mediaRecorderRef.current.stop();
      streamRef.current?.getTracks().forEach(track => track.stop());
      void pipelineRef.current?.stop();
    };
  }, []);

  const startRecording = async () => {
    try {
      const stream = await requestStudioMicrophone();
      streamRef.current = stream;
      const pipeline = await createStudioAudioPipeline(stream);
      pipelineRef.current = pipeline;
      const mimeType = chooseAudioMimeType();
      const mediaRecorder = new MediaRecorder(pipeline.stream, mimeType ? { mimeType, audioBitsPerSecond: 192000 } : { audioBitsPerSecond: 192000 });
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        audioChunksRef.current.push(event.data);
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: mediaRecorder.mimeType || 'audio/webm' });
        const url = URL.createObjectURL(audioBlob);
        setAudioUrl(url);
        
        // Upload to storage
        await uploadAudio(audioBlob);
        
        stream.getTracks().forEach(track => track.stop());
        streamRef.current = null;
        await pipeline.stop();
        pipelineRef.current = null;
      };

      mediaRecorder.start();
      setIsRecording(true);
      setRecordingTime(0);
      
      // Start timer
      timerRef.current = window.setInterval(() => {
        setRecordingTime((prev) => prev + 1);
      }, 1000);

      toast({
        title: 'Recording started',
        description: 'Speak into your microphone',
      });
    } catch (error: any) {
      console.error('Error starting recording:', error);
      toast({
        title: 'Error',
        description: 'Failed to access microphone',
        variant: 'destructive',
      });
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
  };

  const uploadAudio = async (audioBlob: Blob) => {
    setUploading(true);
    try {
      const fileName = `spaces/${spaceId}/${Date.now()}.webm`;
      
      const { error: uploadError } = await supabase.storage
        .from('posts')
        .upload(fileName, audioBlob, {
          cacheControl: '86400', // 24 hours
          upsert: false,
        });

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('posts')
        .getPublicUrl(fileName);

      onRecordingComplete?.(publicUrl);

      toast({
        title: 'Recording saved',
        description: 'Audio will be available for 24 hours',
      });
    } catch (error: any) {
      console.error('Error uploading audio:', error);
      toast({
        title: 'Error',
        description: 'Failed to upload recording',
        variant: 'destructive',
      });
    } finally {
      setUploading(false);
    }
  };

  const togglePlayback = () => {
    if (!audioRef.current) return;

    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current.play();
      setIsPlaying(true);
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-center space-x-4">
        {!isRecording && !audioUrl && (
          <Button
            onClick={startRecording}
            size="lg"
            className="rounded-full w-16 h-16 p-0"
            variant="default"
          >
            <Mic className="w-6 h-6" />
          </Button>
        )}

        {isRecording && (
          <div className="flex flex-col items-center space-y-3">
            <div className="flex items-center space-x-3">
              <div className="w-3 h-3 bg-red-500 rounded-full animate-pulse" />
              <span className="text-lg font-mono">{formatTime(recordingTime)}</span>
            </div>
            <Button
              onClick={stopRecording}
              size="lg"
              variant="destructive"
              className="rounded-full"
            >
              <Square className="w-5 h-5 mr-2" />
              Stop Recording
            </Button>
          </div>
        )}

        {audioUrl && !uploading && (
          <div className="flex flex-col items-center space-y-3 w-full">
            <audio
              ref={audioRef}
              src={audioUrl}
              onEnded={() => setIsPlaying(false)}
              className="hidden"
            />
            <div className="flex items-center space-x-3">
              <Button
                onClick={togglePlayback}
                size="lg"
                variant="outline"
                className="rounded-full w-12 h-12 p-0"
              >
                {isPlaying ? (
                  <Pause className="w-5 h-5" />
                ) : (
                  <Play className="w-5 h-5" />
                )}
              </Button>
              <span className="text-sm text-muted-foreground">
                Recording saved (available for 24 hours)
              </span>
            </div>
            <Button
              onClick={() => {
                setAudioUrl(null);
                setRecordingTime(0);
              }}
              variant="ghost"
              size="sm"
            >
              Record Another
            </Button>
          </div>
        )}

        {uploading && (
          <div className="flex items-center space-x-2">
            <Loader2 className="w-5 h-5 animate-spin" />
            <span className="text-sm text-muted-foreground">Uploading...</span>
          </div>
        )}
      </div>

      <p className="text-xs text-center text-muted-foreground">
        Studio mode uses browser noise suppression plus a mastered voice chain. Use headphones when monitoring live audio for the cleanest result.
      </p>
    </div>
  );
}
