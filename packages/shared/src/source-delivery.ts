/**
 * Courier-facing source-and-deliver presentation.
 * Merchandise without a confirmed price is never shown as zero.
 */
import { formatCustomerDeliveryEstimateLabel, type CustomerDeliveryEstimate } from "./delivery-estimate.js";

export const DELIVERY_JOB_KINDS = ["PICKUP_AND_DELIVER", "SOURCE_AND_DELIVER"] as const;
export type DeliveryJobKindName = (typeof DELIVERY_JOB_KINDS)[number];

export const MERCHANDISE_PRICE_TO_BE_CONFIRMED = "Price to be confirmed";

export function sourceCityLabel(city: string): string {
  const key = city.trim().toUpperCase();
  if (key === "HARARE") return "Harare";
  if (key === "GWERU") return "Gweru";
  return city.trim();
}

const OUT_FOR_DELIVERY = new Set([
  "PACKAGE_COLLECTED",
  "EN_ROUTE_TO_DROPOFF",
  "ARRIVED_AT_DROPOFF",
  "PICKED_UP",
  "OUT_FOR_DELIVERY"
]);

export function customerDeliveryArea(deliveryLabel: string, city: string): string {
  let area = deliveryLabel.trim().replace(/^\d+[a-z]?\s+/i, "");
  const escaped = city.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  area = area.replace(new RegExp(`[,·]\\s*${escaped}\\b.*$`, "i"), "").replace(/,\s*$/, "").trim();
  if (!area || area.toLowerCase() === city.toLowerCase()) return city;
  return area.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function formatCentsLabel(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function merchandisePricePresentation(
  lines: Array<{ quantity: number; unitPriceCents?: number | null }>,
  proposal?: { merchandiseCents: number; confirmed: boolean } | null
): {
  status: "TO_BE_CONFIRMED" | "PROPOSED" | "CONFIRMED";
  label: string;
  subtotalCents: number | null;
} {
  if (proposal && Number.isInteger(proposal.merchandiseCents) && proposal.merchandiseCents > 0) {
    return {
      status: proposal.confirmed ? "CONFIRMED" : "PROPOSED",
      label: formatCentsLabel(proposal.merchandiseCents),
      subtotalCents: proposal.confirmed ? proposal.merchandiseCents : null
    };
  }
  if (!lines.length || lines.some((line) => line.unitPriceCents == null)) {
    return {
      status: "TO_BE_CONFIRMED",
      label: MERCHANDISE_PRICE_TO_BE_CONFIRMED,
      subtotalCents: null
    };
  }
  const subtotalCents = lines.reduce((sum, line) => sum + (line.unitPriceCents ?? 0) * line.quantity, 0);
  return {
    status: "CONFIRMED",
    label: formatCentsLabel(subtotalCents),
    subtotalCents
  };
}

export function formatSourcePriceConfirmation(input: {
  merchandiseCents: number;
  deliveryFeeCents: number;
  serviceFeeCents?: number;
}): string {
  const deliveryCents = input.deliveryFeeCents + (input.serviceFeeCents ?? 0);
  const totalCents = input.merchandiseCents + deliveryCents;
  return [
    "Your order is available.",
    "",
    `Items: ${formatCentsLabel(input.merchandiseCents)}`,
    `Delivery: ${formatCentsLabel(deliveryCents)}`,
    `Total: ${formatCentsLabel(totalCents)}`,
    "",
    "Confirm to continue.",
    "Reply YES or 1 to confirm.",
    "Reply NO or 2 if this total doesn't work."
  ].join("\n");
}

export type SourcePaymentDecision = "UNCONFIRMED" | "CASH_DUE" | "PAYMENT_REQUIRED" | "AMOUNT_MISMATCH" | "PAID";

/** Unknown merchandise never becomes a collectible or authorized total. */
export function sourcePaymentDecision(input: {
  paymentMethod: string;
  confirmedMerchandiseCents: number | null;
  deliveryFeeCents: number;
  serviceFeeCents?: number;
  paidAttemptCents: number | null;
}): SourcePaymentDecision {
  if (input.confirmedMerchandiseCents == null) return "UNCONFIRMED";
  const total = input.confirmedMerchandiseCents + input.deliveryFeeCents + (input.serviceFeeCents ?? 0);
  const prepaid = input.paymentMethod === "ECOCASH" || input.paymentMethod === "ONEMONEY";
  if (!prepaid) return "CASH_DUE";
  if (input.paidAttemptCents == null) return "PAYMENT_REQUIRED";
  if (input.paidAttemptCents !== total) return "AMOUNT_MISMATCH";
  return "PAID";
}

export function presentSourceDelivery(input: {
  deliveryLabel: string;
  city: string;
  deliveryFeeCents: number;
  lines: Array<{ name: string; quantity: number; unitPriceCents?: number | null }>;
  proposal?: { merchandiseCents: number; confirmed: boolean } | null;
  confirmedMerchandiseCents?: number | null;
  paymentMethod?: string | null;
}) {
  const city = sourceCityLabel(input.city);
  const area = customerDeliveryArea(input.deliveryLabel, city);
  const confirmed =
    input.confirmedMerchandiseCents != null && input.confirmedMerchandiseCents > 0
      ? input.confirmedMerchandiseCents
      : input.proposal?.confirmed
        ? input.proposal.merchandiseCents
        : null;
  const pendingChange =
    input.proposal && !input.proposal.confirmed && confirmed != null && input.proposal.merchandiseCents !== confirmed
      ? input.proposal
      : null;
  const price = merchandisePricePresentation(
    input.lines,
    pendingChange
      ? { merchandiseCents: pendingChange.merchandiseCents, confirmed: false }
      : confirmed
        ? { merchandiseCents: confirmed, confirmed: true }
        : input.proposal
  );
  const deliverTo = area.toLowerCase() === city.toLowerCase() ? city : `${area}, ${city}`;
  const customerConfirmed = confirmed != null;
  return {
    jobKind: "SOURCE_AND_DELIVER" as const,
    label: "SOURCE & DELIVER" as const,
    products: input.lines.map((line) => ({ name: line.name, quantity: line.quantity })),
    sourceAround: city,
    deliverTo,
    merchandisePriceStatus: price.status,
    merchandisePriceLabel: customerConfirmed && !pendingChange ? formatCentsLabel(confirmed) : price.label,
    merchandiseSubtotalCents: customerConfirmed && !pendingChange ? confirmed : price.subtotalCents,
    confirmedMerchandiseCents: confirmed,
    confirmedMerchandiseLabel: customerConfirmed ? formatCentsLabel(confirmed!) : null,
    customerConfirmed,
    paymentLabel: customerConfirmed && input.paymentMethod === "CASH" ? "Cash on delivery" : null,
    deliveryFeeCents: input.deliveryFeeCents
  };
}

export function sourceRequestCustomerStatusLabel(input: {
  gigStatus?: string | null;
  estimate?: CustomerDeliveryEstimate | null;
}): string {
  const status = input.gigStatus ?? "";
  if (status === "CANCELLED") return "Cancelled";
  if (status === "COMPLETED" || status === "DELIVERED") return "Delivered";
  if (OUT_FOR_DELIVERY.has(status)) return "Out for delivery";
  const estimateLabel = formatCustomerDeliveryEstimateLabel(input.estimate);
  if (estimateLabel) return estimateLabel;
  if (input.gigStatus) return "Preparing your order";
  return "Order confirmed";
}

export type SourceBackfillRow = {
  checkoutId: string;
  createdAt: string;
  customerKey: string;
  city: string;
  lines: Array<{ catalogProductId: string; quantity: number }>;
  linkedDeliveryGigId: string | null;
  orderCount: number;
  status: string;
  paymentMethod: string;
};

export type SourceBackfillPlanItem = {
  checkoutId: string;
  action: "publish" | "already_published" | "duplicate" | "skip";
  reason: string;
  duplicateOfCheckoutId?: string;
};

export function sourceRequestSignature(input: {
  customerKey: string;
  city: string;
  lines: Array<{ catalogProductId: string; quantity: number }>;
}): string {
  const lines = input.lines
    .map((line) => `${line.catalogProductId}:${line.quantity}`)
    .sort()
    .join("|");
  return `${input.customerKey}::${input.city.trim().toLowerCase()}::${lines}`;
}

/**
 * One open sourcing job per customer, city, and exact product list.
 * A different product list is a separate request. Nothing is deleted.
 */
export function summarizeSourceDeliveryBackfill(input: {
  scanned: number;
  plan: SourceBackfillPlanItem[];
  unreadable?: number;
}) {
  const count = (action: SourceBackfillPlanItem["action"]) =>
    input.plan.filter((item) => item.action === action).length;
  const wouldCreate = count("publish");
  const alreadyHasGig = count("already_published");
  const duplicateSuspected = count("duplicate");
  return {
    scanned: input.scanned,
    eligible: wouldCreate + alreadyHasGig + duplicateSuspected,
    already_has_gig: alreadyHasGig,
    duplicate_suspected: duplicateSuspected,
    would_create: wouldCreate,
    skipped: count("skip") + (input.unreadable ?? 0),
    failed: 0
  };
}

export function planSourceDeliveryBackfill(rows: SourceBackfillRow[]): SourceBackfillPlanItem[] {
  const eligible = rows
    .filter((row) => row.status === "AWAITING_FULFILLMENT" && row.orderCount === 0)
    .slice()
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.checkoutId.localeCompare(b.checkoutId));
  const owner = new Map<string, string>();
  const plan: SourceBackfillPlanItem[] = [];
  for (const row of eligible) {
    if (row.paymentMethod !== "CASH") {
      plan.push({
        checkoutId: row.checkoutId,
        action: "skip",
        reason: "Source & Deliver V1 is cash only. The payment method was not changed."
      });
      continue;
    }
    const signature = sourceRequestSignature(row);
    const earlier = owner.get(signature);
    if (!earlier) owner.set(signature, row.checkoutId);
    if (row.linkedDeliveryGigId) {
      plan.push({
        checkoutId: row.checkoutId,
        action: "already_published",
        reason: "A delivery gig is already linked."
      });
      continue;
    }
    if (earlier && earlier !== row.checkoutId) {
      plan.push({
        checkoutId: row.checkoutId,
        action: "duplicate",
        reason: "Same customer, city, and products as an earlier open request.",
        duplicateOfCheckoutId: earlier
      });
      continue;
    }
    plan.push({
      checkoutId: row.checkoutId,
      action: "publish",
      reason: "No shop order and no delivery gig."
    });
  }
  for (const row of rows) {
    if (row.status === "AWAITING_FULFILLMENT" && row.orderCount === 0) continue;
    plan.push({
      checkoutId: row.checkoutId,
      action: "skip",
      reason: row.orderCount > 0 ? "A shop order already exists." : "The request is not awaiting fulfillment."
    });
  }
  return plan;
}
