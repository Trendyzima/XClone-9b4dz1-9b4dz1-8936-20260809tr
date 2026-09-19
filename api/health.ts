export const config = { runtime: 'edge' };

const DEPLOYED_COMMIT =
  process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_SHA || 'unknown';

// Liveness stays cheap: capacity probes must not turn every synthetic request into
// a database request. Database readiness is checked by /api/ready.
// The deployed commit is returned so CI can prove it is load-testing the exact
// revision it checked out rather than a stale Vercel deployment.
export default async function handler(_request: Request) {
  return new Response(
    JSON.stringify({
      ok: true,
      service: 'testagram',
      edge: 'reachable',
      commit: DEPLOYED_COMMIT,
    }),
    {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'cache-control': 'no-store',
      },
    },
  );
}
