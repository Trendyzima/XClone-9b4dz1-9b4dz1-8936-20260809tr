import { forwardRef, useCallback, useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import { getOfflineMediaUrl, cacheMedia, isOffline } from '@/lib/offlineMediaCache';

export interface UniversalVideoPlayerProps extends React.VideoHTMLAttributes<HTMLVideoElement> {
  src: string;
  active?: boolean;
  retryLimit?: number;
}

export const UniversalVideoPlayer = forwardRef<HTMLVideoElement, UniversalVideoPlayerProps>(function UniversalVideoPlayer(
  { src, active = true, retryLimit = 5, onPlaying, onPause, onTimeUpdate, onWaiting, onStalled, ...props },
  forwardedRef,
) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryCountRef = useRef(0);
  const retryingRef = useRef(false);
  const lastSrcRef = useRef('');
  const objectUrlRef = useRef<string | null>(null);
  const mountedRef = useRef(true);
  const [recovering, setRecovering] = useState(false);
  const [fatalError, setFatalError] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);
  const [showPlayFallback, setShowPlayFallback] = useState(false);

  const setVideoElement = useCallback((node: HTMLVideoElement | null) => {
    videoRef.current = node;
    if (typeof forwardedRef === 'function') forwardedRef(node);
    else if (forwardedRef) forwardedRef.current = node;
  }, [forwardedRef]);

  const isHls = useCallback((url: string) => {
    const clean = url.split('?')[0].split('#')[0].toLowerCase();
    return clean.endsWith('.m3u8') || clean.includes('.m3u8/');
  }, []);

  const cleanupHls = useCallback(() => {
    hlsRef.current?.destroy();
    hlsRef.current = null;
  }, []);

  const play = useCallback(async () => {
    const video = videoRef.current;
    if (!video || !active || !src || document.visibilityState !== 'visible') return;
    try {
      await video.play();
      if (mountedRef.current) setShowPlayFallback(false);
      retryCountRef.current = 0;
      retryingRef.current = false;
      setRecovering(false);
    } catch {
      if (mountedRef.current && active) setShowPlayFallback(true);
    }
  }, [active, src]);

  const recover = useCallback(() => {
    const video = videoRef.current;
    if (!video || !src || retryingRef.current || retryCountRef.current >= retryLimit || !navigator.onLine) return;
    retryingRef.current = true;
    const attempt = retryCountRef.current++;
    setRecovering(true);
    const delay = Math.min(8000, 350 * 2 ** attempt);
    if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    retryTimerRef.current = setTimeout(() => {
      retryingRef.current = false;
      if (!videoRef.current || !active) return;
      if (hlsRef.current) {
        hlsRef.current.startLoad();
        hlsRef.current.recoverMediaError();
        void play();
        return;
      }
      const position = Number.isFinite(video.currentTime) ? video.currentTime : 0;
      const wasPlaying = !video.paused;
      video.load();
      const resume = () => {
        video.currentTime = position;
        if (wasPlaying || active) void play();
        video.removeEventListener('loadedmetadata', resume);
        video.removeEventListener('canplay', resume);
      };
      video.addEventListener('loadedmetadata', resume, { once: true });
      video.addEventListener('canplay', resume, { once: true });
    }, delay);
  }, [active, play, retryLimit, src]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    cleanupHls();
    if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    retryCountRef.current = 0;
    retryingRef.current = false;
    setRecovering(false);
    setFatalError(false);
    setShowPlayFallback(false);
    lastSrcRef.current = src;
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }

    if (!src) {
      video.removeAttribute('src');
      video.load();
      return;
    }

    let cancelled = false;
    const configureVideo = async () => {
      let playbackSrc = src;
      // When connectivity disappears, switch the element to a locally persisted
      // Blob URL. Online playback remains network-first so normal streaming latency
      // and HLS behavior are unchanged.
      if (isOffline() && !isHls(src)) {
        const cachedUrl = await getOfflineMediaUrl(src);
        if (cancelled) {
          if (cachedUrl) URL.revokeObjectURL(cachedUrl);
          return;
        }
        if (cachedUrl) {
          objectUrlRef.current = cachedUrl;
          playbackSrc = cachedUrl;
        }
      } else if (!isHls(src)) {
        // Warm the persistent cache in the background; never delay first paint.
        void cacheMedia(src, 'video');
      }

      if (cancelled) return;
      if (isHls(playbackSrc) && Hls.isSupported()) {
        const hls = new Hls({
        autoStartLoad: true,
        enableWorker: true,
        lowLatencyMode: false,
        startFragPrefetch: true,
        maxBufferLength: 45,
        maxMaxBufferLength: 180,
        maxBufferSize: 80 * 1024 * 1024,
        backBufferLength: 30,
        maxBufferHole: 0.2,
        highBufferWatchdogPeriod: 2,
        nudgeOffset: 0.15,
        nudgeMaxRetry: 4,
        abrEwmaFastVoD: 3,
        abrEwmaSlowVoD: 9,
        abrEwmaDefaultEstimate: 500_000,
        abrEwmaDefaultEstimateMax: 3_000_000,
        abrBandWidthFactor: 0.8,
        abrBandWidthUpFactor: 0.7,
        maxStarvationDelay: 3,
        maxLoadingDelay: 3,
        capLevelOnFPSDrop: true,
        capLevelToPlayerSize: true,
        fragLoadPolicy: {
          default: {
            maxTimeToFirstByteMs: 8_000,
            maxLoadTimeMs: 30_000,
            timeoutRetry: { maxNumRetry: 3, retryDelayMs: 1_000, maxRetryDelayMs: 6_000, backoff: 'exponential' },
            errorRetry: { maxNumRetry: 3, retryDelayMs: 1_000, maxRetryDelayMs: 6_000, backoff: 'exponential' },
          },
        },
      });
      hlsRef.current = hls;
      hls.on(Hls.Events.MEDIA_ATTACHED, () => hls.loadSource(playbackSrc));
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (!data.fatal) return;
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR && retryCountRef.current < retryLimit) {
          hls.recoverMediaError();
          setRecovering(true);
          return;
        }
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR && retryCountRef.current < retryLimit) {
          recover();
          return;
        }
        setFatalError(true);
        setRecovering(false);
      });
      hls.attachMedia(video);
    } else if (isHls(playbackSrc) && video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = playbackSrc;
      video.load();
    } else {
      video.src = playbackSrc;
      video.load();
    }
    };
    void configureVideo();

    return () => {
      cancelled = true;
      cleanupHls();
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    };
  }, [cleanupHls, isHls, recover, retryLimit, retryNonce, src]);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Reels-style playback discipline: only the visible card may consume a decoder.
  // The feed already supplies the active flag, while this observer protects against
  // partial visibility during fast swipes and browser-driven layout changes.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const target = video.parentElement ?? video;
    const observer = new IntersectionObserver((entries) => {
      const visible = entries[0]?.intersectionRatio ?? 0;
      if (!active || visible < 0.65) {
        video.pause();
        return;
      }
      if (document.visibilityState === 'visible' && video.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) {
        void play();
      }
    }, { threshold: [0, 0.65, 0.9] });
    observer.observe(target);
    return () => observer.disconnect();
  }, [active, play]);

  // Suspend playback when the app/tab is backgrounded and resume the active reel
  // when it returns. This prevents hidden WebView tabs from retaining a decoder.
  useEffect(() => {
    const onVisibility = () => {
      const video = videoRef.current;
      if (!video) return;
      if (document.visibilityState !== 'visible') video.pause();
      else if (active) void play();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [active, play]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (!active) {
      video.pause();
      return;
    }
    if (video.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) void play();
  }, [active, play]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const waiting = () => { setRecovering(true); recover(); };
    const stalled = () => { setRecovering(true); recover(); };
    const playing = () => { setRecovering(false); retryCountRef.current = 0; };
    const online = () => { retryCountRef.current = 0; if (active) void play(); };
    const offline = () => setRecovering(true);
    video.addEventListener('waiting', waiting);
    video.addEventListener('stalled', stalled);
    video.addEventListener('playing', playing);
    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    return () => {
      video.removeEventListener('waiting', waiting);
      video.removeEventListener('stalled', stalled);
      video.removeEventListener('playing', playing);
      window.removeEventListener('online', online);
      window.removeEventListener('offline', offline);
    };
  }, [active, onPlaying, onStalled, onWaiting, play, recover]);

  return (
    <div className="relative h-full w-full overflow-hidden bg-black select-none" style={{ touchAction: 'pan-y' }}>
      <video
        {...props}
        ref={setVideoElement}
        autoPlay={active}
        playsInline
        disablePictureInPicture
        muted={props.muted ?? true}
        preload={props.preload ?? (active ? 'auto' : 'metadata')}
        controls={props.controls ?? false}
        draggable={false}
        onPause={onPause}
        onTimeUpdate={onTimeUpdate}
        onPlaying={onPlaying}
        onWaiting={onWaiting}
        onStalled={onStalled}
      />
      {showPlayFallback && active && !recovering && !fatalError && (
        <button
          type="button"
          aria-label="Play video"
          onClick={() => {
            const video = videoRef.current;
            if (video) {
              video.muted = false;
              void play();
            }
          }}
          className="absolute left-1/2 top-1/2 z-30 flex h-14 w-14 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-black/70 text-white shadow-2xl backdrop-blur-md border border-white/20 active:scale-95"
        >
          <span className="ml-1 text-2xl">▶</span>
        </button>
      )}
      {recovering && active && (
        <div className="pointer-events-none absolute left-1/2 top-1/2 z-20 -translate-x-1/2 -translate-y-1/2 rounded-full bg-black/70 px-3 py-1.5 text-xs font-semibold text-white backdrop-blur-sm">
          Reconnecting…
        </div>
      )}
      {fatalError && active && (
        <button
          type="button"
          onClick={() => { setFatalError(false); retryCountRef.current = 0; setRetryNonce(n => n + 1); }}
          className="absolute left-1/2 top-1/2 z-30 -translate-x-1/2 -translate-y-1/2 rounded-full bg-black/75 px-4 py-2 text-xs font-bold text-white backdrop-blur-md border border-white/15"
        >
          Tap to retry
        </button>
      )}
    </div>
  );
});
