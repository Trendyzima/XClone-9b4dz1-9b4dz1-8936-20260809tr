'use strict';

/**
 * _build.cjs v5 — portable, self-healing Vite build wrapper.
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = __dirname;
const preloadPath = path.resolve(root, '_preload.cjs');
const selfHealPath = path.resolve(root, '_self-heal.cjs');
const homeFeedRewirePath = path.resolve(root, 'scripts', 'home-feed-rewire.py');
const homeFeedCacheFixPath = path.resolve(root, 'scripts', 'home-feed-cache-fix.py');

function cleanNodeOptions(v) {
  return (v || '')
    .replace(/--require\s+\S*_preload\S*/g, '')
    .replace(/--loader\s+\S+/g, '')
    .replace(/--experimental-loader\s+\S+/g, '')
    .replace(/--max_old_space_size[=\s]+\S+/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function runSelfHeal() {
  if (!fs.existsSync(selfHealPath)) {
    process.stderr.write(`[_build] ❌ Missing self-healing guard: ${selfHealPath}\n`);
    process.exit(1);
  }
  const result = spawnSync(process.execPath, [selfHealPath], { cwd: root, stdio: 'inherit', shell: false, env: { ...process.env } });
  if (result.error) {
    process.stderr.write(`[_build] ❌ Self-healing guard could not start: ${result.error.message}\n`);
    process.exit(1);
  }
  if (result.status !== 0) {
    process.stderr.write(`[_build] ❌ Self-healing guard failed (exit ${result.status})\n`);
    process.exit(result.status || 1);
  }
}

function runCiHomeFeedRewire() {
  if (process.env.GITHUB_ACTIONS !== 'true') return;
  for (const script of [homeFeedRewirePath, homeFeedCacheFixPath]) {
    if (!fs.existsSync(script)) continue;
    const result = spawnSync('python3', [script], { cwd: root, stdio: 'inherit', shell: false, env: { ...process.env } });
    if (result.error || result.status !== 0) {
      process.stderr.write(`[_build] ❌ Home feed rewire failed (exit ${result.status ?? 1})\n`);
      process.exit(result.status || 1);
    }
    try { fs.rmSync(script, { force: true }); } catch {}
  }
}

runSelfHeal();
runCiHomeFeedRewire();

if (!fs.existsSync(preloadPath)) {
  process.stderr.write(`[_build] ❌ Missing required repository preload: ${preloadPath}\n`);
  process.exit(1);
}

const nodeOptions = ['--require', preloadPath, '--max_old_space_size=8192', cleanNodeOptions(process.env.NODE_OPTIONS)].filter(Boolean).join(' ');
const viteArgs = ['vite', 'build', ...process.argv.slice(2)];

process.stderr.write('\n[_build] ========================================\n');
process.stderr.write('[_build] Starting self-healing Vite build\n');
process.stderr.write('[_build] Node: ' + process.version + '\n');
process.stderr.write('[_build] Platform: ' + process.platform + '\n');
process.stderr.write('[_build] Preload: ' + preloadPath + '\n');
process.stderr.write('[_build] Vite args: ' + viteArgs.slice(1).join(' ') + '\n');
process.stderr.write('[_build] ========================================\n\n');

const result = spawnSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', viteArgs, {
  stdio: 'inherit', shell: false,
  env: { ...process.env, NODE_OPTIONS: nodeOptions, VITE_BUILD_SOURCEMAP: 'false' },
});

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
