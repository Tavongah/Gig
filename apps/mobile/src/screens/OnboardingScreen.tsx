import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { useMutation } from "@tanstack/react-query";
import { api } from "../lib/api";
import { Screen } from "../components/Screen";
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
      <View className="gap-8">
        <View className="gap-3">
          <Text className="text-sm font-semibold uppercase tracking-[4px] text-brand">GigFlow</Text>
          <Text className="text-4xl font-black text-white">Local gigs, matched in real time.</Text>
          <Text className="text-base leading-6 text-slate-300">
            Hire trusted local workers or pick up nearby gigs on your schedule.
          </Text>
        </View>

        <View className="flex-row gap-3">
          {(["CLIENT", "WORKER"] as const).map((value) => (
            <Pressable
              key={value}
              onPress={() => setRole(value)}
              className={`flex-1 rounded-2xl border p-4 ${role === value ? "border-brand bg-brand/20" : "border-slate-700 bg-slate-900"}`}
            >
              <Text className="text-center font-bold text-white">{value === "CLIENT" ? "I need help" : "I want work"}</Text>
            </Pressable>
          ))}
        </View>

        <View className="gap-4 rounded-3xl bg-white p-5">
          <Text className="text-xl font-black text-ink">Create your account</Text>
          <TextInput
            className="rounded-2xl bg-slate-100 px-4 py-4 text-ink"
            value={fullName}
            onChangeText={setFullName}
            placeholder="Full name"
            placeholderTextColor="#94a3b8"
          />
          <TextInput
            className="rounded-2xl bg-slate-100 px-4 py-4 text-ink"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            placeholder="Email"
            placeholderTextColor="#94a3b8"
          />
          <Pressable
            disabled={!fullName.trim() || !email.trim() || sessionMutation.isPending}
            onPress={() => sessionMutation.mutate()}
            className="rounded-2xl bg-ink px-5 py-4"
          >
            <Text className="text-center font-black text-white">{sessionMutation.isPending ? "Creating..." : "Get started"}</Text>
          </Pressable>
        </View>
      </View>
    </Screen>
  );
}
