import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import {
  MAX_WORKER_TRAVEL_MILES,
  workerRegisterSchema,
  zodErrorsToFieldMap
} from "@gigflow/shared";
import { api, ApiValidationError } from "../../lib/api";
import { defaultActiveRole } from "../../lib/auth";
import { Screen } from "../../components/Screen";
import { AppButton } from "../../components/AppButton";
import { DutsCard } from "../../components/DutsCard";
import { IdentityImageField } from "../../components/IdentityImageField";
import { useSessionStore } from "../../stores/session.store";
import type { AuthStackParamList } from "../../navigation/auth-types";

type Props = NativeStackScreenProps<AuthStackParamList, "WorkerRegister">;

const STEPS = ["Basic Info", "Worker Profile", "Verification", "Review & Submit"] as const;

const ID_TYPES = [
  { id: "DRIVERS_LICENSE" as const, label: "Driver's License" },
  { id: "STATE_ID" as const, label: "State ID" },
  { id: "NATIONAL_ID" as const, label: "National ID" }
];

function buildWorkerPayload(input: {
  fullName: string;
  email: string;
  password: string;
  confirmPassword: string;
  acceptTerms: boolean;
  bio: string;
  city: string;
  serviceArea: string;
  travelDistanceMiles: string;
  workExperience: string;
  availabilityNotes: string;
  hourlyRate: string;
  minJobAmount: string;
  serviceCategoryIds: string[];
  profilePhotoDataUrl: string | null;
  governmentIdType: "DRIVERS_LICENSE" | "STATE_ID" | "NATIONAL_ID" | "";
  governmentIdFrontDataUrl: string | null;
  governmentIdBackDataUrl: string | null;
  governmentIdAcknowledged: boolean;
  proofOfAddressAcknowledged: boolean;
  platformRulesAgreed: boolean;
  backgroundCheckConsent: boolean;
}) {
  return {
    fullName: input.fullName,
    email: input.email,
    password: input.password,
    confirmPassword: input.confirmPassword,
    acceptTerms: input.acceptTerms ? true : false,
    bio: input.bio,
    city: input.city,
    serviceArea: input.serviceArea,
    travelDistanceMiles: Number(input.travelDistanceMiles),
    workExperience: input.workExperience,
    availabilityNotes: input.availabilityNotes || undefined,
    hourlyRateCents: Math.round(Number(input.hourlyRate) * 100),
    minJobAmountCents: Math.round(Number(input.minJobAmount) * 100),
    hasVehicle: false,
    serviceCategoryIds: input.serviceCategoryIds,
    profilePhotoDataUrl: input.profilePhotoDataUrl ?? "",
    governmentIdType: input.governmentIdType || undefined,
    governmentIdFrontDataUrl: input.governmentIdFrontDataUrl ?? "",
    governmentIdBackDataUrl: input.governmentIdBackDataUrl || undefined,
    governmentIdAcknowledged: input.governmentIdAcknowledged ? true : false,
    proofOfAddressAcknowledged: input.proofOfAddressAcknowledged ? true : false,
    platformRulesAgreed: input.platformRulesAgreed ? true : false,
    backgroundCheckConsent: input.backgroundCheckConsent ? true : false
  };
}

export function WorkerRegisterScreen({ navigation }: Props) {
  const [step, setStep] = useState(0);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [bio, setBio] = useState("");
  const [city, setCity] = useState("");
  const [serviceArea, setServiceArea] = useState("");
  const [travelDistanceMiles, setTravelDistanceMiles] = useState("15");
  const [workExperience, setWorkExperience] = useState("");
  const [availabilityNotes, setAvailabilityNotes] = useState("");
  const [hourlyRate, setHourlyRate] = useState("25");
  const [minJobAmount, setMinJobAmount] = useState("50");
  const [serviceCategoryIds, setServiceCategoryIds] = useState<string[]>([]);
  const [profilePhotoDataUrl, setProfilePhotoDataUrl] = useState<string | null>(null);
  const [governmentIdType, setGovernmentIdType] = useState<
    "DRIVERS_LICENSE" | "STATE_ID" | "NATIONAL_ID" | ""
  >("");
  const [governmentIdFrontDataUrl, setGovernmentIdFrontDataUrl] = useState<string | null>(null);
  const [governmentIdBackDataUrl, setGovernmentIdBackDataUrl] = useState<string | null>(null);
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
    mutationFn: (payload: Parameters<typeof api.registerWorker>[0]) => api.registerWorker(payload),
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

  function currentPayload() {
    return buildWorkerPayload({
      fullName,
      email,
      password,
      confirmPassword,
      acceptTerms,
      bio,
      city,
      serviceArea,
      travelDistanceMiles,
      workExperience,
      availabilityNotes,
      hourlyRate,
      minJobAmount,
      serviceCategoryIds,
      profilePhotoDataUrl,
      governmentIdType,
      governmentIdFrontDataUrl,
      governmentIdBackDataUrl,
      governmentIdAcknowledged,
      proofOfAddressAcknowledged,
      platformRulesAgreed,
      backgroundCheckConsent
    });
  }

  function nextStep(): void {
    const payload = currentPayload();
    const stepFields: string[][] = [
      ["fullName", "email", "password", "confirmPassword", "acceptTerms"],
      [
        "bio",
        "city",
        "serviceArea",
        "travelDistanceMiles",
        "workExperience",
        "serviceCategoryIds",
        "hourlyRateCents",
        "minJobAmountCents"
      ],
      [
        "profilePhotoDataUrl",
        "governmentIdType",
        "governmentIdFrontDataUrl",
        "governmentIdBackDataUrl",
        "governmentIdAcknowledged",
        "proofOfAddressAcknowledged",
        "platformRulesAgreed",
        "backgroundCheckConsent"
      ]
    ];

    const parsed = workerRegisterSchema.safeParse(payload);
    const errors = parsed.success ? {} : zodErrorsToFieldMap(parsed.error);
    const allowed = new Set(stepFields[step] ?? []);
    const stepErrors = Object.fromEntries(Object.entries(errors).filter(([key]) => allowed.has(key)));
    if (Object.keys(stepErrors).length > 0) {
      setFieldErrors(stepErrors);
      return;
    }

    setFieldErrors({});
    setStep((current) => Math.min(current + 1, STEPS.length - 1));
  }

  function handleSubmit(): void {
    const parsed = workerRegisterSchema.safeParse(currentPayload());
    if (!parsed.success) {
      setFieldErrors(zodErrorsToFieldMap(parsed.error));
      return;
    }
    setFieldErrors({});
    registerMutation.mutate(parsed.data);
  }

  function prevStep(): void {
    setStep((current) => Math.max(current - 1, 0));
  }

  const mvpCategories = categoriesQuery.data?.mvp ?? [];
  const needsIdBack = governmentIdType === "DRIVERS_LICENSE" || governmentIdType === "STATE_ID";

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
                keyboardType={field.email ? "email-address" : "default"}
              />
            ))}
            <Pressable
              onPress={() => setAcceptTerms((current) => !current)}
              className="min-h-[48px] flex-row items-center gap-3"
              accessibilityRole="checkbox"
              accessibilityState={{ checked: acceptTerms }}
            >
              <View
                className={`h-6 w-6 items-center justify-center rounded-md border-2 ${
                  acceptTerms ? "border-brand bg-brand" : "border-border bg-card"
                }`}
              >
                {acceptTerms ? <Text className="text-xs font-black text-white">✓</Text> : null}
              </View>
              <Text className="flex-1 text-sm text-muted">
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
              placeholder={`Max travel distance (1–${MAX_WORKER_TRAVEL_MILES} miles)`}
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
            <Text className="text-xl font-black text-ink">Identity verification</Text>
            <Text className="text-sm text-muted">
              Profile photo and government ID are required. Images are compressed before upload and stored securely.
            </Text>

            <IdentityImageField
              label="Profile photo"
              hint="Required. Use camera or gallery. Preview before submitting."
              value={profilePhotoDataUrl}
              onChange={setProfilePhotoDataUrl}
              error={fieldErrors.profilePhotoDataUrl}
              aspect={[1, 1]}
            />

            <Text className="text-sm font-semibold text-label">Government ID type</Text>
            <View className="flex-row flex-wrap gap-2">
              {ID_TYPES.map((item) => {
                const selected = governmentIdType === item.id;
                return (
                  <Pressable
                    key={item.id}
                    onPress={() => setGovernmentIdType(item.id)}
                    className={`rounded-full px-3 py-2 ${selected ? "bg-brand" : "border border-border bg-surface"}`}
                  >
                    <Text className={`text-xs font-bold ${selected ? "text-white" : "text-label"}`}>{item.label}</Text>
                  </Pressable>
                );
              })}
            </View>
            {fieldErrors.governmentIdType ? (
              <Text className="text-xs text-danger">{fieldErrors.governmentIdType}</Text>
            ) : null}

            <IdentityImageField
              label="ID front"
              hint="Required."
              value={governmentIdFrontDataUrl}
              onChange={setGovernmentIdFrontDataUrl}
              error={fieldErrors.governmentIdFrontDataUrl}
              aspect={[16, 10]}
            />

            {needsIdBack || governmentIdType === "NATIONAL_ID" ? (
              <IdentityImageField
                label={needsIdBack ? "ID back (required)" : "ID back (optional)"}
                value={governmentIdBackDataUrl}
                onChange={setGovernmentIdBackDataUrl}
                error={fieldErrors.governmentIdBackDataUrl}
                aspect={[16, 10]}
              />
            ) : null}

            {[
              {
                label: "I confirm these identity documents are mine",
                value: governmentIdAcknowledged,
                set: setGovernmentIdAcknowledged
              },
              {
                label: "I can provide proof of address if requested",
                value: proofOfAddressAcknowledged,
                set: setProofOfAddressAcknowledged
              },
              { label: "I agree to platform rules", value: platformRulesAgreed, set: setPlatformRulesAgreed },
              {
                label: "I consent to a background check",
                value: backgroundCheckConsent,
                set: setBackgroundCheckConsent
              }
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
            <Text className="text-sm text-muted">
              {fullName} · {email}
            </Text>
            <Text className="text-sm text-muted">
              {city} · {serviceArea} · {travelDistanceMiles} mi radius
            </Text>
            <Text className="text-sm text-muted">{bio}</Text>
            <Text className="text-sm text-muted">
              Photo & ID: {profilePhotoDataUrl && governmentIdFrontDataUrl ? "Ready" : "Incomplete"} ·{" "}
              {ID_TYPES.find((item) => item.id === governmentIdType)?.label ?? "ID type not selected"}
            </Text>
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
                onPress={handleSubmit}
                disabled={registerMutation.isPending}
                loading={registerMutation.isPending}
              />
            </View>
          )}
        </View>
      </View>
    </Screen>
  );
}
