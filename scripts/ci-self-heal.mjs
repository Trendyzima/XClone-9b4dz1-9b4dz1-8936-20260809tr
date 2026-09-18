import fs from "node:fs";
import { execFileSync } from "node:child_process";

const registry = {
  "eslint": { package: "eslint", version: "^9.9.1", area: "devDependencies" },
  "eslint-plugin-react-hooks": { package: "eslint-plugin-react-hooks", version: "^7.0.0", area: "devDependencies" },
  "eslint-plugin-react-refresh": { package: "eslint-plugin-react-refresh", version: "^0.4.24", area: "devDependencies" },
  "globals": { package: "globals", version: "^15.9.0", area: "devDependencies" },
  "typescript": { package: "typescript", version: "^5.5.3", area: "devDependencies" },
  "vite": { package: "vite", version: "^5.4.1", area: "devDependencies" }
};

const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
const log = fs.existsSync(process.env.SELF_HEAL_LOG ?? "") ? fs.readFileSync(process.env.SELF_HEAL_LOG, "utf8") : "";
const missing = [...log.matchAll(/Cannot find package '([^']+)' imported from/g)].map(m => m[1]);

if (missing.length === 0) {
  console.log("SELF_HEAL_RESULT=NO_REPAIR_NEEDED");
  process.exit(0);
}

const repairs = [...new Set(missing)]
  .map(name => registry[name])
  .filter(Boolean)
  .filter(item => !(pkg[item.area]?.[item.package]));

if (repairs.length === 0) {
  console.log("SELF_HEAL_RESULT=UNSAFE_OR_ALREADY_DECLARED");
  process.exit(0);
}

if (repairs.length > 3) {
  console.error("SELF_HEAL_RESULT=CIRCUIT_BREAKER");
  process.exit(2);
}

for (const item of repairs) {
  pkg[item.area] ??= {};
  pkg[item.area][item.package] = item.version;
}

fs.writeFileSync("package.json", JSON.stringify(pkg, null, 2) + "\n");
console.log("SELF_HEAL_RESULT=REPAIRED");
console.log("SELF_HEAL_ACTION_KEY=ci.dependency.declare");
console.log("SELF_HEAL_REVERSE_KEY=ci.dependency.undeclare");
console.log("SELF_HEAL_PACKAGES=" + repairs.map(x => x.package).join(","));
execFileSync("npm", ["install", "--package-lock-only", "--ignore-scripts", "--no-audit", "--no-fund"], { stdio: "inherit" });
