/**
 * Source & Deliver stays off unless production explicitly enables a pilot.
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

export function isSourceDeliveryPilotCourier(user: { id: string; email?: string | null }): boolean {
  if (!sourceDeliveryEnabled()) return false;
  const allowed = (process.env.SOURCE_DELIVERY_PILOT_COURIERS ?? "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  if (allowed.length === 0) return false;
  const id = user.id.toLowerCase();
  const email = (user.email ?? "").trim().toLowerCase();
  return allowed.includes(id) || (email.length > 0 && allowed.includes(email));
}
