import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { api, ApiValidationError } from "../../lib/api";
import { defaultActiveRole } from "../../lib/auth";
import { Screen } from "../../components/Screen";
import { AppButton } from "../../components/AppButton";
import { DutsCard } from "../../components/DutsCard";
import { useSessionStore } from "../../stores/session.store";
import type { AuthStackParamList } from "../../navigation/auth-types";

type Props = NativeStackScreenProps<AuthStackParamList, "WorkerRegister">;

const STEPS = ["Basic Info", "Worker Profile", "Verification", "Review & Submit"] as const;

export function WorkerRegisterScreen(_props: Props) {
  const [step, setStep] = useState(0);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [bio, setBio] = useState("");
  const [city, setCity] = useState("");
  const [serviceArea, setServiceArea] = useState("");
  const [travelDistanceMiles, setTravelDistanceMiles] = useState("15");
  const [workExperience, setWorkExperience] = useState("");
  const [availabilityNotes, setAvailabilityNotes] = useState("");
  const [hourlyRate, setHourlyRate] = useState("25");
  const [minJobAmount, setMinJobAmount] = useState("50");
  const [serviceCategoryIds, setServiceCategoryIds] = useState<string[]>([]);
  const [governmentIdAcknowledged, setGovernmentIdAcknowledged] = useState(false);
  const [proofOfAddressAcknowledged, setProofOfAddressAcknowledged] = useState(false);
  const [platformRulesAgreed, setPlatformRulesAgreed] = useState(false);
  const [backgroundCheckConsent, setBackgroundCheckConsent] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const setSession = useSessionStore((state) => state.setSession);
  const setActiveRole = useSessionStore((state) => state.setActiveRole);

  const categoriesQuery = useQuery({
    queryKey: ["categories"],
    queryFn: () => api.listCategories()
  });

  const registerMutation = useMutation({
    mutationFn: () =>
      api.registerWorker({
        fullName,
        email,
        phoneNumber,
        password,
        confirmPassword,
        bio,
        city,
        serviceArea,
        travelDistanceMiles: Number(travelDistanceMiles),
        workExperience,
        availabilityNotes: availabilityNotes || undefined,
        hourlyRateCents: Math.round(Number(hourlyRate) * 100),
        minJobAmountCents: Math.round(Number(minJobAmount) * 100),
        hasVehicle: false,
        serviceCategoryIds,
        governmentIdAcknowledged: governmentIdAcknowledged as true,
        proofOfAddressAcknowledged: proofOfAddressAcknowledged as true,
        platformRulesAgreed: platformRulesAgreed as true,
        backgroundCheckConsent: backgroundCheckConsent as true
      }),
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

  function toggleCategory(id: string): void {
    setServiceCategoryIds((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id]
    );
  }

  function nextStep(): void {
    setStep((current) => Math.min(current + 1, STEPS.length - 1));
  }

  function prevStep(): void {
    setStep((current) => Math.max(current - 1, 0));
  }

  const mvpCategories = categoriesQuery.data?.mvp ?? [];

  return (
    <Screen>
      <View className="gap-5">
        <View className="flex-row flex-wrap gap-2">
          {STEPS.map((label, index) => (
            <View
              key={label}
              className={`rounded-full px-3 py-1 ${index === step ? "bg-brand" : "bg-surface border border-border"}`}
            >
              <Text className={`text-xs font-bold ${index === step ? "text-white" : "text-label"}`}>{label}</Text>
            </View>
          ))}
        </View>

        {step === 0 ? (
          <DutsCard className="gap-4 p-5">
            <Text className="text-xl font-black text-ink">Basic info</Text>
            {[
              { label: "Full name", value: fullName, set: setFullName },
              { label: "Email", value: email, set: setEmail, email: true },
              { label: "Phone number", value: phoneNumber, set: setPhoneNumber, phone: true },
              { label: "Password", value: password, set: setPassword, secure: true },
              { label: "Confirm password", value: confirmPassword, set: setConfirmPassword, secure: true }
            ].map((field) => (
              <TextInput
                key={field.label}
                className="rounded-2xl border border-border bg-surface px-4 py-4 text-ink"
                value={field.value}
                onChangeText={field.set}
                placeholder={field.label}
                secureTextEntry={field.secure}
                autoCapitalize={field.email ? "none" : "words"}
                keyboardType={field.email ? "email-address" : field.phone ? "phone-pad" : "default"}
              />
            ))}
          </DutsCard>
        ) : null}

        {step === 1 ? (
          <DutsCard className="gap-4 p-5">
            <Text className="text-xl font-black text-ink">Worker profile</Text>
            <Text className="text-sm font-semibold text-label">Services offered</Text>
            <View className="flex-row flex-wrap gap-2">
              {mvpCategories.map((category) => {
                const selected = serviceCategoryIds.includes(category.id);
                return (
                  <Pressable
                    key={category.id}
                    onPress={() => toggleCategory(category.id)}
                    className={`rounded-full px-3 py-2 ${selected ? "bg-brand" : "border border-border bg-surface"}`}
                  >
                    <Text className={`text-xs font-bold ${selected ? "text-white" : "text-label"}`}>{category.name}</Text>
                  </Pressable>
                );
              })}
            </View>
            <TextInput className="rounded-2xl border border-border bg-surface px-4 py-4 text-ink" value={city} onChangeText={setCity} placeholder="City" />
            <TextInput
              className="rounded-2xl border border-border bg-surface px-4 py-4 text-ink"
              value={serviceArea}
              onChangeText={setServiceArea}
              placeholder="Service area"
            />
            <TextInput
              className="rounded-2xl border border-border bg-surface px-4 py-4 text-ink"
              value={travelDistanceMiles}
              onChangeText={setTravelDistanceMiles}
              placeholder="Max travel distance (miles)"
              keyboardType="numeric"
            />
            <TextInput
              className="rounded-2xl border border-border bg-surface px-4 py-4 text-ink"
              value={bio}
              onChangeText={setBio}
              placeholder="Short bio"
              multiline
            />
            <TextInput
              className="rounded-2xl border border-border bg-surface px-4 py-4 text-ink"
              value={workExperience}
              onChangeText={setWorkExperience}
              placeholder="Work experience"
              multiline
            />
            <TextInput
              className="rounded-2xl border border-border bg-surface px-4 py-4 text-ink"
              value={availabilityNotes}
              onChangeText={setAvailabilityNotes}
              placeholder="Availability (optional)"
            />
            <TextInput
              className="rounded-2xl border border-border bg-surface px-4 py-4 text-ink"
              value={hourlyRate}
              onChangeText={setHourlyRate}
              placeholder="Hourly rate ($)"
              keyboardType="numeric"
            />
            <TextInput
              className="rounded-2xl border border-border bg-surface px-4 py-4 text-ink"
              value={minJobAmount}
              onChangeText={setMinJobAmount}
              placeholder="Minimum job amount ($)"
              keyboardType="numeric"
            />
          </DutsCard>
        ) : null}

        {step === 2 ? (
          <DutsCard className="gap-4 p-5">
            <Text className="text-xl font-black text-ink">Verification</Text>
            <Text className="text-sm text-muted">Document uploads are placeholders for now. Confirm each item to submit.</Text>
            {[
              { label: "I will provide government ID", value: governmentIdAcknowledged, set: setGovernmentIdAcknowledged },
              { label: "I will provide proof of address", value: proofOfAddressAcknowledged, set: setProofOfAddressAcknowledged },
              { label: "I agree to platform rules", value: platformRulesAgreed, set: setPlatformRulesAgreed },
              { label: "I consent to a background check", value: backgroundCheckConsent, set: setBackgroundCheckConsent }
            ].map((item) => (
              <Pressable key={item.label} onPress={() => item.set(!item.value)} className="flex-row items-center gap-3">
                <View className={`h-5 w-5 rounded border ${item.value ? "border-brand bg-brand" : "border-border bg-surface"}`} />
                <Text className="flex-1 text-sm text-ink">{item.label}</Text>
              </Pressable>
            ))}
          </DutsCard>
        ) : null}

        {step === 3 ? (
          <DutsCard className="gap-3 p-5">
            <Text className="text-xl font-black text-ink">Review & submit</Text>
            <Text className="text-sm text-muted">{fullName} · {email} · {phoneNumber}</Text>
            <Text className="text-sm text-muted">{city} · {serviceArea} · {travelDistanceMiles} mi radius</Text>
            <Text className="text-sm text-muted">{bio}</Text>
            <Text className="text-sm text-muted">Status after submit: pending admin approval</Text>
          </DutsCard>
        ) : null}

        {fieldErrors.form ? <Text className="text-sm text-danger">{fieldErrors.form}</Text> : null}
        {Object.entries(fieldErrors)
          .filter(([key]) => key !== "form")
          .map(([key, message]) => (
            <Text key={key} className="text-xs text-danger">
              {key}: {message}
            </Text>
          ))}

        <View className="flex-row gap-3">
          {step > 0 ? (
            <View className="flex-1">
              <AppButton label="Back" variant="secondary" onPress={prevStep} />
            </View>
          ) : null}
          {step < STEPS.length - 1 ? (
            <View className="flex-1">
              <AppButton label="Continue" onPress={nextStep} />
            </View>
          ) : (
            <View className="flex-1">
              <AppButton
                label={registerMutation.isPending ? "Submitting..." : "Submit application"}
                onPress={() => registerMutation.mutate()}
              />
            </View>
          )}
        </View>
      </View>
    </Screen>
  );
}
