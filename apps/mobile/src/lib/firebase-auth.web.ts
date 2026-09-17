import Constants from "expo-constants";

type FirebaseExtras = {
  firebaseApiKey?: string;
  firebaseAuthDomain?: string;
  firebaseProjectId?: string;
  firebaseAppId?: string;
};

type FirebaseCompat = {
  initializeApp: (config: Record<string, string | undefined>) => unknown;
  auth: {
    (): {
      signInWithPopup: (provider: unknown) => Promise<{ user: { getIdToken: () => Promise<string> } }>;
    };
    GoogleAuthProvider: new () => {
      setCustomParameters: (params: Record<string, string>) => void;
    };
    OAuthProvider: new (providerId: string) => { addScope: (scope: string) => unknown };
  };
};

declare global {
  interface Window {
    firebase?: FirebaseCompat;
  }
}

const extra = Constants.expoConfig?.extra as FirebaseExtras | undefined;
let initialized = false;
let initPromise: Promise<ReturnType<FirebaseCompat["auth"]> | null> | null = null;

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(script);
  });
}

async function getFirebaseAuth(): Promise<ReturnType<FirebaseCompat["auth"]> | null> {
  if (
    !extra?.firebaseApiKey ||
    !extra.firebaseAuthDomain ||
    !extra.firebaseProjectId ||
    !extra.firebaseAppId
  ) {
    return null;
  }
  if (initPromise) return initPromise;

  initPromise = (async () => {
    await loadScript("https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js");
    await loadScript("https://www.gstatic.com/firebasejs/10.14.1/firebase-auth-compat.js");
    const firebase = window.firebase;
    if (!firebase) return null;

    if (!initialized) {
      firebase.initializeApp({
        apiKey: extra.firebaseApiKey,
        authDomain: extra.firebaseAuthDomain,
        projectId: extra.firebaseProjectId,
        appId: extra.firebaseAppId
      });
      initialized = true;
    }

    return firebase.auth();
  })();

  return initPromise;
}

export function isFirebaseClientConfigured(): boolean {
  return Boolean(
    extra?.firebaseApiKey &&
      extra.firebaseAuthDomain &&
      extra.firebaseProjectId &&
      extra.firebaseAppId
  );
}

export function useFirebaseConfigured(): boolean {
  return isFirebaseClientConfigured();
}

function mapFirebaseAuthError(error: unknown, providerLabel: string): Error {
  const code =
    typeof error === "object" && error && "code" in error ? String((error as { code: string }).code) : "";

  if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") {
    return new Error(`${providerLabel} sign-in was canceled.`);
  }
  if (code === "auth/popup-blocked") {
    return new Error(
      `${providerLabel} sign-in popup was blocked. Allow popups for this site and try again.`
    );
  }
  if (code === "auth/unauthorized-domain") {
    return new Error(
      "This domain is not authorized for Firebase sign-in. Add app.duts.tech under Authentication → Settings → Authorized domains."
    );
  }
  if (code === "auth/operation-not-allowed") {
    return new Error(
      `${providerLabel} sign-in is not enabled in Firebase. Enable it under Authentication → Sign-in method.`
    );
  }
  if (error instanceof Error && error.message) {
    return error;
  }
  return new Error(`${providerLabel} sign-in failed.`);
}

async function signIn(provider: "google" | "apple"): Promise<string> {
  const providerLabel = provider === "google" ? "Google" : "Apple";
  try {
    const auth = await getFirebaseAuth();
    if (!auth || !window.firebase) {
      throw new Error("Firebase is not configured for social sign-in.");
    }

    const providerInstance =
      provider === "google"
        ? (() => {
            const google = new window.firebase.auth.GoogleAuthProvider();
            google.setCustomParameters({ prompt: "select_account" });
            return google;
          })()
        : (() => {
            const apple = new window.firebase.auth.OAuthProvider("apple.com");
            apple.addScope("email");
            apple.addScope("name");
            return apple;
          })();

    const result = await auth.signInWithPopup(providerInstance);
    const token = await result.user.getIdToken();
    if (!token) throw new Error("Could not read a sign-in token.");
    return token;
  } catch (error) {
    throw mapFirebaseAuthError(error, providerLabel);
  }
}

export async function signInWithGooglePopup(): Promise<string> {
  return signIn("google");
}

export async function signInWithApplePopup(): Promise<string> {
  return signIn("apple");
}
