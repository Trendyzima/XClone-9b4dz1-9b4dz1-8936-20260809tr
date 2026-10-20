import fs from 'node:fs';

const source = fs.readFileSync(new URL('../cloudflare/index.ts', import.meta.url), 'utf8');
const retentionIndexMigration = fs.readFileSync(new URL('../supabase/migrations/20261020090000_fediverse_retention_created_at_index.sql', import.meta.url), 'utf8');
const retentionProbeMigration = fs.readFileSync(new URL('../supabase/migrations/20261020093000_optimize_fediverse_cleanup_has_more.sql', import.meta.url), 'utf8');
const failures = [];
const requireText = (pattern, message) => {
  if (!pattern.test(source)) failures.push(message);
};

requireText(/function nodeInfoFallback\(pathname: string\)/, 'Worker must define a bounded NodeInfo fallback.');
requireText(/pathname === '\/.well-known\/nodeinfo'[\s\S]*href: 'https:\/\/testagram\.site\/nodeinfo\/2\.1'[\s\S]*href: 'https:\/\/testagram\.site\/nodeinfo\/2\.0'/, 'WebFinger-adjacent NodeInfo discovery links must point at the canonical Testagram origin.');
requireText(/const version = pathname\.endsWith\('\/2\.1'\) \? '2\.1' : '2\.0'/, 'Fallback must preserve the requested NodeInfo schema version.');
requireText(/protocols: \['activitypub'\]/, 'Fallback NodeInfo schema must advertise ActivityPub.');
if (!source.includes("headers.set('content-type', 'application/json; profile=\"http://nodeinfo.diaspora.software/ns/schema/2.1#\"; charset=utf-8')")) failures.push('NodeInfo 2.1 fallback must advertise the matching schema media type.');
requireText(/if \(version === '2\.1'\) body\.services = \{ inbound: \[\], outbound: \[\] \}/, 'NodeInfo 2.1 fallback must include services.');
requireText(/const isNodeInfoPath = request\.method === 'GET'[\s\S]*\/\^\\\/nodeinfo\\\/2\\\.\[01\]\$\//, 'Only GET requests for NodeInfo routes may use the metadata fallback.');
requireText(/if \(!isNodeInfoPath\) throw error[\s\S]*return nodeInfoFallback\(pathname\)/, 'Non-NodeInfo proxy failures must not be hidden by the fallback.');
requireText(/if \(isNodeInfoPath && response\.status >= 500\)[\s\S]*return nodeInfoFallback\(pathname\)/, 'NodeInfo upstream 5xx responses must degrade to protocol-safe metadata.');
if (!source.includes("if (pathname === '/.well-known/webfinger') return '/functions/v1/mastodon-federation/.well-known/webfinger'")) failures.push('Canonical WebFinger lookup must proxy to the ActivityPub handler.');
requireText(/function webFingerCacheKey\(request: Request, generation: 'fresh' \| 'stale'\)/, 'WebFinger must use distinct fresh and stale cache entries keyed by the full resource query.');
requireText(/async function serveCachedWebFinger[\s\S]*X-Testagram-WebFinger-Cache[\s\S]*stale-if-error/, 'WebFinger must be able to serve cached successful identity records during upstream failures.');
requireText(/async function saveWebFinger[\s\S]*response\.status !== 200[\s\S]*parsed\.subject[\s\S]*Array\.isArray\(parsed\.links\)/, 'Only successful, structurally valid WebFinger JRD responses may be cached.');
requireText(/if \(isWebFingerPath\) \{[\s\S]*serveCachedWebFinger\(request, 'fresh'\)/, 'Fresh WebFinger cache must be checked before querying the upstream database.');
requireText(/if \(isWebFingerPath\) \{[\s\S]*serveCachedWebFinger\(request, 'stale'\)[\s\S]*upstream unreachable/, 'Cached WebFinger records must be used when the upstream fetch throws.');
requireText(/if \(isWebFingerPath && response\.status >= 500\)[\s\S]*serveCachedWebFinger\(request, 'stale'\)/, 'Cached WebFinger records must be used for upstream 5xx responses.');
requireText(/caches\.default\.put\(webFingerCacheKey\(request, 'fresh'\)[\s\S]*caches\.default\.put\(webFingerCacheKey\(request, 'stale'\)/, 'WebFinger success must populate both short-lived fresh and long-lived stale cache entries.');

if (!source.includes("pathname === '/.well-known/webfinger' ||")) failures.push('Public WebFinger lookups must be eligible for short-lived edge caching.');
requireText(/if \(pathname === '\/.well-known\/nodeinfo'\) return '\/functions\/v1\/mastodon-federation\/.well-known\/nodeinfo'/, 'Canonical NodeInfo discovery route must proxy to the ActivityPub handler.');
requireText(/if \(pathname === '\/nodeinfo\/2\.0'\) return '\/functions\/v1\/mastodon-federation\/nodeinfo\/2\.0'/, 'NodeInfo 2.0 route must proxy to the ActivityPub handler.');
requireText(/if \(pathname === '\/nodeinfo\/2\.1'\) return '\/functions\/v1\/mastodon-federation\/nodeinfo\/2\.1'/, 'NodeInfo 2.1 route must proxy to the ActivityPub handler.');

if (!/CREATE INDEX IF NOT EXISTS federated_objects_created_at_id_idx[\\s\\S]*ON public\\.federated_objects \\(created_at ASC, id ASC\\)/i.test(retentionIndexMigration)) failures.push('Retention cleanup migration must index federated_objects(created_at, id) for bounded oldest-first cleanup.');
if (!/LIMIT v_batch_limit \\+ 1[\\s\\S]*v_has_more := cardinality\\(v_object_ids\\) > v_batch_limit[\\s\\S]*v_object_ids := v_object_ids\\[1:v_batch_limit\\]/i.test(retentionProbeMigration)) failures.push('Retention cleanup must derive has_more from one indexed sentinel row instead of a second full-table existence probe.');
if (/SELECT EXISTS\\s*\\(/i.test(retentionProbeMigration)) failures.push('Retention cleanup migration must not reintroduce the extra SELECT EXISTS scan.');

if (failures.length) {
  for (const failure of failures) console.error('FAIL ' + failure);
  process.exitCode = 1;
} else {
  console.log('Fediverse edge contract: all checks passed');
}
