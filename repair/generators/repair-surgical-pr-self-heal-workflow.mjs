import fs from "node:fs";

const path = ".github/workflows/surgical-pr-self-heal.yml";
const source = fs.readFileSync(path, "utf8");

if (process.argv.includes("--verify-only")) {
  if (source.includes("python3 - <<'PY'")) {
    throw new Error("Malformed heredoc signature remains in surgical-pr-self-heal workflow");
  }
  if (!source.includes("node repair/generators/repair-capability-client.mjs")) {
    throw new Error("Expected standalone capability-client repair generator call is missing");
  }
  process.exit(0);
}

const badStart = "            python3 - <<'PY'\n";
const badEnd = "            PY\n";
const start = source.indexOf(badStart);
const end = source.indexOf(badEnd, start);
if (start < 0 || end < 0) {
  throw new Error("Exact surgical-pr-self-heal Python heredoc signature not present; refusing repair");
}
const blockEnd = end + badEnd.length;
const replacement = "            node repair/generators/repair-capability-client.mjs\n";

if ((source.slice(start, blockEnd).match(/python3 - <<'PY'/g) || []).length !== 1) {
  throw new Error("Expected exactly one malformed Python heredoc; refusing repair");
}

const repaired = source.slice(0, start) + replacement + source.slice(blockEnd);
if (repaired === source) throw new Error("Repair made no change");

fs.writeFileSync(path, repaired);
