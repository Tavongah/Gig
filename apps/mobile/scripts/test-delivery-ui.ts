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
  assert.equal(deliveryCustomerStatusLabel("PACKAGE_COLLECTED"), "Order picked up");
  assert.equal(deliveryCustomerStatusLabel("EN_ROUTE_TO_DROPOFF"), "On the way");
  assert.equal(deliveryCustomerStatusLabel("COMPLETED"), "Delivered");
  assert.ok(!deliveryCustomerStatusLabel("WORKER_EN_ROUTE").includes("WORKER_EN_ROUTE"));

  assert.equal(nextCourierDeliveryAction("WORKER_ASSIGNED")?.kind, "arrive_pickup");
  assert.equal(nextCourierDeliveryAction("WORKER_ASSIGNED")?.label, "Arrived");
  assert.equal(
    (nextCourierDeliveryAction("WORKER_ASSIGNED") as { ensurePickupTravel?: boolean })?.ensurePickupTravel,
    true
  );
  assert.equal(nextCourierDeliveryAction("WORKER_EN_ROUTE")?.kind, "arrive_pickup");
  assert.equal(nextCourierDeliveryAction("WORKER_ARRIVED")?.kind, "verify_pickup");
  assert.equal(nextCourierDeliveryAction("WORKER_ARRIVED")?.label, "Picked up");
  assert.equal(nextCourierDeliveryAction("PACKAGE_COLLECTED")?.kind, "arrive_dropoff");
  assert.equal(nextCourierDeliveryAction("ARRIVED_AT_DROPOFF")?.kind, "verify_delivery");
  assert.equal(nextCourierDeliveryAction("ARRIVED_AT_DROPOFF")?.label, "Complete delivery");
  assert.equal(nextCourierDeliveryAction("IN_PROGRESS"), null);

  assert.equal(deliveryCourierStatusLabel("WORKER_ASSIGNED"), "Directions to shop");
  assert.equal(deliveryCourierStatusLabel("PACKAGE_COLLECTED"), "Directions to customer");
  assert.ok(!deliveryCourierStatusLabel("WORKER_EN_ROUTE").includes("WORKER"));
  assert.ok(!/"Start trip"/i.test(nextCourierDeliveryAction("WORKER_ASSIGNED")?.label ?? ""));

  assert.equal(canCancelDelivery("WORKER_ARRIVED"), true);
  assert.equal(canCancelDelivery("PACKAGE_COLLECTED"), false);
  assert.equal(isPostPickupDelivery("PACKAGE_COLLECTED"), true);
  assert.equal(canClientCancel("PACKAGE_COLLECTED", "DELIVERY"), false);
  assert.equal(canClientCancel("WORKER_ARRIVED", "DELIVERY"), true);
  assert.equal(canClientCancel("WORKER_EN_ROUTE", "LOCAL_HELP"), true);
  assert.equal(canClientCancel("IN_PROGRESS", "LOCAL_HELP"), false);

  assert.equal(nextWorkerAction("WORKER_ARRIVED", "DELIVERY"), null);
  assert.ok(nextWorkerAction("WORKER_ARRIVED", "LOCAL_HELP"));

  assert.equal(statusLabel("WORKER_EN_ROUTE", "DELIVERY"), "Courier going to shop");
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
