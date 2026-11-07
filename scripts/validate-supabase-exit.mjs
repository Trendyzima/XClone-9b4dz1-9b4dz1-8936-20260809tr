import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

// This is a release gate, not a compatibility shim. Fresh Testagram must have
// no Supabase runtime, SDK, deployment, environment, or Edge Function surface.
const tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
const textExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.yml', '.yaml', '.toml', '.sql', '.sh', '.env', '.properties', '.gradle', '.xml']);
const targets = tracked.filter((file) => {
  if (/^(?:docs|documentation)\//i.test(file) || /(?:^|\/)(?:README|CHANGELOG|LICENSE)(?:\.|$)/i.test(file)) return false;
  const base = path.basename(file);
  return textExtensions.has(path.extname(file).toLowerCase()) ||
    base === 'Dockerfile' || base.startsWith('.env') ||
    file === 'package.json' || file === 'package-lock.json';
});
const violations = [];
for (const file of targets) {
  if (file === 'scripts/validate-supabase-exit.mjs') continue;
  let source;
  try { source = fs.readFileSync(file, 'utf8'); } catch { continue; }
  if (/supabase/i.test(source)) violations.push(file);
}
if (violations.length) {
  console.error('[supabase-exit] BLOCKED: Supabase references remain in tracked runtime/config files:');
  for (const file of violations) console.error(' - ' + file);
  console.error('[supabase-exit] Replace these integrations with Appwrite identity + Backend APIs before release.');
  process.exit(1);
}
console.log('[supabase-exit] PASS: no tracked Supabase runtime/config references remain.');
