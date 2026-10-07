/**
 * Unlisted-item request V1 — catalog-missing items.
 * Flags default OFF. Courier-submitted prices are never customer consent.
 */

export function parseUnlistedItemRequestEnabled(value?: string | boolean | null) {
  if (value === true) return true;
  if (typeof value !== "string") return false;
  const v = value.trim().toLowerCase();
  if (!v) return false;
  return v === "true" || v === "1" || v === "yes" || v === "on";
}

/** COD is unsafe for V1 — courier has no DUTS purchase float. */
export function parseUnlistedItemCodEnabled(value?: string | boolean | null) {
  return parseUnlistedItemRequestEnabled(value);
}

export function unlistedItemMaxPriceCents(raw?: string | null) {
  const n = Number(raw);
  if (Number.isFinite(n) && n >= 100) return Math.floor(n);
  return 5_000;
}

export function unlistedItemMinPriceCents(raw?: string | null) {
  const n = Number(raw);
  if (Number.isFinite(n) && n >= 1) return Math.floor(n);
  return 1;
}

export function unlistedItemSearchTtlSeconds(raw?: string | null) {
  const n = Number(raw);
  if (Number.isFinite(n) && n >= 60) return Math.floor(n);
  return 1_800;
}

export type ParsedUnlistedRequest = {
  originalRequestText: string;
  itemName: string;
  quantity: number;
  optionalMaxBudgetCents: number | null;
};

function dollarsToCents(raw: string): number | null {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100);
}

/** Parse item / qty / optional max budget. Never treats extracted cents as a selling price. */
export function parseUnlistedRequestText(raw: string): ParsedUnlistedRequest {
  const originalRequestText = raw.trim().slice(0, 500);
  let text = originalRequestText;
  let optionalMaxBudgetCents: number | null = null;

  const budgetRe =
    /\b(?:under|below|max(?:imum)?|at most|no more than|up to)\s*\$?\s*(\d+(?:\.\d{1,2})?)\b|\b\$\s*(\d+(?:\.\d{1,2})?)\s*(?:max|maximum|or less)\b/i;
  const budget = text.match(budgetRe);
  if (budget) {
    optionalMaxBudgetCents = dollarsToCents(budget[1] || budget[2] || "");
    text = text.replace(budgetRe, " ").replace(/\s+/g, " ").trim();
  }

  let quantity = 1;
  const sizedQty = text.match(/\b(\d+)\s*(?:x|×)\s+/i);
  const unitQty = text.match(/\b(\d+)\s+(?:bottles?|packs?|pieces?|pcs|units|bars|tubes)\s+(?:of\s+)?/i);
  const leadingCount = text.match(/^(\d+)\s+(?!kg|g|l|ml|lb|oz|litres?|liters?)/i);
  if (sizedQty) {
    quantity = Math.max(1, Math.min(20, Number(sizedQty[1])));
    text = text.replace(sizedQty[0], " ");
  } else if (unitQty) {
    quantity = Math.max(1, Math.min(20, Number(unitQty[1])));
    text = text.replace(unitQty[0], " ");
  } else if (leadingCount) {
    quantity = Math.max(1, Math.min(20, Number(leadingCount[1])));
    text = text.replace(leadingCount[0], " ");
  }

  const itemName = text
    .replace(/^(please\s+)?(find(\s+me)?|i\s+need|i\s+want|get\s+me|look\s+for)\s+/i, "")
    .replace(/\ba\s+/i, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);

  return {
    originalRequestText,
    itemName: itemName || originalRequestText.slice(0, 180),
    quantity,
    optionalMaxBudgetCents
  };
}

export function validateUnlistedFoundPriceCents(
  cents: number,
  bounds: { minCents: number; maxCents: number }
): { ok: true } | { ok: false; reason: string } {
  if (!Number.isInteger(cents) || cents < bounds.minCents) {
    return { ok: false, reason: "Price must be a positive amount." };
  }
  if (cents > bounds.maxCents) {
    return { ok: false, reason: "That price is above the allowed maximum for this pilot." };
  }
  return { ok: true };
}

export const UNLISTED_PRE_PURCHASE_RELEASE_STATUSES = [
  "SEARCHING",
  "FOUND_AWAITING_CUSTOMER",
  "CUSTOMER_APPROVED",
  "PAYMENT_PENDING"
] as const;

export const UNLISTED_POST_PURCHASE_STATUSES = ["PURCHASED", "DELIVERING", "COMPLETED"] as const;
