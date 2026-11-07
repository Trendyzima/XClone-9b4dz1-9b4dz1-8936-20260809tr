import fs from 'node:fs';
import path from 'node:path';

const roots = ['src', 'api'];
const explicitFiles = ['package.json', '.env.example', '.env.fresh.example'];
const extensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const pattern = /\bsupabase\b|@supabase|SUPABASE_[A-Z0-9_]+|VITE_SUPABASE_[A-Z0-9_]+|supabase\.co|functions\/v1\//i;
const findings = [];

function scanFile(file) {
  const source = fs.readFileSync(file, 'utf8');
  source.split(/\r?\n/).forEach((line, index) => {
    if (pattern.test(line)) findings.push({ file: file.split(path.sep).join('/'), line: index + 1, text: line.trim() });
  });
}

function walk(directory) {
  if (!fs.existsSync(directory)) return;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git') continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (extensions.has(path.extname(entry.name))) scanFile(full);
  }
}

for (const root of roots) walk(root);
for (const file of explicitFiles) if (fs.existsSync(file)) scanFile(file);

if (findings.length) {
  console.error('Retired Supabase runtime references remain (' + findings.length + '):');
  for (const finding of findings) {
    console.error(finding.file + ':' + finding.line + ': ' + finding.text);
  }
  if (process.argv.includes('--strict')) process.exitCode = 1;
} else {
  console.log('No Supabase runtime references found in frontend source, API routes, or environment templates.');
}
