import type { User } from '@supabase/supabase-js';

const apiKey = import.meta.env.VITE_POSTHOG_KEY as string | undefined;
const apiHost = ((import.meta.env.VITE_POSTHOG_HOST as string | undefined) || 'https://us.i.posthog.com').replace(/\/$/, '');

let initialized = false;
let currentUserId: string | null = null;

export function initAnalytics(): void {
  if (initialized || !apiKey) return;
  initialized = true;
}

function safeProperties(properties?: Record<string, unknown>) {
  if (!properties) return undefined;
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(properties)) {
    if (value === undefined) continue;
    if (/token|secret|password|authorization|cookie|card|cvv|otp|access[_-]?key/i.test(key)) continue;
    result[key] = value;
  }
  return result;
}

async function capture(event: string, properties?: Record<string, unknown>, distinctId = currentUserId ?? undefined): Promise<void> {
  if (!apiKey || !distinctId) return;

  const payload = {
    api_key: apiKey,
    event,
    distinct_id: distinctId,
    properties: {
      ...(safeProperties(properties) ?? {}),
      $lib: 'testagram-analytics',
      $lib_version: '1.0.0',
    },
  };

  try {
    await fetch(`${apiHost}/capture/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true,
    });
  } catch {
    // Analytics must never break Testagram's product flows.
  }
}

export function identifyAnalyticsUser(user: User | null): void {
  initAnalytics();
  if (!initialized) return;

  if (!user) {
    currentUserId = null;
    return;
  }

  currentUserId = user.id;
  const metadata = user.user_metadata ?? {};
  const properties = safeProperties({
    username: metadata.username ?? metadata.preferred_username,
    email_domain: user.email?.split('@')[1],
    auth_method: user.phone ? 'phone' : 'email',
  });

  void capture('$identify', {
    $set: properties,
    $set_once: { first_seen_as_testagram_user: new Date().toISOString() },
  }, user.id);
}

export function trackAnalyticsEvent(event: string, properties?: Record<string, unknown>): void {
  initAnalytics();
  if (!initialized || !currentUserId) return;
  void capture(event, properties);
}

export function trackPageView(pathname = window.location.pathname): void {
  trackAnalyticsEvent('$pageview', {
    $current_url: window.location.href,
    pathname,
  });
}

export function setAnalyticsUserProperties(properties: Record<string, unknown>): void {
  if (!currentUserId) return;
  void capture('$set', { $set: safeProperties(properties) ?? {} });
}

export function startAnalyticsSession(): void {
  trackAnalyticsEvent('testagram_session_started', {
    app: 'testagram',
    platform: 'web',
  });
}

export function shutdownAnalytics(): void {
  currentUserId = null;
}

export const analytics = {
  init: initAnalytics,
  identify: identifyAnalyticsUser,
  track: trackAnalyticsEvent,
  pageView: trackPageView,
  setUserProperties: setAnalyticsUserProperties,
  startSession: startAnalyticsSession,
  reset: shutdownAnalytics,
};
