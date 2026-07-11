#!/usr/bin/env node
/**
 * Generates google-services.json, GoogleService-Info.plist, and updates apps/mobile/.env
 * from apps/mobile/firebase.config.json (copy from firebase.config.example.json).
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const mobileDir = resolve(root, "apps/mobile");
const configPath = resolve(mobileDir, "firebase.config.json");
const firebaseDir = resolve(mobileDir, "firebase");
const mobileEnvPath = resolve(mobileDir, ".env");
const apiEnvPath = resolve(root, "apps/api/.env");

if (!existsSync(configPath)) {
  console.error(`Missing ${configPath}`);
  console.error("Copy firebase.config.example.json → firebase.config.json and set projectId.");
  process.exit(1);
}

const config = JSON.parse(readFileSync(configPath, "utf8"));
const { projectId, projectNumber, storageBucket, ios, android, web } = config;

if (!projectId || projectId.includes("REPLACE")) {
  console.error("Set projectId in firebase.config.json (Firebase Console → Project settings → General).");
  process.exit(1);
}

mkdirSync(firebaseDir, { recursive: true });

const googleServices = {
  project_info: {
    project_number: projectNumber,
    project_id: projectId,
    storage_bucket: storageBucket || `${projectId}.appspot.com`
  },
  client: [
    {
      client_info: {
        mobilesdk_app_id: android.appId,
        android_client_info: { package_name: android.packageName }
      },
      oauth_client: [],
      api_key: [{ current_key: android.apiKey }],
      services: { appinvite_service: { other_platform_oauth_client: [] } }
    }
  ],
  configuration_version: "1"
};

writeFileSync(resolve(firebaseDir, "google-services.json"), `${JSON.stringify(googleServices, null, 2)}\n`, "utf8");

const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>API_KEY</key>
\t<string>${ios.apiKey}</string>
\t<key>GCM_SENDER_ID</key>
\t<string>${projectNumber}</string>
\t<key>PLIST_VERSION</key>
\t<string>1</string>
\t<key>BUNDLE_ID</key>
\t<string>${ios.bundleId}</string>
\t<key>PROJECT_ID</key>
\t<string>${projectId}</string>
\t<key>STORAGE_BUCKET</key>
\t<string>${storageBucket || `${projectId}.appspot.com`}</string>
\t<key>IS_ADS_ENABLED</key>
\t<false></false>
\t<key>IS_ANALYTICS_ENABLED</key>
\t<false></false>
\t<key>IS_APPINVITE_ENABLED</key>
\t<true></true>
\t<key>IS_GCM_ENABLED</key>
\t<true></true>
\t<key>IS_SIGNIN_ENABLED</key>
\t<true></true>
\t<key>GOOGLE_APP_ID</key>
\t<string>${ios.appId}</string>
</dict>
</plist>
`;

writeFileSync(resolve(firebaseDir, "GoogleService-Info.plist"), plist, "utf8");

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

const webApiKey = web?.apiKey || ios.apiKey;
const webAppId = web?.appId || "";
const authDomain = web?.authDomain || `${projectId}.firebaseapp.com`;

upsertEnv(mobileEnvPath, {
  EXPO_PUBLIC_FIREBASE_API_KEY: webApiKey,
  EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN: authDomain,
  EXPO_PUBLIC_FIREBASE_PROJECT_ID: projectId,
  EXPO_PUBLIC_FIREBASE_APP_ID: webAppId
});

console.log("Generated:");
console.log(`  ${resolve(firebaseDir, "google-services.json")}`);
console.log(`  ${resolve(firebaseDir, "GoogleService-Info.plist")}`);
console.log(`  Updated ${mobileEnvPath} (web Firebase client vars)`);

if (!web?.appId) {
  console.warn("\nWeb app not configured — add a Web app in Firebase Console, then fill firebase.config.json → web, and re-run.");
  console.warn("Google/Apple sign-in on Expo web requires a registered Web app.");
} else {
  console.log("\nWeb client configured for Expo web social login.");
}

console.log("\nNext: add Firebase Admin service account to apps/api/.env (see FIREBASE_SETUP.md).");
