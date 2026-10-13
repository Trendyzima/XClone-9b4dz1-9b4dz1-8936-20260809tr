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

// Ratchet total explicit native route coverage, counting feature-native routes and clearly labelled migration shells separately.
// Shells count as URL coverage only—not feature parity. Raise this threshold and lower the fallback ceiling together when routes are migrated.
const MIN_NATIVE_COVERAGE = 211;
const MAX_LEGACY_FALLBACKS = 0;

if (!Number.isInteger(native) || !Number.isInteger(shells) || !Number.isInteger(fallback) || !Number.isInteger(unique)) {
  failures.push('Route inventory is missing integer route counts.');
}
if (native + shells < MIN_NATIVE_COVERAGE) {
  failures.push(`Native route coverage regressed: ${native} feature-native matches + ${shells} migration shells = ${native + shells} < ${MIN_NATIVE_COVERAGE}.`);
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
