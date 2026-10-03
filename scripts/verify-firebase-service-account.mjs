import fs from 'node:fs';
import crypto from 'node:crypto';
import https from 'node:https';

const credentialPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
const projectId = 'twitter-clone-ccrsxx-2513a';
if (!credentialPath) throw new Error('GOOGLE_APPLICATION_CREDENTIALS is not set');

const key = JSON.parse(fs.readFileSync(credentialPath, 'utf8'));
if (key.type !== 'service_account' || key.project_id !== projectId || !key.client_email || !key.private_key) {
  throw new Error('Service-account JSON does not match the expected Firebase project.');
}

const b64 = value => Buffer.from(value).toString('base64url');
const now = Math.floor(Date.now() / 1000);
const header = b64(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
const claim = b64(JSON.stringify({
  iss: key.client_email,
  scope: 'https://www.googleapis.com/auth/cloud-platform',
  aud: 'https://oauth2.googleapis.com/token',
  iat: now,
  exp: now + 3600
}));
const signer = crypto.createSign('RSA-SHA256');
signer.update(header + '.' + claim);
signer.end();
const assertion = header + '.' + claim + '.' + signer.sign(key.private_key, 'base64url');

const body = new URLSearchParams({
  grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
  assertion
}).toString();

const request = (url, options, payload = '') => new Promise((resolve, reject) => {
  const req = https.request(url, options, res => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => resolve({ status: res.statusCode, data }));
  });
  req.on('error', reject);
  if (payload) req.write(payload);
  req.end();
});

const publicKeys = await request(
  'https://www.googleapis.com/service_accounts/v1/metadata/x509/' + encodeURIComponent(key.client_email),
  { method: 'GET', headers: { Accept: 'application/json' } }
);
if (publicKeys.status !== 200) {
  console.error('Google public-key metadata lookup failed with HTTP ' + publicKeys.status);
  process.exit(1);
}
const publishedKeys = JSON.parse(publicKeys.data);
if (!Object.prototype.hasOwnProperty.call(publishedKeys, key.private_key_id)) {
  console.error('Stored key ID is not present in Google published public keys.');
  process.exit(1);
}
console.log('Stored service-account key ID matches a Google-published public key.');

const tokenResponse = await request('https://oauth2.googleapis.com/token', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/x-www-form-urlencoded',
    'Content-Length': Buffer.byteLength(body)
  }
}, body);

if (tokenResponse.status !== 200) {
  console.error('OAuth token exchange failed with HTTP ' + tokenResponse.status);
  try {
    const error = JSON.parse(tokenResponse.data);
    if (error.error) console.error('Google OAuth error: ' + error.error);
    if (error.error_description) console.error('Google OAuth description: ' + error.error_description);
  } catch {}
  process.exit(1);
}

const token = JSON.parse(tokenResponse.data).access_token;
if (!token) {
  console.error('OAuth token exchange returned no access token.');
  process.exit(1);
}

const sites = await request(
  `https://firebasehosting.googleapis.com/v1beta1/projects/${projectId}/sites`,
  {
    method: 'GET',
    headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' }
  }
);

if (sites.status !== 200) {
  console.error('Firebase Hosting API authorization failed with HTTP ' + sites.status);
  try {
    const error = JSON.parse(sites.data);
    if (error.error?.status) console.error('Firebase API status: ' + error.error.status);
    if (error.error?.message) console.error('Firebase API message: ' + error.error.message);
  } catch {}
  process.exit(1);
}

const parsed = JSON.parse(sites.data);
if (!Array.isArray(parsed.sites)) {
  console.error('Firebase Hosting API returned an unexpected response.');
  process.exit(1);
}
console.log('Google OAuth token exchange and Firebase Hosting API authorization verified.');
console.log('Authorized Firebase Hosting sites returned: ' + parsed.sites.length);
