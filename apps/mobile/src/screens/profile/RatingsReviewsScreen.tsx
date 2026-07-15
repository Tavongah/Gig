import { useMemo } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { useQueries, useQuery } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { DutsCard } from "../../components/DutsCard";
import { EmptyState } from "../../components/EmptyState";
import { Screen } from "../../components/Screen";
import { api, type GigReview } from "../../lib/api";
import { COMPLETED_STATUSES } from "../../lib/gig-status";
import { DUTS } from "../../lib/theme";
import { useSessionStore } from "../../stores/session.store";

export function RatingsReviewsScreen() {
  const session = useSessionStore((state) => state.session)!;
  const profile = useSessionStore((state) => state.profile);
  const activeRole = useSessionStore((state) => state.activeRole);
  const user = profile ?? session.user;
  const perspective = activeRole === "WORKER" ? "WORKER" : "CLIENT";

  const gigsQuery = useQuery({
    queryKey: ["my-gigs", perspective, "reviews"],
    queryFn: () => api.myGigs(session.token, perspective)
  });

  const completedIds = useMemo(
    () =>
      (gigsQuery.data?.gigs ?? [])
        .filter((gig) => COMPLETED_STATUSES.includes(gig.status as never))
        .map((gig) => gig.id),
    [gigsQuery.data?.gigs]
  );

  const reviewQueries = useQueries({
    queries: completedIds.slice(0, 12).map((gigId) => ({
      queryKey: ["gig-reviews", gigId],
      queryFn: () => api.getGigReviews(gigId, session.token),
      enabled: completedIds.length > 0
    }))
  });

  const allReviews = useMemo(() => {
    const rows: Array<GigReview & { gigId: string }> = [];
    reviewQueries.forEach((query, index) => {
      const gigId = completedIds[index];
      if (!gigId) return;
      for (const review of query.data?.reviews ?? []) {
        rows.push({ ...review, gigId });
      }
    });
    return rows;
  }, [completedIds, reviewQueries]);

  const received = allReviews.filter((review) => review.reviewee?.id === user.id);
  const written = allReviews.filter((review) => review.reviewer?.id === user.id);
  const average =
    received.length === 0
      ? null
      : received.reduce((sum, review) => sum + review.rating, 0) / received.length;

  const loading = gigsQuery.isLoading || reviewQueries.some((query) => query.isLoading);

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 16, paddingBottom: 32 }}>
        <DutsCard className="gap-2 p-5">
          <Text className="text-xs font-bold uppercase tracking-wider text-muted">Average rating</Text>
          <View className="flex-row items-center gap-2">
            <Ionicons name="star" size={22} color={DUTS.orange} />
            <Text className="text-2xl font-black text-ink">
              {average == null ? "—" : average.toFixed(1)}
            </Text>
          </View>
          <Text className="text-sm text-muted">
            {received.length} review{received.length === 1 ? "" : "s"} received
          </Text>
        </DutsCard>

        {loading ? <ActivityIndicator color={DUTS.purple} /> : null}

        <DutsCard className="gap-3 p-5">
          <Text className="text-xs font-bold uppercase tracking-wider text-muted">Reviews received</Text>
          {received.length === 0 ? (
            <Text className="text-sm text-muted">No reviews received yet.</Text>
          ) : (
            received.map((review) => (
              <View key={review.id} className="border-b border-border py-2">
                <Text className="font-bold text-ink">
                  {review.rating}/5 · {review.reviewer?.fullName ?? "Customer"}
                </Text>
                {review.comment ? <Text className="text-sm text-muted">{review.comment}</Text> : null}
              </View>
            ))
          )}
        </DutsCard>

        <DutsCard className="gap-3 p-5">
          <Text className="text-xs font-bold uppercase tracking-wider text-muted">Reviews written</Text>
          {written.length === 0 ? (
            <EmptyState emoji="⭐" title="No reviews written" description="Reviews you leave after completed gigs show here." />
          ) : (
            written.map((review) => (
              <View key={review.id} className="border-b border-border py-2">
                <Text className="font-bold text-ink">
                  {review.rating}/5 · {review.reviewee?.fullName ?? "Worker"}
                </Text>
                {review.comment ? <Text className="text-sm text-muted">{review.comment}</Text> : null}
              </View>
            ))
          )}
        </DutsCard>
      </ScrollView>
    </Screen>
  );
}
