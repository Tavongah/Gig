import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import Animated, { FadeInUp } from "react-native-reanimated";
import { useMutation } from "@tanstack/react-query";
import { api } from "../lib/api";
import { Screen } from "../components/Screen";
import { useSessionStore } from "../stores/session.store";

export function OnboardingScreen() {
  const [role, setRole] = useState<"CLIENT" | "WORKER">("CLIENT");
  const [fullName, setFullName] = useState("Demo Founder");
  const [email, setEmail] = useState("founder@gigflow.local");
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
      <Animated.View entering={FadeInUp.duration(500)} className="gap-8">
        <View className="gap-3">
          <Text className="text-sm font-semibold uppercase tracking-[4px] text-brand">GigFlow</Text>
          <Text className="text-4xl font-black text-white">Local gigs, matched in real time.</Text>
          <Text className="text-base leading-6 text-slate-300">
            Launch as a client posting jobs or as a worker accepting nearby offers. The same app supports both sides of the marketplace.
          </Text>
        </View>

        <View className="flex-row gap-3">
          {(["CLIENT", "WORKER"] as const).map((value) => (
            <Pressable
              key={value}
              onPress={() => setRole(value)}
              className={`flex-1 rounded-2xl border p-4 ${role === value ? "border-brand bg-brand/20" : "border-slate-700 bg-slate-900"}`}
            >
              <Text className="text-center font-bold text-white">{value === "CLIENT" ? "Post gigs" : "Find work"}</Text>
            </Pressable>
          ))}
        </View>

        <View className="gap-4 rounded-3xl bg-white p-5">
          <Text className="text-xl font-black text-ink">Create your marketplace profile</Text>
          <TextInput className="rounded-2xl bg-slate-100 px-4 py-4 text-ink" value={fullName} onChangeText={setFullName} placeholder="Full name" />
          <TextInput
            className="rounded-2xl bg-slate-100 px-4 py-4 text-ink"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            placeholder="Email"
          />
          <Pressable onPress={() => sessionMutation.mutate()} className="rounded-2xl bg-ink px-5 py-4">
            <Text className="text-center font-black text-white">{sessionMutation.isPending ? "Creating..." : "Continue"}</Text>
          </Pressable>
        </View>
      </Animated.View>
    </Screen>
  );
}
