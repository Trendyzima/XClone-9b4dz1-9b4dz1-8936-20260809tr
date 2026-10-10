import { useCallback, useEffect, useState } from 'react';
import { TestagramAdSlot } from '@/components/features/TestagramAdSlot';
import { useNavigate } from 'react-router-dom';
import { UserRound, LogIn, X } from 'lucide-react';
import { ExternalAdEngine } from '@/components/features/ExternalAdEngine';
import { ExoClickVastPreRoll } from '@/components/features/ExoClickVastPreRoll';
import { usePremium } from '@/hooks/usePremium';
import { useAuth } from '@/hooks/useAuth';

/**
 * Production shell for the immutable TikVTV upstream build.
 * The upstream repository is mounted as a git submodule and is never edited.
 * Keep this shell Xclone-owned; never patch vendor/TikVTV.
 */
export default function TikVTVPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { isActive: isPremium } = usePremium();
  const [ready, setReady] = useState(false);
  const [preRollDone, setPreRollDone] = useState(false);
  const [failed, setFailed] = useState(false);
  const [showAd, setShowAd] = useState(false);
  const [adsDismissed, setAdsDismissed] = useState(false);
  const completePreRoll = useCallback(() => setPreRollDone(true), []);

  useEffect(() => {
    setPreRollDone(false);
    setReady(false);
    setFailed(false);
    setShowAd(false);
    setAdsDismissed(false);
  }, []);

  // Do not compete with initial IPTV startup or inject ads into the stream.
  // The sponsored card appears as a dismissible overlay only after the player
  // shell has had time to settle; playback itself remains untouched.
  useEffect(() => {
    if (!ready || failed) return;
    const timer = window.setTimeout(() => setShowAd(true), 18000);
    return () => window.clearTimeout(timer);
  }, [ready, failed]);

  return (
    <div className="fixed inset-0 z-[60] bg-black" data-testid="iptv-page">
      <div className="absolute right-3 top-3 z-[80] flex items-center gap-2 rounded-full border border-white/15 bg-black/75 p-1.5 shadow-lg backdrop-blur-md">
        <button
          type="button"
          onClick={() => navigate(user?.username ? `/profile/${encodeURIComponent(user.username)}` : '/auth?returnTo=/iptv')}
          className="inline-flex h-9 items-center gap-2 rounded-full px-3 text-xs font-semibold text-white transition-colors hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          aria-label={user?.username ? 'Open your XClone profile' : 'Sign in to XClone'}
        >
          {user?.username ? <UserRound className="h-4 w-4" /> : <LogIn className="h-4 w-4" />}
          {user?.username ? 'XClone profile' : 'Sign in'}
        </button>
      </div>
      {!preRollDone && !isPremium && <ExoClickVastPreRoll onComplete={completePreRoll} />}
      {(preRollDone || isPremium) && !ready && !failed && (
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
      {ready && !failed && showAd && !adsDismissed && !isPremium && (
        <div className="pointer-events-none absolute inset-0 z-[75]" aria-label="Sponsored IPTV placements">
          <div className="pointer-events-auto absolute left-2 top-14 w-[min(360px,calc(100vw-1rem))]">
            <TestagramAdSlot placement="IPTV" context={{ page_path: '/iptv', surface: 'iptv_overlay' }} compact dismissible />
          </div>
          <button type="button" onClick={() => setAdsDismissed(true)} className="pointer-events-auto absolute right-3 top-14 inline-flex h-8 items-center gap-1 rounded-full border border-white/20 bg-black/80 px-3 text-xs font-semibold text-white shadow-lg" aria-label="Close sponsored overlays">
            <X className="h-3.5 w-3.5" /> Hide ads
          </button>
          <div className="pointer-events-auto absolute bottom-2 right-2 max-w-[calc(100vw-1rem)]">
            <ExternalAdEngine surface="overlay" />
          </div>
        </div>
      )}
      {(preRollDone || isPremium) && <iframe
        title="Testagram IPTV"
        src="/iptv-app/entry.html"
        className="h-full w-full border-0 bg-black"
        allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
        allowFullScreen
        onLoad={() => setReady(true)}
        onError={() => setFailed(true)}
      />}
    </div>
  );
}
