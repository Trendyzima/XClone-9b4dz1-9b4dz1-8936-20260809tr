import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const roots = ['src','api','cloudflare','supabase/functions'];
const extensions = new Set(['.ts','.tsx','.js','.jsx','.mjs','.cjs']);
const allowed = new Set([
  'supabase/functions/media-delivery/index.ts',
  'supabase/functions/post-media-upload/index.ts',
  'supabase/functions/r2-media/index.ts',
  'api/media.ts',
  'cloudflare/cdn-worker/src/index.ts',
]);
const forbidden = [
  { re: /https?:\/\/[^\s"'`]*r2\.cloudflarestorage\.com/i, name: 'public R2 URL' },
  { re: /https?:\/\/[^\s"'`]*\.r2\.dev/i, name: 'public R2 URL' },
  { re: /https?:\/\/res\.cloudinary\.com/i, name: 'public Cloudinary URL' },
  { re: /https?:\/\/[^\s"'`]*cloudinary\.com/i, name: 'public Cloudinary URL' },
  { re: /\/functions\/v1\/media-delivery(?:[/?]|$)/i, name: 'legacy public media-delivery URL' },
];
const findings = [];
function walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir,{withFileTypes:true})) {
    if (['node_modules','.git','dist'].includes(e.name)) continue;
    const full=path.join(dir,e.name);
    if(e.isDirectory()) walk(full);
    else if(extensions.has(path.extname(e.name))){
      const rel=path.relative(root,full).replaceAll(path.sep,'/');
      if(allowed.has(rel)) continue;
      const body=fs.readFileSync(full,'utf8');
      for(const rule of forbidden) if(rule.re.test(body)) findings.push(rel+': '+rule.name);
    }
  }
}
for(const d of roots) walk(path.join(root,d));
if(findings.length){ console.error('PUBLIC MEDIA BYPASS DETECTED'); findings.forEach(x=>console.error(' - '+x)); process.exit(1); }
console.log('CDN architecture gate passed: no hard-coded public storage or legacy media-delivery URLs found.');