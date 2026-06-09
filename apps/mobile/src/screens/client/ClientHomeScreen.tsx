import { Pressable, ScrollView, Text, View } from "react-native";

import { useQuery } from "@tanstack/react-query";

import { useNavigation } from "@react-navigation/native";

import type { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";

import { TabScreen } from "../../components/TabScreen";

import { TrustBadges } from "../../components/TrustBadges";

import { ServiceCategoryCard } from "../../components/ServiceCategoryCard";

import { WorkerCard } from "../../components/WorkerCard";

import { HeroBanner } from "../../components/HeroBanner";

import { AppButton } from "../../components/AppButton";

import { DutsCard } from "../../components/DutsCard";

import { api } from "../../lib/api";

import type { ClientTabParamList } from "../../navigation/types";

import { useSessionStore } from "../../stores/session.store";



const DEFAULT_LAT = 33.749;

const DEFAULT_LNG = -84.388;



const STEPS = [

  { step: "1", title: "Post your gig", body: "Describe the job and get an instant price estimate." },

  { step: "2", title: "Get matched", body: "Nearby verified workers accept and head your way." },

  { step: "3", title: "Track live", body: "Follow your worker from acceptance to completion." }

] as const;



export function ClientHomeScreen() {

  const navigation = useNavigation<BottomTabNavigationProp<ClientTabParamList>>();

  const session = useSessionStore((state) => state.session)!;



  const categoriesQuery = useQuery({ queryKey: ["categories"], queryFn: api.listCategories });

  const workersQuery = useQuery({

    queryKey: ["available-workers-preview", DEFAULT_LAT, DEFAULT_LNG],

    queryFn: () => api.availableWorkersNearby(DEFAULT_LAT, DEFAULT_LNG, session.token),

    refetchInterval: 20_000

  });



  const previewWorkers = (workersQuery.data?.workers ?? []).slice(0, 3);



  return (

    <TabScreen>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 36, gap: 24 }}>

        <HeroBanner

          eyebrow="GigFlow"

          title="Need an extra pair of hands today?"

          subtitle="Post a local gig and get matched with verified workers nearby — tracked live from start to finish."

        >

          <View className="mt-2 gap-3">

            <AppButton label="Post a Gig" onPress={() => navigation.navigate("PostGig")} variant="primary" />

            <AppButton label="Find Available Workers" onPress={() => navigation.navigate("Workers")} variant="secondary" />

          </View>

        </HeroBanner>



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

