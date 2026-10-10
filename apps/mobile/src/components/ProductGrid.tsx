import { useRef } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { ProductCard, ProductCardSkeleton, type ProductCardData } from "./ProductCard";
import { useStorefrontLayout } from "../lib/storefront-ui";
import { RAIL_PEEK } from "../lib/motion";
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
  const { columns, gap } = useStorefrontLayout();
  const skeletons = Array.from({ length: columns * 2 }, (_, i) => i);
  const cellWidth = `${100 / columns}%` as `${number}%`;
  const items = loading && !products.length ? skeletons : products;

  return (
    <View className="flex-row flex-wrap" style={{ marginHorizontal: -gap / 2 }}>
      {items.map((item, index) => (
        <View
          key={typeof item === "number" ? `sk-${item}` : item.catalogProductId ?? item.productId ?? `${item.name}-${index}`}
          style={
            {
              flexBasis: cellWidth,
              maxWidth: cellWidth,
              width: cellWidth,
              flexGrow: 0,
              flexShrink: 0,
              paddingHorizontal: gap / 2,
              marginBottom: gap,
              boxSizing: "border-box"
            } as object
          }
        >
          {typeof item === "number" ? (
            <ProductCardSkeleton />
          ) : (
            <ProductCard
              product={item}
              pricePrefix={pricePrefix?.(item)}
              onPress={() => onPress(item)}
              onAdd={onAdd ? () => onAdd(item) : undefined}
            />
          )}
        </View>
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
  const { isDesktopNav, gap, railCardWidth, railPeek, railSnap } = useStorefrontLayout();
  const scroller = useRef<ScrollView>(null);
  const offsetX = useRef(0);
  const showArrows = isDesktopNav && (loading || products.length > 2);
  const peek = Math.max(Math.round(RAIL_PEEK * 0.7), railPeek);

  function shift(direction: -1 | 1) {
    const next = Math.max(0, offsetX.current + direction * railSnap * 2);
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
            style={{ top: Math.max(36, Math.round(railCardWidth / 2 - 18)) }}
          >
            <Ionicons name="chevron-back" size={18} color={DUTS.ink} />
          </Pressable>
          <Pressable
            onPress={() => shift(1)}
            accessibilityRole="button"
            accessibilityLabel="Next products"
            className="absolute right-0 z-10 h-9 w-9 items-center justify-center rounded-full border border-border bg-card"
            style={{ top: Math.max(36, Math.round(railCardWidth / 2 - 18)) }}
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
        snapToInterval={railSnap}
        snapToAlignment="start"
        disableIntervalMomentum
        contentContainerStyle={{ gap, paddingRight: peek, paddingLeft: showArrows ? 12 : 0 }}
        onScroll={(event) => {
          offsetX.current = event.nativeEvent.contentOffset.x;
        }}
        scrollEventThrottle={16}
      >
        {loading && !products.length
          ? [0, 1, 2, 3].map((i) => <ProductCardSkeleton key={i} variant="rail" width={railCardWidth} />)
          : products.map((p) => (
              <ProductCard
                key={p.catalogProductId ?? p.productId ?? p.name}
                product={p}
                variant="rail"
                width={railCardWidth}
                pricePrefix={pricePrefix?.(p)}
                onPress={() => onPress(p)}
                onAdd={onAdd ? () => onAdd(p) : undefined}
              />
            ))}
      </ScrollView>
    </View>
  );
}
