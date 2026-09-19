export const config = { runtime: 'edge' };

// Liveness stays cheap: capacity probes must not turn every synthetic request into
// a database request. Database readiness is checked by /api/ready.
export default async function handler(_request: Request) {
  return new Response(JSON.stringify({ ok: true, service: 'testagram', edge: 'reachable' }), {
    status: 200,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
