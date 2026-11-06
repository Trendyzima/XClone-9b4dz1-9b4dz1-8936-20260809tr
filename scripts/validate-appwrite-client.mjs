import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const client = await readFile('src/lib/appwrite.ts', 'utf8');
const auth = await readFile('src/services/appwriteAuth.ts', 'utf8');
const env = await readFile('.env.example', 'utf8');

assert.ok(pkg.dependencies?.appwrite, 'official Appwrite Web SDK must be installed');
assert.match(client, /new Client\(\)/, 'Appwrite client must use the official SDK');
assert.match(client, /setEndpoint\(/, 'Appwrite endpoint must be explicitly configured');
assert.match(client, /setProject\(/, 'Appwrite project must be explicitly configured');
assert.match(client, /parsed\.protocol !== 'https:'/,'Appwrite must require HTTPS outside localhost');
assert.match(auth, /createEmailPasswordSession/, 'email/password session flow must exist');
assert.match(auth, /createVerification|updateVerification/, 'email verification flow must exist');
assert.match(auth, /createRecovery|updateRecovery/, 'password recovery flow must exist');
assert.match(auth, /createJWT/, 'backend API session bridge must use short-lived Appwrite JWTs');
assert.match(auth, /linkLegacyAccount/, 'existing-account migration must require an explicit linking action');
assert.match(auth, /X-Testagram-Legacy-Authorization/, 'legacy session proof must be sent separately from the Appwrite session');
assert.match(auth, /credentials: 'omit'/, 'identity linking must not send ambient browser credentials');
assert.doesNotMatch(auth, /(?:localStorage|sessionStorage)\s*(?:\.|\[)/, 'Appwrite JWT must not be persisted in browser storage');
assert.doesNotMatch(env, /VITE_APPWRITE_API_KEY|VITE_APPWRITE_SECRET/, 'server API keys must never be exposed as VITE variables');
console.log('Appwrite frontend client contract: PASS');
