import { useEffect, useRef, useState } from 'react';

const VAST_TAG = 'https://s.magsrv.com/v1/vast.php?idzone=6052130';
const IMA_SRC = 'https://imasdk.googleapis.com/js/sdkloader/ima3.js';

declare global {
  interface Window {
    google?: { ima?: any };
    __testagramIma?: Promise<void>;
  }
}

function loadIma(): Promise<void> {
  if (window.google?.ima) return Promise.resolve();
  if (window.__testagramIma) return window.__testagramIma;

  window.__testagramIma = new Promise<void>((resolve, reject) => {
    let script = document.querySelector<HTMLScriptElement>('script[data-testagram-ima]');
    const timeout = window.setTimeout(() => reject(new Error('IMA timeout')), 8_000);
    const loaded = () => { window.clearTimeout(timeout); resolve(); };
    const failed = () => { window.clearTimeout(timeout); reject(new Error('IMA unavailable')); };
    if (!script) {
      script = document.createElement('script');
      script.src = IMA_SRC;
      script.async = true;
      script.dataset.testagramIma = '1';
      document.head.appendChild(script);
    }
    script.addEventListener('load', loaded, { once: true });
    script.addEventListener('error', failed, { once: true });
  }).catch((error) => {
    window.__testagramIma = undefined;
    throw error;
  });

  return window.__testagramIma;
}

export function ExoClickVastPreRoll({ onComplete }: { onComplete: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const manager = useRef<any>(null);
  const display = useRef<any>(null);
  const initialized = useRef(false);
  const startRequested = useRef(false);
  const started = useRef(false);
  const done = useRef(false);
  const pointerStart = useRef<{ x: number; y: number } | null>(null);
  const [canSkip, setCanSkip] = useState(false);
  const [status, setStatus] = useState('Preparing sponsored video…');
  const [adReady, setAdReady] = useState(false);

  useEffect(() => {
    let disposed = false;
    let startupTimeout = 0;
    let skipPoll = 0;
    let startedAt = 0;

    const finish = () => {
      if (disposed || done.current) return;
      done.current = true;
      window.clearTimeout(startupTimeout);
      window.clearInterval(skipPoll);
      try { manager.current?.destroy(); } catch {}
      manager.current = null;
      display.current = null;
      onComplete();
    };

    // No-fill and blocked-autoplay paths must always release the reel.
    startupTimeout = window.setTimeout(() => {
      if (!started.current) finish();
    }, 20_000);

    const startPlayback = () => {
      const ads = manager.current;
      const ima = window.google?.ima;
      if (!ads || !ima || disposed || done.current || started.current) return;
      try {
        ads.init(container.current?.clientWidth || 360, container.current?.clientHeight || window.innerHeight || 640, ima.ViewMode.NORMAL);
        ads.start();
        started.current = true;
        setStatus('Starting sponsored video…');
        window.clearTimeout(startupTimeout);
      } catch {
        finish();
      }
    };

    void loadIma().then(() => {
      if (disposed || !window.google?.ima || !video.current || !container.current) return;
      const ima = window.google.ima;
      const adDisplay = new ima.AdDisplayContainer(container.current, video.current);
      display.current = adDisplay;
      const loader = new ima.AdsLoader(adDisplay);

      loader.addEventListener(ima.AdsManagerLoadedEvent.Type.ADS_MANAGER_LOADED, (event: any) => {
        if (disposed || done.current) return finish();
        try {
          const ads = event.getAdsManager(video.current, new ima.AdsRenderingSettings());
          manager.current = ads;
          setAdReady(true);
          setStatus('Tap to play · swipe to continue');

          const onStart = () => {
            if (done.current) return;
            started.current = true;
            startedAt = Date.now();
            setStatus('Sponsored');
            window.clearTimeout(startupTimeout);
            window.clearInterval(skipPoll);
            skipPoll = window.setInterval(() => {
              try { setCanSkip(Date.now() - startedAt >= 5_000 && Boolean(ads.getAdSkippableState?.())); }
              catch { setCanSkip(false); }
            }, 250);
          };
          ads.addEventListener(ima.AdEvent.Type.STARTED, onStart);
          ads.addEventListener(ima.AdEvent.Type.SKIPPED, finish);
          ads.addEventListener(ima.AdEvent.Type.COMPLETE, finish);
          ads.addEventListener(ima.AdEvent.Type.ALL_ADS_COMPLETED, finish);
          ads.addEventListener(ima.AdErrorEvent.Type.AD_ERROR, finish);

          if (startRequested.current && initialized.current) startPlayback();
        } catch {
          finish();
        }
      }, false);

      loader.addEventListener(ima.AdErrorEvent.Type.AD_ERROR, finish, false);
      const request = new ima.AdsRequest();
      request.adTagUrl = VAST_TAG;
      request.linearAdSlotWidth = container.current.clientWidth || window.innerWidth || 360;
      request.linearAdSlotHeight = container.current.clientHeight || window.innerHeight || 640;
      request.nonLinearAdSlotWidth = request.linearAdSlotWidth;
      request.nonLinearAdSlotHeight = Math.round(request.linearAdSlotHeight / 3);
      loader.requestAds(request);
    }).catch(() => {
      if (!disposed) finish();
    });

    return () => {
      disposed = true;
      window.clearTimeout(startupTimeout);
      window.clearInterval(skipPoll);
      try { manager.current?.destroy(); } catch {}
      manager.current = null;
      display.current = null;
    };
  }, [onComplete]);

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    pointerStart.current = { x: event.clientX, y: event.clientY };
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = pointerStart.current;
    pointerStart.current = null;
    if (!start || (event.target as HTMLElement).closest('[data-skip-ad]')) return;

    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.abs(dy) > 64 || Math.abs(dx) > 88) {
      // ExoClick's vertical format is dismissed by swiping, not by trapping
      // the viewer in a mandatory full-screen ad.
      if (!done.current) {
        done.current = true;
        try { manager.current?.destroy(); } catch {}
        onComplete();
      }
      return;
    }

    // IMA requires display initialization directly in a user gesture on mobile.
    // Do it here (not in an IntersectionObserver/effect) to prevent silent
    // autoplay failures that used to make the ad overlay disappear.
    startRequested.current = true;
    if (!initialized.current) {
      try {
        display.current?.initialize();
        initialized.current = true;
      } catch {
        if (!done.current) {
          done.current = true;
          onComplete();
        }
        return;
      }
    }
    const ads = manager.current;
    const ima = window.google?.ima;
    if (ads && ima && !started.current && !done.current) {
      try {
        ads.init(container.current?.clientWidth || 360, container.current?.clientHeight || window.innerHeight || 640, ima.ViewMode.NORMAL);
        ads.start();
        started.current = true;
        setStatus('Starting sponsored video…');
      } catch {
        if (!done.current) {
          done.current = true;
          onComplete();
        }
      }
    }
  };

  return (
    <div
      className="absolute inset-0 z-30 bg-black touch-pan-y"
      aria-label="Sponsored vertical video advertisement"
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerCancel={() => { pointerStart.current = null; }}
      style={{ minHeight: '100%', touchAction: 'pan-y', overscrollBehavior: 'contain' }}
    >
      <video ref={video} className="absolute inset-0 h-full w-full object-contain bg-black" playsInline muted />
      <div ref={container} className="absolute inset-0 h-full w-full" />
      <span className="absolute left-3 top-3 z-40 rounded bg-black/80 px-2.5 py-1.5 text-xs font-bold text-white">Sponsored</span>
      <span className="absolute right-3 top-3 z-40 rounded bg-black/80 px-2.5 py-1.5 text-xs text-white">{status}</span>
      {adReady && !started.current && (
        <div className="pointer-events-none absolute inset-x-4 top-1/2 z-40 -translate-y-1/2 text-center">
          <div className="mx-auto max-w-xs rounded-2xl border border-white/20 bg-black/75 px-4 py-4 text-white shadow-2xl backdrop-blur-sm">
            <p className="text-sm font-bold">Sponsored video</p>
            <p className="mt-1 text-xs text-white/75">Tap to play the ad, or swipe to continue watching.</p>
          </div>
        </div>
      )}
      {canSkip && (
        <button
          data-skip-ad
          type="button"
          onPointerDown={event => event.stopPropagation()}
          onPointerUp={event => event.stopPropagation()}
          onClick={event => { event.stopPropagation(); try { manager.current?.skip(); } catch {} }}
          className="absolute bottom-5 right-4 z-50 rounded-lg bg-white px-4 py-2 text-sm font-bold text-black"
        >
          Skip ad
        </button>
      )}
    </div>
  );
}
