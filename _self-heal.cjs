'use strict';

/**
 * Project self-healing guard.
 *
 * This runs on EVERY project build, independent of GitHub Actions or Vercel.
 * It repairs only known, deterministic compatibility problems and refuses to
 * silently turn a real build failure into success.
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = __dirname;
const npmrcPath = path.join(root, '.npmrc');
const preloadPath = path.join(root, '_preload.cjs');
const patcherPath = path.join(root, '_patch-vite.cjs');
const packageJsonPath = path.join(root, 'package.json');
const cssPath = path.join(root, 'src', 'index.css');

function log(message) {
  process.stderr.write(`[_self-heal] ${message}\n`);
}

function repairNpmrc() {
  if (!fs.existsSync(npmrcPath)) return;
  const original = fs.readFileSync(npmrcPath, 'utf8');
  const repaired = original
    .split(/\r?\n/)
    .filter((line) => !/^\s*node-options\s*=/.test(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n');

  if (repaired !== original) {
    fs.writeFileSync(npmrcPath, repaired.endsWith('\n') ? repaired : `${repaired}\n`);
    log('repaired stale runner-specific node-options in .npmrc');
  }
}

function repairKnownCssEscapes() {
  if (!fs.existsSync(cssPath)) return;
  const original = fs.readFileSync(cssPath, 'utf8');
  const repairs = [
    ['.bg-muted\\\\/50', '[class~="bg-muted/50"]'],
  ];
  let repaired = original;
  for (const [broken, fixed] of repairs) repaired = repaired.split(broken).join(fixed);
  if (repaired !== original) {
    fs.writeFileSync(cssPath, repaired);
    log('repaired malformed Tailwind slash selector in src/index.css');
  }
}

function runVitePatcher() {
  if (!fs.existsSync(patcherPath)) {
    log('Vite patcher not present; continuing because it is an optional compatibility repair');
    return;
  }

  const result = spawnSync(process.execPath, [patcherPath], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env },
  });

  if (result.error) {
    throw new Error(`could not run _patch-vite.cjs: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`_patch-vite.cjs exited with ${result.status}`);
  }
}

function validateProject() {
  for (const required of [packageJsonPath, preloadPath]) {
    if (!fs.existsSync(required)) {
      throw new Error(`required project file is missing: ${required}`);
    }
  }

  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  if (!packageJson.scripts || packageJson.scripts.build !== 'node _build.cjs') {
    throw new Error('package.json build script is not routed through _build.cjs');
  }

  const nodeOptions = process.env.NODE_OPTIONS || '';
  if (/--require\s+\S*_preload\S*/.test(nodeOptions) || /--loader\s+\S+/.test(nodeOptions)) {
    log('runner supplied preload/loader options detected; _build.cjs will sanitize them before Vite starts');
  }
}

try {
  log('starting deterministic project repair');
  repairNpmrc();
  repairKnownCssEscapes();
  validateProject();
  runVitePatcher();
  log('compatibility checks complete; real build remains authoritative');
} catch (error) {
  process.stderr.write(`[_self-heal] ❌ ${error.message}\n`);
  process.exit(1);
}
