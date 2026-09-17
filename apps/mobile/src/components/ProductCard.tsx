import { useState } from "react";
import { Image, Pressable, Text, View } from "react-native";
import { DUTS } from "../lib/theme";

export type ProductCardData = {
  productId: string;
  catalogProductId: string | null;
  name: string;
  sizeLabel: string | null;
  imageUrl: string | null;
  fromPriceCents: number;
  offerCount?: number;
};

type Props = {
  product: ProductCardData;
  onPress: () => void;
  onAdd?: () => void;
  pricePrefix?: string;
};

export function ProductCard({ product, onPress, onAdd, pricePrefix }: Props) {
  const [imgFailed, setImgFailed] = useState(false);
  const showFrom = pricePrefix ?? (product.offerCount && product.offerCount > 1 ? "From " : "");
  const price = `${showFrom}$${(product.fromPriceCents / 100).toFixed(2)}`;
  const showImage = Boolean(product.imageUrl) && !imgFailed;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${product.name}, ${price}`}
      className="mb-3 w-[48%] overflow-hidden rounded-2xl border border-border bg-card"
    >
      <View className="aspect-square w-full items-center justify-center bg-surface">
        {showImage ? (
          <Image
            source={{ uri: product.imageUrl! }}
            className="h-full w-full"
            resizeMode="contain"
            accessibilityLabel={product.name}
            {...({ loading: "lazy" } as object)}
            onError={() => setImgFailed(true)}
          />
        ) : (
          <View className="h-full w-full items-center justify-center px-3" style={{ backgroundColor: "#EEF1F6" }}>
            <Text className="text-center text-xs font-semibold text-muted">{product.name}</Text>
          </View>
        )}
      </View>
      <View className="gap-1 p-3">
        <Text className="text-sm font-bold text-ink" numberOfLines={2}>
          {product.name}
        </Text>
        {product.sizeLabel ? (
          <Text className="text-xs text-muted" numberOfLines={1}>
            {product.sizeLabel}
          </Text>
        ) : null}
        <View className="mt-1 flex-row items-center justify-between gap-2">
          <Text className="flex-1 text-sm font-extrabold text-ink" numberOfLines={1}>
            {price}
          </Text>
          {onAdd ? (
            <Pressable
              onPress={onAdd}
              accessibilityRole="button"
              accessibilityLabel={`Add ${product.name}`}
              className="h-9 w-9 items-center justify-center rounded-full"
              style={{ backgroundColor: DUTS.purple }}
            >
              <Text className="text-lg font-bold text-white">+</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}
