(() => {
  'use strict';
  const CACHE_NAME = 'testagram-flutter-iptv-segments-v1';
  const CACHE_TTL_MS = 18_000;
  const CACHE_LIMIT = 8;
  const MAX_SEGMENT_BYTES = 4 * 1024 * 1024;
  const MAX_MANIFEST_BYTES = 512 * 1024;
  const WARM_TIMEOUT_MS = 2_200;
  const WARM_COOLDOWN_MS = 90_000;
  const signedKey = /token|signature|expires|authorization|hdnts|hdnea|jwt|credential|x-amz-/i;
  const warmed = new Map();
  const inFlight = new Set();

  function signed(url) {
    return Array.from(url.searchParams.keys()).some(key => signedKey.test(key));
  }
  function cacheableSegmentUrl(raw) {
    try {
      const url = new URL(raw);
      if (url.protocol !== 'https:' || signed(url)) return false;
      if (/(?:\.m3u8|\.m3|\.key|\.json)(?:$|[?#])/i.test(url.href)) return false;
      if (Array.from(url.searchParams.keys()).some(key => /token|signature|expires|auth|jwt|credential|key/i.test(key))) return false;
      return /\.(?:ts|m4s|m4a|mp4|aac|ac3|mp3|ogg)(?:$|[?#])/i.test(url.href);
    } catch (_) { return false; }
  }
  const cacheRequest = url => new Request(url, { method: 'GET', credentials: 'omit' });

  async function readCache(url) {
    if (!('caches' in window) || !cacheableSegmentUrl(url)) return null;
    try {
      const cache = await caches.open(CACHE_NAME);
      const key = cacheRequest(url);
      const response = await cache.match(key);
      if (!response) return null;
      const savedAt = Number(response.headers.get('x-testagram-iptv-cached-at') || 0);
      if (!savedAt || Date.now() - savedAt > CACHE_TTL_MS) {
        await cache.delete(key);
        return null;
      }
      return await response.arrayBuffer();
    } catch (_) { return null; }
  }

  async function saveCache(url, bytes, contentType = 'application/octet-stream') {
    if (!('caches' in window) || !bytes || bytes.byteLength < 1 ||
        bytes.byteLength > MAX_SEGMENT_BYTES || !cacheableSegmentUrl(url)) return;
    try {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(cacheRequest(url), new Response(bytes.slice(0), {
        status: 200,
        headers: {
          'content-type': contentType,
          'x-testagram-iptv-cached-at': String(Date.now())
        }
      }));
      const keys = await cache.keys();
      for (let i = 0; i < keys.length - CACHE_LIMIT; i++) await cache.delete(keys[i]);
    } catch (_) {
      // Storage quota, browser privacy settings, and CORS must never block playback.
    }
  }

  async function readManifest(url, signal) {
    const response = await fetch(url, {
      mode: 'cors', credentials: 'omit', cache: 'no-store', signal,
      headers: { Accept: 'application/vnd.apple.mpegurl, text/plain;q=0.9, */*;q=0.5' }
    });
    if (!response.ok) throw new Error('manifest HTTP ' + response.status);
    const reader = response.body && response.body.getReader();
    if (!reader) throw new Error('empty manifest');
    const decoder = new TextDecoder();
    let text = '';
    try {
      while (text.length <= MAX_MANIFEST_BYTES) {
        const part = await reader.read();
        if (part.done) break;
        text += decoder.decode(part.value, { stream: true });
        if (text.length > MAX_MANIFEST_BYTES) {
          await reader.cancel();
          throw new Error('manifest too large');
        }
      }
    } finally { try { reader.releaseLock(); } catch (_) {} }
    if (!/^\s*#EXTM3U\b/.test(text)) throw new Error('invalid HLS manifest');
    return text;
  }

  async function readBoundedSegment(response) {
    const reader = response.body && response.body.getReader();
    if (!reader) return null;
    const chunks = [];
    let total = 0;
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        total += part.value.byteLength;
        if (total > MAX_SEGMENT_BYTES) {
          await reader.cancel();
          return null;
        }
        chunks.push(part.value);
      }
    } finally { try { reader.releaseLock(); } catch (_) {} }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return bytes.buffer;
  }

  function resolveHttps(value, base) {
    try {
      const url = new URL(value, base);
      return url.protocol === 'https:' ? url : null;
    } catch (_) { return null; }
  }
  function chooseVariant(text, base) {
    const lines = text.split(/\r?\n/).map(line => line.trim());
    const variants = [];
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].startsWith('#EXT-X-STREAM-INF:')) continue;
      const bandwidth = Number(lines[i].match(/BANDWIDTH=(\d+)/i)?.[1] || 0);
      const uri = lines.slice(i + 1).find(line => line && !line.startsWith('#'));
      const url = uri ? resolveHttps(uri, base) : null;
      if (url && !signed(url)) variants.push({ url, bandwidth });
    }
    variants.sort((a, b) => a.bandwidth - b.bandwidth);
    return variants[0]?.url || null;
  }
  function chooseSegment(text, base) {
    const lines = text.split(/\r?\n/).map(line => line.trim());
    const segments = lines.filter(line => line && !line.startsWith('#'))
      .map(line => resolveHttps(line, base)).filter(Boolean);
    if (!segments.length) return null;
    return text.includes('#EXT-X-ENDLIST') ? segments[0] : segments[segments.length - 1];
  }

  async function warmStream(raw) {
    let source;
    try { source = new URL(raw); } catch (_) { return; }
    if (source.protocol !== 'https:' || !/\.m3u8$/i.test(source.pathname) || signed(source)) return;
    const key = source.href;
    if (inFlight.has(key) || Date.now() - (warmed.get(key) || 0) < WARM_COOLDOWN_MS) return;
    inFlight.add(key);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), WARM_TIMEOUT_MS);
    try {
      let playlist = source;
      let text = await readManifest(source.href, controller.signal);
      const variant = chooseVariant(text, source);
      if (variant) {
        playlist = variant;
        text = await readManifest(variant.href, controller.signal);
      }
      const segment = chooseSegment(text, playlist);
      if (!segment || signed(segment)) return;
      if (cacheableSegmentUrl(segment.href)) {
        const cached = await readCache(segment.href);
        if (!cached) {
          const response = await fetch(segment.href, {
            mode: 'cors', credentials: 'omit', cache: 'no-store',
            signal: controller.signal, headers: { Accept: '*/*' }
          });
          if (response.ok && response.status === 200) {
            const declared = Number(response.headers.get('content-length') || 0);
            if (declared <= MAX_SEGMENT_BYTES) {
              const bytes = await readBoundedSegment(response);
              if (bytes) {
                await saveCache(segment.href, bytes, response.headers.get('content-type') || 'application/octet-stream');
              }
            } else {
              await response.body?.cancel();
            }
          }
        }
      }
      warmed.set(key, Date.now());
    } catch (_) {
      // Best-effort warm-up: an uncacheable broadcaster remains playable normally.
    } finally {
      clearTimeout(timer);
      inFlight.delete(key);
    }
  }

  function createCachedLoader(Hls) {
    const BaseLoader = Hls?.DefaultConfig?.loader;
    if (!BaseLoader || BaseLoader.__testagramIptvCache) return BaseLoader;
    class CachedLoader extends BaseLoader {
      constructor(config) { super(config); this.cacheGeneration = 0; }
      load(context, config, callbacks) {
        const generation = ++this.cacheGeneration;
        const url = String(context?.url || '');
        if (context?.type !== 'fragment' || context?.rangeStart != null || !cacheableSegmentUrl(url)) {
          return super.load(context, config, callbacks);
        }
        void readCache(url).then(cached => {
          if (generation !== this.cacheGeneration) return;
          if (cached) {
            const now = performance.now();
            const stats = {
              loading: { start: now, first: now, end: now },
              parsing: { start: 0, end: 0 },
              buffering: { start: 0, first: 0, end: 0 },
              aborted: false, loaded: cached.byteLength, total: cached.byteLength,
              retry: 0, chunkCount: 1, bwEstimate: 0
            };
            callbacks.onSuccess({ url, data: cached }, stats, context, null);
            return;
          }
          const wrapped = {
            ...callbacks,
            onSuccess: (response, stats, ctx, networkDetails) => {
              if (response?.data instanceof ArrayBuffer) {
                void saveCache(url, response.data, 'application/octet-stream');
              }
              callbacks.onSuccess(response, stats, ctx, networkDetails);
            }
          };
          super.load(context, config, wrapped);
        }).catch(() => {
          if (generation === this.cacheGeneration) super.load(context, config, callbacks);
        });
      }
      destroy() { this.cacheGeneration++; super.destroy(); }
    }
    Object.defineProperty(CachedLoader, '__testagramIptvCache', { value: true });
    return CachedLoader;
  }

  window.testagramInstallIptvHlsCache = Hls => {
    try {
      const Loader = createCachedLoader(Hls);
      if (Loader && Hls?.DefaultConfig) Hls.DefaultConfig.loader = Loader;
    } catch (_) { /* optional optimization only */ }
  };
  window.testagramWarmIptvStream = url => { void warmStream(String(url || '')); };
})();