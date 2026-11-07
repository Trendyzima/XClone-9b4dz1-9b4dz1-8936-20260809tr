import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

// This is a release gate, not a compatibility shim. Fresh Testagram must have
// no Supabase runtime, SDK, deployment, environment, or Edge Function surface.
const tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
const targets = tracked.filter((file) =>
  file === 'package.json' || file === 'package-lock.json' ||
  file.startsWith('src/') || file.startsWith('api/') ||
  file.startsWith('supabase/') || file.startsWith('functions/') ||
  file.startsWith('.github/workflows/') ||
  /^\.env(?:\.|$)/.test(file) ||
  /^(?:vite|vitest|wrangler|netlify|vercel)\./.test(file)
);
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
