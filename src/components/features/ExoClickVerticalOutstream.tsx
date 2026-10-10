import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';

const AD_HTML = '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;width:100%;height:100%;background:#000;color:#fff;font-family:system-ui}body{display:flex;align-items:center;justify-content:center;overflow:hidden}ins{display:block;max-width:100%;max-height:100%}</style></head><body><div style="position:absolute;top:12px;left:12px;z-index:5;padding:5px 9px;border-radius:6px;background:#111;color:#fff;font:700 12px system-ui">Sponsored</div><div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center"><ins class="eas6a97888e37" data-zoneid="6052126"></ins></div><script async type="application/javascript" src="https://a.magsrv.com/ad-provider.js"></script><script>(window.AdProvider=window.AdProvider||[]).push({serve:{}});</script></body></html>';

export function ExoClickVerticalOutstream({ style }: { style?: CSSProperties }) {
 const host = useRef<HTMLIFrameElement>(null);
 const [near, setNear] = useState(false);
 useEffect(() => {
  const node = host.current;
  if (!node || near) return;
  if (!('IntersectionObserver' in window)) { setNear(true); return; }
  const observer = new IntersectionObserver(entries => {
   if (entries.some(entry => entry.isIntersecting)) { setNear(true); observer.disconnect(); }
  }, { rootMargin: '200px 0px', threshold: 0.01 });
  observer.observe(node);
  return () => observer.disconnect();
 }, [near]);
 return <section className="absolute inset-x-0 h-[100dvh] snap-start overflow-hidden bg-black" style={style} aria-label="Sponsored vertical video">
  <span className="absolute left-3 top-3 z-10 rounded bg-black/80 px-2.5 py-1.5 text-xs font-bold text-white">Sponsored</span>
  <iframe ref={host} title="Sponsored vertical video advertisement" loading="lazy" sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox allow-forms" referrerPolicy="strict-origin-when-cross-origin" srcDoc={near ? AD_HTML : '<!doctype html><html><body style="margin:0;background:#000"></body></html>'} className="h-full w-full border-0" />
 </section>;
}
