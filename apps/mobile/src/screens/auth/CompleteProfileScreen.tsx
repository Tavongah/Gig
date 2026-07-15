import { useState } from "react";
import { Text, TextInput, View } from "react-native";
import { useMutation } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { defaultActiveRole, isApplePlaceholderEmail } from "../../lib/auth";
import { AuthProgressHeader } from "../../components/AuthProgressHeader";
import { AppButton } from "../../components/AppButton";
import { DutsCard } from "../../components/DutsCard";
import { Screen } from "../../components/Screen";
import { APP_NAME } from "../../lib/brand";
import { useSessionStore } from "../../stores/session.store";

export function CompleteProfileScreen() {
  const session = useSessionStore((state) => state.session)!;
  const setProfile = useSessionStore((state) => state.setProfile);
  const setActiveRole = useSessionStore((state) => state.setActiveRole);
  const [fullName, setFullName] = useState(session.user.fullName ?? "");
  const [email, setEmail] = useState(
    isApplePlaceholderEmail(session.user.email) ? "" : session.user.email
  );
  const [phoneNumber, setPhoneNumber] = useState(session.user.phoneNumber ?? "");
  const [userType, setUserType] = useState<"CLIENT" | "WORKER">(defaultActiveRole(session.user));
  const [address, setAddress] = useState(session.user.formattedAddress ?? "");
  const [error, setError] = useState<string | null>(null);

  const completeMutation = useMutation({
    mutationFn: () =>
      api.completeProfile(
        {
          fullName,
          ...(email.trim() ? { email: email.trim() } : {}),
          ...(phoneNumber.trim() ? { phoneNumber: phoneNumber.trim() } : {}),
          defaultRole: userType,
          ...(address.trim()
            ? {
                location: {
                  formattedAddress: address,
                  addressLine1: address,
                  city: session.user.city ?? "Pending",
                  region: session.user.region ?? "Pending",
                  postalCode: "00000",
                  country: "US",
                  latitude: 33.749,
                  longitude: -84.388
                }
              }
            : {})
        },
        session.token
      ),
    onSuccess: ({ user }) => {
      setProfile(user);
      setActiveRole(defaultActiveRole(user));
      setError(null);
    },
    onError: (err: Error) => setError(err.message)
  });

  return (
    <Screen>
      <View className="gap-5">
        <AuthProgressHeader currentStep="profile" />
        <DutsCard className="gap-4 p-5">
          <Text className="text-2xl font-black text-ink">Complete your profile</Text>
          <Text className="text-sm text-muted">Tell us a little more before you start using {APP_NAME}.</Text>
          <TextInput
            className="rounded-2xl border border-border bg-surface px-4 py-4 text-ink"
            value={fullName}
            onChangeText={setFullName}
            placeholder="Full name"
          />
          {isApplePlaceholderEmail(session.user.email) ? (
            <TextInput
              className="rounded-2xl border border-border bg-surface px-4 py-4 text-ink"
              value={email}
              onChangeText={setEmail}
              placeholder="Email address"
              autoCapitalize="none"
              keyboardType="email-address"
            />
          ) : null}
          <TextInput
            className="rounded-2xl border border-border bg-surface px-4 py-4 text-ink"
            value={phoneNumber}
            onChangeText={setPhoneNumber}
            placeholder="Phone number (optional)"
            keyboardType="phone-pad"
          />
          <Text className="text-xs text-muted">Phone verification will be available in a future update.</Text>
          <View className="flex-row gap-3">
            <AppButton
              label="Customer"
              variant={userType === "CLIENT" ? "primary" : "secondary"}
              size="md"
              onPress={() => setUserType("CLIENT")}
            />
            <AppButton
              label="Worker"
              variant={userType === "WORKER" ? "primary" : "secondary"}
              size="md"
              onPress={() => setUserType("WORKER")}
            />
          </View>
          <TextInput
            className="rounded-2xl border border-border bg-surface px-4 py-4 text-ink"
            value={address}
            onChangeText={setAddress}
            placeholder="Address or service area"
          />
          {error ? <Text className="text-sm text-danger">{error}</Text> : null}
          <AppButton
            label={completeMutation.isPending ? "Saving..." : `Continue to ${APP_NAME}`}
            onPress={() => completeMutation.mutate()}
            disabled={completeMutation.isPending}
          />
        </DutsCard>
      </View>
    </Screen>
  );
}
