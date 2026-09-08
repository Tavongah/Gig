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
      return "Courier heading to pickup";
    case "WORKER_ARRIVED":
      return "Courier arrived for pickup";
    case "PACKAGE_COLLECTED":
      return "Package collected";
    case "EN_ROUTE_TO_DROPOFF":
      return "Package on the way";
    case "ARRIVED_AT_DROPOFF":
      return "Courier arrived at destination";
    case "WAITING_CUSTOMER_CONFIRMATION":
      return "Delivered — confirming";
    case "COMPLETED":
      return "Delivery complete";
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
      return "Your courier is heading to the pickup point";
    case "WORKER_ARRIVED":
      return "Share the Pickup PIN with your courier";
    case "PACKAGE_COLLECTED":
      return "Package collected — heading to the drop-off";
    case "EN_ROUTE_TO_DROPOFF":
      return "Your package is on the way";
    case "ARRIVED_AT_DROPOFF":
      return "Courier is at the destination — share the Delivery PIN with the recipient";
    case "WAITING_CUSTOMER_CONFIRMATION":
      return "Delivery confirmed — finishing up";
    case "COMPLETED":
      return "Your delivery is complete";
    default:
      return deliveryCustomerStatusLabel(status);
  }
}

export function deliveryCourierStatusLabel(status: string): string {
  switch (status) {
    case "WORKER_ASSIGNED":
      return "Go to pickup";
    case "WORKER_EN_ROUTE":
      return "Heading to pickup";
    case "WORKER_ARRIVED":
      return "Collect package";
    case "PACKAGE_COLLECTED":
      return "Start delivery";
    case "EN_ROUTE_TO_DROPOFF":
      return "Heading to drop-off";
    case "ARRIVED_AT_DROPOFF":
      return "Confirm delivery";
    case "WAITING_CUSTOMER_CONFIRMATION":
    case "COMPLETED":
      return "Delivery done";
    default:
      return deliveryCustomerStatusLabel(status);
  }
}

export type CourierDeliveryAction =
  | { kind: "start_pickup_travel"; label: string }
  | { kind: "arrive_pickup"; label: string; requiresGps: true }
  | { kind: "verify_pickup"; label: string }
  | { kind: "start_dropoff_travel"; label: string }
  | { kind: "arrive_dropoff"; label: string; requiresGps: true }
  | { kind: "verify_delivery"; label: string };

export function nextCourierDeliveryAction(status: string): CourierDeliveryAction | null {
  switch (status) {
    case "WORKER_ASSIGNED":
      return { kind: "start_pickup_travel", label: "Start trip to pickup" };
    case "WORKER_EN_ROUTE":
      return { kind: "arrive_pickup", label: "I've arrived", requiresGps: true };
    case "WORKER_ARRIVED":
      return { kind: "verify_pickup", label: "Confirm pickup" };
    case "PACKAGE_COLLECTED":
      return { kind: "start_dropoff_travel", label: "Start delivery" };
    case "EN_ROUTE_TO_DROPOFF":
      return { kind: "arrive_dropoff", label: "I've arrived", requiresGps: true };
    case "ARRIVED_AT_DROPOFF":
      return { kind: "verify_delivery", label: "Confirm delivery" };
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
