import { useMemo } from "react";
import { Text, TextInput, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { MAX_WORKER_TRAVEL_MILES } from "@gigflow/shared";
import { api } from "../lib/api";
import { DUTS } from "../lib/theme";
import { ServiceCategoryPicker } from "./ServiceCategoryPicker";

export interface WorkerPreferencesValues {
  serviceCategoryIds: string[];
  travelDistanceMiles: string;
  hourlyRate: string;
  minJobAmount: string;
}

interface WorkerPreferencesFormProps {
  values: WorkerPreferencesValues;
  onChange: (values: WorkerPreferencesValues) => void;
  disabled?: boolean;
}

export function WorkerPreferencesForm({ values, onChange, disabled = false }: WorkerPreferencesFormProps) {
  const categoriesQuery = useQuery({ queryKey: ["categories"], queryFn: api.listCategories });

  const selectedSet = useMemo(() => new Set(values.serviceCategoryIds), [values.serviceCategoryIds]);

  function toggleCategory(categoryId: string): void {
    const next = selectedSet.has(categoryId)
      ? values.serviceCategoryIds.filter((id) => id !== categoryId)
      : [...values.serviceCategoryIds, categoryId];
    onChange({ ...values, serviceCategoryIds: next });
  }

  function clampTravelDistance(raw: string): void {
    const parsed = Math.round(Number(raw));
    if (!Number.isFinite(parsed)) {
      onChange({ ...values, travelDistanceMiles: "10" });
      return;
    }
    onChange({
      ...values,
      travelDistanceMiles: String(Math.min(MAX_WORKER_TRAVEL_MILES, Math.max(1, parsed)))
    });
  }

  return (
    <View className="gap-4">
      <View className="gap-1">
        <Text className="text-sm font-bold uppercase tracking-wider text-label">Services you offer</Text>
        <Text className="text-xs text-muted">Choose the gig types you want to receive.</Text>
      </View>
      <ServiceCategoryPicker
        mvp={categoriesQuery.data?.mvp ?? []}
        selectedIds={values.serviceCategoryIds}
        onSelect={toggleCategory}
        disabled={disabled}
      />

      <View className="gap-1">
        <Text className="text-sm font-bold uppercase tracking-wider text-label">Travel distance (mi)</Text>
        <Text className="text-xs text-muted">
          How far you're willing to travel for gigs. Max {MAX_WORKER_TRAVEL_MILES} miles.
        </Text>
        <TextInput
          className="rounded-2xl border border-border bg-surface px-4 py-3.5 text-ink"
          value={values.travelDistanceMiles}
          onChangeText={(travelDistanceMiles) => onChange({ ...values, travelDistanceMiles })}
          onBlur={() => clampTravelDistance(values.travelDistanceMiles)}
          keyboardType="decimal-pad"
          editable={!disabled}
          placeholderTextColor={DUTS.placeholder}
        />
      </View>

      <View className="gap-1">
        <Text className="text-sm font-bold uppercase tracking-wider text-label">Preferred hourly rate ($)</Text>
        <Text className="text-xs text-muted">Between $10 and $500.</Text>
        <TextInput
          className="rounded-2xl border border-border bg-surface px-4 py-3.5 text-ink"
          value={values.hourlyRate}
          onChangeText={(hourlyRate) => onChange({ ...values, hourlyRate })}
          keyboardType="decimal-pad"
          editable={!disabled}
          placeholderTextColor={DUTS.placeholder}
        />
      </View>

      <View className="gap-1">
        <Text className="text-sm font-bold uppercase tracking-wider text-label">Minimum job amount ($)</Text>
        <Text className="text-xs text-muted">Between $10 and $1,000.</Text>
        <TextInput
          className="rounded-2xl border border-border bg-surface px-4 py-3.5 text-ink"
          value={values.minJobAmount}
          onChangeText={(minJobAmount) => onChange({ ...values, minJobAmount })}
          keyboardType="decimal-pad"
          editable={!disabled}
          placeholderTextColor={DUTS.placeholder}
        />
      </View>
    </View>
  );
}

export function workerPreferencesFromProfile(
  profile: {
    workerProfile?: {
      serviceCategories: Array<{ id: string }>;
      travelDistanceMiles?: number | string;
      hourlyRateCents?: number | null;
      minJobAmountCents?: number;
    } | null;
  } | null
): WorkerPreferencesValues {
  return {
    serviceCategoryIds: profile?.workerProfile?.serviceCategories.map((category) => category.id) ?? [],
    travelDistanceMiles: String(profile?.workerProfile?.travelDistanceMiles ?? 10),
    hourlyRate: profile?.workerProfile?.hourlyRateCents
      ? String(profile.workerProfile.hourlyRateCents / 100)
      : "35",
    minJobAmount: profile?.workerProfile?.minJobAmountCents
      ? String(profile.workerProfile.minJobAmountCents / 100)
      : "50"
  };
}

export function hasWorkerPreferencesConfigured(profile: Parameters<typeof workerPreferencesFromProfile>[0]): boolean {
  const values = workerPreferencesFromProfile(profile);
  return values.serviceCategoryIds.length > 0 && Number(values.travelDistanceMiles) >= 1;
}
