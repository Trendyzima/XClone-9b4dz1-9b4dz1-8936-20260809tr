#!/usr/bin/env node
/**
 * Safe, loopback-only staged virtual-CDN load harness.
 *
 * This is a deterministic local simulation. It does not connect to Supabase,
 * WebRTC peers, IPTV sources, or production infrastructure.
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import { performance } from 'node:perf_hooks';

const STAGES = [100, 500, 1000];
const SEGMENTS_PER_VIEWER = 2;
const CLIENT_CONCURRENCY = 32;
const ORIGIN_CAPACITY = 48;
const SEGMENT_BYTES = 64 * 1024;
const ORIGIN_DELAY_MS = 4;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function startMockOrigin() {
  const state = { requests: 0, bytes: 0, active: 0, peakActive: 0, rejected: 0 };
  const server = http.createServer(async (_req, res) => {
    state.requests += 1;
    state.active += 1;
    state.peakActive = Math.max(state.peakActive, state.active);
    if (state.active > ORIGIN_CAPACITY) {
      state.rejected += 1;
      state.active -= 1;
      res.writeHead(503, { 'content-type': 'text/plain', 'cache-control': 'no-store' });
      res.end('simulated origin capacity exceeded');
      return;
    }
    await sleep(ORIGIN_DELAY_MS);
    const body = Buffer.alloc(SEGMENT_BYTES, 7);
    state.bytes += body.byteLength;
    state.active -= 1;
    res.writeHead(200, {
      'content-type': 'application/octet-stream',
      'content-length': String(body.byteLength),
      'cache-control': 'no-store',
    });
    res.end(body);
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  return {
    state,
    url: `http://127.0.0.1:${address.port}/segment`,
    close: () => new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve())),
  };
}

function requestSegment(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const bytes = Buffer.concat(chunks).byteLength;
        if (res.statusCode !== 200) {
          resolve({ ok: false, status: res.statusCode, bytes });
        } else {
          resolve({ ok: true, status: res.statusCode, bytes });
        }
      });
    });
    req.setTimeout(3000, () => req.destroy(new Error('local mock-origin timeout')));
    req.on('error', reject);
  });
}

async function runStage(viewers, peerAvailable) {
  const origin = await startMockOrigin();
  const totalRequests = viewers * SEGMENTS_PER_VIEWER;
  const started = performance.now();
  const memoryBefore = process.memoryUsage().rss;
  let next = 0;
  let peerHits = 0;
  let fallbackRequests = 0;
  let deliveredBytes = 0;
  let failures = 0;
  let peakWorkers = 0;
  let activeWorkers = 0;
  const outcomes = new Array(totalRequests);

  async function worker() {
    activeWorkers += 1;
    peakWorkers = Math.max(peakWorkers, activeWorkers);
    try {
      while (true) {
        const index = next++;
        if (index >= totalRequests) return;
        // Deterministic 80% peer hit when peers are available; all other
        // requests, including total peer outage, fall back to the mock origin.
        const peerHit = peerAvailable && index % 5 !== 0;
        if (peerHit) {
          peerHits += 1;
          deliveredBytes += SEGMENT_BYTES;
          outcomes[index] = { ok: true, path: 'peer', bytes: SEGMENT_BYTES };
          continue;
        }
        fallbackRequests += 1;
        const result = await requestSegment(origin.url);
        outcomes[index] = { ...result, path: 'origin' };
        if (result.ok) deliveredBytes += result.bytes;
        else failures += 1;
      }
    } finally {
      activeWorkers -= 1;
    }
  }

  await Promise.all(Array.from(
    { length: Math.min(CLIENT_CONCURRENCY, totalRequests) },
    () => worker(),
  ));
  const durationMs = performance.now() - started;
  const memoryAfter = process.memoryUsage().rss;
  const result = {
    viewers,
    mode: peerAvailable ? 'peer-available' : 'peer-outage-origin-fallback',
    mediaRequests: totalRequests,
    delivered: outcomes.filter((x) => x?.ok).length,
    failures,
    peerHits,
    originRequests: origin.state.requests,
    originBytes: origin.state.bytes,
    totalDeliveredBytes: deliveredBytes,
    originRejected: origin.state.rejected,
    originPeakInFlight: origin.state.peakActive,
    configuredOriginCapacity: ORIGIN_CAPACITY,
    configuredClientConcurrency: CLIENT_CONCURRENCY,
    peakClientWorkers: peakWorkers,
    requestRatePerSecond: Math.round(totalRequests / (durationMs / 1000)),
    durationMs: Math.round(durationMs * 100) / 100,
    rssBeforeBytes: memoryBefore,
    rssAfterBytes: memoryAfter,
    rssDeltaBytes: memoryAfter - memoryBefore,
    signalingFailureInjected: !peerAvailable,
    fallbackSucceeded: !peerAvailable && failures === 0 && outcomes.every((x) => x?.ok),
  };
  await origin.close();

  assert.equal(result.failures, 0, `stage ${viewers} failed requests in ${result.mode}`);
  assert.equal(result.delivered, totalRequests);
  assert.ok(result.originPeakInFlight <= ORIGIN_CAPACITY, 'mock origin exceeded configured capacity');
  assert.equal(result.originRejected, 0, 'bounded test unexpectedly overloaded mock origin');
  if (!peerAvailable) {
    assert.equal(result.originRequests, totalRequests, 'peer outage must route every request to origin');
    assert.equal(result.fallbackSucceeded, true, 'origin fallback did not recover all simulated playback requests');
  } else {
    assert.equal(result.peerHits, Math.floor(totalRequests * 0.8));
  }
  return result;
}

async function main() {
  const report = {
    harness: 'loopback-only virtual CDN staged simulation',
    disclaimer: 'Not a real WebRTC, Supabase, IPTV, or production-origin load test; values do not establish production capacity.',
    configuration: {
      stagesViewers: STAGES,
      segmentsPerViewer: SEGMENTS_PER_VIEWER,
      segmentBytes: SEGMENT_BYTES,
      clientConcurrency: CLIENT_CONCURRENCY,
      simulatedOriginCapacity: ORIGIN_CAPACITY,
      simulatedOriginDelayMs: ORIGIN_DELAY_MS,
    },
    stages: [],
  };

  for (const viewers of STAGES) {
    report.stages.push(await runStage(viewers, true));
    report.stages.push(await runStage(viewers, false));
  }
  assert.equal(report.stages.length, STAGES.length * 2);
  assert.ok(report.stages.every((stage) => stage.failures === 0));
  assert.ok(report.stages.filter((stage) => stage.signalingFailureInjected).every((stage) => stage.fallbackSucceeded));
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
