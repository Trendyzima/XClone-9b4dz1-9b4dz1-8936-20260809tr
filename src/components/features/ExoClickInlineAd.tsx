import { useEffect, useRef, useState } from 'react';

const ZONE_ID = '6052126';
const EMPTY_DOCUMENT = '<!doctype html><html><body style="margin:0;background:transparent"></body></html>';
const AD_DOCUMENT = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;padding:0;width:100%;min-height:250px;background:transparent;overflow:hidden}body{display:flex;align-items:center;justify-content:center}ins.eas6a97888e37{display:block;width:300px;max-width:100%;min-height:250px}</style></head><body><ins class="eas6a97888e37" data-zoneid="${ZONE_ID}"></ins><script async type="application/javascript" src="https://a.magsrv.com/ad-provider.js"></script><script>(window.AdProvider=window.AdProvider||[]).push({serve:{}});</script></body></html>`;

/** Inline ExoClick outstream placement for content timelines. The provider runs
 * in an isolated lazy iframe so it cannot mutate the host page or its layout. */
export function ExoClickInlineAd({ surface }: { surface: 'profile' | 'groups' | 'community' | 'fediverse' | 'search' | 'hashtag' }) {
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const [nearViewport, setNearViewport] = useState(false);
  useEffect(() => {
    const node = frameRef.current;
    if (!node || nearViewport) return;
    if (typeof IntersectionObserver === 'undefined') { setNearViewport(true); return; }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { setNearViewport(true); observer.disconnect(); }
    }, { rootMargin: '300px 0px', threshold: 0.01 });
    observer.observe(node);
    return () => observer.disconnect();
  }, [nearViewport]);
  return <section className="mx-auto my-4 w-full max-w-[340px] rounded-xl border border-border/70 bg-card/70 p-2" aria-label="Sponsored advertisement" data-exoclick-surface={surface}>
    <div className="mb-2 flex items-center justify-center gap-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground"><span aria-hidden="true">ⓘ</span> Sponsored</div>
    <div className="mx-auto w-full max-w-[300px] overflow-hidden rounded-lg" style={{ minHeight: 250 }}>
      <iframe ref={frameRef} title={`Sponsored ExoClick advertisement in ${surface}`} width="300" height="250" loading="lazy" referrerPolicy="strict-origin-when-cross-origin" sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox allow-forms" srcDoc={nearViewport ? AD_DOCUMENT : EMPTY_DOCUMENT} className="block w-full border-0" style={{ height: 250, maxWidth: '100%' }} />
    </div>
  </section>;
}