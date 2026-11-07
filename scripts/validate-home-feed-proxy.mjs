import fs from 'node:fs';

const source = fs.readFileSync(new URL('../api/home-feed.ts', import.meta.url), 'utf8');
const socialClient = fs.readFileSync(new URL('../src/services/socialApiClient.ts', import.meta.url), 'utf8');
const failures = [];
const requireText = (pattern, message) => {
  if (!pattern.test(source)) failures.push(message);
};

if (/supabase|postgrest|createClient|\.from\(['"]posts['"]\)/i.test(source)) {
  failures.push('Home-feed proxy must not query Supabase or own feed candidate retrieval.');
}
if (/candidateScore|function blend\(|recommendation_score|affinityScore/.test(source)) {
  failures.push('Home-feed proxy must not perform recommendation scoring or feed blending.');
}
requireText(/function isPrivateIPv4\([\s\S]*?a === 10[\s\S]*?a === 172[\s\S]*?a === 192/, 'Private IPv4 service ranges must be recognized for internal Backend routing.');
requireText(/function isTrustedPrivateBackendHost\([\s\S]*?host === 'backend'[\s\S]*?host\.endsWith\('\.internal'\)/, 'Docker/private service hostnames must be accepted for internal Backend routing.');
requireText(/url\.protocol !== 'https:'[\s\S]*?url\.protocol === 'http:' && privateHost/, 'Plain HTTP must be restricted to trusted private Backend hosts.');
requireText(/\/v1\/feed\/home/, 'The proxy must call the Fresh Appwrite Backend home-feed endpoint.');
if (!socialClient.includes('/v1/feed/home') || socialClient.includes('/api/feed/home')) {
  failures.push('The fresh-mode social client must call the Fresh Appwrite Backend /v1/feed/home route.');
}
requireText(/'X-Testagram-API-Version': '1'/, 'The proxy must send the versioned API contract header.');
requireText(/'X-Request-ID': requestId/, 'The proxy must propagate a request ID.');
requireText(/Authorization: authorization/, 'The proxy must forward the verified user session to Backend.');
requireText(/redirect: 'manual'/, 'The proxy must not follow Backend redirects.');
requireText(/bytes\.byteLength > 2 \* 1024 \* 1024/, 'The proxy must bound Backend response bodies.');
requireText(/limit < 1 \|\| limit > 50/, 'The proxy must bound feed page size.');
requireText(/clearTimeout\(timeout\)/, 'The proxy must clear its upstream timeout.');

if (failures.length) {
  console.error(failures.map((failure) => '- ' + failure).join('\n'));
  process.exitCode = 1;
} else {
  console.log('Home-feed proxy ownership and Fresh API contract checks passed.');
}
