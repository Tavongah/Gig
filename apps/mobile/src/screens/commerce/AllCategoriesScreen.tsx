import { Pressable, ScrollView, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useQuery } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { StoreHeader, StorePage } from "../../components/StoreHeader";
import { StorefrontCategoryCard } from "../../components/StorefrontCategoryCard";
import { api } from "../../lib/api";
import { useShopBrowse } from "../../lib/shop-browse";
import { DUTS } from "../../lib/theme";
import {
  liveCatalogDestinations,
  moreOnDutsCategories,
  type ResolvedStorefrontCategory
} from "../../lib/storefront-categories";
import { openStorefrontCategory } from "../../lib/storefront-nav";
import type { RootStackParamList } from "../../navigation/types";

export function AllCategoriesScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const browse = useShopBrowse();
  const categoriesQuery = useQuery({
    queryKey: ["commerce-categories", ...browse.queryKey],
    queryFn: () => api.commerceCategories(browse.geo, browse.token),
    enabled: browse.ready
  });
  const catalogNames = (categoriesQuery.data?.categories ?? []).map((c) => c.name);
  const live = liveCatalogDestinations(catalogNames);
  const soon = moreOnDutsCategories(catalogNames);

  function open(cat: ResolvedStorefrontCategory) {
    openStorefrontCategory(navigation, cat, catalogNames);
  }

  return (
    <View className="flex-1 bg-background">
      <StoreHeader compact showCategories={false} />
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        <StorePage>
          <Text className="mt-5 text-2xl font-black text-ink">All categories</Text>
          <Text className="mt-1 text-sm text-muted">Shop today on DUTS, with more local stores coming soon.</Text>

          <Text className="mb-3 mt-6 text-lg font-extrabold text-ink">Shop today</Text>
          <View className="flex-row flex-wrap" style={{ gap: 10 }}>
            {live.map((cat) => (
              <View key={cat.slug} style={{ width: "30%", minWidth: 96, flexGrow: 1, maxWidth: 160 }}>
                <StorefrontCategoryCard category={cat} compact onPress={() => open(cat)} />
              </View>
            ))}
          </View>

          {soon.length > 0 ? (
            <>
              <Text className="mb-3 mt-8 text-lg font-extrabold text-ink">More on DUTS</Text>
              <View className="flex-row flex-wrap" style={{ gap: 10 }}>
                {soon.map((cat) => (
                  <View key={cat.slug} style={{ width: "30%", minWidth: 96, flexGrow: 1, maxWidth: 160 }}>
                    <StorefrontCategoryCard category={cat} compact onPress={() => open(cat)} />
                  </View>
                ))}
              </View>
            </>
          ) : null}

          <Pressable
            onPress={() => navigation.navigate("MainTabs", { screen: "Home" })}
            accessibilityRole="button"
            className="mt-8 flex-row items-center self-start"
          >
            <Ionicons name="arrow-back" size={18} color={DUTS.purple} />
            <Text className="ml-1 font-bold" style={{ color: DUTS.purple }}>
              Back to shopping
            </Text>
          </Pressable>
        </StorePage>
      </ScrollView>
    </View>
  );
}
