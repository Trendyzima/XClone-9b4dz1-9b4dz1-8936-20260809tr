import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(root, 'src/App.tsx'), 'utf8');
const flutter = fs.readFileSync(path.join(root, 'mobile/lib/app/testagram_app.dart'), 'utf8');
const declarations = [...source.matchAll(/<Route\b[^>]*\bpath\s*=\s*["']([^"']+)["'][^>]*>/g)].map((match) => match[1]);
const unique = [...new Set(declarations)].sort();
const native = new Set([...flutter.matchAll(/\bpath:\s*'([^']+)'/g)].map((match) => match[1]));
const nativeShells = new Set();
const routeMatches = [...flutter.matchAll(/GoRoute\(\s*path:\s*'([^']+)'/g)];
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
const routeNotes = {
  '/appeals': "Dedicated Flutter appeal workflow reads only the signed-in user's appeal history and uses server-side RPCs for submission and owner-only review. Review decisions, restriction lifting, inbox response, and audit logging are atomic on the backend; Web/Android acceptance and live RLS/RPC smoke tests remain required.",
  '/regulator/reports': 'Dedicated owner-only Flutter platform report queue reads post_reports through testagram_list_platform_reports and resolves/dismisses through a server-authorized, audited RPC; no direct client moderation mutations. Web/Android acceptance and live backend smoke tests remain required.',

  '/platform-inbox': 'Dedicated Flutter Wise Brain inbox uses the authenticated platform_inbox table and generate_platform_inbox_digest RPC, with pagination, filters, read/delete actions and internal-route CTA validation. Full web/Android and backend acceptance remains required.',
  '/admin/staff-recruitment': 'Dedicated Flutter owner-only recruitment console uses testagram_is_owner, testagram_list_job_applications, testagram_review_job_application, and testagram_invite_admin RPCs. Invitation is shown only for accepted applications; privileged session and all authorization remain server-enforced. Full Web/Android acceptance remains required.',
  '/admin/seo': 'Dedicated Flutter owner-only SEO audit mirrors the checked-in SEO coverage manifest and probes the live community-sitemap endpoint. The declared route score is explicitly not a live HTML crawl; full Web/Android acceptance remains required.',
  '/admin/ads-review': 'Dedicated Flutter ad review queue uses the secure testagram_admin_list_ad_review_queue and testagram_admin_review_ad_campaign RPCs, platform.ads authorization, MFA/AAL2 enforcement, audit logging, and advertiser inbox notices. Approval never bypasses verified campaign funding. Full Web/Android acceptance remains required.',
  '/sports': 'Dedicated Flutter Sports Hub calls the existing testagram-sports Edge Function for provider-backed scores and testagram-rss-feed for publisher-attributed headlines; includes sport/match/country filters, refresh, stale-data retention, URL validation, and policy tests. Live provider/network behavior and Web/Android acceptance remain required.',
  '/shop': 'Dedicated native Flutter Testagram Mall uses the safe marketplace_public_products projection, horizontal category/promotion/deal/trending shelves with a vertical product catalog, persistent local cart, wishlist, wallet display, and the existing atomic server-side place_marketplace_order RPC. Web/Android UI journeys and live database migration/RPC acceptance remain required.',
  '/search': 'Dedicated Flutter unified search calls public.testagram_search_unified with the signed-in session and supports people, posts, hashtags, threads, communities, replies, and Fediverse results. It refreshes expired sessions once, ignores stale responses, normalizes partial payloads, and displays actionable failure states. Contract and policy tests exist; live RPC/RLS and Web/Android journey acceptance remain required.'
};
const routes = unique.filter((pathname) => pathname !== '*').map((pathname) => {
  const isNative = [...native].some((pattern) => matchesRoute(pattern, pathname));
  const isShell = [...nativeShells].some((pattern) => matchesRoute(pattern, pathname));
  return {
    path: pathname,
    domain: routeDomain(pathname),
    status: isShell ? 'native_shell' : isNative ? 'native_partial' : 'legacy_web_fallback',
    note: routeNotes[pathname] ?? (isShell
      ? 'A native Flutter migration surface is registered. The dedicated feature workflow, backend integration, permissions, failure recovery, and web/Android tests remain unaccepted.'
      : isNative
        ? 'An explicit Flutter route exists. Feature-level, backend, permission, failure-recovery, web and Android parity still require acceptance.'
        : 'No exact Flutter route is registered; the Flutter router currently uses the legacy website fallback. This route is not migrated.')
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
