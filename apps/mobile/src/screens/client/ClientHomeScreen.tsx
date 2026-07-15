import { useMemo } from "react";
import { Pressable, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useNavigation } from "@react-navigation/native";
import type { CompositeNavigationProp } from "@react-navigation/native";
import type { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { TabScreen } from "../../components/TabScreen";
import { ServiceCategoryCard } from "../../components/ServiceCategoryCard";
import { HeroBanner } from "../../components/HeroBanner";
import { PendingPaymentCard } from "../../components/PendingPaymentCard";
import { ActiveGigCard } from "../../components/ActiveGigCard";
import { AppButton } from "../../components/AppButton";
import { api } from "../../lib/api";
import { gigNeedsPayment } from "../../lib/gig-payment";
import { ACTIVE_CLIENT_STATUSES } from "../../lib/gig-status";
import type { ClientTabParamList, RootStackParamList } from "../../navigation/types";
import { useSessionStore } from "../../stores/session.store";

type NavigationProp = CompositeNavigationProp<
  BottomTabNavigationProp<ClientTabParamList, "Home">,
  NativeStackNavigationProp<RootStackParamList>
>;

const POPULAR_SERVICE_SLUGS = [
  "house-cleaning",
  "lawn-cutting",
  "moving-assistance",
  "car-detailing"
] as const;

export function ClientHomeScreen() {
  const navigation = useNavigation<NavigationProp>();
  const session = useSessionStore((state) => state.session)!;

  const categoriesQuery = useQuery({ queryKey: ["categories"], queryFn: api.listCategories });
  const myGigsQuery = useQuery({
    queryKey: ["my-gigs", "CLIENT"],
    queryFn: () => api.myGigs(session.token, "CLIENT"),
    refetchInterval: 15_000
  });

  const unpaidGigs = useMemo(
    () => (myGigsQuery.data?.gigs ?? []).filter(gigNeedsPayment),
    [myGigsQuery.data?.gigs]
  );

  const activeGig = useMemo(() => {
    const gigs = myGigsQuery.data?.gigs ?? [];
    const unpaidIds = new Set(unpaidGigs.map((gig) => gig.id));
    return (
      gigs.find(
        (gig) =>
          !unpaidIds.has(gig.id) &&
          ACTIVE_CLIENT_STATUSES.includes(gig.status as (typeof ACTIVE_CLIENT_STATUSES)[number])
      ) ?? null
    );
  }, [myGigsQuery.data?.gigs, unpaidGigs]);

  const popularServices = useMemo(() => {
    const mvp = categoriesQuery.data?.mvp ?? [];
    const bySlug = new Map(mvp.map((category) => [category.slug, category]));
    const preferred = POPULAR_SERVICE_SLUGS.map((slug) => bySlug.get(slug)).filter(
      (category): category is NonNullable<typeof category> => Boolean(category)
    );
    if (preferred.length >= 4) return preferred.slice(0, 4);
    return mvp.slice(0, 4);
  }, [categoriesQuery.data?.mvp]);

  return (
    <TabScreen>
      <View className="flex-1 gap-4 pb-2">
        <HeroBanner
          showLogo
          title="Need an extra pair of hands today?"
          subtitle="Book trusted local help in minutes."
        >
          <View className="mt-1 gap-2">
            <AppButton label="Request Help" onPress={() => navigation.navigate("PostGig")} variant="primary" />
            <Text className="text-center text-xs text-muted">✓ Verified workers • Secure payments</Text>
          </View>
        </HeroBanner>

        {unpaidGigs.length > 0 ? (
          <View className="gap-2">
            {unpaidGigs.slice(0, 1).map((gig) => (
              <PendingPaymentCard
                key={gig.id}
                gig={gig}
                onPay={() =>
                  navigation.navigate("GigPayment", {
                    gigId: gig.id,
                    workerId: gig.assignments?.[0]?.worker?.id
                  })
                }
              />
            ))}
          </View>
        ) : activeGig ? (
          <ActiveGigCard
            gig={activeGig}
            onTrack={() => navigation.navigate("GigTracking", { gigId: activeGig.id })}
          />
        ) : null}

        <View className="gap-3">
          <View className="flex-row items-center justify-between px-1">
            <Text className="text-sm font-bold uppercase tracking-wider text-muted">Popular Services</Text>
            <Pressable onPress={() => navigation.navigate("PostGig")} hitSlop={8}>
              <Text className="text-sm font-bold text-brand">See all →</Text>
            </Pressable>
          </View>

          <View className="flex-row flex-wrap justify-between gap-y-3">
            {popularServices.map((category) => (
              <View key={category.id} className="w-[48%]">
                <ServiceCategoryCard
                  category={category}
                  compact
                  onPress={() => navigation.navigate("PostGig", { serviceCategoryId: category.id })}
                />
              </View>
            ))}
          </View>
        </View>
      </View>
    </TabScreen>
  );
}
