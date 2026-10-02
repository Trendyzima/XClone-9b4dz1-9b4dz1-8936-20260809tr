const base = (process.env.LOAD_ORIGIN || "https://testagram.site").replace(/\/$/, "");
const path = process.env.LOAD_PATH || "/api/health";
const total = Number(process.env.LOAD_REQUESTS || 10000);
const concurrency = Number(process.env.LOAD_CONCURRENCY || 250);
const timeoutMs = Number(process.env.LOAD_TIMEOUT_MS || 10000);
const expectedStatus = Number(process.env.LOAD_EXPECTED_STATUS || 200);
const maxErrorRate = Number(process.env.LOAD_MAX_ERROR_RATE || 0.02);
const maxP95 = Number(process.env.LOAD_MAX_P95_MS || 3000);
if (!Number.isInteger(total) || total < 1) throw new Error("LOAD_REQUESTS must be a positive integer.");
if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error("LOAD_CONCURRENCY must be a positive integer.");
const target = base + path;
const latencies = [], failures = [], statusCounts = new Map();
let next = 0, completed = 0, failed = 0;
function recordStatus(status) { const key = String(status); statusCounts.set(key, (statusCounts.get(key) || 0) + 1); }
async function worker() {
  while (true) {
    const index = next++; if (index >= total) return;
    const started = performance.now(); const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(target, { signal: controller.signal, cache: "no-store", headers: { accept: "application/json", "cache-control": "no-cache", "user-agent": "testagram-production-load-test/1.0" } });
      const latency = performance.now() - started; latencies.push(latency); recordStatus(response.status);
      if (response.status !== expectedStatus) { failed++; if (failures.length < 10) failures.push({ status: response.status, latency_ms: Math.round(latency) }); }
    } catch (error) {
      const latency = performance.now() - started; latencies.push(latency); failed++; recordStatus("network_error");
      if (failures.length < 10) failures.push({ status: "network_error", latency_ms: Math.round(latency), error: error instanceof Error ? error.message : String(error) });
    } finally { clearTimeout(timer); completed++; }
  }
}
const started = Date.now();
await Promise.all(Array.from({ length: Math.min(concurrency, total) }, () => worker()));
latencies.sort((a, b) => a - b);
const percentile = p => latencies[Math.min(latencies.length - 1, Math.floor((p / 100) * latencies.length))] ?? 0;
const errorRate = failed / Math.max(1, completed);
const result = { LOAD_TEST: "COMPLETED", target, requests: completed, concurrency: Math.min(concurrency, total), duration_ms: Date.now() - started, status_counts: Object.fromEntries([...statusCounts.entries()].sort(([a], [b]) => a.localeCompare(b))), failures: failed, error_rate: Number(errorRate.toFixed(4)), p50_ms: Math.round(percentile(50)), p95_ms: Math.round(percentile(95)), p99_ms: Math.round(percentile(99)), failure_samples: failures, note: "HTTP endpoint capacity only; not authenticated user/session capacity or media throughput." };
console.log(JSON.stringify(result, null, 2));
if (completed !== total || errorRate > maxErrorRate || percentile(95) > maxP95) process.exit(1);