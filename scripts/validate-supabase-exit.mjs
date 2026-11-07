import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

// Release gate: no legacy identity/data runtime or deployment files may ship.
const tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
const textExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.yml', '.yaml', '.toml', '.sql', '.sh', '.env', '.properties', '.gradle', '.xml']);
const auditFiles = new Set([
  'scripts/validate-supabase-exit.mjs',
  'scripts/validate-appwrite-client.mjs',
  'scripts/validate-appwrite-auth.mjs',
]);
const targets = tracked.filter((file) => {
  if (/^(?:docs|documentation)\//i.test(file) || /(?:^|\/)(?:README|CHANGELOG|LICENSE)(?:\.|$)/i.test(file)) return false;
  const base = path.basename(file);
  return textExtensions.has(path.extname(file).toLowerCase()) || base === 'Dockerfile' || base.startsWith('.env');
});
const violations = [];
for (const file of targets) {
  if (auditFiles.has(file)) continue;
  if (/supabase/i.test(file)) {
    violations.push(file + ' (legacy provider path)');
    continue;
  }
  let source;
  try { source = fs.readFileSync(file, 'utf8'); } catch { continue; }
  if (/supabase/i.test(source)) violations.push(file);
}
if (violations.length) {
  console.error('[identity-runtime-exit] BLOCKED: legacy Supabase paths/references remain in tracked runtime/config files:');
  for (const file of violations) console.error(' - ' + file);
  console.error('[identity-runtime-exit] Port these integrations to Appwrite identity + Backend APIs before release.');
  process.exit(1);
}
console.log('[identity-runtime-exit] PASS: no tracked Supabase runtime/config references remain.');
