const base = (process.env.PUBLIC_PRODUCTION_ORIGIN || "https://testagram.site").replace(/\/$/, "");
const total = Number(process.env.LOAD_REQUESTS || 2000);
const concurrency = Number(process.env.LOAD_CONCURRENCY || 100);
const expectedCommit = process.env.BASELINE_SHA || process.env.GITHUB_SHA || "";
const waitSeconds = Number(process.env.DEPLOY_WAIT_SECONDS || 300);
const target = base + "/api/health";
const latencies = [];
const statusCounts = new Map();
const failureSamples = [];
let completed = 0;
let failed = 0;
let revisionMismatches = 0;
let invalidContracts = 0;
let deployedCommit = expectedCommit;
let next = 0;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function assertConfig() {
  if (!expectedCommit || !/^[0-9a-f]{40}$/.test(expectedCommit)) {
    throw new Error("BASELINE_SHA must be a full 40-character Git SHA.");
  }
  if (!Number.isInteger(total) || total < 1) throw new Error("LOAD_REQUESTS must be a positive integer.");
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error("LOAD_CONCURRENCY must be a positive integer.");
}

function recordStatus(status) {
  const key = String(status);
  statusCounts.set(key, (statusCounts.get(key) || 0) + 1);
}

async function readHealth() {
  const response = await fetch(target, {
    headers: {
      Accept: "application/json",
      "Cache-Control": "no-cache",
      "User-Agent": "testagram-production-capacity-baseline/1.0",
    },
    cache: "no-store",
  });
  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return { response, body };
}

async function isDescendantOfExpected(observedCommit) {
  if (!observedCommit || observedCommit === expectedCommit) return true;
  const repository = process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN;
  if (!repository || !token || !/^[0-9a-f]{40}$/.test(observedCommit)) return false;
  const response = await fetch(`https://api.github.com/repos/${repository}/compare/${expectedCommit}...${observedCommit}`, { headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "testagram-production-capacity-baseline/1.0" }, cache: "no-store" });
  if (!response.ok) return false;
  const body = await response.json();
  return body?.status === "ahead" || body?.status === "identical";
}

function isExactHealthContract(response, body) {
  return response.ok &&
    body?.ok === true &&
    body?.service === "testagram" &&
    body?.edge === "reachable" &&
    body?.commit === deployedCommit;
}

function sampleFailure(response, body, reason) {
  if (failureSamples.length >= 10) return;
  const headers = {};
  for (const name of [
    "server",
    "retry-after",
    "cf-ray",
    "cf-cache-status",
    "x-vercel-id",
    "x-vercel-cache",
    "x-ratelimit-limit",
    "x-ratelimit-remaining",
    "x-ratelimit-reset",
  ]) {
    const value = response.headers.get(name);
    if (value) headers[name] = value;
  }
  failureSamples.push({
    status: response.status,
    reason,
    headers,
    body: typeof body === "string" ? body.slice(0, 300) : body,
  });
}

async function waitForExactDeployment() {
  const deadline = Date.now() + waitSeconds * 1000;
  let lastCommit = "unavailable";
  let lastStatus = "unavailable";

  while (Date.now() < deadline) {
    try {
      const { response, body } = await readHealth();
      lastStatus = String(response.status);
      lastCommit = body?.commit || "unknown";

      if (response.ok && body?.commit && await isDescendantOfExpected(body.commit)) {
        deployedCommit = body.commit;
        console.log(JSON.stringify({ DEPLOYMENT_GATE: "PASSED", target, expected_commit: expectedCommit, deployed_commit: body.commit, superseded_candidate: body.commit !== deployedCommit, http_status: response.status }));
        return;
      }

      if (isExactHealthContract(response, body)) {
        console.log(JSON.stringify({
          DEPLOYMENT_GATE: "PASSED",
          target,
          expected_commit: expectedCommit,
          deployed_commit: body.commit,
          http_status: response.status,
        }));
        return;
      }
    } catch {
      // The public alias may be propagating; keep polling until the bounded deadline.
    }
    await sleep(5000);
  }

  throw new Error(
    "Exact production revision was not observed within " +
      waitSeconds +
      "s. expected=" +
      expectedCommit +
      " last_status=" +
      lastStatus +
      " last_commit=" +
      lastCommit,
  );
}

async function worker() {
  while (true) {
    const n = next++;
    if (n >= total) return;

    const started = performance.now();
    try {
      const { response, body } = await readHealth();
      latencies.push(performance.now() - started);
      recordStatus(response.status);

      if (!response.ok) {
        failed++;
        sampleFailure(response, body, "http_error");
      } else if (!body || typeof body !== "object") {
        failed++;
        invalidContracts++;
        sampleFailure(response, body, "invalid_json_contract");
      } else if (body.commit !== expectedCommit) {
        failed++;
        revisionMismatches++;
        sampleFailure(response, body, "revision_mismatch");
      } else if (!isExactHealthContract(response, body)) {
        failed++;
        invalidContracts++;
        sampleFailure(response, body, "health_contract_mismatch");
      }

    } catch (error) {
      latencies.push(performance.now() - started);
      failed++;
      recordStatus("network_error");
      if (failureSamples.length < 10) {
        failureSamples.push({
          status: "network_error",
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    } finally {
      completed++;
    }
  }
}

assertConfig();

const waitOnly = process.argv.includes("--wait-for-deployment");
const skipDeploymentWait = process.argv.includes("--skip-deployment-wait");

if (!skipDeploymentWait) await waitForExactDeployment();
if (waitOnly) process.exit(0);

await Promise.all(
  Array.from({ length: Math.min(concurrency, total) }, () => worker()),
);

latencies.sort((a, b) => a - b);
const percentile = p =>
  latencies[
    Math.min(latencies.length - 1, Math.floor((p / 100) * latencies.length))
  ] ?? 0;

const errorRate = failed / Math.max(1, completed);
const p95 = percentile(95);
const p99 = percentile(99);
const status_counts = Object.fromEntries(
  [...statusCounts.entries()].sort(([a], [b]) => a.localeCompare(b)),
);

console.log(JSON.stringify({
  LOAD_GATE: "COMPLETED",
  target,
  expected_commit: expectedCommit,
  requests: completed,
  concurrency: Math.min(concurrency, total),
  failures: failed,
  revision_mismatches: revisionMismatches,
  invalid_contracts: invalidContracts,
  status_counts,
  failure_samples: failureSamples,
  error_rate: Number(errorRate.toFixed(4)),
  p95_ms: Math.round(p95),
  p99_ms: Math.round(p99),
  NOTE: "Baseline smoke capacity only; this does not constitute proof of 50,000 concurrent users.",
}));

if (
  completed !== total ||
  errorRate > 0.02 ||
  p95 > 3000 ||
  revisionMismatches > 0
) {
  process.exit(1);
}
