import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { useMutation } from "@tanstack/react-query";
import { api } from "../lib/api";
import { DUTS } from "../lib/theme";
import { Screen } from "../components/Screen";
import { TrustBadges } from "../components/TrustBadges";
import { HeroBanner } from "../components/HeroBanner";
import { AppButton } from "../components/AppButton";
import { DutsCard } from "../components/DutsCard";
import { useSessionStore } from "../stores/session.store";

export function OnboardingScreen() {
  const [role, setRole] = useState<"CLIENT" | "WORKER">("CLIENT");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const setSession = useSessionStore((state) => state.setSession);
  const setActiveRole = useSessionStore((state) => state.setActiveRole);

  const sessionMutation = useMutation({
    mutationFn: () => api.createSession({ email, fullName, role }),
    onSuccess: (session) => {
      setSession(session);
      setActiveRole(role);
    }
  });

  return (
    <Screen>
      <View className="gap-6">
        <HeroBanner
          showLogo
          title="Need an extra pair of hands today?"
          subtitle="Post a local gig and get matched with verified workers nearby."
        />

        <View className="flex-row gap-3">
          {(["CLIENT", "WORKER"] as const).map((value) => (
            <Pressable
              key={value}
              onPress={() => setRole(value)}
              className={`flex-1 rounded-2xl border p-4 ${
                role === value ? "border-brand bg-hero" : "border-border bg-card"
              }`}
            >
              <Text className={`text-center font-bold ${role === value ? "text-brand" : "text-label"}`}>
                {value === "CLIENT" ? "I need help" : "I want work"}
              </Text>
            </Pressable>
          ))}
        </View>

        <TrustBadges />

        <DutsCard className="gap-4 p-5">
          <Text className="text-xl font-black text-ink">Create your account</Text>
          <TextInput
            className="rounded-2xl border border-border bg-surface px-4 py-4 text-ink"
            value={fullName}
            onChangeText={setFullName}
            placeholder="Full name"
            placeholderTextColor={DUTS.placeholder}
          />
          <TextInput
            className="rounded-2xl border border-border bg-surface px-4 py-4 text-ink"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            placeholder="Email"
            placeholderTextColor={DUTS.placeholder}
          />
          <AppButton
            label={sessionMutation.isPending ? "Creating..." : "Get started"}
            onPress={() => sessionMutation.mutate()}
            disabled={!fullName.trim() || !email.trim() || sessionMutation.isPending}
            loading={sessionMutation.isPending}
          />
        </DutsCard>
      </View>
    </Screen>
  );
}
