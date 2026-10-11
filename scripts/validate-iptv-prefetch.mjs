import assert from 'node:assert/strict';
import fs from 'node:fs';

const build = fs.readFileSync('_build.cjs', 'utf8');
assert.ok(build.includes("SEGMENT_CACHE_NAME = 'testagram-iptv-segments-v1'"), 'IPTV needs a dedicated segment cache');
assert.ok(build.includes('SEGMENT_CACHE_TTL_MS = 18_000'), 'Live segments must have a short TTL');
assert.ok(build.includes('SEGMENT_CACHE_LIMIT = 8'), 'Segment cache must be bounded');
assert.ok(build.includes('MAX_PREFETCH_SEGMENT_BYTES = 4 * 1024 * 1024'), 'Prefetch cache must cap segment size');
assert.ok(build.includes('export function createCachedHlsLoader(HlsConstructor: any) { return class CachedHlsLoader extends HlsConstructor.DefaultConfig.loader'), 'HLS playback must use a cache-aware loader');
assert.ok(build.includes('await saveSegmentCache(url.toString(), bytes.buffer'), 'Prefetch must store complete bounded segments, not partial byte ranges');
assert.ok(build.includes("if (url.protocol !== 'https:' || signed(url)) return false;"), 'Only public HTTPS media without signed URL credentials may be cached');
assert.ok(build.includes("context?.type !== 'fragment'"), 'Manifests and keys must bypass the segment cache');
assert.ok(build.includes('if (!savedAt || Date.now() - savedAt > SEGMENT_CACHE_TTL_MS)'), 'Expired live segments must be evicted before use');
assert.ok(build.includes('if (signal.aborted) break;'), 'Cancelled prefetch work must stop promptly');
assert.ok(build.includes('createCachedHlsLoader(Hls)'), 'HLS cache loader must use the lazily imported Hls constructor');
assert.ok(build.includes('loader: CachedHlsLoader as any'), 'Vertical-feed HLS playback must be wired to the cache loader');
console.log('PASS IPTV prefetch contract: bounded HTTPS-only segment cache, short live TTL, signed URL exclusion, and HLS loader wiring.');
