import { createClient, PostgrestBuilder } from '@supabase/supabase-js';

const supabaseUrl     = import.meta.env.VITE_SUPABASE_URL     ?? 'https://placeholder.supabase.co';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? 'placeholder-anon-key';

// Supabase query builders are PromiseLike rather than native Promises. The
// application historically uses `.catch()` on those builders, so install a
// Promise-compatible catch bridge once at the shared client boundary.
if (typeof (PostgrestBuilder.prototype as any).catch !== 'function') {
  Object.defineProperty(PostgrestBuilder.prototype, 'catch', {
    configurable: true,
    value: function <TResult = never>(onRejected?: (reason: any) => TResult | PromiseLike<TResult>) {
      return Promise.resolve(this).catch(onRejected as any);
    },
  });
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
});
