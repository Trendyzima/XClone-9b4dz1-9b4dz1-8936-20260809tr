import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const failures = [];
const forbiddenRoots = ['api', 'cloudflare', 'supabase', 'services'];
for (const entry of forbiddenRoots) {
  try {
    const info = await stat(path.join(root, entry));
    if (info.isDirectory()) failures.push(`Forbidden backend-owned root directory remains: ${entry}/`);
  } catch {}
}

const sourceRoots = ['src'];
const extensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const forbiddenPatterns = [
  { label: 'Supabase SDK import', re: /from\s*['"]@supabase\// },
  { label: 'Supabase client import', re: /from\s*['"][^'"]*supabase(?:\.ts)?['"]/i },
  { label: 'Supabase client construction', re: /createClient\s*\(/ },
  { label: 'Supabase database/function/storage access', re: /\bsupabase\s*\.\s*(from|rpc|functions|storage|channel)\s*\(/ },
  { label: 'service-role credential', re: /SUPABASE_SERVICE_ROLE|APPWRITE_API_KEY|B2_APPLICATION_KEY|AWS_SECRET_ACCESS_KEY/ },
  { label: 'direct PostgREST access', re: /\/rest\/v1\// },
];
async function walk(dir) {
  let entries = [];
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['node_modules', 'dist', '.git'].includes(entry.name)) continue;
      await walk(full);
    } else if (extensions.has(path.extname(entry.name))) {
      const source = await readFile(full, 'utf8');
      for (const { label, re } of forbiddenPatterns) {
        if (re.test(source)) failures.push(`${label}: ${path.relative(root, full)}`);
      }
    }
  }
}
for (const dir of sourceRoots) await walk(path.join(root, dir));

const capabilityClient = await readFile(path.join(root, 'src/services/testagramCapabilityClient.ts'), 'utf8').catch(() => '');
if (!capabilityClient.includes('BACKEND_API_URL_REQUIRED') || !capabilityClient.includes('VITE_TESTAGRAM_API_URL')) {
  failures.push('Capability client must require an explicit VITE_TESTAGRAM_API_URL and fail closed.');
}
const mediaClient = await readFile(path.join(root, 'src/services/mediaClient.ts'), 'utf8').catch(() => '');
if (!mediaClient.includes('VITE_TESTAGRAM_API_URL') || !mediaClient.includes('requireMediaApi')) {
  failures.push('Media client must target the configured Backend API origin and fail closed.');
}

if (failures.length) {
  console.error('XClone client-only boundary validation failed:');
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}
console.log('PASS: XClone source is client-only and uses explicit Backend API origins.');
