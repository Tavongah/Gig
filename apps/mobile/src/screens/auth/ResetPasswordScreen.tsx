import { useMemo, useState } from "react";
import { Text, TextInput, View } from "react-native";
import { useMutation } from "@tanstack/react-query";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { resetPasswordSchema, zodErrorsToFieldMap } from "@gigflow/shared";
import { api } from "../../lib/api";
import { defaultActiveRole } from "../../lib/auth";
import { Screen } from "../../components/Screen";
import { AppButton } from "../../components/AppButton";
import { DutsCard } from "../../components/DutsCard";
import { useSessionStore } from "../../stores/session.store";
import type { AuthStackParamList } from "../../navigation/auth-types";

type Props = NativeStackScreenProps<AuthStackParamList, "ResetPassword">;

function tokenFromLocation(): string {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get("token") ?? "";
}

export function ResetPasswordScreen({ navigation, route }: Props) {
  const initialToken = route.params?.token ?? tokenFromLocation();
  const [token] = useState(initialToken);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const setSession = useSessionStore((state) => state.setSession);
  const setActiveRole = useSessionStore((state) => state.setActiveRole);

  const hasToken = useMemo(() => token.trim().length >= 20, [token]);

  const mutation = useMutation({
    mutationFn: (payload: { token: string; password: string; confirmPassword: string }) =>
      api.resetPassword(payload),
    onSuccess: (session) => {
      setSession(session);
      setActiveRole(defaultActiveRole(session.user));
      setError(null);
      setFieldErrors({});
    },
    onError: (err: Error) => setError(err.message)
  });

  function handleSubmit(): void {
    const parsed = resetPasswordSchema.safeParse({ token, password, confirmPassword });
    if (!parsed.success) {
      setFieldErrors(zodErrorsToFieldMap(parsed.error));
      setError(null);
      return;
    }
    setFieldErrors({});
    setError(null);
    mutation.mutate(parsed.data);
  }

  return (
    <Screen>
      <View className="gap-5">
        <DutsCard className="gap-4 p-5">
          <Text className="text-xl font-black text-ink">Choose a new password</Text>
          {!hasToken ? (
            <Text className="text-sm text-danger">
              This reset link is missing or invalid. Request a new one from Forgot password.
            </Text>
          ) : (
            <Text className="text-sm text-muted">Enter a new password for your Duts account.</Text>
          )}
          <TextInput
            className="rounded-2xl border border-border bg-surface px-4 py-4 text-ink"
            value={password}
            onChangeText={setPassword}
            placeholder="New password"
            secureTextEntry
          />
          {fieldErrors.password ? <Text className="text-xs text-danger">{fieldErrors.password}</Text> : null}
          <TextInput
            className="rounded-2xl border border-border bg-surface px-4 py-4 text-ink"
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            placeholder="Confirm password"
            secureTextEntry
          />
          {fieldErrors.confirmPassword ? (
            <Text className="text-xs text-danger">{fieldErrors.confirmPassword}</Text>
          ) : null}
          {error ? <Text className="text-sm text-danger">{error}</Text> : null}
          <AppButton
            label={mutation.isPending ? "Saving..." : "Update password"}
            onPress={handleSubmit}
            disabled={!hasToken || mutation.isPending}
            loading={mutation.isPending}
          />
          <AppButton label="Back to login" variant="secondary" onPress={() => navigation.navigate("Login")} />
        </DutsCard>
      </View>
    </Screen>
  );
}
