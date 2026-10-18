import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const source = fs.readFileSync(path.join(root, 'src/App.tsx'), 'utf8');
const errors = [];
const routeBlocks = [...source.matchAll(/<Routes>([\s\S]*?)<\/Routes>/g)].map((match) => match[1]);

if (routeBlocks.length === 0) errors.push('No React Router <Routes> blocks found in src/App.tsx.');

for (let blockIndex = 0; blockIndex < routeBlocks.length; blockIndex += 1) {
  const seen = new Set();
  for (const match of routeBlocks[blockIndex].matchAll(/<Route\s+path="([^"]+)"/g)) {
    const route = match[1];
    if (seen.has(route)) {
      errors.push('Duplicate route "' + route + '" in Routes block ' + (blockIndex + 1) + '.');
    }
    seen.add(route);
  }
}

const importTargets = [...source.matchAll(/import\(['"]@\/([^'"]+)['"]\)/g)].map((match) => match[1]);
for (const target of importTargets) {
  const candidates = [
    path.join(root, 'src', target + '.tsx'),
    path.join(root, 'src', target + '.ts'),
    path.join(root, 'src', target, 'index.tsx'),
    path.join(root, 'src', target, 'index.ts'),
  ];
  if (!candidates.some((candidate) => fs.existsSync(candidate))) {
    errors.push('Lazy import target does not exist: @/' + target);
  }
}

if (errors.length) {
  console.error('Page/route contract validation failed:');
  for (const error of errors) console.error('- ' + error);
  process.exitCode = 1;
} else {
  console.log('Page/route contract passed: ' + routeBlocks.length + ' Routes blocks, ' + importTargets.length + ' lazy import targets, no duplicate route paths or missing modules.');
}
