import { createClient } from '@supabase/supabase-js';

const CANONICAL_SUPABASE_URL = 'https://ffrhglgkukgsuhxenena.supabase.co';
const CANONICAL_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_h51Z3EHP2LN5o7HdRAB3Og_uhUA3oya';

// One backend identity plane for the entire app. Do not allow build-time VITE_*
// variables to silently point Auth/PostgREST at a different Supabase project.
export const supabaseUrl = CANONICAL_SUPABASE_URL;
export const supabasePublishableKey = CANONICAL_SUPABASE_PUBLISHABLE_KEY;

export const supabase = createClient(supabaseUrl, supabasePublishableKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
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
