import Constants from "expo-constants";
import * as AppleAuthentication from "expo-apple-authentication";
import * as Crypto from "expo-crypto";
import { Platform } from "react-native";
import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth, OAuthProvider, signInWithCredential } from "firebase/auth";

type FirebaseExtras = {
  firebaseApiKey?: string;
  firebaseAuthDomain?: string;
  firebaseProjectId?: string;
  firebaseAppId?: string;
};

function getExtras(): FirebaseExtras {
  return (Constants.expoConfig?.extra ?? {}) as FirebaseExtras;
}

export function isFirebaseClientConfigured(): boolean {
  const extra = getExtras();
  return Boolean(
    extra.firebaseApiKey &&
      extra.firebaseAuthDomain &&
      extra.firebaseProjectId &&
      extra.firebaseAppId
  );
}

export function useFirebaseConfigured(): boolean {
  return isFirebaseClientConfigured();
}

function getFirebaseAuth() {
  const extra = getExtras();
  if (!isFirebaseClientConfigured()) {
    throw new Error("Firebase is not configured for this build.");
  }

  const config = {
    apiKey: extra.firebaseApiKey,
    authDomain: extra.firebaseAuthDomain,
    projectId: extra.firebaseProjectId,
    appId: extra.firebaseAppId
  };

  const app = getApps().length > 0 ? getApp() : initializeApp(config);
  return getAuth(app);
}

export async function signInWithApplePopup(): Promise<string> {
  if (Platform.OS !== "ios") {
    throw new Error("Apple Sign-In is available on iPhone and iPad.");
  }

  const available = await AppleAuthentication.isAvailableAsync();
  if (!available) {
    throw new Error("Apple Sign-In is not available on this device.");
  }

  const rawNonce = Crypto.randomUUID();
  const hashedNonce = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, rawNonce);

  let appleCredential: AppleAuthentication.AppleAuthenticationCredential;
  try {
    appleCredential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL
      ],
      nonce: hashedNonce
    });
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
    if (code === "ERR_REQUEST_CANCELED") {
      throw new Error("Apple Sign-In was canceled.");
    }
    throw error instanceof Error ? error : new Error("Apple Sign-In failed.");
  }

  if (!appleCredential.identityToken) {
    throw new Error("Apple Sign-In did not return an identity token.");
  }

  const provider = new OAuthProvider("apple.com");
  const credential = provider.credential({
    idToken: appleCredential.identityToken,
    rawNonce
  });

  const result = await signInWithCredential(getFirebaseAuth(), credential);
  return result.user.getIdToken();
}

export async function signInWithGooglePopup(): Promise<string> {
  throw new Error("Google sign-in on iOS is not ready yet. Use Apple or email.");
}
