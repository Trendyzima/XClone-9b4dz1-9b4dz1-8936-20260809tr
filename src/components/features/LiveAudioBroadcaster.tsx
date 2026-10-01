import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Mic, Square, Loader2, Radio, SlidersHorizontal } from 'lucide-react';
import { createStudioAudioPipeline, requestStudioMicrophone, chooseAudioMimeType, type StudioAudioPipeline } from '@/lib/studioAudio';
import { TestagramMediaSession } from '@/lib/testagramMedia';

interface LiveAudioBroadcasterProps {
  spaceId: string;
  isHost: boolean;
  onBroadcastStart?: (url: string) => void;
  onBroadcastStop?: () => void;
}

/**
 * Space broadcaster:
 *  - captures one microphone source
 *  - runs it through the studio voice chain
 *  - publishes the processed stream through the native Testagram media engine
 *  - records the same processed program locally for the Space replay
 *
 * The previous implementation only recorded audio. It never connected the
 * host to the native media session, so "live" Spaces could be silent for
 * listeners until a recording existed. Keep the live transport and recording
 * paths explicit and independently observable.
 */
export function LiveAudioBroadcaster({
  spaceId,
  isHost,
  onBroadcastStart,
  onBroadcastStop,
}: LiveAudioBroadcasterProps) {
  const { toast } = useToast();
  const [isBroadcasting, setIsBroadcasting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [transportReady, setTransportReady] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const pipelineRef = useRef<StudioAudioPipeline | null>(null);
  const mediaSessionRef = useRef<TestagramMediaSession | null>(null);
  const startedAtRef = useRef<number | null>(null);
  const stoppingRef = useRef(false);

  const cleanup = useCallback(async () => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    await mediaSessionRef.current?.close().catch(() => undefined);
    mediaSessionRef.current = null;
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
    await pipelineRef.current?.stop().catch(() => undefined);
    pipelineRef.current = null;
    startedAtRef.current = null;
    setTransportReady(false);
  }, []);

  const uploadRecording = useCallback(async (audioBlob: Blob, durationSeconds: number) => {
    if (!audioBlob.size) throw new Error('No audio data was captured.');

    const fileName = `spaces/${spaceId}/${Date.now()}.webm`;
    const { error: uploadError } = await supabase.storage
      .from('posts')
      .upload(fileName, audioBlob, { cacheControl: '31536000', upsert: false, contentType: audioBlob.type || 'audio/webm' });
    if (uploadError) throw uploadError;

    const { data: { publicUrl } } = supabase.storage.from('posts').getPublicUrl(fileName);
    const { error: dbError } = await supabase.from('space_recordings').insert({
      space_id: spaceId,
      user_id: (await supabase.auth.getUser()).data.user?.id,
      title: `Recording ${new Date().toLocaleString()}`,
      audio_url: publicUrl,
      duration: Math.max(1, Math.round(durationSeconds)),
    });
    if (dbError) throw dbError;
  }, [spaceId]);

  const stopBroadcast = useCallback(async () => {
    if (stoppingRef.current) return;
    stoppingRef.current = true;

    const recorder = mediaRecorderRef.current;
    const startedAt = startedAtRef.current;
    const durationSeconds = startedAt ? (Date.now() - startedAt) / 1000 : recordingTime;

    try {
      if (recorder && recorder.state !== 'inactive') {
        await new Promise<void>(resolve => {
          recorder.addEventListener('stop', () => resolve(), { once: true });
          recorder.stop();
        });
      }
      setIsBroadcasting(false);
      setUploading(audioChunksRef.current.length > 0);

      if (audioChunksRef.current.length) {
        const mimeType = recorder?.mimeType || 'audio/webm';
        const blob = new Blob(audioChunksRef.current, { type: mimeType });
        try {
          await uploadRecording(blob, durationSeconds);
          toast({ title: 'Recording saved', description: 'Your Space recording is ready for playback.' });
        } catch (error: any) {
          console.error('[Audio Space] recording upload failed', error);
          toast({ title: 'Recording save failed', description: error?.message || 'The live broadcast ended, but the replay could not be saved.', variant: 'destructive' });
        }
      }
    } finally {
      mediaRecorderRef.current = null;
      audioChunksRef.current = [];
      setUploading(false);
      await cleanup();
      await supabase.from('spaces').update({ is_recording: false }).eq('id', spaceId);
      onBroadcastStop?.();
      stoppingRef.current = false;
    }
  }, [cleanup, onBroadcastStop, recordingTime, spaceId, toast, uploadRecording]);

  useEffect(() => () => {
    // Do not rely on the render-time isBroadcasting value during unmount.
    // Refs are the source of truth for long-lived media resources.
    void stopBroadcast();
  }, [stopBroadcast]);

  const startBroadcast = async () => {
    if (!isHost || isBroadcasting || stoppingRef.current) {
      if (!isHost) toast({ title: 'Permission denied', description: 'Only the host can broadcast', variant: 'destructive' });
      return;
    }

    try {
      setUploading(false);
      audioChunksRef.current = [];

      const microphone = await requestStudioMicrophone();
      streamRef.current = microphone;

      const pipeline = await createStudioAudioPipeline(microphone);
      pipelineRef.current = pipeline;

      // Publish the processed studio stream, not the raw microphone.
      const session = await TestagramMediaSession.connectSpace(spaceId, 'host', pipeline.stream);
      mediaSessionRef.current = session;

      const mimeType = chooseAudioMimeType();
      const recorder = new MediaRecorder(
        pipeline.stream,
        mimeType ? { mimeType, audioBitsPerSecond: 192000 } : { audioBitsPerSecond: 192000 },
      );
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = event => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data);
      };
      recorder.onerror = event => {
        console.error('[Audio Space] MediaRecorder error', event);
      };

      recorder.start(5000);
      startedAtRef.current = Date.now();
      setRecordingTime(0);
      setIsBroadcasting(true);
      setTransportReady(true);

      const { error: stateError } = await supabase
        .from('spaces')
        .update({ is_recording: true })
        .eq('id', spaceId);
      if (stateError) console.warn('[Audio Space] failed to persist recording state', stateError);

      timerRef.current = window.setInterval(() => {
        setRecordingTime(Math.max(0, Math.floor((Date.now() - (startedAtRef.current ?? Date.now())) / 1000)));
      }, 1000);

      toast({ title: 'Broadcasting started', description: 'Your processed audio is now live.' });
      onBroadcastStart?.('live');
    } catch (error: any) {
      console.error('[Audio Space] start failed', error);
      await cleanup();
      await supabase.from('spaces').update({ is_recording: false }).eq('id', spaceId);
      setIsBroadcasting(false);
      toast({
        title: 'Audio broadcast unavailable',
        description: error?.message || 'Could not establish the live audio transport.',
        variant: 'destructive',
      });
    }
  };

  const formatTime = (seconds: number) => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return hrs > 0 ? `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}` : `${mins}:${secs.toString().padStart(2, '0')}`;
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
            <div className={`w-2 h-2 rounded-full animate-pulse ${transportReady ? 'bg-red-500' : 'bg-amber-500'}`} />
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
        <Button onClick={() => void stopBroadcast()} variant="destructive" className="w-full" size="lg">
          <Square className="w-4 h-4 mr-2" /> Stop Broadcast
        </Button>
      )}

      {uploading && (
        <div className="flex items-center justify-center space-x-2 py-3">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span className="text-sm text-muted-foreground">Saving recording…</span>
        </div>
      )}

      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <SlidersHorizontal className="w-3.5 h-3.5 text-primary" />
        Studio voice chain active · noise suppression · rumble removal · dynamics control
      </div>
      <p className="text-xs text-muted-foreground">
        {isBroadcasting
          ? (transportReady ? 'LIVE transport connected. Your processed voice is being delivered to listeners.' : 'Connecting live transport…')
          : 'Start the live transport and the local replay recording together.'}
      </p>
    </div>
  );
}
