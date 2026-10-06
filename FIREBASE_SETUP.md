# Firebase setup for Google & Apple sign-in

Social login needs Firebase on **mobile (client)**, **API (server)**, and a registered **Web app** for Expo web.

## 1. Create a Firebase project

1. Open [Firebase Console](https://console.firebase.google.com/) and create a project (or pick an existing one).
2. **Authentication → Sign-in method** → enable **Google** and **Apple**.
3. **Authentication → Settings → Authorized domains** → add:
   - `localhost`
   - `app.duts.tech` (production Expo web — required for Google/Apple popups)
   - Do **not** host the app on Firebase Hosting; keep serving `app.duts.tech` from DigitalOcean

## 2. Register apps in Firebase

You should have three apps in the same project:

| Platform | Bundle / package | Notes |
|----------|------------------|--------|
| iOS | `com.gigflow.ios` | Registered |
| Android | `com.gigflow.android` | Registered |
| **Web** | — | **Required for Expo web Google/Apple buttons** |

To add Web: **Project settings → Your apps → Add app → Web** → copy the `firebaseConfig` object.

## 3. Generate native config + mobile `.env`

1. Copy the example config:

```bash
cp apps/mobile/firebase.config.example.json apps/mobile/firebase.config.json
```

2. Edit `apps/mobile/firebase.config.json`:
   - Set `projectId` from **Firebase Console → Project settings → General → Project ID**
   - iOS/Android values are pre-filled from your registration
   - Fill `web.apiKey`, `web.appId`, `web.authDomain` after adding the Web app

3. Generate plist/json and update `apps/mobile/.env`:

```bash
npm run firebase:config
```

This creates:

- `apps/mobile/firebase/google-services.json`
- `apps/mobile/firebase/GoogleService-Info.plist`
- `EXPO_PUBLIC_FIREBASE_*` in `apps/mobile/.env`

## 4. Service account for the API

1. **Project settings → Service accounts → Generate new private key**.
2. Either run:

```bash
npm run setup:firebase -- path/to/serviceAccount.json
```

Or add to `apps/api/.env` manually:

```env
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@your-project.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```

## 5. Expo / EAS native builds

`app.config.ts` uses bundle IDs that match Firebase:

- iOS: `com.gigflow.ios`
- Android: `com.gigflow.android`

After `npm run firebase:config`, run `npx expo prebuild` or an EAS build so native Firebase files are bundled.

**Note:** Google/Apple in **Expo Go** may be limited — use `expo start --web` for web social login, or an EAS dev/production build for native.

## 6. Restart dev servers

```bash
npm run dev:api
npm run dev:mobile
```

## 7. Verify

- Login screen — Firebase warning should disappear when client + server are configured
- `GET http://localhost:4000/v1/auth/config` → `"firebaseConfigured": true`
- **Continue with Google** on web opens a popup

## 8. Production checklist (`app.duts.tech`)

Project ID (immutable): **gigflow-a5943**  
Customer-facing `authDomain`: **app.duts.tech**

Web social buttons load [`apps/mobile/src/lib/firebase-auth.web.ts`](apps/mobile/src/lib/firebase-auth.web.ts) (not the native `firebase-auth.ts`).

Do **not** point `app.duts.tech` DNS at Firebase Hosting. Nginx on DigitalOcean continues to serve the Expo app and **proxies** `/__/auth` to `gigflow-a5943.firebaseapp.com` so customers never navigate to the legacy Firebase Hosting hostname.

1. **Authentication → Sign-in method:** Google **Enabled**; Apple **Enabled**
2. **Authentication → Settings → Authorized domains:** include `app.duts.tech` and `localhost`.  
   Keep `gigflow-a5943.firebaseapp.com` listed — Firebase still needs it internally. Customers must not land on it.
3. **Google Cloud Console → APIs & Services → Credentials → OAuth 2.0 Web client** authorized redirect URIs must include:  
   `https://app.duts.tech/__/auth/handler`  
   Keep the existing `https://gigflow-a5943.firebaseapp.com/__/auth/handler` URI.
4. **Apple (web):** Services ID return URL must include  
   `https://app.duts.tech/__/auth/handler`  
   Keep `https://gigflow-a5943.firebaseapp.com/__/auth/handler` as well.
5. DO `.env.production`:
   - `EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN=app.duts.tech`
   - `FIREBASE_AUTH_PROXY_HOST=gigflow-a5943.firebaseapp.com`
6. After client or nginx changes, redeploy so the Expo web export rebuilds **and** nginx reloads the `/__/auth` proxy.
7. Confirm:
   - `GET https://api.duts.tech/v1/auth/config` → `"firebaseConfigured": true`
   - `https://app.duts.tech/__/auth/handler` is the Firebase helper (not the DUTS SPA)
   - Sign-in address bar stays on `app.duts.tech`, not `gigflow-a5943.firebaseapp.com`

## Troubleshooting

| Symptom | Fix |
|--------|-----|
| “Firebase keys in your app config” on mobile | Run `npm run firebase:config` and restart Expo |
| Social popup works but API returns 503 | Set `FIREBASE_*` in `apps/api/.env` and restart API |
| `auth/unauthorized-domain` | Add `app.duts.tech` (and `localhost`) to Firebase **Authorized domains** |
| Apple sign-in fails on web | Enable Apple in Firebase; Services ID return URLs must include `https://app.duts.tech/__/auth/handler` |
| Browser shows `gigflow-a5943.firebaseapp.com` during sign-in | Set `EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN=app.duts.tech`, deploy nginx `/__/auth` proxy, add OAuth redirect `https://app.duts.tech/__/auth/handler` |
| Google/Apple buttons do nothing useful on web | Ensure `firebase-auth.ts` web popups are deployed; rebuild nginx/web image after code changes |
| Native build missing Firebase | Run `npm run firebase:config` before `eas build` |
