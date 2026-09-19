const base = (process.env.PUBLIC_PRODUCTION_ORIGIN || "https://testagram.site").replace(/\/$/, "");
const total = Number(process.env.LOAD_REQUESTS || 2000);
const concurrency = Number(process.env.LOAD_CONCURRENCY || 100);
const expectedCommit = process.env.BASELINE_SHA || process.env.GITHUB_SHA || "";
const waitSeconds = Number(process.env.DEPLOY_WAIT_SECONDS || 300);
const target = base + "/api/health";
const latencies = [];
let completed = 0;
let failed = 0;
let next = 0;

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function readHealth() {
  const response = await fetch(target, { headers: { Accept: "application/json" }, cache: "no-store" });
  let body = null;
  try { body = await response.json(); } catch { body = null; }
  return { response, body };
}

async function waitForExactDeployment() {
  if (!expectedCommit || !/^[0-9a-f]{40}$/.test(expectedCommit)) throw new Error("BASELINE_SHA must be a full 40-character Git SHA.");
  const deadline = Date.now() + waitSeconds * 1000;
  let lastCommit = "unavailable";
  let lastStatus = "unavailable";
  while (Date.now() < deadline) {
    try {
      const { response, body } = await readHealth();
      lastStatus = String(response.status);
      lastCommit = body?.commit || "unknown";
      if (response.ok && body?.ok === true && body?.service === "testagram" && body?.edge === "reachable" && body.commit === expectedCommit) {
        console.log(JSON.stringify({ DEPLOYMENT_GATE: "PASSED", target, expected_commit: expectedCommit, deployed_commit: body.commit, http_status: response.status }));
        return;
      }
    } catch {}
    await sleep(5000);
  }
  throw new Error("Exact production revision was not observed within " + waitSeconds + "s. expected=" + expectedCommit + " last_status=" + lastStatus + " last_commit=" + lastCommit);
}

async function worker() {
  while (true) {
    const n = next++;
    if (n >= total) return;
    const started = performance.now();
    try {
      const response = await fetch(target, { headers: { Accept: "application/json" }, cache: "no-store" });
      latencies.push(performance.now() - started);
      if (!response.ok) failed++;
      await response.arrayBuffer();
    } catch { latencies.push(performance.now() - started); failed++; }
    finally { completed++; }
  }
}

if (process.argv.includes("--wait-for-deployment")) { await waitForExactDeployment(); process.exit(0); }
await waitForExactDeployment();
await Promise.all(Array.from({ length: Math.min(concurrency, total) }, () => worker()));
latencies.sort((a, b) => a - b);
const percentile = p => latencies[Math.min(latencies.length - 1, Math.floor((p / 100) * latencies.length))] ?? 0;
const errorRate = failed / Math.max(1, completed);
const p95 = percentile(95);
const p99 = percentile(99);
console.log(JSON.stringify({ LOAD_GATE: "COMPLETED", target, expected_commit: expectedCommit, requests: completed, concurrency: Math.min(concurrency, total), failures: failed, error_rate: Number(errorRate.toFixed(4)), p95_ms: Math.round(p95), p99_ms: Math.round(p99), NOTE: "Baseline smoke capacity only; this does not constitute proof of 50,000 concurrent users." }));
if (completed !== total || errorRate > 0.02 || p95 > 3000) process.exit(1);