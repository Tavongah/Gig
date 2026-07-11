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
    GoogleAuthProvider: new () => unknown;
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
  if (!extra?.firebaseApiKey || !extra.firebaseAuthDomain || !extra.firebaseProjectId) {
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
  return Boolean(extra?.firebaseApiKey && extra.firebaseAuthDomain && extra.firebaseProjectId);
}

export function useFirebaseConfigured(): boolean {
  return isFirebaseClientConfigured();
}

async function signIn(provider: "google" | "apple"): Promise<string> {
  const auth = await getFirebaseAuth();
  if (!auth || !window.firebase) {
    throw new Error("Firebase is not configured for social sign-in.");
  }

  const providerInstance =
    provider === "google"
      ? new window.firebase.auth.GoogleAuthProvider()
      : (() => {
          const apple = new window.firebase!.auth.OAuthProvider("apple.com");
          apple.addScope("email");
          apple.addScope("name");
          return apple;
        })();

  const result = await auth.signInWithPopup(providerInstance);
  const token = await result.user.getIdToken();
  if (!token) throw new Error("Could not read a sign-in token.");
  return token;
}

export async function signInWithGooglePopup(): Promise<string> {
  return signIn("google");
}

export async function signInWithApplePopup(): Promise<string> {
  return signIn("apple");
}
