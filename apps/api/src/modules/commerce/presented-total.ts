/**
 * Binds checkout confirmation to the exact delivery fee and total already shown.
 * The server quote stays authoritative. A presented snapshot never sets the fee;
 * it only authorizes a fresh quote that still matches those cents.
 */

export type PresentedCheckoutTotal = {
  deliveryFeeCents: number;
  totalCents: number;
};

export type MerchandisePriceChange = {
  name: string;
  oldCents: number;
  newCents: number;
};

export type CheckoutTotalCents = {
  subtotalCents: number;
  deliveryFeeCents: number;
  serviceFeeCents: number;
  totalCents: number;
};

export type PresentedCheckoutDecision =
  | { confirm: false; totals: CheckoutTotalCents }
  | {
      confirm: true;
      code: "PRICE_CHANGED";
      message: string;
      changeDetail: string;
      totals: CheckoutTotalCents;
    };

function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/**
 * No presented snapshot: proceed, unless merchandise prices changed.
 * A snapshot authorizes only that delivery fee and that total.
 * Merchandise and delivery changes are one decision, not two.
 */
export function evaluatePresentedCheckout(input: {
  presented?: PresentedCheckoutTotal | null;
  fresh: CheckoutTotalCents;
  merchandiseChanges?: MerchandisePriceChange[];
}): PresentedCheckoutDecision {
  const merchandiseChanges = input.merchandiseChanges ?? [];
  const presented = input.presented ?? null;
  const deliveryChanged =
    presented != null && presented.deliveryFeeCents !== input.fresh.deliveryFeeCents;
  const totalChanged = presented != null && presented.totalCents !== input.fresh.totalCents;

  if (merchandiseChanges.length === 0 && !deliveryChanged && !totalChanged) {
    return { confirm: false, totals: input.fresh };
  }

  const parts: string[] = [];
  for (const change of merchandiseChanges) {
    parts.push(`${change.name}: ${money(change.oldCents)} → ${money(change.newCents)}`);
  }
  if (deliveryChanged && presented) {
    parts.push(`Delivery: ${money(presented.deliveryFeeCents)} → ${money(input.fresh.deliveryFeeCents)}`);
  } else if (totalChanged && presented && merchandiseChanges.length === 0) {
    parts.push(`Total: ${money(presented.totalCents)} → ${money(input.fresh.totalCents)}`);
  }
  const changeDetail = parts.join("; ");
  const message = changeDetail
    ? `One price changed since your quote. ${changeDetail}`
    : "One price changed since your quote.";
  return {
    confirm: true,
    code: "PRICE_CHANGED",
    message,
    changeDetail,
    totals: input.fresh
  };
}

/**
 * Stored totals (approved quotes, multi-shop children) are kept as-is.
 * A live delivery quote cannot replace them. Merchandise changes still require
 * the existing price confirmation and do not rewrite the stored fee.
 */
export function selectConfirmedTotals(input: {
  storedTotals?: CheckoutTotalCents | null;
  presented?: PresentedCheckoutTotal | null;
  fresh?: CheckoutTotalCents | null;
  merchandiseChanges?: MerchandisePriceChange[];
}): PresentedCheckoutDecision {
  if (input.storedTotals) {
    return evaluatePresentedCheckout({
      presented: null,
      fresh: input.storedTotals,
      merchandiseChanges: input.merchandiseChanges
    });
  }
  if (!input.fresh) {
    throw new Error("A fresh quote is required when no stored total exists.");
  }
  return evaluatePresentedCheckout({
    presented: input.presented,
    fresh: input.fresh,
    merchandiseChanges: input.merchandiseChanges
  });
}

export function priceChangeErrorFields(input: {
  changeDetail: string;
  fresh: CheckoutTotalCents;
  presented?: PresentedCheckoutTotal | null;
  lines?: unknown;
}): Record<string, string> {
  return {
    changes: input.changeDetail,
    ...(input.lines ? { lines: JSON.stringify(input.lines) } : {}),
    deliveryFeeCents: String(input.fresh.deliveryFeeCents),
    totalCents: String(input.fresh.totalCents),
    subtotalCents: String(input.fresh.subtotalCents),
    serviceFeeCents: String(input.fresh.serviceFeeCents),
    previousDeliveryFeeCents: input.presented ? String(input.presented.deliveryFeeCents) : "",
    previousTotalCents: input.presented ? String(input.presented.totalCents) : ""
  };
}
