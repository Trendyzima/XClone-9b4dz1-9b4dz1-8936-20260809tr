import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const client = read('../src/services/testagramApiClient.ts');
const social = read('../src/services/socialApiClient.ts');
const capability = read('../src/services/testagramCapabilityClient.ts');
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

requireText(client, /!path\.startsWith\('\/v1\/'\).*path\.startsWith\('\/v1\/internal\/'\)/s, 'Browser transport must reject private internal API routes.');
requireText(client, /new Headers\(requestOptions\.headers\)/, 'Caller headers must be normalized before protected headers are set.');
requireText(client, /headers\.set\('Authorization'.*headers\.set\('X-Testagram-API-Version'/s, 'Caller headers must not override authentication or API version.');
requireText(client, /payload = await response\.json\(\).*finally/s, 'Request timeout must cover response-body consumption.');
requireText(client, /timedOut.*API_TIMEOUT/s, 'Transport must distinguish timeout from caller cancellation.');
requireText(client, /typeof payload\.ok === 'boolean'.*payload\.data/s, 'Client must accept the transition envelope format.');
requireText(social, /testagramApi\.request.*\/v1\/feed\/home/s, 'Home feed must use the shared versioned API transport.');
requireText(social, /testagramApi\.request.*\/v1\/posts/s, 'Post creation must use the shared versioned API transport.');
requireText(social, /capabilityRequest.*testagramApi\.request/s, 'Unported social operations must use the shared versioned capability route.');
requireText(social, !/\/api\/social|supabase|@supabase/i.test(social) ? /capabilityRequest/ : /$^/, 'Social API client must not use legacy social endpoints or Supabase.');
requireText(capability, /testagramApi\.request<T>\(this\.endpoint/, 'Capability calls must use the shared versioned API transport.');
requireText(capability, /CAPABILITY_GATEWAY_ENDPOINT='\/v1\/capabilities'/, 'Capability adapter must use the versioned Backend route.');
requireText(capability, !/\/api\/capability|supabase|@supabase/i.test(capability) ? /CAPABILITY_GATEWAY_ENDPOINT/ : /$^/, 'Capability client must not reach the legacy capability gateway or Supabase.');
requireText(federation, /testagramApi\.request<T>\('\/v1\/capabilities'/, 'Federation calls must use the shared versioned Backend capability route.');
requireText(federation, !/\/api\/social|supabase|@supabase/i.test(federation) ? /testagram\.federation\.gateway/ : /$^/, 'Federation client must not use legacy social routes or Supabase.');
requireText(social, !/supabase/i.test(social) ? /createBackendJWT/ : /$^/, 'Social API client must not contain Supabase dependencies or authentication.');

if (failures.length) {
  console.error('Central API client contract failed:\n- ' + failures.join('\n- '));
  process.exitCode = 1;
} else {
  console.log('Central API client contract passed.');
}
