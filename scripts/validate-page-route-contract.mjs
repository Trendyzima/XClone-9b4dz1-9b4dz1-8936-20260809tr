import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const appPath = path.join(root, 'src/App.tsx');
const source = fs.readFileSync(appPath, 'utf8');
const errors = [];
const routeBlocks = [...source.matchAll(/<Routes>([\\s\\S]*?)<\\/Routes>/g)].map((match) => match[1]);

if (routeBlocks.length === 0) {
  errors.push('No React Router <Routes> blocks found in src/App.tsx.');
}

for (const [blockIndex, block] of routeBlocks.entries()) {
  const seen = new Map();
  for (const match of block.matchAll(/<Route\\s+path="([^"]+)"/g)) {
    const route = match[1];
    if (seen.has(route)) {
      errors.push(`Duplicate route "${route}" in Routes block ${blockIndex + 1}.`);
    } else {
      seen.set(route, true);
    }
  }
}

const importTargets = [...source.matchAll(/import\\(['"]@\\/([^'"]+)['"]\\)/g)].map((match) => match[1]);
for (const target of importTargets) {
  const candidates = [
    path.join(root, 'src', target + '.tsx'),
    path.join(root, 'src', target + '.ts'),
    path.join(root, 'src', target, 'index.tsx'),
    path.join(root, 'src', target, 'index.ts'),
  ];
  if (!candidates.some((candidate) => fs.existsSync(candidate))) {
    errors.push(`Lazy import target does not exist: @/${target}`);
  }
}

if (errors.length) {
  console.error('Page/route contract validation failed:');
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(`Page/route contract passed: ${routeBlocks.length} Routes blocks, ${importTargets.length} lazy import targets, no duplicate route paths or missing modules.`);
}
