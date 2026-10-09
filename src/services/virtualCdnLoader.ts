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
const CACHE_NAME = 'testagram-virtual-cdn-v1';
const LIVE_SEGMENT_TTL_MS = 20_000;
const MAX_CACHED_SEGMENTS = 180;
const NETWORK_TIMEOUT_MS = 20_000;

type SegmentResult = { url: string; bytes: ArrayBuffer; contentType: string };
type CacheStats = { start: number; first: number; end: number; loaded: number; total: number; retry: number; chunkCount: number; bwEstimate: number };

const inFlight = new Map<string, Promise<SegmentResult>>();

function now() { return typeof performance !== 'undefined' ? performance.now() : Date.now(); }

function isSensitiveUrl(url: URL) {
  for (const key of url.searchParams.keys()) {
    if (/(^|_)(token|signature|sig|auth|authorization|apikey|api_key|expires|credential)(_|$)/i.test(key)) return true;
  }
  return false;
}

function isMediaFragment(context: any, url: URL) {
  if (context?.type === 'manifest' || context?.type === 'level' || context?.type === 'audioTrack' || context?.type === 'subtitleTrack' || context?.type === 'key') return false;
  if (context?.responseType && context.responseType !== 'arraybuffer') return false;
  if (context?.rangeStart != null || context?.rangeEnd != null) return false;
  if (isSensitiveUrl(url)) return false;
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

async function readCached(url: string): Promise<SegmentResult | null> {
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
    return { url, bytes: await response.arrayBuffer(), contentType: response.headers.get('content-type') || 'application/octet-stream' };
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

async function saveCached(url: string, result: SegmentResult) {
  const cache = await openCache();
  if (!cache) return;
  try {
    const parsed = new URL(url);
    // Treat streams as live unless a future catalog contract explicitly marks VOD.
    const effectiveTtl = LIVE_SEGMENT_TTL_MS;
    const response = new Response(result.bytes.slice(0), {
      status: 200,
      headers: {
        'content-type': result.contentType || 'application/octet-stream',
        'x-testagram-vcdn-cached-at': String(Date.now()),
        'x-testagram-vcdn-ttl-ms': String(effectiveTtl),
      },
    });
    await cache.put(cacheKey(url), response);
    await trimCache(cache);
  } catch {
    // Quota/CORS/cache failures are a cache miss, never a playback failure.
  }
}

async function fetchDirect(url: string, headers: HeadersInit | undefined, signal?: AbortSignal): Promise<SegmentResult> {
  const response = await fetch(url, { method: 'GET', headers, credentials: 'same-origin', signal });
  if (!response.ok) throw Object.assign(new Error(`HTTP ${response.status} ${response.statusText}`), { status: response.status });
  const bytes = await response.arrayBuffer();
  return { url: response.url || url, bytes, contentType: response.headers.get('content-type') || 'application/octet-stream' };
}

async function fetchFragment(url: string, headers: HeadersInit | undefined): Promise<SegmentResult> {
  const existing = inFlight.get(url);
  if (existing) return existing;
  const request = (async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), NETWORK_TIMEOUT_MS);
    try {
      const response = await fetch(url, { method: 'GET', headers, credentials: 'same-origin', signal: controller.signal });
      if (!response.ok) throw Object.assign(new Error(`HTTP ${response.status} ${response.statusText}`), { status: response.status });
      if (response.type === 'opaque') throw new Error('Opaque media response cannot be cached');
      const bytes = await response.arrayBuffer();
      const result = { url: response.url || url, bytes, contentType: response.headers.get('content-type') || 'application/octet-stream' };
      await saveCached(url, result);
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
        if (cacheable) result = await readCached(url);
        if (this.aborted) return;
        if (cacheable && !result) result = await fetchFragment(url, context?.headers);
        if (!cacheable) {
          this.controller = new AbortController();
          result = await fetchDirect(url, context?.headers, this.controller.signal);
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
