/**
 * Testagram virtual CDN capability descriptor.
 *
 * The browser HLS loader uses origin-first playback with a local Cache API and
 * an optional WebRTC data-channel peer mesh. Supabase Realtime carries only
 * signaling messages; media bytes travel peer-to-peer. Peer exchange is bounded
 * and fails closed to the original source.
 *
 * This descriptor describes the client implementation; it does not claim a
 * globally deployed CDN or guarantee capacity beyond available viewer peers,
 * browser/network support, and the existing Supabase Realtime plan limits.
 */
export function virtualCdnConfig(streamId) {
  return {
    streamId,
    enabled: true,
    transport: "origin-first-browser-cache-webrtc",
    signaling: "existing-supabase-realtime",
    fallback: "original-source",
    cacheScope: "same-origin-browser-profile",
    liveSegmentTtlMs: 20000,
    maxCachedSegments: 180,
    crossDevicePeers: true,
    requiresViewerOptIn: true,
    defaultEnabled: false,
    requiresUnmeteredConnection: true,
    maxPeerConnections: 3,
    maxConcurrentUploadsPerPeer: 1,
    maxPeerSegmentBytes: 1500000,
    matchingPeerQuorum: 2,
    signalingCohorts: 16384,
    requiresHostedEdge: false,
  };
}

export function p2pConfig(streamId) {
  return {
    ...virtualCdnConfig(streamId),
    streamId,
    enabled: true,
    maxUploadPeers: 1,
    maxDownloadPeers: 2,
  };
}
