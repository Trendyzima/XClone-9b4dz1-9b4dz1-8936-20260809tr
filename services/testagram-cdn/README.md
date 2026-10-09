# Testagram Virtual CDN

## Zero-cost mode

The active IPTV delivery path is **origin-first**. XClone requests each channel's original URL directly. For browsers using hls.js, `src/services/virtualCdnLoader.ts` adds a browser-side virtual cache for eligible HLS media fragments:

- Cache Storage entries are scoped to the XClone browser origin/profile and can be reused by tabs on that origin.
- Concurrent fragment requests within a page are coalesced.
- Live segment entries expire after 20 seconds and the cache is capped at 180 segment keys.
- Manifests, encryption keys, byte-range requests, and URLs with token/signature/auth query parameters are not cached or shared.
- Cache, CORS, quota, private-browsing, and peer-transport failures must not block direct-origin playback.

## Cross-device peer delivery

Eligible public HLS fragments can be exchanged across viewer devices over WebRTC data channels. The existing Supabase Realtime client is used only for signaling; video bytes do not pass through Supabase. The implementation currently:

- Randomly shards viewers into 16,384 signaling cohorts per stream to reduce broadcast fan-out at larger audience sizes.
- Peer sharing is opt-in because direct WebRTC connections can reveal network/IP metadata to connected peers and consume upload data; the UI explains this before/while enabling it.
- Limits each browser to three peer connections, one active upload per peer, and segments of at most 1.5 MB.
- Waits for two distinct peers that have each fetched the segment directly from the source; both transferred payloads must match SHA-256 before peer bytes are used.
- Serves only source-fetched cache entries onward. Peer-derived cache entries are never re-shared, preventing one bad peer from propagating its payload through the mesh.
- Uses a short peer wait timeout and falls back to the original stream when peers are unavailable, hashes disagree, CORS prevents caching, or WebRTC cannot establish a direct path.
- Skips signed/tokenized URLs and authenticated requests rather than sharing private media.

**Integrity limitation:** matching hashes from two peers detects accidental corruption and a single inconsistent peer, but it is not a cryptographic proof that media matches the origin because most public HLS sources do not publish signed segment hashes. Only use this mode for public streams where peer-assisted delivery is acceptable. A future source-signed hash contract would provide stronger authenticity.

**Scaling limitation:** cohort sharding bounds per-room signaling fan-out, but does not make Supabase Realtime unlimited. A million-viewer service cannot be promised on a free tier; actual capacity depends on concurrent Realtime connections, browser support, NAT topology, available peers, source bandwidth, and provider limits. This mode does not require a paid CDN or hosted media edge, but the origin remains the fallback and can still carry substantial traffic.

## Hosted Go edge

The Go edge implementation in this directory is retained for source-level regression tests and possible future use, but the production deployment workflow and Compose service are disabled in virtual-CDN mode. Do not configure `media.testagram.site` as a required playback endpoint. IPTV playback must remain functional without this service.

## Verification

From the repository root:

```sh
npm ci
npm run typecheck
npm run build
npm run validate:seo
cd services/testagram-cdn
go test ./...
go test -race ./...
go vet ./...
go build ./cmd/...
```

The Go checks validate retained code only; they do not deploy or claim a running CDN.
