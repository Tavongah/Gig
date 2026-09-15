/**
 * DUTS Delivery status copy — never expose raw enums to users.
 * LOCAL_HELP continues to use gig-status.ts.
 */

export const DELIVERY_TRACKING_STATUSES = [
  "POSTED",
  "SEARCHING_FOR_WORKER",
  "WORKER_SELECTED",
  "WORKER_ASSIGNED",
  "WORKER_EN_ROUTE",
  "WORKER_ARRIVED",
  "PACKAGE_COLLECTED",
  "EN_ROUTE_TO_DROPOFF",
  "ARRIVED_AT_DROPOFF",
  "WAITING_CUSTOMER_CONFIRMATION",
  "COMPLETED"
] as const;

export function isDeliveryGig(gig: { fulfillmentType?: string | null }): boolean {
  return gig.fulfillmentType === "DELIVERY";
}

export function deliveryCustomerStatusLabel(status: string): string {
  switch (status) {
    case "POSTED":
    case "SEARCHING_FOR_WORKER":
      return "Finding a courier";
    case "WORKER_SELECTED":
      return "Confirm booking";
    case "WORKER_ASSIGNED":
      return "Courier assigned";
    case "WORKER_EN_ROUTE":
      return "Courier going to shop";
    case "WORKER_ARRIVED":
      return "Courier at the shop";
    case "PACKAGE_COLLECTED":
      return "Order picked up";
    case "EN_ROUTE_TO_DROPOFF":
      return "On the way";
    case "ARRIVED_AT_DROPOFF":
      return "Courier arrived";
    case "WAITING_CUSTOMER_CONFIRMATION":
      return "Delivered — confirming";
    case "COMPLETED":
      return "Delivered";
    case "CANCELLED":
      return "Cancelled";
    case "DISPUTED":
      return "Needs support";
    default:
      return "Delivery update";
  }
}

export function deliveryCustomerHeadline(status: string): string {
  switch (status) {
    case "POSTED":
    case "SEARCHING_FOR_WORKER":
      return "Finding a courier near your pickup…";
    case "WORKER_SELECTED":
      return "Secure payment to confirm your courier";
    case "WORKER_ASSIGNED":
      return "Your courier is getting ready";
    case "WORKER_EN_ROUTE":
      return "Your courier is heading to the shop";
    case "WORKER_ARRIVED":
      return "Courier is at the shop";
    case "PACKAGE_COLLECTED":
      return "Order picked up — heading to you";
    case "EN_ROUTE_TO_DROPOFF":
      return "Your order is on the way";
    case "ARRIVED_AT_DROPOFF":
      return "Courier has arrived — share the delivery code if asked";
    case "WAITING_CUSTOMER_CONFIRMATION":
      return "Delivery confirmed — finishing up";
    case "COMPLETED":
      return "Your order was delivered";
    default:
      return deliveryCustomerStatusLabel(status);
  }
}

export function deliveryCourierStatusLabel(status: string): string {
  switch (status) {
    case "WORKER_ASSIGNED":
    case "WORKER_EN_ROUTE":
      return "Directions to shop";
    case "WORKER_ARRIVED":
      return "At the shop";
    case "PACKAGE_COLLECTED":
    case "EN_ROUTE_TO_DROPOFF":
      return "Directions to customer";
    case "ARRIVED_AT_DROPOFF":
      return "Complete delivery";
    case "WAITING_CUSTOMER_CONFIRMATION":
    case "COMPLETED":
      return "Delivery complete";
    default:
      return deliveryCustomerStatusLabel(status);
  }
}

/**
 * Visible courier actions for marketplace delivery.
 * start-travel transitions are applied automatically when needed (not separate buttons).
 */
export type CourierDeliveryAction =
  | { kind: "arrive_pickup"; label: string; requiresGps: true; ensurePickupTravel?: boolean }
  | { kind: "verify_pickup"; label: string }
  | { kind: "arrive_dropoff"; label: string; requiresGps: true; ensureDropoffTravel?: boolean }
  | { kind: "verify_delivery"; label: string };

export function nextCourierDeliveryAction(status: string): CourierDeliveryAction | null {
  switch (status) {
    case "WORKER_ASSIGNED":
      return { kind: "arrive_pickup", label: "Arrived", requiresGps: true, ensurePickupTravel: true };
    case "WORKER_EN_ROUTE":
      return { kind: "arrive_pickup", label: "Arrived", requiresGps: true };
    case "WORKER_ARRIVED":
      return { kind: "verify_pickup", label: "Picked up" };
    case "PACKAGE_COLLECTED":
      return {
        kind: "arrive_dropoff",
        label: "Arrived",
        requiresGps: true,
        ensureDropoffTravel: true
      };
    case "EN_ROUTE_TO_DROPOFF":
      return { kind: "arrive_dropoff", label: "Arrived", requiresGps: true };
    case "ARRIVED_AT_DROPOFF":
      return { kind: "verify_delivery", label: "Complete delivery" };
    default:
      return null;
  }
}

export function canCancelDelivery(status: string): boolean {
  return (
    status === "POSTED" ||
    status === "SEARCHING_FOR_WORKER" ||
    status === "WORKER_SELECTED" ||
    status === "WORKER_ASSIGNED" ||
    status === "WORKER_EN_ROUTE" ||
    status === "WORKER_ARRIVED"
  );
}

export function isPostPickupDelivery(status: string): boolean {
  return (
    status === "PACKAGE_COLLECTED" ||
    status === "EN_ROUTE_TO_DROPOFF" ||
    status === "ARRIVED_AT_DROPOFF"
  );
}

export function isPickupPhase(status: string): boolean {
  return status === "WORKER_ASSIGNED" || status === "WORKER_EN_ROUTE" || status === "WORKER_ARRIVED";
}

export function isDropoffPhase(status: string): boolean {
  return (
    status === "PACKAGE_COLLECTED" ||
    status === "EN_ROUTE_TO_DROPOFF" ||
    status === "ARRIVED_AT_DROPOFF"
  );
}

export function isDeliveryCompleteUi(status: string): boolean {
  return status === "WAITING_CUSTOMER_CONFIRMATION" || status === "COMPLETED";
}

export function transportModeLabel(mode: string | null | undefined): string {
  switch (mode) {
    case "WALKING":
      return "Walking";
    case "BICYCLE":
      return "Bicycle";
    case "PUBLIC_TRANSPORT":
      return "Public Transport / Kombi";
    default:
      return "Courier";
  }
}

export function transportModeEmoji(mode: string | null | undefined): string {
  switch (mode) {
    case "WALKING":
      return "🚶";
    case "BICYCLE":
      return "🚲";
    case "PUBLIC_TRANSPORT":
      return "🚌";
    default:
      return "📦";
  }
}

/** Friendly labels for StatusBadge when fulfillment is DELIVERY. */
export function deliveryAwareStatusLabel(status: string, fulfillmentType?: string | null): string {
  if (fulfillmentType === "DELIVERY") return deliveryCustomerStatusLabel(status);
  return status;
}
