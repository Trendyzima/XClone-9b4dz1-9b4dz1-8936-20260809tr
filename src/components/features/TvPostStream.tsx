import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Radio, RefreshCw } from 'lucide-react';
import { supabase } from '@/lib/supabase';

type TestagramLive = {
  id: string;
  title: string;
  description: string | null;
  is_live: boolean;
  started_at: string;
  viewer_count: number;
  tv_provider: string;
  youtube_video_id: string | null;
};

const REFRESH_MS = 15_000;
const HIDDEN = /^\/(auth|admin|settings|wallet|messages|notifications|help|premium|create-ad|my-ads|ad-|rewards|verify|privacy|terms|policy|regulator|sessions|blocked|appeals|payouts|revenue|analytics|news\/|tv)(?:\/|$)/;

export function TvPostStream({ index = 0, compact = false }: { index?: number; compact?: boolean }) {
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const hostRef = useRef<HTMLElement>(null);
  const [nearViewport, setNearViewport] = useState(false);
  const [live, setLive] = useState<TestagramLive | null>(null);
  const [loading, setLoading] = useState(false);

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
    if (HIDDEN.test(pathname) || !nearViewport) return;
    let alive = true;

    const load = async () => {
      setLoading(true);
      const from = index;
      const to = index;
      const { data, error } = await supabase
        .from('live_streams')
        .select('id,title,description,is_live,started_at,viewer_count,tv_provider,youtube_video_id')
        .eq('is_live', true)
        .eq('tv_provider', 'youtube')
        .not('youtube_video_id', 'is', null)
        .order('started_at', { ascending: false })
        .range(from, to);

      if (!alive) return;
      if (error) {
        console.warn('[testagram-tv-home] live lookup failed', error);
        setLive(null);
      } else {
        setLive((data?.[0] as TestagramLive | undefined) ?? null);
      }
      setLoading(false);
    };

    void load();

    const channel = supabase
      .channel(`home-testagram-tv-${index}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'live_streams' },
        () => { void load(); },
      )
      .subscribe();

    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, REFRESH_MS);

    return () => {
      alive = false;
      window.clearInterval(timer);
      void supabase.removeChannel(channel);
    };
  }, [index, nearViewport, pathname]);

  if (HIDDEN.test(pathname)) return null;
  if (!live && !loading) return null;

  return (
    <article
      ref={hostRef}
      aria-label={live ? `Live Testagram TV: ${live.title}` : 'Live Testagram TV'}
      className={compact ? 'shrink-0' : 'border-b border-border bg-background'}
    >
      {live ? (
        compact ? (
          <>
            <button
              type='button'
              className='flex flex-col items-center gap-1.5 shrink-0 group'
              aria-label={open ? 'Close Testagram TV live player' : `Watch ${live.title || 'Testagram TV'} live on this page`}
              onClick={() => setOpen(prev => !prev)}
            >
              <div className={`relative w-14 h-14 rounded-full ring-2 ring-offset-2 ring-offset-background overflow-hidden transition-all ${open ? 'ring-red-500' : 'ring-red-500/60 group-hover:ring-red-500'}`}>
                {live.youtube_video_id ? <img src={`https://img.youtube.com/vi/${encodeURIComponent(live.youtube_video_id)}/hqdefault.jpg`} alt='' loading='lazy' className='w-full h-full object-cover' /> : <div className='w-full h-full bg-gradient-to-br from-red-950 to-zinc-950' />}
                <span className='absolute inset-0 flex items-center justify-center bg-black/25'><Radio className='h-5 w-5 text-white' /></span>
                <span className='absolute bottom-0 left-1/2 -translate-x-1/2 h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse ring-2 ring-black/60' />
              </div>
              <span className='text-[10px] font-medium leading-none max-w-16 truncate'>TV Live</span>
            </button>
            {open && live.youtube_video_id && (
              <div className='fixed left-0 right-0 top-0 z-[120] bg-black p-3 pt-16 shadow-2xl'>
                <div className='relative aspect-video overflow-hidden rounded-xl bg-black'>
                  <iframe data-testagram-home-tv='true' className='absolute inset-0 h-full w-full border-0' src={`https://www.youtube.com/embed/${encodeURIComponent(live.youtube_video_id)}?autoplay=1&playsinline=1&mute=0&enablejsapi=1&origin=${encodeURIComponent(typeof window === 'undefined' ? '' : window.location.origin)}`} title={`${live.title || 'Testagram TV'} — Live`} allow='autoplay; encrypted-media; picture-in-picture; fullscreen' allowFullScreen />
                  <button type='button' onClick={() => setOpen(false)} className='absolute right-2 top-2 rounded-full bg-black/70 px-3 py-1.5 text-xs font-bold text-white'>Close</button>
                </div>
                <div className='mt-2 px-1 text-xs text-white/80'><span className='font-bold text-white'>{live.title || 'Testagram TV Live'}</span> · {Number(live.viewer_count ?? 0).toLocaleString()} watching</div>
              </div>
            )}
          </>
        ) : (
          <>
          <button
            type='button'
            className='block w-full text-left group'
            aria-label={open ? 'Close Testagram TV live player' : `Watch ${live.title || 'Testagram TV'} live on this page`}
            onClick={() => setOpen(prev => !prev)}
          >
            <div className='px-4 pt-3 pb-2 flex items-center gap-3'>
              <span className='flex h-9 w-9 items-center justify-center rounded-full bg-red-500/10'>
                <Radio className='h-4 w-4 text-red-500' />
              </span>
              <div className='min-w-0'>
                <p className='font-bold text-sm truncate'>{live.title || 'Testagram TV Live'}</p>
                <p className='text-[11px] text-muted-foreground truncate'>Testagram TV · Live now</p>
              </div>
              <span className='ml-auto inline-flex items-center gap-1.5 text-[10px] font-bold text-red-500'>
                <span className='h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse' /> LIVE
              </span>
            </div>

            <div className='relative aspect-video bg-zinc-950 overflow-hidden'>
              {open && live.youtube_video_id ? (
                <iframe
                  data-testagram-home-tv='true'
                  className='absolute inset-0 h-full w-full border-0'
                  src={`https://www.youtube.com/embed/${encodeURIComponent(live.youtube_video_id)}?autoplay=1&playsinline=1&mute=0&enablejsapi=1&origin=${encodeURIComponent(typeof window === 'undefined' ? '' : window.location.origin)}`}
                  title={`${live.title || 'Testagram TV'} — Live`}
                  allow='autoplay; encrypted-media; picture-in-picture; fullscreen'
                  allowFullScreen
                />
              ) : live.youtube_video_id ? (
                <img
                  src={`https://img.youtube.com/vi/${encodeURIComponent(live.youtube_video_id)}/hqdefault.jpg`}
                  alt=''
                  loading='lazy'
                  className='absolute inset-0 h-full w-full object-cover opacity-75 transition group-hover:opacity-90'
                />
              ) : (
                <div className='absolute inset-0 bg-gradient-to-br from-zinc-900 to-black' />
              )}
              {!open && <div className='absolute inset-0 bg-black/35 transition group-hover:bg-black/20' />}
              {!open && <><div className='absolute inset-0 flex items-center justify-center'>
                <span className='flex h-16 w-16 items-center justify-center rounded-full bg-red-600 text-white shadow-xl transition group-hover:scale-105'><span className='ml-1 text-2xl'>▶</span></span>
              </div><div className='absolute bottom-3 left-3 rounded-md bg-black/75 px-2 py-1 text-[10px] font-bold text-white'>TAP TO WATCH · LIVE</div></>}
            </div>

            <div className='px-4 py-2 flex items-center gap-2 text-[10px] text-muted-foreground'>
              <span className='font-semibold text-foreground'>Testagram TV</span>
              <span>·</span>
              <span>{Number(live.viewer_count ?? 0).toLocaleString()} watching</span>
              <span className='ml-auto font-semibold text-red-500'>{open ? 'Close live' : 'Watch live →'}</span>
            </div>
          </button>
          </>
        )
      ) : (
        <div className='px-4 py-4 flex items-center gap-2 text-xs text-muted-foreground'>
          <RefreshCw className='h-3.5 w-3.5 animate-spin' />
          Finding Testagram TV live…
        </div>
      )}
    </article>
  );
}
