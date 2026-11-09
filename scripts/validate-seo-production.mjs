import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const checks = [
  ['Root sitemap is a static XML URL set served by the client deployment', () => {
    const sitemap = read('public/sitemap.xml');
    return sitemap.includes('<urlset') &&
      sitemap.includes('https://testagram.site/</loc>') &&
      !sitemap.includes('<sitemapindex') &&
      !sitemap.includes('/api/');
  }],
  ['Robots exposes exactly one sitemap and does not block public client routes', () => {
    const robots = read('public/robots.txt');
    return (robots.match(/^Sitemap:/gm) || []).length === 1 &&
      robots.includes('Sitemap: https://testagram.site/sitemap.xml') &&
      robots.includes('Allow: /tv') &&
      robots.includes('Allow: /iptv') &&
      !robots.includes('Disallow: /auth');
  }],
  ['Static sitemap includes the public TV, IPTV and news surfaces', () => {
    const sitemap = read('public/sitemap.xml');
    return ['/tv', '/tv/channels', '/tv/reels', '/iptv', '/news'].every(
      (route) => sitemap.includes('https://testagram.site' + route + '</loc>'),
    );
  }],
  ['SEO prerender contains only static client routes with explicit index policy', () => {
    const prerender = read('scripts/prerender-seo-routes.mjs');
    return ['/tv', '/tv/channels', '/tv/reels', '/auth', '/c/null'].every(
      (route) => prerender.includes("path: '" + route + "'"),
    ) && prerender.includes('indexable: true') && prerender.includes('indexable: false');
  }],
  ['Production build runs provider-independent static SEO prerendering', () => {
    const build = read('_build.cjs');
    return build.includes("scripts', 'prerender-seo-routes.mjs") &&
      build.includes('runStaticSeoPrerender();');
  }],
  ['Public TV routes are client routes protected by the TV error boundary', () => {
    const app = read('src/App.tsx');
    return ['/tv', '/tv/channels', '/tv/reels'].every((route) =>
      app.includes('path="' + route + '" element={<TvPageErrorBoundary><TvChannelsPage/></TvPageErrorBoundary>}'),
    ) && read('src/pages/TvChannelsPage.tsx').includes('useSEO({');
  }],
  ['Sitemap and prerender source contain no Cloudflare Worker or server-function dependency', () => {
    const sitemap = read('public/sitemap.xml');
    const prerender = read('scripts/prerender-seo-routes.mjs');
    return !sitemap.includes('cloudflare') &&
      !prerender.includes('cloudflare/index.ts') &&
      !prerender.includes('/functions/v1/');
  }],
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
console.log(`Client SEO validation: ${checks.length - failed}/${checks.length} passed`);
if (failed) process.exit(1);
