/**
 * Page-wide video preload coordinator.
 *
 * Only three feed videos may own a source at a time: the most visible video
 * plus the next-nearest candidates in the current scroll direction. Removing
 * eligibility unmounts the media source in the player, which cancels stale
 * downloads instead of merely changing the browser's preload hint.
 */
type Candidate = {
  id: string;
  element: HTMLVideoElement;
  onEligibilityChange: (eligible: boolean) => void;
  eligible: boolean;
};

const MAX_PRELOADED_VIDEOS = 3;
const CANDIDATE_DISTANCE_VIEWPORTS = 1.15;
const KEEP_ABOVE_VIEWPORT_VIEWPORTS = 0.2;

const candidates = new Map<string, Candidate>();
let frame = 0;
let lastScrollY = typeof window !== 'undefined' ? window.scrollY : 0;
let scrollDirection: 'down' | 'up' = 'down';
let listenersAttached = false;

function scheduleRefresh() {
  if (typeof window === 'undefined' || frame) return;
  frame = window.requestAnimationFrame(() => {
    frame = 0;
    refreshEligibility();
  });
}

function onScroll() {
  const currentY = window.scrollY;
  if (currentY !== lastScrollY) scrollDirection = currentY > lastScrollY ? 'down' : 'up';
  lastScrollY = currentY;
  scheduleRefresh();
}

function attachListeners() {
  if (listenersAttached || typeof window === 'undefined') return;
  listenersAttached = true;
  window.addEventListener('scroll', onScroll, { passive: true, capture: true });
  window.addEventListener('resize', scheduleRefresh, { passive: true });
  document.addEventListener('visibilitychange', scheduleRefresh);
}

function detachListeners() {
  if (!listenersAttached || typeof window === 'undefined') return;
  listenersAttached = false;
  window.removeEventListener('scroll', onScroll, true);
  window.removeEventListener('resize', scheduleRefresh);
  document.removeEventListener('visibilitychange', scheduleRefresh);
  if (frame) window.cancelAnimationFrame(frame);
  frame = 0;
}

function refreshEligibility() {
  if (typeof window === 'undefined' || document.visibilityState !== 'visible') {
    candidates.forEach((candidate) => setEligible(candidate, false));
    return;
  }

  const viewportHeight = Math.max(1, window.innerHeight);
  const scored = Array.from(candidates.values()).flatMap((candidate) => {
    const rect = candidate.element.getBoundingClientRect();
    const height = Math.max(1, rect.height);
    const visiblePixels = Math.max(0, Math.min(rect.bottom, viewportHeight) - Math.max(rect.top, 0));
    const visibleRatio = Math.min(1, visiblePixels / height);
    const distance = rect.top > viewportHeight
      ? rect.top - viewportHeight
      : rect.bottom < 0
        ? -rect.bottom
        : 0;

    // Drop videos well behind the scroll position; keep only the current
    // viewport and a modest look-ahead window so old buffers are released.
    if (rect.bottom < -viewportHeight * KEEP_ABOVE_VIEWPORT_VIEWPORTS) return [];
    if (distance > viewportHeight * CANDIDATE_DISTANCE_VIEWPORTS) return [];

    const aheadDistance = scrollDirection === 'down'
      ? (rect.top >= viewportHeight ? rect.top - viewportHeight : rect.top >= 0 ? 0 : viewportHeight + Math.abs(rect.bottom))
      : (rect.bottom <= 0 ? Math.abs(rect.bottom) : rect.bottom <= viewportHeight ? 0 : viewportHeight + rect.top);

    return [{ candidate, visibleRatio, distance, aheadDistance }];
  });

  scored.sort((a, b) => {
    const aVisible = a.visibleRatio > 0;
    const bVisible = b.visibleRatio > 0;
    if (aVisible !== bVisible) return aVisible ? -1 : 1;
    if (aVisible && bVisible && a.visibleRatio !== b.visibleRatio) return b.visibleRatio - a.visibleRatio;
    if (a.aheadDistance !== b.aheadDistance) return a.aheadDistance - b.aheadDistance;
    return a.distance - b.distance;
  });

  const eligibleIds = new Set(scored.slice(0, MAX_PRELOADED_VIDEOS).map(({ candidate }) => candidate.id));
  candidates.forEach((candidate) => setEligible(candidate, eligibleIds.has(candidate.id)));
}

function setEligible(candidate: Candidate, eligible: boolean) {
  if (candidate.eligible === eligible) return;
  candidate.eligible = eligible;
  candidate.onEligibilityChange(eligible);
}

export function registerVideoPreloadCandidate(
  id: string,
  element: HTMLVideoElement,
  onEligibilityChange: (eligible: boolean) => void,
): () => void {
  attachListeners();
  const candidate: Candidate = { id, element, onEligibilityChange, eligible: false };
  candidates.set(id, candidate);
  scheduleRefresh();

  return () => {
    const current = candidates.get(id);
    if (current !== candidate) return;
    candidates.delete(id);
    setEligible(candidate, false);
    if (candidates.size === 0) detachListeners();
    else scheduleRefresh();
  };
}
