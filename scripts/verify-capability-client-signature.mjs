import fs from "node:fs";

const logPath = process.argv[2] || "/tmp/failed.log";
const contentPath = process.argv[3] || "/tmp/capability-client.ts";
const log = fs.readFileSync(logPath, "utf8");

const signatures = [
  "src/services/testagramCapabilityClient.ts(19,49): error TS1127: Invalid character.",
  "src/services/testagramCapabilityClient.ts(19,142): error TS1127: Invalid character.",
  "src/services/testagramCapabilityClient.ts(19,50): error TS1435:",
  "src/services/testagramCapabilityClient.ts(19,143): error TS1435:",
];
if (!signatures.every((needle) => log.includes(needle))) {
  throw new Error("Exact capability-client literal-newline failure signature not present.");
}

const text = fs.readFileSync(contentPath, "utf8");
if (!text.includes("const PUBLIC_CAPABILITIES")) {
  throw new Error("Capability client invariant missing; refusing repair.");
}
if (text.includes("\\nconst PUBLIC_CAPABILITIES")) {
  throw new Error("Literal newline escape remains after repair.");
}
console.log("Exact capability-client failure signature and repaired content invariant verified.");
