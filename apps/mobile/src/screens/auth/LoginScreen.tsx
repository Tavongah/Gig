import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { useMutation } from "@tanstack/react-query";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { api } from "../../lib/api";
import { defaultActiveRole } from "../../lib/auth";
import { Screen } from "../../components/Screen";
import { HeroBanner } from "../../components/HeroBanner";
import { APP_NAME } from "../../lib/brand";
import { AppButton } from "../../components/AppButton";
import { DutsCard } from "../../components/DutsCard";
import { useSessionStore } from "../../stores/session.store";
import type { AuthStackParamList } from "../../navigation/auth-types";

type Props = NativeStackScreenProps<AuthStackParamList, "Login">;

export function LoginScreen({ navigation }: Props) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const setSession = useSessionStore((state) => state.setSession);
  const setActiveRole = useSessionStore((state) => state.setActiveRole);

  const loginMutation = useMutation({
    mutationFn: () => api.login({ email, password }),
    onSuccess: (session) => {
      setSession(session);
      setActiveRole(defaultActiveRole(session.user));
      setError(null);
    },
    onError: (err: Error) => setError(err.message)
  });

  return (
    <Screen>
      <View className="gap-6">
        <HeroBanner eyebrow={APP_NAME} title="Welcome back" subtitle="Sign in to post gigs or accept work nearby." />

        <DutsCard className="gap-4 p-5">
          <Text className="text-xl font-black text-ink">Log in</Text>
          <TextInput
            className="rounded-2xl border border-border bg-surface px-4 py-4 text-ink"
            value={email}
            onChangeText={setEmail}
            placeholder="Email"
            autoCapitalize="none"
            keyboardType="email-address"
          />
          <TextInput
            className="rounded-2xl border border-border bg-surface px-4 py-4 text-ink"
            value={password}
            onChangeText={setPassword}
            placeholder="Password"
            secureTextEntry
          />
          {error ? <Text className="text-sm text-danger">{error}</Text> : null}
          <AppButton label={loginMutation.isPending ? "Signing in..." : "Log in"} onPress={() => loginMutation.mutate()} />
          <Pressable onPress={() => navigation.navigate("ForgotPassword")}>
            <Text className="text-center text-sm font-semibold text-brand">Forgot password?</Text>
          </Pressable>
        </DutsCard>

        <Pressable onPress={() => navigation.navigate("RegisterSelection")} className="py-2">
          <Text className="text-center text-muted">
            New to {APP_NAME}? <Text className="font-bold text-brand">Create an account</Text>
          </Text>
        </Pressable>
      </View>
    </Screen>
  );
}
