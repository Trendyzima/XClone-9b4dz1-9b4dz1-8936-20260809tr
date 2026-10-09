import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateVirtualCdnCapacity } from '../src/services/virtualCdnCapacity.ts';

test('estimates 2 million viewers without assumed peer offload', () => {
  const result = estimateVirtualCdnCapacity({
    concurrentViewers: 2_000_000,
    optedInShareFraction: 1,
    averageMediaBitrateMbps: 2,
    measuredPeerOffloadFraction: 0,
  });
  assert.equal(result.estimatedSignalingConnections, 2_000_000);
  assert.equal(result.theoreticalMediaMbps, 4_000_000);
  assert.equal(result.estimatedOriginGbps, 4_000);
});

test('uses only measured offload fraction in origin estimate', () => {
  const result = estimateVirtualCdnCapacity({
    concurrentViewers: 100,
    optedInShareFraction: 0.5,
    signalingChannelsPerOptedInViewer: 2,
    averageMediaBitrateMbps: 4,
    measuredPeerOffloadFraction: 0.25,
  });
  assert.equal(result.optedInViewers, 50);
  assert.equal(result.estimatedSignalingConnections, 100);
  assert.equal(result.estimatedOriginMbps, 300);
});

test('clamps fractions and prevents NaN or Infinity inputs contaminating outputs', () => {
  const result = estimateVirtualCdnCapacity({
    concurrentViewers: Number.POSITIVE_INFINITY,
    optedInShareFraction: Number.NaN,
    signalingChannelsPerOptedInViewer: Number.NaN,
    averageMediaBitrateMbps: Number.POSITIVE_INFINITY,
    measuredPeerOffloadFraction: Number.NaN,
  });
  for (const value of [
    result.concurrentViewers,
    result.optedInViewers,
    result.estimatedSignalingConnections,
    result.estimatedOriginMbps,
    result.estimatedOriginGbps,
    result.theoreticalMediaMbps,
    result.measuredPeerOffloadFraction,
  ]) assert.ok(Number.isFinite(value));
  assert.equal(result.concurrentViewers, 0);
  assert.equal(result.estimatedOriginMbps, 0);
});

test('zero viewers produce zero origin and signaling demand', () => {
  const result = estimateVirtualCdnCapacity({
    concurrentViewers: 0,
    optedInShareFraction: 1,
    averageMediaBitrateMbps: 2,
    measuredPeerOffloadFraction: 1,
  });
  assert.equal(result.estimatedSignalingConnections, 0);
  assert.equal(result.estimatedOriginGbps, 0);
});
