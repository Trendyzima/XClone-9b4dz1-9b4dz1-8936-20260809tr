import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const checks = [
  ['Cloudflare serves the dynamic root sitemap', () => read('cloudflare/index.ts').includes("url.pathname === '/sitemap.xml'") && read('cloudflare/index.ts').includes("'/api/sitemap-index': '../api/sitemap-index'")],
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
  ['TV data loading always leaves the loading state', () => read('src/pages/TvChannelsPage.tsx').includes('finally{\n   setLoading(false);') || read('src/pages/TvChannelsPage.tsx').includes('finally{\n   setLoading(false);\n  }')],
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
