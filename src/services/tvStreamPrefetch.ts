import type { TvChannel } from '@/services/tvChannelCatalog';

export async function warmTvChannelBatch(channels: TvChannel[]) {
  const batch = channels.slice(0, 4);
  const results = [];
  for (const channel of batch) {
    results.push({ channelId: channel.id, outcome: 'skipped' as const, reason: 'prefetch-not-yet-implemented' });
  }
  return results;
}
