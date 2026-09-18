import fs from "node:fs";

const path = "/tmp/capability-client.ts";
const s = fs.readFileSync(path, "utf8");
const bad = 'const PUBLIC_EDGE_PATH="/api/public-capability";\\nconst PUBLIC_CAPABILITIES=new Set(["testagram.capabilities.list","testagram.health.read"]);\\nconst PUBLIC_EDGE_PATH="/api/public-capability";';
const good = 'const PUBLIC_EDGE_PATH="/api/public-capability";';

if (s.split(bad).length - 1 !== 1) {
  throw new Error("Exact malformed capability-client signature not present; refusing repair");
}

const repaired = s.replace(bad, good);
if (repaired === s) throw new Error("Repair made no change");
fs.writeFileSync(path, repaired);

if (repaired.includes("\\nconst PUBLIC_CAPABILITIES")) {
  throw new Error("Literal newline escape remains after repair");
}
