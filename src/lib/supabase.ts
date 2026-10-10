import { createClient } from '@supabase/supabase-js';

// Capture the original callback URL before createClient's automatic PKCE
// detection can exchange the code and clean it out of window.location.
export const initialAuthCallbackSearch =
  typeof window !== 'undefined' ? window.location.search : '';

const PRIMARY_SUPABASE_URL = 'https://ffrhglgkukgsuhxenena.supabase.co';
const PRIMARY_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_h51Z3EHP2LN5o7HdRAB3Og_uhUA3oya';

const SECONDARY_SUPABASE_URL = 'https://aepbqfrmheihfsauzcby.supabase.co';
const SECONDARY_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_f331BL1gsNy-otXRmQPtrw_SG8tCWLn';

const configuredPrimaryUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
const configuredPrimaryKey = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY)?.trim();
const configuredSecondaryUrl = import.meta.env.VITE_SUPABASE_SECONDARY_URL?.trim();
const configuredSecondaryKey = (import.meta.env.VITE_SUPABASE_SECONDARY_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_SECONDARY_ANON_KEY)?.trim();

export const supabaseUrl = configuredPrimaryUrl || PRIMARY_SUPABASE_URL;
export const supabasePublishableKey = configuredPrimaryKey || PRIMARY_SUPABASE_PUBLISHABLE_KEY;
export const supabaseAnonKey = supabasePublishableKey;

// Primary project: canonical Testagram identity/session and user-owned writes.
export const supabase = createClient(supabaseUrl, supabasePublishableKey, {
  auth: {
    flowType: 'pkce',
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storageKey: 'testagram-auth',
    // Supabase refreshes short-lived access tokens automatically. The application
    // and hosted Auth session time-box must both be configured for 24 hours; the
    // repository setting lives in supabase/config.toml and must be applied remotely.
    debug: false,
  },
});

// Secondary project: legacy/expanded data plane. It has its own API client and
// deliberately does not share the primary auth session. Do not send a primary
// JWT to this project; Supabase projects have independent JWT issuers.
export const supabaseSecondaryUrl = configuredSecondaryUrl || SECONDARY_SUPABASE_URL;
export const supabaseSecondaryPublishableKey = configuredSecondaryKey || SECONDARY_SUPABASE_PUBLISHABLE_KEY;
export const supabaseSecondary = createClient(
  supabaseSecondaryUrl,
  supabaseSecondaryPublishableKey,
  {
    auth: {
      flowType: 'pkce',
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storageKey: 'testagram-secondary-auth',
    },
  },
);

export type SupabaseProject = 'primary' | 'secondary';

export function getSupabaseClient(project: SupabaseProject = 'primary') {
  return project === 'secondary' ? supabaseSecondary : supabase;
}

// PostgREST builders are PromiseLike rather than native Promises. The
// application historically uses .catch() on those builders, so install a
// Promise-compatible bridge at the shared client boundary.
for (const client of [supabase, supabaseSecondary]) {
  let postgrestBuilderPrototype: object | null = Object.getPrototypeOf(
    client.from('__prototype_probe__'),
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
        return Promise.resolve(this).catch(
          onRejected as ((reason: unknown) => TResult | PromiseLike<TResult>) | undefined,
        );
      },
    });
  }
}
