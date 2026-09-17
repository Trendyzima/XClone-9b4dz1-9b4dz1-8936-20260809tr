import { useMemo, useRef, useState } from 'react';
import { Clapperboard, Film, Scissors, SlidersHorizontal, Sparkles, Upload, Wand2, Volume2 } from 'lucide-react';
import type { CreatorMediaAsset } from './CreatorMediaStudio';

type Props = {
  asset?: CreatorMediaAsset | null;
  onOpenMedia: () => void;
  onSendToComposer: (asset: CreatorMediaAsset) => void;
};

const FEATURES = [
  { label: 'Precision timeline', description: 'Trim, split and arrange clips with a creator-first editing workflow.', icon: Scissors },
  { label: 'Effects & color', description: 'Build the foundation for transitions, adjustments and visual effects.', icon: SlidersHorizontal },
  { label: 'Text & captions', description: 'Keep titles, captions and motion text in the same editing workspace.', icon: Wand2 },
  { label: 'Audio control', description: 'Prepare music, voice and clip audio for a finished social video.', icon: Volume2 },
] as const;

export function CreatorReelStudio({ asset, onOpenMedia, onSendToComposer }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);

  const duration = useMemo(() => {
    const value = asset?.duration;
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
  }, [asset]);

  const effectiveEnd = end ?? duration;
  const hasVideo = Boolean(asset?.url);

  const seek = (time: number) => {
    if (!videoRef.current) return;
    videoRef.current.currentTime = Math.max(0, Math.min(time, duration || time));
  };

  const togglePlayback = async () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      await video.play();
      setPlaying(true);
    } else {
      video.pause();
      setPlaying(false);
    }
  };

  const resetTrim = () => {
    setStart(0);
    setEnd(null);
    seek(0);
  };

  return (
    <div className="overflow-hidden rounded-3xl border border-border bg-background shadow-sm">
      <div className="border-b border-border bg-gradient-to-br from-violet-500/10 via-background to-background p-5 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-violet-500/20 bg-violet-500/10 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-violet-600 dark:text-violet-400">
              <Clapperboard className="h-3.5 w-3.5" /> Reel Studio
            </div>
            <h3 className="text-2xl font-black tracking-tight">Turn your media into publish-ready reels.</h3>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              An OpenReel-derived editing layer inside Testagram Creator Studio. Editing stays browser-side while Testagram keeps ownership of media, publishing and creator data.
            </p>
          </div>
          <button onClick={onOpenMedia} className="inline-flex items-center justify-center gap-2 rounded-xl border border-border bg-background px-4 py-2.5 text-sm font-bold hover:bg-muted">
            <Film className="h-4 w-4" /> Choose media
          </button>
        </div>
      </div>

      {!hasVideo ? (
        <div className="p-5 sm:p-6">
          <div className="rounded-2xl border border-dashed border-primary/30 bg-primary/5 p-8 text-center">
            <Upload className="mx-auto h-8 w-8 text-primary" />
            <h4 className="mt-3 font-bold">Start with a Testagram video</h4>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">Pick an existing upload from Media Studio. Nothing is copied into a second asset system.</p>
            <button onClick={onOpenMedia} className="mt-4 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground">Open Media Studio</button>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {FEATURES.map(({ label, description, icon: Icon }) => (
              <div key={label} className="rounded-2xl border border-border p-4">
                <Icon className="h-5 w-5 text-primary" />
                <p className="mt-2 text-sm font-bold">{label}</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="grid gap-4 p-3 sm:p-5 lg:grid-cols-[1.25fr_.75fr]">
          <div className="overflow-hidden rounded-2xl border border-border bg-black">
            <div className="flex aspect-video items-center justify-center bg-black">
              <video
                ref={videoRef}
                src={asset.url}
                className="max-h-full max-w-full object-contain"
                controls
                playsInline
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
              />
            </div>
            <div className="flex items-center justify-between border-t border-white/10 px-3 py-2 text-xs text-white">
              <span className="truncate">{asset.name}</span>
              <span>{playing ? 'Playing' : 'Ready'} · {duration.toFixed(1)}s</span>
            </div>
          </div>

          <div className="space-y-3">
            <div className="rounded-2xl border border-border p-4">
              <div className="flex items-center justify-between">
                <div><p className="text-sm font-bold">Trim</p><p className="text-xs text-muted-foreground">Set the working range before the full timeline lands.</p></div>
                <button onClick={resetTrim} className="text-xs font-semibold text-primary">Reset</button>
              </div>
              <label className="mt-4 block text-xs font-semibold">Start · {start.toFixed(1)}s</label>
              <input aria-label="Trim start" className="mt-2 w-full accent-primary" type="range" min="0" max={Math.max(duration, 0.1)} step="0.1" value={start} onChange={e => { const value = Number(e.target.value); setStart(Math.min(value, Math.max(0, effectiveEnd - 0.1))); seek(value); }} />
              <label className="mt-3 block text-xs font-semibold">End · {effectiveEnd.toFixed(1)}s</label>
              <input aria-label="Trim end" className="mt-2 w-full accent-primary" type="range" min="0" max={Math.max(duration, 0.1)} step="0.1" value={effectiveEnd} onChange={e => { const value = Number(e.target.value); setEnd(Math.max(value, start + 0.1)); seek(value); }} />
              <button onClick={togglePlayback} className="mt-4 w-full rounded-xl border border-border px-3 py-2 text-sm font-bold hover:bg-muted">{playing ? 'Pause preview' : 'Preview selection'}</button>
            </div>

            <div className="grid grid-cols-2 gap-2">
              {FEATURES.map(({ label, description, icon: Icon }) => (
                <div key={label} className="rounded-2xl border border-border p-3">
                  <Icon className="h-4 w-4 text-primary" />
                  <p className="mt-2 text-xs font-bold">{label}</p>
                  <p className="mt-1 text-[11px] leading-4 text-muted-foreground">{description}</p>
                </div>
              ))}
            </div>

            <div className="rounded-2xl border border-primary/20 bg-primary/5 p-4">
              <div className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-primary" /><p className="text-sm font-bold">Creator pipeline</p></div>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">This editor is deliberately connected to Testagram's existing media and composer contracts. AI tools and the full multi-track engine can be added without creating another publishing system.</p>
              <button onClick={() => onSendToComposer(asset)} className="mt-3 w-full rounded-xl bg-primary px-3 py-2.5 text-sm font-bold text-primary-foreground">Use edited media in composer</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
