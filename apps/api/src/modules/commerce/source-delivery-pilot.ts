/**
 * Source & Deliver stays off unless production explicitly enables it.
 * When it is on, every approved delivery-eligible courier can see and accept
 * a sourcing job. The courier allowlist is not a visibility gate.
 * Pickup-and-deliver does not use these checks.
 */

function enabledFlag(name: string): boolean {
  const value = (process.env[name] ?? "").trim().toLowerCase();
  return value === "true" || value === "1";
}

export function sourceDeliveryEnabled(): boolean {
  return enabledFlag("SOURCE_DELIVERY_ENABLED");
}

/** New unresolved requests stay unpublished unless this is also on. */
export function sourceDeliveryAutoPublishEnabled(): boolean {
  return sourceDeliveryEnabled() && enabledFlag("SOURCE_DELIVERY_AUTO_PUBLISH");
}

/** Historical checkout backfill never runs as part of enabling the pilot. */
export function sourceDeliveryBackfillEnabled(): boolean {
  return sourceDeliveryEnabled() && enabledFlag("SOURCE_DELIVERY_BACKFILL_ENABLED");
}

/**
 * True when sourcing is enabled. Callers still require an approved courier
 * with delivery eligibility and a supported transport mode. An empty or
 * populated SOURCE_DELIVERY_PILOT_COURIERS value does not grant or deny access.
 */
export function isSourceDeliveryPilotCourier(_user: { id: string; email?: string | null }): boolean {
  return sourceDeliveryEnabled();
}
