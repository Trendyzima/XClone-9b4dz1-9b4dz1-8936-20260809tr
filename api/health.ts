export const config = { runtime: 'edge' };

// The reconciliation workflow deploys from an exact checked-out SHA using the
// Vercel CLI. In that mode Vercel's Git system variable can describe an older
// linked deployment. TESTAGRAM_COMMIT_SHA is therefore the authoritative
// immutable revision injected explicitly by the deployment gate.
const DEPLOYED_COMMIT =
  process.env.TESTAGRAM_COMMIT_SHA ||
  process.env.VERCEL_GIT_COMMIT_SHA ||
  process.env.GITHUB_SHA ||
  'unknown';

// Liveness stays cheap: capacity probes must not turn every synthetic request into
// a database request. Database readiness is checked by /api/ready.
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
