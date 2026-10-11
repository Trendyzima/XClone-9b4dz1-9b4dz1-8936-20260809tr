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
const requiredDomains = ['authentication_and_legal','social_feed','profiles_and_graph','search_and_discovery','stories_and_shorts','iptv_and_tv_production','advertising_and_monetization','messaging_and_calls','notifications','camera_microphone_media','communities_and_live_spaces','fediverse','commerce_and_wallet','creator_tools','administration_and_safety','settings_and_privacy','ads_engine','offline_and_performance','web_and_seo','native_android','accessibility_and_localization','observability_and_release'];
const domainIds = new Set(inventory.domains.map((domain) => domain.id));
for (const id of requiredDomains) if (!domainIds.has(id)) failures.push(`Missing product domain: ${id}`);
if (failures.length) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`Flutter parity inventory valid: ${actual.size} source files, ${inventory.domains.length} product domains.`);
}
