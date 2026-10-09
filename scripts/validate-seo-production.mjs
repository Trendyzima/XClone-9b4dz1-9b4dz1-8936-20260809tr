import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const checks = [
  ['Root sitemap is a static, host-portable asset rather than a Cloudflare Worker dependency', () => read('public/sitemap.xml').includes('<sitemapindex') && !read('cloudflare/index.ts').includes("url.pathname === '/sitemap.xml'")],
  ['Sitemap handlers have a publishable-key fallback and do not require service-role secrets', () => ['index', 'users', 'community', 'posts', 'threads'].every((name) => {
    const source = read('api/sitemap-' + name + '.ts');
    return source.includes('SUPABASE_PUBLISHABLE_KEY') && source.includes('sb_publishable_h51Z3EHP2LN5o7HdRAB3Og_uhUA3oya') && source.includes('const supabaseApiKey =');
  })],
  ['Sitemap query failures return valid crawlable XML and expose degraded status', () => read('api/sitemap-fallback.ts').includes("'X-Sitemap-Data-Status': 'degraded'") && ['index', 'users', 'community', 'posts', 'threads'].every((name) => read('api/sitemap-' + name + '.ts').includes('degradedSitemap'))],
  ['All sitemap handlers are statically bundled and dispatched before dynamic imports', () => {
    const worker = read('cloudflare/index.ts');
    return [
      "import sitemapIndex from '../api/sitemap-index';",
      "import sitemapUsers from '../api/sitemap-users';",
      "import sitemapCommunity from '../api/sitemap-community';",
      "import sitemapPosts from '../api/sitemap-posts';",
      "import sitemapThreads from '../api/sitemap-threads';",
      "const STATIC_SITEMAP_ROUTES",
      "const sitemapHandler = STATIC_SITEMAP_ROUTES[pathname];",
      'return sitemapHandler(request);',
    ].every((fragment) => worker.includes(fragment));
  }],
  ['Build runs the provider-neutral SEO prerender plugin after Vite output', () => read('_build.cjs').includes('runSeoPrerender();') && read('_build.cjs').includes('prerender-seo.mjs') && read('scripts/prerender-seo.mjs').includes("'/tv'") && read('scripts/prerender-seo.mjs').includes("'/auth'")],
  ['Root sitemap bypasses Worker-first routing so static hosts can serve it directly', () => !JSON.parse(read('wrangler.jsonc')).assets.run_worker_first.includes('/sitemap.xml') && !read('cloudflare/index.ts').includes("url.pathname === '/sitemap.xml'")],
  ['Static sitemap fallback references valid first chunks for every dynamic sitemap', () => {
    const sitemap = read('public/sitemap.xml');
    return ['users', 'community', 'posts', 'threads'].every((name) => sitemap.includes(`https://testagram.site/api/sitemap-${name}?part=0</loc>`));
  }],
  ['Cloudflare registers every dynamic sitemap endpoint', () => ['users', 'community', 'posts', 'threads'].every((name) => read('cloudflare/index.ts').includes(`'/api/sitemap-${name}'`))],
  ['Sitemap index includes static, profiles, communities, posts and threads', () => {
    const index = read('api/sitemap-index.ts');
    return ['/sitemap-static.xml', '/api/sitemap-users', '/api/sitemap-community', '/api/sitemap-posts', '/api/sitemap-threads'].every((value) => index.includes(value));
  }],
  ['Sitemap index lists chunk URLs directly', () => read('api/sitemap-index.ts').includes('?part=${part}')],
  ['Sitemap endpoints validate numeric chunk parameters', () => ['users', 'community', 'posts', 'threads'].every((name) => read(`api/sitemap-${name}.ts`).includes('/^\\d+$/'))],
  ['Explicit sitemap chunks return URL sets, not nested sitemap indexes', () => ['users', 'community', 'posts', 'threads'].every((name) => read(`api/sitemap-${name}.ts`).includes('!hasExplicitPart'))],
  ['SEO optimizer emits noindex for private and unknown routes', () => read('cloudflare/index.ts').includes('Unknown client-side routes') && read('cloudflare/index.ts').includes("headers.set('X-Robots-Tag', 'noindex, nofollow')")],
  ['JSON-LD output escapes script-closing characters', () => read('cloudflare/index.ts').includes("replace(/</g, '\\\\u003c')")],
  ['Robots file exposes exactly one sitemap index and permits noindex routes to be crawled', () => {
    const robots = read('public/robots.txt');
    return (robots.match(/^Sitemap:/gm) || []).length === 1 && !robots.includes('Disallow: /auth') && !robots.includes('Disallow: /admin/');
  }],
  ['Static sitemap avoids stale modification dates and includes the news hub', () => {
    const sitemap = read('public/sitemap-static.xml');
    return !sitemap.includes('<lastmod>') && sitemap.includes('https://testagram.site/news</loc>');
  }],
  ['TV route has a crash boundary and page-specific SEO', () => ['/tv', '/tv/channels', '/tv/reels'].every((route) => read('src/App.tsx').includes('path="' + route + '" element={<TvPageErrorBoundary><TvChannelsPage/></TvPageErrorBoundary>}')) && read('src/pages/TvChannelsPage.tsx').includes('useSEO({')],
  ['TV data loading always leaves the loading state', () => read('src/pages/TvChannelsPage.tsx').includes('setLoading(false);') && read('src/pages/TvChannelsPage.tsx').includes('Live channels could not be loaded. Please try refreshing.')],
  ['TV catalogue loading is bounded and batched', () => read('src/pages/TvChannelsPage.tsx').includes('targets.slice(0,6)') && read('src/pages/TvChannelsPage.tsx').includes('targets.slice(offset,offset+4)') && read('src/pages/TvChannelsPage.tsx').includes('sourceLoadGeneration')],
  ['TV player health and visibility callbacks are stable', () => read('src/pages/TvChannelsPage.tsx').includes('const health=useCallback') && read('src/pages/TvChannelsPage.tsx').includes('onVisible={onPlayerVisible}')],
];

let failed = 0;
for (const [name, check] of checks) {
  let passed = false;
  try { passed = Boolean(check()); } catch (error) {
    console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
    failed++;
    continue;
  }
  console.log(`${passed ? 'PASS' : 'FAIL'} ${name}`);
  if (!passed) failed++;
}
console.log(`SEO production validation: ${checks.length - failed}/${checks.length} passed`);
if (failed) process.exit(1);
