import { useRef } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { ProductCard, ProductCardSkeleton, type ProductCardData } from "./ProductCard";
import { STOREFRONT_MAX_WIDTH, useStorefrontLayout } from "../lib/storefront-ui";
import { RAIL_GAP, RAIL_PEEK, RAIL_SNAP } from "../lib/motion";
import { useReducedMotion } from "../lib/use-reduced-motion";
import { DUTS } from "../lib/theme";

type Props = {
  products: ProductCardData[];
  loading?: boolean;
  onPress: (product: ProductCardData) => void;
  onAdd?: (product: ProductCardData) => void;
  pricePrefix?: (product: ProductCardData) => string;
};

export function ProductGrid({ products, loading, onPress, onAdd, pricePrefix }: Props) {
  const { width, columns, gap } = useStorefrontLayout();
  const contentWidth = Math.min(width, STOREFRONT_MAX_WIDTH) - 32;
  const cardWidth = Math.max(120, (contentWidth - gap * (columns - 1)) / columns);
  const skeletons = Array.from({ length: columns * 2 }, (_, i) => i);

  return (
    <View className="flex-row flex-wrap" style={{ gap }}>
      {loading && !products.length
        ? skeletons.map((i) => <ProductCardSkeleton key={i} width={cardWidth} />)
        : products.map((p) => (
            <ProductCard
              key={p.catalogProductId ?? p.productId ?? p.name}
              product={p}
              width={cardWidth}
              pricePrefix={pricePrefix?.(p)}
              onPress={() => onPress(p)}
              onAdd={onAdd ? () => onAdd(p) : undefined}
            />
          ))}
    </View>
  );
}

export function ProductRail({
  products,
  loading,
  onPress,
  onAdd,
  pricePrefix
}: Props) {
  const reduce = useReducedMotion();
  const { isDesktopNav } = useStorefrontLayout();
  const scroller = useRef<ScrollView>(null);
  const offsetX = useRef(0);
  const showArrows = isDesktopNav && (loading || products.length > 2);

  function shift(direction: -1 | 1) {
    const next = Math.max(0, offsetX.current + direction * RAIL_SNAP * 2);
    scroller.current?.scrollTo({ x: next, animated: !reduce });
  }

  return (
    <View>
      {showArrows ? (
        <>
          <Pressable
            onPress={() => shift(-1)}
            accessibilityRole="button"
            accessibilityLabel="Previous products"
            className="absolute left-0 z-10 h-9 w-9 items-center justify-center rounded-full border border-border bg-card"
            style={{ top: 52 }}
          >
            <Ionicons name="chevron-back" size={18} color={DUTS.ink} />
          </Pressable>
          <Pressable
            onPress={() => shift(1)}
            accessibilityRole="button"
            accessibilityLabel="Next products"
            className="absolute right-0 z-10 h-9 w-9 items-center justify-center rounded-full border border-border bg-card"
            style={{ top: 52 }}
          >
            <Ionicons name="chevron-forward" size={18} color={DUTS.ink} />
          </Pressable>
        </>
      ) : null}
      <ScrollView
        ref={scroller}
        horizontal
        showsHorizontalScrollIndicator={false}
        decelerationRate="fast"
        snapToInterval={RAIL_SNAP}
        snapToAlignment="start"
        disableIntervalMomentum
        contentContainerStyle={{ gap: RAIL_GAP, paddingRight: RAIL_PEEK, paddingLeft: showArrows ? 12 : 0 }}
        onScroll={(event) => {
          offsetX.current = event.nativeEvent.contentOffset.x;
        }}
        scrollEventThrottle={16}
      >
        {loading && !products.length
          ? [0, 1, 2, 3].map((i) => <ProductCardSkeleton key={i} variant="rail" />)
          : products.map((p) => (
              <ProductCard
                key={p.catalogProductId ?? p.productId ?? p.name}
                product={p}
                variant="rail"
                pricePrefix={pricePrefix?.(p)}
                onPress={() => onPress(p)}
                onAdd={onAdd ? () => onAdd(p) : undefined}
              />
            ))}
      </ScrollView>
    </View>
  );
}
