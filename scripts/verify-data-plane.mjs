import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve('src');
const primaryOnly = new Set([
  'profiles','wallets','wallet_accounts','wallet_transactions','ledger_transactions',
  'ledger_entries','transactions','mpesa_payments','wallet_security','payouts',
  'payout_accounts','rides','orders','marketplace_deliveries','notifications',
  'notification_preferences','messages','conversations',
]);

const files = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.(ts|tsx)$/.test(entry.name)) files.push(full);
  }
}
walk(root);

const violations = [];
const secondaryFrom = /supabaseSecondary\s*\.\s*from\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
const secondaryRpc = /supabaseSecondary\s*\.\s*rpc\s*\(/g;

for (const file of files) {
  const source = fs.readFileSync(file, 'utf8');

  for (const match of source.matchAll(secondaryFrom)) {
    if (primaryOnly.has(match[1])) {
      violations.push(file + ': secondary client references primary-only table ' + match[1]);
    }
  }

  if (secondaryRpc.test(source)) {
    violations.push(file + ': secondary client must not execute RPCs');
    secondaryRpc.lastIndex = 0;
  }
}

if (violations.length) {
  console.error('DATA-PLANE GATE FAILED');
  for (const violation of violations) console.error(' - ' + violation);
  process.exit(1);
}

console.log('DATA-PLANE GATE PASSED: no primary-only tables or RPCs are routed through supabaseSecondary.');
