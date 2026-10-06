import Constants from "expo-constants";

type FirebaseExtras = {
  firebaseApiKey?: string;
  firebaseAuthDomain?: string;
  firebaseProjectId?: string;
  firebaseAppId?: string;
};

type FirebaseUser = { getIdToken: () => Promise<string> };

type FirebaseAuthInstance = {
  signInWithPopup: (provider: unknown) => Promise<{ user: FirebaseUser; providerId?: string }>;
  signInWithRedirect: (provider: unknown) => Promise<void>;
  getRedirectResult: () => Promise<{ user?: FirebaseUser; providerId?: string; credential?: { providerId?: string } } | null>;
};

type FirebaseCompat = {
  initializeApp: (config: Record<string, string | undefined>) => unknown;
  auth: {
    (): FirebaseAuthInstance;
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
const PENDING_SOCIAL_AUTH_KEY = "duts.pendingSocialAuth";

let initialized = false;
let initPromise: Promise<FirebaseAuthInstance | null> | null = null;

export type SocialAuthProvider = "google" | "apple";

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

async function getFirebaseAuth(): Promise<FirebaseAuthInstance | null> {
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

function shouldUseRedirectFlow(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  const iOS =
    /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const standalone =
    window.matchMedia?.("(display-mode: standalone)")?.matches === true ||
    (navigator as { standalone?: boolean }).standalone === true;
  return iOS || standalone;
}

function persistPendingSocialAuth(provider: SocialAuthProvider, intendedRole?: "CLIENT" | "WORKER"): void {
  try {
    sessionStorage.setItem(
      PENDING_SOCIAL_AUTH_KEY,
      JSON.stringify({ provider, intendedRole: intendedRole ?? "CLIENT" })
    );
  } catch {
    /* ignore quota / private mode */
  }
}

export function readPendingSocialAuth(): { provider: SocialAuthProvider; intendedRole: "CLIENT" | "WORKER" } | null {
  try {
    const raw = sessionStorage.getItem(PENDING_SOCIAL_AUTH_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { provider?: string; intendedRole?: string };
    const provider = parsed.provider === "apple" ? "apple" : parsed.provider === "google" ? "google" : null;
    if (!provider) return null;
    return {
      provider,
      intendedRole: parsed.intendedRole === "WORKER" ? "WORKER" : "CLIENT"
    };
  } catch {
    return null;
  }
}

export function clearPendingSocialAuth(): void {
  try {
    sessionStorage.removeItem(PENDING_SOCIAL_AUTH_KEY);
  } catch {
    /* ignore */
  }
}

function providerFromRedirect(result: { providerId?: string; credential?: { providerId?: string } } | null): SocialAuthProvider {
  const id = `${result?.providerId ?? ""} ${result?.credential?.providerId ?? ""}`.toLowerCase();
  if (id.includes("apple")) return "apple";
  return "google";
}

export function mapFirebaseAuthError(error: unknown, providerLabel: string): Error {
  const code =
    typeof error === "object" && error && "code" in error ? String((error as { code: string }).code) : "";

  if (
    code === "auth/popup-closed-by-user" ||
    code === "auth/cancelled-popup-request" ||
    code === "auth/user-cancelled" ||
    code === "auth/redirect-cancelled-by-user"
  ) {
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
  return new Error(`${providerLabel} sign-in failed. Try again.`);
}

function createProvider(provider: SocialAuthProvider): unknown {
  if (!window.firebase) throw new Error("Firebase is not configured for social sign-in.");
  if (provider === "google") {
    const google = new window.firebase.auth.GoogleAuthProvider();
    google.setCustomParameters({ prompt: "select_account" });
    return google;
  }
  const apple = new window.firebase.auth.OAuthProvider("apple.com");
  apple.addScope("email");
  apple.addScope("name");
  return apple;
}

export async function completePendingRedirectSignIn(): Promise<{
  idToken: string;
  provider: SocialAuthProvider;
} | null> {
  try {
    const auth = await getFirebaseAuth();
    if (!auth) return null;
    const result = await auth.getRedirectResult();
    if (!result?.user) return null;
    const token = await result.user.getIdToken();
    if (!token) return null;
    return { idToken: token, provider: providerFromRedirect(result) };
  } catch (error) {
    clearPendingSocialAuth();
    throw mapFirebaseAuthError(error, "Sign-in");
  }
}

async function signIn(provider: SocialAuthProvider, intendedRole?: "CLIENT" | "WORKER"): Promise<string> {
  const providerLabel = provider === "google" ? "Google" : "Apple";
  try {
    const auth = await getFirebaseAuth();
    if (!auth || !window.firebase) {
      throw new Error("Firebase is not configured for social sign-in.");
    }

    const providerInstance = createProvider(provider);
    if (shouldUseRedirectFlow()) {
      persistPendingSocialAuth(provider, intendedRole);
      await auth.signInWithRedirect(providerInstance);
      return new Promise(() => undefined);
    }

    try {
      const result = await auth.signInWithPopup(providerInstance);
      const token = await result.user.getIdToken();
      if (!token) throw new Error("Could not read a sign-in token.");
      return token;
    } catch (popupError) {
      const code =
        typeof popupError === "object" && popupError && "code" in popupError
          ? String((popupError as { code: string }).code)
          : "";
      if (code !== "auth/popup-blocked" && code !== "auth/operation-not-supported-in-this-environment") {
        throw popupError;
      }
      persistPendingSocialAuth(provider, intendedRole);
      await auth.signInWithRedirect(providerInstance);
      return new Promise(() => undefined);
    }
  } catch (error) {
    throw mapFirebaseAuthError(error, providerLabel);
  }
}

export async function signInWithGooglePopup(intendedRole?: "CLIENT" | "WORKER"): Promise<string> {
  return signIn("google", intendedRole);
}

export async function signInWithApplePopup(intendedRole?: "CLIENT" | "WORKER"): Promise<string> {
  return signIn("apple", intendedRole);
}
