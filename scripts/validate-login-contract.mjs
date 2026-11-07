import fs from 'node:fs';
import assert from 'node:assert/strict';

const read = (path) => fs.readFileSync(path, 'utf8');
const auth = read('src/services/appwriteAuth.ts');
const provider = read('src/components/layout/AuthProvider.tsx');
const page = read('src/pages/AuthPage.tsx');
const legalGate = read('src/components/auth/LegalAcceptanceGate.tsx');
const domain = read('src/lib/auth.ts');
const api = read('src/services/testagramApi.ts');
const transport = read('src/services/testagramApiClient.ts');
const env = read('.env.fresh.example');

assert.match(auth, /createEmailPasswordSession/, 'Login must create a real Appwrite email/password session.');
assert.doesNotMatch(auth, /appwriteAccount\.create\(/, 'The browser must not create Appwrite accounts outside Backend identity approval.');
assert.doesNotMatch(domain, /profileCandidate|\/v1\/me\/profile/, 'The browser must not self-provision or self-approve a missing canonical profile.');
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
assert.match(page, /LegalAcceptanceGate/, 'Approved users missing current consent must be shown the legal acceptance gate rather than being stranded on the login form.');
assert.match(page, /finishLogin\(legalPendingUser, true\)/, 'Legal acceptance must be persisted to the Backend before navigation.');
assert.match(legalGate, /LEGAL_POLICY_VERSION/, 'The consent gate must use the current policy version.');
assert.match(legalGate, /age < 18/, 'The consent gate must enforce the adult-only policy.');
assert.match(legalGate, /localStorage\.setItem\(LEGAL_CONSENT_STORAGE_KEY/, 'The consent gate must persist a pending consent payload for Backend submission.');
assert.match(page, /Log in securely/, 'Login form must expose an actionable submit control.');
assert.match(page, /Registration temporarily paused/, 'New registration must remain closed until Backend-owned identity verification is migrated.');
assert.match(page, /Existing Appwrite accounts can still sign in/, 'The paused registration notice must not imply that existing approved users cannot log in.');

assert.match(domain, /\/v1\/me/, 'Session finalization must resolve the canonical Backend profile.');
assert.match(domain, /\/v1\/me\/legal/, 'Session finalization must enforce canonical legal consent.');
assert.match(domain, /identity_verification_status[\s\S]*approved/, 'Only Backend-approved identities may enter the app.');
assert.match(api, /appwriteAuth\.createBackendJWT\(\)/, 'Shared API client must obtain the Appwrite JWT.');
assert.match(transport, /headers\.set\('Authorization'/, 'Backend API calls must carry the Appwrite JWT.');
assert.ok(transport.includes("if (!token || /[\r\n]/.test(token))"), 'JWT validation must reject CR/LF only, not ordinary letters such as r or n.');
assert.ok(transport.includes("path.startsWith('//') || /[\r\n\\]/.test(path))"), 'Path validation must reject CR/LF and backslashes without rejecting ordinary route characters.');
assert.match(transport, /X-Testagram-API-Version/, 'Backend API calls must declare the versioned contract.');
assert.match(transport, /X-Request-ID/, 'Backend API calls must include a request correlation ID.');
assert.match(transport, /credentials: 'omit'/, 'Backend API calls must not forward ambient browser cookies.');
assert.match(transport, /cache: 'no-store'/, 'Private authenticated API responses must not be cached.');
assert.match(env, /VITE_APPWRITE_ENDPOINT=/, 'Fresh build must configure the Appwrite endpoint.');
assert.match(env, /VITE_APPWRITE_PROJECT_ID=/, 'Fresh build must configure the Appwrite project.');
assert.match(env, /VITE_TESTAGRAM_FRESH_API_URL=/, 'Fresh build must configure the Backend API origin.');
assert.doesNotMatch(auth + provider + page + domain + api + transport, /(?:from|import).*supabase|supabase\.auth|supabase\.from|functions\/v1\/|@supabase/i, 'The Appwrite login path must not import, call or fall back to Supabase.');
assert.doesNotMatch(env, /SUPABASE/i, 'Fresh Appwrite environment must not contain Supabase configuration.');

console.log('Testagram Appwrite login, session restore and Backend authorization contract: PASS');
