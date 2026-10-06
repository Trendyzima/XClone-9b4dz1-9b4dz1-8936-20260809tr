import { supabase, supabaseSecondary } from '@/lib/supabase';

export type DataPlane = 'primary' | 'secondary'; // dual-plane routing contract

export const DATA_PLANE_FEATURES = {
  authAndIdentity: { canonical: 'primary', clientAccess: 'primary' },
  legalAndAgeGate: { canonical: 'primary', clientAccess: 'primary' },
  walletAndLedger: { canonical: 'primary', clientAccess: 'primary' },
  mpesaAndPayments: { canonical: 'primary', clientAccess: 'primary' },
  ridesAndSettlement: { canonical: 'primary', clientAccess: 'primary' },
  marketplaceOrdersAndPayouts: { canonical: 'primary', clientAccess: 'primary' },
  notificationsAndPreferences: { canonical: 'primary', clientAccess: 'primary' },
  messagesAndE2EEState: { canonical: 'primary', clientAccess: 'primary' },
  socialCanonicalWrites: { canonical: 'primary', clientAccess: 'primary' },
  publicPostsAndLegacyDiscovery: { canonical: 'secondary', clientAccess: 'secondary-read' },
  publicTrendingAndDiscovery: { canonical: 'secondary', clientAccess: 'secondary-read' },
  federationPublicReadCache: { canonical: 'secondary', clientAccess: 'secondary-read' },
  publicMediaCatalog: { canonical: 'secondary', clientAccess: 'secondary-read' },
  iptvWorldTvCatalog: { canonical: 'secondary', clientAccess: 'secondary-read' },
  streamingMetadata: { canonical: 'secondary', clientAccess: 'secondary-read' },
  publicNewsAndPodcastCatalogs: { canonical: 'secondary', clientAccess: 'secondary-read' },
  legacyHighVolumeData: { canonical: 'secondary', clientAccess: 'secondary-read' },
} as const;

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
  'profiles', 'wallets', 'wallet_accounts', 'wallet_transactions',
  'ledger_transactions', 'ledger_entries', 'transactions', 'mpesa_payments',
  'wallet_security', 'payouts', 'payout_accounts', 'rides', 'orders',
  'marketplace_deliveries', 'notifications', 'notification_preferences',
  'messages', 'conversations',
]);

export const SECONDARY_SERVER_WRITE_TABLES = new Set([
  'posts', 'post_media', 'products', 'trending_topics', 'federated_objects',
  'federated_actors', 'federated_instances', 'live_streams', 'media_assets',
  'news_items', 'podcasts', 'podcast_episodes', 'tv_catalog_channels',
  'tv_catalog_health',
]);

export const PUBLIC_READ_FALLBACK_TABLES = new Set([
  'posts', 'post_media', 'hashtags', 'trending_topics', 'federated_objects',
  'federated_actors', 'federated_instances', 'live_streams', 'stories',
  'products', 'podcasts', 'podcast_episodes', 'news_items',
  'content_recommendations', 'tv_channel_reactions', 'media_assets',
]);

export function clientFor(plane: DataPlane) {
  return plane === 'secondary' ? supabaseSecondary : supabase;
}

/** Browser/client writes are always canonical on the primary project. */
export function assertWritePlane(table: string, plane: DataPlane = 'primary') {
  if (plane !== 'primary') {
    throw new Error('Client writes to "' + table + '" are restricted to the primary Testagram data plane.');
  }
}

/** Server-side replication/ingestion must opt into an explicitly approved table. */
export function assertSecondaryServerWrite(table: string) {
  if (!SECONDARY_SERVER_WRITE_TABLES.has(table)) {
    throw new Error('Secondary server writes are not approved for "' + table + '".');
  }
}

export function isPrimaryOnlyTable(table: string) {
  return PRIMARY_ONLY_TABLES.has(table);
}

/** Public/read-heavy data can fail over without moving the primary JWT. */
export async function readPublicWithFallback<T>(
  table: string,
  primaryQuery: (client: typeof supabase) => PromiseLike<{ data: T | null; error: any }>,
  secondaryQuery?: (client: typeof supabaseSecondary) => PromiseLike<{ data: T | null; error: any }>,
): Promise<{ data: T | null; source: DataPlane; primaryError?: any; secondaryError?: any }> {
  const primary = await primaryQuery(supabase);
  if (!primary.error && primary.data != null) return { data: primary.data, source: 'primary' };

  if (!PUBLIC_READ_FALLBACK_TABLES.has(table) || !secondaryQuery) {
    return { data: primary.data, source: 'primary', primaryError: primary.error };
  }

  const secondary = await secondaryQuery(supabaseSecondary);
  if (!secondary.error && secondary.data != null) {
    return { data: secondary.data, source: 'secondary', primaryError: primary.error };
  }

  return {
    data: primary.data,
    source: 'primary',
    primaryError: primary.error,
    secondaryError: secondary.error,
  };
}

/** Queries both public planes so catalog/discovery callers can merge and dedupe. */
export async function readPublicExpansion<T>(
  table: string,
  primaryQuery: (client: typeof supabase) => PromiseLike<{ data: T | null; error: any }>,
  secondaryQuery?: (client: typeof supabaseSecondary) => PromiseLike<{ data: T | null; error: any }>,
): Promise<{ primary: T | null; secondary: T | null; primaryError?: any; secondaryError?: any }> {
  const primary = await primaryQuery(supabase);
  if (!PUBLIC_READ_FALLBACK_TABLES.has(table) || !secondaryQuery) {
    return { primary: primary.data, secondary: null, primaryError: primary.error };
  }
  const secondary = await secondaryQuery(supabaseSecondary);
  return {
    primary: primary.data,
    secondary: secondary.data,
    primaryError: primary.error,
    secondaryError: secondary.error,
  };
}
