/**
 * Customer-facing primary shop display. Pure. No side effects.
 * Does not change merchant assignment, checkout, payment, or fulfillment.
 */

export type CustomerPrimaryShopInput = {
  merchantId: string;
  merchantName: string;
  quantity: number;
  subtotalCents: number;
};

export type CustomerPrimaryShop = {
  merchantId: string;
  merchantName: string;
};

/** Greatest item quantity, then merchandise subtotal, then stable merchant id. */
export function resolveCustomerPrimaryMerchant(
  shops: CustomerPrimaryShopInput[]
): CustomerPrimaryShop | null {
  if (!shops.length) return null;
  const ranked = [...shops].sort((a, b) => {
    if (b.quantity !== a.quantity) return b.quantity - a.quantity;
    if (b.subtotalCents !== a.subtotalCents) return b.subtotalCents - a.subtotalCents;
    return a.merchantId.localeCompare(b.merchantId);
  });
  const top = ranked[0]!;
  return { merchantId: top.merchantId, merchantName: top.merchantName };
}
