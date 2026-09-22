/**
 * Courier/rider logout wiring (web Alert.alert is a no-op).
 * Run: npx tsx scripts/test-courier-logout-ui.ts
 */
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const src = join(__dirname, "..", "src");
const root = join(__dirname, "..");

function read(rel: string) {
  const p = join(src, rel);
  assert.ok(existsSync(p), `missing ${rel}`);
  return readFileSync(p, "utf8");
}

const alertWeb = readFileSync(
  join(root, "..", "..", "node_modules", "react-native-web", "dist", "exports", "Alert", "index.js"),
  "utf8"
);
assert.match(alertWeb, /static alert\(\)\s*\{\s*\}/, "react-native-web Alert.alert is a no-op");

const confirm = read("lib/confirm.ts");
assert.ok(confirm.includes("window.confirm"), "web logout confirm uses window.confirm");
assert.ok(confirm.includes("Alert.alert"), "native confirm still uses Alert.alert");

const profile = read("screens/shared/ProfileScreen.tsx");
assert.ok(profile.includes("showConfirm"), "Profile logout uses showConfirm");
assert.ok(profile.includes('label="Log out"'), "Log out is visible on Profile");
assert.ok(profile.includes("handleSignOut"), "shared logout handler");
const logoutHandler = profile.slice(profile.indexOf("function handleSignOut"), profile.indexOf("function handleDeleteAccount"));
assert.ok(logoutHandler.includes("showConfirm"), "handleSignOut uses showConfirm, not web-noop Alert");
assert.ok(!logoutHandler.includes("Alert.alert"), "handleSignOut must not call Alert.alert");
assert.ok(logoutHandler.includes("disconnectSocket"), "logout disconnects socket");
assert.ok(logoutHandler.includes("signOut"), "logout calls session.signOut");

const workerTabs = read("navigation/WorkerTabs.tsx");
assert.ok(workerTabs.includes('name="Profile"'), "courier Profile tab exists");
assert.ok(workerTabs.includes("ProfileScreen"), "courier Profile uses shared ProfileScreen");

const clientTabs = read("navigation/ClientTabs.tsx");
assert.ok(clientTabs.includes("ProfileScreen"), "customer Account uses the same ProfileScreen");

const session = read("stores/session.store.ts");
assert.ok(session.includes("authStorage.clearToken"), "signOut clears persisted token");
assert.ok(session.includes('activeRole: "CLIENT"'), "signOut resets role");
assert.ok(session.includes("replaceState"), "web history is replaced so Back does not restore courier URL");
assert.ok(!session.includes("availabilityStatus"), "logout does not invent offline matching behavior");

const app = readFileSync(join(root, "App.tsx"), "utf8");
assert.ok(app.includes("GuestAppNavigator"), "logged-out shell is guest storefront");
assert.ok(app.includes('if (!session)'), "no session → guest navigator");
assert.ok(app.includes('removeQueries({ queryKey: ["worker-earnings"] })'), "courier query cache cleared");
assert.ok(app.includes("claimCartAfterLogin"), "customer cart claim unchanged");

const security = read("screens/profile/SecurityScreen.tsx");
assert.ok(security.includes("showConfirm"), "Security sign-out uses showConfirm");
assert.ok(!security.includes("Alert.alert"), "Security sign-out must not use Alert.alert");

const storage = read("lib/auth-storage.ts");
assert.ok(storage.includes("duts_auth_token"), "token key unchanged");
assert.ok(storage.includes("AsyncStorage"), "platform storage abstraction unchanged");

console.log(JSON.stringify({ ok: true }, null, 2));
