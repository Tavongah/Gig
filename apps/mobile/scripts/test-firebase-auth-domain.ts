/**
 * DUTS Firebase authDomain must stay on app.duts.tech.
 * Run: npm run test:firebase-auth-domain --workspace=@gigflow/mobile
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const mobileRoot = resolve(here, "..");
const repoRoot = resolve(mobileRoot, "../..");

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function read(relFromRepo: string): string {
  return readFileSync(resolve(repoRoot, relFromRepo), "utf8");
}

async function main() {
  const firebaseConfig = read("apps/mobile/firebase.config.json");
  assert(firebaseConfig.includes('"projectId": "gigflow-a5943"'), "Firebase project ID must remain gigflow-a5943");
  assert(firebaseConfig.includes('"authDomain": "app.duts.tech"'), "web.authDomain must be app.duts.tech");
  assert(
    !firebaseConfig.includes('"authDomain": "gigflow-a5943.firebaseapp.com"'),
    "web.authDomain must not be the legacy firebaseapp.com host"
  );

  const eas = read("apps/mobile/eas.json");
  assert((eas.match(/"EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN": "app.duts.tech"/g) ?? []).length >= 3, "EAS authDomain must be app.duts.tech");
  assert(!eas.includes("gigflow-a5943.firebaseapp.com"), "EAS must not bake the legacy authDomain");
  assert(eas.includes('"EXPO_PUBLIC_FIREBASE_PROJECT_ID": "gigflow-a5943"'), "EAS project ID stays gigflow-a5943");

  const nginx = read("deploy/nginx/conf.d/gigflow.conf.template");
  assert(nginx.includes("location ^~ /__/auth"), "nginx must proxy /__/auth before the Expo SPA");
  assert(nginx.includes("firebase-auth-proxy.conf"), "nginx must include the Firebase auth proxy snippet");
  assert(nginx.includes("try_files $uri $uri/ /index.html"), "Expo SPA fallback must remain for the rest of the app");

  const snippet = read("deploy/nginx/snippets/firebase-auth-proxy.conf");
  assert(snippet.includes("X-Forwarded-Host"), "proxy must forward the customer host");
  assert(snippet.includes("proxy_ssl_server_name on"), "proxy must use SNI to Firebase Hosting");

  const render = read("deploy/digitalocean/scripts/render-nginx-conf.sh");
  assert(render.includes("FIREBASE_AUTH_PROXY_HOST"), "nginx render must substitute the Firebase proxy host");
  assert(render.includes("gigflow-a5943.firebaseapp.com"), "proxy upstream default is the immutable Hosting origin");

  const prodExample = read("deploy/digitalocean/.env.production.example");
  assert(prodExample.includes("EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN=app.duts.tech"), "production example authDomain is app.duts.tech");

  const compose = read("deploy/digitalocean/docker-compose.prod.yml");
  assert(compose.includes("EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN:-app.duts.tech"), "compose default authDomain is app.duts.tech");

  const webAuth = read("apps/mobile/src/lib/firebase-auth.web.ts");
  assert(webAuth.includes("signInWithPopup"), "desktop still uses popup");
  assert(webAuth.includes("signInWithRedirect"), "iOS/PWA uses redirect on the DUTS domain");
  assert(webAuth.includes("getRedirectResult"), "redirect return must complete on app.duts.tech");
  assert(webAuth.includes("authDomain: extra.firebaseAuthDomain"), "SDK still uses configured authDomain");

  const social = read("apps/mobile/src/components/SocialAuthButtons.tsx");
  assert(social.includes("completePendingRedirectSignIn"), "login UI must finish redirect sign-in");
  assert(!social.includes("window.alert"), "no native browser alert()");
  assert(!social.includes("window.confirm"), "no native browser confirm()");

  const generate = read("scripts/generate-firebase-native-config.mjs");
  assert(generate.includes('"app.duts.tech"'), "config generator must not fall back to firebaseapp.com");
  assert(!generate.includes("${projectId}.firebaseapp.com"), "config generator must not default to firebaseapp.com");

  const guestBtn = read("apps/mobile/src/components/SocialAuthButtons.tsx");
  assert(guestBtn.includes("api.socialLogin"), "social login still exchanges Firebase ID token with DUTS");

  console.log("PASS firebase-auth-domain");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
