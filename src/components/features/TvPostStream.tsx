import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Globe2, Radio, RefreshCw } from 'lucide-react';
import { TV_SOURCES, loadTvSource, type TvChannel } from '@/services/tvChannelCatalog';
import { supabaseUrl } from '@/lib/supabase';

const loadTvPlayer = () => import('@/components/features/TvChannelPlayer').then(module => ({ default: module.TvChannelPlayer }));
const TvChannelPlayer = lazy(loadTvPlayer);

const MAX_POSTS = 8;
const PREWARM_CONCURRENCY = 2;
const PREWARM_TIMEOUT_MS = 5000;
let runtimeWarmPromise: Promise<void> | null = null;
let prewarmedUrls = new Set<string>();

function proxyUrl(url: string) {
  return supabaseUrl + '/functions/v1/tv-stream-proxy?url=' + encodeURIComponent(url);
}

async function prewarmUrl(url: string) {
  if (prewarmedUrls.has(url)) return;
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), PREWARM_TIMEOUT_MS);
  try {
    const response = await fetch(proxyUrl(url), {
      method: 'GET',
      headers: { Range: 'bytes=0-4095', Accept: 'application/vnd.apple.mpegurl,application/x-mpegURL,video/*,*/*;q=0.5' },
      cache: 'no-store',
      signal: controller.signal,
    });
    if (response.ok || response.status === 206) prewarmedUrls.add(url);
  } catch {
    // Background warming is best-effort; playback performs its own retries/fallbacks.
  } finally {
    window.clearTimeout(timer);
  }
}

async function warmTvRuntime() {
  if (runtimeWarmPromise) return runtimeWarmPromise;
  runtimeWarmPromise = (async () => {
    // Start downloading the player chunk before the first TV card enters view.
    void loadTvPlayer().catch(() => undefined);
    const items = await loadLivePool();
    let cursor = 0;
    const worker = async () => {
      while (cursor < items.length) {
        const item = items[cursor++];
        await prewarmUrl(item.url);
      }
    };
    await Promise.all(Array.from({ length: Math.min(PREWARM_CONCURRENCY, items.length) }, worker));
  })().finally(() => { runtimeWarmPromise = null; });
  return runtimeWarmPromise;
}

const HIDDEN = /^\/(auth|admin|settings|wallet|messages|notifications|help|premium|create-ad|my-ads|ad-|rewards|verify|privacy|terms|policy|regulator|sessions|blocked|appeals|payouts|revenue|analytics|news\/|tv)(?:\/|$)/;

let pool: TvChannel[] = [];
let poolPromise: Promise<TvChannel[]> | null = null;
let activeCache: { at: number; items: TvChannel[] } = { at: 0, items: [] };

function sleep(signal: AbortSignal) {
  return new Promise<void>(resolve => {
    const id = window.setTimeout(resolve, 0);
    if (signal.aborted) {
      window.clearTimeout(id);
      resolve();
    }
  });
}

async function loadLivePool(signal?: AbortSignal): Promise<TvChannel[]> {
  if (pool.length) return pool;
  if (activeCache.items.length && Date.now() - activeCache.at < 60_000) {
    pool = activeCache.items;
    return pool;
  }
  if (poolPromise) return poolPromise;

  poolPromise = (async () => {
    const seen = new Set<string>();
    const result: TvChannel[] = [];
    for (const source of TV_SOURCES.filter(source => source.enabled !== false)) {
      if (signal?.aborted || result.length >= MAX_POSTS) break;
      try {
        const rows = await loadTvSource(source, signal);
        for (const item of rows) {
          if (signal?.aborted) break;
          if (item.live !== true) continue;
          const key = item.url.toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          result.push(item);
          if (result.length >= MAX_POSTS) break;
        }
      } catch {
        // One source being unavailable must not prevent other sources from contributing.
      }
    }
    pool = result;
    activeCache = { at: Date.now(), items: result };
    return result;
  })().finally(() => {
    poolPromise = null;
  });

  return poolPromise;
}

export function TvPostStream({ index = 0 }: { index?: number }) {
  const { pathname } = useLocation();

  useEffect(() => {
    if (HIDDEN.test(pathname)) return;
    void warmTvRuntime();
  }, [pathname]);
  const hostRef = useRef<HTMLElement>(null);
  const [nearViewport, setNearViewport] = useState(false);
  const [channel, setChannel] = useState<TvChannel | null>(null);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(false);

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
    }, { rootMargin: '900px 0px' });
    observer.observe(el);
    return () => observer.disconnect();
  }, [pathname]);

  useEffect(() => {
    if (HIDDEN.test(pathname) || !nearViewport || channel || loading) return;
    const controller = new AbortController();
    let alive = true;
    setLoading(true);
    void loadLivePool(controller.signal).then(items => {
      if (alive) setChannel(items[index] ?? null);
    }).finally(() => {
      if (alive) setLoading(false);
    });
    return () => {
      alive = false;
      controller.abort();
    };
  }, [index, loading, nearViewport, pathname, channel]);

  if (HIDDEN.test(pathname)) return null;

  if (!channel && !loading) return null;

  return (
    <article ref={hostRef} aria-label={channel ? `Live TV: ${channel.name}` : 'Live TV'} className='border-b border-border bg-background'>
      {channel ? (
        <>
          <div className='px-4 pt-3 pb-2 flex items-center gap-3'>
            {channel.logo ? (
              <img src={channel.logo} alt='' loading='lazy' decoding='async' className='h-9 w-9 rounded-full object-contain bg-muted' />
            ) : (
              <span className='flex h-9 w-9 items-center justify-center rounded-full bg-muted'><Radio className='h-4 w-4' /></span>
            )}
            <div className='min-w-0'>
              <p className='font-bold text-sm truncate'>{channel.name}</p>
              <p className='text-[11px] text-muted-foreground truncate'>
                {channel.country || 'International'}{channel.group ? ` · ${channel.group}` : ''} · Live TV
              </p>
            </div>
            <span className='ml-auto inline-flex items-center gap-1.5 text-[10px] font-bold text-red-500'>
              <span className='h-1.5 w-1.5 rounded-full bg-red-500' /> LIVE
            </span>
          </div>
          <Suspense fallback={<div className='aspect-video bg-muted animate-pulse flex items-center justify-center'><RefreshCw className='h-4 w-4 animate-spin text-muted-foreground' /></div>}>
            <TvChannelPlayer
              channel={channel}
              active={active}
              onVisible={(id, visible) => setActive(visible && id === channel.id)}
              onHealth={() => {}}
            />
          </Suspense>
          <div className='px-4 py-2 flex items-center gap-2 text-[10px] text-muted-foreground'>
            <Globe2 className='h-3 w-3 shrink-0' />
            <span>{channel.country || 'International'}</span>
            {channel.group ? <><span>·</span><span className='truncate'>{channel.group}</span></> : null}
            <span className='ml-auto'>Verified live source</span>
          </div>
        </>
      ) : (
        <div className='px-4 py-4 flex items-center gap-2 text-xs text-muted-foreground'>
          <RefreshCw className='h-3.5 w-3.5 animate-spin' /> Finding a live channel…
        </div>
      )}
    </article>
  );
}
