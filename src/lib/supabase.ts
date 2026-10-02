import { createClient } from '@supabase/supabase-js';

const DEFAULT_SUPABASE_URL = 'https://ffrhglgkukgsuhxenena.supabase.co';
const DEFAULT_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_h51Z3EHP2LN5o7HdRAB3Og_uhUA3oya';

const configuredSupabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
const configuredPublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();

// The backend identity is environment-selectable so the same web/desktop/Android
// build can be pointed at a compatible Supabase backend during a controlled
// migration. Production keeps the current backend when variables are absent.
export const supabaseUrl = configuredSupabaseUrl || DEFAULT_SUPABASE_URL;
export const supabasePublishableKey =
  configuredPublishableKey || DEFAULT_SUPABASE_PUBLISHABLE_KEY;

export const supabase = createClient(supabaseUrl, supabasePublishableKey, {
  auth: {
    // PKCE keeps browser and native-WebView auth codes out of the URL fragment
    // and gives Testagram one session model across web, Android, and iOS.
    flowType: 'pkce',
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storageKey: 'testagram-auth',
  },
});

// PostgREST builders are PromiseLike rather than native Promises. The
// application historically uses .catch() on those builders, so install a
// Promise-compatible bridge at the shared client boundary.
let postgrestBuilderPrototype: object | null = Object.getPrototypeOf(
  supabase.from('__prototype_probe__'),
);

while (
  postgrestBuilderPrototype &&
  typeof (postgrestBuilderPrototype as { then?: unknown }).then !== 'function'
) {
  postgrestBuilderPrototype = Object.getPrototypeOf(postgrestBuilderPrototype);
}

if (
  postgrestBuilderPrototype &&
  typeof (postgrestBuilderPrototype as { catch?: unknown }).catch !== 'function'
) {
  Object.defineProperty(postgrestBuilderPrototype, 'catch', {
    configurable: true,
    value: function <TResult = never>(
      this: PromiseLike<unknown>,
      onRejected?: (reason: unknown) => TResult | PromiseLike<TResult>,
    ) {
      return Promise.resolve(this).catch(onRejected as ((reason: unknown) => TResult | PromiseLike<TResult>) | undefined);
    },
  });
}
