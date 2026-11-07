import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const client = read('../src/services/testagramApiClient.ts');
const social = read('../src/services/socialApiClient.ts');
const federation = read('../src/api/federation.ts');
const failures = [];
const requireText = (source, pattern, message) => { if (!pattern.test(source)) failures.push(message); };

requireText(client, /X-Testagram-API-Version.*'1'/, 'Requests must declare Testagram API contract version 1.');
requireText(client, /X-Request-ID/, 'Requests must carry a request ID.');
requireText(client, /credentials: 'omit'/, 'Requests must not send browser cookies to the API.');
requireText(client, /cache: 'no-store'/, 'Private API requests must bypass browser caches.');
requireText(client, /method === 'GET'.*maxReadRetries/s, 'Only safe GET requests may be retried.');
requireText(client, /Idempotency-Key/, 'Mutation idempotency keys must be supported.');
requireText(client, /\/v1\//, 'Client must reject unversioned API routes.');
requireText(client, /payload\.ok === 'boolean'.*payload\.data/s, 'Client must accept the transition envelope format.');
requireText(social, /freshApi\.request.*\/v1\/feed\/home/s, 'Home feed must use the shared versioned API transport.');
requireText(social, /freshApi\.request.*\/v1\/posts/s, 'Post creation must use the shared versioned API transport.');
requireText(social, /createBackendJWT/, 'Fresh API calls must use Appwrite-issued Backend JWTs.');
requireText(social, !/supabase/i.test(social) ? /createBackendJWT/ : /$^/, 'Social API client must not contain Supabase dependencies or authentication.');
requireText(federation, !/supabase|FunctionsHttpError/i.test(federation) ? /X-Testagram-API-Version/ : /$^/, 'Federation API client must use the Appwrite-authenticated central API, never Supabase Functions or tables.');

if (failures.length) {
  console.error('Central API client contract failed:\n- ' + failures.join('\n- '));
  process.exitCode = 1;
} else {
  console.log('Central API client contract passed.');
}
