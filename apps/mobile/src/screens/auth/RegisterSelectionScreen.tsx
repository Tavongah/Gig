import { useEffect, useRef, useState } from "react";
import { Animated, Platform, Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Screen } from "../../components/Screen";
import { DutsCard } from "../../components/DutsCard";
import { SocialAuthButtons } from "../../components/SocialAuthButtons";
import { AuthProgressHeader } from "../../components/AuthProgressHeader";
import { APP_NAME } from "../../lib/brand";
import { DUTS } from "../../lib/theme";
import { BrandLogo } from "../../components/BrandLogo";
import { WebAuthFrame } from "../../components/WebAuthFrame";
import type { AuthStackParamList } from "../../navigation/auth-types";

type Props = NativeStackScreenProps<AuthStackParamList, "RegisterSelection">;
type IntendedRole = "CLIENT" | "WORKER";

const OPTIONS: Array<{
  role: IntendedRole;
  title: string;
  subtitle: string;
  icon: keyof typeof Ionicons.glyphMap;
}> = [
  {
    role: "CLIENT",
    title: "I Need Help",
    subtitle: "Book trusted local workers for your tasks.",
    icon: "hand-left-outline"
  },
  {
    role: "WORKER",
    title: "I Want to Work",
    subtitle: "Find local gigs and earn money.",
    icon: "construct-outline"
  }
];

function RoleCard({
  title,
  subtitle,
  icon,
  selected,
  onPress
}: {
  title: string;
  subtitle: string;
  icon: keyof typeof Ionicons.glyphMap;
  selected: boolean;
  onPress: () => void;
}) {
  const scale = useRef(new Animated.Value(selected ? 1 : 0.98)).current;

  useEffect(() => {
    Animated.timing(scale, {
      toValue: selected ? 1 : 0.98,
      duration: 180,
      useNativeDriver: true
    }).start();
  }, [scale, selected]);

  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityState={{ selected }}
        accessibilityLabel={title}
        className={`min-h-[76px] flex-row items-center gap-4 rounded-3xl border-2 px-5 py-5 active:opacity-95 ${
          selected ? "border-brand bg-brand/10" : "border-border bg-card"
        }`}
      >
        <View
          className={`h-14 w-14 items-center justify-center rounded-2xl ${
            selected ? "bg-brand" : "bg-surface"
          }`}
        >
          <Ionicons name={icon} size={26} color={selected ? "#FFFFFF" : DUTS.purple} />
        </View>
        <View className="min-w-0 flex-1 gap-1">
          <Text className={`text-xl font-black ${selected ? "text-brand" : "text-ink"}`}>{title}</Text>
          <Text className="text-sm leading-5 text-muted">{subtitle}</Text>
        </View>
        <View
          className={`h-6 w-6 items-center justify-center rounded-full border-2 ${
            selected ? "border-brand bg-brand" : "border-muted/40 bg-card"
          }`}
        >
          {selected ? <Ionicons name="checkmark" size={14} color="#FFFFFF" /> : null}
        </View>
      </Pressable>
    </Animated.View>
  );
}

export function RegisterSelectionScreen({ navigation }: Props) {
  const [intendedRole, setIntendedRole] = useState<IntendedRole | null>(null);
  const [selectionError, setSelectionError] = useState<string | null>(null);

  function continueWithEmail(): void {
    if (!intendedRole) {
      setSelectionError("Please choose how you want to use DUTS.");
      return;
    }
    setSelectionError(null);
    navigation.navigate(intendedRole === "WORKER" ? "WorkerRegister" : "CustomerRegister");
  }

  if (Platform.OS !== "web") {
  return (
    <Screen>
      <View className="gap-5">
        <AuthProgressHeader currentStep="account" />
        <Text className="text-2xl font-black text-ink">How will you use {APP_NAME}?</Text>
        <Text className="text-base leading-6 text-muted">
          Choose one to get started. You can enable both Customer and Worker later from your Profile.
        </Text>

        <View className="gap-3">
          {OPTIONS.map((option) => (
            <RoleCard
              key={option.role}
              title={option.title}
              subtitle={option.subtitle}
              icon={option.icon}
              selected={intendedRole === option.role}
              onPress={() => {
                setIntendedRole(option.role);
                setSelectionError(null);
              }}
            />
          ))}
        </View>
        {selectionError ? <Text className="text-sm font-semibold text-danger">{selectionError}</Text> : null}

        {intendedRole ? (
          <DutsCard className="gap-4 p-5">
            <Text className="text-sm font-bold uppercase tracking-wider text-muted">Quick sign up</Text>
            <SocialAuthButtons intendedRole={intendedRole} />
          </DutsCard>
        ) : null}

        <Pressable onPress={continueWithEmail} accessibilityRole="button">
          <DutsCard className="gap-2 p-5">
            <Text className="text-lg font-black text-ink">Continue with email and password</Text>
            <Text className="text-sm text-muted">Create an account, then verify your email to sign in.</Text>
          </DutsCard>
        </Pressable>

        <Text className="text-center text-xs leading-5 text-muted">
          By continuing, you agree to our{" "}
          <Text className="font-bold text-brand" onPress={() => navigation.navigate("TermsOfService")}>
            Terms
          </Text>{" "}
          and{" "}
          <Text className="font-bold text-brand" onPress={() => navigation.navigate("PrivacyPolicy")}>
            Privacy Policy
          </Text>
          .
        </Text>
      </View>
    </Screen>
  );
  }

  const webOptions = [
    {
      role: "CLIENT" as const,
      title: "Shop on DUTS",
      subtitle: "Browse products, place orders and track deliveries."
    },
    {
      role: "WORKER" as const,
      title: "Work with DUTS",
      subtitle: "Continue to the worker application."
    }
  ];

  return (
    <Screen>
      <WebAuthFrame>
        <View className="gap-5">
          <BrandLogo size={72} />
          <View className="gap-2">
            <Text className="text-3xl font-black leading-9 text-ink">Join DUTS</Text>
            <Text className="text-base leading-6 text-muted">
              Create an account to shop, save your details and track your orders.
            </Text>
          </View>
          <View className="gap-2">
            {webOptions.map((option) => {
              const selected = intendedRole === option.role;
              const primary = option.role === "CLIENT";
              return (
                <Pressable
                  key={option.role}
                  onPress={() => {
                    setIntendedRole(option.role);
                    setSelectionError(null);
                  }}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  accessibilityLabel={option.title}
                  className={`duts-focus-ring flex-row items-center rounded-3xl px-5 ${
                    primary ? "min-h-[84px] py-4" : "min-h-[60px] border bg-card py-3"
                  } ${primary ? "" : selected ? "border-brand" : "border-border"}`}
                  style={primary ? { backgroundColor: DUTS.purple } : undefined}
                >
                  <View className="min-w-0 flex-1">
                    <Text className={`${primary ? "text-lg font-black text-white" : "text-base font-bold text-ink"}`}>
                      {option.title}
                    </Text>
                    <Text
                      className={`mt-1 text-sm leading-5 ${primary ? "" : "text-muted"}`}
                      style={primary ? { color: "rgba(255,255,255,0.9)" } : undefined}
                    >
                      {option.subtitle}
                    </Text>
                  </View>
                  {selected ? (
                    <Ionicons name="checkmark-circle" size={22} color={primary ? "#FFFFFF" : DUTS.purple} />
                  ) : null}
                </Pressable>
              );
            })}
          </View>
          {selectionError ? <Text className="text-sm font-semibold text-danger">{selectionError}</Text> : null}
          {intendedRole ? (
            <View className="gap-3 rounded-3xl border border-border bg-card px-5 py-5">
              <SocialAuthButtons intendedRole={intendedRole} />
            </View>
          ) : null}
          <Pressable onPress={continueWithEmail} accessibilityRole="button" className="duts-focus-ring">
            <View className="min-h-[48px] items-center justify-center rounded-full px-4" style={{ backgroundColor: DUTS.purple }}>
              <Text className="font-extrabold text-white">Continue with email</Text>
            </View>
          </Pressable>
          <Pressable
            onPress={() => navigation.navigate("Login")}
            accessibilityRole="button"
            className="duts-focus-ring min-h-[44px] items-center justify-center"
          >
            <Text className="text-center text-sm font-semibold text-brand">Back to sign in</Text>
          </Pressable>
          <Text className="text-center text-sm leading-5 text-muted">
            By continuing, you agree to our{" "}
            <Text className="font-bold text-brand" onPress={() => navigation.navigate("TermsOfService")}>
              Terms
            </Text>{" "}
            and{" "}
            <Text className="font-bold text-brand" onPress={() => navigation.navigate("PrivacyPolicy")}>
              Privacy Policy
            </Text>
            .
          </Text>
        </View>
      </WebAuthFrame>
    </Screen>
  );
}
