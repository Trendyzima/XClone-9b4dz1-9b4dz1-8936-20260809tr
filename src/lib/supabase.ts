import { createClient } from '@supabase/supabase-js';

// Publishable/anon keys are intentionally safe for browser exposure. Environment
// variables remain preferred; canonical fallbacks keep the rebuilt app bootable
// if Vercel env injection is temporarily absent.
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL ?? 'https://ffrhglgkukgsuhxenena.supabase.co';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? 'sb_publishable_h51Z3EHP2LN5o7HdRAB3Og_uhUA3oya';

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
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
