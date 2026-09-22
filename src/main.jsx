import { Component, createElement } from 'react';

import { createRoot } from 'react-dom/client';
import './index.css';
// Recover cleanly when a deployment replaces a stale dynamic-import chunk.
// Vite emits this event for failed async chunk loads; preventing the default
// error and reloading fetches the current deployment's module graph.
window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault();
  const key = 'testagram-preload-recovery';
  const last = Number(sessionStorage.getItem(key) ?? '0');
  if (Date.now() - last < 15000) return;
  sessionStorage.setItem(key, String(Date.now()));
  window.location.reload();
});

import { supabase } from './lib/supabase';
import { analytics } from './lib/posthog';
import { TestagramEvent, trackTestagramEvent } from './lib/testagram-analytics';

analytics.init();

supabase.auth.getSession().then(({ data }) => {
  analytics.identify(data.session?.user ?? null);
});

supabase.auth.onAuthStateChange((_event, session) => {
  analytics.identify(session?.user ?? null);
});

function trackRouteView() {
  const pathname = window.location.pathname;
  analytics.pageView(pathname);
  if (/^\/profile\//.test(pathname)) trackTestagramEvent(TestagramEvent.PROFILE_VIEWED, { path: pathname });
  if (/^\/search/.test(pathname)) trackTestagramEvent(TestagramEvent.SEARCH_PERFORMED, { source: 'route', path: pathname });
  if (/^\/notifications/.test(pathname)) trackTestagramEvent(TestagramEvent.NOTIFICATION_OPENED, { path: pathname });
  if (/^\/create-ad/.test(pathname)) trackTestagramEvent(TestagramEvent.AD_CREATE_VIEWED, { path: pathname });
  if (/^\/wallet/.test(pathname)) analytics.track('testagram_wallet_viewed', { path: pathname });
  if (/^\/messages/.test(pathname)) analytics.track('testagram_messages_viewed', { path: pathname });
}

window.addEventListener('popstate', trackRouteView);
window.addEventListener('hashchange', trackRouteView);
trackRouteView();
analytics.startSession();

const container = document.getElementById('root');
if (!container) throw new Error('Testagram root element was not found');

class AppErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error) {
    console.error('[Testagram] application render failed', error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    const message = this.state.error instanceof Error ? this.state.error.message : String(this.state.error);
    return createElement(
      'main',
      { style: { minHeight: '100vh', display: 'grid', placeItems: 'center', padding: '24px', background: '#fff', color: '#111827', fontFamily: 'system-ui, sans-serif' } },
      createElement(
        'section',
        { style: { width: '100%', maxWidth: '520px', textAlign: 'center' } },
        createElement('div', { style: { fontSize: '48px', marginBottom: '12px' } }, '⚠️'),
        createElement('h1', { style: { fontSize: '24px', margin: '0 0 8px', fontWeight: 800 } }, 'Testagram could not start'),
        createElement('p', { style: { color: '#6b7280', lineHeight: 1.6, margin: '0 0 20px' } }, 'The application hit a startup error. Refresh once to retry the latest production build.'),
        createElement('button', { onClick: () => window.location.reload(), style: { border: 0, borderRadius: '999px', padding: '12px 20px', background: '#7c3aed', color: '#fff', fontWeight: 700, cursor: 'pointer' } }, 'Refresh Testagram'),
        createElement('details', { style: { marginTop: '18px', textAlign: 'left', color: '#9ca3af', fontSize: '12px' } },
          createElement('summary', { style: { cursor: 'pointer' } }, 'Technical details'),
          createElement('pre', { style: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } }, message),
        ),
      ),
    );
  }
}

const root = createRoot(container);
const renderFatalBootError = (error) => {
  console.error('[Testagram] boot failed', error);
  const message = error instanceof Error ? error.message : String(error);
  container.innerHTML = '';
  const fallback = document.createElement('main');
  fallback.style.cssText = 'min-height:100vh;display:grid;place-items:center;padding:24px;background:#fff;color:#111827;font-family:system-ui,sans-serif;text-align:center';
  fallback.innerHTML = '<section><div style="font-size:48px;margin-bottom:12px">⚠️</div><h1 style="font-size:24px;margin:0 0 8px;font-weight:800">Testagram could not start</h1><p style="color:#6b7280;line-height:1.6">The latest app bundle did not finish starting. Refresh to retry.</p><button id="testagram-retry" style="border:0;border-radius:999px;padding:12px 20px;background:#7c3aed;color:#fff;font-weight:700;cursor:pointer">Refresh Testagram</button></section>';
  container.appendChild(fallback);
  fallback.querySelector('#testagram-retry')?.addEventListener('click', () => window.location.reload());
  if (message) console.error('[Testagram] fatal boot message:', message);
};

window.addEventListener('error', (event) => {
  if (event.error) renderFatalBootError(event.error);
});
window.addEventListener('unhandledrejection', (event) => {
  renderFatalBootError(event.reason);
});

(async () => {
  try {
    const { default: App } = await import('./App');
    root.render(createElement(AppErrorBoundary, null, createElement(App)));
  } catch (error) {
    renderFatalBootError(error);
  }
})();
