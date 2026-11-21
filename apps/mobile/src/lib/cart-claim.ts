import { cartLineIdentity } from "@gigflow/shared";

/**
 * One-shop identity for a persisted basket.
 * Seller-pilot lines stay separate from shop lines. Mixed or multi-shop
 * baskets have no single key, so they are never auto-merged.
 */
export function cartShopKey(cart: {
  lines: Array<{ merchantId?: string | null; sellerOfferId?: string | null }>;
}): string | null {
  if (!cart.lines.length) return null;
  const sellerIds = [
    ...new Set(cart.lines.map((line) => line.sellerOfferId).filter((id): id is string => Boolean(id)))
  ];
  const hasShopLine = cart.lines.some((line) => !line.sellerOfferId);
  if (sellerIds.length > 0 && hasShopLine) return null;
  if (sellerIds.length > 1) return null;
  if (sellerIds.length === 1) return `seller:${sellerIds[0]}`;
  const merchantIds = [
    ...new Set(cart.lines.map((line) => line.merchantId).filter((id): id is string => Boolean(id)))
  ];
  if (merchantIds.length !== 1) return null;
  return `shop:${merchantIds[0]}`;
}

/** True when both baskets have items that must not be combined or overwritten. */
export function cartsConflict(
  left: { lines: Array<{ merchantId?: string | null; sellerOfferId?: string | null }> },
  right: { lines: Array<{ merchantId?: string | null; sellerOfferId?: string | null }> }
): boolean {
  if (!left.lines.length || !right.lines.length) return false;
  const a = cartShopKey(left);
  const b = cartShopKey(right);
  if (!a || !b) return true;
  return a !== b;
}

export type CartClaimPlan = "guest" | "saved" | "merge" | "ask";

export function planCartClaim(input: {
  guestHasItems: boolean;
  savedHasItems: boolean;
  guestShopKey: string | null;
  savedShopKey: string | null;
}): CartClaimPlan {
  if (!input.savedHasItems) return "guest";
  if (!input.guestHasItems) return "saved";
  if (input.guestShopKey && input.guestShopKey === input.savedShopKey) return "merge";
  return "ask";
}

type MergeLine = {
  productId: string;
  flavorOptionId?: string | null;
  quantity: number;
  unitPriceCents: number;
  sellerOfferId?: string | null;
  sellableQuantity?: number | null;
};

function lineCap(line: MergeLine): number {
  if (line.sellerOfferId && line.sellableQuantity && line.sellableQuantity > 0) return line.sellableQuantity;
  return 99;
}

/** Same-shop only. Saved lines stay, guest quantities fold in. Does not add another shop. */
export function mergeSameShopCart<T extends MergeLine>(
  saved: { lines: T[]; merchantId: string | null; merchantName: string | null },
  guest: { lines: T[]; merchantId: string | null; merchantName: string | null }
): { lines: T[]; merchantId: string | null; merchantName: string | null } {
  const lines = saved.lines.map((line) => ({ ...line }));
  for (const incoming of guest.lines) {
    const key = cartLineIdentity(incoming.productId, incoming.flavorOptionId);
    const existing = lines.find((line) => cartLineIdentity(line.productId, line.flavorOptionId) === key);
    if (!existing) {
      lines.push({ ...incoming });
      continue;
    }
    existing.quantity = Math.min(Math.min(lineCap(existing), lineCap(incoming)), existing.quantity + incoming.quantity);
    existing.unitPriceCents = incoming.unitPriceCents;
    if (incoming.sellableQuantity && incoming.sellableQuantity > 0) {
      existing.sellableQuantity = incoming.sellableQuantity;
    }
  }
  return {
    lines,
    merchantId: saved.merchantId ?? guest.merchantId,
    merchantName: saved.merchantName ?? guest.merchantName
  };
}
