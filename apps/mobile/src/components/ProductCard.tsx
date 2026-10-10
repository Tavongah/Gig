import { useState } from "react";
import { Image, Pressable, Text, View, type DimensionValue } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { DUTS } from "../lib/theme";
import { productCardMeta } from "../lib/storefront-ui";
import { alcoholPurchaseAllowed } from "../lib/storefront-categories";
import { RAIL_CARD_WIDTH } from "../lib/motion";
import { useReducedMotion } from "../lib/use-reduced-motion";

export type ProductCardData = {
  productId: string | null;
  catalogProductId: string | null;
  name: string;
  brand?: string | null;
  sizeLabel: string | null;
  category?: string | null;
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
  width?: DimensionValue;
  variant?: "grid" | "rail";
};

export function isProductCardPurchasable(product: {
  productId?: string | null;
  purchasable?: boolean;
  fromPriceCents?: number | null;
  offerCount?: number;
  merchantOfferCount?: number;
  category?: string | null;
}) {
  if (!alcoholPurchaseAllowed(product.category)) return false;
  const offerCount = product.merchantOfferCount ?? product.offerCount ?? 0;
  return Boolean(
    product.purchasable && product.productId && product.fromPriceCents != null && offerCount > 0
  );
}

export function ProductCard({ product, onPress, onAdd, pricePrefix, width, variant = "grid" }: Props) {
  const [imgFailed, setImgFailed] = useState(false);
  const [added, setAdded] = useState(false);
  const reduce = useReducedMotion();
  const purchasable = isProductCardPurchasable(product);
  const offerCount = product.merchantOfferCount ?? product.offerCount ?? 0;
  const showFrom = purchasable ? pricePrefix ?? (offerCount > 1 ? "From " : "") : "";
  const price = purchasable ? `${showFrom}$${(product.fromPriceCents! / 100).toFixed(2)}` : "Price coming soon";
  const showImage = Boolean(product.imageUrl) && !imgFailed;
  const meta = productCardMeta(product.name, product.brand, product.sizeLabel);
  const rail = variant === "rail";
  const cardWidth: DimensionValue = width ?? (rail ? RAIL_CARD_WIDTH : "100%");

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${product.name}, ${price}`}
      className="duts-product-card overflow-hidden rounded-xl border border-border bg-card"
      style={({ pressed }) => [
        {
          width: cardWidth,
          shadowColor: "#111827",
          shadowOffset: { width: 0, height: 1 },
          shadowOpacity: 0.05,
          shadowRadius: 6,
          elevation: 1,
          transform: [{ scale: !reduce && pressed ? 0.98 : 1 }]
        }
      ]}
    >
      <View
        className="duts-product-image-frame w-full items-center justify-center"
        style={{
          aspectRatio: 1,
          backgroundColor: "#FFFFFF",
          padding: 8
        }}
      >
        {showImage ? (
          <Image
            source={{ uri: product.imageUrl! }}
            className="duts-product-card-image"
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
        <Text className="text-[13px] font-semibold leading-4 text-ink" numberOfLines={2} style={{ minHeight: 32 }}>
          {product.name}
        </Text>
        {meta ? (
          <Text className="mt-0.5 text-[11px] leading-4 text-muted" numberOfLines={1} style={{ minHeight: 16 }}>
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
                setAdded(true);
                setTimeout(() => setAdded(false), 1200);
              }}
              accessibilityRole="button"
              accessibilityLabel={added ? `Added ${product.name}` : `Add ${product.name}`}
              className="h-8 w-8 items-center justify-center rounded-full px-1"
              style={({ pressed }) => ({
                backgroundColor: DUTS.purple,
                minWidth: added ? 44 : 32,
                transform: [{ scale: !reduce && pressed ? 0.92 : added ? 1.06 : 1 }]
              })}
              hitSlop={6}
            >
              {added ? (
                <Text className="text-[10px] font-black text-white">Added ✓</Text>
              ) : (
                <Ionicons name="add" size={18} color="#FFFFFF" />
              )}
            </Pressable>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

export function ProductCardSkeleton({ width, variant = "grid" }: { width?: DimensionValue; variant?: "grid" | "rail" }) {
  const rail = variant === "rail";
  const cardWidth: DimensionValue = width ?? (rail ? RAIL_CARD_WIDTH : "100%");
  return (
    <View
      className="overflow-hidden rounded-xl border border-border bg-card"
      style={{ width: cardWidth }}
      accessibilityLabel="Loading product"
    >
      <View className="duts-skeleton-shine duts-product-image-frame w-full" style={{ aspectRatio: 1, backgroundColor: "#F3F4F6" }} />
      <View className="gap-2 px-2.5 py-2.5">
        <View className="duts-skeleton-shine h-3 rounded bg-surface" />
        <View className="duts-skeleton-shine h-3 w-2/3 rounded bg-surface" />
        <View className="duts-skeleton-shine h-3 w-1/3 rounded bg-surface" />
      </View>
    </View>
  );
}
