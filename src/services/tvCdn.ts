import { supabase } from '@/lib/supabase';
import type { TvChannel } from '@/services/tvChannelCatalog';

const enabled = String(import.meta.env.VITE_TESTAGRAM_CDN_ENABLED || 'false').toLowerCase() === 'true';
const cdnBase = String(import.meta.env.VITE_TESTAGRAM_CDN_URL || '').replace(/\/$/, '').replace(/\/v1$/i, '');
const tokenCache = new Map<string, { url: string; expiresAt: number }>();

export function isTestagramCdnEnabled() {
  return enabled && Boolean(cdnBase);
}

export async function getTestagramCdnPlaybackUrl(channel: TvChannel): Promise<string> {
  if (!isTestagramCdnEnabled()) return channel.url;
  const cached = tokenCache.get(channel.id);
  if (cached && cached.expiresAt > Date.now() + 30_000) return cached.url;

  const { data, error } = await supabase.functions.invoke('tv-cdn-playback', {
    body: { stream_id: channel.id, source_url: channel.url },
  });
  if (error || !data?.ok || !data?.data?.playback_url) {
    throw error instanceof Error ? error : new Error(data?.error || 'CDN playback authorization failed');
  }
  const url = String(data.data.playback_url);
  const expiresAt = Date.parse(String(data.data.expires_at || ''));
  tokenCache.set(channel.id, {
    url,
    expiresAt: Number.isFinite(expiresAt) ? expiresAt : Date.now() + 9 * 60_000,
  });
  return url;
}

export function clearTestagramCdnPlaybackCache(channelId?: string) {
  if (channelId) tokenCache.delete(channelId);
  else tokenCache.clear();
}
