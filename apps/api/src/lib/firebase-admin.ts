import admin from "firebase-admin";
import { env } from "../config/env.js";
import { AppError } from "./errors.js";

let initialized = false;

function ensureFirebaseAdmin(): admin.app.App {
  if (!env.FIREBASE_PROJECT_ID || !env.FIREBASE_CLIENT_EMAIL || !env.FIREBASE_PRIVATE_KEY) {
    throw new AppError("FIREBASE_NOT_CONFIGURED", 503, "FIREBASE_NOT_CONFIGURED", {
      firebase: "Firebase Admin is not configured on the server."
    });
  }

  if (!initialized) {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: env.FIREBASE_PROJECT_ID,
        clientEmail: env.FIREBASE_CLIENT_EMAIL,
        privateKey: env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n")
      })
    });
    initialized = true;
  }

  return admin.app();
}

export function isFirebaseConfigured(): boolean {
  return Boolean(env.FIREBASE_PROJECT_ID && env.FIREBASE_CLIENT_EMAIL && env.FIREBASE_PRIVATE_KEY);
}

export async function verifyFirebaseIdToken(idToken: string): Promise<admin.auth.DecodedIdToken> {
  ensureFirebaseAdmin();
  return admin.auth().verifyIdToken(idToken);
}

export function getFirebaseProvider(decoded: admin.auth.DecodedIdToken): "google" | "apple" | "unknown" {
  const provider = decoded.firebase?.sign_in_provider;
  if (provider === "google.com") return "google";
  if (provider === "apple.com") return "apple";
  return "unknown";
}
