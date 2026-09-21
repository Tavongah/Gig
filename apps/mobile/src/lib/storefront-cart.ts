import { api } from "./api";
import { logDutsFlow } from "./flow-log";
import { isProductCardPurchasable, type ProductCardData } from "../components/ProductCard";
import type { CommerceBrowseGeo } from "./api";
import { useCommerceCartStore } from "../stores/commerce-cart.store";

export function addStorefrontProduct(input: {
  product: ProductCardData;
  geo?: CommerceBrowseGeo | null;
  token?: string;
  isGuest?: boolean;
}) {
  const { product, geo, token, isGuest } = input;
  if (!isProductCardPurchasable(product) || !product.productId) return;
  if (isGuest) logDutsFlow("GUEST_ADD_TO_CART");
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
      useCommerceCartStore.getState().addOffer({
        productId: offer.productId,
        catalogProductId: detail.product.catalogProductId,
        name: detail.product.name,
        imageUrl: detail.product.imageUrl,
        sizeLabel: detail.product.sizeLabel,
        unitPriceCents: offer.priceCents,
        merchantId: offer.merchantId,
        merchantName: offer.merchantName
      });
    });
}
