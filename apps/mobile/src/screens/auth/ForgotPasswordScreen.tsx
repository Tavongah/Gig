import { useState } from "react";
import { Text, TextInput, View } from "react-native";
import { useMutation } from "@tanstack/react-query";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { forgotPasswordSchema, zodErrorsToFieldMap } from "@gigflow/shared";
import { api } from "../../lib/api";
import { Screen } from "../../components/Screen";
import { AppButton } from "../../components/AppButton";
import { DutsCard } from "../../components/DutsCard";
import type { AuthStackParamList } from "../../navigation/auth-types";

type Props = NativeStackScreenProps<AuthStackParamList, "ForgotPassword">;

export function ForgotPasswordScreen(_props: Props) {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (value: string) => api.forgotPassword(value),
    onSuccess: (result) => {
      setMessage(result.message);
      setError(null);
    },
    onError: (err: Error) => setError(err.message)
  });

  function handleSubmit(): void {
    const parsed = forgotPasswordSchema.safeParse({ email });
    if (!parsed.success) {
      const fieldErrors = zodErrorsToFieldMap(parsed.error);
      setError(fieldErrors.email ?? Object.values(fieldErrors)[0] ?? "Enter a valid email.");
      setMessage(null);
      return;
    }
    setError(null);
    mutation.mutate(parsed.data.email);
  }

  return (
    <Screen>
      <View className="gap-5">
        <DutsCard className="gap-4 p-5">
          <Text className="text-xl font-black text-ink">Forgot password</Text>
          <Text className="text-sm text-muted">
            Enter your email and we will send reset instructions if an account exists.
          </Text>
          <TextInput
            className="rounded-2xl border border-border bg-surface px-4 py-4 text-ink"
            value={email}
            onChangeText={setEmail}
            placeholder="Email"
            autoCapitalize="none"
            keyboardType="email-address"
          />
          {message ? <Text className="text-sm text-success">{message}</Text> : null}
          {error ? <Text className="text-sm text-danger">{error}</Text> : null}
          <AppButton
            label={mutation.isPending ? "Sending..." : "Send reset link"}
            onPress={handleSubmit}
            disabled={mutation.isPending}
            loading={mutation.isPending}
          />
        </DutsCard>
      </View>
    </Screen>
  );
}
