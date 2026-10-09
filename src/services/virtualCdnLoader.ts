/**
 * Testagram Virtual CDN loader.
 *
 * This is a client-side edge cache, not a hosted HTTP proxy:
 * - HLS fragments are cached in the browser Cache API when CORS permits it.
 * - Cache entries are shared by tabs/apps under this same XClone origin.
 * - simultaneous fragment requests in one page are coalesced.
 * - live fragments expire quickly; manifests and keys are never cached.
 * - every miss goes directly to the original stream URL.
 *
 * It has no server, CDN account, API key, or paid bandwidth dependency.
 */
import { fetchVirtualPeerSegment } from '@/services/virtualCdnPeers';
import { recordVirtualCdnMetric } from '@/services/virtualCdnMetrics';

const CACHE_NAME = 'testagram-virtual-cdn-v1';
const LIVE_SEGMENT_TTL_MS = 20_000;
const MAX_CACHED_SEGMENTS = 180;
const PEER_MIN_SEGMENT_BYTES = 8 * 1024;
const NETWORK_TIMEOUT_MS = 20_000;

type SegmentResult = { url: string; bytes: ArrayBuffer; contentType: string; originVerified: boolean };
type CacheStats = { start: number; first: number; end: number; loaded: number; total: number; retry: number; chunkCount: number; bwEstimate: number };

const inFlight = new Map<string, Promise<SegmentResult>>();

function now() { return typeof performance !== 'undefined' ? performance.now() : Date.now(); }

function isSensitiveUrl(url: URL) {
  for (const key of url.searchParams.keys()) {
    if (/(^|_)(token|signature|sig|auth|authorization|apikey|api_key|expires|credential)(_|$)/i.test(key)) return true;
  }
  return false;
}

function hasSensitiveHeaders(context: any) {
  try {
    const headers = new Headers(context?.headers || {});
    return headers.has('authorization') || headers.has('cookie') || headers.has('proxy-authorization');
  } catch {
    return true;
  }
}

function isMediaFragment(context: any, url: URL) {
  if (context?.type === 'manifest' || context?.type === 'level' || context?.type === 'audioTrack' || context?.type === 'subtitleTrack' || context?.type === 'key') return false;
  if (context?.responseType && context.responseType !== 'arraybuffer') return false;
  if (context?.rangeStart != null || context?.rangeEnd != null) return false;
  if (isSensitiveUrl(url) || hasSensitiveHeaders(context)) return false;
  return context?.type === 'fragment' || /\.(?:ts|m4s|m4a|mp4|aac|ac3|mp3|ogg)(?:$|[?#])/i.test(url.href);
}

function stats(start: number, loaded: number): CacheStats {
  const end = now();
  return { start, first: end, end, loaded, total: loaded, retry: 0, chunkCount: 1, bwEstimate: 0 };
}

async function openCache(): Promise<Cache | null> {
  try {
    if (typeof caches === 'undefined') return null;
    return await caches.open(CACHE_NAME);
  } catch {
    return null;
  }
}

function cacheKey(url: string) {
  return new Request(url, { method: 'GET', credentials: 'omit' });
}

async function readCached(url: string, requireOrigin = false): Promise<SegmentResult | null> {
  const cache = await openCache();
  if (!cache) return null;
  try {
    const response = await cache.match(cacheKey(url));
    if (!response) return null;
    const savedAt = Number(response.headers.get('x-testagram-vcdn-cached-at') || 0);
    const ttl = Number(response.headers.get('x-testagram-vcdn-ttl-ms') || LIVE_SEGMENT_TTL_MS);
    if (!savedAt || Date.now() - savedAt > ttl) {
      await cache.delete(cacheKey(url));
      return null;
    }
    const originVerified = response.headers.get('x-testagram-vcdn-source') === 'origin';
    if (requireOrigin && !originVerified) return null;
    return { url, bytes: await response.arrayBuffer(), contentType: response.headers.get('content-type') || 'application/octet-stream', originVerified };
  } catch {
    return null;
  }
}

async function trimCache(cache: Cache) {
  try {
    const keys = await cache.keys();
    const segmentKeys = keys.filter((request) => {
      try { return isMediaFragment({ type: 'fragment', responseType: 'arraybuffer' }, new URL(request.url)); }
      catch { return false; }
    });
    for (let i = 0; i < segmentKeys.length - MAX_CACHED_SEGMENTS; i++) await cache.delete(segmentKeys[i]);
  } catch {
    // Storage quotas and private browsing must never break playback.
  }
}

async function saveCached(url: string, result: SegmentResult, source: 'origin' | 'peer' = 'origin') {
  const cache = await openCache();
  if (!cache) return;
  try {
    const key = cacheKey(url);
    const existing = await cache.match(key);
    if (source === 'peer' && existing?.headers.get('x-testagram-vcdn-source') === 'origin') return;
    // Treat streams as live unless a future catalog contract explicitly marks VOD.
    const effectiveTtl = LIVE_SEGMENT_TTL_MS;
    const response = new Response(result.bytes.slice(0), {
      status: 200,
      headers: {
        'content-type': result.contentType || 'application/octet-stream',
        'x-testagram-vcdn-cached-at': String(Date.now()),
        'x-testagram-vcdn-ttl-ms': String(effectiveTtl),
        'x-testagram-vcdn-source': source,
      },
    });
    await cache.put(key, response);
    await trimCache(cache);
  } catch {
    // Quota/CORS/cache failures are a cache miss, never a playback failure.
  }
}

async function fetchDirect(url: string, headers: HeadersInit | undefined, signal?: AbortSignal, rangeStart?: number, rangeEnd?: number): Promise<SegmentResult> {
  const requestHeaders = new Headers(headers || {});
  if (rangeStart != null && rangeEnd != null) requestHeaders.set('Range', `bytes=${rangeStart}-${rangeEnd - 1}`);
  const response = await fetch(url, { method: 'GET', headers: requestHeaders, credentials: 'same-origin', signal });
  if (!response.ok) throw Object.assign(new Error(`HTTP ${response.status} ${response.statusText}`), { status: response.status });
  const bytes = await response.arrayBuffer();
  return { url: response.url || url, bytes, contentType: response.headers.get('content-type') || 'application/octet-stream', originVerified: true };
}

async function fetchFragment(url: string, headers: HeadersInit | undefined, streamUrl: string): Promise<SegmentResult> {
  const existing = inFlight.get(url);
  if (existing) return existing;
  const request = (async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), NETWORK_TIMEOUT_MS);
    try {
      // Try a peer quorum first. Two independent origin-sourced peers must agree
      // on SHA-256; otherwise the original stream remains authoritative.
      if (streamUrl && typeof crypto !== 'undefined' && crypto.subtle && url.length < 2048) {
        const peer = await fetchVirtualPeerSegment(streamUrl, url, (cachedUrl, requireOrigin = false) => readCached(cachedUrl, requireOrigin));
        if (peer && peer.bytes.byteLength >= PEER_MIN_SEGMENT_BYTES) {
          const result: SegmentResult = { ...peer, originVerified: false };
          await saveCached(url, result, 'peer');
          return result;
        }
      }
      recordVirtualCdnMetric('originFetch');
      const response = await fetch(url, { method: 'GET', headers, credentials: 'same-origin', signal: controller.signal });
      if (!response.ok) throw Object.assign(new Error(`HTTP ${response.status} ${response.statusText}`), { status: response.status });
      if (response.type === 'opaque') throw new Error('Opaque media response cannot be cached');
      const bytes = await response.arrayBuffer();
      recordVirtualCdnMetric('originBytes', bytes.byteLength);
      const result: SegmentResult = { url: response.url || url, bytes, contentType: response.headers.get('content-type') || 'application/octet-stream', originVerified: true };
      await saveCached(url, result, 'origin');
      return result;
    } finally {
      clearTimeout(timer);
    }
  })();
  inFlight.set(url, request);
  try {
    return await request;
  } finally {
    if (inFlight.get(url) === request) inFlight.delete(url);
  }
}

export default class VirtualCdnLoader {
  context: any = null;
  callbacks: any = null;
  stats: CacheStats | null = null;
  aborted = false;
  timeout: ReturnType<typeof setTimeout> | null = null;
  controller: AbortController | null = null;

  load(context: any, config: any, callbacks: any) {
    this.context = context;
    this.callbacks = callbacks;
    this.aborted = false;
    const started = now();
    const url = String(context?.url || '');
    let parsed: URL;
    try { parsed = new URL(url, typeof location !== 'undefined' ? location.href : undefined); }
    catch {
      callbacks.onError?.({ code: 0, text: 'Invalid media URL' }, context, null);
      return;
    }
    const cacheable = parsed.protocol === 'http:' || parsed.protocol === 'https:'
      ? isMediaFragment(context, parsed)
      : false;
    const timeoutMs = Math.max(1, Number(config?.timeout || NETWORK_TIMEOUT_MS));
    this.timeout = setTimeout(() => {
      if (this.aborted) return;
      this.aborted = true;
      this.controller?.abort();
      callbacks.onTimeout?.(stats(started, 0), context, null);
    }, timeoutMs);

    void (async () => {
      try {
        let result: SegmentResult | null = null;
        if (cacheable) {
          result = await readCached(url);
          recordVirtualCdnMetric(result ? 'cacheHit' : 'cacheMiss');
          if (result) recordVirtualCdnMetric('cacheBytes', result.bytes.byteLength);
        }
        if (this.aborted) return;
        if (cacheable && !result) result = await fetchFragment(url, context?.headers, String(context?.frag?.baseurl || context?.frag?.level?.url || ''));
        if (!cacheable) {
          this.controller = new AbortController();
          result = await fetchDirect(url, context?.headers, this.controller.signal, context?.rangeStart, context?.rangeEnd);
        }
        if (this.aborted || !result) return;

        const elapsedStats = stats(started, result.bytes.byteLength);
        this.stats = elapsedStats;
        const responseData = context?.responseType === 'text'
          ? new TextDecoder().decode(result.bytes)
          : context?.responseType === 'json'
            ? JSON.parse(new TextDecoder().decode(result.bytes))
            : result.bytes;
        callbacks.onSuccess?.({ url: result.url, data: responseData }, elapsedStats, context, null);
      } catch (error: any) {
        if (this.aborted) return;
        const status = Number(error?.status || 0);
        callbacks.onError?.({ code: status, text: String(error?.message || error) }, context, null, stats(started, 0));
      } finally {
        if (this.timeout) clearTimeout(this.timeout);
        this.timeout = null;
      }
    })();
  }

  abort() {
    this.aborted = true;
    this.controller?.abort();
    if (this.timeout) clearTimeout(this.timeout);
    this.timeout = null;
  }

  destroy() {
    this.abort();
    this.context = null;
    this.callbacks = null;
    this.stats = null;
  }

  getCacheAge() { return null; }
}
