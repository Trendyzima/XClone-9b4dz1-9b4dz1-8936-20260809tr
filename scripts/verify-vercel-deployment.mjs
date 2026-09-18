import fs from "node:fs";

const targetSha = process.env.TARGET_SHA;
if (!targetSha || !/^[0-9a-f]{40}$/.test(targetSha)) {
  console.error("TARGET_SHA must be a full 40-character commit SHA");
  process.exit(2);
}

const data = JSON.parse(fs.readFileSync("deployment-list.json", "utf8"));
const deployments = Array.isArray(data) ? data : (data.deployments || []);
const matches = deployments.filter((d) => d?.meta?.githubCommitSha === targetSha);

if (!matches.length) {
  console.error(`No Vercel deployment matched TARGET_SHA=${targetSha}`);
  process.exit(20);
}

const ready = matches.find((d) => d.target === "production" && d.state === "READY");
if (!ready) {
  console.error(JSON.stringify(matches, null, 2));
  process.exit(21);
}

console.log(JSON.stringify({
  id: ready.id,
  url: ready.url,
  state: ready.state,
  target: ready.target,
  sha: ready.meta.githubCommitSha,
}, null, 2));
