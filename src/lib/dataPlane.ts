import { supabase, supabaseSecondary } from '@/lib/supabase';

export type DataPlane = 'primary' | 'secondary';

export const DATA_PLANE_POLICY = {
  identity: 'primary',
  legal: 'primary',
  wallet: 'primary',
  payments: 'primary',
  userOwnedWrites: 'primary',
  socialCanonicalWrites: 'primary',
  publicReadReplica: 'secondary',
  legacyData: 'secondary',
} as const;

export const PRIMARY_ONLY_TABLES = new Set([
  'profiles',
  'wallets',
  'wallet_accounts',
  'wallet_transactions',
  'ledger_transactions',
  'ledger_entries',
  'transactions',
  'mpesa_payments',
  'wallet_security',
  'payouts',
  'payout_accounts',
]);

export const PUBLIC_READ_FALLBACK_TABLES = new Set([
  'posts',
  'post_media',
  'hashtags',
  'trending_topics',
  'federated_objects',
  'federated_actors',
  'federated_instances',
  'live_streams',
  'stories',
  'products',
  'podcasts',
  'podcast_episodes',
  'news_items',
  'content_recommendations',
  'tv_channel_reactions',
]);

export function clientFor(plane: DataPlane) {
  return plane === 'secondary' ? supabaseSecondary : supabase;
}

export function assertWritePlane(table: string, plane: DataPlane = 'primary') {
  if (plane !== 'primary') {
    throw new Error(`Writes to "${table}" are restricted to the primary Testagram data plane.`);
  }
}

/**
 * Public/read-heavy data can fail over to the secondary project without
 * ever moving authenticated user credentials across Supabase projects.
 *
 * Important: an empty primary result is NOT treated as an error. The
 * secondary project is queried as a replica/fallback only when requested.
 */
export async function readPublicWithFallback<T>(
  table: string,
  primaryQuery: (client: typeof supabase) => PromiseLike<{ data: T | null; error: any }>,
  secondaryQuery?: (client: typeof supabaseSecondary) => PromiseLike<{ data: T | null; error: any }>,
): Promise<{ data: T | null; source: DataPlane; primaryError?: any; secondaryError?: any }> {
  const primary = await primaryQuery(supabase);
  if (!primary.error && primary.data != null) {
    return { data: primary.data, source: 'primary' };
  }

  if (!PUBLIC_READ_FALLBACK_TABLES.has(table) || !secondaryQuery) {
    return { data: primary.data, source: 'primary', primaryError: primary.error };
  }

  const secondary = await secondaryQuery(supabaseSecondary);
  if (!secondary.error && secondary.data != null) {
    return {
      data: secondary.data,
      source: 'secondary',
      primaryError: primary.error,
    };
  }

  return {
    data: primary.data,
    source: 'primary',
    primaryError: primary.error,
    secondaryError: secondary.error,
  };
}
