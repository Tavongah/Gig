import { useEffect, useRef } from "react";
import { AppState, Pressable, ScrollView, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { ProductCard, ProductCardSkeleton, type ProductCardData } from "./ProductCard";
import { useStorefrontLayout } from "../lib/storefront-ui";
import {
  RAIL_AMBIENT_END_PAUSE_MS,
  RAIL_AMBIENT_IDLE_MS,
  RAIL_AMBIENT_PX_PER_SEC,
  RAIL_PEEK
} from "../lib/motion";
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
  const maxX = useRef(0);
  const viewportW = useRef(0);
  const contentW = useRef(0);
  const interacting = useRef(false);
  const direction = useRef<1 | -1>(1);
  const holdUntil = useRef(0);
  const lastTs = useRef(0);
  const resumeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showArrows = isDesktopNav && (loading || products.length > 2);
  const peek = Math.max(Math.round(RAIL_PEEK * 0.7), railPeek);

  function pauseAmbient() {
    interacting.current = true;
    lastTs.current = 0;
    if (resumeTimer.current) clearTimeout(resumeTimer.current);
    resumeTimer.current = setTimeout(() => {
      interacting.current = false;
      lastTs.current = 0;
    }, RAIL_AMBIENT_IDLE_MS);
  }

  function shift(directionStep: -1 | 1) {
    pauseAmbient();
    const next = Math.max(0, offsetX.current + directionStep * railSnap * 2);
    scroller.current?.scrollTo({ x: next, animated: !reduce });
  }

  useEffect(() => {
    if (reduce || products.length < 3) return;
    let alive = true;
    const pageHidden = () =>
      (typeof document !== "undefined" && document.hidden) || AppState.currentState !== "active";

    const loop = (ts: number) => {
      if (!alive) return;
      raf = requestAnimationFrame(loop);
      if (interacting.current || pageHidden() || maxX.current <= 8) {
        lastTs.current = 0;
        return;
      }
      if (ts < holdUntil.current) {
        lastTs.current = 0;
        return;
      }
      if (!lastTs.current) {
        lastTs.current = ts;
        return;
      }
      const dt = Math.min(48, ts - lastTs.current);
      lastTs.current = ts;
      let next = offsetX.current + direction.current * ((RAIL_AMBIENT_PX_PER_SEC * dt) / 1000);
      if (next >= maxX.current) {
        next = maxX.current;
        direction.current = -1;
        holdUntil.current = ts + RAIL_AMBIENT_END_PAUSE_MS;
      } else if (next <= 0) {
        next = 0;
        direction.current = 1;
        holdUntil.current = ts + RAIL_AMBIENT_END_PAUSE_MS;
      }
      offsetX.current = next;
      scroller.current?.scrollTo({ x: next, animated: false });
    };

    let raf = requestAnimationFrame(loop);
    const onVis = () => {
      if (pageHidden()) lastTs.current = 0;
    };
    const appSub = AppState.addEventListener("change", onVis);
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVis);
    }
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      appSub.remove();
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVis);
      }
      if (resumeTimer.current) clearTimeout(resumeTimer.current);
    };
  }, [reduce, products.length]);

  return (
    <View>
      {showArrows ? (
        <>
          <Pressable
            onPressIn={pauseAmbient}
            onPress={() => shift(-1)}
            accessibilityRole="button"
            accessibilityLabel="Previous products"
            className="absolute left-0 z-10 h-9 w-9 items-center justify-center rounded-full border border-border bg-card"
            style={{ top: Math.max(36, Math.round(railCardWidth / 2 - 18)) }}
          >
            <Ionicons name="chevron-back" size={18} color={DUTS.ink} />
          </Pressable>
          <Pressable
            onPressIn={pauseAmbient}
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
        onLayout={(event) => {
          viewportW.current = event.nativeEvent.layout.width;
          maxX.current = Math.max(0, contentW.current - viewportW.current);
        }}
        onContentSizeChange={(w) => {
          contentW.current = w;
          maxX.current = Math.max(0, w - viewportW.current);
        }}
        onScrollBeginDrag={pauseAmbient}
        onTouchStart={pauseAmbient}
        {...({ onPointerDown: pauseAmbient } as object)}
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
                onPress={() => {
                  pauseAmbient();
                  onPress(p);
                }}
                onAdd={
                  onAdd
                    ? () => {
                        pauseAmbient();
                        onAdd(p);
                      }
                    : undefined
                }
              />
            ))}
      </ScrollView>
    </View>
  );
}
