import { useEffect, useState } from 'react';
import { ArrowRight, ExternalLink, Newspaper, Trophy } from 'lucide-react';
import { supabaseUrl } from '@/lib/supabase';

type SportsStory = {
  id: string;
  title: string;
  excerpt?: string | null;
  canonical_url: string;
  image_url?: string | null;
  published_at: string;
  category?: string | null;
  testagram_rss_source_profiles?: { display_name?: string | null } | null;
};

type Props = {
  surface: 'home' | 'discover' | 'search';
  query?: string;
  limit?: number;
  compact?: boolean;
};

const SPORTS_QUERY = /\b(sport|sports|football|soccer|premier league|champions league|arsenal|chelsea|manchester|liverpool|real madrid|barcelona|cricket|rugby|basketball|nba|tennis|formula ?1|f1|athletics|olympics|score|scores|fixture|fixtures|transfer|transfers|goal|goals|league|afcon|epl|gor mahia|afc leopards|harambee stars|shabana|kenya premier league)\b/i;

function age(value: string) {
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return '';
  const minutes = Math.max(0, Math.floor((Date.now() - time) / 60000));
  return minutes < 60 ? minutes + 'm ago' : minutes < 1440 ? Math.floor(minutes / 60) + 'h ago' : Math.floor(minutes / 1440) + 'd ago';
}

export function OrganicSportsStories({ surface, query = '', limit = 3, compact = false }: Props) {
  const [stories, setStories] = useState<SportsStory[]>([]);
  const [loading, setLoading] = useState(true);
  const relevant = surface !== 'search' || (query.trim().length > 0 && SPORTS_QUERY.test(query));

  useEffect(() => {
    if (!relevant) { setStories([]); setLoading(false); return; }
    let active = true;
    const controller = new AbortController();
    const params = new URLSearchParams({ limit: String(Math.min(8, Math.max(1, limit))), category: 'sports' });
    if (surface === 'search' && query.trim()) params.set('q', query.trim().slice(0, 100));
    setLoading(true);
    const timer = window.setTimeout(() => {
      fetch(supabaseUrl + '/functions/v1/testagram-rss-feed?' + params.toString(), {
        headers: { Accept: 'application/json' },
        credentials: 'omit',
        signal: controller.signal,
      }).then(async response => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload?.error || 'Sports stories unavailable');
        if (active) setStories(Array.isArray(payload?.items) ? payload.items as SportsStory[] : []);
      }).catch((error: unknown) => {
        if (active && (error as { name?: string })?.name !== 'AbortError') setStories([]);
      }).finally(() => { if (active) setLoading(false); });
    }, surface === 'search' ? 250 : 0);
    return () => { active = false; window.clearTimeout(timer); controller.abort(); };
  }, [surface, query, limit, relevant]);

  if (!relevant || (!loading && stories.length === 0)) return null;

  return (
    <section aria-label="Sports stories" className={compact ? 'my-3' : 'my-4'}>
      <div className="flex items-center justify-between gap-3 px-4 mb-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-primary"><Trophy className="h-3.5 w-3.5" /> Sports in your feed</div>
          <h2 className="mt-1 text-lg font-bold">{surface === 'search' ? 'Sports stories matching your search' : surface === 'discover' ? 'Trending from the sports world' : 'Latest sports headlines'}</h2>
        </div>
        <a href="/sports" className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-primary hover:underline">All sports <ArrowRight className="h-3.5 w-3.5" /></a>
      </div>
      {loading && stories.length === 0 ? (
        <div className="mx-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="h-24 animate-pulse rounded-xl bg-muted" />
          {!compact && <div className="h-24 animate-pulse rounded-xl bg-muted" />}
        </div>
      ) : (
        <div className={compact ? 'flex gap-3 overflow-x-auto px-4 pb-2' : 'grid gap-3 px-4 sm:grid-cols-2'}>
          {stories.slice(0, limit).map(story => (
            <article key={story.id} className={compact ? 'w-[min(82vw,320px)] shrink-0 overflow-hidden rounded-xl border bg-card' : 'overflow-hidden rounded-xl border bg-card'}>
              {story.image_url && <a href={story.canonical_url} target="_blank" rel="noreferrer" aria-label={'Read ' + story.title}><img src={story.image_url} alt="" loading="lazy" decoding="async" className={compact ? 'h-28 w-full object-cover' : 'h-36 w-full object-cover'} /></a>}
              <div className="p-3">
                <div className="mb-1 flex items-center gap-1.5 text-[11px] text-muted-foreground"><Newspaper className="h-3 w-3 shrink-0" /><span className="truncate">{story.testagram_rss_source_profiles?.display_name || 'Sports publisher'}</span>{story.published_at && <><span>·</span><span className="shrink-0">{age(story.published_at)}</span></>}</div>
                <h3 className="line-clamp-2 text-sm font-bold leading-snug">{story.title}</h3>
                {!compact && story.excerpt && <p className="mt-1.5 line-clamp-2 text-xs leading-5 text-muted-foreground">{story.excerpt}</p>}
                <a href={story.canonical_url} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">Read at source <ExternalLink className="h-3 w-3" /></a>
              </div>
            </article>
          ))}
        </div>
      )}
      <p className="px-4 pt-2 text-[10px] text-muted-foreground">Publisher headlines · Open the original report for full coverage.</p>
    </section>
  );
}
