import { useEffect, useMemo, useState } from "react";
import { Alert, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigation, useRoute } from "@react-navigation/native";
import type { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";
import type { CompositeNavigationProp, RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import {
  ALLOWED_PHOTO_MIME_TYPES,
  GIG_VALIDATION_MESSAGES,
  MAX_GIG_PHOTOS,
  type GeoPointInput,
  type GigUrgency,
  type PostGigFormValues,
  type PostGigPhoto,
  validatePhotoFile,
  validatePostGigForm
} from "@gigflow/shared";
import { api, ApiValidationError } from "../../lib/api";
import { TabScreen } from "../../components/TabScreen";
import { DutsCard } from "../../components/DutsCard";
import { ServiceCategorySelect } from "../../components/ServiceCategorySelect";
import { FormInput } from "../../components/FormInput";
import { TextAreaInput } from "../../components/TextAreaInput";
import { SelectButtonGroup } from "../../components/SelectButtonGroup";
import { LoadingButton } from "../../components/LoadingButton";
import { PriceEstimateCard } from "../../components/PriceEstimateCard";
import { CollapsibleSection } from "../../components/CollapsibleSection";
import { AddressAutocomplete } from "../../components/AddressAutocomplete";
import type { ClientTabParamList, RootStackParamList } from "../../navigation/types";
import { useSessionStore } from "../../stores/session.store";

const URGENCIES = [
  { value: "STANDARD" as const, label: "Standard", hint: "Normal price" },
  { value: "SOON" as const, label: "Soon", hint: "1.15x" },
  { value: "URGENT" as const, label: "Urgent", hint: "1.30x" }
];

const EMPTY_ERRORS: Record<string, string> = {};

type NavigationProp = CompositeNavigationProp<
  BottomTabNavigationProp<ClientTabParamList, "PostGig">,
  NativeStackNavigationProp<RootStackParamList>
>;

function clearFieldError(errors: Record<string, string>, field: string): Record<string, string> {
  if (!errors[field]) return errors;
  const next = { ...errors };
  delete next[field];
  return next;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("Could not read photo."));
    reader.readAsDataURL(file);
  });
}

export function ClientPostScreen() {
  const session = useSessionStore((state) => state.session)!;
  const route = useRoute<RouteProp<ClientTabParamList, "PostGig">>();
  const navigation = useNavigation<NavigationProp>();
  const queryClient = useQueryClient();

  const [description, setDescription] = useState("");
  const [estimatedHours, setEstimatedHours] = useState("2");
  const [urgency, setUrgency] = useState<GigUrgency>("STANDARD");
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(
    route.params?.serviceCategoryId ?? null
  );
  const [locationAddress, setLocationAddress] = useState("");
  const [confirmedLocation, setConfirmedLocation] = useState<GeoPointInput | null>(null);
  const [preferredDate, setPreferredDate] = useState("");
  const [preferredTime, setPreferredTime] = useState("");
  const [photos, setPhotos] = useState<PostGigPhoto[]>([]);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>(EMPTY_ERRORS);
  const [submitAttempted, setSubmitAttempted] = useState(false);

  const categoriesQuery = useQuery({ queryKey: ["categories"], queryFn: api.listCategories });
  const allowedCategoryIds = useMemo(
    () => (categoriesQuery.data?.mvp ?? []).map((category) => category.id),
    [categoriesQuery.data?.mvp]
  );

  useEffect(() => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    setPreferredDate(tomorrow.toISOString().slice(0, 10));
    setPreferredTime("14:00");
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

  const formValues = useMemo<PostGigFormValues>(
    () => ({
      serviceCategoryId: selectedCategoryId,
      serviceCategoryName: selectedCategory?.name ?? null,
      description,
      estimatedHours,
      locationAddress,
      urgency,
      preferredDate,
      preferredTime,
      photos
    }),
    [description, estimatedHours, locationAddress, photos, preferredDate, preferredTime, selectedCategory, selectedCategoryId, urgency]
  );

  const validation = useMemo(
    () => validatePostGigForm(formValues, allowedCategoryIds, confirmedLocation),
    [allowedCategoryIds, confirmedLocation, formValues]
  );
  const visibleErrors = submitAttempted ? { ...validation.errors, ...fieldErrors } : fieldErrors;

  const { mutate: runEstimate, isPending: isEstimating, data: estimateData } = useMutation({
    mutationFn: () => api.estimateGig(validation.payload!, session.token)
  });

  useEffect(() => {
    if (!validation.success || !validation.payload) return;
    const timer = setTimeout(() => runEstimate(), 500);
    return () => clearTimeout(timer);
  }, [runEstimate, validation.payload, validation.success]);

  const createMutation = useMutation({
    mutationFn: () => api.createGig(validation.payload!, session.token),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ["my-gigs"] });
      navigation.navigate("GigPayment", { gigId: result.gig.id });
    },
    onError: (error: Error) => {
      if (error instanceof ApiValidationError) {
        setFieldErrors(error.fieldErrors);
        setSubmitAttempted(true);
        return;
      }
      Alert.alert("Could not post gig", error.message);
    }
  });

  function handleEstimatedHoursChange(value: string): void {
    setFieldErrors((current) => clearFieldError(current, "estimatedHours"));
    if (value === "") {
      setEstimatedHours("");
      return;
    }
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return;
    setEstimatedHours(String(Math.min(12, Math.max(1, parsed))));
  }

  async function pickPhotos(): Promise<void> {
    if (photos.length >= MAX_GIG_PHOTOS) {
      setFieldErrors((current) => ({ ...current, photos: GIG_VALIDATION_MESSAGES.photoCount }));
      return;
    }
    if (Platform.OS !== "web") {
      Alert.alert("Photos", "Photo upload is available on web in this MVP build.");
      return;
    }
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ALLOWED_PHOTO_MIME_TYPES.join(",");
    input.multiple = true;
    input.onchange = async () => {
      const files = Array.from(input.files ?? []);
      const selectedFiles = files.slice(0, MAX_GIG_PHOTOS - photos.length);
      const nextPhotos: PostGigPhoto[] = [];
      for (const file of selectedFiles) {
        const fileError = validatePhotoFile({ type: file.type, size: file.size });
        if (fileError) {
          setFieldErrors((current) => ({ ...current, photos: fileError }));
          return;
        }
        nextPhotos.push({
          uri: await readFileAsDataUrl(file),
          name: file.name,
          mimeType: file.type,
          sizeBytes: file.size
        });
      }
      setFieldErrors((current) => clearFieldError(current, "photos"));
      setPhotos((current) => [...current, ...nextPhotos]);
    };
    input.click();
  }

  function handleSubmit(): void {
    setSubmitAttempted(true);
    setFieldErrors(EMPTY_ERRORS);
    const result = validatePostGigForm(formValues, allowedCategoryIds, confirmedLocation);
    if (!result.success || !result.payload) {
      setFieldErrors(result.errors);
      return;
    }
    createMutation.mutate();
  }

  return (
    <TabScreen>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 28, gap: 12 }}>
        <Text className="px-1 text-xs font-bold uppercase tracking-[2px] text-brand">Post a gig</Text>

        <DutsCard className="gap-3 p-4">
          <ServiceCategorySelect
            mvp={categoriesQuery.data?.mvp ?? []}
            comingSoon={categoriesQuery.data?.comingSoon}
            selectedId={selectedCategoryId}
            onSelect={(categoryId) => {
              setSelectedCategoryId(categoryId);
              setFieldErrors((current) => clearFieldError(current, "serviceType"));
            }}
            error={visibleErrors.serviceType}
          />

          <TextAreaInput
            label="Job description"
            value={description}
            onChangeText={(value) => {
              setDescription(value);
              setFieldErrors((current) => clearFieldError(current, "description"));
            }}
            placeholder="What needs to be done? Include access details if helpful."
            maxLength={1000}
            error={visibleErrors.description}
          />

          <FormInput
            label="Estimated hours"
            value={estimatedHours}
            onChangeText={handleEstimatedHoursChange}
            placeholder="2"
            keyboardType="number-pad"
            error={visibleErrors.estimatedHours}
          />

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

          <CollapsibleSection title="More options" subtitle="Urgency, schedule, and photos">
            <View className="gap-3">
              <SelectButtonGroup
                label="Urgency"
                options={URGENCIES}
                value={urgency}
                onChange={(value) => {
                  setUrgency(value);
                  setFieldErrors((current) => clearFieldError(current, "urgency"));
                }}
                error={visibleErrors.urgency}
              />

              <View className="gap-2">
                <Text className="text-sm font-bold uppercase tracking-wider text-label">Preferred date & time</Text>
                <Text className="text-xs text-muted">When would you like the job to start?</Text>
                <View className="flex-row gap-2">
                  <FormInput
                    label=""
                    value={preferredDate}
                    onChangeText={(value) => {
                      setPreferredDate(value);
                      setFieldErrors((current) => clearFieldError(current, "preferredDateTime"));
                    }}
                    placeholder="YYYY-MM-DD"
                    className="flex-1"
                  />
                  <FormInput
                    label=""
                    value={preferredTime}
                    onChangeText={(value) => {
                      setPreferredTime(value);
                      setFieldErrors((current) => clearFieldError(current, "preferredDateTime"));
                    }}
                    placeholder="HH:MM"
                    className="w-28"
                  />
                </View>
                {visibleErrors.preferredDateTime ? (
                  <Text className="text-sm text-orange">{visibleErrors.preferredDateTime}</Text>
                ) : null}
              </View>

              <View className="gap-2">
                <Text className="text-sm font-bold uppercase tracking-wider text-label">Photos</Text>
                <Text className="text-xs text-muted">Optional—helps workers understand the job.</Text>
                <Pressable
                  onPress={() => void pickPhotos()}
                  className="rounded-2xl border border-dashed border-border px-4 py-3 active:opacity-80"
                >
                  <Text className="text-center text-sm font-semibold text-muted">
                    {photos.length > 0 ? `${photos.length} photo(s) added` : "Add photos"}
                  </Text>
                </Pressable>
                {visibleErrors.photos ? <Text className="text-sm text-orange">{visibleErrors.photos}</Text> : null}
              </View>
            </View>
          </CollapsibleSection>

          <PriceEstimateCard
            estimate={estimateData?.estimate}
            isLoading={isEstimating}
            isComplete={validation.success}
          />

          <LoadingButton
            label="Post Gig"
            loadingLabel="Posting..."
            onPress={handleSubmit}
            disabled={!validation.success}
            loading={createMutation.isPending}
          />
        </DutsCard>
      </ScrollView>
    </TabScreen>
  );
}
