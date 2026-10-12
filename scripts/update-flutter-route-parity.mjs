import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(root, 'src/App.tsx'), 'utf8');
const flutter = fs.readFileSync(path.join(root, 'mobile/lib/app/testagram_app.dart'), 'utf8');
const declarations = [...source.matchAll(/<Route\b[^>]*\bpath\s*=\s*["']([^"']+)["'][^>]*>/g)].map((match) => match[1]);
const unique = [...new Set(declarations)].sort();
const native = new Set([...flutter.matchAll(/\\bpath:\\s*'([^']+)'/g)].map((match) => match[1]));
const nativeShells = new Set();
const routeMatches = [...flutter.matchAll(/GoRoute\\(\\s*path:\\s*'([^']+)'/g)];
for (let index = 0; index < routeMatches.length; index += 1) {
  const start = routeMatches[index].index;
  const next = routeMatches[index + 1]?.index ?? flutter.length;
  if (flutter.slice(start, next).includes('NativeFeaturePage(')) {
    nativeShells.add(routeMatches[index][1]);
  }
}
const matchesRoute = (pattern, sourceRoute) => {
  const patternParts = pattern.split('/');
  const sourceParts = sourceRoute.split('/');
  return patternParts.length === sourceParts.length &&
    patternParts.every((part, index) => part.startsWith(':') || part === sourceParts[index]);
};
const routeDomain = (p) => {
  if (/^\/(auth|verify|profile\/complete|verify-identity)/.test(p)) return 'authentication';
  if (/^\/(messages|call\/|team-chat|platform-inbox)/.test(p)) return 'messaging';
  if (/^\/(tv|iptv|stream\/|start-stream|channel\/)/.test(p)) return 'tv_and_live';
  if (/^\/(create-ad|my-ads|ad-|admin\/ads|boost-|revenue-analytics|payouts|monetization)/.test(p)) return 'advertising';
  if (/^\/(wallet|products|marketplace|shop|p\/|orders|wishlist|seller\/|credits|rewards|referral|referrals)/.test(p)) return 'commerce';
  if (/^\/fediverse/.test(p)) return 'fediverse';
  if (/^\/(communities|c\/|spaces|space-recording\/|space\/)/.test(p)) return 'communities';
  if (/^\/(creator-studio|podcasts|series|leaderboard|daily-rewards)/.test(p)) return 'creator';
  if (/^\/(admin|regulator|staff|appeals|fraud-detection)/.test(p)) return 'administration';
  if (/^\/(settings|notification-preferences|privacy|terms|policy|sessions|blocked|help)/.test(p)) return 'settings';
  if (/^\/(videos|shorts|history|story-analytics)/.test(p)) return 'media';
  if (/^\/(explore|discover|search|hashtag|hashtags|trending|sports|news)/.test(p)) return 'discovery';
  if (/^\/(post|post-remote|thread|threads|profile|bookmarks|lists|polls)/.test(p)) return 'social';
  return 'general';
};
if (declarations.length < 100 || unique.length < 100 || native.size < 1) {
  throw new Error('Route extraction looks incomplete: ' + declarations.length + ' declarations, ' + unique.length + ' unique source routes, ' + native.size + ' Flutter routes.');
}
const routes = unique.filter((pathname) => pathname !== '*').map((pathname) => {
  const isNative = [...native].some((pattern) => matchesRoute(pattern, pathname));
  const isShell = [...nativeShells].some((pattern) => matchesRoute(pattern, pathname));
  return {
    path: pathname,
    domain: routeDomain(pathname),
    status: isShell ? 'native_shell' : isNative ? 'native_partial' : 'legacy_web_fallback',
    note: isShell
      ? 'A native Flutter migration surface is registered. The dedicated feature workflow, backend integration, permissions, failure recovery, and web/Android tests remain unaccepted.'
      : isNative
        ? 'An explicit Flutter route exists. Feature-level, backend, permission, failure-recovery, web and Android parity still require acceptance.'
        : 'No exact Flutter route is registered; the Flutter router currently uses the legacy website fallback. This route is not migrated.'
  };
});
const inventory = {
  schema_version: 2,
  source_of_truth: 'React Router declarations in src/App.tsx compared with explicit GoRouter path declarations in mobile/lib/app/testagram_app.dart. A native route is not proof of feature parity.',
  source_route_declarations: declarations.length,
  unique_source_routes: unique.length,
  flutter_native_routes: [...native].sort(),
  counts: {
    unique_source_routes_including_wildcard: unique.length,
    source_routes_excluding_wildcard: routes.length,
    native_route_matches: routes.filter((route) => route.status === 'native_partial').length,
    native_shell_routes: routes.filter((route) => route.status === 'native_shell').length,
    legacy_web_fallbacks: routes.filter((route) => route.status === 'legacy_web_fallback').length
  },
  routes
};
fs.writeFileSync(path.join(root, 'docs/flutter-route-parity.json'), JSON.stringify(inventory, null, 2) + '\n');
console.log('Updated Flutter route parity: ' + declarations.length + ' declarations, ' + unique.length + ' unique source routes, ' + native.size + ' explicit Flutter routes, ' + inventory.counts.legacy_web_fallbacks + ' source routes still falling back to legacy web.');
