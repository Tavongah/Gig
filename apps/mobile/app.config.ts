const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:4000/v1";

export default {
  expo: {
    name: "GigFlow",
    slug: "gigflow",
    scheme: "gigflow",
    version: "0.1.0",
    orientation: "portrait",
    userInterfaceStyle: "automatic",
    assetBundlePatterns: ["**/*"],
    ios: {
      supportsTablet: true,
      bundleIdentifier: "com.gigflow.mobile"
    },
    android: {
      package: "com.gigflow.mobile",
      adaptiveIcon: {
        backgroundColor: "#0f172a"
      }
    },
    extra: {
      apiUrl,
      eas: {
        projectId: process.env.EAS_PROJECT_ID ?? ""
      }
    }
  }
};
