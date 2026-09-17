import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { Image as ImageIcon, Loader2, PlaySquare, RefreshCw, Search, Send, Video } from 'lucide-react';

export type CreatorMediaAsset = {
  id: string;
  name: string;
  path: string;
  url: string;
  type: 'image' | 'video';
  size?: number;
  updatedAt?: string;
};

type Props = {
  onUseInComposer?: (asset: CreatorMediaAsset) => void;
};

const isImage = (name: string) => /\.(avif|gif|jpe?g|png|webp)$/i.test(name);
const isVideo = (name: string) => /\.(mp4|mov|m4v|webm|ogg)$/i.test(name);

export function CreatorMediaStudio({ onUseInComposer }: Props) {
  const { user } = useAuth();
  const [assets, setAssets] = useState<CreatorMediaAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'image' | 'video'>('all');
  const [error, setError] = useState<string | null>(null);

  const loadAssets = useCallback(async () => {
    if (!user?.id) return;
    setRefreshing(true);
    setError(null);
    try {
      const prefixes = [user.id, `videos/${user.id}`];
      const results = await Promise.all(prefixes.map(prefix =>
        supabase.storage.from('posts').list(prefix, {
          limit: 100,
          sortBy: { column: 'updated_at', order: 'desc' },
        })
      ));

      const found: CreatorMediaAsset[] = [];
      results.forEach(({ data, error: listError }, index) => {
        if (listError) throw listError;
        const prefix = prefixes[index];
        (data ?? []).forEach(file => {
          if (!file.name || !file.id) return;
          const type = isVideo(file.name) ? 'video' : isImage(file.name) ? 'image' : null;
          if (!type) return;
          const path = `${prefix}/${file.name}`;
          const { data: publicData } = supabase.storage.from('posts').getPublicUrl(path);
          found.push({
            id: `${type}:${path}`,
            name: file.name,
            path,
            url: publicData.publicUrl,
            type,
            size: file.metadata?.size,
            updatedAt: file.updated_at ?? undefined,
          });
        });
      });

      const unique = Array.from(new Map(found.map(asset => [asset.id, asset])).values())
        .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
      setAssets(unique);
    } catch (err: any) {
      setError(err?.message ?? 'Could not load your media library.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user?.id]);

  useEffect(() => { loadAssets(); }, [loadAssets]);

  const visible = useMemo(() => assets.filter(asset => {
    if (filter !== 'all' && asset.type !== filter) return false;
    return !query.trim() || asset.name.toLowerCase().includes(query.trim().toLowerCase());
  }), [assets, filter, query]);

  if (!user) return <div className="rounded-2xl border border-border p-6 text-sm text-muted-foreground">Sign in to manage creator media.</div>;

  return (
    <div className="rounded-2xl border border-border bg-background overflow-hidden">
      <div className="border-b border-border p-4 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2"><PlaySquare className="h-4 w-4 text-primary" /><h3 className="font-bold">Media Studio</h3></div>
            <p className="mt-1 text-xs text-muted-foreground">Your existing Testagram uploads, ready to reuse in new posts.</p>
          </div>
          <button onClick={loadAssets} disabled={refreshing} className="inline-flex items-center justify-center gap-2 rounded-xl border border-border px-3 py-2 text-xs font-semibold hover:bg-muted disabled:opacity-50">
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} /> Refresh
          </button>
        </div>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search your media…" className="w-full rounded-xl border border-border bg-background py-2.5 pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-primary/20" /></div>
          <div className="flex rounded-xl border border-border p-1">
            {(['all', 'image', 'video'] as const).map(item => <button key={item} onClick={() => setFilter(item)} className={`rounded-lg px-3 py-1.5 text-xs font-semibold capitalize ${filter === item ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`}>{item}</button>)}
          </div>
        </div>
      </div>

      {loading ? <div className="flex items-center justify-center gap-2 p-10 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading media library…</div>
        : error ? <div className="p-6 text-center"><p className="text-sm text-destructive">{error}</p><button onClick={loadAssets} className="mt-3 text-xs font-bold text-primary hover:underline">Try again</button></div>
        : visible.length === 0 ? <div className="p-10 text-center"><ImageIcon className="mx-auto h-8 w-8 text-muted-foreground/50" /><p className="mt-2 text-sm font-semibold">No reusable media found</p><p className="mt-1 text-xs text-muted-foreground">Upload an image or video through the native composer and it will appear here.</p></div>
        : <div className="grid grid-cols-2 gap-2 p-3 sm:grid-cols-3 lg:grid-cols-4">{visible.map(asset => (
          <article key={asset.id} className="group overflow-hidden rounded-xl border border-border bg-card">
            <div className="relative aspect-square bg-muted">
              {asset.type === 'video' ? <video src={asset.url} muted playsInline preload="metadata" className="h-full w-full object-cover" /> : <img src={asset.url} alt={asset.name} loading="lazy" className="h-full w-full object-cover" />}
              <div className="absolute left-2 top-2 rounded-full bg-black/65 px-2 py-1 text-[10px] font-bold text-white">{asset.type === 'video' ? <span className="flex items-center gap-1"><Video className="h-3 w-3" /> Video</span> : <span className="flex items-center gap-1"><ImageIcon className="h-3 w-3" /> Image</span>}</div>
              <button onClick={() => onUseInComposer?.(asset)} className="absolute inset-x-2 bottom-2 inline-flex items-center justify-center gap-1.5 rounded-lg bg-primary px-2 py-2 text-xs font-bold text-primary-foreground opacity-0 shadow-lg transition-opacity group-hover:opacity-100 focus:opacity-100"><Send className="h-3.5 w-3.5" /> Use in composer</button>
            </div>
            <div className="p-2"><p className="truncate text-xs font-semibold" title={asset.name}>{asset.name}</p><p className="mt-0.5 text-[10px] text-muted-foreground">{asset.size ? `${Math.round(asset.size / 1024)} KB` : 'Testagram upload'}</p></div>
          </article>
        ))}</div>}
    </div>
  );
}
