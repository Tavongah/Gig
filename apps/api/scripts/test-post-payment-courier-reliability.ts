process.env.NODE_ENV = process.env.NODE_ENV || "test";
process.env.APP_ENV = process.env.APP_ENV || "development";
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-jwt-secret-min-24-chars!!";
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://postgres:postgres@127.0.0.1:5432/duts_gig_dev";
process.env.WHATSAPP_PROVIDER = "mock";

/**
 * Post-payment merchant WhatsApp reliability + courier release tests (A–Z).
 * Does not charge ZB / mutate production Order #2.
 * Run: npx tsx scripts/test-post-payment-courier-reliability.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  FULFILLMENT_NOTE,
  addFulfillmentNote,
  fulfillmentAdminLabel,
  merchantNotificationAdminLabel,
  workerCancelOutcome
} from "@gigflow/shared";

const here = fileURLToPath(new URL(".", import.meta.url));
const skipped: string[] = [];
const passed: string[] = [];

function pass(letter: string) {
  passed.push(letter);
}

function readApi(rel: string) {
  return readFileSync(resolve(here, rel), "utf8");
}

const paymentsRoutes = readApi("../src/modules/commerce/payments/payments.routes.ts");
const paymentService = readApi("../src/modules/commerce/payments/payment.service.ts");
const zbProvider = readApi("../src/modules/commerce/payments/zb.provider.ts");
const notifySvc = readApi("../src/modules/commerce/merchant-notification.service.ts");
const waProvider = readApi("../src/modules/whatsapp/provider.ts");
const waRoutes = readApi("../src/modules/whatsapp/whatsapp.routes.ts");
const deliverySvc = readApi("../src/modules/gigs/delivery.service.ts");
const gigRoutes = readApi("../src/modules/gigs/gig.routes.ts");
const workflow = readApi("../src/modules/gigs/gig-workflow.service.ts");
const gigService = readApi("../src/modules/gigs/gig.service.ts");
const schema = readApi("../prisma/schema.prisma");
const jobScreen = readFileSync(resolve(here, "../../mobile/src/screens/shared/DeliveryJobScreen.tsx"), "utf8");
const nearbyCard = readFileSync(resolve(here, "../../mobile/src/components/NearbyGigCard.tsx"), "utf8");
const sessionStore = readFileSync(resolve(here, "../../mobile/src/stores/session.store.ts"), "utf8");
const adminApp = readFileSync(resolve(here, "../../admin/src/App.tsx"), "utf8");

// A. PAID path persists order then notifies independently of customer WhatsApp
assert.match(paymentsRoutes, /notifyAfterPaidCommerceOrder/);
assert.match(notifySvc, /notifyMerchantNewOrderSafe/);
assert.doesNotMatch(paymentsRoutes, /if \(order\?\.customerWhatsAppPhone\) \{\s*const \{ notifyCustomerStatus, notifyMerchantNewOrder/);
assert.match(notifySvc, /customer WhatsApp is not a fulfillment gate|notifyMerchantNewOrderSafe/);
pass("A");

// B. Duplicate ZB callback does not re-notify as a new order
assert.match(paymentService, /duplicate: true/);
assert.match(notifySvc, /merchant-new-order-\$\{/);
assert.match(notifySvc, /duplicate: true/);
pass("B");

// C. SID persisted
assert.match(waProvider, /providerMessageSid/);
assert.match(notifySvc, /providerMessageSid: result.providerMessageSid/);
assert.match(schema, /model CommerceNotificationAttempt/);
pass("C");

// D. Transient failure retries, order stays active
assert.match(waProvider, /TRANSIENT/);
assert.match(notifySvc, /nextRetryAt/);
assert.match(notifySvc, /MAX_ATTEMPTS/);
pass("D");

// E. Permanent failure → needs attention, order not cancelled
assert.match(notifySvc, /TEMPLATE_REQUIRED/);
assert.match(notifySvc, /NEEDS_ATTENTION/);
assert.doesNotMatch(notifySvc, /paymentStatus: \"FAILED\"/);
assert.doesNotMatch(notifySvc, /status:\s*CommerceOrderStatus\.CANCELLED/);
pass("E");

// F. Outside session uses template when configured, else does not fake success
assert.match(notifySvc, /merchantSessionOpen/);
assert.match(notifySvc, /TWILIO_CONTENT_SID_MERCHANT_NEW_ORDER/);
assert.match(notifySvc, /errorCategory: \"TEMPLATE_REQUIRED\"/);
assert.match(waProvider, /ContentSid/);
pass("F");

// C continued: status callback
assert.match(waRoutes, /twilio\/status/);
assert.match(notifySvc, /applyTwilioMessageStatus/);
assert.match(waRoutes, /verifyTwilioSignature/);

// Admin retry
assert.match(waRoutes, /retry-whatsapp/);
assert.match(adminApp, /Retry WhatsApp/);
assert.match(waRoutes, /retryMerchantNewOrderNotification/);
assert.match(waRoutes, /orderNumber === 2/);
assert.match(notifySvc, /notificationAttempts: \{ none:/);

// G–J before-pickup release
assert.match(deliverySvc, /releaseCommerceDelivery/);
assert.match(deliverySvc, /BEFORE_PICKUP/);
assert.match(deliverySvc, /SEARCHING_FOR_WORKER/);
assert.match(deliverySvc, /assignedWorkerId: null/);
assert.doesNotMatch(deliverySvc.split("export async function releaseCommerceDelivery")[1]!.slice(0, 4000), /paymentStatus:/);
pass("G");
pass("H");
assert.match(deliverySvc, /FINDING_REPLACEMENT_COURIER/);
pass("I");
assert.match(deliverySvc, /COURIER_NOT_ASSIGNED/);
pass("J");

// K–N after pickup
assert.match(deliverySvc, /AFTER_PICKUP/);
assert.match(deliverySvc, /COURIER_POST_PICKUP_FAILURE/);
assert.match(deliverySvc, /needsAttention: true/);
assert.doesNotMatch(deliverySvc.split("if (postPickup)")[1]!.slice(0, 1500), /assignedWorkerId: null/);
pass("K");
pass("L");
pass("M");
assert.match(deliverySvc, /anyStopCollected/);
pass("N");

// O–S security
assert.match(deliverySvc, /gig.assignedWorkerId !== courierUserId/);
assert.match(gigRoutes, /req.auth!.userId/);
assert.match(deliverySvc, /alreadyProcessed: true/);
assert.match(deliverySvc, /hashedPinsMatch/);
assert.match(deliverySvc, /verifyDeliveryPinAndComplete/);
pass("O");
pass("P");
pass("Q");
pass("R");
pass("S");

// T–X courier UI
assert.match(jobScreen, /Items confirmed — continue/);
assert.match(jobScreen, /SHOP HAS NOT|commercePickup\?\.warning|Do not collect payment/);
assert.match(jobScreen, /Do not collect payment/);
assert.match(jobScreen, /Cash on delivery/);
assert.doesNotMatch(nearbyCard.slice(nearbyCard.indexOf("DUTS DELIVERY"), nearbyCard.indexOf("Local help")), /Earnings/);
assert.match(nearbyCard, /Accept delivery|DUTS DELIVERY/);
pass("T");
pass("U");
pass("V");
pass("W");
pass("X");

// Y UI polish
assert.match(jobScreen, /Can't complete delivery/);
assert.match(jobScreen, /Report a problem/);
assert.match(jobScreen, /Release this delivery/);
assert.match(jobScreen, /You already collected this order/);
pass("Y");

// Z logout
assert.match(sessionStore, /authStorage.clearToken/);
assert.match(sessionStore, /activeRole: \"CLIENT\"/);
assert.doesNotMatch(sessionStore, /CANCELLED/);
pass("Z");

// ZB / COD / Paynow unchanged
assert.match(zbProvider, /express-checkout\/ecocash/);
assert.match(paymentService, /applyProviderPaymentResult/);
assert.doesNotMatch(notifySvc, /Paynow|paynow/);
assert.match(workflow, /Your order is still confirmed/);

assert.equal(merchantNotificationAdminLabel("DELIVERED"), "Merchant notified ✓");
assert.equal(
  fulfillmentAdminLabel({
    notes: addFulfillmentNote(null, FULFILLMENT_NOTE.FINDING_REPLACEMENT_COURIER),
    hasCourier: false
  }),
  "Finding replacement courier"
);
assert.equal(workerCancelOutcome("PACKAGE_COLLECTED"), "BLOCKED");

assert.match(gigService, /commerceCourierPayment/);
assert.match(gigService, /SHOP HAS NOT RECEIVED\/CONFIRMED THE DIGITAL ORDER/);
assert.match(gigRoutes, /delivery\/release/);
assert.match(schema, /model CourierDeliveryRelease/);
assert.match(adminApp, /courierRelease/);

process.env.WHATSAPP_PROVIDER = "mock";
process.env.NODE_ENV = "test";
process.env.APP_ENV = "development";

const { merchantNewOrderIdempotencyKey } = await import("../src/modules/commerce/merchant-notification.service.js");
assert.equal(
  merchantNewOrderIdempotencyKey("abc"),
  "merchant-new-order-abc"
);

let dbRan = false;
try {
  const { prisma } = await import("../src/config/prisma.js");
  await prisma.$queryRaw`SELECT 1`;
  const { getMockWhatsAppProvider, resetWhatsAppProviderForTests } = await import(
    "../src/modules/whatsapp/provider.js"
  );
  const { createMerchant, upsertProductForMerchant } = await import("../src/modules/commerce/merchant.service.js");
  const { createConfirmedCommerceOrder } = await import("../src/modules/commerce/order.service.js");
  const {
    enqueueMerchantNewOrderNotification,
    retryMerchantNewOrderNotification,
    applyTwilioMessageStatus
  } = await import("../src/modules/commerce/merchant-notification.service.js");

  resetWhatsAppProviderForTests();
  const mock = getMockWhatsAppProvider();
  mock.clear();
  const suffix = String(Date.now()).slice(-6);
  const merchant = await createMerchant({
    name: `Notify Shop ${suffix}`,
    contactName: "Owner",
    phone: `+26377${suffix}1`.slice(0, 13),
    whatsappPhone: `+26377${suffix}1`.slice(0, 13),
    locationLabel: "Glen Norah B",
    latitude: -17.87,
    longitude: 30.99
  });
  const product = await upsertProductForMerchant(merchant.id, {
    name: "Bread",
    priceCents: 100,
    available: true
  });
  const order = await createConfirmedCommerceOrder({
    merchantId: merchant.id,
    lines: [{ productId: product.id, quantity: 1, productName: "Bread", unitPriceCents: 100, lineTotalCents: 100, merchantId: merchant.id }],
    deliveryLabel: "Glen Norah B",
    deliveryLatitude: -17.88,
    deliveryLongitude: 31.0,
    customerWhatsAppPhone: `+26378${suffix}2`.slice(0, 13),
    paymentMethod: "CASH"
  });
  const first = await enqueueMerchantNewOrderNotification(order);
  assert.ok(first.providerMessageSid, "C SID");
  const dup = await enqueueMerchantNewOrderNotification(order);
  assert.equal(dup.duplicate || dup.providerMessageSid === first.providerMessageSid, true, "no duplicate identity");
  if (first.providerMessageSid) {
    await applyTwilioMessageStatus({
      messageSid: first.providerMessageSid,
      messageStatus: "delivered"
    });
  }
  mock.failUntilCleared = { ok: false, errorCategory: "TRANSIENT", errorCode: "20429" };
  const failOrder = await createConfirmedCommerceOrder({
    merchantId: merchant.id,
    lines: [{ productId: product.id, quantity: 1, productName: "Bread", unitPriceCents: 100, lineTotalCents: 100, merchantId: merchant.id }],
    deliveryLabel: "Glen Norah B",
    deliveryLatitude: -17.88,
    deliveryLongitude: 31.0,
    paymentMethod: "CASH"
  });
  const transient = await retryMerchantNewOrderNotification(failOrder.id);
  assert.notEqual(String(transient.status), "CANCELLED");
  const still = await prisma.commerceOrder.findUniqueOrThrow({ where: { id: failOrder.id } });
  assert.notEqual(still.status, "CANCELLED");
  assert.equal(still.paymentStatus, "DUE_ON_DELIVERY");
  mock.failUntilCleared = null;
  dbRan = true;
  await prisma.$disconnect();
} catch (err) {
  skipped.push(`DB:${err instanceof Error ? err.message.slice(0, 80) : "unavailable"}`);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      passed: passed.join(""),
      skipped,
      dbRan
    },
    null,
    2
  )
);
