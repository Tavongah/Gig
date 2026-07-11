import path from "node:path";
import { config as loadEnv } from "dotenv";
import { existsSync } from "node:fs";

loadEnv({ path: path.resolve(__dirname, "../../.env") });
loadEnv({ path: path.resolve(__dirname, ".env") });

const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:4000/v1";
const googleServicesJson = "./firebase/google-services.json";
const googleServicesPlist = "./firebase/GoogleService-Info.plist";
const hasNativeFirebaseFiles =
  existsSync(path.resolve(__dirname, googleServicesJson)) &&
  existsSync(path.resolve(__dirname, googleServicesPlist));

export default {
  expo: {
    name: "GIGFLOW",
    slug: "gigflow",
    scheme: "gigflow",
    version: "0.1.0",
    orientation: "portrait",
    userInterfaceStyle: "automatic",
    icon: "./assets/icon.png",
    splash: {
      image: "./assets/splash-icon.png",
      resizeMode: "contain",
      backgroundColor: "#1A1033"
    },
    web: {
      bundler: "metro",
      favicon: "./assets/favicon.png"
    },
    assetBundlePatterns: ["**/*"],
    ios: {
      supportsTablet: true,
      bundleIdentifier: "com.gigflow.ios",
      icon: "./assets/icon.png",
      ...(hasNativeFirebaseFiles ? { googleServicesFile: googleServicesPlist } : {})
    },
    android: {
      package: "com.gigflow.android",
      adaptiveIcon: {
        foregroundImage: "./assets/adaptive-icon.png",
        backgroundColor: "#1A1033"
      },
      ...(hasNativeFirebaseFiles ? { googleServicesFile: googleServicesJson } : {})
    },
    plugins: ["expo-font"],
    extra: {
      apiUrl,
      firebaseApiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY ?? "",
      firebaseAuthDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN ?? "",
      firebaseProjectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID ?? "",
      firebaseAppId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID ?? "",
      eas: {
        projectId: process.env.EAS_PROJECT_ID ?? ""
      }
    }
  }
};
