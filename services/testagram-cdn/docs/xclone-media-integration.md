# Testagram TV playback and optional CDN integration

## Default playback path: origin-first

Testagram IPTV playback must remain usable even when the standalone Go CDN has no host or is temporarily unavailable.

1. The player starts with the public channel's original HLS or media URL.
2. The player uses HLS.js where required, adapts quality to constrained networks, buffers ahead before starting, and retries recoverable network/media errors.
3. If direct playback fails, the player can try Testagram's same-origin `/tv-stream` proxy where that route is deployed and the upstream permits it.
4. The first-party Go CDN is optional and disabled by default. Enable it only after the public endpoint, TLS, HLS playlist rewriting, segment delivery, and health checks have been verified against a real deployment.

Direct playback still depends on the upstream stream being online and allowing browser playback (including CORS where applicable). No player can guarantee zero buffering on every network or for a broken/overloaded upstream. Measure startup time, rebuffer ratio, fatal errors, bitrate switches, and source health rather than claiming zero stalls without data.

## No mandatory Cloudflare or R2 dependency for IPTV

The default public IPTV path does not require Cloudflare, R2 credentials, or a separately hosted Go CDN. Public playlist/catalog metadata may be refreshed from its published origin and media is fetched from the selected stream origin. Do not add private provider keys to client code or expose credentials in playlist URLs.

The Go CDN code remains an optional first-party cache service. Its local cache and request coalescing provide value only when a reachable instance is deployed and the player is explicitly configured to use it. This repository does not claim that the CDN is deployed merely because its source code exists.

## Peer-assisted delivery status

`web/p2p-loader.js` is currently a capability descriptor, not a peer-to-peer media transport, and is deliberately disabled. Do not advertise P2P offload until a real HLS/WebRTC loader is integrated with signaling, peer admission limits, segment integrity checks, upload/download budgets, privacy controls, and HTTP fallback. Peer-assisted delivery must remain an optional optimization; HTTP origin playback must continue to work when there are no peers or WebRTC is blocked.

## Capacity and validation

A code-level fan-out test does not prove production bandwidth for millions of viewers. Before making capacity claims, run staged load tests and record p50/p95/p99 startup and segment latency, HTTP error rate, cache hit ratio, origin request rate, egress, concurrent connections, memory, CPU, and player rebuffer ratio. Scaling requires measured delivery capacity; GitHub Actions is a build/test system, not a media host.

## Optional CDN production contract

If the Go CDN is deployed later, validate the real public hostname and service before setting `VITE_TESTAGRAM_CDN_ENABLED=true`. Check health, TLS, playlist rewrite, segment range requests, cache behavior, CORS, and recovery from upstream errors. Keep playback origin-first until those checks pass.
