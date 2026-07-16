/**
 * Runs on EAS before dependency install.
 * Narrow workspaces so npm does not touch apps/api or apps/admin,
 * align React pins with root overrides, then regenerate package-lock.json
 * so the following `npm ci` stays in sync.
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

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

const pkgPath = path.join(root, "package.json");
const pkg = readJson(pkgPath);
pkg.workspaces = ["apps/mobile", "packages/*"];
writeJson(pkgPath, pkg);

// Keep mobile React pins identical to root overrides (npm ci fails when they diverge).
const mobilePkgPath = path.join(root, "apps/mobile/package.json");
const mobilePkg = readJson(mobilePkgPath);
const reactVersion = pkg.overrides?.react;
const reactDomVersion = pkg.overrides?.["react-dom"];
if (reactVersion) mobilePkg.dependencies.react = reactVersion;
if (reactDomVersion) mobilePkg.dependencies["react-dom"] = reactDomVersion;
writeJson(mobilePkgPath, mobilePkg);

rmSafe(path.join(root, "package-lock.json"));
rmSafe(path.join(root, "node_modules"));

console.log("[eas-pre-install] repo root:", root);
console.log("[eas-pre-install] workspaces:", pkg.workspaces.join(", "));
console.log("[eas-pre-install] react:", mobilePkg.dependencies.react, "react-dom:", mobilePkg.dependencies["react-dom"]);
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

// Fail fast here if the lockfile still wouldn't pass npm ci.
execSync("npm ci --include=dev --ignore-scripts --dry-run", {
  cwd: root,
  stdio: "inherit",
  env: process.env
});

console.log("[eas-pre-install] package-lock.json ready and npm ci dry-run passed");
