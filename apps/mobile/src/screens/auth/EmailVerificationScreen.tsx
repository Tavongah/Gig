import { useState } from "react";
import { Text, View } from "react-native";
import { useMutation } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { DeleteAccountButton } from "../../components/DeleteAccountButton";
import { AuthProgressHeader } from "../../components/AuthProgressHeader";
import { AppButton } from "../../components/AppButton";
import { DutsCard } from "../../components/DutsCard";
import { Screen } from "../../components/Screen";
import { useSessionStore } from "../../stores/session.store";

export function EmailVerificationScreen() {
  const session = useSessionStore((state) => state.session)!;
  const setProfile = useSessionStore((state) => state.setProfile);
  const signOut = useSessionStore((state) => state.signOut);
  const [message, setMessage] = useState<string | null>(null);

  const resendMutation = useMutation({
    mutationFn: () => api.resendEmailVerification(session.token),
    onSuccess: () => setMessage("Verification email sent. Check your inbox and spam folder."),
    onError: (error: Error) => setMessage(error.message)
  });

  const refreshMutation = useMutation({
    mutationFn: () => api.getMe(session.token),
    onSuccess: ({ user }) => {
      setProfile(user);
      setMessage(
        user.emailVerified
          ? "Email verified. Continuing..."
          : "Email not verified yet. Open the link we sent, then tap again."
      );
    },
    onError: (error: Error) => setMessage(error.message)
  });

  return (
    <Screen>
      <View className="gap-5">
        <AuthProgressHeader currentStep="email" />
        <DutsCard className="gap-4 p-5">
          <Text className="text-2xl font-black text-ink">Check your inbox</Text>
          <Text className="text-sm leading-6 text-muted">
            We’ve sent a verification email to {session.user.email}. Please verify your email before signing in.
          </Text>
          <Text className="text-sm leading-6 text-muted">
            The link expires in 24 hours. After you verify, come back here and tap “I verified my email.”
          </Text>
          {__DEV__ ? (
            <Text className="text-xs text-muted">
              Local/dev: check the API terminal for the verification link, or set LOG_VERIFICATION_TO_CONSOLE=true on the API.
            </Text>
          ) : null}
          <AppButton
            label={resendMutation.isPending ? "Sending..." : "Resend verification email"}
            onPress={() => resendMutation.mutate()}
            disabled={resendMutation.isPending}
          />
          <AppButton
            label={refreshMutation.isPending ? "Checking..." : "I verified my email"}
            variant="secondary"
            onPress={() => refreshMutation.mutate()}
            disabled={refreshMutation.isPending}
          />
          <AppButton label="Back to login" variant="secondary" onPress={() => void signOut()} />
          <DeleteAccountButton />
          {message ? <Text className="text-sm text-muted">{message}</Text> : null}
        </DutsCard>
      </View>
    </Screen>
  );
}
