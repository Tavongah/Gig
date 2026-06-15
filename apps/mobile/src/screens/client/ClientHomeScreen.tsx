import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useNavigation } from "@react-navigation/native";
import type { CompositeNavigationProp } from "@react-navigation/native";
import type { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { TabScreen } from "../../components/TabScreen";
import { TrustBadges } from "../../components/TrustBadges";
import { ServiceCategoryCard } from "../../components/ServiceCategoryCard";
import { WorkerCard } from "../../components/WorkerCard";
import { HeroBanner } from "../../components/HeroBanner";
import { PendingPaymentCard } from "../../components/PendingPaymentCard";
import { APP_NAME } from "../../lib/brand";
import { AppButton } from "../../components/AppButton";
import { DutsCard } from "../../components/DutsCard";
import { api } from "../../lib/api";
import { getCurrentCoordinates } from "../../lib/location";
import { gigNeedsPayment } from "../../lib/gig-payment";
import { useStripeCheckout } from "../../hooks/useStripeCheckout";
import type { ClientTabParamList, RootStackParamList } from "../../navigation/types";
import { useSessionStore } from "../../stores/session.store";

type NavigationProp = CompositeNavigationProp<
  BottomTabNavigationProp<ClientTabParamList, "Home">,
  NativeStackNavigationProp<RootStackParamList>
>;

const STEPS = [
  { step: "1", title: "Post your gig", body: "Describe the job and get an instant price estimate." },
  { step: "2", title: "Get matched", body: "Nearby verified workers accept and head your way." },
  { step: "3", title: "Track live", body: "Follow your worker from acceptance to completion." }
] as const;

export function ClientHomeScreen() {
  const navigation = useNavigation<NavigationProp>();
  const session = useSessionStore((state) => state.session)!;
  const [clientCoords, setClientCoords] = useState<{ latitude: number; longitude: number } | null>(null);

  useEffect(() => {
    void getCurrentCoordinates()
      .then((coords) => setClientCoords(coords))
      .catch(() => undefined);
  }, []);

  const categoriesQuery = useQuery({ queryKey: ["categories"], queryFn: api.listCategories });
  const myGigsQuery = useQuery({
    queryKey: ["my-gigs", "CLIENT"],
    queryFn: () => api.myGigs(session.token, "CLIENT"),
    refetchInterval: 15_000
  });
  const workersQuery = useQuery({
    queryKey: ["available-workers-preview", clientCoords?.latitude, clientCoords?.longitude],
    queryFn: () => api.availableWorkersNearby(clientCoords!.latitude, clientCoords!.longitude, session.token),
    enabled: Boolean(clientCoords),
    refetchInterval: 20_000
  });

  const { payWithStripe, isPaying, payingGigId } = useStripeCheckout();

  const unpaidGigs = useMemo(
    () => (myGigsQuery.data?.gigs ?? []).filter(gigNeedsPayment),
    [myGigsQuery.data?.gigs]
  );
  const previewWorkers = (workersQuery.data?.workers ?? []).slice(0, 3);



  return (

    <TabScreen>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 36, gap: 24 }}>

        <HeroBanner

          eyebrow={APP_NAME}

          title="Need an extra pair of hands today?"

          subtitle="Post a local gig and get matched with verified workers nearby — tracked live from start to finish."

        >

          <View className="mt-2 gap-3">

            <AppButton label="Post a Gig" onPress={() => navigation.navigate("PostGig")} variant="primary" />

            <AppButton label="Find Available Workers" onPress={() => navigation.navigate("Workers")} variant="secondary" />

          </View>

        </HeroBanner>

        {unpaidGigs.length > 0 ? (
          <View className="gap-3">
            <Text className="text-sm font-bold uppercase tracking-wider text-muted">Finish payment</Text>
            {unpaidGigs.map((gig) => (
              <PendingPaymentCard
                key={gig.id}
                gig={gig}
                onPay={() => payWithStripe(gig.id)}
                loading={isPaying && payingGigId === gig.id}
              />
            ))}
          </View>
        ) : null}

        <View className="gap-3">

          <Text className="text-sm font-bold uppercase tracking-wider text-muted">Popular Services</Text>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12 }}>

            {(categoriesQuery.data?.mvp ?? []).map((category) => (

              <ServiceCategoryCard

                key={category.id}

                category={category}

                onPress={() => navigation.navigate("PostGig", { serviceCategoryId: category.id })}

              />

            ))}

          </ScrollView>

        </View>



        <View className="gap-3">

          <View className="flex-row items-center justify-between">

            <Text className="text-sm font-bold uppercase tracking-wider text-muted">Workers Available Now</Text>

            <Pressable onPress={() => navigation.navigate("Workers")}>
              <Text className="text-sm font-bold text-brand">See all</Text>
            </Pressable>

          </View>

          {previewWorkers.length === 0 ? (

            <DutsCard className="p-5">

              <Text className="text-sm leading-5 text-muted">

                No workers online nearby right now. Post a gig to broadcast your job instantly.

              </Text>

            </DutsCard>

          ) : (

            previewWorkers.map((worker) => (

              <WorkerCard

                key={worker.userId}

                worker={worker}

                onRequest={() => navigation.navigate("PostGig", { preferredWorkerId: worker.userId })}

              />

            ))

          )}

        </View>



        <DutsCard className="gap-4 p-5">

          <Text className="text-sm font-bold uppercase tracking-wider text-brand">How It Works</Text>

          {STEPS.map((item) => (

            <View key={item.step} className="flex-row gap-3">

              <View className="h-9 w-9 items-center justify-center rounded-full bg-hero">

                <Text className="font-black text-brand">{item.step}</Text>

              </View>

              <View className="flex-1 gap-1">

                <Text className="font-black text-ink">{item.title}</Text>

                <Text className="text-sm leading-5 text-muted">{item.body}</Text>

              </View>

            </View>

          ))}

        </DutsCard>



        <TrustBadges />

      </ScrollView>

    </TabScreen>

  );

}

