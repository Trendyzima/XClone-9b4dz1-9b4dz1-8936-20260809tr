import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const protectedFiles = [
  'src/pages/AuthPage.tsx',
  'src/pages/IdentityVerificationPage.tsx',
  'src/components/layout/AuthProvider.tsx',
  'src/lib/auth.ts',
  'src/lib/sessionPolicy.ts',
  'src/services/appwriteAuth.ts',
];
const forbidden = [
  { name: 'Supabase client import', pattern: /from\s+['"](?:@\/lib\/supabase|@supabase\/supabase-js)['"]/ },
  { name: 'Supabase Auth or data API call', pattern: /\bsupabase\.(?:auth|from|storage|functions|rpc)\s*\(/ },
  { name: 'Supabase frontend environment variable', pattern: /\bVITE_SUPABASE_[A-Z0-9_]+\b/ },
  { name: 'legacy identity signup client', pattern: /\bidentitySignup\b/ },
];

let failed = false;
for (const relative of protectedFiles) {
  const filename = path.join(root, relative);
  if (!fs.existsSync(filename)) {
    console.error('[appwrite-auth] required file missing: ' + relative);
    failed = true;
    continue;
  }
  const source = fs.readFileSync(filename, 'utf8');
  for (const rule of forbidden) {
    if (rule.pattern.test(source)) {
      console.error('[appwrite-auth] ' + relative + ' still contains ' + rule.name);
      failed = true;
    }
  }
}
if (failed) process.exit(1);
console.log('[appwrite-auth] Authentication and identity entry pages use Appwrite/Backend only.');
