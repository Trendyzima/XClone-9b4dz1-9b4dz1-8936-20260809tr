import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const inventoryPath = path.join(root, 'docs', 'flutter-parity-inventory.json');
const inventory = JSON.parse(fs.readFileSync(inventoryPath, 'utf8'));
const roots = ['src', 'api', 'supabase/functions', 'supabase/migrations', 'android/app/src/main', 'android/scripts'];
const failures = [];
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
const actual = new Set(roots.flatMap(walk));
for (const file of actual) if (!inventory.sources[file]) failures.push(`Missing inventory entry: ${file}`);
for (const file of Object.keys(inventory.sources)) if (!actual.has(file)) failures.push(`Stale inventory entry: ${file}`);

// The route-parity document is generated from source declarations. Validate it
// here as well: duplicate JSON keys are legal to JSON.parse but can silently
// overwrite status/count fields, which previously hid broken route metadata.
const routeParityPath = path.join(root, 'docs', 'flutter-route-parity.json');
const routeParityRaw = fs.readFileSync(routeParityPath, 'utf8');
let routeParity;
try {
  routeParity = JSON.parse(routeParityRaw);
} catch (error) {
  failures.push('Invalid docs/flutter-route-parity.json: ' + error.message);
}
function duplicateObjectKeys(json) {
  const stack = [];
  const duplicates = [];
  for (let index = 0; index < json.length;) {
    const char = json[index];
    if (char === '"') {
      const start = index++;
      while (index < json.length) {
        if (json[index] === '\\\\') { index += 2; continue; }
        if (json[index++] === '"') break;
      }
      const token = json.slice(start, index);
      let next = index;
      while (/\\s/.test(json[next] ?? '')) next += 1;
      if (json[next] === ':' && stack.at(-1)?.type === 'object') {
        let key;
        try { key = JSON.parse(token); } catch { key = token; }
        const object = stack.at(-1);
        if (object.keys.has(key)) duplicates.push(key);
        object.keys.add(key);
      }
      continue;
    }
    if (char === '{') stack.push({ type: 'object', keys: new Set() });
    else if (char === '[') stack.push({ type: 'array' });
    else if (char === '}' || char === ']') stack.pop();
    index += 1;
  }
  return duplicates;
}
for (const key of duplicateObjectKeys(routeParityRaw)) {
  failures.push('Duplicate JSON object key in docs/flutter-route-parity.json: ' + key);
}
if (routeParity) {
  const paths = routeParity.routes.map((route) => route.path);
  if (new Set(paths).size !== paths.length) failures.push('Duplicate route path in docs/flutter-route-parity.json');
  const expectedCounts = {
    source_routes_excluding_wildcard: routeParity.routes.length,
    native_route_matches: routeParity.routes.filter((route) => route.status === 'native_partial').length,
    native_shell_routes: routeParity.routes.filter((route) => route.status === 'native_shell').length,
    legacy_web_fallbacks: routeParity.routes.filter((route) => route.status === 'legacy_web_fallback').length
  };
  for (const [key, value] of Object.entries(expectedCounts)) {
    if (routeParity.counts?.[key] !== value) {
      failures.push('Route parity count mismatch for ' + key + ': expected ' + value + ', got ' + routeParity.counts?.[key]);
    }
  }
  if (new Set(routeParity.flutter_native_routes).size !== routeParity.flutter_native_routes.length) {
    failures.push('Duplicate Flutter route pattern in docs/flutter-route-parity.json');
  }
}

const requiredDomains = ['authentication_and_legal','social_feed','profiles_and_graph','search_and_discovery','stories_and_shorts','iptv_and_tv_production','advertising_and_monetization','messaging_and_calls','notifications','camera_microphone_media','communities_and_live_spaces','fediverse','commerce_and_wallet','creator_tools','administration_and_safety','settings_and_privacy','ads_engine','offline_and_performance','web_and_seo','native_android','accessibility_and_localization','observability_and_release'];
const domainIds = new Set(inventory.domains.map((domain) => domain.id));
for (const id of requiredDomains) if (!domainIds.has(id)) failures.push(`Missing product domain: ${id}`);
if (failures.length) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`Flutter parity inventory valid: ${actual.size} source files, ${inventory.domains.length} product domains.`);
}
