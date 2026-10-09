const base = (process.env.OBSERVABILITY_ORIGIN || "https://testagram.site").replace(/\/$/, "");
const cdn = (process.env.CDN_ORIGIN || "https://cdn.testagram.site").replace(/\/$/, "");
const timeoutMs = Number(process.env.OBSERVABILITY_TIMEOUT_MS || 10000);

const checks = [
  { name: "production-liveness", url: base + "/api/health", expected: 200 },
  { name: "production-readiness", url: base + "/api/ready", expected: 200 },
  { name: "cdn-edge-health", url: cdn + "/healthz", expected: 200 },
];

async function probe(check) {
  const started = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(check.url, {
      method: 'GET', redirect: 'follow', cache: 'no-store', signal: controller.signal,
      headers: { accept: 'application/json', 'user-agent': 'testagram-production-observability/1.0' },
    });
    const latencyMs = Math.round(performance.now() - started);
    let body = null;
    try { body = await response.json(); } catch {}
    const ok = response.status === check.expected &&
      (check.name !== 'production-liveness' || (body?.ok === true && body?.service === 'testagram' && body?.edge === 'reachable')) &&
      (check.name !== 'production-readiness' || (body?.ok === true && body?.database === 'reachable')) &&
      (check.name !== 'cdn-edge-health' || (body?.ok === true && body?.service === 'testagram-cdn'));
    return { ...check, ok, status: response.status, latency_ms: latencyMs, body };
  } catch (error) {
    return { ...check, ok: false, status: 'network_error', latency_ms: Math.round(performance.now() - started), error: error instanceof Error ? error.message : String(error) };
  } finally { clearTimeout(timer); }
}

const results = await Promise.all(checks.map(probe));
const failed = results.filter(result => !result.ok);
console.log(JSON.stringify({ OBSERVABILITY: failed.length === 0 ? 'PASS' : 'FAIL', checked_at: new Date().toISOString(), results }, null, 2));
if (failed.length > 0) process.exit(1);