import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  View
} from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigation, useRoute } from "@react-navigation/native";
import type { RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import {
  MAX_DESCRIPTION_LENGTH,
  MIN_DESCRIPTION_LENGTH,
  getBookingWindow,
  type CreateGigInput,
  type GeoPointInput,
  type GigUrgency,
  type PostGigFormValues,
  type PricingType,
  resolvePricingType,
  validatePostGigForm
} from "@gigflow/shared";
import { api, ApiValidationError } from "../../lib/api";
import { DutsCard } from "../../components/DutsCard";
import { ServiceCategorySelect } from "../../components/ServiceCategorySelect";
import { FormInput } from "../../components/FormInput";
import { TextAreaInput } from "../../components/TextAreaInput";
import { LoadingButton } from "../../components/LoadingButton";
import { PriceEstimateCard } from "../../components/PriceEstimateCard";
import { AutoPricingCard, estimatedHoursHint, estimatedHoursLabel } from "../../components/AutoPricingCard";
import { AddressAutocomplete } from "../../components/AddressAutocomplete";
import { DateTimeFields, formatDateValue, formatTimeValue } from "../../components/DateTimeFields";
import type { RootStackParamList } from "../../navigation/types";
import { useSessionStore } from "../../stores/session.store";
import { DUTS } from "../../lib/theme";

const EMPTY_ERRORS: Record<string, string> = {};
const DEFAULT_FIXED_HOURS = "2";

type NavigationProp = NativeStackNavigationProp<RootStackParamList, "PostGig">;

function clearFieldError(errors: Record<string, string>, field: string): Record<string, string> {
  if (!errors[field]) return errors;
  const next = { ...errors };
  delete next[field];
  return next;
}

export function ClientPostScreen() {
  const session = useSessionStore((state) => state.session)!;
  const route = useRoute<RouteProp<RootStackParamList, "PostGig">>();
  const navigation = useNavigation<NavigationProp>();
  const queryClient = useQueryClient();

  const [description, setDescription] = useState("");
  const [estimatedHours, setEstimatedHours] = useState(DEFAULT_FIXED_HOURS);
  const [urgency] = useState<GigUrgency>("STANDARD");
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(
    route.params?.serviceCategoryId ?? null
  );
  const [locationAddress, setLocationAddress] = useState("");
  const [confirmedLocation, setConfirmedLocation] = useState<GeoPointInput | null>(null);
  const [preferredDate, setPreferredDate] = useState("");
  const [preferredTime, setPreferredTime] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>(EMPTY_ERRORS);
  const [submitAttempted, setSubmitAttempted] = useState(false);

  const categoriesQuery = useQuery({ queryKey: ["categories"], queryFn: api.listCategories });
  const allowedCategoryIds = useMemo(
    () => (categoriesQuery.data?.mvp ?? []).map((category) => category.id),
    [categoriesQuery.data?.mvp]
  );

  useEffect(() => {
    const { earliestStartsAt } = getBookingWindow();
    const defaultStart = new Date(earliestStartsAt.getTime() + 45 * 60 * 1000);
    setPreferredDate(formatDateValue(defaultStart));
    setPreferredTime(formatTimeValue(defaultStart));
  }, []);

  useEffect(() => {
    if (route.params?.serviceCategoryId) {
      setSelectedCategoryId(route.params.serviceCategoryId);
    }
  }, [route.params?.serviceCategoryId]);

  const selectedCategory = useMemo(
    () => (categoriesQuery.data?.mvp ?? []).find((category) => category.id === selectedCategoryId) ?? null,
    [categoriesQuery.data?.mvp, selectedCategoryId]
  );

  const pricingType = useMemo<PricingType>(
    () =>
      resolvePricingType({
        slug: selectedCategory?.slug,
        description,
        estimatedHours: Number(estimatedHours),
        size: "MEDIUM"
      }),
    [description, estimatedHours, selectedCategory?.slug]
  );

  useEffect(() => {
    if (pricingType === "FIXED") {
      setEstimatedHours((current) => (current.trim() ? current : DEFAULT_FIXED_HOURS));
    }
  }, [pricingType]);

  const formValues = useMemo<PostGigFormValues>(
    () => ({
      serviceCategoryId: selectedCategoryId,
      serviceCategoryName: selectedCategory?.name ?? null,
      description,
      pricingType,
      estimatedHours: pricingType === "FIXED" ? DEFAULT_FIXED_HOURS : estimatedHours,
      locationAddress,
      urgency,
      preferredDate,
      preferredTime,
      photos: []
    }),
    [
      description,
      estimatedHours,
      locationAddress,
      preferredDate,
      preferredTime,
      pricingType,
      selectedCategory,
      selectedCategoryId,
      urgency
    ]
  );

  const validation = useMemo(
    () => validatePostGigForm(formValues, allowedCategoryIds, confirmedLocation),
    [allowedCategoryIds, confirmedLocation, formValues]
  );
  const visibleErrors = submitAttempted ? { ...validation.errors, ...fieldErrors } : fieldErrors;
  const showPricing = Boolean(selectedCategoryId) && description.trim().length >= MIN_DESCRIPTION_LENGTH;

  const { mutate: runEstimate, isPending: isEstimating, data: estimateData } = useMutation({
    mutationFn: (payload: CreateGigInput) => api.estimateGig(payload, session.token)
  });

  useEffect(() => {
    if (!validation.success || !validation.payload) return;
    const timer = setTimeout(() => runEstimate(validation.payload!), 500);
    return () => clearTimeout(timer);
  }, [runEstimate, validation.payload, validation.success]);

  const createMutation = useMutation({
    mutationFn: (payload: CreateGigInput) => api.createGig(payload, session.token),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ["my-gigs"] });
      Alert.alert(
        "Request sent",
        "Your request has been sent to nearby verified workers.",
        [{ text: "View matches", onPress: () => navigation.navigate("GigSelectWorkers", { gigId: result.gig.id }) }]
      );
    },
    onError: (error: Error) => {
      if (error instanceof ApiValidationError) {
        setFieldErrors(error.fieldErrors);
        setSubmitAttempted(true);
        return;
      }
      Alert.alert("Could not send request", error.message);
    }
  });

  function handleEstimatedHoursChange(value: string): void {
    setFieldErrors((current) => clearFieldError(current, "estimatedHours"));
    if (value === "") {
      setEstimatedHours("");
      return;
    }
    if (!/^\d+$/.test(value)) return;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return;
    setEstimatedHours(String(Math.min(12, Math.max(1, parsed))));
  }

  function handleSubmit(): void {
    if (createMutation.isPending) return;
    setSubmitAttempted(true);
    setFieldErrors(EMPTY_ERRORS);
    const result = validatePostGigForm(formValues, allowedCategoryIds, confirmedLocation, new Date());
    if (!result.success || !result.payload) {
      setFieldErrors(result.errors);
      return;
    }
    createMutation.mutate(result.payload);
  }

  return (
    <View style={{ flex: 1, backgroundColor: DUTS.background, paddingHorizontal: 20 }}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1 }}
        keyboardVerticalOffset={Platform.OS === "ios" ? 12 : 0}
      >
        <ScrollView
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          contentContainerStyle={{ paddingBottom: 40, gap: 12, flexGrow: 1 }}
        >
          <Text className="px-1 text-xs font-bold uppercase tracking-[2px] text-brand">Request Help</Text>

          <DutsCard className="w-full max-w-xl gap-3 self-center p-4">
            <ServiceCategorySelect
              mvp={categoriesQuery.data?.mvp ?? []}
              selectedId={selectedCategoryId}
              onSelect={(categoryId) => {
                setSelectedCategoryId(categoryId);
                setFieldErrors((current) => clearFieldError(current, "serviceType"));
              }}
              error={visibleErrors.serviceType}
            />

            <View className="gap-1">
              <TextAreaInput
                label="Job description"
                value={description}
                onChangeText={(value) => {
                  setDescription(value);
                  setFieldErrors((current) => clearFieldError(current, "description"));
                }}
                placeholder="What needs to be done? Include access details if helpful."
                maxLength={MAX_DESCRIPTION_LENGTH}
                error={visibleErrors.description}
              />
              <Text className="text-right text-xs text-muted">
                {description.trim().length}/{MAX_DESCRIPTION_LENGTH} · min {MIN_DESCRIPTION_LENGTH}
              </Text>
            </View>

            <AddressAutocomplete
              token={session.token}
              label="Location"
              value={locationAddress}
              onChangeText={(value) => {
                setLocationAddress(value);
                setFieldErrors((current) => clearFieldError(current, "location"));
              }}
              selectedLocation={confirmedLocation}
              onLocationResolved={(location) => {
                setConfirmedLocation(location);
                setFieldErrors((current) => clearFieldError(current, "location"));
              }}
              onLocationCleared={() => setConfirmedLocation(null)}
              error={visibleErrors.location}
            />

            <DateTimeFields
              dateValue={preferredDate}
              timeValue={preferredTime}
              onDateChange={(value) => {
                setPreferredDate(value);
                setFieldErrors((current) => clearFieldError(current, "preferredDateTime"));
              }}
              onTimeChange={(value) => {
                setPreferredTime(value);
                setFieldErrors((current) => clearFieldError(current, "preferredDateTime"));
              }}
              error={visibleErrors.preferredDateTime}
            />

            {pricingType === "ESTIMATE_TIMER" ? (
              <View className="gap-1">
                <FormInput
                  label={estimatedHoursLabel(pricingType)}
                  value={estimatedHours}
                  onChangeText={handleEstimatedHoursChange}
                  placeholder="2"
                  keyboardType="number-pad"
                  error={visibleErrors.estimatedHours}
                />
                <Text className="text-xs text-muted">{estimatedHoursHint(pricingType)}</Text>
              </View>
            ) : null}

            {showPricing ? (
              <>
                <AutoPricingCard pricingType={pricingType} />
                <PriceEstimateCard
                  estimate={estimateData?.estimate}
                  isLoading={isEstimating}
                  isComplete={validation.success}
                  pricingType={pricingType}
                />
              </>
            ) : null}

            <Text className="text-center text-xs text-muted">
              No payment now. You only pay after you choose a worker and approve completion.
            </Text>

            <LoadingButton
              label="Request Help"
              loadingLabel="Sending request..."
              onPress={handleSubmit}
              disabled={!validation.success || createMutation.isPending}
              loading={createMutation.isPending}
            />
          </DutsCard>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
