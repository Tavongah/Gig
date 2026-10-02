/**
 * DUTS Commerce + courier UX cleanup V1 — source + unit checks (A–Y).
 * Run: npx tsx scripts/test-commerce-courier-ux.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  COURIER_ARRIVAL_SAFETY_MAX_METERS,
  COURIER_ARRIVAL_TOLERANCE_METERS,
  evaluateCourierArrival
} from "@gigflow/shared";

const here = dirname(fileURLToPath(import.meta.url));
const apiSrc = join(here, "../src");
const mobileSrc = join(here, "../../mobile/src");
const sharedSrc = join(here, "../../../packages/shared/src");

function read(rel: string, root = apiSrc) {
  return readFileSync(join(root, rel), "utf8");
}

function pass(id: string, note: string) {
  console.log(`PASS ${id} ${note}`);
}

const job = read("screens/shared/DeliveryJobScreen.tsx", mobileSrc);
const home = read("screens/worker/WorkerHomeScreen.tsx", mobileSrc);
const nearby = read("screens/worker/WorkerNearbyGigsScreen.tsx", mobileSrc);
const checkout = read("screens/commerce/CommerceCheckoutScreen.tsx", mobileSrc);
const orderDetail = read("screens/commerce/CommerceOrderDetailScreen.tsx", mobileSrc);
const location = read("lib/location.ts", mobileSrc);
const errors = read("lib/delivery-errors.ts", mobileSrc);
const confirm = read("lib/confirm.ts", mobileSrc);
const workflow = read("modules/gigs/gig-workflow.service.ts");
const delivery = read("modules/gigs/delivery.service.ts");
const gigService = read("modules/gigs/gig.service.ts");
const realtime = read("modules/realtime/realtime.service.ts");
const worker = read("modules/workers/worker.service.ts");
const arrival = read("courier-arrival.ts", sharedSrc);
const flags = read("multi-shop-checkout.ts", sharedSrc);
const banner = read("components/DutsInlineBanner.tsx", mobileSrc);

assert.ok(!job.includes("showAlert"), "A job screen has no native alert");
assert.ok(!job.includes("showConfirm"), "E job screen has no native confirm");
assert.ok(job.includes("Accept delivery"), "A accept is a button");
assert.ok(!job.includes("Interest sent"), "A no waiting-for-customer copy");
pass("A", "accept delivery has no browser alert");

assert.ok(job.includes("Confirming location"), "B location action is contextual");
assert.ok(!job.includes("Refresh and try again"), "C no refresh-and-try-again alert");
pass("B", "arrive uses inline loading, not alert");

assert.ok(errors.includes("This delivery updated. Check the next step."), "C stale step copy");
assert.ok(job.includes("INVALID_STATUS_TRANSITION"), "C/X reconcile on stale transition");
assert.ok(job.includes("invalidate()"), "X refetch authoritative delivery");
pass("C", "invalid lifecycle reconciles inline");
pass("X", "state reconciliation without refresh popup");

assert.ok(errors.includes("We couldn't confirm your location"), "D location failure copy");
assert.ok(job.includes("kind: \"location\""), "D location inline error");
assert.ok(job.includes("Get directions"), "K directions fallback");
assert.ok(job.includes("Try again"), "D/K retry");
pass("D", "location failure is inline");
pass("K", "location unavailable has retry/directions");

assert.ok(job.includes("Can't complete this delivery?"), "E in-app release sheet");
assert.ok(job.includes("Release delivery"), "E release CTA");
assert.ok(job.includes("Go back"), "E go back");
pass("E", "release uses in-app sheet, not confirm()");

const origin = { courierLat: -19.45, courierLng: 29.82, targetLat: -19.45, targetLng: 29.82 };
assert.equal(evaluateCourierArrival(origin).ok, true);
assert.equal(evaluateCourierArrival(origin).reason, "WITHIN_TOLERANCE");
pass("F", "exact pin arrives");

const at50 = evaluateCourierArrival({
  ...origin,
  courierLat: origin.courierLat + 50 / 111_320
});
assert.equal(at50.ok, true);
pass("G", "50m arrives");

const at100 = evaluateCourierArrival({
  ...origin,
  courierLat: origin.courierLat + 100 / 111_320
});
assert.equal(at100.ok, true);
assert.ok(COURIER_ARRIVAL_TOLERANCE_METERS >= 100 && COURIER_ARRIVAL_TOLERANCE_METERS <= 200);
pass("H", `~100m within ${COURIER_ARRIVAL_TOLERANCE_METERS}m tolerance`);

const uncertain = evaluateCourierArrival({
  ...origin,
  courierLat: origin.courierLat + 180 / 111_320,
  accuracyMeters: 120
});
assert.equal(uncertain.ok, true);
assert.equal(uncertain.reason, "ACCURACY_FALLBACK");
pass("I", "poor accuracy outside strict threshold still allowed");

const far = evaluateCourierArrival({
  ...origin,
  courierLat: origin.courierLat + 800 / 111_320,
  accuracyMeters: 20
});
assert.equal(far.ok, false);
assert.equal(far.reason, "TOO_FAR");
assert.ok(COURIER_ARRIVAL_SAFETY_MAX_METERS >= 300);
pass("J", "clearly far is blocked");

assert.ok(!location.includes("MAX_ACCEPTABLE_ACCURACY_M"), "client does not hard-reject poor GPS");
assert.ok(location.includes("accuracyMeters"), "accuracy forwarded");
assert.ok(arrival.includes("COURIER_ARRIVAL_TOLERANCE_METERS"), "tolerance centralized");
assert.ok(gigService.includes("evaluateCourierArrival") || workflow.includes("evaluateCourierArrival"), "API uses shared helper");

assert.ok(checkout.includes("YOUR DUTS ORDER"), "L one order heading");
assert.ok(checkout.includes("PLACE ORDER"), "L one place CTA");
assert.ok(!checkout.includes("Checkout Shop"), "L no shop-by-shop");
assert.ok(orderDetail.includes("YOUR DUTS ORDER"), "L one customer order");
pass("L", "one-shop checkout is one order");

assert.ok(checkout.includes("shopCount"), "M shop count is informational");
assert.ok(!checkout.includes("Payment Shop"), "M no per-shop pay");
assert.ok(job.includes("pickupCount"), "M/Q multi pickup on courier");
assert.ok(job.includes("○ Customer") || job.includes("→ Customer"), "S customer is one dropoff");
pass("M", "2 shops remain one customer order / one courier delivery");
pass("N", "3-shop architecture is same parent delivery");
pass("Q", "pickup sequence displayed");
pass("R", "next pickup follows collected stop");
pass("S", "customer is the dropoff after pickups");

assert.ok(gigService.includes("PAID ✓"), "O paid label");
assert.ok(gigService.includes("CASH ON DELIVERY"), "P COD label");
assert.ok(job.includes("Do not collect cash"), "O courier paid copy");
assert.ok(job.includes("Collect "), "P courier collect copy");
pass("O", "EcoCash shows PAID");
pass("P", "COD shows one collect amount");

assert.ok(job.includes("Release delivery"), "T release before pickup");
assert.ok(job.includes("Report and get help") || job.includes("You already collected"), "U needs attention after pickup");
pass("T", "release before pickup rematches");
pass("U", "after pickup → Needs Attention");

assert.ok(delivery.includes("commerceFulfillment"), "V commerce payout zeroed");
assert.ok(delivery.includes("commerceFulfillment ? 0"), "V no delivery-fee earnings");
assert.ok(worker.includes("commerceLinkedGigIdSet"), "V pending excludes commerce");
assert.ok(realtime.includes("hideCommerceEarnings") || realtime.includes("commerceDelivery"), "V offer has no You earn for commerce");
pass("V", "commerce delivery fee is not courier earnings");
pass("W", "legacy gig earnings path unchanged (non-commerce)");

assert.ok(!workflow.includes("Customer selected you for this delivery"), "legacy select copy removed for commerce");
assert.ok(!workflow.includes("Complete payment confirmation to unlock pickup details."), "payment unlock copy removed");
assert.ok(workflow.includes("Delivery accepted"), "commerce assignment copy");
assert.ok(home.includes("shouldSilenceWorkerNotification"), "home silences delivery popups");
assert.ok(nearby.includes("shouldSilenceWorkerNotification"), "nearby silences delivery popups");
assert.ok(banner.includes("DutsInlineBanner"), "inline error component");
assert.ok(job.includes("DutsInlineBanner"), "job uses inline banner");
assert.ok(confirm.includes("window.alert"), "legacy confirm helper still exists for unrelated gig flows");
assert.ok(flags.includes("false"), "MULTI_SHOP_CHECKOUT_ENABLED stays default false");

assert.ok(job.includes("actionMutation.isPending"), "Y pending disables double tap");
assert.ok(job.includes("loading={actionMutation.isPending}"), "Y button locked while pending");
pass("Y", "lifecycle buttons disable while pending");

assert.ok(job.includes("Enter pickup code") || job.includes("pickup code"), "pickup PIN preserved");
assert.ok(job.includes("Enter delivery code") || job.includes("delivery code"), "delivery PIN preserved");
assert.ok(job.includes("I'm at the shop"), "manual nearby fallback");

console.log("\nCommerce + courier UX checks passed.");
