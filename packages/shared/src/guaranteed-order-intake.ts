/**
 * Guaranteed Order Intake V1 — merchant-silence fallback + persistent courier search.
 * Stored on CommerceOrder.notes as pipe-separated tokens. No schema migration.
 */

export function parseGuaranteedOrderIntakeEnabled(value?: string | boolean | null): boolean {
  if (value === true) return true;
  if (value === false) return false;
  if (typeof value !== "string") return false;
  const v = value.trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes" || v === "on";
}

export const FULFILLMENT_NOTE = {
  ASSISTED: "assisted_fulfillment",
  NEEDS_ATTENTION: "needs_attention",
  PICKUP_CONFIRMED: "assisted_pickup_confirmed",
  PICKUP_PROBLEM: "assisted_pickup_problem",
  MERCHANT_REJECTED: "merchant_rejected",
  COURIER_SEARCH_WAITING: "courier_search_waiting"
} as const;

export type FulfillmentNoteToken = (typeof FULFILLMENT_NOTE)[keyof typeof FULFILLMENT_NOTE];

const KNOWN_TOKENS = new Set<string>(Object.values(FULFILLMENT_NOTE));

export function parseFulfillmentNotes(notes?: string | null): string[] {
  if (!notes?.trim()) return [];
  return notes
    .split("|")
    .map((t) => t.trim())
    .filter(Boolean);
}

export function hasFulfillmentNote(notes: string | null | undefined, token: string): boolean {
  return parseFulfillmentNotes(notes).includes(token);
}

export function addFulfillmentNote(notes: string | null | undefined, token: string): string {
  const parts = parseFulfillmentNotes(notes);
  if (!parts.includes(token)) parts.push(token);
  return parts.join("|");
}

export function isAssistedFulfillment(notes?: string | null): boolean {
  return hasFulfillmentNote(notes, FULFILLMENT_NOTE.ASSISTED);
}

export function needsFulfillmentAttention(notes?: string | null): boolean {
  return hasFulfillmentNote(notes, FULFILLMENT_NOTE.NEEDS_ATTENTION);
}

/** Extra shop confirmation required when merchant never digitally accepted. */
export function isAssistedPickupConfirmationRequired(input: {
  notes?: string | null;
  merchantAcceptedAt?: Date | string | null;
}): boolean {
  if (!isAssistedFulfillment(input.notes)) return false;
  if (input.merchantAcceptedAt) return false;
  if (hasFulfillmentNote(input.notes, FULFILLMENT_NOTE.PICKUP_PROBLEM)) return false;
  return !hasFulfillmentNote(input.notes, FULFILLMENT_NOTE.PICKUP_CONFIRMED);
}

export function fulfillmentAdminLabel(input: {
  notes?: string | null;
  status?: string | null;
  hasCourier?: boolean;
}): string | null {
  const notes = input.notes;
  if (hasFulfillmentNote(notes, FULFILLMENT_NOTE.PICKUP_PROBLEM)) return "Courier reported problem";
  if (hasFulfillmentNote(notes, FULFILLMENT_NOTE.MERCHANT_REJECTED)) return "Merchant rejected";
  if (needsFulfillmentAttention(notes)) return "Needs attention";
  if (isAssistedFulfillment(notes) && !input.hasCourier) {
    if (input.status === "READY_FOR_PICKUP" || hasFulfillmentNote(notes, FULFILLMENT_NOTE.COURIER_SEARCH_WAITING)) {
      return "Finding courier";
    }
    return "Merchant not responding";
  }
  if (hasFulfillmentNote(notes, FULFILLMENT_NOTE.COURIER_SEARCH_WAITING) && !input.hasCourier) {
    return "Finding courier";
  }
  if (isAssistedFulfillment(notes)) return "Merchant not responding";
  return null;
}

export function customerFulfillmentHint(input: {
  notes?: string | null;
  status?: string | null;
  hasCourier?: boolean;
}): string | null {
  if (hasFulfillmentNote(input.notes, FULFILLMENT_NOTE.PICKUP_PROBLEM) || needsFulfillmentAttention(input.notes)) {
    if (input.status === "MERCHANT_REJECTED" || hasFulfillmentNote(input.notes, FULFILLMENT_NOTE.MERCHANT_REJECTED)) {
      return "There's a problem fulfilling your order. DUTS is checking it now.";
    }
    if (hasFulfillmentNote(input.notes, FULFILLMENT_NOTE.PICKUP_PROBLEM)) {
      return "There's a problem fulfilling your order. DUTS is checking it now.";
    }
  }
  if (input.status === "MERCHANT_REJECTED") {
    return "There's a problem fulfilling your order. DUTS is checking it now.";
  }
  if (input.hasCourier) return null;
  if (input.status === "READY_FOR_PICKUP" || hasFulfillmentNote(input.notes, FULFILLMENT_NOTE.COURIER_SEARCH_WAITING)) {
    return "We're finding a courier. Delivery may take longer than usual.";
  }
  if (isAssistedFulfillment(input.notes)) {
    return "We're arranging your delivery. It may take a little longer than usual.";
  }
  return null;
}

export function isKnownFulfillmentToken(token: string): boolean {
  return KNOWN_TOKENS.has(token);
}
