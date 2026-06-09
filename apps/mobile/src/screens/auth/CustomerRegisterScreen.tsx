import { useState } from "react";
import { Text, TextInput, View } from "react-native";
import { useMutation } from "@tanstack/react-query";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { api, ApiValidationError } from "../../lib/api";
import { defaultActiveRole } from "../../lib/auth";
import { Screen } from "../../components/Screen";
import { AppButton } from "../../components/AppButton";
import { DutsCard } from "../../components/DutsCard";
import { useSessionStore } from "../../stores/session.store";
import type { AuthStackParamList } from "../../navigation/auth-types";

type Props = NativeStackScreenProps<AuthStackParamList, "CustomerRegister">;

export function CustomerRegisterScreen(_props: Props) {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const setSession = useSessionStore((state) => state.setSession);
  const setActiveRole = useSessionStore((state) => state.setActiveRole);

  const registerMutation = useMutation({
    mutationFn: () =>
      api.registerCustomer({ fullName, email, phoneNumber, password, confirmPassword }),
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

  function fieldError(key: string): string | undefined {
    return fieldErrors[key];
  }

  return (
    <Screen>
      <View className="gap-5">
        <DutsCard className="gap-4 p-5">
          <Text className="text-xl font-black text-ink">Create your customer account</Text>
          <Text className="text-sm text-muted">Start posting gigs immediately after sign up.</Text>

          {(["fullName", "email", "phoneNumber", "password", "confirmPassword"] as const).map((field) => {
            const labels: Record<string, string> = {
              fullName: "Full name",
              email: "Email",
              phoneNumber: "Phone number",
              password: "Password",
              confirmPassword: "Confirm password"
            };
            const secure = field === "password" || field === "confirmPassword";
            const values: Record<string, string> = { fullName, email, phoneNumber, password, confirmPassword };
            const setters: Record<string, (v: string) => void> = {
              fullName: setFullName,
              email: setEmail,
              phoneNumber: setPhoneNumber,
              password: setPassword,
              confirmPassword: setConfirmPassword
            };
            return (
              <View key={field} className="gap-1">
                <TextInput
                  className="rounded-2xl border border-border bg-surface px-4 py-4 text-ink"
                  value={values[field]}
                  onChangeText={setters[field]}
                  placeholder={labels[field]}
                  secureTextEntry={secure}
                  autoCapitalize={field === "email" ? "none" : "words"}
                  keyboardType={field === "email" ? "email-address" : field === "phoneNumber" ? "phone-pad" : "default"}
                />
                {fieldError(field) ? <Text className="text-xs text-danger">{fieldError(field)}</Text> : null}
              </View>
            );
          })}

          {fieldErrors.form ? <Text className="text-sm text-danger">{fieldErrors.form}</Text> : null}
          <AppButton
            label={registerMutation.isPending ? "Creating account..." : "Create account"}
            onPress={() => registerMutation.mutate()}
          />
        </DutsCard>
      </View>
    </Screen>
  );
}
