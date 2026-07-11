import { useState } from "react";
import { Text, TextInput, View } from "react-native";
import { useMutation } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { AuthProgressHeader } from "../../components/AuthProgressHeader";
import { AppButton } from "../../components/AppButton";
import { DutsCard } from "../../components/DutsCard";
import { Screen } from "../../components/Screen";
import { useSessionStore } from "../../stores/session.store";

export function PhoneVerificationScreen() {
  const session = useSessionStore((state) => state.session)!;
  const setProfile = useSessionStore((state) => state.setProfile);
  const [phoneNumber, setPhoneNumber] = useState(session.user.phoneNumber ?? "");
  const [code, setCode] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  const requestMutation = useMutation({
    mutationFn: () => api.requestPhoneOtp(phoneNumber, session.token),
    onSuccess: (result) => {
      setMessage(result.devCode ? `Dev code: ${result.devCode}` : "Verification code sent.");
    },
    onError: (error: Error) => setMessage(error.message)
  });

  const verifyMutation = useMutation({
    mutationFn: () => api.verifyPhoneOtp({ phoneNumber, code }, session.token),
    onSuccess: ({ user }) => {
      setProfile(user);
      setMessage("Phone verified.");
    },
    onError: (error: Error) => setMessage(error.message)
  });

  return (
    <Screen>
      <View className="gap-5">
        <AuthProgressHeader currentStep="phone" />
        <DutsCard className="gap-4 p-5">
          <Text className="text-2xl font-black text-ink">Verify your phone</Text>
          <Text className="text-sm text-muted">Enter your phone number and the 6-digit code we send you.</Text>
          <TextInput
            className="rounded-2xl border border-border bg-surface px-4 py-4 text-ink"
            value={phoneNumber}
            onChangeText={setPhoneNumber}
            placeholder="Phone number"
            keyboardType="phone-pad"
          />
          <AppButton
            label={requestMutation.isPending ? "Sending code..." : "Send verification code"}
            onPress={() => requestMutation.mutate()}
            disabled={requestMutation.isPending || phoneNumber.trim().length < 7}
          />
          <TextInput
            className="rounded-2xl border border-border bg-surface px-4 py-4 text-ink"
            value={code}
            onChangeText={setCode}
            placeholder="6-digit code"
            keyboardType="number-pad"
            maxLength={6}
          />
          <AppButton
            label={verifyMutation.isPending ? "Verifying..." : "Verify phone"}
            onPress={() => verifyMutation.mutate()}
            disabled={verifyMutation.isPending || code.length !== 6}
          />
          {message ? <Text className="text-sm text-muted">{message}</Text> : null}
        </DutsCard>
      </View>
    </Screen>
  );
}
