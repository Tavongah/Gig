/**
 * Marketplace delivery UX simplification + photo-optional courier gates.
 * Run: npx tsx scripts/test-delivery-ux-simplification.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  deliveryCourierStatusLabel,
  nextCourierDeliveryAction
} from "../src/lib/delivery-status";
import { canWorkerGoOnline, needsProfilePhoto } from "../src/lib/auth";
import type { ApiUser } from "../src/lib/api";

function baseUser(over: Partial<ApiUser> = {}): ApiUser {
  return {
    id: "u1",
    email: "c@example.com",
    fullName: "Courier",
    roles: ["WORKER"],
    defaultRole: "WORKER",
    accountStatus: "APPROVED",
    emailVerified: true,
    phoneVerified: true,
    profileCompleted: true,
    avatarUrl: null,
    ...over
  } as ApiUser;
}

function run(): void {
  const flow = [
    "WORKER_ASSIGNED",
    "WORKER_EN_ROUTE",
    "WORKER_ARRIVED",
    "PACKAGE_COLLECTED",
    "EN_ROUTE_TO_DROPOFF",
    "ARRIVED_AT_DROPOFF",
    "COMPLETED"
  ] as const;

  const kinds = flow.map((s) => nextCourierDeliveryAction(s)?.kind ?? "done");
  assert.deepEqual(kinds, [
    "arrive_pickup",
    "arrive_pickup",
    "verify_pickup",
    "arrive_dropoff",
    "arrive_dropoff",
    "verify_delivery",
    "done"
  ]);

  for (const status of flow) {
    const label = deliveryCourierStatusLabel(status);
    assert.ok(!/gig/i.test(label), `courier label has no Gig: ${status}`);
    assert.ok(!label.includes("_"), `no enum leak: ${status} → ${label}`);
    assert.ok(!/start trip/i.test(nextCourierDeliveryAction(status)?.label ?? ""));
  }

  const noPhoto = baseUser({ avatarUrl: null });
  assert.equal(needsProfilePhoto(noPhoto), true);
  assert.equal(canWorkerGoOnline(noPhoto), true, "courier without photo can go online");

  const withPhoto = baseUser({ avatarUrl: "https://cdn.example/a.jpg" });
  assert.equal(canWorkerGoOnline(withPhoto), true);

  const here = dirname(fileURLToPath(import.meta.url));
  const accessSrc = readFileSync(
    join(here, "../../../apps/api/src/modules/auth/access.service.ts"),
    "utf8"
  );
  const goOnlineBlock = accessSrc.slice(
    accessSrc.indexOf("export function assertWorkerCanGoOnline"),
    accessSrc.indexOf("export function assertWorkerCanAcceptGigs")
  );
  assert.ok(
    !goOnlineBlock.includes("PROFILE_PHOTO_REQUIRED"),
    "API go-online must not require profile photo"
  );

  const deliveryJob = readFileSync(
    join(here, "../src/screens/shared/DeliveryJobScreen.tsx"),
    "utf8"
  );
  assert.ok(deliveryJob.includes("Directions to shop"));
  assert.ok(deliveryJob.includes("Directions to customer"));
  assert.ok(deliveryJob.includes("startTravelToPickup"));
  assert.ok(!/Start trip to pickup/i.test(deliveryJob));

  console.log("delivery UX simplification regressions: OK");
}

run();
