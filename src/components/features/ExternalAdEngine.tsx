import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';

type AdUnit = 'network-300' | 'content-300' | 'banner-728' | 'skyscraper-160' | 'exoclick-display';
const WIDE_PAGES = new Set(['/', '/home', '/explore', '/search', '/videos', '/shorts']);
const BLOCKED_PATH = /^\/(auth|login|signup|register|forgot-password|reset-password|password-reset|verify|verify-identity|profile\/complete|admin|settings|account|security|billing|subscription|invoice|wallet|messages|notifications|help|premium|create-ad|my-ads|ad-|rewards|payouts|revenue|analytics|appeals|sessions|blocked|privacy|terms|policy|regulator|tv-studio|start-stream)(\/|$)/;

function getUnit(pathname: string): AdUnit {
  return WIDE_PAGES.has(pathname) || pathname.startsWith('/home/') ? 'banner-728' : 'network-300';
}
const AD_DOCUMENTS: Record<AdUnit, { width: number; height: number; html: string }> = {
  'exoclick-display': {
    width: 300, height: 250,
    // Primary: the requested ExoClick zone. If it returns no creative, try the
    // already-configured Profitablerate unit and always leave a visible state
    // instead of rendering a blank "Sponsored" shell.
    html: `<script async type="application/javascript" src="https://a.magsrv.com/ad-provider.js"></script>
<ins class="eas6a97888e37" data-zoneid="6052126" style="position:relative;z-index:1;display:block"></ins>
<script>(window.AdProvider=window.AdProvider||[]).push({"serve":{}});</script>
<div id="testagram-ad-fallback-status" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#fff;background:#111;font:600 12px system-ui,sans-serif;z-index:0">Loading sponsored ad…</div>
<script>
(function(){
  var slot=document.querySelector('ins.eas6a97888e37');
  var status=document.getElementById('testagram-ad-fallback-status');
  var fallbackId='container-2e9d7cc41a80641600217164310c0008';
  function primaryPresent(){return !!document.querySelector('iframe') || !!(slot&&slot.children.length);}
  function fallbackPresent(){var box=document.getElementById(fallbackId);return !!(box&&(box.querySelector('iframe')||box.children.length));}
  function setStatus(message){if(status)status.textContent=message;}
  function useFallback(){
    if(primaryPresent()){if(status)status.remove();return;}
    if(slot)slot.remove();
    setStatus('Loading another sponsored ad…');
    var box=document.createElement('div');
    box.id=fallbackId;
    box.style.cssText='position:relative;z-index:1;width:300px;height:250px;';
    document.body.appendChild(box);
    var script=document.createElement('script');
    script.async=true;
    script.setAttribute('data-cfasync','false');
    script.src='https://pl31756272.profitableratecpmnetwork.com/2e9d7cc41a80641600217164310c0008/invoke.js';
    document.body.appendChild(script);
    window.setTimeout(function(){
      if(primaryPresent()||fallbackPresent()){if(status)status.remove();}
      else setStatus('Sponsored ad temporarily unavailable');
    },8000);
  }
  window.setTimeout(useFallback,8000);
})();
</script>`,
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
      <div className="mx-auto max-w-full overflow-x-auto overflow-y-hidden" style={{ width: ad.width, height: ad.height }}>
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
  if (surface === 'overlay') return <div className="rounded-xl bg-black/85 p-1 shadow-xl"><AdFrame unit="exoclick-display" /></div>;
  // External display ads belong inside a social feed slot, never in a global page header.
  if (surface === 'feed') return <div className="mx-auto w-full max-w-full"><AdFrame unit="exoclick-display" /></div>;
  if (surface === 'sidebar') {
    if (WIDE_PAGES.has(pathname) || pathname.startsWith('/home/')) return null;
    return <div className="hidden xl:block"><AdFrame unit="skyscraper-160" /></div>;
  }
  const widePage = getUnit(pathname) === 'banner-728';
  return (
    <div className="external-ad-top px-3 pt-2 pb-1">
      <div className="xl:hidden"><AdFrame unit="exoclick-display" /></div>
      {widePage && <div className="hidden xl:block"><AdFrame unit="banner-728" /></div>}
    </div>
  );
}