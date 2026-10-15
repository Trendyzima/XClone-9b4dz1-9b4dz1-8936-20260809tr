import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const checks = [
  ['supabase/functions/federation-transport/index.ts', /body\.operation === "collection"[\s\S]*\["followers", "following", "featured", "likes"\]\.includes\(kind\)[\s\S]*assertSafeRemoteUrl\(pageUrl\)[\s\S]*Relationship pagination must remain on the collection's instance/, 'Remote follower/following collections must be bounded and reject unsafe cross-origin cursors.'],
  ['supabase/functions/federation-transport/index.ts', /next_cursor: next[\s\S]*followers_count:[\s\S]*following_count:[\s\S]*posts_count:/, 'Remote profile collection responses must include pagination and available actor counts.'],
  ['supabase/functions/testagram-api/index.ts', /path===['"]\/federated-collection['"]&&method===['"]GET['"][\s\S]*Authentication required[\s\S]*operation:['"]collection['"]/, 'The public API gateway must authenticate collection requests before calling signed federation transport.'],
  ['src/api/federation.ts', /getRemoteProfile\(actorUri: string, limit = 60, cursor\?[\s\S]*getRemoteCollection[\s\S]*next_cursor/, 'The web API client must expose cursor-based relationship and profile timeline pagination.'],
  ['src/pages/FediverseProfilePage.tsx', /getRemoteCollection[\s\S]*relationshipRows\.map[\s\S]*Load more \{activeTab\.toLowerCase\(\)\}/, 'Web profiles must render follower/following accounts and paginate them in-app.'],
  ['src/pages/FediverseProfilePage.tsx', /displayCount\(profile\.followers\)[\s\S]*displayCount\(profile\.following\)[\s\S]*profile\.also_known_as[\s\S]*profile\.emojis/, 'Web profile metadata must show counts as unavailable rather than inventing zero and include actor aliases/emojis.'],
  ['mobile/lib/features/fediverse/fediverse_page.dart', /federated-collection[\s\S]*_relationshipCursor[\s\S]*_loadMoreRemoteRelationships/, 'Flutter profile routes must load and paginate remote relationship collections.'],
  ['mobile/lib/features/fediverse/fediverse_page.dart', /_remoteProfile[\s\S]*followers_count[\s\S]*following_count[\s\S]*also_known_as/, 'Flutter profiles must preserve ActivityPub actor metadata and reported counts.'],
  ['mobile/lib/app/testagram_app.dart', /path: '\/fediverse\/profile\/followers',[\s\S]*queryParameters\['actor'\][\s\S]*path: '\/fediverse\/profile\/following',[\s\S]*queryParameters\['actor'\]/, 'Flutter followers/following routes must retain the selected remote actor identity.'],
  ['mobile/lib/features/fediverse/fediverse_page.dart', /\('Tips', 'tips'\)[\s\S]*\('Gifts', 'gifts'\)[\s\S]*\('Analytics', 'profile-analytics'\)/, 'Flutter profile tabs must match native web profile sections.'],
  ['mobile/lib/features/fediverse/fediverse_page.dart', /Testagram-native features[\s\S]*Public posts loaded/, 'Flutter profiles must explain native-only tips/gifts and provide profile analytics.'],
  ['mobile/lib/app/testagram_app.dart', /path: '\/fediverse\/profile\/tips'[\s\S]*queryParameters\['actor'\][\s\S]*path: '\/fediverse\/profile\/gifts'[\s\S]*queryParameters\['actor'\][\s\S]*path: '\/fediverse\/profile\/analytics'[\s\S]*queryParameters\['actor'\]/, 'Flutter tips, gifts, and analytics profile routes must preserve the selected actor identity.'],
];
let failures = 0;
for (const [path, pattern, message] of checks) {
  if (pattern.test(read(path))) console.log(`PASS ${message}`);
  else { failures++; console.error(`FAIL ${message}`); }
}
if (failures) process.exitCode = 1;
else console.log(`Fediverse profile contract: ${checks.length}/${checks.length} passed`);
