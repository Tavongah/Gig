import { useState } from "react";
import { Alert, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigation, useRoute } from "@react-navigation/native";
import type { RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { api } from "../../lib/api";
import { LoadingButton } from "../../components/LoadingButton";
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

  const reviewMutation = useMutation({
    mutationFn: () => api.createReview(route.params.gigId, { rating, comment: comment.trim() }, session.token),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["gig", route.params.gigId] });
      Alert.alert("Thank you!", "Your review helps other customers find great workers.", [
        { text: "Done", onPress: () => navigation.goBack() }
      ]);
    },
    onError: (err: Error) => setError(err.message)
  });

  function handleSubmit(): void {
    if (comment.trim().length < 10) {
      setError("Please write at least 10 characters.");
      return;
    }
    setError(null);
    reviewMutation.mutate();
  }

  return (
    <ScrollView
      className="flex-1"
      style={{ backgroundColor: DUTS.background }}
      contentContainerStyle={{ padding: 20, paddingBottom: 40, gap: 16 }}
    >
      <Text className="text-sm font-bold uppercase tracking-wider text-brand">Review</Text>
      <Text className="text-2xl font-black text-ink">How was {route.params.workerName}?</Text>

      <DutsCard className="gap-4 p-5">
        <Text className="text-sm font-bold uppercase tracking-wider text-muted">Star rating</Text>
        <View className="flex-row gap-2">
          {[1, 2, 3, 4, 5].map((value) => (
            <Pressable key={value} onPress={() => setRating(value)}>
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

        <View className="rounded-2xl bg-teal/10 px-4 py-3">
          <Text className="text-sm font-semibold text-teal">Tip (coming soon)</Text>
          <Text className="text-xs text-muted">Tips will be available when payments launch.</Text>
        </View>

        <LoadingButton
          label="Submit Review"
          loadingLabel="Submitting..."
          onPress={handleSubmit}
          loading={reviewMutation.isPending}
          disabled={comment.trim().length < 10}
        />
      </DutsCard>
    </ScrollView>
  );
}
