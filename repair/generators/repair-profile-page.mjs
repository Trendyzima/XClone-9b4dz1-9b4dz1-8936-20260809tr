import fs from 'node:fs';
import crypto from 'node:crypto';

const manifestPath = 'repair/manifests/profile-page.json';
const targetPath = 'src/pages/ProfilePage.tsx';
const raw = fs.readFileSync(manifestPath, 'utf8');
const manifest = JSON.parse(raw);

if (manifest.schema_version !== 1 || manifest.repair_id !== 'profile-page-module-corruption-v1') {
  throw new Error('Refusing repair: manifest identity/schema mismatch');
}
if (manifest.path !== targetPath || typeof manifest.content !== 'string' || !manifest.expected_sha256) {
  throw new Error('Refusing repair: malformed ProfilePage manifest');
}

const before = fs.readFileSync(targetPath, 'utf8');
const beforeHash = crypto.createHash('sha256').update(before).digest('hex');
const beforeBytes = Buffer.byteLength(before);
const signatures = manifest.corruption_signatures ?? {};
if (beforeHash !== signatures.sha256 || beforeBytes !== signatures.bytes || before !== signatures.exact_content) {
  throw new Error('Refusing repair: target does not match the exact bounded ProfilePage corruption signature');
}

const expected = manifest.content;
const expectedHash = crypto.createHash('sha256').update(expected).digest('hex');
if (expectedHash !== manifest.expected_sha256) {
  throw new Error('Refusing repair: manifest content hash mismatch');
}

if (before === expected) {
  throw new Error('Refusing repair: target is already repaired');
}

fs.writeFileSync(targetPath, expected);
const after = fs.readFileSync(targetPath, 'utf8');
const afterHash = crypto.createHash('sha256').update(after).digest('hex');
if (afterHash !== manifest.expected_sha256) {
  throw new Error('Repair proof failed: repaired file hash mismatch');
}

console.log(JSON.stringify({
  repair_id: manifest.repair_id,
  path: targetPath,
  before_bytes: Buffer.byteLength(before),
  after_bytes: Buffer.byteLength(after),
  after_sha256: afterHash
}, null, 2));
