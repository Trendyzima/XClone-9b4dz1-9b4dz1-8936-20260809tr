import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { TopBar } from '@/components/layout/TopBar';
import { supabase } from '@/lib/supabase';
import { useSEO } from '@/hooks/useSEO';
import { formatNumber } from '@/lib/utils';
import {
  Search, Loader2, Headphones, Play, Clock, Users,
  Video, Star, X, SlidersHorizontal, Radio, ChevronRight,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { intervalToDuration } from 'date-fns';
import { PageAdBanner } from '@/components/features/AdSenseAd';

function PodcastSearchAdBanner() { return <PageAdBanner />; }

// Module-level constants — esbuild-safe
const SEARCH_DEBOUNCE_MS = 380;
const RESULTS_PER_PAGE   = 20;

const POD_CATEGORIES = [
  { id: 'all',           label: 'All',           emoji: '🎙️' },
  { id: 'technology',    label: 'Tech',           emoji: '💻' },
  { id: 'business',      label: 'Business',       emoji: '💼' },
  { id: 'entertainment', label: 'Entertainment',  emoji: '🎭' },
  { id: 'education',     label: 'Education',      emoji: '📚' },
  { id: 'news',          label: 'News',           emoji: '📰' },
  { id: 'comedy',        label: 'Comedy',         emoji: '😂' },
  { id: 'music',         label: 'Music',          emoji: '🎵' },
  { id: 'health',        label: 'Health',         emoji: '🏃' },
  { id: 'sports',        label: 'Sports',         emoji: '⚽' },
] as const;

const DURATION_FILTERS = [
  { id: 'any',    label: 'Any length',  min: 0,    max: 999999 },
  { id: 'short',  label: '< 15 min',   min: 0,    max: 900   },
  { id: 'medium', label: '15–60 min',  min: 900,  max: 3600  },
  { id: 'long',   label: '60+ min',    min: 3600, max: 999999},
] as const;
type DurationFilter = typeof DURATION_FILTERS[number]['id'];

function formatDur(secs: number) {
  if (!secs || secs < 1) return null;
  const d = intervalToDuration({ start: 0, end: secs * 1000 });
  if ((d.hours ?? 0) > 0) return `${d.hours}h ${d.minutes ?? 0}m`;
  return `${d.minutes ?? 0}m`;
}

export default function PodcastSearchPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialQuery = searchParams.get('q') ?? '';

  const [query,      setQuery]      = useState(initialQuery);
  const [results,    setResults]    = useState<any[]>([]);
  const [loading,    setLoading]    = useState(false);
  const [hasMore,    setHasMore]    = useState(false);
  const [page,       setPage]       = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [category,   setCategory]   = useState('all');
  const [duration,   setDuration]   = useState<DurationFilter>('any');
  const [videoOnly,  setVideoOnly]  = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [totalCount, setTotalCount] = useState(0);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef    = useRef<HTMLInputElement>(null);

  useSEO({
    title: query ? `"${query}" — Podcast Search` : 'Search Podcasts & Spaces',
    description: 'Search across all podcast episodes and audio space recordings on Testagram. Filter by category, duration, and more.',
    url: '/podcasts/search',
    keywords: 'podcast search, testagram spaces, audio episodes, search podcasts',
  });

  const fetchResults = useCallback(async (q: string, cat: string, dur: DurationFilter, vid: boolean, pg: number) => {
    if (pg === 0) setLoading(true); else setLoadingMore(true);
    try {
      const durMeta = DURATION_FILTERS.find(d => d.id === dur) ?? DURATION_FILTERS[0];
      let builder = supabase
        .from('space_recordings')
        .select(`
          id, title, audio_url, video_url, has_video, duration, listener_count, created_at,
          profiles(id, username, avatar_url, verified_tier),
          spaces(title, description, category, artwork_url, episode_number, tags, subscriber_only)
        `, { count: 'exact' })
        .order('listener_count', { ascending: false })
        .range(pg * RESULTS_PER_PAGE, (pg + 1) * RESULTS_PER_PAGE - 1);

      if (q.trim()) {
        builder = builder.or(`title.ilike.%${q.trim()}%,spaces.title.ilike.%${q.trim()}%`);
      }
      if (cat !== 'all') {
        builder = builder.eq('spaces.category', cat);
      }
      if (vid) {
        builder = builder.eq('has_video', true);
      }
      if (durMeta.min > 0) builder = builder.gte('duration', durMeta.min);
      if (durMeta.max < 999999) builder = builder.lte('duration', durMeta.max);

      const { data, count, error } = await builder;
      if (error) throw error;

      const list = data ?? [];
      if (pg === 0) setResults(list); else setResults(prev => [...prev, ...list]);
      setTotalCount(count ?? 0);
      setHasMore(list.length === RESULTS_PER_PAGE);
      setPage(pg);
    } catch (err) {
      console.error('Podcast search error:', err);
    } finally {
      if (pg === 0) setLoading(false); else setLoadingMore(false);
    }
  }, []);

  // Debounced search on query/filter change
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setSearchParams(query ? { q: query } : {}, { replace: true });
      fetchResults(query, category, duration, videoOnly, 0);
    }, SEARCH_DEBOUNCE_MS);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, category, duration, videoOnly]);

  // Focus input on mount
  useEffect(() => { inputRef.current?.focus(); }, []);

  return (
    <div className="min-h-screen bg-background pb-20">
      <TopBar title="Podcast Search" showBack />
      <PodcastSearchAdBanner />

      {/* ── Hero search ── */}
      <div className="bg-gradient-to-br from-primary/10 to-purple-500/5 border-b border-border px-4 py-4">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
            <Radio className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="font-black text-lg leading-tight">Find Podcasts</h1>
            <p className="text-xs text-muted-foreground">Search episodes by title, host, or topic</p>
          </div>
        </div>

        <div className="relative mb-2">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search podcasts, hosts, topics…"
            className="w-full h-11 pl-9 pr-10 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
          {query && (
            <button onClick={() => setQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Filters toggle */}
        <button
          onClick={() => setShowFilters(v => !v)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-semibold transition-all ${
            showFilters || category !== 'all' || duration !== 'any' || videoOnly
              ? 'border-primary/30 bg-primary/10 text-primary'
              : 'border-border text-muted-foreground hover:text-foreground'
          }`}
        >
          <SlidersHorizontal className="w-3.5 h-3.5" />
          Filters
          {(category !== 'all' || duration !== 'any' || videoOnly) && (
            <span className="w-1.5 h-1.5 rounded-full bg-primary" />
          )}
        </button>

        {/* Expanded filters */}
        {showFilters && (
          <div className="mt-3 space-y-3 pt-3 border-t border-border">
            {/* Category */}
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">Category</p>
              <div className="flex gap-1.5 overflow-x-auto scrollbar-hide pb-1">
                {POD_CATEGORIES.map(cat => (
                  <button key={cat.id} onClick={() => setCategory(cat.id)}
                    className={`flex items-center gap-1 px-2.5 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap shrink-0 transition-all ${
                      category === cat.id ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground'
                    }`}>
                    <span>{cat.emoji}</span>{cat.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Duration */}
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">Duration</p>
              <div className="flex gap-1.5 flex-wrap">
                {DURATION_FILTERS.map(d => (
                  <button key={d.id} onClick={() => setDuration(d.id)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-all ${
                      duration === d.id ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:border-primary/30'
                    }`}>
                    {d.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Video only */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => setVideoOnly(v => !v)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs font-bold transition-all ${
                  videoOnly ? 'border-blue-500/30 bg-blue-500/10 text-blue-600' : 'border-border text-muted-foreground hover:border-blue-500/30'
                }`}
              >
                <Video className="w-3.5 h-3.5" />
                Video episodes only
              </button>
              {(category !== 'all' || duration !== 'any' || videoOnly) && (
                <button
                  onClick={() => { setCategory('all'); setDuration('any'); setVideoOnly(false); }}
                  className="text-xs text-muted-foreground hover:text-destructive transition-colors ml-auto"
                >
                  Clear all
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Category pills (always visible when not in filter panel) */}
      {!showFilters && (
        <div className="flex gap-2 px-4 py-2.5 overflow-x-auto scrollbar-hide border-b border-border">
          {POD_CATEGORIES.map(cat => (
            <button key={cat.id} onClick={() => setCategory(cat.id)}
              className={`flex items-center gap-1 px-2.5 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap shrink-0 transition-all ${
                category === cat.id ? 'bg-primary text-primary-foreground' : 'bg-muted/60 text-muted-foreground hover:text-foreground'
              }`}>
              <span>{cat.emoji}</span>{cat.label}
            </button>
          ))}
        </div>
      )}

      {/* Results count */}
      {!loading && (query.trim() || category !== 'all' || duration !== 'any' || videoOnly) && (
        <div className="px-4 py-2.5 flex items-center gap-2">
          <Headphones className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">
            {totalCount > 0 ? `${totalCount.toLocaleString()} episode${totalCount !== 1 ? 's' : ''} found` : 'No episodes found'}
          </span>
          {query.trim() && (
            <span className="text-xs font-bold text-primary ml-1">for "{query}"</span>
          )}
        </div>
      )}

      {/* Results */}
      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="w-7 h-7 animate-spin text-primary" />
        </div>
      ) : results.length === 0 && (query.trim() || category !== 'all') ? (
        <div className="text-center py-16 px-6 text-muted-foreground">
          <Headphones className="w-14 h-14 mx-auto mb-3 opacity-20" />
          <p className="font-semibold">No episodes found</p>
          <p className="text-sm mt-1">Try a different search or remove some filters</p>
        </div>
      ) : results.length === 0 ? (
        <div className="text-center py-16 px-6 text-muted-foreground">
          <Radio className="w-14 h-14 mx-auto mb-3 opacity-20" />
          <p className="font-semibold">Search for podcast episodes</p>
          <p className="text-sm mt-1">Type a keyword, host name, or topic above</p>
        </div>
      ) : (
        <div className="divide-y divide-border">
          {results.map((rec: any) => {
            const recDur    = formatDur(rec.duration);
            const isVideo   = rec.has_video && rec.video_url;
            const isSub     = rec.spaces?.subscriber_only;
            const epNum     = rec.spaces?.episode_number ?? null;
            const catId     = rec.spaces?.category ?? '';
            const catMeta   = POD_CATEGORIES.find(c => c.id === catId);
            const artwork   = rec.spaces?.artwork_url ?? null;
            const tags: string[] = rec.spaces?.tags ?? [];
            const hostName  = rec.user_profiles?.username ?? '';
            const verified  = rec.user_profiles?.verified ?? false;
            return (
              <div
                key={rec.id}
                className="flex items-start gap-3 p-4 hover:bg-muted/15 transition-colors cursor-pointer"
                onClick={() => navigate(`/space-recording/${rec.id}`)}
              >
                {/* Artwork */}
                <div className="w-14 h-14 rounded-xl overflow-hidden bg-gradient-to-br from-primary/15 to-purple-500/10 shrink-0 shadow-sm flex items-center justify-center">
                  {artwork
                    ? <img src={artwork} alt="" className="w-full h-full object-cover" />
                    : <span className="text-xl">{catMeta?.emoji ?? '🎙️'}</span>}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
                    {catMeta && <span className="text-[10px] text-muted-foreground">{catMeta.emoji} {catMeta.label}</span>}
                    {epNum    && <span className="text-[10px] text-muted-foreground">· Ep. {epNum}</span>}
                    {isVideo  && <span className="text-[10px] text-primary flex items-center gap-0.5"><Video className="w-2.5 h-2.5" />Video</span>}
                    {isSub    && <span className="text-[10px] text-amber-600 flex items-center gap-0.5"><Star className="w-2.5 h-2.5" />Sub</span>}
                  </div>
                  <p className="font-bold text-sm leading-snug line-clamp-2">{rec.spaces?.title ?? rec.title}</p>
                  {rec.spaces?.description && (
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{rec.spaces.description}</p>
                  )}

                  <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                    <div className="flex items-center gap-1">
                      <div className="w-4 h-4 rounded-full bg-muted overflow-hidden shrink-0">
                        {rec.user_profiles?.avatar_url
                          ? <img src={rec.user_profiles.avatar_url} className="w-full h-full object-cover" alt="" />
                          : <div className="w-full h-full flex items-center justify-center text-[8px] font-bold">{hostName[0]?.toUpperCase()}</div>}
                      </div>
                      <span className="text-[10px] text-muted-foreground">@{hostName}</span>
                      {verified && <span className="text-[8px] text-primary font-bold">✓</span>}
                    </div>
                    {recDur && (
                      <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground">
                        <Clock className="w-2.5 h-2.5" />{recDur}
                      </span>
                    )}
                    {(rec.listener_count ?? 0) > 0 && (
                      <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground">
                        <Users className="w-2.5 h-2.5" />{formatNumber(rec.listener_count)}
                      </span>
                    )}
                    <span className="text-[10px] text-muted-foreground">
                      {formatDistanceToNow(new Date(rec.created_at), { addSuffix: true })}
                    </span>
                  </div>

                  {tags.length > 0 && (
                    <div className="flex gap-1 mt-1.5 flex-wrap">
                      {tags.slice(0, 3).map((tag: string) => (
                        <span key={tag} className="text-[9px] bg-muted px-1.5 py-0.5 rounded-full text-muted-foreground">#{tag}</span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Play button */}
                <button
                  onClick={e => { e.stopPropagation(); navigate(`/space-recording/${rec.id}`); }}
                  className="w-10 h-10 rounded-full bg-primary/10 hover:bg-primary/20 flex items-center justify-center transition-colors shrink-0"
                >
                  <Play className="w-4 h-4 text-primary ml-0.5" fill="currentColor" />
                </button>
              </div>
            );
          })}

          {/* Load more */}
          {hasMore && (
            <div className="flex justify-center py-6">
              <button
                onClick={() => fetchResults(query, category, duration, videoOnly, page + 1)}
                disabled={loadingMore}
                className="flex items-center gap-2 px-5 py-2.5 border border-border rounded-full text-sm font-semibold hover:bg-muted transition-colors disabled:opacity-50"
              >
                {loadingMore ? <Loader2 className="w-4 h-4 animate-spin" /> : <ChevronRight className="w-4 h-4" />}
                {loadingMore ? 'Loading…' : 'Load more'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
