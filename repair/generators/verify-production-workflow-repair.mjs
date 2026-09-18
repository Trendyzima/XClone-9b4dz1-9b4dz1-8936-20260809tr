import fs from "node:fs";
import { execFileSync } from "node:child_process";

const path = ".github/workflows/production-deployment-reconciliation.yml";
const text = fs.readFileSync(path, "utf8");

const required = [
  "name: Production Deployment Reconciliation",
  "workflow_dispatch:",
  "githubCommitSha=$TARGET_SHA",
  "node scripts/verify-vercel-deployment.mjs",
  "vercel curl /api/health",
  "status=passed",
];
for (const needle of required) {
  if (!text.includes(needle)) throw new Error(`Required workflow invariant missing: ${needle}`);
}

execFileSync("actionlint", [path], { stdio: "inherit" });
console.log(`Validated ${path}: syntax and deployment invariants passed.`);
