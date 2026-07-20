import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { useMutation } from "@tanstack/react-query";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { loginSchema, zodErrorsToFieldMap } from "@gigflow/shared";
import { api } from "../../lib/api";
import { defaultActiveRole } from "../../lib/auth";
import { Screen } from "../../components/Screen";
import { HeroBanner } from "../../components/HeroBanner";
import { APP_NAME } from "../../lib/brand";
import { AppButton } from "../../components/AppButton";
import { AuthOrDivider } from "../../components/AuthOrDivider";
import { SocialAuthButtons } from "../../components/SocialAuthButtons";
import { DutsCard } from "../../components/DutsCard";
import { useSessionStore } from "../../stores/session.store";
import type { AuthStackParamList } from "../../navigation/auth-types";

type Props = NativeStackScreenProps<AuthStackParamList, "Login">;

const inputClassName =
  "rounded-2xl border border-border bg-[#EFF6FF] px-4 py-4 text-base text-ink";

export function LoginScreen({ navigation }: Props) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const setSession = useSessionStore((state) => state.setSession);
  const setActiveRole = useSessionStore((state) => state.setActiveRole);

  const loginMutation = useMutation({
    mutationFn: (payload: { email: string; password: string }) => api.login(payload),
    onSuccess: (session) => {
      setSession(session);
      setActiveRole(defaultActiveRole(session.user));
      setError(null);
    },
    onError: (err: Error) => setError(err.message)
  });

  function handleSubmit(): void {
    const parsed = loginSchema.safeParse({ email, password });
    if (!parsed.success) {
      const fieldErrors = zodErrorsToFieldMap(parsed.error);
      setError(fieldErrors.email ?? fieldErrors.password ?? Object.values(fieldErrors)[0] ?? "Check your details.");
      return;
    }
    setError(null);
    loginMutation.mutate(parsed.data);
  }

  const isBusy = loginMutation.isPending;

  return (
    <Screen>
      <View className="gap-6">
        <HeroBanner showLogo title="Welcome back" subtitle="Sign in to post gigs or accept work nearby." />

        <DutsCard className="gap-4 p-5">
          <Text className="text-xl font-black text-ink">Log in</Text>

          <SocialAuthButtons intendedRole="CLIENT" disabled={isBusy} layout="row" />

          <AuthOrDivider />

          <TextInput
            className={inputClassName}
            value={email}
            onChangeText={setEmail}
            placeholder="Email"
            placeholderTextColor="#94A3B8"
            autoCapitalize="none"
            keyboardType="email-address"
            editable={!isBusy}
          />
          <TextInput
            className={inputClassName}
            value={password}
            onChangeText={setPassword}
            placeholder="Password"
            placeholderTextColor="#94A3B8"
            secureTextEntry
            editable={!isBusy}
          />
          {error ? <Text className="text-sm text-danger">{error}</Text> : null}
          <AppButton
            label={isBusy ? "Signing in..." : "Log in"}
            onPress={handleSubmit}
            disabled={isBusy}
            loading={isBusy}
          />
          <Pressable onPress={() => navigation.navigate("ForgotPassword")} disabled={isBusy}>
            <Text className="text-center text-sm font-semibold text-brand">Forgot password?</Text>
          </Pressable>
        </DutsCard>

        <Pressable onPress={() => navigation.navigate("RegisterSelection")} className="py-2" disabled={isBusy}>
          <Text className="text-center text-muted">
            New to {APP_NAME}? <Text className="font-bold text-brand">Create an account</Text>
          </Text>
        </Pressable>
      </View>
    </Screen>
  );
}
