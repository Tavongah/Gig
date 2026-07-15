import type { ReactNode } from "react";
import { ActivityIndicator, Platform, Pressable, Text, View } from "react-native";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { defaultActiveRole } from "../lib/auth";
import { isFirebaseClientConfigured, signInWithApplePopup, signInWithGooglePopup } from "../lib/firebase-auth";
import { DUTS } from "../lib/theme";
import { useSessionStore } from "../stores/session.store";
import { AppleIcon, GoogleIcon } from "./SocialProviderIcons";

interface SocialAuthButtonsProps {
  intendedRole?: "CLIENT" | "WORKER";
  disabled?: boolean;
  layout?: "row" | "stack";
}

function SocialAuthButton({
  label,
  icon,
  onPress,
  disabled,
  loading,
  compact
}: {
  label: string;
  icon: ReactNode;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  compact?: boolean;
}) {
  const isDisabled = disabled || loading;

  return (
    <Pressable
      disabled={isDisabled}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      className={`min-h-[48px] flex-row items-center justify-center gap-2 rounded-2xl border border-border bg-card px-3 py-3.5 active:opacity-90 ${
        compact ? "flex-1" : "w-full"
      } ${isDisabled ? "opacity-60" : ""}`}
    >
      {loading ? (
        <ActivityIndicator size="small" color={DUTS.purple} />
      ) : (
        <View className="shrink-0">{icon}</View>
      )}
      <Text
        className={`font-semibold text-ink ${compact ? "text-[11px] leading-4" : "text-sm"}`}
        numberOfLines={2}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function SocialAuthButtons({
  intendedRole = "CLIENT",
  disabled = false,
  layout = "row"
}: SocialAuthButtonsProps) {
  const setSession = useSessionStore((state) => state.setSession);
  const setActiveRole = useSessionStore((state) => state.setActiveRole);
  const configQuery = useQuery({
    queryKey: ["auth-config"],
    queryFn: () => api.getAuthConfig()
  });

  const socialMutation = useMutation({
    mutationFn: async (provider: "google" | "apple") => {
      const idToken = provider === "google" ? await signInWithGooglePopup() : await signInWithApplePopup();
      return api.socialLogin({ provider, idToken, intendedRole });
    },
    onSuccess: (session) => {
      setSession(session);
      setActiveRole(defaultActiveRole(session.user));
    }
  });

  const clientReady = isFirebaseClientConfigured();
  const serverReady = Boolean(configQuery.data?.firebaseConfigured);
  const firebaseReady = clientReady && serverReady;
  const isPending = socialMutation.isPending;
  const pendingProvider = socialMutation.variables;
  const showGoogle = Platform.OS === "web";
  const showApple = Platform.OS === "web" || Platform.OS === "ios";

  if (!showGoogle && !showApple) {
    return null;
  }

  const buttons = (
    <>
      {showGoogle ? (
        <SocialAuthButton
          compact={layout === "row"}
          label="Continue with Google"
          icon={<GoogleIcon size={20} />}
          onPress={() => socialMutation.mutate("google")}
          disabled={disabled || !firebaseReady || (isPending && pendingProvider !== "google")}
          loading={isPending && pendingProvider === "google"}
        />
      ) : null}
      {showApple ? (
        <SocialAuthButton
          compact={layout === "row"}
          label="Continue with Apple"
          icon={<AppleIcon size={20} />}
          onPress={() => socialMutation.mutate("apple")}
          disabled={disabled || !firebaseReady || (isPending && pendingProvider !== "apple")}
          loading={isPending && pendingProvider === "apple"}
        />
      ) : null}
    </>
  );

  return (
    <View className="gap-3">
      <View className={layout === "row" ? "flex-row gap-3" : "gap-3"}>{buttons}</View>
      {__DEV__ && !firebaseReady ? (
        <Text className="text-center text-xs leading-5 text-muted">
          {!clientReady && !serverReady
            ? "Add Firebase keys to apps/mobile/.env and apps/api/.env, then restart Expo and the API. See FIREBASE_SETUP.md."
            : !clientReady
              ? "Add EXPO_PUBLIC_FIREBASE_* keys to apps/mobile/.env and restart Expo. See FIREBASE_SETUP.md."
              : "Add FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY to apps/api/.env and restart the API."}
        </Text>
      ) : null}
      {socialMutation.error ? <Text className="text-sm text-danger">{socialMutation.error.message}</Text> : null}
    </View>
  );
}
