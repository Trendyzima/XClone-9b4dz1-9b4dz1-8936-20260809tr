import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';
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
  if (/^\/create-ad/.test(pathname)) trackTestagramEvent(TestagramEvent.AD_CREATED, { stage: 'form_viewed', path: pathname });
  if (/^\/wallet/.test(pathname)) analytics.track('testagram_wallet_viewed', { path: pathname });
  if (/^\/messages/.test(pathname)) analytics.track('testagram_messages_viewed', { path: pathname });
}

window.addEventListener('popstate', trackRouteView);
window.addEventListener('hashchange', trackRouteView);
trackRouteView();
analytics.startSession();

const container = document.getElementById('root');
if (!container) throw new Error('Testagram root element was not found');

const root = createRoot(container);
root.render(createElement(App));
