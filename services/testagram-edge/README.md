# Testagram Embedded Edge CDN

This is the first-party Go media/data plane embedded directly in XClone.

## Ownership

The CDN source lives under `services/testagram-edge`. The standalone `Trendyzima/cdn-` repository is no longer a runtime or build dependency of XClone.

Canonical media hostname:

`https://media.testagram.site`

Cloudflare must not own an IPTV/media route for this hostname.

## No manual CDN secrets

The CDN CI does not require CDN host/user/SSH/token secrets or production IPTV fixture secrets.

Playback authorization remains a platform security concern. The application/control plane is responsible for issuing authorization material; this service must never expose signing keys to browsers.

## IPTV profile

- 45-second rolling prefetch target
- 30-second minimum playback-buffer contract
- bounded prefetch concurrency (max 4)
- 12-second per-pass prefetch deadline by default
- partial-success behavior
- extensionless HLS media URIs supported
- variant playlist URIs are not mistaken for media
- hot RAM + disk cache
- stale-if-error
- request coalescing
- prefetch metrics
- Go CDN identity headers

## Build

From this directory:

`go test ./...`

`go test -race ./...`

`go vet ./...`

`go build ./cmd/edge`

The GitHub workflow runs these automatically whenever the embedded service changes.
