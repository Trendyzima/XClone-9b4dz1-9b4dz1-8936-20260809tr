import fs from "node:fs";

const paths = [
  "scripts/verify-communications-e2ee-browser.mjs",
  "scripts/verify-communications-e2ee-runtime.mjs",
  "scripts/verify-community-admin-media-runtime.mjs",
  "scripts/verify-community-admin-rpc-runtime.mjs",
];
const needle = "/* global console, process */\n";
let changed = 0;
for (const path of paths) {
  const text = fs.readFileSync(path, "utf8");
  if (!text.startsWith(needle)) continue;
  fs.writeFileSync(path, text.slice(needle.length));
  changed += 1;
}
if (changed < 1 || changed > paths.length) throw new Error(`Refusing repair: expected 1-${paths.length} exact header removals, found ${changed}`);
console.log(`Removed exact redundant Node global declarations from ${changed} allowlisted verifier file(s).`);
