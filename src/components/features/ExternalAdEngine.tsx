import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';

type AdUnit = 'network-300' | 'content-300' | 'banner-728' | 'skyscraper-160' | 'adsterra-160x300' | 'adsterra-320x50' | 'exoclick-display';
const WIDE_PAGES = new Set(['/', '/home', '/explore', '/search', '/videos', '/shorts']);
const BLOCKED_PATH = /^\/(auth|login|signup|register|forgot-password|reset-password|password-reset|verify|verify-identity|profile\/complete|admin|settings|account|security|billing|subscription|invoice|wallet|messages|notifications|help|premium|create-ad|my-ads|ad-|rewards|payouts|revenue|analytics|appeals|sessions|blocked|privacy|terms|policy|regulator|tv-studio|start-stream)(\/|$)/;

function getUnit(pathname: string): AdUnit {
  return WIDE_PAGES.has(pathname) || pathname.startsWith('/home/') ? 'banner-728' : 'network-300';
}
const AD_DOCUMENTS: Record<AdUnit, { width: number; height: number; html: string }> = {
  'exoclick-display': {
    width: 300, height: 250,
    html: '<script async type="application/javascript" src="https://a.magsrv.com/ad-provider.js"></script><ins class="eas6a97888e37" data-zoneid="6052126"></ins><script>(window.AdProvider=window.AdProvider||[]).push({"serve":{}});</script>',
  },
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
  'adsterra-160x300': {
    width: 160, height: 300,
    html: `<script>atOptions = {'key' : '43d52963d531413e1002d738589fd2a0','format' : 'iframe','height' : 300,'width' : 160,'params' : {}};</script><script src="https://www.highrevenueformat.com/43d52963d531413e1002d738589fd2a0/invoke.js"></script>`,
  },
  'adsterra-320x50': {
    width: 320, height: 50,
    html: `<script>atOptions = {'key' : '805d1754a35091e2a2cb80cc19b9192c','format' : 'iframe','height' : 50,'width' : 320,'params' : {}};</script><script src="https://www.highrevenueformat.com/805d1754a35091e2a2cb80cc19b9192c/invoke.js"></script>`,
  },
};

function AdFrame({ unit }: { unit: AdUnit }) {
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const probeRef = useRef<HTMLDivElement | null>(null);
  const [nearViewport, setNearViewport] = useState(false);
  const [adStatus, setAdStatus] = useState<'pending' | 'filled' | 'empty'>('pending');
  const ad = AD_DOCUMENTS[unit];

  useEffect(() => {
    const node = probeRef.current;
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

  // Ad creatives execute in a sandboxed srcDoc. The in-frame monitor reports only
  // whether a visible creative element was created; empty slots are removed.
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frameRef.current?.contentWindow) return;
      if (!event.data || event.data.type !== 'testagram-ad-slot') return;
      if (event.data.status === 'filled') setAdStatus('filled');
      if (event.data.status === 'empty') setAdStatus('empty');
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const srcDoc = useMemo(() => `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;padding:0;width:${ad.width}px;height:${ad.height}px;overflow:hidden;background:transparent}body{display:flex;align-items:flex-start;justify-content:flex-start}</style></head><body>${ad.html}<script>(function(){var done=false,start=Date.now();function hasCreative(){var nodes=Array.prototype.slice.call(document.querySelectorAll('iframe,img,video,canvas,object,embed'));return nodes.some(function(el){var r=el.getBoundingClientRect();if(r.width<30||r.height<20)return false;if(el.tagName==='IMG')return el.complete&&el.naturalWidth>0;if(el.tagName==='VIDEO')return el.readyState>=1||!!el.poster;if(el.tagName==='CANVAS')return el.width>0&&el.height>0;return true;});}function report(status){if(done)return;done=true;parent.postMessage({type:'testagram-ad-slot',status:status},'*');}var timer=setInterval(function(){if(hasCreative()){clearInterval(timer);report('filled');}else if(Date.now()-start>12000){clearInterval(timer);report('empty');}},300);})();<\/script></body></html>`, [ad]);

  if (adStatus === 'empty') return null;
  const filled = adStatus === 'filled';
  return (
    <section className={`external-ad-shell mx-auto max-w-full ${filled ? 'my-3' : 'relative h-px w-full overflow-hidden'}`} aria-label="Sponsored advertisement" data-external-ad-unit={unit}>
      <div ref={probeRef} aria-hidden="true" className={filled ? 'hidden' : 'absolute inset-0 h-px w-full'} />
      {filled && <div className="mb-1 flex items-center justify-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"><span aria-hidden="true">ⓘ</span><span>Sponsored</span></div>}
      <div className={filled ? 'mx-auto max-w-full overflow-x-auto overflow-y-hidden' : 'pointer-events-none absolute left-0 top-0 -z-10 overflow-hidden opacity-0'} style={{ width: ad.width, height: ad.height }}>
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

export function ExternalAdEngine({ surface = 'top' }: { surface?: 'top' | 'sidebar' | 'overlay' | 'feed' }) {
  const { pathname } = useLocation();
  if (BLOCKED_PATH.test(pathname) || (pathname === '/iptv' && surface !== 'overlay') || (pathname.startsWith('/tv/live/') && surface !== 'overlay')) return null;
  if (surface === 'overlay') return <div className="rounded-xl bg-black/85 p-1 shadow-xl"><AdFrame unit="adsterra-160x300" /></div>;
  // External display ads belong inside a social feed slot, never in a global page header.
  if (surface === 'feed') return <div className="mx-auto w-full max-w-full"><AdFrame unit="exoclick-display" /></div>;
  if (surface === 'sidebar') {
    if (WIDE_PAGES.has(pathname) || pathname.startsWith('/home/')) return null;
    return <div className="hidden xl:block"><AdFrame unit="skyscraper-160" /></div>;
  }
  const widePage = getUnit(pathname) === 'banner-728';
  return (
    <div className="external-ad-top px-3 pt-2 pb-1">
      <div className="xl:hidden"><AdFrame unit="adsterra-320x50" /></div>
      {widePage && <div className="hidden xl:block"><AdFrame unit="banner-728" /></div>}
    </div>
  );
}