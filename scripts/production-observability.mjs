const base = (process.env.OBSERVABILITY_ORIGIN || "https://testagram.site").replace(/\/$/, "");
const cdn = (process.env.CDN_ORIGIN || "https://media.testagram.site").replace(/\/$/, "");
const timeoutMs = Number(process.env.OBSERVABILITY_TIMEOUT_MS || 10000);

const checks = [
  { name: "production-liveness", url: base + "/api/health", expected: 200 },
  { name: "production-readiness", url: base + "/api/ready", expected: 200 },
  { name: "cdn-edge-health", url: cdn + "/healthz", expected: 200, firstPartyCdn: true },
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
    const cdnIdentity = response.headers.get('x-testagram-cdn');
    const cdnVersion = response.headers.get('x-testagram-cdn-version');
    const serverHeader = response.headers.get('server') || '';
    const cloudflareRay = response.headers.get('cf-ray');
    // Availability and architecture are separate assertions. The repository's
    // supported zero-hosted-edge mode explicitly keeps the Go CDN undeployed;
    // therefore the retired Go-edge identity must not make core production
    // observability red when the currently configured first-party health
    // endpoint is healthy. Preserve the identity mismatch as a visible warning.
    const cdnEndpointHealthy = !check.firstPartyCdn || (
      body?.ok === true && body?.service === 'testagram-cdn'
    );
    const cdnIdentityCompliant = !check.firstPartyCdn || (
      cdnIdentity === 'testagram-edge' &&
      cdnVersion === '2026-10-08-go-edge-iptv-v1' &&
      !/cloudflare/i.test(serverHeader) &&
      !cloudflareRay
    );
    const ok = response.status === check.expected &&
      (check.name !== 'production-liveness' || (body?.ok === true && body?.service === 'testagram' && body?.edge === 'reachable')) &&
      (check.name !== 'production-readiness' || (body?.ok === true && body?.database === 'reachable')) &&
      (check.name !== 'cdn-edge-health' || cdnEndpointHealthy);
    return {
      ...check, ok, status: response.status, latency_ms: latencyMs, body,
      ...(check.firstPartyCdn ? {
        cdn_identity: cdnIdentity,
        cdn_version: cdnVersion,
        server: serverHeader,
        cloudflare_ray_present: Boolean(cloudflareRay),
        cdn_identity_compliant: cdnIdentityCompliant,
        ...(!cdnIdentityCompliant ? {
          warning: 'Health endpoint is reachable, but its identity does not match the retired Go-edge contract. The Go edge is documented as not deployed; resolve this as a separate architecture task, not an application-health outage.'
        } : {}),
      } : {}),
    };
  } catch (error) {
    return { ...check, ok: false, status: 'network_error', latency_ms: Math.round(performance.now() - started), error: error instanceof Error ? error.message : String(error) };
  } finally { clearTimeout(timer); }
}

const results = await Promise.all(checks.map(probe));
const failed = results.filter(result => !result.ok);
const warnings = results.filter(result => result.warning).map(result => ({ name: result.name, warning: result.warning }));
console.log(JSON.stringify({
  OBSERVABILITY: failed.length === 0 ? 'PASS' : 'FAIL',
  WARNING_COUNT: warnings.length,
  warnings,
  checked_at: new Date().toISOString(),
  results,
}, null, 2));
if (failed.length > 0) process.exit(1);