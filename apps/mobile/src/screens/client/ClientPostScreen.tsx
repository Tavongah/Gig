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
  type GigUrgency,
  type PostGigFormValues,
  type PostGigPhoto,
  validatePhotoFile,
  validatePostGigForm
} from "@gigflow/shared";
import { api, ApiValidationError } from "../../lib/api";
import { TabScreen } from "../../components/TabScreen";
import { HeroBanner } from "../../components/HeroBanner";
import { DutsCard } from "../../components/DutsCard";
import { ServiceCategoryPicker } from "../../components/ServiceCategoryPicker";
import { FormInput } from "../../components/FormInput";
import { TextAreaInput } from "../../components/TextAreaInput";
import { SelectButtonGroup } from "../../components/SelectButtonGroup";
import { LoadingButton } from "../../components/LoadingButton";
import { PriceEstimateCard } from "../../components/PriceEstimateCard";
import { ErrorMessage } from "../../components/ErrorMessage";
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

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [estimatedHours, setEstimatedHours] = useState("2");
  const [urgency, setUrgency] = useState<GigUrgency>("STANDARD");
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(
    route.params?.serviceCategoryId ?? null
  );
  const [locationAddress, setLocationAddress] = useState("");
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

  const formValues = useMemo<PostGigFormValues>(
    () => ({
      serviceCategoryId: selectedCategoryId,
      title,
      description,
      estimatedHours,
      locationAddress,
      urgency,
      preferredDate,
      preferredTime,
      photos
    }),
    [description, estimatedHours, locationAddress, photos, preferredDate, preferredTime, selectedCategoryId, title, urgency]
  );

  const validation = useMemo(() => validatePostGigForm(formValues, allowedCategoryIds), [allowedCategoryIds, formValues]);
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
      navigation.navigate("GigTracking", { gigId: result.gig.id });
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
    const result = validatePostGigForm(formValues, allowedCategoryIds);
    if (!result.success || !result.payload) {
      setFieldErrors(result.errors);
      return;
    }
    createMutation.mutate();
  }

  return (
    <TabScreen>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 32 }}>
        <HeroBanner
          eyebrow="Post a gig"
          title="What do you need done?"
          subtitle="Get an instant price estimate and broadcast to verified workers nearby."
        />

        <DutsCard className="mt-2 gap-4 p-5">
          <ServiceCategoryPicker
            mvp={categoriesQuery.data?.mvp ?? []}
            comingSoon={categoriesQuery.data?.comingSoon}
            selectedId={selectedCategoryId}
            onSelect={(categoryId) => {
              setSelectedCategoryId(categoryId);
              setFieldErrors((current) => clearFieldError(current, "serviceType"));
            }}
          />
          <ErrorMessage message={visibleErrors.serviceType} />

          <FormInput
            label="Job title"
            value={title}
            onChangeText={(value) => {
              setTitle(value);
              setFieldErrors((current) => clearFieldError(current, "title"));
            }}
            placeholder="e.g. Help move couch to second floor"
            maxLength={80}
            error={visibleErrors.title}
          />

          <TextAreaInput
            label="Job description"
            value={description}
            onChangeText={(value) => {
              setDescription(value);
              setFieldErrors((current) => clearFieldError(current, "description"));
            }}
            placeholder="Describe the job, tools needed, and access details..."
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

          <FormInput
            label="Location / address"
            value={locationAddress}
            onChangeText={(value) => {
              setLocationAddress(value);
              setFieldErrors((current) => clearFieldError(current, "location"));
            }}
            placeholder="Street address or full job location"
            maxLength={150}
            error={visibleErrors.location}
          />

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
            <Text className="text-sm font-bold uppercase tracking-wider text-muted">Preferred date and time</Text>
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
            <ErrorMessage message={visibleErrors.preferredDateTime} />
          </View>

          <View className="gap-2">
            <Text className="text-sm font-bold uppercase tracking-wider text-muted">Photos</Text>
            <Pressable onPress={() => void pickPhotos()} className="rounded-2xl border border-dashed border-slate-300 px-4 py-4">
              <Text className="text-center font-bold text-muted">
                {photos.length > 0 ? `${photos.length} photo(s) added` : "Add photos (optional)"}
              </Text>
              <Text className="mt-1 text-center text-xs text-muted">JPG, PNG, or WEBP up to 5MB each</Text>
            </Pressable>
            <ErrorMessage message={visibleErrors.photos} />
          </View>

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
