/**
 * Payment auth calculation + pricing-mode checks.
 * Run: npx tsx apps/api/scripts/test-payment-auth.ts
 */
import {
  calculateTimeBasedAuthorization,
  isFixedPricing,
  isTimeBasedPricing,
  roundBillableMinutes,
  billableSecondsFromWorkWindow
} from "@gigflow/shared";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

assert(isFixedPricing("FIXED"), "FIXED is fixed");
assert(isTimeBasedPricing("HOURLY"), "HOURLY is timed");
assert(isTimeBasedPricing("ESTIMATE_TIMER"), "ESTIMATE_TIMER is timed");
assert(!isTimeBasedPricing("FIXED"), "FIXED is not timed");

const auth = calculateTimeBasedAuthorization({
  estimatedTotalCents: 6000,
  estimatedLaborCents: 6000,
  hourlyRateCents: 3000
});
assert(auth.authorizationBufferCents >= 1500, "buffer at least $15 (30m of $30/hr)");
assert(auth.maximumAuthorizedAmountCents === 6000 + auth.authorizationBufferCents, "max = estimate + buffer");

assert(roundBillableMinutes(98, 60, 15) === 105, "1h38 -> 1h45");
assert(roundBillableMinutes(10, 60, 15) === 60, "minimum 60 minutes");

const worked = billableSecondsFromWorkWindow({
  workStartedAt: new Date("2026-01-01T10:00:00Z"),
  workCompletedAt: new Date("2026-01-01T11:30:00Z"),
  totalApprovedPausedSeconds: 300
});
assert(worked === 5400 - 300, "90m minus 5m pause");

console.log("payment-auth checks passed");
