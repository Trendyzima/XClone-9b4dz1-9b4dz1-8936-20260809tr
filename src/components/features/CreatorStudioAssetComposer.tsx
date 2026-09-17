import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { ComposePost } from './ComposePost';
import type { CreatorMediaAsset } from './CreatorMediaStudio';

type Props = { asset: CreatorMediaAsset | null; onSuccess?: () => void };

export function CreatorStudioAssetComposer({ asset, onSuccess }: Props) {
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!asset) return;
    let cancelled = false;
    const prepare = async () => {
      setPreparing(true);
      setError(null);
      try {
        const response = await fetch(asset.url);
        if (!response.ok) throw new Error(`Media download failed (${response.status})`);
        const blob = await response.blob();
        if (cancelled) return;
        const file = new File([blob], asset.name, { type: blob.type || (asset.type === 'video' ? 'video/mp4' : 'image/jpeg') });
        const input = document.querySelector<HTMLInputElement>(asset.type === 'video' ? 'input[type="file"][accept="video/*"]' : 'input[type="file"][accept="image/*"]');
        if (!input) throw new Error('The native composer media input is not ready yet.');
        const transfer = new DataTransfer();
        transfer.items.add(file);
        input.files = transfer.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      } catch (err: any) {
        if (!cancelled) setError(err?.message ?? 'Could not attach this asset.');
      } finally {
        if (!cancelled) setPreparing(false);
      }
    };
    const timer = window.setTimeout(prepare, 0);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [asset]);

  return (
    <div className="relative overflow-hidden rounded-2xl border border-border bg-background">
      <ComposePost onSuccess={onSuccess} />
      {preparing && <div className="absolute inset-0 z-20 flex items-center justify-center bg-background/85 backdrop-blur-sm"><div className="flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-3 text-sm font-semibold shadow-lg"><Loader2 className="h-4 w-4 animate-spin text-primary" /> Attaching {asset?.type ?? 'media'}…</div></div>}
      {error && <div className="border-t border-destructive/20 bg-destructive/5 px-4 py-3 text-xs text-destructive">{error}</div>}
    </div>
  );
}
