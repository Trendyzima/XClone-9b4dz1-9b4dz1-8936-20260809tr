import fs from 'node:fs';
import path from 'node:path';

const roots = ['src', 'api', 'functions', 'supabase'];
const extensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.toml', '.sql']);
const patterns = [
  /@supabase\//i,
  /from\s+['"][^'"]*supabase/i,
  /\bsupabase\s*\./i,
  /VITE_SUPABASE_[A-Z0-9_]+/i,
  /SUPABASE_(?:URL|ANON_KEY|SERVICE_ROLE_KEY)/i,
  /\.functions\.invoke\s*\(/i,
];
const matches = [];
const walk = (dir) => {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!['node_modules', 'dist', 'build', '.git'].includes(entry.name)) walk(full);
      continue;
    }
    if (!extensions.has(path.extname(entry.name))) continue;
    if (['src/lib/supabase.ts', 'src/types/supabase-compat.d.ts', 'src/types/supabase-postgrest-compat.d.ts'].includes(full.replaceAll('\\\\', '/'))) continue;
    const lines = fs.readFileSync(full, 'utf8').split(/\r?\n/);
    lines.forEach((line, index) => {
      if (patterns.some((pattern) => pattern.test(line))) matches.push({ file: full.replaceAll('\\\\', '/'), line: index + 1, text: line.trim().slice(0, 240) });
    });
  }
};
for (const root of roots) walk(root);
const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
if (packageJson.dependencies?.['@supabase/supabase-js'] || packageJson.devDependencies?.['@supabase/supabase-js']) {
  matches.push({ file: 'package.json', line: 1, text: 'Dependency @supabase/supabase-js is still installed.' });
}
console.log(JSON.stringify({ audit: 'supabase-reference-inventory', count: matches.length, matches: matches.slice(0, 400) }, null, 2));
