import assert from 'node:assert/strict';
import fs from 'node:fs';

const cache = fs.readFileSync('mobile/web/iptv_hls_cache.js', 'utf8');
const tvPage = fs.readFileSync('mobile/lib/features/tv/tv_page.dart', 'utf8');
const webPlayer = fs.readFileSync('mobile/lib/features/tv/tv_web_player_web.dart', 'utf8');
const html = fs.readFileSync('mobile/web/index.html', 'utf8');

assert.ok(cache.includes("const CACHE_NAME = 'testagram-flutter-iptv-segments-v1'"), 'Flutter Web needs a dedicated IPTV segment cache');
assert.ok(cache.includes('const CACHE_TTL_MS = 18_000'), 'live segments must expire quickly');
assert.ok(cache.includes('const CACHE_LIMIT = 8'), 'segment cache must stay bounded');
assert.ok(cache.includes('const MAX_SEGMENT_BYTES = 4 * 1024 * 1024'), 'individual cached segments must be size bounded');
assert.ok(cache.includes("url.protocol !== 'https:' || signed(url)"), 'only public HTTPS streams can be warmed');
assert.ok(cache.includes("credentials: 'omit'"), 'prefetch must not send ambient credentials');
assert.ok(cache.includes("context?.type !== 'fragment'"), 'manifests, keys and other non-fragment requests must bypass segment cache');
assert.ok(cache.includes('context?.rangeStart != null'), 'byte-range fragments must bypass cache');
assert.ok(cache.includes('Date.now() - savedAt > CACHE_TTL_MS'), 'expired live segments must be evicted');
assert.ok(cache.includes('MAX_MANIFEST_BYTES = 512 * 1024'), 'manifest parsing must be bounded');
assert.ok(cache.includes('async function readBoundedSegment(response)'), 'prefetch must stream and cap segment bytes before buffering in memory');
assert.ok(cache.includes('WARM_TIMEOUT_MS = 2_200'), 'prefetch requests must time out');
assert.ok(cache.includes('WARM_COOLDOWN_MS = 90_000'), 'repeated prefetch must be throttled');
assert.ok(cache.includes('Hls.DefaultConfig.loader = Loader'), 'Flutter Web HLS playback must use the cache-aware loader');
assert.ok(cache.includes('saveCache(url, response.data'), 'successful full HLS fragments must be cached');
assert.ok(cache.includes("url.protocol !== 'https:'"), 'HTTP streams must not enter the cache');
assert.ok(tvPage.includes('warmIptvStream(url)'), 'the Flutter vertical feed must warm the next Web HLS stream');
assert.ok(tvPage.includes('CachedNetworkImageProvider(thumbnail)'), 'adjacent channel artwork must use the shared image cache');
assert.ok(webPlayer.includes('_installIptvHlsCache?.callAsFunction'), 'Flutter Web player must install the cache-aware loader');
assert.ok(html.includes('<script src="iptv_hls_cache.js"></script>'), 'the browser cache helper must load before Flutter bootstraps');
console.log('PASS Flutter IPTV cache contract: bounded HTTPS-only HLS fragment cache, signed URL exclusion, TTL, warm-up timeout, and Web/Android feed wiring.');
