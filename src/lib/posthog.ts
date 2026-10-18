import type { User } from '@supabase/supabase-js';

const apiKey = import.meta.env.VITE_POSTHOG_KEY as string | undefined;
const apiHost = ((import.meta.env.VITE_POSTHOG_HOST as string | undefined) || 'https://us.i.posthog.com').replace(/\/$/, '');

type PostHogClient = typeof import('posthog-js').default;
type AnalyticsOperation = (client: PostHogClient) => void;

let posthog: PostHogClient | null = null;
let initialized = false;
let loading: Promise<void> | null = null;
let idleScheduled = false;
const pendingOperations: AnalyticsOperation[] = [];

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

function initializeClient(client: PostHogClient): void {
  if (initialized || !apiKey) return;

  client.init(apiKey, {
    api_host: apiHost,
    defaults: '2026-05-30',
    capture_pageview: false,
    capture_pageleave: true,
    autocapture: true,
    capture_exceptions: true,
    persistence: 'localStorage+cookie',
    loaded: (instance) => {
      instance.register({
        app: 'testagram',
        platform: 'web',
      });
    },
  });

  initialized = true;
}

function loadAnalytics(): void {
  idleScheduled = false;
  if (initialized || loading || !apiKey || typeof window === 'undefined') return;

  loading = import('posthog-js')
    .then(({ default: client }) => {
      posthog = client;
      initializeClient(client);
      const operations = pendingOperations.splice(0);
      for (const operation of operations) {
        try {
          operation(client);
        } catch (error) {
          console.warn('[Testagram] analytics operation failed (non-fatal):', error);
        }
      }
    })
    .catch((error) => {
      // Analytics must never block app startup. A later event may retry loading.
      console.warn('[Testagram] analytics SDK failed to load (non-fatal):', error);
    })
    .finally(() => {
      loading = null;
    });
}

function scheduleAnalyticsLoad(): void {
  if (!apiKey || initialized || loading || idleScheduled || typeof window === 'undefined') return;
  idleScheduled = true;
  const idleWindow = window as any;
  if (typeof idleWindow.requestIdleCallback === 'function') {
    idleWindow.requestIdleCallback(loadAnalytics, { timeout: 2500 });
  } else {
    window.setTimeout(loadAnalytics, 900);
  }
}

function runOrQueue(operation: AnalyticsOperation): void {
  if (!apiKey) return;
  if (posthog && initialized) {
    try {
      operation(posthog);
    } catch (error) {
      console.warn('[Testagram] analytics operation failed (non-fatal):', error);
    }
    return;
  }
  pendingOperations.push(operation);
  scheduleAnalyticsLoad();
}

export function initAnalytics(): void {
  scheduleAnalyticsLoad();
}

export function identifyAnalyticsUser(user: User | null): void {
  runOrQueue((client) => {
    if (!user) {
      client.reset();
      return;
    }

    const metadata = user.user_metadata ?? {};
    client.identify(user.id, safeProperties({
      username: metadata.username ?? metadata.preferred_username,
      email_domain: user.email?.split('@')[1],
      auth_method: user.phone ? 'phone' : 'email',
    }));
  });
}

export function trackAnalyticsEvent(event: string, properties?: Record<string, unknown>): void {
  runOrQueue((client) => {
    client.capture(event, safeProperties(properties));
  });
}

export function trackPageView(pathname = window.location.pathname): void {
  runOrQueue((client) => {
    client.capture('$pageview', {
      $current_url: window.location.href,
      pathname,
    });
  });
}

export function setAnalyticsUserProperties(properties: Record<string, unknown>): void {
  runOrQueue((client) => {
    client.setPersonProperties(safeProperties(properties) ?? {});
  });
}

export function startAnalyticsSession(): void {
  trackAnalyticsEvent('testagram_session_started', {
    app: 'testagram',
    platform: 'web',
  });
}

export function shutdownAnalytics(): void {
  if (initialized && posthog) posthog.reset();
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
