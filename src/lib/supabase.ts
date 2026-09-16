import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL ?? 'https://placeholder.supabase.co';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? 'placeholder-anon-key';

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
});

// PostgREST builders are PromiseLike rather than native Promises. The
// application historically uses `.catch()` on those builders, so install a
// Promise-compatible bridge at the shared client boundary without importing
// Supabase's internal PostgREST implementation package into the browser bundle.
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
