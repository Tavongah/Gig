import { useState } from "react";
import { Image, Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { DUTS } from "../lib/theme";
import { productCardMeta } from "../lib/storefront-ui";

export type ProductCardData = {
  productId: string | null;
  catalogProductId: string | null;
  name: string;
  brand?: string | null;
  sizeLabel: string | null;
  imageUrl: string | null;
  fromPriceCents: number | null;
  offerCount?: number;
  merchantOfferCount?: number;
  purchasable?: boolean;
};

type Props = {
  product: ProductCardData;
  onPress: () => void;
  onAdd?: () => void;
  pricePrefix?: string;
  width?: number;
  variant?: "grid" | "rail";
};

export function isProductCardPurchasable(product: {
  productId?: string | null;
  purchasable?: boolean;
  fromPriceCents?: number | null;
  offerCount?: number;
  merchantOfferCount?: number;
}) {
  const offerCount = product.merchantOfferCount ?? product.offerCount ?? 0;
  return Boolean(
    product.purchasable && product.productId && product.fromPriceCents != null && offerCount > 0
  );
}

export function ProductCard({ product, onPress, onAdd, pricePrefix, width, variant = "grid" }: Props) {
  const [imgFailed, setImgFailed] = useState(false);
  const purchasable = isProductCardPurchasable(product);
  const offerCount = product.merchantOfferCount ?? product.offerCount ?? 0;
  const showFrom = purchasable ? pricePrefix ?? (offerCount > 1 ? "From " : "") : "";
  const price = purchasable ? `${showFrom}$${(product.fromPriceCents! / 100).toFixed(2)}` : "Coming soon";
  const showImage = Boolean(product.imageUrl) && !imgFailed;
  const meta = productCardMeta(product.name, product.brand, product.sizeLabel);
  const rail = variant === "rail";
  const cardWidth = width ?? (rail ? 152 : undefined);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${product.name}, ${price}`}
      className="overflow-hidden rounded-xl border border-border bg-card"
      style={[
        {
          width: cardWidth,
          shadowColor: "#111827",
          shadowOffset: { width: 0, height: 1 },
          shadowOpacity: 0.05,
          shadowRadius: 6,
          elevation: 1
        }
      ]}
    >
      <View
        className="w-full items-center justify-center"
        style={{
          height: rail ? 132 : cardWidth ?? 160,
          backgroundColor: "#FFFFFF",
          padding: 10
        }}
      >
        {showImage ? (
          <Image
            source={{ uri: product.imageUrl! }}
            style={{ width: "85%", height: "85%" }}
            resizeMode="contain"
            accessibilityLabel={product.name}
            {...({ loading: "lazy" } as object)}
            onError={() => setImgFailed(true)}
          />
        ) : (
          <View className="h-full w-full items-center justify-center rounded-lg" style={{ backgroundColor: "#F3F4F6" }}>
            <Ionicons name="image-outline" size={22} color={DUTS.placeholder} />
          </View>
        )}
      </View>
      <View className="px-2.5 pb-2.5 pt-2">
        <Text className="text-[13px] font-semibold leading-4 text-ink" numberOfLines={2}>
          {product.name}
        </Text>
        {meta ? (
          <Text className="mt-0.5 text-[11px] text-muted" numberOfLines={1}>
            {meta}
          </Text>
        ) : (
          <View className="h-4" />
        )}
        <View className="mt-1.5 min-h-[28px] flex-row items-center justify-between gap-1">
          <Text
            className={`flex-1 text-[13px] ${purchasable ? "font-extrabold text-ink" : "font-medium text-muted"}`}
            numberOfLines={1}
          >
            {price}
          </Text>
          {purchasable && onAdd ? (
            <Pressable
              onPress={(e) => {
                e.stopPropagation?.();
                onAdd();
              }}
              accessibilityRole="button"
              accessibilityLabel={`Add ${product.name}`}
              className="h-8 w-8 items-center justify-center rounded-full"
              style={{ backgroundColor: DUTS.purple }}
              hitSlop={6}
            >
              <Ionicons name="add" size={18} color="#FFFFFF" />
            </Pressable>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

export function ProductCardSkeleton({ width, variant = "grid" }: { width?: number; variant?: "grid" | "rail" }) {
  const rail = variant === "rail";
  const cardWidth = width ?? (rail ? 152 : undefined);
  return (
    <View
      className="overflow-hidden rounded-xl border border-border bg-card"
      style={{ width: cardWidth }}
      accessibilityLabel="Loading product"
    >
      <View style={{ height: rail ? 132 : cardWidth ?? 160, backgroundColor: "#F3F4F6" }} />
      <View className="gap-2 px-2.5 py-2.5">
        <View className="h-3 rounded bg-surface" />
        <View className="h-3 w-2/3 rounded bg-surface" />
        <View className="h-3 w-1/3 rounded bg-surface" />
      </View>
    </View>
  );
}
