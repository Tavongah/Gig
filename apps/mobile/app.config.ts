const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:4000/v1";

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
      bundleIdentifier: "com.gigflow.mobile",
      icon: "./assets/icon.png"
    },
    android: {
      package: "com.gigflow.mobile",
      adaptiveIcon: {
        foregroundImage: "./assets/adaptive-icon.png",
        backgroundColor: "#1A1033"
      }
    },
    plugins: ["expo-font"],
    extra: {
      apiUrl,
      eas: {
        projectId: process.env.EAS_PROJECT_ID ?? ""
      }
    }
  }
};
