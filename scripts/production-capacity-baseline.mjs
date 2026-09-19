const base = (process.env.APP_ORIGIN || "https://kooone-9b4dz1-9b4dz1-8936-20260809tr.vercel.app").replace(/\/$/, "");
const total = Number(process.env.LOAD_REQUESTS || 2000);
const concurrency = Number(process.env.LOAD_CONCURRENCY || 100);
const target = base + "/api/health";
const latencies = [];
let completed = 0;
let failed = 0;
let next = 0;

async function worker() {
  while (true) {
    const n = next++;
    if (n >= total) return;
    const started = performance.now();
    try {
      const response = await fetch(target, { headers: { Accept: "application/json" } });
      const elapsed = performance.now() - started;
      latencies.push(elapsed);
      if (!response.ok) failed++;
      await response.arrayBuffer();
    } catch {
      latencies.push(performance.now() - started);
      failed++;
    } finally {
      completed++;
    }
  }
}

await Promise.all(Array.from({ length: Math.min(concurrency, total) }, () => worker()));
latencies.sort((a,b) => a-b);
const percentile = p => latencies[Math.min(latencies.length - 1, Math.floor((p / 100) * latencies.length))] ?? 0;
const errorRate = failed / Math.max(1, completed);
const p95 = percentile(95);
const p99 = percentile(99);
console.log(JSON.stringify({
  LOAD_GATE: "COMPLETED",
  target,
  requests: completed,
  concurrency: Math.min(concurrency, total),
  failures: failed,
  error_rate: Number(errorRate.toFixed(4)),
  p95_ms: Math.round(p95),
  p99_ms: Math.round(p99),
  NOTE: "Baseline smoke capacity only; this does not constitute proof of 50,000 concurrent users."
}));
if (completed !== total || errorRate > 0.02 || p95 > 3000) process.exit(1);
