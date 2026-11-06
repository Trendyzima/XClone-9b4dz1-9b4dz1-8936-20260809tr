import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const workflow = await readFile('.github/workflows/tv-health-monitor.yml', 'utf8');
const client = await readFile('src/services/tvChannelCatalog.ts', 'utf8');
const backend = await readFile('src/lib/dataPlane.ts', 'utf8');
const healthStart = client.indexOf('export async function loadTvHealth(');
const healthEnd = client.indexOf('\nexport function rankRecommendedTvChannels', healthStart);
assert.notEqual(healthStart, -1, 'TV health client adapter must exist');
assert.notEqual(healthEnd, -1, 'TV health adapter must have a bounded implementation');
const healthAdapter = client.slice(healthStart, healthEnd);

assert.match(workflow, /audience=testagram-tv-health/, 'workflow must request the dedicated OIDC audience');
assert.match(workflow, /vars\.TESTAGRAM_BACKEND_URL/, 'workflow must target the configured independent backend');
assert.match(workflow, /x-github-oidc-token/, 'workflow must authenticate with short-lived OIDC');
assert.match(workflow, /\/internal\/tv\/health/, 'workflow must persist through the Go backend');
assert.doesNotMatch(workflow, /SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY|\/functions\/v1\/tv-health/, 'scheduled health writes must not depend on Supabase');
assert.match(healthAdapter, /\/api\/tv\/health/, 'TV client must read health from the Go API');
assert.doesNotMatch(healthAdapter, /supabase|rest\/v1|tv_channel_health|tv_catalog_health/, 'TV health reads must not fall back to Supabase');
assert.match(backend, /tvChannelHealth: \{ canonical: 'testagram-postgres', clientAccess: 'backend-read' \}/, 'data-plane contract must identify PostgreSQL as TV health owner');
console.log('TV health PostgreSQL contract: PASS');
