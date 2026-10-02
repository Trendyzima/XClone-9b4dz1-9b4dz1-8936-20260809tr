import { useCallback, useEffect, useState } from 'react';
import { ExternalLink, Globe2, Loader2, RefreshCw, Newspaper } from 'lucide-react';
import { supabaseUrl } from '@/lib/supabase';

type NewsItem = {
  id: string;
  newsify_item_id: string;
  newsify_trend_id?: string | null;
  trend_title?: string | null;
  title: string;
  excerpt?: string | null;
  detail_url?: string | null;
  source_url?: string | null;
  source_name?: string | null;
  geo: string;
  language: string;
  importance_score?: number | null;
  importance_tier?: number | null;
  trend_traffic?: number | null;
  published_at: string;
  fetched_at: string;
};

const GEOS = ['US', 'GB', 'DE', 'FR', 'ES', 'CA', 'AU', 'SG', 'TR', 'NL', 'PL', 'SE', 'RO', 'BR', 'HU', 'LT'];

function formatAge(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const minutes = Math.max(0, Math.round((Date.now() - date.getTime()) / 60000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return date.toLocaleDateString();
}

export default function NewsifyNewsPage() {
  const [geo, setGeo] = useState('US');
  const [items, setItems] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true);
    else setLoading(true);
    setError('');
    try {
      const response = await fetch(
        `${supabaseUrl}/functions/v1/newsify-feed?geo=${encodeURIComponent(geo)}&language=english&limit=25`,
        { headers: { Accept: 'application/json' }, credentials: 'omit', cache: 'no-store' },
      );
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error ?? 'Unable to load Newsify stories');
      setItems(Array.isArray(payload?.items) ? payload.items : []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load Newsify stories');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [geo]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(true), 60_000);
    return () => window.clearInterval(timer);
  }, [load]);

  useEffect(() => {
    document.title = 'Testagram News — Live Newsify Trends';
    const description = 'Live trending stories from Newsify, refreshed through Testagram\'s news delivery layer.';
    let meta = document.querySelector('meta[name="description"]') as HTMLMetaElement | null;
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = 'description';
      document.head.appendChild(meta);
    }
    meta.content = description;
  }, []);

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
        <header className="mb-6 rounded-3xl border bg-card p-5 shadow-sm sm:p-7">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-primary">
                <Newspaper className="h-4 w-4" />
                TESTAGRAM.NEWS
              </div>
              <h1 className="text-3xl font-black tracking-tight sm:text-4xl">Live news, refreshed automatically.</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                Testagram receives current Newsify trends through a server-side sync, stores a short-lived cache,
                and serves the feed without exposing the Newsify worker credentials to browsers.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void load(true)}
              disabled={refreshing}
              className="inline-flex shrink-0 items-center justify-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold hover:bg-muted disabled:opacity-60"
            >
              <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>

          <div className="mt-5 flex items-center gap-2 overflow-x-auto pb-1">
            <Globe2 className="h-4 w-4 shrink-0 text-muted-foreground" />
            {GEOS.map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setGeo(value)}
                className={`rounded-full px-3 py-1.5 text-xs font-bold transition ${geo === value ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/70'}`}
              >
                {value}
              </button>
            ))}
          </div>
        </header>

        {loading ? (
          <div className="flex min-h-64 items-center justify-center rounded-3xl border bg-card">
            <Loader2 className="h-7 w-7 animate-spin text-primary" />
          </div>
        ) : error ? (
          <div className="rounded-3xl border bg-card p-6">
            <h2 className="font-bold">News feed temporarily unavailable</h2>
            <p className="mt-2 text-sm text-muted-foreground">{error}</p>
            <button type="button" onClick={() => void load(true)} className="mt-4 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">
              Try again
            </button>
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-3xl border bg-card p-6 text-sm text-muted-foreground">
            No current stories are available for {geo}. The next Newsify sync will repopulate the cache automatically.
          </div>
        ) : (
          <section className="grid gap-4 md:grid-cols-2">
            {items.map((item) => {
              const href = item.detail_url || item.source_url || '#';
              return (
                <article key={item.id || item.newsify_item_id} className="rounded-3xl border bg-card p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
                  <div className="flex items-center justify-between gap-3 text-[11px] font-semibold text-muted-foreground">
                    <span>{item.source_name || 'Newsify'} · {item.geo}</span>
                    <span>{formatAge(item.published_at)}</span>
                  </div>
                  <h2 className="mt-3 text-xl font-bold leading-tight">{item.title}</h2>
                  {item.trend_title ? <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-primary">{item.trend_title}</p> : null}
                  {item.excerpt ? <p className="mt-3 text-sm leading-6 text-muted-foreground">{item.excerpt}</p> : null}
                  <div className="mt-5 flex items-center justify-between gap-3">
                    <span className="text-[11px] text-muted-foreground">
                      {item.importance_score != null ? `Importance ${item.importance_score}` : 'Live trend'}
                    </span>
                    {href !== '#' ? (
                      <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-sm font-bold text-primary hover:underline">
                        Read story <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </section>
        )}

        <footer className="mt-8 border-t py-5 text-center text-xs text-muted-foreground">
          News provided by Newsify and delivered through Testagram's server-side news cache. Stories link back to their source.
        </footer>
      </div>
    </main>
  );
}
