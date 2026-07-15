import { useState } from "react";
import { Alert, ScrollView, Text } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { changePasswordSchema } from "@gigflow/shared";
import { DutsCard } from "../../components/DutsCard";
import { FormInput } from "../../components/FormInput";
import { LoadingButton } from "../../components/LoadingButton";
import { Screen } from "../../components/Screen";
import { api, ApiValidationError } from "../../lib/api";
import type { RootStackParamList } from "../../navigation/types";
import { useSessionStore } from "../../stores/session.store";

type Nav = NativeStackNavigationProp<RootStackParamList, "ChangePassword">;

export function ChangePasswordScreen() {
  const navigation = useNavigation<Nav>();
  const session = useSessionStore((state) => state.session)!;
  const [currentPassword, setCurrentPassword] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  async function handleSave(): Promise<void> {
    const parsed = changePasswordSchema.safeParse({ currentPassword, password, confirmPassword });
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? "password");
        if (!next[key]) next[key] = issue.message;
      }
      setFieldErrors(next);
      return;
    }

    setSaving(true);
    setFieldErrors({});
    try {
      await api.changePassword(parsed.data, session.token);
      Alert.alert("Password updated", "Your password was changed.", [
        { text: "OK", onPress: () => navigation.goBack() }
      ]);
    } catch (error) {
      if (error instanceof ApiValidationError) {
        setFieldErrors(error.fieldErrors);
      } else {
        Alert.alert("Could not update password", error instanceof Error ? error.message : "Try again.");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Screen>
      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ gap: 16, paddingBottom: 32 }}
      >
        <DutsCard className="gap-3 p-5">
          <Text className="text-sm text-muted">Choose a strong password with letters and numbers.</Text>
          <FormInput
            label="Current Password"
            value={currentPassword}
            onChangeText={setCurrentPassword}
            secureTextEntry
            error={fieldErrors.currentPassword}
          />
          <FormInput
            label="New Password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            error={fieldErrors.password}
          />
          <FormInput
            label="Confirm Password"
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            secureTextEntry
            error={fieldErrors.confirmPassword}
          />
          <LoadingButton
            label="Update password"
            loadingLabel="Updating..."
            loading={saving}
            onPress={() => void handleSave()}
          />
        </DutsCard>
      </ScrollView>
    </Screen>
  );
}
