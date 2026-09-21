import { View } from "react-native";
import { ProductCard, ProductCardSkeleton, type ProductCardData } from "./ProductCard";
import { STOREFRONT_GAP, STOREFRONT_MAX_WIDTH, useStorefrontLayout } from "../lib/storefront-ui";

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
  onAdd
}: Omit<Props, "pricePrefix">) {
  const skeletons = [0, 1, 2, 3];
  return (
    <View className="flex-row" style={{ gap: STOREFRONT_GAP }}>
      {loading && !products.length
        ? skeletons.map((i) => <ProductCardSkeleton key={i} variant="rail" />)
        : products.map((p) => (
            <ProductCard
              key={p.catalogProductId ?? p.productId ?? p.name}
              product={p}
              variant="rail"
              onPress={() => onPress(p)}
              onAdd={onAdd ? () => onAdd(p) : undefined}
            />
          ))}
    </View>
  );
}
