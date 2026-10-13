import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = path.join(root, 'docs', 'flutter-route-parity.json');
const report = JSON.parse(fs.readFileSync(file, 'utf8'));
const counts = report.counts ?? {};
const native = counts.native_route_matches;
const fallback = counts.legacy_web_fallbacks;
const shells = counts.native_shell_routes;
const unique = counts.unique_source_routes_including_wildcard;
const failures = [];

// Ratchet baseline from the audited main-branch snapshot on 2026-10-13. Social list and poll routes are now feature-native/partial.
// When native routes are added, raise MIN_NATIVE_MATCHES and lower MAX_LEGACY_FALLBACKS
// in the same PR. Never lower the bar just to make CI green.
const MIN_NATIVE_MATCHES = 149;
const MAX_LEGACY_FALLBACKS = 0;

if (!Number.isInteger(native) || !Number.isInteger(shells) || !Number.isInteger(fallback) || !Number.isInteger(unique)) {
  failures.push('Route inventory is missing integer route counts.');
}
if (native < MIN_NATIVE_MATCHES) {
  failures.push(`Native route matches regressed: ${native} < ${MIN_NATIVE_MATCHES}.`);
}
if (fallback > MAX_LEGACY_FALLBACKS) {
  failures.push(`Legacy fallback routes regressed: ${fallback} > ${MAX_LEGACY_FALLBACKS}.`);
}
if (native + shells + fallback !== counts.source_routes_excluding_wildcard) {
  failures.push(
    `Route accounting mismatch: implemented native (${native}) + native migration shells (${shells}) + fallback (${fallback}) must equal ` +
    `source routes excluding wildcard (${counts.source_routes_excluding_wildcard}).`,
  );
}
if (unique !== counts.source_routes_excluding_wildcard + 1) {
  failures.push(
    `Expected unique routes including wildcard (${unique}) to be source routes excluding wildcard + 1.`,
  );
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
} else {
  console.log(
    `Flutter route progress gate passed: ${native} feature-native matches, ${shells} native migration shells, ${fallback} legacy fallbacks, ${unique} unique routes including wildcard.`,
  );
  console.log('Note: native migration shells provide route coverage, not feature parity or production readiness.');
}
