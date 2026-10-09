/**
 * Testagram virtual CDN capability descriptor.
 *
 * Media delivery is origin-first. The active browser HLS loader caches eligible
 * public segments in the browser Cache API and coalesces concurrent requests.
 * This file deliberately does not claim cross-device P2P: there is no hosted
 * signaling service, peer mesh, or always-on edge server in the zero-cost mode.
 */
export function virtualCdnConfig(streamId) {
  return {
    streamId,
    enabled: true,
    transport: "origin-first-browser-cache",
    fallback: "original-source",
    cacheScope: "same-origin-browser-profile",
    liveSegmentTtlMs: 20000,
    maxCachedSegments: 180,
    crossDevicePeers: false,
    requiresHostedEdge: false,
  };
}

// Preserve the old export name for downstream scripts without implying P2P exists.
export function p2pConfig(streamId) {
  return {
    ...virtualCdnConfig(streamId),
    enabled: false,
    transport: "no-peer-transport",
    maxUploadPeers: 0,
    maxDownloadPeers: 0,
  };
}
