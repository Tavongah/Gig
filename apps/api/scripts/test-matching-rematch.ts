/**
 * Lightweight regression checks for matching / worker-cancel rematch rules.
 * Run: npx tsx apps/api/scripts/test-matching-rematch.ts
 */
import { isCustomerRematching, workerCancelOutcome } from "@gigflow/shared";

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

assert(workerCancelOutcome("WORKER_ASSIGNED") === "REMATCH", "assigned cancel rematches");
assert(workerCancelOutcome("WORKER_EN_ROUTE") === "REMATCH", "traveling cancel rematches");
assert(workerCancelOutcome("WORKER_ARRIVED") === "REMATCH", "arrived cancel rematches");
assert(workerCancelOutcome("IN_PROGRESS") === "DISPUTE", "in-progress goes to dispute");
assert(workerCancelOutcome("COMPLETED") === "BLOCKED", "completed cannot cancel");
assert(workerCancelOutcome("POSTED") === "BLOCKED", "matching-only is not selected-worker cancel");

assert(
  isCustomerRematching("SEARCHING_FOR_WORKER", "PAYMENT_CAPTURED") === true,
  "paid searching is rematching"
);
assert(isCustomerRematching("SEARCHING_FOR_WORKER", "PAYMENT_PENDING") === false, "unpaid searching is first match");
assert(isCustomerRematching("WORKER_ASSIGNED", "PAYMENT_CAPTURED") === false, "assigned is not rematching UI");

console.log("matching-rematch checks passed");
