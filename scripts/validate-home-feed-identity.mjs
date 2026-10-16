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
const federationWorker = read('supabase/functions/federation-inbound-worker/index.ts');
const federatedFeed = read('supabase/functions/federated-feed/index.ts');
const supabaseConfig = read('supabase/config.toml');
const visibilityRepair = read('supabase/migrations/20261016101000_federated_public_timeline_visibility_repair.sql');
const videoPlayer = read('src/components/features/UniversalVideoPlayer.tsx');
const postCard = read('src/components/features/PostCard.tsx');

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
requireText(search, /function normalizeSearchHashtag[\s\S]*encodeURIComponent\(tag\)[\s\S]*function GlobalSearchResults/,
  'Search hashtag links must normalize optional # prefixes and URL-encode the canonical tag.');
requireText(search, /api\.searchUnified\(clean[\s\S]*searchFederatedDiscovery/,
  'Unified search must query the canonical discovery capability and federated discovery.');
requireText(search, /liveHashtags[\s\S]*liveUsers/,
  'Unified search must merge live federated hashtag and account results.');
requireText(richText, /const routeHashtag[\s\S]*navigate\('\/hashtag\/'[\s\S]*const routeMention[\s\S]*navigate\('\/fediverse\/profile\?/,
  'Fediverse rich text must route hashtags and remote mentions into canonical Testagram surfaces.');


requireText(federationWorker, /function normalizeTimelineVisibility\(value:any\)[\s\S]*visibility:normalizeTimelineVisibility\(s\.visibility\)/,
  'Public timeline ingestion must persist the upstream visibility instead of falling back to the database direct-only default.');
requireText(visibilityRepair, /instance_id is not null[\s\S]*raw_object->>'visibility'[\s\S]*visibility is distinct from/,
  'Visibility repair must backfill only explicitly visible upstream status values and must not infer public visibility from missing metadata.');
requireText(supabaseConfig, /\[functions\.federated-feed\]\s*verify_jwt = false/,
  'Public homepage federation must be callable anonymously; the handler still validates optional user JWTs before private personalization.');
if (/24 \\* 60 \\* 60 \\* 1000/.test(federatedFeed)) failures.push('Fediverse infinite scrolling must paginate the stored public history rather than stopping at a 24-hour window.');
requireText(federatedFeed, /decodeFeedCursor[\s\S]*suggestedItems\.length > limit[\s\S]*publishedAt: oldest\.published_at/,
  'Public Fediverse pagination must retain a stable keyset cursor and continue when anonymous discovery has more pages.');
requireText(federatedFeed, /\.in\("visibility", \["public", "unlisted"\]\)/,
  'Federated home discovery must continue to exclude followers-only and direct messages.');
requireText(videoPlayer, /loader: VirtualCdnLoader as any/,
  'HLS video playback must use the Virtual CDN fragment loader.');
requireText(postCard, /typedVideoAttachment[\s\S]*mediaType[\s\S]*video\//,
  'Fediverse videos must be recognized by attachment MIME metadata even when media URLs have no file extension.');
requireText(postCard, /<UniversalVideoPlayer[\s\S]*active=\{videoInView && !showVideoAd\}[\s\S]*muted[\s\S]*preload=\{videoNearView \? 'auto' : 'metadata'\}/,
  'Home feed video cards must autoplay muted only when visible and preload nearby media.');
requireText(home, /FederatedHashtagDiscovery surface="home"/,
  'The infinite home surface must retain hashtag discovery alongside posts.');
requireText(home, /i===5[\s\S]*<TrendingVideosSection variant="compact" \/>[\s\S]*<SyndicatedNewsRail \/>[\s\S]*<CommunitySpotlightStrip \/>/,
  'After the first six feed entries, Home must lazily interleave video discovery, syndicated news, and public communities without blocking the first posts.');
requireText(home, /<FeedAdCard/,
  'The infinite home surface must retain native-style in-feed ads alongside posts and TV content.');

if (failures.length) {
  console.error('Home-feed/ecosystem contract failed:\n- ' + failures.join('\n- '));
  process.exitCode = 1;
} else {
  console.log('Home-feed/ecosystem contract passed: server blend, page pagination, offline cache, unified search and Fediverse navigation share their expected contracts.');
}
