import { useState } from "react";
import { Text, View } from "react-native";
import { useMutation } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { AuthProgressHeader } from "../../components/AuthProgressHeader";
import { AppButton } from "../../components/AppButton";
import { DutsCard } from "../../components/DutsCard";
import { Screen } from "../../components/Screen";
import { useSessionStore } from "../../stores/session.store";

export function EmailVerificationScreen() {
  const session = useSessionStore((state) => state.session)!;
  const setProfile = useSessionStore((state) => state.setProfile);
  const [message, setMessage] = useState<string | null>(null);

  const resendMutation = useMutation({
    mutationFn: () => api.resendEmailVerification(session.token),
    onSuccess: () => setMessage("Verification email sent. Check your inbox."),
    onError: (error: Error) => setMessage(error.message)
  });

  const refreshMutation = useMutation({
    mutationFn: () => api.getMe(session.token),
    onSuccess: ({ user }) => {
      setProfile(user);
      setMessage(user.emailVerified ? "Email verified. Continuing..." : "Email not verified yet.");
    }
  });

  return (
    <Screen>
      <View className="gap-5">
        <AuthProgressHeader currentStep="email" />
        <DutsCard className="gap-4 p-5">
          <Text className="text-2xl font-black text-ink">Verify your email</Text>
          <Text className="text-sm text-muted">
            Please verify your email to continue. We sent a link to {session.user.email}.
          </Text>
          {__DEV__ ? (
            <Text className="text-xs text-muted">
              Local dev: check the API terminal for the verification link, or set LOG_VERIFICATION_TO_CONSOLE=true on hosted API during beta.
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
          {message ? <Text className="text-sm text-muted">{message}</Text> : null}
        </DutsCard>
      </View>
    </Screen>
  );
}
