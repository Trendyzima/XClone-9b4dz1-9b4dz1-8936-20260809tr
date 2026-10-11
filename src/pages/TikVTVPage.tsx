import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { UserRound, LogIn } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { usePremium } from '@/hooks/usePremium';

type IptvAdWindow = Window & {
  google?: any;
  __testagramImaPromise?: Promise<void>;
};

/** Apply strict, TikTok-style snapping to the real same-origin IPTV feed shell. */
function installRigidIptvScrollShell(frame: HTMLIFrameElement): () => void {
  let doc: Document | null = null;
  try { doc = frame.contentDocument; } catch { return () => {}; }
  if (!doc?.defaultView) return () => {};
  const win = doc.defaultView;
  const style = doc.createElement('style');
  style.dataset.testagramRigidScroll = '1';
  style.textContent = 'html,body{overscroll-behavior-y:none} [data-testagram-scroll-shell="1"]{scroll-snap-type:y mandatory!important;overscroll-behavior-y:contain!important;-webkit-overflow-scrolling:touch;touch-action:pan-y;scrollbar-width:none} [data-testagram-scroll-shell="1"]::-webkit-scrollbar{display:none} [data-testagram-channel-shell="1"]{scroll-snap-align:start!important;scroll-snap-stop:always!important;flex-shrink:0!important;box-sizing:border-box!important;backface-visibility:hidden}';
  (doc.head || doc.documentElement).appendChild(style);
  const markShells = () => {
    const vh = win.innerHeight || doc!.documentElement.clientHeight || 0;
    if (!vh) return;
    let best: HTMLElement | null = null;
    let bestScore = 0;
    for (const el of Array.from(doc!.querySelectorAll<HTMLElement>('body *'))) {
      if (el === style || el.closest('script,style,iframe,video')) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width < 160 || rect.height < vh * 0.65 || el.scrollHeight <= el.clientHeight + 8) continue;
      const overflow = win.getComputedStyle(el).overflowY;
      if (!/(auto|scroll|overlay)/.test(overflow)) continue;
      const score = el.scrollHeight / Math.max(1, el.clientHeight);
      if (score > bestScore) { best = el; bestScore = score; }
    }
    if (!best) return;
    best.dataset.testagramScrollShell = '1';
    for (const child of Array.from(best.children)) {
      if (!(child instanceof win.HTMLElement)) continue;
      const rect = child.getBoundingClientRect();
      if (rect.height >= vh * 0.65 && rect.width >= best.clientWidth * 0.65) child.dataset.testagramChannelShell = '1';
    }
  };
  markShells();
  const observer = win.MutationObserver ? new win.MutationObserver(markShells) : null;
  if (observer && doc.body) observer.observe(doc.body, { childList: true, subtree: true });
  win.addEventListener('resize', markShells, { passive: true });
  return () => { observer?.disconnect(); win.removeEventListener('resize', markShells); style.remove(); doc!.querySelectorAll('[data-testagram-scroll-shell="1"]').forEach(el => delete (el as HTMLElement).dataset.testagramScrollShell); doc!.querySelectorAll('[data-testagram-channel-shell="1"]').forEach(el => delete (el as HTMLElement).dataset.testagramChannelShell); };
}
function installIptvChannelAds(frame: HTMLIFrameElement): () => void {
  let childWindow: (Window & { google?: any; __testagramImaPromise?: Promise<void> }) | null = null;
  let childDocument: Document | null = null;
  try {
    childWindow = frame.contentWindow as typeof childWindow;
    childDocument = frame.contentDocument;
  } catch {
    return () => {};
  }
  if (!childWindow || !childDocument) return () => {};

  const win = childWindow as Window & { google?: any; __testagramImaPromise?: Promise<void> };
  const doc = childDocument;
  const observedCards = new WeakSet<HTMLElement>();
  let disposed = false;
  let mutationObserver: MutationObserver | null = null;

  // Do not show a Sponsored badge or dark banner until the publisher iframe
  // confirms that it actually rendered a visible creative. Verify the sending
  // frame as well as the message type so unrelated frames cannot reveal a slot.
  const onIptvAdSlotMessage = (event: MessageEvent) => {
    if (disposed || !event.data || event.data.type !== 'testagram-iptv-ad-slot') return;
    const frames = Array.from(doc.querySelectorAll<HTMLIFrameElement>('iframe[data-testagram-adsterra-frame="320x50"]'));
    const frame = frames.find((candidate) => candidate.contentWindow === event.source);
    const banner = frame?.closest<HTMLElement>('[data-testagram-adsterra="320x50"]');
    if (!frame || !banner || !banner.isConnected) return;

    win.dispatchEvent(new CustomEvent('testagram:ad-slot-status', {
      detail: { unit: 'adsterra-320x50', status: event.data.status, reason: event.data.reason || 'unspecified' },
    }));
    if (event.data.status === 'filled') {
      banner.dataset.adStatus = 'filled';
      banner.style.opacity = '1';
      banner.style.pointerEvents = 'auto';
      banner.style.background = 'rgba(0,0,0,.72)';
      const label = banner.querySelector<HTMLElement>('[data-testagram-sponsored-label]');
      if (label) label.style.display = 'block';
    } else if (event.data.status === 'empty') {
      banner.dataset.adStatus = 'empty';
      banner.remove();
    }
  };
  win.addEventListener('message', onIptvAdSlotMessage);

  const stabilizeCard = (card: HTMLElement) => {
    // TikVTV cards are full-screen vertical slides. Ad overlays must never
    // change their measured height or flex basis when mounted/unmounted.
    card.style.position = 'relative';
    card.style.boxSizing = 'border-box';
    card.style.width = '100%';
    card.style.height = '100dvh';
    card.style.minHeight = '100dvh';
    card.style.maxHeight = '100dvh';
    card.style.flex = '0 0 100dvh';
    card.style.flexShrink = '0';
    card.style.scrollSnapAlign = 'start';
    card.style.overflow = 'hidden';
    card.style.contain = 'layout paint';
  };

  const scan = () => {
    if (disposed) return;
    doc.querySelectorAll<HTMLElement>('[data-index]').forEach((card) => {
      if (observedCards.has(card) || !card.querySelector('video')) return;
      observedCards.add(card);
      card.dataset.testagramChannelKey = 'channel-' + (card.dataset.index || card.textContent?.trim().slice(0, 80) || 'unknown');
      stabilizeCard(card);
      // Keep a compact Adsterra banner in a reserved overlay layer on every
      // fourth IPTV slide. Absolute positioning means it cannot change slide
      // height, flex basis, scroll snapping, or the video player's layout.
      const slideIndex = Number(card.dataset.index);
      if (Number.isFinite(slideIndex) && (slideIndex + 1) % 4 === 0) {
        const banner = doc.createElement('section');
        banner.setAttribute('aria-label', 'Sponsored advertisement');
        banner.dataset.testagramAdsterra = '320x50';
        banner.style.cssText = 'position:absolute;left:50%;bottom:calc(env(safe-area-inset-bottom,0px) + 116px);transform:translateX(-50%);z-index:30;width:min(320px,calc(100% - 16px));height:66px;box-sizing:border-box;padding-top:16px;overflow:hidden;background:transparent;border-radius:8px;opacity:0;pointer-events:none;transition:opacity .15s ease;';
        banner.dataset.adStatus = 'pending';
        const sponsored = doc.createElement('span');
        sponsored.dataset.testagramSponsoredLabel = 'true';
        sponsored.textContent = 'Sponsored';
        sponsored.style.cssText = 'display:none;position:absolute;left:6px;top:2px;color:#fff;font:700 9px/12px system-ui,sans-serif;text-transform:uppercase;letter-spacing:.08em;';
        const adFrame = doc.createElement('iframe');
        adFrame.title = 'Sponsored Adsterra banner';
        adFrame.width = '320';
        adFrame.height = '50';
        adFrame.loading = 'lazy';
        adFrame.referrerPolicy = 'strict-origin-when-cross-origin';
        adFrame.dataset.testagramAdsterraFrame = '320x50';
        adFrame.setAttribute('sandbox', 'allow-scripts allow-popups allow-popups-to-escape-sandbox allow-forms');
        adFrame.style.cssText = 'display:block;width:320px;max-width:100%;height:50px;margin:0 auto;border:0;';
        adFrame.srcdoc = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;padding:0;width:320px;height:50px;overflow:hidden;background:transparent}body{display:flex;align-items:center;justify-content:center}</style></head><body><script>(function(){var done=false,start=Date.now(),timer=0;function report(status,reason){if(done)return;done=true;if(timer)clearInterval(timer);parent.postMessage({type:'testagram-iptv-ad-slot',status:status,reason:reason||'unspecified'},'*');}function hasCreative(){var nodes=Array.prototype.slice.call(document.querySelectorAll('iframe,img,video,canvas,object,embed'));return nodes.some(function(el){var r=el.getBoundingClientRect();if(r.width<30||r.height<20)return false;if(el.tagName==='IMG')return el.complete&&el.naturalWidth>0;if(el.tagName==='VIDEO')return el.readyState>=1||!!el.poster;if(el.tagName==='CANVAS')return el.width>0&&el.height>0;return true;});}window.atOptions={key:'805d1754a35091e2a2cb80cc19b9192c',format:'iframe',height:50,width:320,params:{}};var script=document.createElement('script');script.async=true;script.src='https://www.highrevenueformat.com/805d1754a35091e2a2cb80cc19b9192c/invoke.js';script.onerror=function(){report('empty','script-error');};document.body.appendChild(script);timer=setInterval(function(){if(hasCreative())report('filled','creative-detected');else if(Date.now()-start>=12000)report('empty','no-creative-timeout');},250);})();</script></body></html>`;
        banner.append(sponsored, adFrame);
        card.appendChild(banner);
      }
    });
  };

  const MutationObserverCtor = win.MutationObserver;

  // IPTV channel playback must not be paused or covered by an unconfirmed VAST
  // request. Keep monetization in the independent, non-layout-shifting banner slot.
  // This avoids a full-screen black/empty ad layer when IMA is blocked or returns no-fill.
  scan();
  if (MutationObserverCtor) mutationObserver = new MutationObserverCtor(scan);
  if (doc.body && mutationObserver) mutationObserver.observe(doc.body, { childList: true, subtree: true });

  return () => {
    disposed = true;
    mutationObserver?.disconnect();
    win.removeEventListener('message', onIptvAdSlotMessage);
  };
}

export default function TikVTVPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { isActive: isPremium } = usePremium();
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => {
    if (!ready || !iframeRef.current) return;
    const frame = iframeRef.current;
    const removeRigidScroll = installRigidIptvScrollShell(frame);
    const removeAds = isPremium ? undefined : installIptvChannelAds(frame);
    return () => { removeAds?.(); removeRigidScroll(); };
  }, [ready, isPremium]);

  return (
    <div className="fixed inset-0 z-[60] bg-black" data-testid="iptv-page">
      <div className="absolute right-3 top-3 z-[80] flex items-center gap-2 rounded-full border border-white/15 bg-black/75 p-1.5 shadow-lg backdrop-blur-md">
        <button
          type="button"
          onClick={() => navigate(user?.username ? '/profile/' + encodeURIComponent(user.username) : '/auth?returnTo=/iptv')}
          className="inline-flex h-9 items-center gap-2 rounded-full px-3 text-xs font-semibold text-white transition-colors hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          aria-label={user?.username ? 'Open your XClone profile' : 'Sign in to XClone'}
        >
          {user?.username ? <UserRound className="h-4 w-4" /> : <LogIn className="h-4 w-4" />}
          {user?.username ? 'XClone profile' : 'Sign in'}
        </button>
      </div>
      {!ready && !failed && (
        <div className="absolute inset-0 z-10 grid place-items-center bg-black text-white">
          <div className="text-center">
            <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-white" />
            <p className="text-sm text-white/70">Loading IPTV…</p>
          </div>
        </div>
      )}
      {failed && (
        <div className="absolute inset-0 z-10 grid place-items-center bg-black p-6 text-white">
          <div className="max-w-md text-center">
            <h1 className="text-xl font-semibold">IPTV is unavailable</h1>
            <p className="mt-2 text-sm text-white/60">The embedded IPTV bundle could not be loaded from this Xclone build.</p>
          </div>
        </div>
      )}
      <iframe
        ref={iframeRef}
        title="Testagram IPTV"
        src="/iptv-app/entry.html"
        className="h-full w-full border-0 bg-black"
        allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
        allowFullScreen
        onLoad={() => setReady(true)}
        onError={() => setFailed(true)}
      />
    </div>
  );
}
