import { useState } from "react";
import { Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigation, useRoute } from "@react-navigation/native";
import type { RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { createReviewSchema, zodErrorsToFieldMap } from "@gigflow/shared";
import { api } from "../../lib/api";
import { logDutsFlow } from "../../lib/flow-log";
import { showAlert } from "../../lib/confirm";
import { LoadingButton } from "../../components/LoadingButton";
import { AppButton } from "../../components/AppButton";
import { ErrorMessage } from "../../components/ErrorMessage";
import { DutsCard } from "../../components/DutsCard";
import { DUTS } from "../../lib/theme";
import type { RootStackParamList } from "../../navigation/types";
import { useSessionStore } from "../../stores/session.store";

export function ReviewScreen() {
  const session = useSessionStore((state) => state.session)!;
  const route = useRoute<RouteProp<RootStackParamList, "Review">>();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const queryClient = useQueryClient();
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);

  function goHome(): void {
    logDutsFlow("HOME_REDIRECTED", {
      gigId: route.params.gigId,
      userId: session.user.id,
      userRole: session.user.roles?.[0],
      platform: Platform.OS === "web" ? "web" : "mobile"
    });
    navigation.reset({ index: 0, routes: [{ name: "MainTabs" }] });
  }

  const reviewMutation = useMutation({
    mutationFn: (payload: { rating: number; comment: string }) =>
      api.createReview(route.params.gigId, payload, session.token),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["gig", route.params.gigId] });
      logDutsFlow("REVIEW_SUBMITTED", {
        gigId: route.params.gigId,
        userId: session.user.id,
        userRole: session.user.roles?.[0],
        platform: Platform.OS === "web" ? "web" : "mobile"
      });
      showAlert("Thank you!", "Your review helps other customers find great workers.");
      goHome();
    },
    onError: (err: Error) => setError(err.message)
  });

  function handleSubmit(): void {
    const parsed = createReviewSchema.safeParse({ rating, comment: comment.trim() });
    if (!parsed.success) {
      const errors = zodErrorsToFieldMap(parsed.error);
      setError(errors.comment ?? errors.rating ?? Object.values(errors)[0] ?? "Check your review.");
      return;
    }
    setError(null);
    reviewMutation.mutate(parsed.data);
  }

  function handleSkip(): void {
    logDutsFlow("REVIEW_SKIPPED", {
      gigId: route.params.gigId,
      userId: session.user.id,
      userRole: session.user.roles?.[0],
      platform: Platform.OS === "web" ? "web" : "mobile"
    });
    goHome();
  }

  return (
    <ScrollView
      className="flex-1"
      style={{ backgroundColor: DUTS.background }}
      contentContainerStyle={{ padding: 20, paddingBottom: 40, gap: 16 }}
    >
      <Text className="text-sm font-bold uppercase tracking-wider text-brand">Review</Text>
      <Text className="text-2xl font-black text-ink">How was {route.params.workerName}?</Text>
      <Text className="text-sm text-muted">Reviews are optional. You can skip and return home anytime.</Text>

      <DutsCard className="gap-4 p-5">
        <Text className="text-sm font-bold uppercase tracking-wider text-muted">Star rating</Text>
        <View className="flex-row gap-2">
          {[1, 2, 3, 4, 5].map((value) => (
            <Pressable
              key={value}
              onPress={() => setRating(value)}
              accessibilityRole="button"
              accessibilityLabel={`${value} star${value === 1 ? "" : "s"}`}
              accessibilityState={{ selected: value <= rating }}
            >
              <Text className={`text-3xl ${value <= rating ? "text-orange" : "text-slate-300"}`}>★</Text>
            </Pressable>
          ))}
        </View>

        <Text className="text-sm font-bold uppercase tracking-wider text-muted">Your review</Text>
        <TextInput
          className="min-h-28 rounded-2xl bg-surface px-4 py-4 text-ink"
          value={comment}
          onChangeText={setComment}
          placeholder="Share how the gig went..."
          multiline
          maxLength={500}
        />
        <ErrorMessage message={error} />

        <LoadingButton
          label="Leave a Review"
          loadingLabel="Submitting..."
          onPress={handleSubmit}
          loading={reviewMutation.isPending}
          disabled={comment.trim().length < 10}
        />
        <AppButton label="Skip" variant="secondary" onPress={handleSkip} disabled={reviewMutation.isPending} />
        <AppButton label="Not Now" variant="secondary" onPress={handleSkip} disabled={reviewMutation.isPending} />
        <AppButton label="Back to Home" variant="secondary" onPress={goHome} disabled={reviewMutation.isPending} />
      </DutsCard>
    </ScrollView>
  );
}
