import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import type { CreatorMediaAsset } from './CreatorMediaStudio';
import { Clapperboard, Download, Film, Layers3, Pause, Play, Plus, RotateCcw, Scissors, Sparkles, Trash2, Upload, Volume2 } from 'lucide-react';

type Clip = { id: string; asset: CreatorMediaAsset; start: number; duration: number; track: number; offset: number };
type Props = { asset?: CreatorMediaAsset | null; onOpenMedia: () => void; onSendToComposer: (asset: CreatorMediaAsset) => void };
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

export function CreatorReelStudio({ asset, onOpenMedia, onSendToComposer }: Props) {
  const { user } = useAuth();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const mediaRef = useRef<HTMLVideoElement | null>(null);
  const [clips, setClips] = useState<Clip[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [exported, setExported] = useState<CreatorMediaAsset | null>(null);
  const [error, setError] = useState<string | null>(null);
  const selected = clips.find(c => c.id === selectedId) ?? clips[0];
  const duration = useMemo(() => Math.max(1, ...clips.map(c => c.offset + c.duration)), [clips]);

  useEffect(() => {
    if (!asset || asset.type !== 'video') return;
    const clip: Clip = { id: uid(), asset, start: 0, duration: 5, track: 0, offset: 0 };
    setClips([clip]); setSelectedId(clip.id); setPlayhead(0); setExported(null); setError(null);
    const v = document.createElement('video'); v.src = asset.url; v.preload = 'metadata';
    v.onloadedmetadata = () => setClips(current => current.map(c => c.id === clip.id ? { ...c, duration: Math.min(Number.isFinite(v.duration) ? v.duration : 5, 30) } : c));
    return () => { v.src = ''; };
  }, [asset?.id]);

  const renderFrame = () => {
    const canvas = canvasRef.current, video = mediaRef.current; if (!canvas) return;
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (video && selected && video.readyState >= 2 && video.videoWidth) {
      const scale = Math.min(canvas.width / video.videoWidth, canvas.height / video.videoHeight);
      const w = video.videoWidth * scale, h = video.videoHeight * scale;
      ctx.drawImage(video, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
    }
  };
  const seek = (time: number) => {
    const next = Math.max(0, Math.min(time, duration)); setPlayhead(next);
    if (mediaRef.current && selected) mediaRef.current.currentTime = Math.max(0, Math.min(selected.start + Math.max(0, next - selected.offset), selected.start + selected.duration));
    requestAnimationFrame(renderFrame);
  };
  const togglePlayback = async () => {
    if (!selected || !mediaRef.current) return;
    if (playing) { mediaRef.current.pause(); setPlaying(false); return; }
    mediaRef.current.currentTime = selected.start + Math.max(0, playhead - selected.offset);
    await mediaRef.current.play(); setPlaying(true);
  };
  const splitSelected = () => {
    if (!selected) return;
    const local = playhead - selected.offset;
    if (local <= 0.15 || local >= selected.duration - 0.15) return;
    const left: Clip = { ...selected, id: uid(), duration: local };
    const right: Clip = { ...selected, id: uid(), start: selected.start + local, duration: selected.duration - local, offset: selected.offset + local };
    setClips(current => current.flatMap(c => c.id === selected.id ? [left, right] : [c])); setSelectedId(right.id);
  };
  const addTrack = () => { if (!selected) return; const clone: Clip = { ...selected, id: uid(), track: Math.min(2, selected.track + 1), offset: duration }; setClips(current => [...current, clone]); setSelectedId(clone.id); };
  const removeSelected = () => { if (!selected) return; setClips(current => current.filter(c => c.id !== selected.id)); setSelectedId(null); };

  const exportVideo = async () => {
    if (!user || !clips.length || !canvasRef.current) return;
    setExporting(true); setExportProgress(0); setError(null); setExported(null);
    try {
      const canvas = canvasRef.current;
      const stream = canvas.captureStream(30);
      const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9' : 'video/webm';
      const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 5_000_000 });
      const chunks: Blob[] = []; recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
      const done = new Promise<Blob>((resolve, reject) => { recorder.onstop = () => resolve(new Blob(chunks, { type: mime })); recorder.onerror = () => reject(new Error('Browser export failed')); });
      recorder.start(200);
      const video = mediaRef.current ?? document.createElement('video'); video.muted = true; video.playsInline = true;
      const started = performance.now();
      await new Promise<void>(resolve => {
        const frame = async () => {
          const elapsed = (performance.now() - started) / 1000;
          if (elapsed >= duration) { video.pause(); recorder.stop(); resolve(); return; }
          const active = [...clips].reverse().find(c => elapsed >= c.offset && elapsed < c.offset + c.duration) ?? clips[0];
          if (video.src !== active.asset.url) { video.src = active.asset.url; video.currentTime = active.start; await video.play().catch(() => undefined); }
          const sourceTime = active.start + (elapsed - active.offset);
          if (Math.abs(video.currentTime - sourceTime) > 0.08) video.currentTime = sourceTime;
          const ctx = canvas.getContext('2d');
          if (ctx && video.readyState >= 2 && video.videoWidth) { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, canvas.width, canvas.height); const scale = Math.min(canvas.width / video.videoWidth, canvas.height / video.videoHeight); const w = video.videoWidth * scale, h = video.videoHeight * scale; ctx.drawImage(video, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h); }
          setExportProgress(Math.min(99, Math.round(elapsed / duration * 100))); requestAnimationFrame(frame);
        }; requestAnimationFrame(frame);
      });
      const blob = await done;
      const name = `reel-${Date.now()}.webm`, path = `${user.id}/${name}`;
      const upload = await supabase.storage.from('posts').upload(path, blob, { contentType: 'video/webm', upsert: false });
      if (upload.error) throw upload.error;
      const { data } = supabase.storage.from('posts').getPublicUrl(path);
      const result: CreatorMediaAsset = { id: `video:${path}`, name, path, url: data.publicUrl, type: 'video', size: blob.size, updatedAt: new Date().toISOString() };
      setExported(result); setExportProgress(100);
    } catch (err: any) { setError(err?.message ?? 'Could not export this reel.'); }
    finally { setExporting(false); }
  };

  if (!asset || asset.type !== 'video') return <div className="rounded-3xl border border-border bg-background p-8 text-center"><Clapperboard className="mx-auto h-9 w-9 text-primary" /><h3 className="mt-3 text-lg font-black">Reel Studio</h3><p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">Choose a Testagram video from Media Studio to start editing.</p><button onClick={onOpenMedia} className="mt-4 inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground"><Upload className="h-4 w-4" /> Choose video</button></div>;
  return <div className="overflow-hidden rounded-3xl border border-border bg-background">
    <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center sm:justify-between"><div><div className="flex items-center gap-2"><Clapperboard className="h-5 w-5 text-primary" /><h3 className="font-black">Reel Studio</h3><span className="rounded-full bg-primary/10 px-2 py-1 text-[10px] font-bold text-primary">MULTI-TRACK</span></div><p className="mt-1 text-xs text-muted-foreground">Timeline, split editing, layered tracks and real browser export.</p></div><button onClick={onOpenMedia} className="inline-flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-xs font-bold hover:bg-muted"><Film className="h-4 w-4" /> Media</button></div>
    <div className="grid gap-4 p-3 sm:p-5 lg:grid-cols-[1.35fr_.65fr]">
      <div className="space-y-3"><div className="overflow-hidden rounded-2xl border border-border bg-black"><canvas ref={canvasRef} width={1280} height={720} className="aspect-video h-auto w-full" /><video ref={mediaRef} src={selected?.asset.url} className="hidden" muted playsInline preload="auto" onLoadedMetadata={renderFrame} onTimeUpdate={renderFrame} /></div><div className="flex items-center gap-2 rounded-xl border border-border p-2"><button onClick={() => seek(playhead - 1)} className="rounded-lg border border-border px-2 py-1.5 text-xs">−1s</button><button onClick={togglePlayback} className="inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground">{playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}{playing ? 'Pause' : 'Play'}</button><button onClick={() => seek(playhead + 1)} className="rounded-lg border border-border px-2 py-1.5 text-xs">+1s</button><span className="ml-auto text-xs font-mono text-muted-foreground">{playhead.toFixed(1)} / {duration.toFixed(1)}s</span></div>
      <div className="overflow-x-auto rounded-2xl border border-border bg-muted/20 p-3"><div className="mb-2 flex min-w-[640px] items-center gap-2 text-xs font-bold"><Layers3 className="h-4 w-4 text-primary" /> Timeline <span className="ml-auto text-muted-foreground">{clips.length} clips · {new Set(clips.map(c => c.track)).size} tracks</span></div><div className="relative min-w-[640px] space-y-2">{[0,1,2].map(track => <div key={track} className="relative h-14 rounded-xl border border-border bg-background"><span className="absolute left-2 top-2 z-10 text-[9px] font-bold text-muted-foreground">V{track + 1}</span>{clips.filter(c => c.track === track).map(c => <button key={c.id} onClick={() => setSelectedId(c.id)} className={`absolute top-1.5 h-11 rounded-lg border px-2 text-left text-[10px] font-bold ${selectedId === c.id ? 'border-primary bg-primary/15' : 'border-border bg-muted'}`} style={{ left: `${c.offset / duration * 100}%`, width: `${Math.max(5, c.duration / duration * 100)}%` }}><span className="block truncate">{c.asset.name}</span><span className="text-[9px] font-normal text-muted-foreground">{c.duration.toFixed(1)}s</span></button>)}</div>)}<input aria-label="Timeline playhead" className="absolute inset-x-0 top-0 h-full w-full cursor-pointer opacity-0" type="range" min="0" max={duration} step="0.01" value={playhead} onChange={e => seek(Number(e.target.value))} /></div></div></div>
      <aside className="space-y-3"><div className="rounded-2xl border border-border p-4"><div className="flex items-center gap-2"><Scissors className="h-4 w-4 text-primary" /><p className="text-sm font-bold">Edit clip</p></div><p className="mt-1 truncate text-xs text-muted-foreground">{selected?.asset.name}</p><div className="mt-3 grid grid-cols-2 gap-2"><button onClick={splitSelected} disabled={!selected} className="inline-flex items-center justify-center gap-1 rounded-xl border border-border px-2 py-2 text-xs font-bold hover:bg-muted disabled:opacity-40"><Scissors className="h-3.5 w-3.5" /> Split</button><button onClick={removeSelected} disabled={!selected} className="inline-flex items-center justify-center gap-1 rounded-xl border border-destructive/30 px-2 py-2 text-xs font-bold text-destructive disabled:opacity-40"><Trash2 className="h-3.5 w-3.5" /> Remove</button></div><button onClick={addTrack} disabled={!selected} className="mt-2 inline-flex w-full items-center justify-center gap-1 rounded-xl border border-border px-2 py-2 text-xs font-bold hover:bg-muted disabled:opacity-40"><Plus className="h-3.5 w-3.5" /> Duplicate to next track</button></div><div className="rounded-2xl border border-border p-4"><div className="flex items-center gap-2"><Volume2 className="h-4 w-4 text-primary" /><p className="text-sm font-bold">Export</p></div><p className="mt-1 text-xs leading-5 text-muted-foreground">Creates a real WebM file from the timeline and uploads it to Testagram's existing <code>posts</code> bucket.</p><button onClick={exportVideo} disabled={exporting || !clips.length} className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-3 py-2.5 text-sm font-bold text-primary-foreground disabled:opacity-50">{exporting ? `Exporting ${exportProgress}%…` : <><Download className="h-4 w-4" /> Export reel</>}</button>{error && <p className="mt-2 text-xs text-destructive">{error}</p>}{exported && <div className="mt-3 rounded-xl border border-primary/20 bg-primary/5 p-3"><p className="text-xs font-bold">Export ready · {Math.round((exported.size ?? 0) / 1024)} KB</p><button onClick={() => onSendToComposer(exported)} className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2 text-xs font-bold text-primary-foreground"><Sparkles className="h-3.5 w-3.5" /> Use in Testagram composer</button></div>}</div><button onClick={() => { setClips([]); setSelectedId(null); setExported(null); setPlayhead(0); }} className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-border px-3 py-2 text-xs font-bold hover:bg-muted"><RotateCcw className="h-3.5 w-3.5" /> New edit</button></aside>
    </div>
  </div>;
}
