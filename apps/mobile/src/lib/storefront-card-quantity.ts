import { cartLineIdentity } from "@gigflow/shared";

export type StorefrontQtyProduct = {
  productId: string | null;
  catalogProductId: string | null;
};

export type StorefrontQtyDesiredLine = {
  catalogProductId: string;
  quantity: number;
  flavorOptionId?: string | null;
};

export type StorefrontQtyCartLine = {
  productId: string;
  catalogProductId: string | null;
  quantity: number;
  flavorOptionId?: string | null;
};

export type StorefrontQtySnapshot = {
  smartBasket: boolean;
  desiredLines: StorefrontQtyDesiredLine[];
  cartLines: StorefrontQtyCartLine[];
};

export type StorefrontQtyAdjustRef = {
  store: "desired" | "commerce";
  lineKey: string;
  nextQuantity: number;
};

function matchingDesired(product: StorefrontQtyProduct, lines: StorefrontQtyDesiredLine[]) {
  if (!product.catalogProductId) return [];
  return lines.filter((line) => line.catalogProductId === product.catalogProductId);
}

function matchingCart(product: StorefrontQtyProduct, lines: StorefrontQtyCartLine[]) {
  return lines.filter(
    (line) =>
      Boolean(product.productId && line.productId === product.productId) ||
      Boolean(product.catalogProductId && line.catalogProductId === product.catalogProductId)
  );
}

export function usesDesiredBasketQuantity(product: StorefrontQtyProduct, smartBasket: boolean) {
  return Boolean(smartBasket && product.catalogProductId);
}

export function storefrontCardQuantity(product: StorefrontQtyProduct, snapshot: StorefrontQtySnapshot): number {
  const lines = usesDesiredBasketQuantity(product, snapshot.smartBasket)
    ? matchingDesired(product, snapshot.desiredLines)
    : matchingCart(product, snapshot.cartLines);
  return lines.reduce((sum, line) => sum + line.quantity, 0);
}

export function storefrontCardAdjustRef(
  product: StorefrontQtyProduct,
  snapshot: StorefrontQtySnapshot,
  delta: 1 | -1
): StorefrontQtyAdjustRef | null {
  if (usesDesiredBasketQuantity(product, snapshot.smartBasket)) {
    const match = matchingDesired(product, snapshot.desiredLines)[0];
    if (!match) return null;
    return {
      store: "desired",
      lineKey: cartLineIdentity(match.catalogProductId, match.flavorOptionId),
      nextQuantity: match.quantity + delta
    };
  }
  const match = matchingCart(product, snapshot.cartLines)[0];
  if (!match) return null;
  return {
    store: "commerce",
    lineKey: cartLineIdentity(match.productId, match.flavorOptionId),
    nextQuantity: match.quantity + delta
  };
}
