/**
 * Runs on EAS before dependency install.
 * Narrow workspaces so npm does not touch apps/api or apps/admin (EACCES on OneDrive uploads).
 */
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

// npm ci uses the lockfile workspace list; drop it so install respects the narrowed workspaces.
rmSafe(path.join(root, "package-lock.json"));
rmSafe(path.join(root, "node_modules"));

console.log("[eas-pre-install] repo root:", root);
console.log("[eas-pre-install] workspaces:", pkg.workspaces.join(", "));
