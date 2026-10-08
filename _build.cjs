'use strict';

/**
 * _build.cjs v5 — portable, self-healing Vite build wrapper.
 *
 * Every project build enters _self-heal.cjs first. That guard performs only
 * deterministic compatibility repairs, then this wrapper owns the repository
 * preload hook and starts the real Vite build. A genuine Vite failure remains
 * a genuine failure; self-healing never masks it.
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = __dirname;
const preloadPath = path.resolve(root, '_preload.cjs');
const selfHealPath = path.resolve(root, '_self-heal.cjs');

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

  const result = spawnSync(process.execPath, [selfHealPath], {
    cwd: root,
    stdio: 'inherit',
    shell: false,
    env: { ...process.env },
  });

  if (result.error) {
    process.stderr.write(`[_build] ❌ Self-healing guard could not start: ${result.error.message}\n`);
    process.exit(1);
  }
  if (result.status !== 0) {
    process.stderr.write(`[_build] ❌ Self-healing guard failed (exit ${result.status})\n`);
    process.exit(result.status || 1);
  }
}

runSelfHeal();


function runTikVTVBuild() {
  const vendorRoot = path.resolve(root, 'vendor', 'TikVTV');
  const packageJson = path.join(vendorRoot, 'package.json');
  if (!fs.existsSync(packageJson)) {
    process.stderr.write('[_build] ❌ TikVTV submodule is missing. Checkout with submodules enabled.\n');
    process.exit(1);
  }

  process.stderr.write('\n[_build] Building pinned TikVTV IPTV upstream...\n');
  const npmBin = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const install = spawnSync(npmBin, ['ci', '--no-audit', '--no-fund'], {
    cwd: vendorRoot,
    stdio: 'inherit',
    shell: false,
    env: { ...process.env },
  });
  if (install.error || install.status !== 0) {
    process.stderr.write('[_build] ❌ TikVTV dependency installation failed.\n');
    process.exit(install.status || 1);
  }

  const tikBuild = spawnSync(npmBin, ['run', 'build', '--', '--base=/iptv-app/'], {
    cwd: vendorRoot,
    stdio: 'inherit',
    shell: false,
    env: { ...process.env },
  });
  if (tikBuild.error || tikBuild.status !== 0) {
    process.stderr.write('[_build] ❌ TikVTV production build failed.\n');
    process.exit(tikBuild.status || 1);
  }

  const sourceDist = path.join(vendorRoot, 'dist');
  const snapshot = path.resolve(root, '.xclone-tikvtv-dist');
  if (!fs.existsSync(path.join(sourceDist, 'index.html'))) {
    process.stderr.write('[_build] ❌ TikVTV build did not produce dist/index.html.\n');
    process.exit(1);
  }
  fs.rmSync(snapshot, { recursive: true, force: true });
  fs.cpSync(sourceDist, snapshot, { recursive: true });
  process.stderr.write('[_build] ✅ TikVTV upstream bundle captured.\n');
}

function publishTikVTVBundle() {
  const snapshot = path.resolve(root, '.xclone-tikvtv-dist');
  const target = path.resolve(root, 'dist', 'iptv-app');
  const sourceIndex = path.join(snapshot, 'index.html');
  if (!fs.existsSync(sourceIndex)) {
    process.stderr.write('[_build] ❌ Captured TikVTV bundle is missing.\n');
    process.exit(1);
  }

  fs.rmSync(target, { recursive: true, force: true });
  fs.cpSync(snapshot, target, { recursive: true });

  const index = fs.readFileSync(path.join(target, 'index.html'), 'utf8');
  const bootstrap = '<script>try{history.replaceState(null,"","/")}catch(e){}</script>\n';
  const entry = index.replace('</head>', bootstrap + '</head>');
  fs.writeFileSync(path.join(target, 'entry.html'), entry, 'utf8');
  fs.rmSync(snapshot, { recursive: true, force: true });
  process.stderr.write('[_build] ✅ TikVTV IPTV bundle published at dist/iptv-app.\n');
}

runTikVTVBuild();

if (!fs.existsSync(preloadPath)) {
  process.stderr.write(`[_build] ❌ Missing required repository preload: ${preloadPath}\n`);
  process.exit(1);
}

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
publishTikVTVBundle();

