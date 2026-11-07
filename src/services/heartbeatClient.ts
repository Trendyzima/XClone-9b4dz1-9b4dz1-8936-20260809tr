import { APPWRITE_AUTH_CHANGED_EVENT, appwriteAuth } from "@/services/appwriteAuth";

const HEARTBEAT_URL = "https://heartbeat.testagram.site";

/**
 * Heartbeats represent recent user activity, not an always-on connection.
 *
 * A visible signed-in tab only sends another heartbeat when the user has
 * actually interacted with the app within the idle window. This prevents
 * background tabs and abandoned sessions from consuming backend capacity
 * capacity.
 */
const HEARTBEAT_INTERVAL_MS = 30 * 60_000;
const ACTIVE_WINDOW_MS = 20 * 60_000;
const ACTIVITY_DEBOUNCE_MS = 1_000;

let cleanup: (() => void) | undefined;

export function startTestagramHeartbeat(clientVersion = "web-v1"): () => void {
  if (typeof window === "undefined" || cleanup) return () => undefined;

  let stopped = false;
  let timer: number | undefined;
  let lastActivityAt = 0;
  let lastSentAt = 0;
  let activityGateAt = 0;
  let sending = false;
  let authenticated = false;
  let accessToken: string | null = null;
  let backoffUntil = 0;

  const clearTimer = () => {
    if (timer !== undefined) {
      window.clearTimeout(timer);
      timer = undefined;
    }
  };

  const isVisible = () => document.visibilityState === "visible";

  const hasRecentActivity = () =>
    lastActivityAt > 0 && Date.now() - lastActivityAt <= ACTIVE_WINDOW_MS;

  const schedule = () => {
    clearTimer();
    if (stopped || !authenticated || !isVisible() || !hasRecentActivity()) return;

    const now = Date.now();
    const remaining = backoffUntil > now
      ? backoffUntil - now
      : Math.max(1_000, HEARTBEAT_INTERVAL_MS - (now - lastSentAt));
    timer = window.setTimeout(() => {
      timer = undefined;
      void maybeSend();
    }, remaining);
  };

  const maybeSend = async () => {
    if (stopped || !authenticated || sending || !isVisible() || !hasRecentActivity()) return;

    const now = Date.now();
    if (backoffUntil > now) {
      schedule();
      return;
    }
    if (lastSentAt > 0 && now - lastSentAt < HEARTBEAT_INTERVAL_MS) {
      schedule();
      return;
    }

    sending = true;
    try {
      const token = accessToken;
      if (!token) return;

      const response = await fetch(HEARTBEAT_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "X-Client-Version": clientVersion,
        },
        body: "{}",
        keepalive: true,
      });

      if (response.ok) {
        lastSentAt = Date.now();
        backoffUntil = 0;
      } else if (response.status === 429) {
        // Platform quota/rate-limit response: stop retrying this tab for 6h.
        backoffUntil = Date.now() + 6 * 60 * 60_000;
      } else if (response.status >= 500) {
        // Transient backend failure: retry at most once per 30 minutes.
        backoffUntil = Date.now() + HEARTBEAT_INTERVAL_MS;
      }
    } catch {
      backoffUntil = Date.now() + HEARTBEAT_INTERVAL_MS;
      // Heartbeat is advisory; application functionality must not depend on it.
    } finally {
      sending = false;
      schedule();
    }
  };

  const markActivity = () => {
    if (stopped || !authenticated) return;
    const now = Date.now();
    lastActivityAt = now;

    if (now - activityGateAt < ACTIVITY_DEBOUNCE_MS) return;
    activityGateAt = now;

    if (isVisible()) void maybeSend();
  };

  const onVisibility = () => {
    if (isVisible() && authenticated) {
      lastActivityAt = Date.now();
      void maybeSend();
    } else {
      clearTimer();
    }
  };

  const resetAuthentication = () => {
    accessToken = null;
    authenticated = false;
    lastActivityAt = 0;
    lastSentAt = 0;
    backoffUntil = 0;
    clearTimer();
  };

  const hydrateAuthentication = async () => {
    try {
      const user = await appwriteAuth.getCurrentUser();
      if (!user) { resetAuthentication(); return; }
      accessToken = await appwriteAuth.createBackendJWT();
      authenticated = true;
      if (lastActivityAt === 0) {
        lastActivityAt = Date.now();
        lastSentAt = 0;
        backoffUntil = 0;
        void maybeSend();
      }
    } catch (error) {
      resetAuthentication();
      if (!stopped) console.warn('[Heartbeat] Appwrite auth hydration failed (non-fatal):', error);
    }
  };

  const onAuthStateChange = () => { void hydrateAuthentication(); };

  const activityEvents: Array<keyof WindowEventMap> = [
    "pointerdown",
    "keydown",
    "touchstart",
    "scroll",
    "wheel",
  ];

  for (const event of activityEvents) {
    window.addEventListener(event, markActivity, { passive: true });
  }
  document.addEventListener("visibilitychange", onVisibility);

  window.addEventListener(APPWRITE_AUTH_CHANGED_EVENT, onAuthStateChange);
  void hydrateAuthentication();

  cleanup = () => {
    stopped = true;
    authenticated = false;
    accessToken = null;
    backoffUntil = 0;
    clearTimer();
    for (const event of activityEvents) {
      window.removeEventListener(event, markActivity);
    }
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener(APPWRITE_AUTH_CHANGED_EVENT, onAuthStateChange);
    cleanup = undefined;
  };

  return cleanup;
}
