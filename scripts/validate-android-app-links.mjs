import fs from 'node:fs';
import path from 'node:path';

const read = (file) => fs.readFileSync(path.resolve(file), 'utf8');
const manifest = read('mobile/android/app/src/main/AndroidManifest.xml');
const gradle = read('mobile/android/app/build.gradle.kts');
const assetLinks = JSON.parse(read('public/.well-known/assetlinks.json'));
const router = read('mobile/lib/app/testagram_app.dart');

const requiredLinks = [
  { prefix: '/', route: "path: '/'" },
  { prefix: '/auth', route: "path: '/auth'" },
  { prefix: '/profile/', route: "path: '/profile/:username'" },
  { prefix: '/post/', route: "path: '/post/:postId'" },
  { prefix: '/post-remote', route: "path: '/post-remote'" },
  { prefix: '/thread/', route: "path: '/thread/:id'" },
  { prefix: '/threads', route: "path: '/threads'" },
  { prefix: '/hashtag/', route: "path: '/hashtag/:tag'" },
  { prefix: '/hashtags', route: "path: '/hashtags'" },
  { prefix: '/videos', route: "path: '/videos'" },
  { prefix: '/shorts', route: "path: '/shorts'" },
  { prefix: '/c/', route: "path: '/c/:name'" },
  { prefix: '/p/', route: "path: '/p/:productId'" },
  { prefix: '/channel/', route: "path: '/channel/:handle'" },
  { prefix: '/stream/', route: "path: '/stream/:streamId'" },
  { prefix: '/spaces', route: "path: '/spaces'" },
  { prefix: '/space/', route: "path: '/space/:id'" },
  { prefix: '/space-recording/', route: "path: '/space-recording/:id'" },
  { prefix: '/news', route: "path: '/news'" },
  { prefix: '/fediverse', route: "path: '/fediverse'" },
  { prefix: '/search', route: "path: '/search'" },
  { prefix: '/explore', route: "path: '/explore'" },
  { prefix: '/discover', route: "path: '/discover'" },
  { prefix: '/tv', route: "path: '/tv'" },
  { prefix: '/iptv', route: "path: '/iptv'" },
  { prefix: '/sports', route: "path: '/sports'" },
  { prefix: '/shop', route: "path: '/shop'" },
  { prefix: '/marketplace', route: "path: '/marketplace'" },
  { prefix: '/products', route: "path: '/products'" },
];

const failures = [];
const declaredPrefixes = new Set(
  [...manifest.matchAll(/android:pathPrefix="([^"]+)"/g)].map((match) => match[1]),
);
const declaredPaths = new Set(
  [...manifest.matchAll(/android:path="([^"]+)"/g)].map((match) => match[1]),
);
if (!manifest.includes('android:autoVerify="true"')) {
  failures.push('No Android App Link intent filter enables autoVerify.');
}
if (!manifest.includes('android:host="testagram.site"')) {
  failures.push('App Link host testagram.site is missing.');
}
for (const link of requiredLinks) {
  const pathIsDeclared = link.prefix === '/'
    ? declaredPaths.has('/')
    : declaredPrefixes.has(link.prefix);
  if (!pathIsDeclared) failures.push(`Android manifest is missing link prefix ${link.prefix}`);
  if (!router.includes(link.route)) failures.push(`Flutter router is missing expected route ${link.route}`);
}

const appId = gradle.match(/applicationId\s*=\s*"([^"]+)"/)?.[1];
if (!appId) failures.push('Could not read applicationId from Flutter Android Gradle config.');
const statements = Array.isArray(assetLinks) ? assetLinks : [];
const matchingStatement = statements.find((statement) =>
  statement.target?.namespace === 'android_app' &&
  statement.target?.package_name === appId &&
  Array.isArray(statement.target?.sha256_cert_fingerprints) &&
  statement.target.sha256_cert_fingerprints.some((fingerprint) =>
    /^[0-9A-F]{2}(?::[0-9A-F]{2}){31}$/.test(fingerprint),
  ),
);
if (!matchingStatement) {
  failures.push(`assetlinks.json has no valid Android signing statement for package ${appId ?? '(unknown)'}.`);
}

const expectedCertificate = process.env.TESTAGRAM_ANDROID_CERT_SHA256
  ?.replaceAll(':', '')
  .trim()
  .toUpperCase();
if (expectedCertificate) {
  const fingerprints = matchingStatement?.target?.sha256_cert_fingerprints ?? [];
  const expectedIsPublished = fingerprints.some((fingerprint) =>
    fingerprint.replaceAll(':', '').trim().toUpperCase() === expectedCertificate,
  );
  if (!expectedIsPublished) {
    failures.push('Configured production signing certificate is not published in public/.well-known/assetlinks.json.');
  }
}

if (failures.length) {
  console.error('Android App Links contract failed:');
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}
console.log(`Android App Links contract passed: ${requiredLinks.length} routes, package ${appId}, verified host testagram.site.`);
