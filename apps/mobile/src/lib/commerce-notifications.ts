/** Skip native browser/OS dialogs for commerce/delivery lifecycle. */

const DELIVERY_LIFECYCLE_TYPES = new Set([
  "PACKAGE_COLLECTED",
  "EN_ROUTE_TO_DROPOFF",
  "ARRIVED_AT_DROPOFF",
  "DELIVERY_COMPLETED"
]);

export function shouldSilenceWorkerNotification(payload: { type?: string; title?: string; body?: string }): boolean {
  if (payload.type && DELIVERY_LIFECYCLE_TYPES.has(payload.type)) return true;
  const text = `${payload.title ?? ""} ${payload.body ?? ""}`;
  return /customer selected you|payment confirmation|new delivery available|delivery accepted|head to the shop when you're ready/i.test(
    text
  );
}
