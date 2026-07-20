import Constants from "expo-constants";

const extra = Constants.expoConfig?.extra as { apiUrl?: string; webUrl?: string } | undefined;
const apiUrl = extra?.apiUrl ?? "http://localhost:4000/v1";

const webOrigins = [
  "http://localhost:8081",
  "http://localhost:19006",
  process.env.EXPO_PUBLIC_WEB_URL,
  extra?.webUrl,
  apiUrl.replace(/\/v1\/?$/, "")
].filter((value): value is string => Boolean(value));

export const appLinkingPrefixes = Array.from(new Set([...webOrigins, "gigflow://"]));
