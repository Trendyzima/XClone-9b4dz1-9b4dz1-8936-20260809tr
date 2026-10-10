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
  let childWindow: IptvAdWindow | null = null;
  let childDocument: Document | null = null;
  try {
    childWindow = frame.contentWindow as IptvAdWindow | null;
    childDocument = frame.contentDocument;
  } catch {
    return () => {};
  }
  if (!childWindow || !childDocument) return () => {};

  const win = childWindow;
  const doc = childDocument;
  const seenChannels = new Set<string>();
  const activeCards = new Set<HTMLElement>();
  const observedCards = new WeakSet<HTMLElement>();
  const finishers = new Set<() => void>();
  let disposed = false;

  const loadIma = (): Promise<void> => {
    if (win.google?.ima) return Promise.resolve();
    if (win.__testagramImaPromise) return win.__testagramImaPromise;
    win.__testagramImaPromise = new Promise<void>((resolve, reject) => {
      let settled = false;
      const script = doc.querySelector<HTMLScriptElement>('script[data-testagram-ima]') ?? doc.createElement('script');
      const timeout = win.setTimeout(() => settle(false), 7000);
      const settle = (ok: boolean) => {
        if (settled) return;
        settled = true;
        win.clearTimeout(timeout);
        ok ? resolve() : reject(new Error('IMA unavailable'));
      };
      script.addEventListener('load', () => settle(true), { once: true });
      script.addEventListener('error', () => settle(false), { once: true });
      if (!script.src) {
        script.src = 'https://imasdk.googleapis.com/js/sdkloader/ima3.js';
        script.async = true;
        script.dataset.testagramIma = '1';
        doc.head.appendChild(script);
      }
    }).catch((error) => {
      win.__testagramImaPromise = undefined;
      throw error;
    });
    return win.__testagramImaPromise;
  };

  const startAd = (card: HTMLElement) => {
    if (disposed || !card.isConnected) return;
    const key = card.dataset.testagramChannelKey || ('channel-' + (card.dataset.index || card.textContent?.trim().slice(0, 80) || 'unknown'));
    const contentVideo = card.querySelector<HTMLVideoElement>('video');
    if (!contentVideo || seenChannels.has(key)) return;
    seenChannels.add(key);

    const previousMuted = contentVideo.muted;
    const wasPlaying = !contentVideo.paused;
    contentVideo.pause();
    contentVideo.muted = true;

    const overlay = doc.createElement('div');
    overlay.setAttribute('role', 'region');
    overlay.setAttribute('aria-label', 'Sponsored video advertisement');
    overlay.style.cssText = 'position:absolute;inset:0;z-index:9999;background:#000;display:block;overflow:hidden;';
    const adVideo = doc.createElement('video');
    adVideo.playsInline = true;
    adVideo.muted = true;
    adVideo.setAttribute('aria-label', 'Sponsored video');
    adVideo.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:#000;';
    const adContainer = doc.createElement('div');
    adContainer.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;';
    const label = doc.createElement('span');
    label.textContent = 'Sponsored';
    label.style.cssText = 'position:absolute;top:16px;left:16px;z-index:10002;background:rgba(0,0,0,.78);color:#fff;padding:6px 10px;border-radius:6px;font:700 12px/1.2 system-ui,sans-serif;';
    const status = doc.createElement('span');
    status.textContent = 'Loading sponsored video…';
    status.style.cssText = 'position:absolute;top:16px;right:16px;z-index:10002;background:rgba(0,0,0,.78);color:#fff;padding:6px 10px;border-radius:6px;font:500 12px/1.2 system-ui,sans-serif;';
    const skip = doc.createElement('button');
    skip.type = 'button';
    skip.textContent = 'Skip ad';
    skip.hidden = true;
    skip.style.cssText = 'position:absolute;right:16px;bottom:24px;z-index:10003;background:#fff;color:#111;padding:10px 16px;border:0;border-radius:8px;font:700 14px system-ui,sans-serif;';
    overlay.append(adVideo, adContainer, label, status, skip);
    card.appendChild(overlay);

    let manager: any = null;
    let started = false;
    let finished = false;
    let startedAt = 0;
    let startupTimeout = 0;
    let hardTimeout = 0;
    let skipPoll = 0;
    const finish = () => {
      if (finished) return;
      finished = true;
      win.clearTimeout(startupTimeout);
      win.clearTimeout(hardTimeout);
      win.clearInterval(skipPoll);
      try { manager?.destroy(); } catch {}
      manager = null;
      overlay.remove();
      finishers.delete(finish);
      contentVideo.muted = previousMuted;
      if (!disposed && wasPlaying) contentVideo.play().catch(() => {});
    };
    finishers.add(finish);
    startupTimeout = win.setTimeout(() => { if (!started) finish(); }, 9000);
    hardTimeout = win.setTimeout(finish, 45000);
    skip.addEventListener('click', () => {
      try { manager?.skip(); } catch {}
    });

    void loadIma().then(() => {
      if (disposed || finished || !overlay.isConnected || !win.google?.ima) return finish();
      const ima = win.google.ima;
      const display = new ima.AdDisplayContainer(adContainer, adVideo);
      const loader = new ima.AdsLoader(display);
      loader.addEventListener(ima.AdsManagerLoadedEvent.Type.ADS_MANAGER_LOADED, (event: any) => {
        if (disposed || finished) return finish();
        try {
          const ads = event.getAdsManager(adVideo, new ima.AdsRenderingSettings());
          manager = ads;
          const begin = () => {
            started = true;
            status.textContent = 'Sponsored';
            win.clearTimeout(startupTimeout);
            win.clearInterval(skipPoll);
            skipPoll = win.setInterval(() => {
              try { skip.hidden = !(Date.now() - startedAt >= 5000 && ads.getAdSkippableState?.()); } catch { skip.hidden = true; }
            }, 250);
          };
          const onStart = () => { startedAt = Date.now(); begin(); };
          ads.addEventListener(ima.AdEvent.Type.CONTENT_PAUSE_REQUESTED, onStart);
          ads.addEventListener(ima.AdEvent.Type.STARTED, onStart);
          ads.addEventListener(ima.AdEvent.Type.SKIPPED, finish);
          ads.addEventListener(ima.AdEvent.Type.COMPLETE, finish);
          ads.addEventListener(ima.AdEvent.Type.ALL_ADS_COMPLETED, finish);
          ads.addEventListener(ima.AdErrorEvent.Type.AD_ERROR, finish);
          const width = Math.max(320, card.clientWidth || win.innerWidth || 360);
          const height = Math.max(480, card.clientHeight || win.innerHeight || 640);
          ads.init(width, height, ima.ViewMode.NORMAL);
          ads.start();
        } catch {
          finish();
        }
      }, false);
      loader.addEventListener(ima.AdErrorEvent.Type.AD_ERROR, finish, false);
      display.initialize();
      const request = new ima.AdsRequest();
      request.adTagUrl = 'https://s.magsrv.com/v1/vast.php?idzone=6052130';
      request.linearAdSlotWidth = Math.max(320, card.clientWidth || win.innerWidth || 360);
      request.linearAdSlotHeight = Math.max(480, card.clientHeight || win.innerHeight || 640);
      request.nonLinearAdSlotWidth = request.linearAdSlotWidth;
      request.nonLinearAdSlotHeight = Math.round(request.linearAdSlotHeight / 3);
      loader.requestAds(request);
    }).catch(finish);
  };

  let cardObserver: IntersectionObserver | null = null;
  let mutationObserver: MutationObserver | null = null;
  const scan = () => {
    if (disposed || !cardObserver) return;
    doc.querySelectorAll<HTMLElement>('[data-index]').forEach((card) => {
      if (observedCards.has(card)) return;
      observedCards.add(card);
      card.dataset.testagramChannelKey = 'channel-' + (card.dataset.index || card.textContent?.trim().slice(0, 80) || 'unknown');
      cardObserver?.observe(card);
    });
    activeCards.forEach((card) => startAd(card));
  };

  if (typeof win.IntersectionObserver !== 'undefined') {
    cardObserver = new win.IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        const card = entry.target as HTMLElement;
        if (entry.isIntersecting && entry.intersectionRatio >= 0.75) {
          activeCards.add(card);
          startAd(card);
        } else {
          activeCards.delete(card);
        }
      });
    }, { threshold: [0.75] });
    scan();
    mutationObserver = new win.MutationObserver(scan);
    mutationObserver.observe(doc.body, { childList: true, subtree: true });
  }

  return () => {
    disposed = true;
    mutationObserver?.disconnect();
    cardObserver?.disconnect();
    finishers.forEach((finish) => finish());
    activeCards.clear();
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
