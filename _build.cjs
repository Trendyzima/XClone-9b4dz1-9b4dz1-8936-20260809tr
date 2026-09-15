'use strict';

/**
 * _build.cjs v4 — portable, self-healing Vite build wrapper.
 *
 * The wrapper owns the repository-local Node preload hook so builds never
 * inherit a runner-specific absolute path from npm configuration. It also
 * removes stale node-options entries before Vite starts and accepts Vite
 * arguments (for example: --mode development).
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = __dirname;
const preloadPath = path.resolve(root, '_preload.cjs');
const npmrcPath = path.resolve(root, '.npmrc');

function cleanNodeOptions(v) {
  return (v || '')
    .replace(/--require\s+\S*_preload\S*/g, '')
    .replace(/--loader\s+\S+/g, '')
    .replace(/--experimental-loader\s+\S+/g, '')
    .replace(/--max_old_space_size[=\s]+\S+/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
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
    process.stderr.write('[_build] Repaired stale runner-specific node-options in .npmrc.\n');
  }
}

if (!fs.existsSync(preloadPath)) {
  process.stderr.write(`[_build] ❌ Missing required repository preload: ${preloadPath}\n`);
  process.exit(1);
}

repairNpmrc();

const nodeOptions = [
  '--require', preloadPath,
  '--max_old_space_size=8192',
  cleanNodeOptions(process.env.NODE_OPTIONS),
].filter(Boolean).join(' ');

const viteArgs = ['vite', 'build', ...process.argv.slice(2)];

process.stderr.write('\n[_build] ========================================\n');
process.stderr.write('[_build] Starting self-healing Vite build\n');
process.stderr.write('[_build] Node: ' + process.version + '\n');
process.stderr.write('[_build] Platform: ' + process.platform + '\n');
process.stderr.write('[_build] Preload: ' + preloadPath + '\n');
process.stderr.write('[_build] Vite args: ' + viteArgs.slice(1).join(' ') + '\n');
process.stderr.write('[_build] ========================================\n\n');

const result = spawnSync(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  viteArgs,
  {
    stdio: 'inherit',
    shell: false,
    env: {
      ...process.env,
      NODE_OPTIONS: nodeOptions,
      VITE_BUILD_SOURCEMAP: 'false',
    },
  },
);

if (result.error) {
  process.stderr.write(`\n[_build] ❌ Could not start Vite: ${result.error.message}\n`);
  process.exit(1);
}
if (result.signal) {
  process.stderr.write(`\n[_build] ❌ Vite killed by signal: ${result.signal}\n`);
  process.exit(1);
}
if (result.status !== 0) {
  process.stderr.write(`\n[_build] ❌ Vite build failed (exit ${result.status})\n`);
  process.exit(result.status || 1);
}

process.stderr.write('\n[_build] ✅ Vite build completed successfully.\n');
