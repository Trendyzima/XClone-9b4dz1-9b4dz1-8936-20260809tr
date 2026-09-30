import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Radio, RefreshCw, Maximize2 } from 'lucide-react';
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

const MAX_LIVE_ITEMS = 8;
const REFRESH_MS = 15_000;
const HIDDEN = /^\/(auth|admin|settings|wallet|messages|notifications|help|premium|create-ad|my-ads|ad-|rewards|verify|privacy|terms|policy|regulator|sessions|blocked|appeals|payouts|revenue|analytics|news\/|tv)(?:\/|$)/;

function youtubeEmbed(videoId: string, origin: string) {
  const params = new URLSearchParams({
    autoplay: '1',
    playsinline: '1',
    mute: '1',
    enablejsapi: '1',
    origin,
  });
  return `https://www.youtube.com/embed/${encodeURIComponent(videoId)}?${params.toString()}`;
}

export function TvPostStream({ index = 0 }: { index?: number }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const hostRef = useRef<HTMLElement>(null);
  const [nearViewport, setNearViewport] = useState(false);
  const [live, setLive] = useState<TestagramLive | null>(null);
  const [loading, setLoading] = useState(false);
  const [playerError, setPlayerError] = useState(false);

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

  const videoId = live?.youtube_video_id?.trim() || '';
  const embed = videoId
    ? youtubeEmbed(videoId, typeof window === 'undefined' ? '' : window.location.origin)
    : '';

  return (
    <article
      ref={hostRef}
      aria-label={live ? `Live Testagram TV: ${live.title}` : 'Live Testagram TV'}
      className='border-b border-border bg-background'
    >
      {live ? (
        <>
          <div className='px-4 pt-3 pb-2 flex items-center gap-3'>
            <span className='flex h-9 w-9 items-center justify-center rounded-full bg-red-500/10'>
              <Radio className='h-4 w-4 text-red-500' />
            </span>
            <div className='min-w-0'>
              <p className='font-bold text-sm truncate'>{live.title || 'Testagram TV Live'}</p>
              <p className='text-[11px] text-muted-foreground truncate'>
                Testagram TV · Live now
              </p>
            </div>
            <span className='ml-auto inline-flex items-center gap-1.5 text-[10px] font-bold text-red-500'>
              <span className='h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse' /> LIVE
            </span>
          </div>

          <div className='relative aspect-video bg-black overflow-hidden'>
            {embed && !playerError ? (
              <iframe
                data-testagram-home-tv='true'
                className='w-full h-full border-0'
                src={embed}
                title={`${live.title || 'Testagram TV'} — Live`}
                allow='autoplay; encrypted-media; picture-in-picture; fullscreen'
                allowFullScreen
                onLoad={() => setPlayerError(false)}
                onError={() => setPlayerError(true)}
              />
            ) : (
              <div className='absolute inset-0 flex items-center justify-center text-sm text-zinc-400'>
                Live video is connecting…
              </div>
            )}
          </div>

          <div className='px-4 py-2 flex items-center gap-2 text-[10px] text-muted-foreground'>
            <span>Testagram TV</span>
            <span>·</span>
            <span>{Number(live.viewer_count ?? 0).toLocaleString()} watching</span>
            <button
              type='button'
              className='ml-auto inline-flex items-center gap-1 font-semibold hover:text-foreground'
              onClick={() => navigate(`/tv/${live.id}`)}
            >
              <Maximize2 className='h-3 w-3' />
              Open TV
            </button>
          </div>
        </>
      ) : (
        <div className='px-4 py-4 flex items-center gap-2 text-xs text-muted-foreground'>
          <RefreshCw className='h-3.5 w-3.5 animate-spin' />
          Finding Testagram TV live…
        </div>
      )}
    </article>
  );
}
