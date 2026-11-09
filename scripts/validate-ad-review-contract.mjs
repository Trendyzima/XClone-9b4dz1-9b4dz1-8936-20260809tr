import fs from 'node:fs';

const read = (path) => fs.readFileSync(path, 'utf8');
const page = read('mobile/lib/features/ads/ad_review_page.dart');
const session = read('mobile/lib/core/auth/appwrite_admin_session.dart');
const config = read('mobile/lib/core/config/app_config.dart');
const contract = read('docs/contracts/ad-review-v1.md');

const required = [
  ['mobile review page uses the Appwrite admin session', /AppwriteAdminSession/.test(page)],
  ['mobile review page contains no Supabase SDK or RPC calls', !/supabase_flutter|Supabase\.instance|\.rpc\(/i.test(page)],
  ['admin session signs in through Appwrite email sessions', /\/account\/sessions\/email/.test(session)],
  ['admin session sends the Appwrite project header', /X-Appwrite-Project/.test(session)],
  ['admin session requests a short-lived Appwrite JWT', /\/account\/jwt/.test(session)],
  ['admin session implements MFA challenge and completion', /\/account\/mfa\/challenges/.test(session) && /completeMfaChallenge/.test(session)],
  ['Backend requests carry the Appwrite JWT', /Authorization.*Bearer/.test(session)],
  ['client contains no Appwrite API key or service credential', !/X-Appwrite-Key|APPWRITE_API_KEY|service[_-]?role/i.test(session)],
  ['Appwrite session cookies are not forwarded to the Backend API', !/_backendRequest[\s\S]*Cookie/.test(session)],
  ['Backend queue, review and status routes are used', /\/api\/admin\/ads\/review-queue/.test(session) && /\/review/.test(session) && /\/status/.test(session)],
  ['MFA-required responses are handled in the page', /ADMIN_MFA_REQUIRED/.test(page)],
  ['rejection requires a reason and caps it at 500 characters', /decision == 'rejected' && note\.isEmpty/.test(page) && /maxLength: 500/.test(page)],
  ['Appwrite and canonical API build defines are configured', /VITE_APPWRITE_ENDPOINT/.test(config) && /VITE_APPWRITE_PROJECT_ID/.test(config) && /VITE_TESTAGRAM_API_URL/.test(config)],
  ['contract documents recent MFA and platform.ads authorization', /five minutes/.test(contract) && /platform\.ads/.test(contract)],
  ['contract documents the native review endpoints', /GET \/api\/admin\/ads\/review-queue/.test(contract) && /POST \/api\/admin\/ads\/\\{campaign_id\\}\/review/.test(contract)],
];

const failures = required.filter(([, passed]) => !passed).map(([label]) => label);
if (failures.length) {
  console.error(`Native ad-review contract failed: ${failures.join('; ')}`);
  process.exitCode = 1;
} else {
  console.log(`Native ad-review contract passed: ${required.length}/${required.length} checks.`);
}
