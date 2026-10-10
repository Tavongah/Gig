import { useState } from "react";
import { Image, Pressable, Text, View, type DimensionValue } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { DUTS } from "../lib/theme";
import { productCardMeta } from "../lib/storefront-ui";
import { alcoholPurchaseAllowed, isSmartBasketEnabled } from "../lib/storefront-categories";
import { RAIL_CARD_WIDTH } from "../lib/motion";
import { useReducedMotion } from "../lib/use-reduced-motion";
import { storefrontCardAdjustRef, storefrontCardQuantity } from "../lib/storefront-card-quantity";
import { useCommerceCartStore } from "../stores/commerce-cart.store";
import { useDesiredBasketStore } from "../stores/desired-basket.store";

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

function CardQtyButton({
  label,
  icon,
  onPress,
  reduce,
  compact
}: {
  label: string;
  icon: "add" | "remove";
  onPress: () => void;
  reduce: boolean;
  compact?: boolean;
}) {
  const size = compact ? 28 : 32;
  return (
    <Pressable
      onPress={(e) => {
        e.stopPropagation?.();
        onPress();
      }}
      accessibilityRole="button"
      accessibilityLabel={label}
      className={compact ? "h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand" : "h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand px-1"}
      style={({ pressed }) => ({
        backgroundColor: DUTS.purple,
        width: size,
        height: size,
        minWidth: size,
        flexShrink: 0,
        transform: [{ scale: !reduce && pressed ? 0.92 : 1 }]
      })}
      hitSlop={compact ? 8 : 6}
    >
      <Ionicons name={icon} size={compact ? 16 : 18} color="#FFFFFF" />
    </Pressable>
  );
}

export function ProductCard({ product, onPress, onAdd, pricePrefix, width, variant = "grid" }: Props) {
  const [imgFailed, setImgFailed] = useState(false);
  const reduce = useReducedMotion();
  const purchasable = isProductCardPurchasable(product);
  const offerCount = product.merchantOfferCount ?? product.offerCount ?? 0;
  const showFrom = purchasable ? pricePrefix ?? (offerCount > 1 ? "From " : "") : "";
  const price = purchasable ? `${showFrom}$${(product.fromPriceCents! / 100).toFixed(2)}` : "Price coming soon";
  const showImage = Boolean(product.imageUrl) && !imgFailed;
  const meta = productCardMeta(product.name, product.brand, product.sizeLabel);
  const rail = variant === "rail";
  const cardWidth: DimensionValue = width ?? (rail ? RAIL_CARD_WIDTH : "100%");
  const desiredLines = useDesiredBasketStore((s) => s.lines);
  const cartLines = useCommerceCartStore((s) => s.lines);
  const setDesiredQty = useDesiredBasketStore((s) => s.setQuantity);
  const setCartQty = useCommerceCartStore((s) => s.setQuantity);
  const quantity = storefrontCardQuantity(product, {
    smartBasket: isSmartBasketEnabled(),
    desiredLines,
    cartLines
  });

  function applyAdjust(delta: 1 | -1) {
    const ref = storefrontCardAdjustRef(
      product,
      {
        smartBasket: isSmartBasketEnabled(),
        desiredLines,
        cartLines
      },
      delta
    );
    if (!ref) return;
    if (ref.store === "desired") setDesiredQty(ref.lineKey, ref.nextQuantity);
    else setCartQty(ref.lineKey, ref.nextQuantity);
  }

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
        <View className="mt-1.5 min-h-[32px] flex-row items-center justify-between gap-1">
          <Text
            className={`flex-1 text-[13px] ${purchasable ? "font-extrabold text-ink" : "font-medium text-muted"}`}
            numberOfLines={1}
          >
            {price}
          </Text>
          {purchasable && onAdd ? (
            quantity > 0 ? (
              <View className="shrink-0 flex-row items-center">
                <CardQtyButton
                  label={`Decrease ${product.name} quantity`}
                  icon="remove"
                  reduce={reduce}
                  compact
                  onPress={() => applyAdjust(-1)}
                />
                <Text
                  className="min-w-[14px] px-0.5 text-center text-[13px] font-extrabold text-ink"
                  accessibilityLabel={`${product.name} quantity ${quantity}`}
                >
                  {quantity}
                </Text>
                <CardQtyButton
                  label={`Increase ${product.name} quantity`}
                  icon="add"
                  reduce={reduce}
                  compact
                  onPress={() => applyAdjust(1)}
                />
              </View>
            ) : (
              <CardQtyButton label={`Add ${product.name}`} icon="add" reduce={reduce} onPress={() => onAdd()} />
            )
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
