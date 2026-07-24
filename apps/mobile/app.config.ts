import path from "node:path";
import { config as loadEnv } from "dotenv";
import { existsSync } from "node:fs";

loadEnv({ path: path.resolve(__dirname, "../../.env") });
loadEnv({ path: path.resolve(__dirname, ".env") });

const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:4000/v1";
const googleServicesJson = "./firebase/google-services.json";
const googleServicesPlist = "./firebase/GoogleService-Info.plist";
const hasIosFirebase = existsSync(path.resolve(__dirname, googleServicesPlist));
const hasAndroidFirebase = existsSync(path.resolve(__dirname, googleServicesJson));

export default {
  expo: {
    name: "DUTS",
    slug: "gigflow",
    owner: "tdutumas-team",
    scheme: "gigflow",
    version: "1.0.0",
    orientation: "portrait",
    userInterfaceStyle: "automatic",
    icon: "./assets/icon.png",
    splash: {
      image: "./assets/splash-icon.png",
      resizeMode: "contain",
      backgroundColor: "#FFFFFF"
    },
    web: {
      bundler: "metro",
      favicon: "./assets/favicon.png"
    },
    assetBundlePatterns: ["**/*"],
    ios: {
      supportsTablet: true,
      bundleIdentifier: "com.gigflow.ios",
      usesAppleSignIn: true,
      icon: "./assets/icon.png",
      infoPlist: {
        NSLocationWhenInUseUsageDescription:
          "DUTS uses your location to show nearby gigs and match you with local workers.",
        NSCameraUsageDescription: "DUTS uses your camera so you can take a profile picture.",
        NSPhotoLibraryUsageDescription: "DUTS uses your photos so you can set a profile picture.",
        NSPhotoLibraryAddUsageDescription: "DUTS saves cropped profile photos to your library when needed.",
        ITSAppUsesNonExemptEncryption: false,
        UIBackgroundModes: ["remote-notification"]
      },
      ...(hasIosFirebase ? { googleServicesFile: googleServicesPlist } : {})
    },
    android: {
      package: "com.gigflow.android",
      versionCode: 1,
      adaptiveIcon: {
        foregroundImage: "./assets/adaptive-icon.png",
        backgroundColor: "#FFFFFF"
      },
      permissions: [
        "ACCESS_COARSE_LOCATION",
        "ACCESS_FINE_LOCATION",
        "INTERNET",
        "ACCESS_NETWORK_STATE",
        "CAMERA",
        "READ_MEDIA_IMAGES",
        "READ_EXTERNAL_STORAGE"
      ],
      ...(hasAndroidFirebase ? { googleServicesFile: googleServicesJson } : {})
    },
    plugins: [
      "expo-font",
      "expo-apple-authentication",
      "@react-native-community/datetimepicker",
      [
        "expo-notifications",
        {
          icon: "./assets/icon.png",
          color: "#6C3CE1",
          sounds: [],
          mode: "production"
        }
      ],
      [
        "expo-image-picker",
        {
          photosPermission: "DUTS uses your photos so you can set a profile picture.",
          cameraPermission: "DUTS uses your camera so you can take a profile picture."
        }
      ],
      [
        "expo-location",
        {
          locationWhenInUsePermission:
            "DUTS uses your location to show nearby gigs and match you with local workers.",
          isIosBackgroundLocationEnabled: false,
          isAndroidBackgroundLocationEnabled: false
        }
      ]
    ],
    extra: {
      apiUrl,
      webUrl: process.env.EXPO_PUBLIC_WEB_URL ?? "",
      supportEmail: process.env.EXPO_PUBLIC_SUPPORT_EMAIL ?? "support@duts.tech",
      supportPhone: process.env.EXPO_PUBLIC_SUPPORT_PHONE ?? "+12036769717",
      supportHours:
        process.env.EXPO_PUBLIC_SUPPORT_HOURS ??
        "Monday – Saturday · 8:00 AM – 8:00 PM (Eastern Time)",
      firebaseApiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY ?? "",
      firebaseAuthDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN ?? "",
      firebaseProjectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID ?? "",
      firebaseAppId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID ?? "",
      eas: {
        projectId: process.env.EAS_PROJECT_ID || "7b30aedd-9b50-43d0-af22-3fee6842c372"
      }
    }
  }
};
