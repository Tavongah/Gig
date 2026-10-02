import { haversineMeters } from "./location.js";

/**
 * Courier arrival proximity — GPS is assistance, not an exact pin.
 * Pilot: 150m strict tolerance, 400m hard far-away ceiling.
 * Do not scatter these values; import from here.
 */
export const COURIER_ARRIVAL_TOLERANCE_METERS = 150;
export const COURIER_ARRIVAL_SAFETY_MAX_METERS = 400;
/** Treat reported GPS accuracy at or above this as too coarse for a hard fail. */
export const COURIER_ARRIVAL_POOR_ACCURACY_METERS = 80;

export type CourierArrivalReason =
  | "WITHIN_TOLERANCE"
  | "ACCURACY_FALLBACK"
  | "MANUAL_NEARBY"
  | "UNCERTAIN"
  | "TOO_FAR"
  | "NO_TARGET";

export type CourierArrivalDecision = {
  ok: boolean;
  reason: CourierArrivalReason;
  distanceMeters: number | null;
};

export function evaluateCourierArrival(input: {
  courierLat: number;
  courierLng: number;
  targetLat: number | null | undefined;
  targetLng: number | null | undefined;
  accuracyMeters?: number | null;
  confirmNearby?: boolean;
}): CourierArrivalDecision {
  const targetLat = Number(input.targetLat);
  const targetLng = Number(input.targetLng);
  if (!Number.isFinite(targetLat) || !Number.isFinite(targetLng)) {
    return { ok: false, reason: "NO_TARGET", distanceMeters: null };
  }

  const courierLat = Number(input.courierLat);
  const courierLng = Number(input.courierLng);
  if (!Number.isFinite(courierLat) || !Number.isFinite(courierLng)) {
    return { ok: false, reason: "NO_TARGET", distanceMeters: null };
  }

  const distanceMeters = haversineMeters(courierLat, courierLng, targetLat, targetLng);
  if (distanceMeters <= COURIER_ARRIVAL_TOLERANCE_METERS) {
    return { ok: true, reason: "WITHIN_TOLERANCE", distanceMeters };
  }

  const withinSafety = distanceMeters <= COURIER_ARRIVAL_SAFETY_MAX_METERS;
  const accuracy = Number(input.accuracyMeters);
  const hasAccuracy = Number.isFinite(accuracy) && accuracy > 0;
  const accuracyPoor = !hasAccuracy || accuracy >= COURIER_ARRIVAL_POOR_ACCURACY_METERS;

  if (
    withinSafety &&
    hasAccuracy &&
    distanceMeters - accuracy <= COURIER_ARRIVAL_TOLERANCE_METERS
  ) {
    return { ok: true, reason: "ACCURACY_FALLBACK", distanceMeters };
  }

  if (withinSafety && input.confirmNearby) {
    return { ok: true, reason: "MANUAL_NEARBY", distanceMeters };
  }

  if (withinSafety && accuracyPoor) {
    return { ok: false, reason: "UNCERTAIN", distanceMeters };
  }

  return { ok: false, reason: "TOO_FAR", distanceMeters };
}

export function courierArrivalErrorCode(reason: CourierArrivalReason): "GPS_TOO_FAR" | "GPS_ARRIVAL_UNCERTAIN" | "GPS_REQUIRED" {
  if (reason === "UNCERTAIN") return "GPS_ARRIVAL_UNCERTAIN";
  if (reason === "NO_TARGET") return "GPS_REQUIRED";
  return "GPS_TOO_FAR";
}
