import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(root, 'src/App.tsx'), 'utf8');
const flutter = fs.readFileSync(path.join(root, 'mobile/lib/app/testagram_app.dart'), 'utf8');
const routePattern = /<Route\s+path=["']([^"']+)["']/g;
const routes = [...source.matchAll(routePattern)].map(m => m[1]);
const unique = [...new Set(routes)].sort();
const native = new Set([...flutter.matchAll(/GoRoute\s*\(\s*path:\s*'([^']+)'/g)].map(m => m[1]));
const exactAliases = new Map([['/home', '/'], ['/tv/channels', '/tv'], ['/tv/reels', '/tv']]);
const matchesRoute = (pattern, actual) => { const p = pattern.split('/'); const a = actual.split('/'); return p.length === a.length && p.every((part, i) => part.startsWith(':') || part === a[i]); };
const routeDomain = p => p.startsWith('/admin') || p.startsWith('/regulator') || p.startsWith('/staff') ? 'administration'
  : p.startsWith('/creator-studio') || p.startsWith('/monetization') || p.startsWith('/payouts') || p.startsWith('/revenue') ? 'creator_and_monetization'
  : p.startsWith('/tv') || p.startsWith('/iptv') || p.startsWith('/channel') || p.startsWith('/stream') || p.startsWith('/start-stream') ? 'tv_and_live'
  : p.startsWith('/fediverse') ? 'fediverse'
  : p.startsWith('/c/') || p === '/communities' ? 'communities'
  : p.startsWith('/thread') || p.startsWith('/threads') ? 'threads'
  : p.startsWith('/wallet') || p === '/orders' || p.startsWith('/p/') || p === '/products' || p === '/marketplace' || p === '/shop' ? 'commerce'
  : p.startsWith('/profile') ? 'profiles'
  : p.startsWith('/settings') || p === '/privacy' || p === '/terms' || p === '/sessions' ? 'settings_and_legal'
  : p.startsWith('/news') ? 'news'
  : p.startsWith('/hashtag') || p === '/hashtags' || p.startsWith('/trending') ? 'hashtags_and_trends'
  : p.startsWith('/space') ? 'spaces'
  : p === '/videos' || p === '/shorts' || p.startsWith('/videos/') ? 'videos'
  : p === '/auth' || p === '/verify' || p === '/verify-identity' ? 'authentication'
  : 'general';
const inventory = {
  schema_version: 1,
  generated_at: new Date().toISOString(),
  source_of_truth: 'React Router declarations in src/App.tsx; route coverage does not imply feature parity.',
  source_route_declarations: routes.length,
  unique_source_routes: unique.length,
  flutter_native_routes: [...native].sort(),
  routes: unique.map(pathname => {
    const target = exactAliases.get(pathname) ?? pathname;
    const isNative = native.has(target) || [...native].some(pattern => matchesRoute(pattern, target));
    return { path: pathname, domain: routeDomain(pathname), status: isNative ? 'native_partial' : 'legacy_web_fallback', note: isNative ? 'Flutter route exists; backend, interactions, visual parity, and Android/web acceptance remain individually gated.' : 'No equivalent Flutter route is registered; GoRouter currently falls back to the original website. This is not migrated.' };
  }),
};
fs.writeFileSync(path.join(root, 'docs/flutter-route-parity.json'), `${JSON.stringify(inventory, null, 2)}\n`);
const counts = inventory.routes.reduce((acc, r) => (acc[r.status] = (acc[r.status] ?? 0) + 1, acc), {});
console.log(`Wrote ${unique.length} unique React routes (${routes.length} declarations): ${JSON.stringify(counts)}`);
