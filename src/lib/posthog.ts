import posthog from 'posthog-js';
import type { User } from '@supabase/supabase-js';

const apiKey = import.meta.env.VITE_POSTHOG_KEY as string | undefined;
const apiHost = (import.meta.env.VITE_POSTHOG_HOST as string | undefined) || 'https://us.i.posthog.com';

let initialized = false;

export function initAnalytics(): void {
  if (initialized || !apiKey) return;

  posthog.init(apiKey, {
    api_host: apiHost,
    capture_pageview: false,
    capture_pageleave: true,
    autocapture: true,
    persistence: 'localStorage+cookie',
    person_profiles: 'identified_only',
    respect_dnt: true,
    loaded: () => {
      initialized = true;
    },
  });

  initialized = true;
}

function safeProperties(properties?: Record<string, unknown>) {
  if (!properties) return undefined;
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(properties)) {
    if (value === undefined) continue;
    // Never send secrets, auth tokens, payment credentials, or raw message bodies.
    if (/token|secret|password|authorization|cookie|card|cvv|otp|access[_-]?key/i.test(key)) continue;
    result[key] = value;
  }
  return result;
}

export function identifyAnalyticsUser(user: User | null): void {
  if (!initialized) initAnalytics();
  if (!initialized) return;

  if (!user) {
    posthog.reset();
    return;
  }

  const metadata = user.user_metadata ?? {};
  posthog.identify(user.id, {
    username: metadata.username ?? metadata.preferred_username ?? undefined,
    email_domain: user.email?.split('@')[1] ?? undefined,
    auth_method: user.phone ? 'phone' : 'email',
  });
}

export function trackAnalyticsEvent(event: string, properties?: Record<string, unknown>): void {
  if (!initialized) initAnalytics();
  if (!initialized) return;
  posthog.capture(event, safeProperties(properties));
}

export function trackPageView(pathname = window.location.pathname): void {
  trackAnalyticsEvent('$pageview', {
    $current_url: window.location.href,
    pathname,
  });
}

export function setAnalyticsUserProperties(properties: Record<string, unknown>): void {
  if (!initialized) initAnalytics();
  if (!initialized) return;
  posthog.setPersonProperties(safeProperties(properties) ?? {});
}

export function startAnalyticsSession(): void {
  trackAnalyticsEvent('testagram_session_started', {
    app: 'testagram',
    platform: 'web',
  });
}

export function shutdownAnalytics(): void {
  if (!initialized) return;
  posthog.reset();
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
