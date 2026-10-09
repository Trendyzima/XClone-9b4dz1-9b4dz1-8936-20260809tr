# Testagram Virtual CDN

## Zero-cost mode

The active IPTV delivery path is **origin-first**. XClone requests each channel's original URL directly. For browsers using hls.js, `src/services/virtualCdnLoader.ts` adds a browser-side virtual cache for eligible HLS media fragments:

- Cache Storage entries are scoped to the XClone browser origin/profile and can be reused by tabs on that origin.
- Concurrent fragment requests within a page are coalesced.
- Live segment entries expire after 20 seconds and the cache is capped at 180 segment keys.
- Manifests, encryption keys, byte-range requests, and URLs with token/signature/auth query parameters are not cached.
- Cache, CORS, quota, and private-browsing failures must not block direct-origin playback.
- Cache misses fetch the original media URL. No hosted edge, Redis, VPS, CDN account, API key, or deployment secret is required.

This is **not** a globally distributed CDN and it does not currently share segments between different users/devices. Cross-device P2P needs a separately designed and security-tested signaling/peer transport; the old `p2p-loader.js` name is retained only for compatibility and explicitly reports that no peer mesh exists.

## Hosted Go edge

The Go edge implementation in this directory is retained for source-level regression tests and possible future use, but the production deployment workflow and Compose service are disabled in virtual-CDN mode. Do not configure `media.testagram.site` as a required playback endpoint. IPTV playback must remain functional without this service.

## Verification

From the repository root:

```sh
npm ci
npm run build
cd services/testagram-cdn
go test ./...
go test -race ./...
go vet ./...
go build ./cmd/...
```

The Go checks validate retained code only; they do not deploy or claim a running CDN.
