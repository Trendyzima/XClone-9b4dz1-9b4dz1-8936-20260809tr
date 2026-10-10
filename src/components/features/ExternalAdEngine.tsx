import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';

type AdUnit = 'network-300' | 'content-300' | 'banner-728' | 'skyscraper-160';
const WIDE_PAGES = new Set(['/', '/home', '/explore', '/search', '/videos', '/shorts']);
const BLOCKED_PATH = /^\/(auth|verify|verify-identity|profile\/complete|admin|settings|wallet|messages|notifications|help|premium|create-ad|my-ads|ad-|rewards|payouts|revenue|analytics|appeals|sessions|blocked|privacy|terms|policy|regulator|tv-studio|start-stream)(\/|$)/;

function getUnit(pathname: string): AdUnit {
  return WIDE_PAGES.has(pathname) || pathname.startsWith('/home/') ? 'banner-728' : 'network-300';
}
const AD_DOCUMENTS: Record<AdUnit, { width: number; height: number; html: string }> = {
  'network-300': {
    width: 300, height: 250,
    html: `<script async="async" data-cfasync="false" src="https://pl31756272.profitableratecpmnetwork.com/2e9d7cc41a80641600217164310c0008/invoke.js"></script><div id="container-2e9d7cc41a80641600217164310c0008"></div>`,
  },
  'content-300': {
    width: 300, height: 250,
    html: `<script>atOptions = {'key' : '19d667c10d23939a00964b5e09a8d828','format' : 'iframe','height' : 250,'width' : 300,'params' : {}};</script><script src="https://www.highrevenueformat.com/19d667c10d23939a00964b5e09a8d828/invoke.js"></script>`,
  },
  'banner-728': {
    width: 728, height: 90,
    html: `<script>atOptions = {'key' : 'bda1f5b7308bb967cfadadaf88b0aeeb','format' : 'iframe','height' : 90,'width' : 728,'params' : {}};</script><script src="https://www.highrevenueformat.com/bda1f5b7308bb967cfadadaf88b0aeeb/invoke.js"></script>`,
  },
  'skyscraper-160': {
    width: 160, height: 600,
    html: `<script>atOptions = {'key' : '88ee1539ff118d7f530a7f7611e3ea4d','format' : 'iframe','height' : 600,'width' : 160,'params' : {}};</script><script src="https://www.highrevenueformat.com/88ee1539ff118d7f530a7f7611e3ea4d/invoke.js"></script>`,
  },
};

function AdFrame({ unit }: { unit: AdUnit }) {
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const [nearViewport, setNearViewport] = useState(false);
  const ad = AD_DOCUMENTS[unit];

  useEffect(() => {
    const node = frameRef.current;
    if (!node || nearViewport) return;
    if (!('IntersectionObserver' in window)) {
      setNearViewport(true);
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setNearViewport(true);
        observer.disconnect();
      }
    }, { rootMargin: '250px 0px', threshold: 0.01 });
    observer.observe(node);
    return () => observer.disconnect();
  }, [nearViewport]);

  const srcDoc = useMemo(() => `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;padding:0;width:${ad.width}px;height:${ad.height}px;overflow:hidden;background:transparent}body{display:flex;align-items:flex-start;justify-content:flex-start}</style></head><body>${ad.html}</body></html>`, [ad]);
  return (
    <section className="external-ad-shell mx-auto my-3 max-w-full" aria-label="Sponsored advertisement" data-external-ad-unit={unit}>
      <div className="mb-1 flex items-center justify-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        <span aria-hidden="true">ⓘ</span><span>Sponsored</span>
      </div>
      <div className="mx-auto max-w-full overflow-hidden" style={{ width: ad.width, height: ad.height }}>
        <iframe
          ref={frameRef}
          title="Sponsored advertisement"
          width={ad.width}
          height={ad.height}
          loading="lazy"
          referrerPolicy="strict-origin-when-cross-origin"
          sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox allow-forms"
          srcDoc={nearViewport ? srcDoc : '<!doctype html><html><body style="margin:0"></body></html>'}
          className="block border-0"
          style={{ width: ad.width, height: ad.height, maxWidth: 'none' }}
        />
      </div>
    </section>
  );
}

export function ExternalAdEngine({ surface = 'top' }: { surface?: 'top' | 'sidebar' }) {
  const { pathname } = useLocation();
  if (BLOCKED_PATH.test(pathname) || pathname.startsWith('/tv/live/')) return null;
  if (surface === 'sidebar') {
    if (WIDE_PAGES.has(pathname) || pathname.startsWith('/home/')) return null;
    return <div className="hidden xl:block"><AdFrame unit="skyscraper-160" /></div>;
  }
  const widePage = getUnit(pathname) === 'banner-728';
  return (
    <div className="external-ad-top px-3 pt-2 pb-1">
      <div className="xl:hidden"><AdFrame unit={widePage ? 'network-300' : 'content-300'} /></div>
      {widePage && <div className="hidden xl:block"><AdFrame unit="banner-728" /></div>}
    </div>
  );
}
