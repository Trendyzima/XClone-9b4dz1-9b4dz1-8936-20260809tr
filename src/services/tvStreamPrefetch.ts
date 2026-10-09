import type { TvChannel } from '@/services/tvChannelCatalog';

const warmedAt = new Map<string, number>();
const inFlight = new Set<string>();
const TTL_MS = 90_000;
const TIMEOUT_MS = 2_500;
const SIGNED = /token|signature|expires|authorization|hdnts|hdnea|jwt|credential|x-amz-/i;

function isSigned(url: URL) {
  return Array.from(url.searchParams.keys()).some(key => SIGNED.test(key));
}

function resolve(value: string, base: URL): URL | null {
  try {
    const result = new URL(value, base);
    return result.protocol === 'https:' ? result : null;
  } catch { return null; }
}

async function manifest(url: URL, signal: AbortSignal) {
  const response = await fetch(url.toString(), {
    mode: 'cors', credentials: 'omit', cache: 'no-store', signal,
    headers: { Accept: 'application/vnd.apple.mpegurl, text/plain;q=0.9, */*;q=0.5' },
  });
  if (!response.ok) throw new Error('HTTP ' + response.status);
  const text = await response.text();
  if (text.length > 512 * 1024 || !/^\\s*#EXTM3U\\b/.test(text)) throw new Error('Invalid or oversized HLS manifest');
  return text;
}

function chooseVariant(text: string, base: URL) {
  const lines = text.split(/\\r?\\n/).map(line => line.trim());
  const variants: Array<{ url: URL; rate: number }> = [];
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith('#EXT-X-STREAM-INF:')) continue;
    const rate = Number(lines[i].match(/BANDWIDTH=(\\d+)/i)?.[1] || 0);
    const next = lines.slice(i + 1).find(line => line && !line.startsWith('#'));
    const url = next ? resolve(next, base) : null;
    if (url) variants.push({ url, rate });
  }
  variants.sort((a, b) => a.rate - b.rate);
  return variants[0]?.url || null;
}

function firstSegment(text: string, base: URL) {
  const line = text.split(/\\r?\\n/).map(value => value.trim()).find(value => value && !value.startsWith('#'));
  return line ? resolve(line, base) : null;
}

async function warmSegment(url: URL, signal: AbortSignal) {
  if (isSigned(url)) return;
  try {
    const response = await fetch(url.toString(), {
      mode: 'cors', credentials: 'omit', cache: 'default', signal,
      headers: { Range: 'bytes=0-65535', Accept: '*/*' },
    });
    if (!response.ok && response.status !== 206) return;
    const reader = response.body?.getReader();
    if (!reader) return;
    try { const result = await reader.read(); if (!result.done) await reader.cancel(); }
    finally { try { reader.releaseLock(); } catch {} }
  } catch {
    // Some broadcasters disable CORS; playback remains direct and warming is optional.
  }
}

export async function warmTvChannel(channel: TvChannel) {
  let source: URL;
  try { source = new URL(channel.url); } catch {
    return { channelId: channel.id, outcome: 'skipped' as const, reason: 'invalid-url' };
  }
  if (source.protocol !== 'https:' || !/\\.m3u8$/i.test(source.pathname)) {
    return { channelId: channel.id, outcome: 'skipped' as const, reason: 'not-hls' };
  }
  if (isSigned(source)) return { channelId: channel.id, outcome: 'skipped' as const, reason: 'signed-url' };
  if (inFlight.has(channel.id) || Date.now() - (warmedAt.get(channel.id) || 0) < TTL_MS) {
    return { channelId: channel.id, outcome: 'skipped' as const, reason: 'recently-warmed' };
  }
  inFlight.add(channel.id);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    let playlistUrl = source;
    let text = await manifest(source, controller.signal);
    const variant = chooseVariant(text, source);
    if (variant) { playlistUrl = variant; text = await manifest(variant, controller.signal); }
    const segment = firstSegment(text, playlistUrl);
    if (segment) await warmSegment(segment, controller.signal);
    warmedAt.set(channel.id, Date.now());
    return { channelId: channel.id, outcome: 'warmed' as const };
  } catch (error) {
    return { channelId: channel.id, outcome: 'failed' as const, reason: error instanceof Error ? error.message : 'network-failure' };
  } finally {
    clearTimeout(timer);
    inFlight.delete(channel.id);
  }
}

export async function warmTvChannelBatch(channels: TvChannel[]) {
  const results = [];
  for (const channel of channels.slice(0, 4)) results.push(await warmTvChannel(channel));
  if (typeof window !== 'undefined' && results.length) {
    window.dispatchEvent(new CustomEvent('testagram-tv-prefetch-results', { detail: results }));
  }
  return results;
}
