import fs from "node:fs";
import { execFileSync } from "node:child_process";

const path = ".github/workflows/production-deployment-reconciliation.yml";
const temp = "/tmp/production-deployment-reconciliation.main.yml";

execFileSync("git", ["fetch", "origin", "main", "--depth=1"], { stdio: "inherit" });
const candidate = execFileSync("git", ["show", `origin/main:${path}`], { encoding: "utf8" });

const required = [
  "name: Production Deployment Reconciliation",
  "workflow_dispatch:",
  "githubCommitSha=$TARGET_SHA",
  "node scripts/verify-vercel-deployment.mjs",
  "vercel curl /api/health",
  "status=passed",
];
for (const needle of required) {
  if (!candidate.includes(needle)) {
    throw new Error(`Refusing canonical workflow recovery: missing required invariant: ${needle}`);
  }
}

fs.writeFileSync(temp, candidate);
execFileSync("actionlint", [temp], { stdio: "inherit" });

const current = fs.readFileSync(path, "utf8");
if (current === candidate) {
  throw new Error("Canonical main workflow is identical; no repair is necessary.");
}

fs.writeFileSync(path, candidate);
console.log(`Recovered exactly ${path} from validated origin/main canonical content.`);
