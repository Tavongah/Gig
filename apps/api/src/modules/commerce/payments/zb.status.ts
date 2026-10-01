/**
 * Map official Smile&Pay gateway statuses into DUTS payment states.
 * Status strings come from official callback / check-status docs — do not invent extras.
 *
 * Documented success: PAID, SUCCESS (Check Status: poll until PAID / SUCCESS).
 * Callback sample uses status: "PAID".
 */

export type ZbMappedStatus = "PAID" | "FAILED" | "EXPIRED" | "CANCELLED" | "PENDING";

const SUCCESS = new Set(["PAID", "SUCCESS"]);
const FAILED = new Set(["FAILED", "DECLINED", "GATEWAY_FAILED"]);
const CANCELLED = new Set(["CANCELLED"]);
const EXPIRED = new Set(["EXPIRED", "PAYMENT_ABANDONED"]);
const PENDING = new Set([
  "PENDING",
  "SENT",
  "INITIATED",
  "AWAITING_PAYMENT",
  "AWAITING_STATUS",
  "AWAITING",
  "SUBMITTED",
  "GATEWAY_INITIATED",
  "GATEWAY_SUBMITTED",
  "RETRYING"
]);

export function normalizeZbStatusRaw(raw: unknown): string {
  return String(raw ?? "")
    .trim()
    .toUpperCase();
}

/**
 * Unknown provider status stays PENDING. Never treat unknown as paid.
 */
export function mapZbProviderStatus(raw: unknown): ZbMappedStatus {
  const status = normalizeZbStatusRaw(raw);
  if (!status) return "PENDING";
  if (SUCCESS.has(status)) return "PAID";
  if (FAILED.has(status)) return "FAILED";
  if (CANCELLED.has(status)) return "CANCELLED";
  if (EXPIRED.has(status)) return "EXPIRED";
  if (PENDING.has(status)) return "PENDING";
  return "PENDING";
}

export function isZbAuthoritativePaid(raw: unknown): boolean {
  return SUCCESS.has(normalizeZbStatusRaw(raw));
}
