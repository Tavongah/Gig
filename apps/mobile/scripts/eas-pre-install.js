/**
 * Runs on EAS before dependency install.
 * Narrow workspaces so npm does not touch apps/api or apps/admin,
 * then regenerate package-lock.json so the following `npm ci` stays in sync.
 */
const { execSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../../..");

function rmSafe(target) {
  try {
    if (fs.existsSync(target)) {
      fs.rmSync(target, { recursive: true, force: true });
    }
  } catch (error) {
    console.warn("[eas-pre-install] skip remove", target, error.message);
  }
}

const pkgPath = path.join(root, "package.json");
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
pkg.workspaces = ["apps/mobile", "packages/*"];
fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);

// Drop the full-monorepo lockfile; regenerate one that matches narrowed workspaces.
rmSafe(path.join(root, "package-lock.json"));
rmSafe(path.join(root, "node_modules"));

console.log("[eas-pre-install] repo root:", root);
console.log("[eas-pre-install] workspaces:", pkg.workspaces.join(", "));
console.log("[eas-pre-install] regenerating package-lock.json for EAS npm ci...");

execSync("npm install --package-lock-only --ignore-scripts --no-audit --no-fund", {
  cwd: root,
  stdio: "inherit",
  env: process.env
});

if (!fs.existsSync(path.join(root, "package-lock.json"))) {
  console.error("[eas-pre-install] failed to create package-lock.json");
  process.exit(1);
}

console.log("[eas-pre-install] package-lock.json ready");
