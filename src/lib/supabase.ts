import { createClient } from '@supabase/supabase-js';

const CANONICAL_SUPABASE_URL = 'https://ffrhglgkukgsuhxenena.supabase.co';
const RETIRED_SUPABASE_URL = 'https://aepbqfrmheihfsauzcby.supabase.co';

// Publishable/anon keys are intentionally safe for browser exposure. Environment
// variables remain preferred; the canonical fallback keeps the rebuilt app bootable
// if Vercel env injection is temporarily absent.
export const supabaseUrl = import.meta.env.VITE_SUPABASE_URL ?? CANONICAL_SUPABASE_URL;
export const supabasePublishableKey =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
  import.meta.env.VITE_SUPABASE_ANON_KEY ??
  'sb_publishable_h51Z3EHP2LN5o7HdRAB3Og_uhUA3oya';

// Fail closed if an environment variable accidentally points the frontend back at
// the retired Auth/database project. This prevents local/preview builds from
// silently authenticating against a different backend than production.
if (supabaseUrl === RETIRED_SUPABASE_URL) {
  throw new Error(
    'Invalid Supabase configuration: the retired Testagram project is configured. ' +
      'Use the canonical rebuilt backend at ' + CANONICAL_SUPABASE_URL,
  );
}

export const supabase = createClient(supabaseUrl, supabasePublishableKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
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
