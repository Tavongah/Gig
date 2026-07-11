export function isFirebaseClientConfigured(): boolean {
  return false;
}

export async function signInWithGooglePopup(): Promise<string> {
  throw new Error("Google sign-in is available on web when Firebase is configured.");
}

export async function signInWithApplePopup(): Promise<string> {
  throw new Error("Apple sign-in is available on web when Firebase is configured.");
}

export function useFirebaseConfigured(): boolean {
  return false;
}
