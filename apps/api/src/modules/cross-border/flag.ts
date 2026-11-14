function flagOn(name: string): boolean {
  return String(process.env[name] ?? "").trim().toLowerCase() === "true";
}

/** Customer intake, quotations, and tracking. */
export function crossBorderEnabled(): boolean {
  return flagOn("CROSS_BORDER_ENABLED");
}

/**
 * Staff may generate and copy a payment link.
 * Intake must also be on. This flag does not start a provider payment.
 */
export function crossBorderPaymentLinksEnabled(): boolean {
  return crossBorderEnabled() && flagOn("CROSS_BORDER_PAYMENT_LINKS_ENABLED");
}

/**
 * Customer payment initiation. Requires intake and payment links.
 * Reconciliation of an existing attempt does not read this flag.
 */
export function crossBorderPaymentsEnabled(): boolean {
  return crossBorderPaymentLinksEnabled() && flagOn("CROSS_BORDER_PAYMENTS_ENABLED");
}

/**
 * Staff may record a payment they already verified in the ZB merchant portal.
 * This does not call ZB and does not require customer payment initiation.
 */
export function crossBorderManualPaymentsEnabled(): boolean {
  return crossBorderEnabled() && flagOn("CROSS_BORDER_MANUAL_PAYMENTS_ENABLED");
}
