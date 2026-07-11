#!/usr/bin/env node
/**
 * Import Firebase credentials into apps/api/.env and apps/mobile/.env
 *
 * Usage:
 *   node scripts/import-firebase-env.mjs path/to/serviceAccount.json path/to/web-app-config.json
 *
 * web-app-config.json shape (from Firebase Console → Web app):
 * { "apiKey": "...", "authDomain": "...", "projectId": "...", "appId": "..." }
 *
 * Or pass only service account JSON — you'll fill mobile EXPO_PUBLIC_* manually.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const apiEnvPath = resolve(root, "apps/api/.env");
const mobileEnvPath = resolve(root, "apps/mobile/.env");

const serviceAccountPath = process.argv[2];
if (!serviceAccountPath) {
  console.error("Usage: node scripts/import-firebase-env.mjs <serviceAccount.json> [webConfig.json]");
  process.exit(1);
}

const serviceAccount = JSON.parse(readFileSync(resolve(serviceAccountPath), "utf8"));
const { project_id: projectId, client_email: clientEmail, private_key: privateKey } = serviceAccount;

if (!projectId || !clientEmail || !privateKey) {
  console.error("Invalid service account JSON — missing project_id, client_email, or private_key.");
  process.exit(1);
}

function upsertEnv(path, updates) {
  const lines = existsSync(path) ? readFileSync(path, "utf8").split(/\r?\n/) : [];
  const keys = new Set(Object.keys(updates));
  const kept = lines.filter((line) => {
    const key = line.split("=")[0]?.trim();
    return !keys.has(key);
  });
  const appended = Object.entries(updates).map(([key, value]) => `${key}=${value}`);
  writeFileSync(path, [...kept.filter((l) => l.trim().length > 0), "", ...appended, ""].join("\n"), "utf8");
}

const escapedPrivateKey = JSON.stringify(privateKey);

upsertEnv(apiEnvPath, {
  FIREBASE_PROJECT_ID: projectId,
  FIREBASE_CLIENT_EMAIL: clientEmail,
  FIREBASE_PRIVATE_KEY: escapedPrivateKey
});

console.log(`Updated API Firebase vars in ${apiEnvPath}`);

const webConfigPath = process.argv[3];
if (webConfigPath && existsSync(resolve(webConfigPath))) {
  const web = JSON.parse(readFileSync(resolve(webConfigPath), "utf8"));
  upsertEnv(mobileEnvPath, {
    EXPO_PUBLIC_FIREBASE_API_KEY: web.apiKey ?? "",
    EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN: web.authDomain ?? `${projectId}.firebaseapp.com`,
    EXPO_PUBLIC_FIREBASE_PROJECT_ID: web.projectId ?? projectId,
    EXPO_PUBLIC_FIREBASE_APP_ID: web.appId ?? ""
  });
  console.log(`Updated mobile Firebase vars in ${mobileEnvPath}`);
} else {
  console.log("No web config JSON — set EXPO_PUBLIC_FIREBASE_* in apps/mobile/.env manually.");
}

console.log("Restart API and Expo after saving env files.");
