import { createClient } from '@supabase/supabase-js';
import { clearPasswordRecoverySession, markPasswordRecoverySession } from '@/lib/passwordRecovery';

const PRIMARY_SUPABASE_URL = 'https://ffrhglgkukgsuhxenena.supabase.co';
const PRIMARY_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_h51Z3EHP2LN5o7HdRAB3Og_uhUA3oya';

const SECONDARY_SUPABASE_URL = 'https://aepbqfrmheihfsauzcby.supabase.co';
const SECONDARY_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_f331BL1gsNy-otXRmQPtrw_SG8tCWLn';

const SELF_HOSTED_MODE = import.meta.env.VITE_TESTAGRAM_SELF_HOSTED === 'true';
const configuredPrimaryUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
const configuredPrimaryKey =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ||
  import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();
const configuredSecondaryUrl = import.meta.env.VITE_SUPABASE_SECONDARY_URL?.trim();
const configuredSecondaryKey =
  import.meta.env.VITE_SUPABASE_SECONDARY_PUBLISHABLE_KEY?.trim() ||
  import.meta.env.VITE_SUPABASE_SECONDARY_ANON_KEY?.trim();

function validateSelfHostedSupabaseOrigin(value: string, variableName: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(variableName + ' must be an absolute HTTP(S) origin.');
  }

  const localHTTP =
    parsed.protocol === 'http:' &&
    (parsed.hostname === 'localhost' ||
      parsed.hostname === '127.0.0.1' ||
      parsed.hostname === '[::1]' ||
      parsed.hostname === '::1');
  const hostedSupabase = parsed.hostname.toLowerCase().endsWith('.supabase.co');
  if (
    (parsed.protocol !== 'https:' && !localHTTP) ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== '/' ||
    parsed.search ||
    parsed.hash ||
    hostedSupabase
  ) {
    throw new Error(
      variableName +
        ' must be an owned HTTPS origin (HTTP is allowed only for localhost), without credentials, path, query, or fragment; hosted *.supabase.co endpoints are not accepted in self-hosted mode.',
    );
  }
  return parsed.origin;
}

// Self-hosted builds must never silently fall back to hosted Testagram projects
// or an accidentally configured hosted Supabase endpoint.
if (SELF_HOSTED_MODE && (!configuredPrimaryUrl || !configuredPrimaryKey)) {
  throw new Error(
    'Self-hosted Testagram mode requires VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY. Refusing hosted-project fallback.',
  );
}
if (SELF_HOSTED_MODE && configuredPrimaryUrl) {
  validateSelfHostedSupabaseOrigin(configuredPrimaryUrl, 'VITE_SUPABASE_URL');
}
if (
  SELF_HOSTED_MODE &&
  Boolean(configuredSecondaryUrl) !== Boolean(configuredSecondaryKey)
) {
  throw new Error(
    'Self-hosted secondary Supabase configuration requires both VITE_SUPABASE_SECONDARY_URL and VITE_SUPABASE_SECONDARY_PUBLISHABLE_KEY.',
  );
}
if (SELF_HOSTED_MODE && configuredSecondaryUrl) {
  validateSelfHostedSupabaseOrigin(configuredSecondaryUrl, 'VITE_SUPABASE_SECONDARY_URL');
}

export const supabaseUrl = SELF_HOSTED_MODE
  ? configuredPrimaryUrl!
  : configuredPrimaryUrl || PRIMARY_SUPABASE_URL;
export const supabasePublishableKey = SELF_HOSTED_MODE
  ? configuredPrimaryKey!
  : configuredPrimaryKey || PRIMARY_SUPABASE_PUBLISHABLE_KEY;
export const supabaseAnonKey = supabasePublishableKey;
export const isTestagramSelfHosted = SELF_HOSTED_MODE;

// Primary project: canonical Testagram identity/session and user-owned writes.
export const supabase = createClient(supabaseUrl, supabasePublishableKey, {
  auth: {
    flowType: 'pkce',
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storageKey: 'testagram-auth',
    // Supabase refreshes short-lived access tokens automatically and persists the
    // refreshable session across reloads. The app enforces its 24-hour maximum in
    // sessionPolicy.ts. supabase/config.toml mirrors this for local/self-hosted Auth;
    // hosted server-side session time-boxing is plan-gated and is not assumed here.
    debug: false,
  },
});

// Register immediately after client creation so a fast PKCE callback cannot emit
// PASSWORD_RECOVERY before AuthPage mounts its effect. This listener performs
// storage-only work; it must never await another Supabase Auth operation.
supabase.auth.onAuthStateChange((event, session) => {
  if (event === 'PASSWORD_RECOVERY' && session?.user?.id) {
    markPasswordRecoverySession(session.user.id);
    return;
  }
  if (event === 'SIGNED_OUT') {
    clearPasswordRecoverySession();
    return;
  }
  if (event === 'SIGNED_IN') {
    // Supabase recovery callbacks can emit SIGNED_IN as part of the same flow.
    // Keep the marker while the browser is on an explicit recovery callback;
    // otherwise clear stale markers before a normal login is hydrated.
    const params = new URLSearchParams(window.location.search);
    const isRecoveryCallback =
      window.location.pathname === '/auth' &&
      (params.get('reset') === '1' || params.get('type') === 'recovery');
    if (!isRecoveryCallback) clearPasswordRecoverySession();
  }
});

// Secondary project: legacy/expanded data plane. In hosted mode it deliberately
// uses its own issuer/session boundary. In self-hosted mode it defaults to the
// configured local project instead of silently reaching a hosted project; set
// VITE_SUPABASE_SECONDARY_URL/key only if a second self-hosted project is intended.
export const supabaseSecondaryUrl = SELF_HOSTED_MODE
  ? configuredSecondaryUrl || configuredPrimaryUrl!
  : configuredSecondaryUrl || SECONDARY_SUPABASE_URL;
export const supabaseSecondaryPublishableKey = SELF_HOSTED_MODE
  ? configuredSecondaryKey || configuredPrimaryKey!
  : configuredSecondaryKey || SECONDARY_SUPABASE_PUBLISHABLE_KEY;
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
