import { useState } from "react";
import { Text, TextInput, View } from "react-native";
import { useMutation } from "@tanstack/react-query";
import type { GeoPointInput } from "@gigflow/shared";
import { completeProfileSchema, zodErrorsToFieldMap } from "@gigflow/shared";
import { api } from "../../lib/api";
import { defaultActiveRole, isApplePlaceholderEmail } from "../../lib/auth";
import { AddressAutocomplete } from "../../components/AddressAutocomplete";
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
  const [addressQuery, setAddressQuery] = useState(session.user.formattedAddress ?? "");
  const [selectedLocation, setSelectedLocation] = useState<GeoPointInput | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const completeMutation = useMutation({
    mutationFn: (payload: Parameters<typeof api.completeProfile>[0]) =>
      api.completeProfile(payload, session.token),
    onSuccess: ({ user }) => {
      setProfile(user);
      setActiveRole(defaultActiveRole(user));
      setError(null);
      setFieldErrors({});
    },
    onError: (err: Error) => setError(err.message)
  });

  function handleSubmit(): void {
    const needsEmail = isApplePlaceholderEmail(session.user.email);
    const payload = {
      fullName,
      ...(needsEmail || email.trim() ? { email: email.trim() } : {}),
      ...(phoneNumber.trim() ? { phoneNumber: phoneNumber.trim() } : {}),
      defaultRole: userType,
      ...(selectedLocation
        ? {
            location: {
              formattedAddress: selectedLocation.formattedAddress,
              addressLine1: selectedLocation.addressLine1,
              city: selectedLocation.city,
              region: selectedLocation.region,
              postalCode: selectedLocation.postalCode,
              country: selectedLocation.country ?? "US",
              latitude: selectedLocation.latitude,
              longitude: selectedLocation.longitude
            }
          }
        : {})
    };

    const parsed = completeProfileSchema.safeParse(payload);
    if (!parsed.success) {
      const errors = zodErrorsToFieldMap(parsed.error);
      setFieldErrors(errors);
      setError(Object.values(errors)[0] ?? "Check your details.");
      return;
    }

    setError(null);
    setFieldErrors({});
    completeMutation.mutate(parsed.data);
  }

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
          {fieldErrors.fullName ? <Text className="text-xs text-danger">{fieldErrors.fullName}</Text> : null}
          {isApplePlaceholderEmail(session.user.email) ? (
            <>
              <TextInput
                className="rounded-2xl border border-border bg-surface px-4 py-4 text-ink"
                value={email}
                onChangeText={setEmail}
                placeholder="Email address"
                autoCapitalize="none"
                keyboardType="email-address"
              />
              {fieldErrors.email ? <Text className="text-xs text-danger">{fieldErrors.email}</Text> : null}
            </>
          ) : null}
          <TextInput
            className="rounded-2xl border border-border bg-surface px-4 py-4 text-ink"
            value={phoneNumber}
            onChangeText={setPhoneNumber}
            placeholder="Phone number (optional)"
            keyboardType="phone-pad"
          />
          {fieldErrors.phoneNumber ? <Text className="text-xs text-danger">{fieldErrors.phoneNumber}</Text> : null}
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
          <AddressAutocomplete
            token={session.token}
            label="Home or service area"
            value={addressQuery}
            onChangeText={(value) => {
              setAddressQuery(value);
              if (selectedLocation) {
                setSelectedLocation(null);
              }
            }}
            selectedLocation={selectedLocation}
            onLocationResolved={setSelectedLocation}
            onLocationCleared={() => setSelectedLocation(null)}
            error={fieldErrors.location}
          />
          {error ? <Text className="text-sm text-danger">{error}</Text> : null}
          <AppButton
            label={completeMutation.isPending ? "Saving..." : `Continue to ${APP_NAME}`}
            onPress={handleSubmit}
            disabled={completeMutation.isPending}
            loading={completeMutation.isPending}
          />
        </DutsCard>
      </View>
    </Screen>
  );
}
