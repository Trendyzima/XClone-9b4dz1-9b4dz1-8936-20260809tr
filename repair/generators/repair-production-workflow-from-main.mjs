import fs from "node:fs";
import { execFileSync } from "node:child_process";

const path = ".github/workflows/production-deployment-reconciliation.yml";
const temp = "/tmp/production-deployment-reconciliation.candidate.yml";

execFileSync("git", ["fetch", "origin", "main", "--depth=20"], { stdio: "inherit" });

const required = [
  "name: Production Deployment Reconciliation",
  "workflow_dispatch:",
  "githubCommitSha=$TARGET_SHA",
  "node scripts/verify-vercel-deployment.mjs",
  "vercel curl /api/health",
  "status=passed",
];

const revisions = execFileSync(
  "git",
  ["rev-list", "--max-count=20", "HEAD^", "origin/main"],
  { encoding: "utf8" }
).trim().split("\n").filter(Boolean);

let candidate = null;
let candidateRevision = null;

for (const revision of revisions) {
  let text;
  try {
    text = execFileSync("git", ["show", revision + ":" + path], { encoding: "utf8" });
  } catch {
    continue;
  }
  if (!required.every((needle) => text.includes(needle))) continue;

  fs.writeFileSync(temp, text);
  try {
    execFileSync("actionlint", [temp], { stdio: "inherit" });
    candidate = text;
    candidateRevision = revision;
    break;
  } catch {
    // Keep searching a bounded set of known ancestors for the last valid canonical workflow.
  }
}

if (!candidate) {
  throw new Error("Refusing workflow recovery: no validated canonical ancestor found within the 20-commit safety window.");
}

const current = fs.readFileSync(path, "utf8");
if (current === candidate) {
  throw new Error("Validated canonical ancestor is identical; no repair is necessary.");
}

fs.writeFileSync(path, candidate);
console.log("Recovered exactly " + path + " from validated ancestor " + candidateRevision + ".");
