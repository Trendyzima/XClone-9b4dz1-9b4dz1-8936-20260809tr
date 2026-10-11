import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'docs', 'flutter-parity-inventory.json');
const roots = ['src', 'api', 'supabase/functions', 'supabase/migrations', 'android/app/src/main', 'android/scripts'];
const existing = fs.existsSync(output) ? JSON.parse(fs.readFileSync(output, 'utf8')) : { sources: {} };
const sources = { ...(existing.sources ?? {}) };

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(absolute);
    const relative = path.relative(root, absolute).split(path.sep).join('/');
    const sourceFile = /\.(tsx?|jsx?)$/.test(entry.name) && !/\.(test|spec)\./.test(entry.name);
    const migrationFile = relative.startsWith('supabase/migrations/') && entry.name.endsWith('.sql');
    const nativeReference = relative.startsWith('android/app/src/main/') && /\.(java|kt|xml|gradle|kts|json)$/.test(entry.name);
    const nativeScript = relative.startsWith('android/scripts/') && /\.(py|sh)$/.test(entry.name);
    if (!sourceFile && !migrationFile && !nativeReference && !nativeScript) return [];
    return [relative];
  });
}

for (const file of roots.flatMap(walk).sort()) {
  const sourceType = file.startsWith('src/') ? 'client_source' : file.startsWith('android/') ? 'legacy_android_reference' : 'backend_contract_reference';
  sources[file] ??= {
    source_type: sourceType,
    status: sourceType === 'client_source' ? 'not_started' : 'reference_only',
    note: sourceType === 'client_source'
      ? 'Port and verify behavior against the existing web implementation before retiring it.'
      : 'Keep this existing platform/backend contract; verify Flutter uses it correctly rather than migrating server or legacy shell code into Dart.',
  };
  sources[file].source_type ??= sourceType;
  if (sourceType !== 'client_source' && sources[file].status === 'not_started') sources[file].status = 'reference_only';
}

const foundation = {
  'src/pages/AuthPage.tsx': ['foundation', 'Native email/password sign-in and legal acceptance flow are started; full auth parity still required.'],
  'src/pages/HomePage.tsx': ['foundation', 'Native feed shell is started; full feed ranking, ads, replies, reposts and moderation parity still required.'],
  'src/pages/ExplorePage.tsx': ['foundation', 'Native profile/post search and follow toggle are started; discovery parity still required.'],
  'src/pages/NotificationsPage.tsx': ['foundation', 'Native notification list/read actions are started; capability API, push and category parity still required.'],
  'src/components/features/ComposePost.tsx': ['foundation', 'Flutter feed supports text/photo/video compose and Supabase Storage upload; edit flows, full media parity and backend contract tests remain.'],
  'src/pages/MessagesPage.tsx': ['blocked_on_capability_port', 'Encrypted messaging must use the existing capability plane; never write plaintext directly to messages.'],
  'src/pages/CreatorStudio.tsx': ['not_started', 'Creator studio, upload pipeline, analytics and monetization require screen-by-screen parity.'],
  'src/pages/TvStudioPage.tsx': ['not_started', 'TV production, channel management and broadcast controls require parity tests.'],
};
for (const [file, [status, note]] of Object.entries(foundation)) {
  if (sources[file]) sources[file] = { ...sources[file], status, note };
}

const domains = [
  ['authentication_and_legal', 'Login, signup/verified identity, OTP, password recovery, age/legal acceptance, session refresh, 24-hour session policy, sign-out'],
  ['social_feed', 'Feed ranking, infinite pagination, cache, refresh, posts, compose/edit/delete, media, comments/replies, reactions, reposts/quotes, bookmarks, share, report'],
  ['profiles_and_graph', 'Profile display/edit, avatars/covers, follow/unfollow, followers/following, lists, blocks, mutes, verification and profile tabs'],
  ['search_and_discovery', 'Global search, people/posts/hashtags, trends, recommendations, discover, publisher/RSS content'],
  ['stories_and_shorts', 'Stories, story views, vertical video feed, player lifecycle, preloading, captions, reporting, creator reels'],
  ['iptv_and_tv_production', 'TV channels, stream resolution, HLS playback, vertical TV feed, studio, live broadcast, channel profiles, TV admin/production interface'],
  ['advertising_and_monetization', 'Internal ad campaigns, external ad provider adapters, ExoClick/VAST, sponsored labels, pacing, frequency caps, analytics, creator earnings, payout flows'],
  ['messaging_and_calls', 'E2EE key lifecycle, conversations, encrypted send/receive, read receipts, typing, presence, attachments, voice notes, audio/video calls, incoming-call lifecycle'],
  ['notifications', 'In-app notifications, unread state, preferences, Firebase Cloud Messaging, foreground/background/tap routing, token rotation'],
  ['camera_microphone_media', 'Camera, microphone, gallery/file picker, permission denial/recovery, upload progress/retry, media codecs, storage/CDN URLs'],
  ['communities_and_live_spaces', 'Communities, memberships, community moderation, live audio spaces, speakers/listeners, recording, events'],
  ['fediverse', 'Federated identities, timelines, inbox, relays, follows, media, profiles, analytics and federation safety'],
  ['commerce_and_wallet', 'Products, marketplace, orders, wishlist, M-Pesa, payments, wallet, ledger, rewards, referrals, savings and transfers'],
  ['creator_tools', 'Creator studio, scheduled posts, series, podcasts, analytics, monetization, leaderboards and rewards'],
  ['administration_and_safety', 'Owner/admin routes, governance, moderation, reports, appeals, bans, identity verification, audit and fraud detection'],
  ['settings_and_privacy', 'Account privacy, active sessions, security, blocked users, notification preferences, legal and accessibility settings'],
  ['ads_engine', 'Sponsored placements, external provider compliance, web script boundaries, native SDK support, ad event deduplication and no layout distortion'],
  ['offline_and_performance', 'Offline cache, stale data, retry/backoff, image/video cache, pagination, lazy loading, memory pressure and lifecycle cleanup'],
  ['web_and_seo', 'Flutter Web routes/deep links, metadata, sitemap/canonical URLs, robots, crawlable public pages, PWA, cache headers and 404 behavior'],
  ['native_android', 'Deep links, back navigation, system insets, secure storage, FCM, media permissions, app lifecycle, signed release identity and rollback'],
  ['accessibility_and_localization', 'Screen readers, semantics, keyboard/TV focus, contrast, reduced motion, dynamic text, locale/date/number formatting'],
  ['observability_and_release', 'Crash/error telemetry, structured logs, feature flags, CI gates, real-device matrix, canary rollout, rollback and release evidence'],
];
const previousDomains = new Map((existing.domains ?? []).map((domain) => [domain.id, domain]));
const initialProgress = new Map([
  ['social_feed', 'in_progress'],
  ['iptv_and_tv_production', 'in_progress'],
  ['camera_microphone_media', 'in_progress'],
]);
const inventory = {
  schema_version: 1,
  generated_at: new Date().toISOString(),
  rule: 'A feature is not complete until its Flutter web and Android behavior, backend contract, permissions, failure recovery, and tests are verified. Existing web routes remain available until parity is accepted.',
  domains: domains.map(([id, scope]) => ({
    id,
    scope,
    status: previousDomains.get(id)?.status ?? initialProgress.get(id) ?? 'not_started',
    acceptance: previousDomains.get(id)?.acceptance ?? ['positive path', 'unauthenticated/permission path', 'offline/timeout recovery', 'accessibility and responsive layout', 'web and Android tests'],
  })),
  sources,
};
fs.writeFileSync(output, `${JSON.stringify(inventory, null, 2)}\n`);
console.log(`Wrote ${Object.keys(sources).length} source entries and ${domains.length} product domains to ${path.relative(root, output)}`);
