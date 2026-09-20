import { useState, useEffect, useRef } from 'react';
import { Search, Loader2, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { supabase } from '@/lib/supabase';

interface GifPickerProps { onSelect: (gifUrl: string) => void; onClose: () => void; }
interface GifItem { id: string; title: string; url: string; preview: string; }

const CATEGORIES = [
  { id: 'trending', label: '🔥 Trending', q: '' }, { id: 'happy', label: '😊 Happy', q: 'happy' },
  { id: 'love', label: '❤️ Love', q: 'love' }, { id: 'funny', label: '😂 Funny', q: 'funny' },
  { id: 'sad', label: '😢 Sad', q: 'sad' }, { id: 'fire', label: '🔥 Fire', q: 'fire' },
  { id: 'clap', label: '👏 Clap', q: 'clap' }, { id: 'dance', label: '💃 Dance', q: 'dance' },
  { id: 'wow', label: '😮 Wow', q: 'wow' }, { id: 'angry', label: '😡 Angry', q: 'angry' },
];

export function GifPicker({ onSelect, onClose }: GifPickerProps) {
  const [query, setQuery] = useState(''); const [category, setCategory] = useState('trending');
  const [gifs, setGifs] = useState<GifItem[]>([]); const [loading, setLoading] = useState(false);
  const [failedGifs, setFailedGifs] = useState<Set<string>>(new Set());
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => { void doSearch('', category); return () => abortRef.current?.abort(); }, [category]);

  const doSearch = async (searchQuery: string, cat: string) => {
    abortRef.current?.abort(); const ctrl = new AbortController(); abortRef.current = ctrl;
    setLoading(true); setFailedGifs(new Set());
    try {
      const catQ = CATEGORIES.find(c => c.id === cat)?.q || '';
      const term = searchQuery.trim() || catQ;
      const { data, error } = await supabase.rpc('search_gif_catalog', {
        p_query: term || null, p_category: 'trending', p_limit: 40,
      });
      if (ctrl.signal.aborted) return; if (error) throw error;
      setGifs((data ?? []).map((item: any): GifItem => ({
        id: item.id, title: item.title, url: item.media_url, preview: item.preview_url || item.media_url,
      })));
    } catch (err: any) {
      if (err?.name !== 'AbortError') { console.warn('[GifPicker] Testagram GIF Store error:', err); setGifs([]); }
    } finally { if (!ctrl.signal.aborted) setLoading(false); }
  };

  const handleSelect = (gif: GifItem) => {
    void supabase.rpc('record_gif_usage', { p_gif_id: gif.id });
    onSelect(gif.url); onClose();
  };
  const handleSearchSubmit = (e: React.FormEvent) => { e.preventDefault(); void doSearch(query, category); };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end md:items-center justify-center z-50">
      <div className="bg-background w-full md:max-w-2xl md:rounded-xl rounded-t-2xl flex flex-col overflow-hidden" style={{ maxHeight: '88vh' }}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
          <div><h2 className="text-lg font-bold">Choose a GIF</h2><p className="text-[11px] text-muted-foreground">Testagram GIF Store</p></div>
          <button onClick={onClose} className="p-2 rounded-full hover:bg-muted transition-colors" aria-label="Close GIF picker"><X className="w-5 h-5" /></button>
        </div>
        <div className="px-3 py-2 border-b border-border shrink-0">
          <form onSubmit={handleSearchSubmit} className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            <Input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search Testagram GIFs…" className="pl-9 h-9 rounded-full text-sm" />
          </form>
        </div>
        <div className="flex gap-2 px-3 py-2 overflow-x-auto shrink-0 scrollbar-hide border-b border-border">
          {CATEGORIES.map(c => <button key={c.id} onClick={() => { setCategory(c.id); setQuery(''); }}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap shrink-0 transition-colors ${category === c.id ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/70'}`}>{c.label}</button>)}
        </div>
        <div className="flex-1 overflow-y-auto p-2 min-h-0">
          {loading ? <div className="flex items-center justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div> :
           gifs.length === 0 ? <div className="text-center py-12 text-muted-foreground text-sm">No GIFs found yet. Try another search.</div> :
           <div className="columns-2 md:columns-3 gap-2 space-y-2">
            {gifs.filter(gif => !failedGifs.has(gif.id)).map(gif => <button key={gif.id} onClick={() => handleSelect(gif)}
              className="break-inside-avoid w-full rounded-xl overflow-hidden bg-muted hover:ring-2 hover:ring-primary transition-all block" title={gif.title}>
              <img src={gif.preview} alt={gif.title} className="w-full object-cover" loading="lazy"
                onError={() => setFailedGifs(prev => new Set([...prev, gif.id]))} />
            </button>)}
           </div>}
        </div>
        <div className="shrink-0 py-2 border-t border-border text-center"><p className="text-xs text-muted-foreground">Powered by <strong>Testagram</strong></p></div>
      </div>
    </div>
  );
}
