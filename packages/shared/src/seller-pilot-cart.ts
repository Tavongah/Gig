/**
 * Point 1C cart rule: one seller pilot source, never mixed with a shop basket.
 * Merchant lines have no sellerOfferId and keep the existing cart path.
 */

export type SellerPilotCartLine = {
  sellerOfferId?: string | null;
  quantity: number;
  unitPriceCents: number;
  sellableQuantity?: number | null;
};

export type SellerPilotCartAddResult<T extends SellerPilotCartLine> =
  | { ok: true; lines: T[] }
  | { ok: false; code: "MERCHANT_CART" | "OTHER_SELLER" | "UNAVAILABLE"; message: string };

const SEPARATE_CHECKOUT = "Finish your current order before adding this item.";

export function planSellerPilotCartAdd<T extends SellerPilotCartLine>(
  existing: T[],
  incoming: T & { sellerOfferId: string; sellableQuantity: number; quantity?: number }
): SellerPilotCartAddResult<T> {
  const sellable = incoming.sellableQuantity;
  if (!Number.isInteger(sellable) || sellable < 1) {
    return { ok: false, code: "UNAVAILABLE", message: "This item is unavailable." };
  }
  const requested = incoming.quantity && incoming.quantity > 0 ? incoming.quantity : 1;
  const qty = Math.min(requested, sellable);
  if (existing.some((line) => !line.sellerOfferId)) {
    return { ok: false, code: "MERCHANT_CART", message: SEPARATE_CHECKOUT };
  }
  if (existing.some((line) => line.sellerOfferId && line.sellerOfferId !== incoming.sellerOfferId)) {
    return { ok: false, code: "OTHER_SELLER", message: SEPARATE_CHECKOUT };
  }
  const same = existing.find((line) => line.sellerOfferId === incoming.sellerOfferId);
  if (same) {
    const nextQty = Math.min(sellable, same.quantity + qty);
    return {
      ok: true,
      lines: existing.map((line) =>
        line.sellerOfferId === incoming.sellerOfferId
          ? { ...line, quantity: nextQty, unitPriceCents: incoming.unitPriceCents, sellableQuantity: sellable }
          : line
      )
    };
  }
  return {
    ok: true,
    lines: [{ ...incoming, sellerOfferId: incoming.sellerOfferId, quantity: qty, sellableQuantity: sellable }]
  };
}

/** True when a shop line must not be added because a seller pilot line is already in the basket. */
export function merchantCartBlockedBySellerPilot(existing: Array<{ sellerOfferId?: string | null }>): boolean {
  return existing.some((line) => Boolean(line.sellerOfferId));
}
