import { forwardRef, useCallback, useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';

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
  const [recovering, setRecovering] = useState(false);

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
    if (!video || !active || !src) return;
    try {
      await video.play();
      retryCountRef.current = 0;
      retryingRef.current = false;
      setRecovering(false);
    } catch {
      // Autoplay policy can reject; user interaction will retry.
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
    lastSrcRef.current = src;

    if (!src) {
      video.removeAttribute('src');
      video.load();
      return;
    }

    if (isHls(src) && Hls.isSupported()) {
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
      hls.on(Hls.Events.MEDIA_ATTACHED, () => hls.loadSource(src));
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (!data.fatal) return;
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
        else if (data.type === Hls.ErrorTypes.NETWORK_ERROR) recover();
        else recover();
      });
      hls.attachMedia(video);
    } else if (isHls(src) && video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = src;
      video.load();
    } else {
      video.src = src;
      video.load();
    }

    return () => {
      cleanupHls();
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    };
  }, [cleanupHls, isHls, recover, src]);

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
    <div className="relative h-full w-full">
      <video
        ref={setVideoElement}
        {...props}
        playsInline
        controls={props.controls ?? false}
        onPause={onPause}
        onTimeUpdate={onTimeUpdate}
      />
      {recovering && active && (
        <div className="pointer-events-none absolute left-1/2 top-1/2 z-20 -translate-x-1/2 -translate-y-1/2 rounded-full bg-black/70 px-3 py-1.5 text-xs font-semibold text-white backdrop-blur-sm">
          Reconnecting…
        </div>
      )}
    </div>
  );
});
