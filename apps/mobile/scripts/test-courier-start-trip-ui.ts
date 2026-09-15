/**
 * Courier Start Trip / delivery UI regressions (React #300 hook-order safety).
 * Run: npx tsx scripts/test-courier-start-trip-ui.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  deliveryCourierStatusLabel,
  nextCourierDeliveryAction
} from "../src/lib/delivery-status";
import { nextWorkerAction } from "../src/lib/gig-status";
import { openGigForRole } from "../src/lib/open-gig";

const DELIVERY_STATUSES = [
  "WORKER_ASSIGNED",
  "WORKER_EN_ROUTE",
  "WORKER_ARRIVED",
  "PACKAGE_COLLECTED",
  "EN_ROUTE_TO_DROPOFF",
  "ARRIVED_AT_DROPOFF",
  "WAITING_CUSTOMER_CONFIRMATION",
  "COMPLETED"
] as const;

function run(): void {
  // React 19 minified #300 = fewer hooks than expected (early return before hooks).
  assert.equal(
    nextCourierDeliveryAction("WORKER_ASSIGNED")?.kind,
    "start_pickup_travel",
    "Start Trip available when assigned"
  );
  assert.equal(
    nextCourierDeliveryAction("WORKER_EN_ROUTE")?.kind,
    "arrive_pickup",
    "After start trip, next action is arrive at pickup"
  );
  assert.equal(nextWorkerAction("WORKER_ASSIGNED", "DELIVERY"), null);
  assert.ok(nextWorkerAction("WORKER_ASSIGNED", "LOCAL_HELP"), "LOCAL_HELP Start travel preserved");

  for (const status of DELIVERY_STATUSES) {
    const label = deliveryCourierStatusLabel(status);
    assert.ok(label.length > 0, `label for ${status}`);
    assert.ok(!label.includes(status), `no raw status enum in courier label: ${status}`);
    // Must not throw for any lifecycle status
    nextCourierDeliveryAction(status);
  }

  // Direct-load EN_ROUTE: arrive action available
  assert.equal(nextCourierDeliveryAction("WORKER_EN_ROUTE")?.kind, "arrive_pickup");

  const navigated: Array<{ name: string; params?: object }> = [];
  const nav = {
    navigate: (name: string, params?: object) => {
      navigated.push({ name, params });
    }
  };

  openGigForRole(
    nav,
    {
      id: "gig-delivery",
      status: "WORKER_ASSIGNED",
      fulfillmentType: "DELIVERY",
      paymentStatus: "PAYMENT_AUTHORIZED",
      assignments: [{ worker: { id: "w1" } }]
    } as never,
    "WORKER"
  );
  assert.equal(navigated.at(-1)?.name, "DeliveryJob", "assigned delivery opens DeliveryJob");

  navigated.length = 0;
  openGigForRole(
    nav,
    {
      id: "gig-en-route",
      status: "WORKER_EN_ROUTE",
      fulfillmentType: "DELIVERY",
      paymentStatus: "PAYMENT_AUTHORIZED",
      assignments: [{ worker: { id: "w1" } }]
    } as never,
    "WORKER"
  );
  assert.equal(navigated.at(-1)?.name, "DeliveryJob", "EN_ROUTE delivery opens DeliveryJob");

  navigated.length = 0;
  openGigForRole(
    nav,
    {
      id: "gig-local",
      status: "WORKER_ASSIGNED",
      fulfillmentType: "LOCAL_HELP",
      paymentStatus: "PAYMENT_AUTHORIZED",
      assignments: [{ worker: { id: "w1" } }]
    } as never,
    "WORKER"
  );
  assert.equal(navigated.at(-1)?.name, "GigDetail", "LOCAL_HELP still uses GigDetail");

  // Static guard: GigDetailScreen must not early-return before useSocket (React #300).
  const here = dirname(fileURLToPath(import.meta.url));
  const gigDetailSrc = readFileSync(
    join(here, "../src/screens/shared/GigDetailScreen.tsx"),
    "utf8"
  );
  const deliveryReturnIdx = gigDetailSrc.indexOf("if (isDelivery)");
  const useSocketIdx = gigDetailSrc.indexOf("const socket = useSocket()");
  assert.ok(useSocketIdx >= 0, "useSocket present");
  assert.ok(deliveryReturnIdx > useSocketIdx, "delivery early return must be after useSocket");

  const errorBoundarySrc = readFileSync(
    join(here, "../src/components/ErrorBoundary.tsx"),
    "utf8"
  );
  assert.ok(errorBoundarySrc.includes("Please try again."));
  assert.ok(!errorBoundarySrc.includes("error.message"), "raw React errors not shown to courier");

  console.log("courier start-trip UI regressions: OK");
}

run();
