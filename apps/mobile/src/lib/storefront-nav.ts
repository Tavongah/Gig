import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/types";
import {
  destinationFor,
  type ResolvedStorefrontCategory
} from "./storefront-categories";

export function openStorefrontCategory(
  navigation: NativeStackNavigationProp<RootStackParamList>,
  category: ResolvedStorefrontCategory | string,
  catalogNames: string[] = []
) {
  const dest = typeof category === "string" ? destinationFor(category, catalogNames) : category;
  if (!dest) {
    navigation.navigate("ProductSearch", { category: typeof category === "string" ? category : undefined, q: undefined });
    return;
  }
  if (dest.state === "LIVE" && dest.catalogName) {
    navigation.navigate("ProductSearch", { category: dest.catalogName, q: undefined });
    return;
  }
  navigation.navigate("MarketplaceCategory", { slug: dest.slug });
}
