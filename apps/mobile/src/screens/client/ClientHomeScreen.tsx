import { useMemo } from "react";
import { Alert, ScrollView, Text, View } from "react-native";
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
import { ACTIVE_CLIENT_STATUSES, isSearching } from "../../lib/gig-status";
import { useSocketEvents } from "../../hooks/useSocket";
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

  useSocketEvents(
    useMemo(
      () => ({
        gig_rematching: (payload: { gigId?: string }) => {
          void myGigsQuery.refetch();
          if (payload.gigId) {
            navigation.navigate("GigSelectWorkers", { gigId: payload.gigId });
          }
        },
        selected_worker_cancelled: (payload: { gigId?: string; rematching?: boolean }) => {
          void myGigsQuery.refetch();
          if (payload.gigId && payload.rematching !== false) {
            navigation.navigate("GigSelectWorkers", { gigId: payload.gigId });
          }
        },
        notification: (payload: { type?: string; title: string; body: string; gigId?: string }) => {
          if (payload.type !== "NEW_MESSAGE") {
            return;
          }
          Alert.alert(payload.title, payload.body, [
            { text: "Dismiss", style: "cancel" },
            ...(payload.gigId
              ? [
                  {
                    text: "Open chat",
                    onPress: () =>
                      navigation.navigate("Chat", {
                        gigId: payload.gigId!,
                        title: "Messages"
                      })
                  }
                ]
              : [])
          ]);
        }
      }),
      [myGigsQuery, navigation]
    )
  );

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
    const preferredIds = new Set(preferred.map((category) => category.id));
    const rest = mvp.filter((category) => !preferredIds.has(category.id));
    return [...preferred, ...rest];
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
            onTrack={() =>
              navigation.navigate(
                isSearching(activeGig.status) ? "GigSelectWorkers" : "GigTracking",
                { gigId: activeGig.id }
              )
            }
          />
        ) : null}

        <View className="gap-3">
          <Text className="px-1 text-sm font-bold uppercase tracking-wider text-muted">Popular Services</Text>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 12, paddingHorizontal: 2, paddingBottom: 4 }}
          >
            {popularServices.map((category) => (
              <View key={category.id} style={{ width: 168 }}>
                <ServiceCategoryCard
                  category={category}
                  onPress={() => navigation.navigate("PostGig", { serviceCategoryId: category.id })}
                />
              </View>
            ))}
          </ScrollView>
        </View>
      </View>
    </TabScreen>
  );
}
