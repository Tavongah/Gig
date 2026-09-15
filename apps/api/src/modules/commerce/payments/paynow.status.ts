/**
 * Map documented Paynow statuses into DUTS payment outcomes.
 * Unknown statuses fail closed (non-paid).
 */

export type PaynowMappedStatus = "PENDING" | "PAID" | "FAILED" | "EXPIRED" | "CANCELLED" | "UNKNOWN";

export function mapPaynowStatus(raw: string | undefined | null): PaynowMappedStatus {
  const s = String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/\+/g, " ");

  // Documented paid / paid-in-suspense states (funds received / payment complete)
  if (s === "paid" || s === "awaiting delivery" || s === "delivered") {
    return "PAID";
  }
  if (s === "cancelled" || s === "canceled") {
    return "CANCELLED";
  }
  if (s === "created" || s === "sent" || s === "ok" || s === "pending") {
    return "PENDING";
  }
  // Test-mode / documented failure-like
  if (s === "failed" || s === "error" || s === "disputed" || s === "refunded") {
    return "FAILED";
  }
  return "UNKNOWN";
}

/** Official Paynow Express Checkout test mobile numbers (Test Mode only). */
export const PAYNOW_OFFICIAL_TEST_NUMBERS = {
  SUCCESS_FAST: "0771111111",
  SUCCESS_DELAYED: "0772222222",
  USER_CANCELLED: "0773333333",
  INSUFFICIENT_BALANCE: "0774444444"
} as const;
