/**
 * Lightweight delivery UI mapping tests (no new test framework).
 * Run: npx tsx scripts/test-delivery-ui.ts
 */
import assert from "node:assert/strict";
import {
  canCancelDelivery,
  deliveryCustomerStatusLabel,
  deliveryCourierStatusLabel,
  isPostPickupDelivery,
  nextCourierDeliveryAction,
  transportModeLabel
} from "../src/lib/delivery-status";
import { friendlyDeliveryError, DELIVERY_ERROR_MESSAGES } from "../src/lib/delivery-errors";
import { canClientCancel, nextWorkerAction, statusLabel } from "../src/lib/gig-status";

function run(): void {
  assert.equal(deliveryCustomerStatusLabel("SEARCHING_FOR_WORKER"), "Finding a courier");
  assert.equal(deliveryCustomerStatusLabel("PACKAGE_COLLECTED"), "Package collected");
  assert.equal(deliveryCustomerStatusLabel("EN_ROUTE_TO_DROPOFF"), "Package on the way");
  assert.equal(deliveryCustomerStatusLabel("COMPLETED"), "Delivery complete");
  assert.ok(!deliveryCustomerStatusLabel("WORKER_EN_ROUTE").includes("WORKER_EN_ROUTE"));

  assert.equal(deliveryCourierStatusLabel("WORKER_ARRIVED"), "Collect package");
  assert.equal(nextCourierDeliveryAction("WORKER_ASSIGNED")?.kind, "start_pickup_travel");
  assert.equal(nextCourierDeliveryAction("WORKER_ARRIVED")?.kind, "verify_pickup");
  assert.equal(nextCourierDeliveryAction("ARRIVED_AT_DROPOFF")?.kind, "verify_delivery");
  assert.equal(nextCourierDeliveryAction("IN_PROGRESS"), null);

  assert.equal(canCancelDelivery("WORKER_ARRIVED"), true);
  assert.equal(canCancelDelivery("PACKAGE_COLLECTED"), false);
  assert.equal(isPostPickupDelivery("PACKAGE_COLLECTED"), true);
  assert.equal(canClientCancel("PACKAGE_COLLECTED", "DELIVERY"), false);
  assert.equal(canClientCancel("WORKER_ARRIVED", "DELIVERY"), true);
  assert.equal(canClientCancel("WORKER_EN_ROUTE", "LOCAL_HELP"), true);
  assert.equal(canClientCancel("IN_PROGRESS", "LOCAL_HELP"), false);

  assert.equal(nextWorkerAction("WORKER_ARRIVED", "DELIVERY"), null);
  assert.ok(nextWorkerAction("WORKER_ARRIVED", "LOCAL_HELP"));

  assert.equal(statusLabel("WORKER_EN_ROUTE", "DELIVERY"), "Courier heading to pickup");
  assert.equal(statusLabel("WORKER_EN_ROUTE", "LOCAL_HELP"), "Worker en route");
  assert.equal(transportModeLabel("PUBLIC_TRANSPORT"), "Public Transport / Kombi");

  assert.equal(
    friendlyDeliveryError({ code: "DELIVERY_DISTANCE_EXCEEDED", message: "x" }),
    DELIVERY_ERROR_MESSAGES.DELIVERY_DISTANCE_EXCEEDED
  );
  assert.equal(
    friendlyDeliveryError({ code: "PICKUP_PIN_LOCKED", message: "locked" }),
    DELIVERY_ERROR_MESSAGES.PICKUP_PIN_LOCKED
  );
  assert.equal(
    friendlyDeliveryError({ code: "INVALID_DELIVERY_PIN", message: "bad" }),
    DELIVERY_ERROR_MESSAGES.INVALID_DELIVERY_PIN
  );

  console.log("delivery UI mapping tests: OK");
}

run();
