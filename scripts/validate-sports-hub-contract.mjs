import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const app = read('mobile/lib/app/testagram_app.dart');
const page = read('mobile/lib/features/discovery/sports_hub_page.dart');
const policy = read('mobile/lib/features/discovery/sports_hub_policy.dart');
const tests = read('mobile/test/features/discovery/sports_hub_policy_test.dart');
const sportsEdge = read('supabase/functions/testagram-sports/index.ts');
const rssEdge = read('supabase/functions/testagram-rss-feed/index.ts');
const routeGenerator = read('scripts/update-flutter-route-parity.mjs');
const failures = [];
const requireText = (source, pattern, label) => {
  if (!pattern.test(source)) failures.push(label);
};

requireText(app, /path:\s*'\/sports'[\s\S]{0,120}SportsHubPage\(\)/, 'The /sports GoRoute must render SportsHubPage directly.');
requireText(page, /invoke\([\s\S]{0,100}'testagram-sports'[\s\S]{0,400}'kind':\s*'matches'[\s\S]{0,100}'sport':\s*_sport/, 'Flutter scores request must call testagram-sports with kind and selected sport.');
requireText(page, /invoke\([\s\S]{0,100}'testagram-rss-feed'[\s\S]{0,300}'category':\s*'sports'/, 'Flutter headlines request must call testagram-rss-feed with the sports category.');
requireText(sportsEdge, /req\.method\s*!==\s*"GET"/, 'Sports Edge Function must accept GET requests.');
requireText(sportsEdge, /ALLOWED_SPORTS\s*=\s*new Set\(\["football",\s*"basketball",\s*"cricket",\s*"tennis"\]\)/, 'Flutter sport choices must match the server allowlist.');
requireText(sportsEdge, /kind === "matches"[\s\S]{0,160}kind === "standings"[\s\S]{0,100}kind === "topscorers"/, 'Sports Edge Function must preserve supported provider resource kinds.');
requireText(rssEdge, /query\.eq\("category",category\)/, 'RSS Edge Function must filter publisher items by category.');
requireText(rssEdge, /return Response\.json\(\{items,count:items\.length\}/, 'RSS Edge Function must return the items list consumed by Flutter.');
requireText(policy, /safeArticleUri[\s\S]{0,350}userInfo\.isNotEmpty/, 'Publisher URLs must reject embedded credentials.');
requireText(tests, /flattens direct match lists[\s\S]*flattens league-nested match payloads[\s\S]*safe absolute HTTP article URLs/s, 'Sports Hub policy tests must cover response normalization and article URL safety.');
requireText(routeGenerator, /'\/sports': 'Dedicated Flutter Sports Hub calls the existing testagram-sports Edge Function/, 'Route inventory must document the dedicated Sports Hub and its acceptance caveat.');

if (failures.length) {
  console.error('Sports Hub contract validation failed:\n- ' + failures.join('\n- '));
  process.exitCode = 1;
} else {
  console.log('Sports Hub contract passed: native route, scores/news Edge Function contracts, provider allowlist, URL safety, and policy tests are aligned.');
}
