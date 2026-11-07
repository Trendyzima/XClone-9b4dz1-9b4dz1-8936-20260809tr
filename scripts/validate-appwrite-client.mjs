import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const client = await readFile('src/lib/appwrite.ts', 'utf8');
const auth = await readFile('src/services/appwriteAuth.ts', 'utf8');
const env = await readFile('.env.fresh.example', 'utf8');
const supabase = await readFile('src/lib/supabase.ts', 'utf8');
const socialApi = await readFile('src/services/socialApiClient.ts', 'utf8');


assert.ok(pkg.dependencies?.appwrite, 'official Appwrite Web SDK must be installed');
assert.match(client, /new Client\(\)/, 'Appwrite client must use the official SDK');
assert.match(client, /setEndpoint\(/, 'Appwrite endpoint must be explicitly configured');
assert.match(client, /setProject\(/, 'Appwrite project must be explicitly configured');
assert.match(client, /parsed\.protocol !== 'https:'/,'Appwrite must require HTTPS outside localhost');
assert.match(auth, /createEmailPasswordSession/, 'email/password session flow must exist');
assert.match(auth, /createVerification|updateVerification/, 'email verification flow must exist');
assert.match(auth, /createRecovery|updateRecovery/, 'password recovery flow must exist');
assert.match(auth, /createJWT/, 'backend API session bridge must use short-lived Appwrite JWTs');
assert.doesNotMatch(auth, /linkLegacyAccount|X-Testagram-Legacy-Authorization/, 'fresh Appwrite identity must not link or migrate legacy Supabase identities');
assert.match(supabase, /FRESH_APPWRITE_MODE/, 'fresh Appwrite mode must be explicitly detected');
assert.match(supabase, /DISABLED_SUPABASE_URL/, 'fresh Appwrite builds must never fall back to legacy hosted Supabase');
assert.match(env, /VITE_TESTAGRAM_FRESH_MODE=true/, 'fresh frontend build must opt into isolated Appwrite mode');
assert.match(env, /VITE_TESTAGRAM_AUTH_PROVIDER=appwrite/, 'fresh frontend build must select Appwrite authentication');
assert.match(env, /VITE_TESTAGRAM_FRESH_API_URL=/, 'fresh frontend build must configure the independent API');
assert.match(socialApi, /assertSocialAPIAvailable/, 'unported social endpoints must fail closed in fresh Appwrite mode');
assert.match(env, /VITE_TESTAGRAM_API_URL=https:\/\/api\.testagram\.site/, 'all legacy API clients must be redirected to the fresh API host');
assert.doesNotMatch(auth + supabase + socialApi, /SUPABASE_SERVICE_ROLE_KEY|supabaseServiceKey|linkLegacyAccount/, 'fresh browser source must not carry privileged Supabase credentials or identity migration code');
assert.doesNotMatch(auth, /(?:localStorage|sessionStorage)\s*(?:\.|\[)/, 'Appwrite JWT must not be persisted in browser storage');
assert.doesNotMatch(env, /VITE_APPWRITE_API_KEY|VITE_APPWRITE_SECRET/, 'server API keys must never be exposed as VITE variables');
console.log('Appwrite frontend client contract: PASS');
