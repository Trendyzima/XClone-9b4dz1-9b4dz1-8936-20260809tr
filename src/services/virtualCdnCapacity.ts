/**
 * Capacity model helpers for the Testagram virtual CDN.
 *
 * This is planning math, not a capacity claim. It intentionally reports the
 * signaling connection floor separately from peer media offload.
 */
export type VirtualCdnCapacityInput = {
  concurrentViewers: number;
  optedInShareFraction: number;
  signalingChannelsPerOptedInViewer?: number;
  averageMediaBitrateMbps: number;
  measuredPeerOffloadFraction: number;
};

export type VirtualCdnCapacityEstimate = {
  concurrentViewers: number;
  optedInViewers: number;
  estimatedSignalingConnections: number;
  estimatedOriginMbps: number;
  estimatedOriginGbps: number;
  theoreticalMediaMbps: number;
  measuredPeerOffloadFraction: number;
  warning: string;
};

export function estimateVirtualCdnCapacity(input: VirtualCdnCapacityInput): VirtualCdnCapacityEstimate {
  const finiteNonNegative = (value: number, fallback = 0) =>
    Number.isFinite(value) ? Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, value)) : fallback;
  const viewers = Math.floor(finiteNonNegative(input.concurrentViewers));
  const share = Number.isFinite(input.optedInShareFraction)
    ? Math.min(1, Math.max(0, input.optedInShareFraction))
    : 0;
  const bitrate = finiteNonNegative(input.averageMediaBitrateMbps);
  const offload = Number.isFinite(input.measuredPeerOffloadFraction)
    ? Math.min(1, Math.max(0, input.measuredPeerOffloadFraction))
    : 0;
  const channels = Math.max(1, Math.floor(finiteNonNegative(input.signalingChannelsPerOptedInViewer ?? 1, 1)));
  const optedInViewers = Math.floor(viewers * share);
  const theoreticalMediaMbps = viewers * bitrate;
  const estimatedOriginMbps = theoreticalMediaMbps * (1 - offload);
  return {
    concurrentViewers: viewers,
    optedInViewers,
    estimatedSignalingConnections: optedInViewers * channels,
    estimatedOriginMbps,
    estimatedOriginGbps: estimatedOriginMbps / 1000,
    theoreticalMediaMbps,
    measuredPeerOffloadFraction: offload,
    warning: 'Planning estimate only. Replace offload with measured production telemetry and verify signaling, origin, NAT, browser, and regional capacity with load tests.',
  };
}
