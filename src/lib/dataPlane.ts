

export type DataPlane = 'primary' | 'secondary';

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
  tvChannelHealth: { canonical: 'testagram-postgres', clientAccess: 'backend-read' },
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

/**
 * Browser database clients are retired. Data access must go through the
 * authenticated Backend API; compatibility functions fail closed so old
 * callers cannot silently reconnect to retired database projects.
 */
export type RetiredDataPlaneClient = {
  from: (table: string) => any;
  rpc: (name: string, args?: Record<string, unknown>) => any;
};

function retiredClient(): RetiredDataPlaneClient {
  const reject = (operation: string): never => {
    throw new Error('DIRECT_DATABASE_ACCESS_REMOVED: ' + operation + ' must be implemented by the central Testagram Backend API.');
  };
  return {
    from: (table: string) => reject('table ' + table),
    rpc: (name: string) => reject('RPC ' + name),
  };
}

export function clientFor(_plane: DataPlane): RetiredDataPlaneClient {
  return retiredClient();
}

export function assertWritePlane(table: string, plane: DataPlane = 'primary') {
  if (plane !== 'primary') throw new Error('Client writes to "' + table + '" are restricted to the central Backend API.');
  throw new Error('DIRECT_DATABASE_ACCESS_REMOVED: write "' + table + '" through the central Backend API.');
}

export function assertSecondaryServerWrite(table: string) {
  if (!SECONDARY_SERVER_WRITE_TABLES.has(table)) throw new Error('Secondary server writes are not approved for "' + table + '".');
}

export function isPrimaryOnlyTable(table: string) {
  return PRIMARY_ONLY_TABLES.has(table);
}

export async function readPublicWithFallback<T>(
  table: string,
  _primaryQuery: (client: RetiredDataPlaneClient) => PromiseLike<{ data: T | null; error: any }>,
  _secondaryQuery?: (client: RetiredDataPlaneClient) => PromiseLike<{ data: T | null; error: any }>,
): Promise<{ data: T | null; source: DataPlane; primaryError?: any; secondaryError?: any }> {
  throw new Error('DIRECT_DATABASE_ACCESS_REMOVED: public read "' + table + '" must use a Backend API endpoint.');
}

export async function readPublicExpansion<T>(
  table: string,
  _primaryQuery: (client: RetiredDataPlaneClient) => PromiseLike<{ data: T | null; error: any }>,
  _secondaryQuery?: (client: RetiredDataPlaneClient) => PromiseLike<{ data: T | null; error: any }>,
): Promise<{ primary: T | null; secondary: T | null; primaryError?: any; secondaryError?: any }> {
  throw new Error('DIRECT_DATABASE_ACCESS_REMOVED: public expansion "' + table + '" must use a Backend API endpoint.');
}
