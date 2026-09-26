import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Radio, Globe2, RefreshCw } from 'lucide-react';
import { TvChannelPlayer } from '@/components/features/TvChannelPlayer';
import { TV_SOURCES, loadTvSource, type TvChannel } from '@/services/tvChannelCatalog';

const CACHE_TTL = 60_000;
const MAX_POSTS = 8;
const HIDDEN = /^(\\/(auth|admin|settings|wallet|messages|notifications|help|premium|create-ad|my-ads|ad-|rewards|verify|privacy|terms|policy|regulator|sessions|blocked|appeals|payouts|revenue|analytics|news\\/|tv)(?:\\/|$))/;
let cache: { at: number; items: TvChannel[] } = { at: 0, items: [] };

function sleep(signal: AbortSignal) {
  return new Promise<void>(resolve => {
    const id = window.setTimeout(resolve, 0);
    if (signal.aborted) {
      window.clearTimeout(id);
      resolve();
    }
  });
}

export function TvPostStream() {
  const { pathname } = useLocation();
  const hostRef = useRef<HTMLDivElement>(null);
  const [nearViewport, setNearViewport] = useState(false);
  const [items, setItems] = useState<TvChannel[]>([]);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (HIDDEN.test(pathname)) return;
    const el = hostRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setNearViewport(true);
      return;
    }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        setNearViewport(true);
        observer.disconnect();
      }
    }, { rootMargin: '1000px 0px' });
    observer.observe(el);
    return () => observer.disconnect();
  }, [pathname]);

  useEffect(() => {
    if (HIDDEN.test(pathname) || !nearViewport || items.length || loading) return;
    const controller = new AbortController();
    let alive = true;

    const run = async () => {
      setLoading(true);
      const seen = new Set<string>();
      const sources = TV_SOURCES.filter(source => source.enabled !== false);

      try {
        if (cache.items.length && Date.now() - cache.at < CACHE_TTL) {
          for (const item of cache.items.slice(0, MAX_POSTS)) {
            if (!alive || controller.signal.aborted) return;
            setItems(current => current.some(existing => existing.id === item.id) ? current : [...current, item]);
            await sleep(controller.signal);
          }
          setDone(true);
          return;
        }

        for (const source of sources) {
          if (!alive || controller.signal.aborted || items.length >= MAX_POSTS) break;
          try {
            const rows = await loadTvSource(source, controller.signal);
            for (const item of rows) {
              if (!alive || controller.signal.aborted) return;
              if (item.live !== true) continue;
              const key = item.url.toLowerCase();
              if (seen.has(key)) continue;
              seen.add(key);
              cache.items = [...cache.items, item].slice(0, MAX_POSTS);
              cache.at = Date.now();
              setItems(current => current.some(existing => existing.url.toLowerCase() === key) ? current : [...current, item]);
              await sleep(controller.signal);
              if (cache.items.length >= MAX_POSTS) break;
            }
          } catch {
            // A single source failure must not break the feed; continue to the next source.
          }
          if (cache.items.length >= MAX_POSTS) break;
        }
        setDone(true);
      } finally {
        if (alive) setLoading(false);
      }
    };

    void run();
    return () => {
      alive = false;
      controller.abort();
    };
  }, [nearViewport, pathname]);

  if (HIDDEN.test(pathname)) return null;

  return (
    <section ref={hostRef} aria-label='Live TV posts' className='border-y border-border bg-background px-3 py-4'>
      <div className='mb-3 flex items-center gap-2'>
        <Radio className='h-4 w-4 text-red-500' />
        <div>
          <h2 className='text-sm font-bold'>Live TV posts</h2>
          <p className='mt-0.5 text-[11px] text-muted-foreground'>
            Public live channels injected into the feed · verified on demand · no stream files stored by Testagram
          </p>
        </div>
      </div>

      {!items.length && loading ? (
        <div className='rounded-2xl border border-border bg-card p-4 text-xs text-muted-foreground flex items-center gap-2'>
          <RefreshCw className='h-3.5 w-3.5 animate-spin' /> Finding a live channel…
        </div>
      ) : null}

      <div role='feed' aria-busy={loading} className='space-y-3'>
        {items.map((channel, index) => (
          <article
            key={channel.id}
            aria-posinset={index + 1}
            aria-setsize={items.length}
            className='space-y-0'
          >
            <div className='flex items-center gap-2 px-1 pb-2'>
              {channel.logo ? (
                <img src={channel.logo} alt='' loading='lazy' decoding='async' className='h-6 w-6 rounded-full object-contain bg-muted' />
              ) : (
                <span className='flex h-6 w-6 items-center justify-center rounded-full bg-muted'><Radio className='h-3.5 w-3.5' /></span>
              )}
              <span className='text-[11px] font-bold truncate'>{channel.name}</span>
              <span className='ml-auto text-[10px] text-red-500 font-bold'>LIVE</span>
            </div>
            <TvChannelPlayer
              channel={channel}
              active={false}
              onVisible={() => {}}
              onHealth={() => {}}
            />
            <div className='flex items-center gap-2 px-1 pt-2 text-[10px] text-muted-foreground'>
              <Globe2 className='h-3 w-3' />
              <span>{channel.country || 'International'}</span>
              {channel.group ? <><span>·</span><span className='truncate'>{channel.group}</span></> : null}
              <span className='ml-auto'>Feed post {index + 1}</span>
            </div>
          </article>
        ))}
      </div>

      {loading && items.length > 0 ? (
        <div className='py-4 text-center text-[11px] text-muted-foreground flex items-center justify-center gap-2'>
          <RefreshCw className='h-3.5 w-3.5 animate-spin' /> Loading the next live post…
        </div>
      ) : null}

      {!loading && !done && !items.length ? (
        <div className='rounded-2xl border border-border bg-card p-4 text-xs text-muted-foreground'>
          Live TV is temporarily unavailable.
        </div>
      ) : null}
    </section>
  );
}
