import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { UserRound, LogIn } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { usePremium } from '@/hooks/usePremium';

type IptvAdWindow = Window & {
  google?: any;
  __testagramImaPromise?: Promise<void>;
};

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
  const attemptedChannels = new Set<string>();
  const observedCards = new WeakSet<HTMLElement>();
  const activeCards = new Set<HTMLElement>();
  const finishers = new Map<HTMLElement, () => void>();
  let disposed = false;
  let cardObserver: IntersectionObserver | null = null;
  let mutationObserver: MutationObserver | null = null;

  const loadIma = (): Promise<void> => {
    if (win.google?.ima) return Promise.resolve();
    if (win.__testagramImaPromise) return win.__testagramImaPromise;
    win.__testagramImaPromise = new Promise<void>((resolve, reject) => {
      let script = doc.querySelector<HTMLScriptElement>('script[data-testagram-ima]');
      const timeout = win.setTimeout(() => reject(new Error('IMA timeout')), 8_000);
      const loaded = () => { win.clearTimeout(timeout); resolve(); };
      const failed = () => { win.clearTimeout(timeout); reject(new Error('IMA unavailable')); };
      if (!script) {
        script = doc.createElement('script');
        script.src = 'https://imasdk.googleapis.com/js/sdkloader/ima3.js';
        script.async = true;
        script.dataset.testagramIma = '1';
        doc.head.appendChild(script);
      }
      script.addEventListener('load', loaded, { once: true });
      script.addEventListener('error', failed, { once: true });
    }).catch((error) => {
      win.__testagramImaPromise = undefined;
      throw error;
    });
    return win.__testagramImaPromise;
  };

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

  const startAd = (card: HTMLElement) => {
    if (disposed || !card.isConnected || finishers.has(card)) return;
    const key = card.dataset.testagramChannelKey || ('channel-' + (card.dataset.index || 'unknown'));
    if (attemptedChannels.has(key)) return;
    const contentVideo = card.querySelector<HTMLVideoElement>('video');
    if (!contentVideo) return;
    attemptedChannels.add(key);

    stabilizeCard(card);
    const previousMuted = contentVideo.muted;
    const wasPlaying = !contentVideo.paused;
    contentVideo.pause();
    contentVideo.muted = true;

    const overlay = doc.createElement('div');
    overlay.setAttribute('role', 'region');
    overlay.setAttribute('aria-label', 'Sponsored vertical video advertisement');
    overlay.style.cssText = 'position:absolute;inset:0;z-index:9999;width:100%;height:100%;min-height:100dvh;box-sizing:border-box;background:#000;overflow:hidden;touch-action:pan-y;';

    const adVideo = doc.createElement('video');
    adVideo.playsInline = true;
    adVideo.muted = true;
    adVideo.setAttribute('aria-label', 'Sponsored video');
    adVideo.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:#000;';

    const adContainer = doc.createElement('div');
    adContainer.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;';

    const label = doc.createElement('span');
    label.textContent = 'Sponsored';
    label.style.cssText = 'position:absolute;top:16px;left:16px;z-index:10002;background:rgba(0,0,0,.82);color:#fff;padding:7px 10px;border-radius:7px;font:700 12px/1.2 system-ui,sans-serif;';

    const status = doc.createElement('span');
    status.textContent = 'Loading sponsored video…';
    status.style.cssText = 'position:absolute;top:16px;right:16px;z-index:10002;background:rgba(0,0,0,.82);color:#fff;padding:7px 10px;border-radius:7px;font:500 12px/1.2 system-ui,sans-serif;';

    const prompt = doc.createElement('div');
    prompt.textContent = 'Tap to play sponsored video · swipe to continue';
    prompt.style.cssText = 'position:absolute;left:16px;right:16px;top:50%;transform:translateY(-50%);z-index:10002;margin:auto;max-width:320px;text-align:center;background:rgba(0,0,0,.82);border:1px solid rgba(255,255,255,.22);color:#fff;padding:18px 16px;border-radius:16px;font:600 14px/1.45 system-ui,sans-serif;display:none;';

    const skip = doc.createElement('button');
    skip.type = 'button';
    skip.textContent = 'Skip ad';
    skip.hidden = true;
    skip.style.cssText = 'position:absolute;right:16px;bottom:24px;z-index:10003;background:#fff;color:#111;padding:11px 16px;border:0;border-radius:8px;font:700 14px system-ui,sans-serif;';

    overlay.append(adVideo, adContainer, label, status, prompt, skip);
    card.appendChild(overlay);

    let manager: any = null;
    let display: any = null;
    let disposedAd = false;
    let requestReady = false;
    let initialized = false;
    let startRequested = false;
    let adStarted = false;
    let startedAt = 0;
    let loadTimeout = 0;
    let hardTimeout = 0;
    let skipPoll = 0;
    let pointerStart: { x: number; y: number } | null = null;

    const finish = () => {
      if (disposedAd) return;
      disposedAd = true;
      win.clearTimeout(loadTimeout);
      win.clearTimeout(hardTimeout);
      win.clearInterval(skipPoll);
      try { manager?.destroy(); } catch {}
      manager = null;
      overlay.remove();
      finishers.delete(card);
      contentVideo.muted = previousMuted;
      // Resume only if the channel was playing when the ad took over.
      if (!disposed && wasPlaying && contentVideo.isConnected) contentVideo.play().catch(() => {});
    };
    finishers.set(card, finish);

    const startManager = () => {
      if (!requestReady || !manager || !win.google?.ima || disposed || disposedAd || adStarted) return;
      try {
        manager.init(Math.max(320, card.clientWidth || win.innerWidth || 360), Math.max(480, card.clientHeight || win.innerHeight || 640), win.google.ima.ViewMode.NORMAL);
        manager.start();
        adStarted = true;
        prompt.style.display = 'none';
        status.textContent = 'Starting sponsored video…';
        hardTimeout = win.setTimeout(finish, 60_000);
      } catch {
        finish();
      }
    };

    const beginFromGesture = () => {
      startRequested = true;
      if (!initialized) {
        try {
          // Must run directly from the pointer gesture on mobile browsers.
          display?.initialize();
          initialized = true;
        } catch {
          finish();
          return;
        }
      }
      startManager();
    };

    const onPointerDown = (event: PointerEvent) => {
      pointerStart = { x: event.clientX, y: event.clientY };
    };
    const onPointerUp = (event: PointerEvent) => {
      const start = pointerStart;
      pointerStart = null;
      if (!start || (event.target as HTMLElement).closest('button')) return;
      const dx = event.clientX - start.x;
      const dy = event.clientY - start.y;
      if (Math.abs(dy) > 64 || Math.abs(dx) > 88) {
        // Vertical ExoClick creative: swiping away dismisses the ad and
        // returns the viewer to the channel without changing slide geometry.
        finish();
        return;
      }
      beginFromGesture();
    };
    overlay.addEventListener('pointerdown', onPointerDown, { passive: true });
    overlay.addEventListener('pointerup', onPointerUp, { passive: true });
    overlay.addEventListener('pointercancel', () => { pointerStart = null; }, { passive: true });
    skip.addEventListener('pointerdown', (event) => event.stopPropagation());
    skip.addEventListener('pointerup', (event) => event.stopPropagation());
    skip.addEventListener('click', () => { try { manager?.skip(); } catch {} });

    // Only the network-load timeout can remove an unresponsive ad. Once a
    // creative is ready, the overlay remains stable until play, swipe, or close.
    loadTimeout = win.setTimeout(() => { if (!requestReady) finish(); }, 15_000);

    void loadIma().then(() => {
      if (disposed || disposedAd || !win.google?.ima || !overlay.isConnected) return finish();
      const ima = win.google.ima;
      display = new ima.AdDisplayContainer(adContainer, adVideo);
      const loader = new ima.AdsLoader(display);
      loader.addEventListener(ima.AdsManagerLoadedEvent.Type.ADS_MANAGER_LOADED, (event: any) => {
        if (disposed || disposedAd) return finish();
        try {
          manager = event.getAdsManager(adVideo, new ima.AdsRenderingSettings());
          requestReady = true;
          win.clearTimeout(loadTimeout);
          status.textContent = 'Sponsored';
          prompt.style.display = 'block';
          manager.addEventListener(ima.AdEvent.Type.STARTED, () => {
            adStarted = true;
            startedAt = Date.now();
            prompt.style.display = 'none';
            status.textContent = 'Sponsored';
            win.clearInterval(skipPoll);
            skipPoll = win.setInterval(() => {
              try { skip.hidden = !(Date.now() - startedAt >= 5_000 && manager?.getAdSkippableState?.()); }
              catch { skip.hidden = true; }
            }, 250);
          });
          manager.addEventListener(ima.AdEvent.Type.SKIPPED, finish);
          manager.addEventListener(ima.AdEvent.Type.COMPLETE, finish);
          manager.addEventListener(ima.AdEvent.Type.ALL_ADS_COMPLETED, finish);
          manager.addEventListener(ima.AdErrorEvent.Type.AD_ERROR, finish);
          if (startRequested && initialized) startManager();
        } catch {
          finish();
        }
      }, false);
      loader.addEventListener(ima.AdErrorEvent.Type.AD_ERROR, finish, false);
      const request = new ima.AdsRequest();
      request.adTagUrl = 'https://s.magsrv.com/v1/vast.php?idzone=6052130';
      request.linearAdSlotWidth = Math.max(320, card.clientWidth || win.innerWidth || 360);
      request.linearAdSlotHeight = Math.max(480, card.clientHeight || win.innerHeight || 640);
      request.nonLinearAdSlotWidth = request.linearAdSlotWidth;
      request.nonLinearAdSlotHeight = Math.round(request.linearAdSlotHeight / 3);
      loader.requestAds(request);
    }).catch(() => finish());
  };

  const scan = () => {
    if (disposed || !cardObserver) return;
    doc.querySelectorAll<HTMLElement>('[data-index]').forEach((card) => {
      if (observedCards.has(card) || !card.querySelector('video')) return;
      observedCards.add(card);
      card.dataset.testagramChannelKey = 'channel-' + (card.dataset.index || card.textContent?.trim().slice(0, 80) || 'unknown');
      stabilizeCard(card);
      cardObserver?.observe(card);
    });
  };

  if (typeof win.IntersectionObserver !== 'undefined') {
    cardObserver = new win.IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        const card = entry.target as HTMLElement;
        if (entry.isIntersecting && entry.intersectionRatio >= 0.75) {
          activeCards.add(card);
          // There can only be one full-screen ad layer at a time.
          finishers.forEach((finish, otherCard) => { if (otherCard !== card) finish(); });
          startAd(card);
        } else {
          activeCards.delete(card);
          finishers.get(card)?.();
        }
      });
    }, { threshold: [0, 0.75] });
    scan();
    mutationObserver = new win.MutationObserver(scan);
    if (doc.body) mutationObserver.observe(doc.body, { childList: true, subtree: true });
  }

  return () => {
    disposed = true;
    mutationObserver?.disconnect();
    cardObserver?.disconnect();
    finishers.forEach((finish) => finish());
    activeCards.clear();
    finishers.clear();
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
    if (!ready || isPremium || !iframeRef.current) return;
    return installIptvChannelAds(iframeRef.current);
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
