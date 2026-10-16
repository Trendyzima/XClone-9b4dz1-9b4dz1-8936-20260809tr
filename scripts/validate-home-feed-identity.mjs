import fs from 'node:fs';
import path from 'node:path';

const read = (file) => fs.readFileSync(path.resolve(process.cwd(), file), 'utf8');
const failures = [];
const requireText = (source, pattern, message) => {
  if (!pattern.test(source)) failures.push(message);
};

const cache = read('src/lib/homeFeedCache.ts');
const home = read('src/pages/HomeHubPage.tsx');
const aggregator = read('api/home-feed.ts');
const search = read('src/pages/SearchPageV3.tsx');
const richText = read('src/components/features/FediverseRichText.tsx');

requireText(cache, /export function homeFeedItemIdentity\(item:any\):string[\s\S]*data\.remote_status_uri[\s\S]*data\.uri[\s\S]*url\.hostname=url\.hostname\.toLowerCase\(\)/,
  'Home cache must expose canonical URI-based identity for local and federated content.');
requireText(cache, /type==='post'\|\|item\?\.type==='fedpost'\?'content'/,
  'A local post and its Fediverse representation must share an ID fallback identity.');
requireText(cache, /const key=homeFeedItemIdentity\(item\)/,
  'Offline-cache merging must use the canonical feed identity helper.');
requireText(home, /homeFeedItemIdentity, HOME_FEED_CACHE_LIMIT/,
  'HomeHub must use the same identity helper as the offline cache.');
requireText(home, /new Set\(existing\.map\(homeFeedItemIdentity\)\.filter\(Boolean\)\)/,
  'HomeHub page append must seed its deduplication set from canonical identities.');
requireText(home, /previous\.map\(homeFeedItemIdentity\)\.filter\(Boolean\)/,
  'Background refresh must compare incoming content against canonical identities.');
requireText(home, /setItems\(prev=>appendUniqueFeedItems\(fresh,prev\)\)/,
  'Background refresh must preserve existing items while deduplicating newly discovered content.');
requireText(aggregator, /function sourceKey\(item: any\)[\s\S]*data\.remote_status_uri[\s\S]*data\.uri[\s\S]*url\.hostname = url\.hostname\.toLowerCase\(\)/,
  'Server-side aggregation must canonicalize object URIs before blending source lanes.');
requireText(aggregator, /item\?\.type === 'post' \|\| item\?\.type === 'fedpost' \? 'content'/,
  'Server-side aggregation must collapse local/Fediverse wrappers with the same fallback ID.');
requireText(search, /function normalizeSearchHashtag[\s\S]*encodeURIComponent\(tag\)[\s\S]*function GlobalSearchResults/,\n  'Search hashtag links must normalize optional # prefixes and URL-encode the canonical tag.');\nrequireText(search, /api\.searchUnified\(clean[\s\S]*searchFederatedDiscovery/,
  'Unified search must query the canonical discovery capability and federated discovery.');
requireText(search, /liveHashtags[\s\S]*liveUsers/,
  'Unified search must merge live federated hashtag and account results.');
requireText(richText, /const routeHashtag[\s\S]*navigate\('\/hashtag\/'[\s\S]*const routeMention[\s\S]*navigate\('\/fediverse\/profile\?/,
  'Fediverse rich text must route hashtags and remote mentions into canonical Testagram surfaces.');

if (failures.length) {
  console.error('Home-feed/ecosystem contract failed:\n- ' + failures.join('\n- '));
  process.exitCode = 1;
} else {
  console.log('Home-feed/ecosystem contract passed: server blend, page pagination, offline cache, unified search and Fediverse navigation share their expected contracts.');
}
