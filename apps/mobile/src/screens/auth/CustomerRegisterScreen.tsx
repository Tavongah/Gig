import { useState } from "react";
import { Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useMutation } from "@tanstack/react-query";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { customerRegisterSchema, zodErrorsToFieldMap } from "@gigflow/shared";
import { api, ApiValidationError } from "../../lib/api";
import { defaultActiveRole } from "../../lib/auth";
import { Screen } from "../../components/Screen";
import { AppButton } from "../../components/AppButton";
import { DutsCard } from "../../components/DutsCard";
import { AuthProgressHeader } from "../../components/AuthProgressHeader";
import { BrandLogo } from "../../components/BrandLogo";
import { WebAuthFrame } from "../../components/WebAuthFrame";
import { useSessionStore } from "../../stores/session.store";
import type { AuthStackParamList } from "../../navigation/auth-types";

type Props = NativeStackScreenProps<AuthStackParamList, "CustomerRegister">;

export function CustomerRegisterScreen({ navigation }: Props) {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const setSession = useSessionStore((state) => state.setSession);
  const setActiveRole = useSessionStore((state) => state.setActiveRole);

  const registerMutation = useMutation({
    mutationFn: (payload: {
      fullName: string;
      email: string;
      password: string;
      confirmPassword: string;
      acceptTerms: true;
    }) => api.registerCustomer(payload),
    onSuccess: (session) => {
      setSession(session);
      setActiveRole(defaultActiveRole(session.user));
      setFieldErrors({});
    },
    onError: (err: Error) => {
      if (err instanceof ApiValidationError) {
        setFieldErrors(err.fieldErrors);
        return;
      }
      setFieldErrors({ form: err.message });
    }
  });

  function handleSubmit(): void {
    const parsed = customerRegisterSchema.safeParse({
      fullName,
      email,
      password,
      confirmPassword,
      acceptTerms: acceptTerms ? true : false
    });
    if (!parsed.success) {
      setFieldErrors(zodErrorsToFieldMap(parsed.error));
      return;
    }
    setFieldErrors({});
    registerMutation.mutate(parsed.data);
  }

  if (Platform.OS !== "web") {
  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 16, paddingBottom: 28 }}>
        <AuthProgressHeader currentStep="account" />
        <DutsCard className="gap-4 p-5">
          <Text className="text-xl font-black text-ink">Create your account</Text>
          <Text className="text-sm text-muted">
            Register with email and password. We’ll send a verification link before you can sign in.
          </Text>

          {(
            [
              ["fullName", "Full name", fullName, setFullName, false, "default"],
              ["email", "Email", email, setEmail, false, "email-address"],
              ["password", "Password", password, setPassword, true, "default"],
              ["confirmPassword", "Confirm password", confirmPassword, setConfirmPassword, true, "default"]
            ] as const
          ).map(([field, label, value, setter, secure, keyboard]) => (
            <View key={field} className="gap-1">
              <TextInput
                className="rounded-2xl border border-border bg-surface px-4 py-4 text-ink"
                value={value}
                onChangeText={(next) => {
                  setter(next);
                  setFieldErrors((current) => {
                    const updated = { ...current };
                    delete updated[field];
                    return updated;
                  });
                }}
                placeholder={label}
                secureTextEntry={secure}
                autoCapitalize={field === "email" ? "none" : "words"}
                keyboardType={keyboard}
              />
              {fieldErrors[field] ? <Text className="text-xs text-danger">{fieldErrors[field]}</Text> : null}
            </View>
          ))}

          <Pressable
            onPress={() => {
              setAcceptTerms((current) => !current);
              setFieldErrors((current) => {
                const updated = { ...current };
                delete updated.acceptTerms;
                return updated;
              });
            }}
            className="min-h-[48px] flex-row items-start gap-3"
            accessibilityRole="checkbox"
            accessibilityState={{ checked: acceptTerms }}
          >
            <View
              className={`mt-0.5 h-6 w-6 items-center justify-center rounded-md border-2 ${
                acceptTerms ? "border-brand bg-brand" : "border-border bg-card"
              }`}
            >
              {acceptTerms ? <Text className="text-xs font-black text-white">✓</Text> : null}
            </View>
            <Text className="flex-1 text-sm leading-5 text-muted">
              I agree to the{" "}
              <Text className="font-bold text-brand" onPress={() => navigation.navigate("TermsOfService")}>
                Terms of Service
              </Text>{" "}
              and{" "}
              <Text className="font-bold text-brand" onPress={() => navigation.navigate("PrivacyPolicy")}>
                Privacy Policy
              </Text>
              .
            </Text>
          </Pressable>
          {fieldErrors.acceptTerms ? <Text className="text-xs text-danger">{fieldErrors.acceptTerms}</Text> : null}

          {fieldErrors.form ? <Text className="text-sm text-danger">{fieldErrors.form}</Text> : null}
          <AppButton
            label={registerMutation.isPending ? "Creating account..." : "Create account"}
            onPress={handleSubmit}
            disabled={registerMutation.isPending}
          />
        </DutsCard>
      </ScrollView>
    </Screen>
  );
  }

  const fields = [
    ["fullName", "Full name", fullName, setFullName, false, "default"],
    ["email", "Email", email, setEmail, false, "email-address"],
    ["password", "Password", password, setPassword, true, "default"],
    ["confirmPassword", "Confirm password", confirmPassword, setConfirmPassword, true, "default"]
  ] as const;

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
          <View className="gap-4 rounded-3xl border border-border bg-card px-5 py-5">
            {fields.map(([field, label, value, setter, secure, keyboard]) => (
              <View key={field} className="gap-2">
                <Text className="text-sm font-bold text-ink">{label}</Text>
                <TextInput
                  className="duts-focus-ring min-h-[48px] rounded-2xl border border-border bg-card px-4 text-base text-ink"
                  value={value}
                  onChangeText={(next) => {
                    setter(next);
                    setFieldErrors((current) => {
                      const updated = { ...current };
                      delete updated[field];
                      return updated;
                    });
                  }}
                  placeholder={label}
                  autoCapitalize={field === "email" ? "none" : "words"}
                  autoComplete={field === "email" ? "email" : field === "fullName" ? "name" : "new-password"}
                  keyboardType={keyboard}
                  secureTextEntry={secure}
                  editable={!registerMutation.isPending}
                  accessibilityLabel={label}
                />
                {fieldErrors[field] ? <Text className="text-sm text-danger">{fieldErrors[field]}</Text> : null}
              </View>
            ))}

            <Pressable
              onPress={() => {
                setAcceptTerms((current) => !current);
                setFieldErrors((current) => {
                  const updated = { ...current };
                  delete updated.acceptTerms;
                  return updated;
                });
              }}
              className="duts-focus-ring min-h-[48px] flex-row items-start gap-3"
              accessibilityRole="checkbox"
              accessibilityState={{ checked: acceptTerms }}
              accessibilityLabel="I agree to the Terms of Service and Privacy Policy"
            >
              <View
                className={`mt-0.5 h-6 w-6 items-center justify-center rounded-md border-2 ${
                  acceptTerms ? "border-brand bg-brand" : "border-border bg-card"
                }`}
              >
                {acceptTerms ? <Text className="text-xs font-black text-white">✓</Text> : null}
              </View>
              <Text className="flex-1 text-sm leading-5 text-muted">
                I agree to the{" "}
                <Text className="font-bold text-brand" onPress={() => navigation.navigate("TermsOfService")}>
                  Terms of Service
                </Text>{" "}
                and{" "}
                <Text className="font-bold text-brand" onPress={() => navigation.navigate("PrivacyPolicy")}>
                  Privacy Policy
                </Text>
                .
              </Text>
            </Pressable>
            {fieldErrors.acceptTerms ? <Text className="text-sm text-danger">{fieldErrors.acceptTerms}</Text> : null}
            {fieldErrors.form ? <Text className="text-sm text-danger">{fieldErrors.form}</Text> : null}
            <AppButton
              label={registerMutation.isPending ? "Creating account..." : "Create account"}
              onPress={handleSubmit}
              disabled={registerMutation.isPending}
            />
          </View>
          <Pressable
            onPress={() => navigation.navigate("Login")}
            accessibilityRole="button"
            className="duts-focus-ring min-h-[44px] items-center justify-center"
          >
            <Text className="text-center text-muted">
              Already have an account? <Text className="font-bold text-brand">Sign in</Text>
            </Text>
          </Pressable>
        </View>
      </WebAuthFrame>
    </Screen>
  );
}
