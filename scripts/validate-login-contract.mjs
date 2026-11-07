import fs from 'node:fs';
import assert from 'node:assert/strict';

const read = (path) => fs.readFileSync(path, 'utf8');
const auth = read('src/services/appwriteAuth.ts');
const provider = read('src/components/layout/AuthProvider.tsx');
const page = read('src/pages/AuthPage.tsx');
const domain = read('src/lib/auth.ts');
const api = read('src/services/testagramApi.ts');
const transport = read('src/services/testagramApiClient.ts');
const env = read('.env.fresh.example');

assert.match(auth, /createEmailPasswordSession/, 'Login must create a real Appwrite email/password session.');
assert.match(auth, /const user = await appwriteAccount\.get\(\)/, 'Login must return the authenticated Appwrite account.');
assert.match(auth, /notifyAuthChanged\(\)/, 'Login/logout must notify the app session provider.');
assert.match(auth, /async getCurrentUser[\s\S]*appwriteAccount\.get\(\)/, 'Reload must restore the Appwrite account from the persisted SDK session.');
assert.match(auth, /createJWT\(\)/, 'Backend requests must use a short-lived Appwrite JWT.');
assert.match(auth, /cachedBackendJWT\s*=\s*result\.jwt/, 'Backend JWT cache must remain in module memory.');
assert.doesNotMatch(auth, /(?:localStorage|sessionStorage)\s*\.\s*(?:setItem|put)\s*\([^\n]*(?:jwt|backend.?token)/i, 'Backend JWT must never be persisted in browser storage.');

assert.match(provider, /appwriteAuth\.getCurrentUser\(\)/, 'App launch must hydrate the Appwrite session.');
assert.match(provider, /finalizeAuthenticatedSession\(user\)/, 'Restored sessions must be checked against the canonical Backend.');
assert.match(page, /appwriteAuth\.signInWithPassword\(\{ email, password \}\)/, 'Login form must use Appwrite email/password authentication.');
assert.match(page, /await finishLogin\(user\)/, 'Successful Appwrite login must finish Backend authorization before navigation.');
assert.match(page, /Log in securely/, 'Login form must expose an actionable submit control.');

assert.match(domain, /\/v1\/me/, 'Session finalization must resolve the canonical Backend profile.');
assert.match(domain, /\/v1\/me\/legal/, 'Session finalization must enforce canonical legal consent.');
assert.match(domain, /identity_verification_status[\s\S]*approved/, 'Only Backend-approved identities may enter the app.');
assert.match(api, /appwriteAuth\.createBackendJWT\(\)/, 'Shared API client must obtain the Appwrite JWT.');
assert.match(transport, /headers\.set\('Authorization'/, 'Backend API calls must carry the Appwrite JWT.');
assert.match(transport, /X-Testagram-API-Version/, 'Backend API calls must declare the versioned contract.');
assert.match(transport, /credentials: 'omit'/, 'Backend API calls must not forward ambient browser cookies.');
assert.match(transport, /cache: 'no-store'/, 'Private authenticated API responses must not be cached.');
assert.match(env, /VITE_APPWRITE_ENDPOINT=/, 'Fresh build must configure the Appwrite endpoint.');
assert.match(env, /VITE_APPWRITE_PROJECT_ID=/, 'Fresh build must configure the Appwrite project.');
assert.match(env, /VITE_TESTAGRAM_FRESH_API_URL=/, 'Fresh build must configure the Backend API origin.');
assert.doesNotMatch(auth + provider + page + domain + api + transport, /(?:from|import).*supabase|supabase\\.auth|supabase\\.from|functions\\/v1\\/|@supabase/i, 'The Appwrite login path must not import, call or fall back to Supabase.');
assert.doesNotMatch(env, /SUPABASE/i, 'Fresh Appwrite environment must not contain Supabase configuration.');

console.log('Testagram Appwrite login, session restore and Backend authorization contract: PASS');
