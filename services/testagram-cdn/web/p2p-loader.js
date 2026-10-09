// This is intentionally a capability descriptor, not a P2P transport implementation.
// HTTP origin playback remains authoritative until a real peer-assisted HLS loader is
// integrated with signaling, segment validation, peer limits, and tested fallback.
export function p2pConfig(streamId) {
  return {
    streamId,
    enabled: false,
    transport: "http-origin-first",
    fallback: "http",
    maxUploadPeers: 0,
    maxDownloadPeers: 0,
  };
}
