import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const roots = ['src', 'api', 'cloudflare', 'supabase/functions'];
const extensions = new Set(['.ts','.tsx','.js','.jsx','.mjs','.cjs']);
const allowed = new Set([
  'supabase/functions/media-delivery/index.ts',
  'supabase/functions/post-media-upload/index.ts',
  'api/media.ts',
  'cloudflare/cdn-worker/src/index.ts',
]);
const forbidden = [
  { re: /r2\.cloudflarestorage\.com/i, name: 'direct R2 endpoint in application code' },
  { re: /R2_PUBLIC_BASE_URL/i, name: 'public R2 base URL' },
  { re: /R2_PUBLIC_BASE/i, name: 'public R2 base variable' },
  { re: /res\.cloudinary\.com|cloudinary\.com\//i, name: 'direct Cloudinary public URL' },
  { re: /\/functions\/v1\/media-delivery(?:[/?]|$)/i, name: 'legacy media-delivery public read path' },
];

const findings = [];
function walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules','.git','dist'].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (extensions.has(path.extname(entry.name))) {
      const rel = path.relative(root, full).replaceAll(path.sep, '/');
      if (allowed.has(rel)) continue;
      const text = fs.readFileSync(full, 'utf8');
      for (const rule of forbidden) {
        if (rule.re.test(text)) findings.push(`${rel}: ${rule.name}`);
      }
    }
  }
}
for (const dir of roots) walk(path.join(root, dir));

if (findings.length) {
  console.error('PUBLIC MEDIA BYPASS DETECTED');
  for (const finding of findings) console.error(' - ' + finding);
  process.exit(1);
}
console.log('CDN architecture gate passed: no direct public storage/media-delivery bypasses found outside explicitly server-side compatibility/upload code.');
