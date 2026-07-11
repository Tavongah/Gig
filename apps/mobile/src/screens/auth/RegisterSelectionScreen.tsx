import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Screen } from "../../components/Screen";
import { DutsCard } from "../../components/DutsCard";
import { SocialAuthButtons } from "../../components/SocialAuthButtons";
import { AuthProgressHeader } from "../../components/AuthProgressHeader";
import { APP_NAME } from "../../lib/brand";
import type { AuthStackParamList } from "../../navigation/auth-types";

type Props = NativeStackScreenProps<AuthStackParamList, "RegisterSelection">;

export function RegisterSelectionScreen({ navigation }: Props) {
  const [intendedRole, setIntendedRole] = useState<"CLIENT" | "WORKER">("CLIENT");

  return (
    <Screen>
      <View className="gap-5">
        <AuthProgressHeader currentStep="account" />
        <Text className="text-2xl font-black text-ink">How will you use {APP_NAME}?</Text>
        <Text className="text-base text-muted">Choose customer or worker, then create your account with email or social sign-in.</Text>

        <View className="flex-row gap-3">
          <Pressable className="flex-1" onPress={() => setIntendedRole("CLIENT")}>
            <DutsCard className={`gap-2 p-5 ${intendedRole === "CLIENT" ? "border border-brand" : ""}`}>
              <Text className="text-lg font-black text-ink">Customer</Text>
              <Text className="text-sm text-muted">Post gigs and hire local workers.</Text>
            </DutsCard>
          </Pressable>
          <Pressable className="flex-1" onPress={() => setIntendedRole("WORKER")}>
            <DutsCard className={`gap-2 p-5 ${intendedRole === "WORKER" ? "border border-brand" : ""}`}>
              <Text className="text-lg font-black text-ink">Worker</Text>
              <Text className="text-sm text-muted">Accept gigs after admin approval.</Text>
            </DutsCard>
          </Pressable>
        </View>

        <DutsCard className="gap-4 p-5">
          <Text className="text-sm font-bold uppercase tracking-wider text-muted">Quick sign up</Text>
          <SocialAuthButtons intendedRole={intendedRole} />
        </DutsCard>

        <Pressable onPress={() => navigation.navigate(intendedRole === "WORKER" ? "WorkerRegister" : "CustomerRegister")}>
          <DutsCard className="gap-2 p-5">
            <Text className="text-lg font-black text-ink">Continue with email and password</Text>
            <Text className="text-sm text-muted">Use the full registration form instead.</Text>
          </DutsCard>
        </Pressable>
      </View>
    </Screen>
  );
}
