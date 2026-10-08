import { Alert } from "react-native";
import { api } from "./api";
import { logDutsFlow } from "./flow-log";
import { isProductCardPurchasable, type ProductCardData } from "../components/ProductCard";
import { alcoholPurchaseAllowed, isSmartBasketEnabled } from "./storefront-categories";
import type { CommerceBrowseGeo } from "./api";
import { useCommerceCartStore, type CartLine } from "../stores/commerce-cart.store";

export function toCheckoutLine(line: CartLine) {
  return {
    productId: line.productId,
    quantity: line.quantity,
    flavorOptionId: line.flavorOptionId ?? null,
    flavorPreference: line.flavorPreference ?? null
  };
}
import { useDesiredBasketStore } from "../stores/desired-basket.store";

let publicConfigCache:
  | { at: number; multiShopCheckoutEnabled: boolean; maxShopsPerCheckout: number }
  | null = null;

async function commercePublicConfig() {
  if (publicConfigCache && Date.now() - publicConfigCache.at < 60_000) return publicConfigCache;
  try {
    const cfg = await api.commercePublicConfig();
    publicConfigCache = {
      at: Date.now(),
      multiShopCheckoutEnabled: Boolean(cfg.multiShopCheckoutEnabled),
      maxShopsPerCheckout: cfg.maxShopsPerCheckout || 3
    };
    return publicConfigCache;
  } catch {
    return {
      at: Date.now(),
      multiShopCheckoutEnabled: false,
      maxShopsPerCheckout: 3
    };
  }
}

export async function tryAddOfferToCart(
  line: Omit<CartLine, "quantity"> & { quantity?: number },
  geo?: CommerceBrowseGeo | null,
  token?: string
): Promise<boolean> {
  const cfg = await commercePublicConfig();
  const cart = useCommerceCartStore.getState();
  const currentIds = [...new Set(cart.lines.map((l) => l.merchantId))];
  const isNewShop = Boolean(cart.merchantId && cart.merchantId !== line.merchantId && !currentIds.includes(line.merchantId));

  if (!cfg.multiShopCheckoutEnabled || !isNewShop) {
    return cart.addOffer(line);
  }

  const nextCount = currentIds.length + 1;
  if (nextCount > cfg.maxShopsPerCheckout) {
    Alert.alert(
      "Your delivery already includes 3 shops.",
      "Remove a shop before adding this item.",
      [
        { text: "View cart", onPress: () => undefined },
        { text: "OK", style: "cancel" }
      ]
    );
    return false;
  }

  const lat = geo && "lat" in geo ? Number(geo.lat) : undefined;
  const lng = geo && "lng" in geo ? Number(geo.lng) : undefined;
  if (lat == null || lng == null || Number.isNaN(lat) || Number.isNaN(lng)) {
    Alert.alert(
      "Choose a delivery location",
      "Set where we should deliver so we can check that this shop can join your order."
    );
    return false;
  }

  try {
    await api.commerceCartCanJoin(
      {
        lat,
        lng,
        currentMerchantIds: currentIds,
        newMerchantId: line.merchantId
      },
      token
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "This shop can't join your delivery.";
    Alert.alert("Can't add this shop", message, [{ text: "OK" }]);
    return false;
  }

  return cart.addOffer(line, { allowMulti: true });
}

export function addStorefrontProduct(input: {
  product: ProductCardData;
  geo?: CommerceBrowseGeo | null;
  token?: string;
  isGuest?: boolean;
}) {
  const { product, geo, token, isGuest } = input;
  if (!isProductCardPurchasable(product)) return;
  if (!alcoholPurchaseAllowed(product.category)) return;
  if (isGuest) logDutsFlow("GUEST_ADD_TO_CART");

  if (isSmartBasketEnabled() && product.catalogProductId) {
    useDesiredBasketStore.getState().addItem({
      catalogProductId: product.catalogProductId,
      name: product.name,
      imageUrl: product.imageUrl,
      sizeLabel: product.sizeLabel,
      fromPriceCents: product.fromPriceCents
    });
    return;
  }

  if (!product.productId) return;
  void api
    .commerceProductDetail(
      {
        ...(geo ?? {}),
        catalogProductId: product.catalogProductId ?? undefined,
        productId: product.productId
      },
      token
    )
    .then((detail) => {
      const offer = detail.offers[0];
      if (!offer || !detail.purchasable) return;
      if (!alcoholPurchaseAllowed(detail.product.category)) return;
      const flavors = detail.product.flavors ?? [];
      return tryAddOfferToCart(
        {
          productId: offer.productId,
          catalogProductId: detail.product.catalogProductId,
          name: detail.product.name,
          imageUrl: detail.product.imageUrl,
          sizeLabel: detail.product.sizeLabel,
          unitPriceCents: offer.priceCents,
          merchantId: offer.merchantId,
          merchantName: offer.merchantName,
          flavorOptionId: null,
          flavorName: null,
          flavorPreference: flavors.length ? "ANY" : null
        },
        geo,
        token
      );
    });
}
