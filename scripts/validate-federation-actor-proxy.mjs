import fs from 'node:fs';

const proxy = fs.readFileSync(new URL('../api/federation-actor.ts', import.meta.url), 'utf8');
const client = fs.readFileSync(new URL('../src/api/federation.ts', import.meta.url), 'utf8');
const failures = [];
const requireText = (pattern, message) => {
  if (!pattern.test(proxy)) failures.push(message);
};

if (/supabase|postgrest|createClient/i.test(proxy)) {
  failures.push('The actor proxy must not access Supabase or own Federation data.');
}
requireText(/TESTAGRAM_FEDERATION_API_URL/, 'The Federation origin must be server-configured.');
requireText(/url\.protocol !== 'https:'[\s\S]*?url\.protocol === 'http:' && privateHost/, 'Public Federation origins must use HTTPS.');
requireText(/new URL\('\/users\/' \+ encodeURIComponent\(username\), federation\)/, 'The proxy must call the Federation service local actor route.');
requireText(/application\/activity\+json/, 'The proxy must request an ActivityPub actor representation.');
requireText(/redirect: 'manual'/, 'The proxy must reject redirects rather than forwarding credentials or following untrusted targets.');
requireText(/readBoundedBody\(upstream, 256 \* 1024\)/, 'The upstream actor body must be bounded while streaming.');
requireText(/clearTimeout\(timeout\)/, 'The upstream timeout must always be cleared.');
if (!client.includes('/api/federation-actor?username=')) {
  failures.push('Local getActor must resolve through the Federation service proxy.');
}

if (failures.length) {
  console.error(failures.map((failure) => '- ' + failure).join('\n'));
  process.exitCode = 1;
} else {
  console.log('Federation actor ownership and proxy checks passed.');
}
