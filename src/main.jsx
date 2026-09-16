import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';
import { supabase } from './lib/supabase';
import { analytics } from './lib/posthog';

analytics.init();

// Supabase remains Testagram's source of truth for identity. PostHog only
// receives the canonical user id and non-sensitive profile metadata.
supabase.auth.getSession().then(({ data }) => {
  analytics.identify(data.session?.user ?? null);
});

supabase.auth.onAuthStateChange((_event, session) => {
  analytics.identify(session?.user ?? null);
});

// Testagram is an SPA, so route changes need explicit page-view events.
window.addEventListener('popstate', () => analytics.pageView());
window.addEventListener('hashchange', () => analytics.pageView());
analytics.pageView();
analytics.startSession();

const container = document.getElementById('root');
if (!container) throw new Error('Testagram root element was not found');

const root = createRoot(container);
root.render(createElement(App));
