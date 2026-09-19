import { supabase } from "@/lib/supabase";

const HEARTBEAT_URL = "https://heartbeat.testagram.site";

/**
 * Heartbeats represent recent user activity, not an always-on connection.
 *
 * A visible signed-in tab only sends another heartbeat when the user has
 * actually interacted with the app within the idle window. This prevents
 * background tabs and abandoned sessions from consuming Worker/Supabase
 * capacity.
 */
const HEARTBEAT_INTERVAL_MS = 15 * 60_000;
const ACTIVE_WINDOW_MS = 10 * 60_000;
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
    if (stopped || !isVisible() || !hasRecentActivity()) return;

    const remaining = Math.max(1_000, HEARTBEAT_INTERVAL_MS - (Date.now() - lastSentAt));
    timer = window.setTimeout(() => {
      timer = undefined;
      void maybeSend();
    }, remaining);
  };

  const maybeSend = async () => {
    if (stopped || sending || !isVisible() || !hasRecentActivity()) return;

    const now = Date.now();
    if (lastSentAt > 0 && now - lastSentAt < HEARTBEAT_INTERVAL_MS) {
      schedule();
      return;
    }

    sending = true;
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
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

      if (response.ok) lastSentAt = Date.now();
    } catch {
      // Heartbeat is advisory; application functionality must not depend on it.
    } finally {
      sending = false;
      schedule();
    }
  };

  const markActivity = () => {
    if (stopped) return;
    const now = Date.now();
    lastActivityAt = now;

    if (now - activityGateAt < ACTIVITY_DEBOUNCE_MS) return;
    activityGateAt = now;

    if (isVisible()) void maybeSend();
  };

  const onVisibility = () => {
    if (isVisible()) {
      lastActivityAt = Date.now();
      void maybeSend();
    } else {
      clearTimer();
    }
  };

  const onAuthStateChange = (_event: string, session: { access_token?: string } | null) => {
    if (session?.access_token) {
      lastActivityAt = Date.now();
      lastSentAt = 0;
      void maybeSend();
    } else {
      lastActivityAt = 0;
      lastSentAt = 0;
      clearTimer();
    }
  };

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

  const { data: authSubscription } = supabase.auth.onAuthStateChange(onAuthStateChange);

  void supabase.auth.getSession().then(({ data }) => {
    if (stopped || !data.session) return;
    lastActivityAt = Date.now();
    void maybeSend();
  });

  cleanup = () => {
    stopped = true;
    clearTimer();
    for (const event of activityEvents) {
      window.removeEventListener(event, markActivity);
    }
    document.removeEventListener("visibilitychange", onVisibility);
    authSubscription.subscription.unsubscribe();
    cleanup = undefined;
  };

  return cleanup;
}
