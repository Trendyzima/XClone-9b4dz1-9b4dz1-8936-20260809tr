import type { TvChannel } from '@/services/tvChannelCatalog';

/**
 * Compatibility shim for older callers.
 * IPTV now plays the original source directly; the virtual CDN is the
 * browser-side HLS segment cache configured by TvChannelPlayer, not a server URL.
 */
export function isTestagramCdnEnabled() {
  return false;
}

export async function getTestagramCdnPlaybackUrl(channel: TvChannel): Promise<string> {
  return channel.url;
}

export function clearTestagramCdnPlaybackCache(_channelId?: string) {
  // Cache entries are managed by the browser Cache API in virtualCdnLoader.
}
