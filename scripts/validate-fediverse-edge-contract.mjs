import fs from 'node:fs';

const source = fs.readFileSync(new URL('../cloudflare/index.ts', import.meta.url), 'utf8');
const failures = [];
const requireText = (pattern, message) => {
  if (!pattern.test(source)) failures.push(message);
};

requireText(/function nodeInfoFallback\(pathname: string\)/, 'Worker must define a bounded NodeInfo fallback.');
requireText(/pathname === '\/.well-known\/nodeinfo'[\s\S]*href: 'https:\/\/testagram\.site\/nodeinfo\/2\.1'[\s\S]*href: 'https:\/\/testagram\.site\/nodeinfo\/2\.0'/, 'WebFinger-adjacent NodeInfo discovery links must point at the canonical Testagram origin.');
requireText(/const version = pathname\.endsWith\('\/2\.1'\) \? '2\.1' : '2\.0'/, 'Fallback must preserve the requested NodeInfo schema version.');
requireText(/protocols: \['activitypub'\]/, 'Fallback NodeInfo schema must advertise ActivityPub.');
requireText(/if \(version === '2\.1'\) body\.services = \{ inbound: \[\], outbound: \[\] \}/, 'NodeInfo 2.1 fallback must include services.');
requireText(/const isNodeInfoPath = request\.method === 'GET'[\s\S]*\/\^\\\/nodeinfo\\\/2\\\.\[01\]\$\//, 'Only GET requests for NodeInfo routes may use the metadata fallback.');
requireText(/if \(!isNodeInfoPath\) throw error[\s\S]*return nodeInfoFallback\(pathname\)/, 'Non-NodeInfo proxy failures must not be hidden by the fallback.');
requireText(/if \(isNodeInfoPath && response\.status >= 500\)[\s\S]*return nodeInfoFallback\(pathname\)/, 'NodeInfo upstream 5xx responses must degrade to protocol-safe metadata.');
requireText(/if \(pathname === '\/.well-known\/nodeinfo'\) return '\/functions\/v1\/mastodon-federation\/.well-known\/nodeinfo'/, 'Canonical NodeInfo discovery route must proxy to the ActivityPub handler.');
requireText(/if \(pathname === '\/nodeinfo\/2\.0'\) return '\/functions\/v1\/mastodon-federation\/nodeinfo\/2\.0'/, 'NodeInfo 2.0 route must proxy to the ActivityPub handler.');
requireText(/if \(pathname === '\/nodeinfo\/2\.1'\) return '\/functions\/v1\/mastodon-federation\/nodeinfo\/2\.1'/, 'NodeInfo 2.1 route must proxy to the ActivityPub handler.');

if (failures.length) {
  for (const failure of failures) console.error('FAIL ' + failure);
  process.exitCode = 1;
} else {
  console.log('Fediverse edge contract: 11/11 checks passed');
}
