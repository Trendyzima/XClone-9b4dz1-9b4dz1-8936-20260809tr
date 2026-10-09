/**
 * Privacy-preserving, in-memory virtual CDN counters.
 *
 * Counters contain aggregate numbers only: never stream URLs, IP addresses,
 * peer IDs, tokens, or account identifiers. A host application may listen for
 * the custom event to export aggregate telemetry to its own approved backend.
 */
export type VirtualCdnMetric =
  | 'cacheHit' | 'cacheMiss' | 'cacheBytes' | 'originFetch' | 'originBytes'
  | 'peerRequest' | 'peerHit' | 'peerMiss' | 'peerBytesReceived' | 'peerBytesServed'
  | 'signalingFailure' | 'connectionSuccess' | 'connectionFailure'
  | 'integrityFailure' | 'transferTimeout' | 'playbackStall';

const counters: Record<VirtualCdnMetric, number> = {
  cacheHit: 0, cacheMiss: 0, cacheBytes: 0, originFetch: 0, originBytes: 0,
  peerRequest: 0, peerHit: 0, peerMiss: 0, peerBytesReceived: 0, peerBytesServed: 0,
  signalingFailure: 0, connectionSuccess: 0, connectionFailure: 0,
  integrityFailure: 0, transferTimeout: 0, playbackStall: 0,
};

export function recordVirtualCdnMetric(name: VirtualCdnMetric, amount = 1) {
  if (!Number.isFinite(amount) || amount <= 0) return;
  counters[name] += amount;
  if (typeof window !== 'undefined') {
    try {
      window.dispatchEvent(new CustomEvent('testagram-vcdn-metric', {
        detail: { name, amount, totals: { ...counters } },
      }));
    } catch {
      // Metrics must never interfere with playback.
    }
  }
}

export function getVirtualCdnMetrics() {
  const totalMediaBytes = counters.originBytes + counters.cacheBytes + counters.peerBytesReceived;
  const offloadedBytes = counters.cacheBytes + counters.peerBytesReceived;
  return {
    ...counters,
    // Client-local diagnostic ratio; this is not a fleet-wide production metric.
    peerByteShare: totalMediaBytes > 0 ? counters.peerBytesReceived / totalMediaBytes : 0,
    clientOffloadByteShare: totalMediaBytes > 0 ? offloadedBytes / totalMediaBytes : 0,
  };
}

export function resetVirtualCdnMetrics() {
  for (const key of Object.keys(counters) as VirtualCdnMetric[]) counters[key] = 0;
}
