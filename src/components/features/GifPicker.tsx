import { useState, useEffect, useRef } from 'react';
import { Search, Loader2, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { supabase } from '@/lib/supabase';

interface GifPickerProps {
  onSelect: (gifUrl: string) => void;
  onClose: () => void;
}

interface GifItem {
  id: string;
  url: string;
  preview: string;
}

const CATEGORIES = [
  { id: 'trending', label: '🔥 Trending', q: '' },
  { id: 'happy',    label: '😊 Happy',   q: 'happy' },
  { id: 'love',     label: '❤️ Love',    q: 'love' },
  { id: 'funny',    label: '😂 Funny',   q: 'funny' },
  { id: 'sad',      label: '😢 Sad',     q: 'sad' },
  { id: 'fire',     label: '🔥 Fire',    q: 'fire' },
  { id: 'clap',     label: '👏 Clap',    q: 'applause' },
  { id: 'dance',    label: '💃 Dance',   q: 'dance' },
  { id: 'wow',      label: '😮 Wow',     q: 'wow' },
  { id: 'angry',    label: '😡 Angry',   q: 'angry' },
];

// Last-resort direct GIFs. These are only used when the proxy is unavailable.
const FALLBACK_GIFS: GifItem[] = [
  { id: 'f1', url: 'https://media.tenor.com/7Ypq9_9najcAAAAS/thumbs-up-double-thumbs-up.gif', preview: 'https://media.tenor.com/7Ypq9_9najcAAAAS/thumbs-up-double-thumbs-up.gif' },
  { id: 'f2', url: 'https://media.tenor.com/Lbrr3HR3CnkAAAAM/snoop-dogg-rap.gif', preview: 'https://media.tenor.com/Lbrr3HR3CnkAAAAM/snoop-dogg-rap.gif' },
  { id: 'f3', url: 'https://media.tenor.com/aJrxpMCv6hEAAAAC/dance-dancing.gif', preview: 'https://media.tenor.com/aJrxpMCv6hEAAAAC/dance-dancing.gif' },
  { id: 'f4', url: 'https://media.tenor.com/GOK_e8x2buQAAAAM/cat-dance-cat.gif', preview: 'https://media.tenor.com/GOK_e8x2buQAAAAM/cat-dance-cat.gif' },
  { id: 'f5', url: 'https://media.tenor.com/uRlxzRNgp2MAAAAi/anime-girl.gif', preview: 'https://media.tenor.com/uRlxzRNgp2MAAAAi/anime-girl.gif' },
  { id: 'f6', url: 'https://media.tenor.com/gVPazpEOQ3kAAAAi/chika.gif', preview: 'https://media.tenor.com/gVPazpEOQ3kAAAAi/chika.gif' },
];

function parseTenorResponse(data: any): GifItem[] {
  if (!data?.results?.length) return [];
  return data.results.flatMap((item: any) => {
    const fmts = item.media_formats || {};
    const url  = fmts.gif?.url || fmts.mediumgif?.url || fmts.tinygif?.url || '';
    const prev = fmts.tinygif?.url || fmts.nanogif?.url || url;
    if (!url) return [];
    return [{ id: item.id, url, preview: prev }];
  });
}

export function GifPicker({ onSelect, onClose }: GifPickerProps) {
  const [query, setQuery]           = useState('');
  const [category, setCategory]     = useState('trending');
  const [gifs, setGifs]             = useState<GifItem[]>([]);
  const [loading, setLoading]       = useState(false);
  const [isFallback, setIsFallback] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { doSearch('', category); }, [category]);

  const doSearch = async (searchQuery: string, cat: string) => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setLoading(true);
    setIsFallback(false);

    try {
      const catQ = CATEGORIES.find(c => c.id === cat)?.q || '';
      const term = searchQuery.trim() || catQ;

      // Call Supabase edge function proxy (avoids CORS + hides API key)
      const fnUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/tenor-proxy?q=${encodeURIComponent(term)}&limit=30`;
      const res = await fetch(fnUrl, {
        signal: ctrl.signal,
        headers: {
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        },
      });

      if (!res.ok) throw new Error(`Proxy ${res.status}`);
      const data = await res.json();
      const parsed = parseTenorResponse(data);

      setGifs(parsed.length > 0 ? parsed : FALLBACK_GIFS);
      setIsFallback(parsed.length === 0);
    } catch (err: any) {
      if (err.name === 'AbortError') return;
      console.warn('[GifPicker] proxy error, using fallback:', err.message);
      setGifs(FALLBACK_GIFS);
      setIsFallback(true);
    } finally {
      setLoading(false);
    }
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    doSearch(query, category);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end md:items-center justify-center z-50">
      <div
        className="bg-background w-full md:max-w-2xl md:rounded-xl rounded-t-2xl flex flex-col overflow-hidden"
        style={{ maxHeight: '88vh' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
          <h2 className="text-lg font-bold">Choose a GIF</h2>
          <button onClick={onClose} className="p-2 rounded-full hover:bg-muted transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Search */}
        <div className="px-3 py-2 border-b border-border shrink-0">
          <form onSubmit={handleSearchSubmit} className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            <Input
              ref={inputRef}
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search GIFs…"
              className="pl-9 h-9 rounded-full text-sm"
            />
          </form>
        </div>

        {/* Category chips */}
        <div className="flex gap-2 px-3 py-2 overflow-x-auto shrink-0 scrollbar-hide border-b border-border">
          {CATEGORIES.map(c => (
            <button
              key={c.id}
              onClick={() => { setCategory(c.id); setQuery(''); }}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap shrink-0 transition-colors ${
                category === c.id
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted hover:bg-muted/70'
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>

        {/* GIF Grid */}
        <div className="flex-1 overflow-y-auto p-2 min-h-0">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
          ) : gifs.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground text-sm">No GIFs found. Try a different search.</div>
          ) : (
            <>
              {isFallback && (
                <p className="text-xs text-center text-muted-foreground mb-2">Showing popular GIFs</p>
              )}
              <div className="columns-2 md:columns-3 gap-2 space-y-2">
                {gifs.filter(gif => !failedGifs.has(gif.id)).map(gif => (
                  <button
                    key={gif.id}
                    onClick={() => { onSelect(gif.url); onClose(); }}
                    className="break-inside-avoid w-full rounded-xl overflow-hidden bg-muted hover:ring-2 hover:ring-primary transition-all block"
                  >
                    <img
                      src={gif.preview || gif.url}
                      alt="GIF"
                      className="w-full object-cover"
                      loading="lazy"
                      onError={() => {
                        setFailedGifs(prev => {
                          const next = new Set(prev);
                          next.add(gif.id);
                          return next;
                        });
                      }}
                    />
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="shrink-0 py-2 border-t border-border text-center">
          <p className="text-xs text-muted-foreground">Powered by <strong>Tenor</strong></p>
        </div>
      </div>
    </div>
  );
}
