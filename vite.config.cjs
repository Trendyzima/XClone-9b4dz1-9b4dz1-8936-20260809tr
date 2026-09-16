'use strict';
const fs   = require('fs');
const path = require('path');

/* ─── Surgical Vite-chunk patcher ─────────────────────────────────────────── */
function fixSource(src) {
  if (!src.includes('code??')) return src;
  let o = src;
  o = o.split('code??"", ').join('code, ');
  o = o.split("code??'', ").join('code, ');
  o = o.split('code??"",').join('code,');
  o = o.split("code??'',").join('code,');
  o = o.split('code??""').join('code');
  o = o.split("code??''").join('code');
  return o;
}

function patchViteChunks() {
  const dir = path.join(__dirname, 'node_modules', 'vite', 'dist', 'node', 'chunks');
  if (!fs.existsSync(dir)) return;
  let files;
  try { files = fs.readdirSync(dir).filter(f => f.endsWith('.js')); } catch (_) { return; }
  for (const f of files) {
    const fp = path.join(dir, f);
    try {
      try { fs.chmodSync(fp, 0o644); } catch (_) {}
      const src = fs.readFileSync(fp, 'utf8');
      if (!src.includes('code??')) { try { fs.chmodSync(fp, 0o444); } catch (_) {} continue; }
      const out = fixSource(src);
      if (out === src) { try { fs.chmodSync(fp, 0o444); } catch (_) {} continue; }
      fs.writeFileSync(fp, out, 'utf8');
      try { fs.chmodSync(fp, 0o444); } catch (_) {}
    } catch (_) {}
  }
}

patchViteChunks();

/* ─── Vite config ──────────────────────────────────────────────────────────── */
const { defineConfig } = require('vite');

let reactPlugin = null;
try {
  const { default: react } = require('@vitejs/plugin-react');
  reactPlugin = react();
} catch (_) {}

const root = __dirname;
const src  = path.join(root, 'src');
const stub = path.join(src, 'lib', 'capacitor-stub.ts');

/* ─── Helper: resolve extensionless path to a real file ───────────────────── */
const TS_EXTS = ['.tsx', '.ts', '.jsx', '.js'];

function resolveWithExts(base) {
  for (const ext of TS_EXTS) {
    const full = base + ext;
    if (fs.existsSync(full)) return full;
  }
  for (const ext of TS_EXTS) {
    const full = path.join(base, 'index' + ext);
    if (fs.existsSync(full)) return full;
  }
  return null;
}

/* ─── Plugin: resolve & load extensionless TypeScript imports ─────────────── *
 * Two hooks work together:
 *   resolveId — fires before alias expansion for @/ paths
 *   load      — safety-net: catches absolute paths that slipped through
 *               without an extension (after alias expansion by Vite internals)
 */
const resolveTypescriptExtensions = {
  name: 'resolve-ts-extensions',
  enforce: 'pre',

  resolveId(source, importer) {
    if (source.startsWith('\0')) return null;
    if (/\.[jt]sx?(\?.*)?$/.test(source)) return null;

    let base = null;

    if (source.startsWith('@/')) {
      base = path.join(src, source.slice(2));
    } else if (source.startsWith('/')) {
      base = source;
    } else if (source.startsWith('.') && importer) {
      const dir = path.dirname(importer.replace(/\?.*$/, ''));
      base = path.join(dir, source);
    } else {
      return null;
    }

    const resolved = resolveWithExts(base);
    return resolved || null;
  },

  load(id) {
    if (!id || id.startsWith('\0')) return null;
    if (/\.[jt]sx?(\?.*)?$/.test(id)) return null;
    if (!path.isAbsolute(id)) return null;

    const resolved = resolveWithExts(id);
    if (!resolved) return null;

    try {
      const code = fs.readFileSync(resolved, 'utf8');
      return { code, map: null };
    } catch (_) {
      return null;
    }
  },
};

/* ─── Explicit aliases for every layout + feature component in App.tsx ───── */
function a(rel) { return path.join(src, rel); }

const layoutAliases = {
  '@/components/layout/AuthProvider':       a('components/layout/AuthProvider.tsx'),
  '@/components/layout/Sidebar':            a('components/layout/Sidebar.tsx'),
  '@/components/layout/RightSidebar':       a('components/layout/RightSidebar.tsx'),
  '@/components/layout/BottomNav':          a('components/layout/BottomNav.tsx'),
  '@/components/layout/FloatingActionButton': a('components/layout/FloatingActionButton.tsx'),
  '@/components/layout/TopBar':             a('components/layout/TopBar.tsx'),
  '@/components/layout/ThemeToggle':        a('components/layout/ThemeToggle.tsx'),
  '@/components/layout/MobileSidebarDrawer': a('components/layout/MobileSidebarDrawer.tsx'),
  '@/components/features/LiveSpaceBanner':  a('components/features/LiveSpaceBanner.tsx'),
  '@/components/features/LiveNotificationBanner': a('components/features/LiveNotificationBanner.tsx'),
  '@/hooks/useCreatorTierAlert':            a('hooks/useCreatorTierAlert.ts'),
  '@/lib/supabase':                         a('lib/supabase.ts'),
  '@/lib/auth':                             a('lib/auth.ts'),
  '@/lib/utils':                            a('lib/utils.ts'),
  '@/stores/authStore':                     a('stores/authStore.ts'),
  '@/hooks/useAuth':                        a('hooks/useAuth.ts'),
  '@/hooks/useSEO':                         a('hooks/useSEO.ts'),
  '@/hooks/usePremium':                     a('hooks/usePremium.ts'),
  '@/hooks/useWallet':                      a('hooks/useWallet.ts'),
  '@/hooks/useFollow':                      a('hooks/useFollow.ts'),
};

module.exports = defineConfig({
  server: {
    host: '::',
    port: 8080,
  },

  plugins: reactPlugin
    ? [reactPlugin, resolveTypescriptExtensions]
    : [resolveTypescriptExtensions],

  esbuild: {
    jsx: 'automatic',
    jsxImportSource: 'react',
  },

  resolve: {
    extensions: ['.tsx', '.ts', '.jsx', '.js', '.mjs', '.json'],
    dedupe: ['react', 'react-dom'],
    alias: {
      '@capacitor/core':                          stub,
      '@capacitor/status-bar':                    stub,
      '@capacitor/app':                           stub,
      '@capacitor/device':                        stub,
      '@capacitor/filesystem':                    stub,
      '@capacitor/network':                       stub,
      '@capacitor/push-notifications':            stub,
      '@capacitor/share':                         stub,
      '@capacitor-community/admob':               stub,
      '@capacitor-community/firebase-analytics':  stub,
      '@capacitor-community/media':               stub,
      '@capgo/capacitor-updater':                 stub,
      '@vercel/analytics/react':                  stub,
      ...layoutAliases,
      '@': src,
    },
  },

  build: {
    commonjsOptions: { transformMixedEsModules: true },
    rollupOptions: {
      external: (id) =>
        /\.test\.[jt]sx?$/.test(id) || /\.spec\.[jt]sx?$/.test(id),
      plugins: [
        {
          name: 'vite-chunk-repatch',
          buildStart() { patchViteChunks(); },
          transform(code, id) {
            if (id.includes('/vite/dist/node/') && code.includes('code??')) {
              const fixed = fixSource(code);
              if (fixed !== code) return { code: fixed, map: null };
            }
            return null;
          },
        },
      ],
      output: {
        interop: 'auto',
        // Production evidence shows the eager Auth/Home shell works while
        // multiple React.lazy routes (Profile, Messages, Notifications and
        // Daily Rewards) fail together. Inline dynamic imports removes the
        // fragile runtime asset-fetch boundary for the SPA's single entry.
        inlineDynamicImports: true,
      },
      onwarn(warning, warn) {
        if (warning.code === 'MODULE_LEVEL_DIRECTIVE') return;
        if (warning.code === 'MISSING_EXPORT') return;
        warn(warning);
      },
    },
  },
});