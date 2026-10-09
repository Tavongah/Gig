/**
 * Customer primary-shop DISPLAY only (A–G).
 * Does not change assignment, payment, courier, merchant, or WhatsApp logic.
 * Run: npm run test:customer-primary-shop --workspace=@gigflow/api
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { resolveCustomerPrimaryMerchant } from "@gigflow/shared";

const here = fileURLToPath(new URL(".", import.meta.url));
loadEnv({ path: resolve(here, "../../../.env") });
loadEnv({ path: resolve(here, "../.env") });
if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "ci-jwt-secret-minimum-24-characters-long";

const { presentCustomerCheckout } = await import("../src/modules/commerce/multi-shop-checkout.service.js");

function src(rel: string) {
  return readFileSync(resolve(here, rel), "utf8");
}

function order(id: string, name: string, items: Array<{ quantity: number; lineTotalCents: number }>) {
  return {
    id: `ord-${id}`,
    fulfillmentLabel: "A",
    status: "PLACED",
    merchant: { id, name, locationLabel: "Gweru" },
    items: items.map((i, n) => ({
      productNameSnapshot: `Item ${n}`,
      quantity: i.quantity,
      unitPriceCents: i.lineTotalCents / i.quantity,
      lineTotalCents: i.lineTotalCents
    }))
  };
}

function checkout(orders: ReturnType<typeof order>[]) {
  return {
    id: "chk-1",
    checkoutNumber: 100,
    status: "PAID",
    paymentStatus: "PAID",
    paymentMethod: "CASH",
    totalCents: 1000,
    itemsSubtotalCents: 900,
    deliveryFeeCents: 100,
    serviceFeeCents: 0,
    currency: "USD",
    deliveryLabel: "34 Nehosho Senga Gweru",
    orders
  };
}

const shopA = { merchantId: "shop-a", merchantName: "Shop A", quantity: 6, subtotalCents: 600 };
const shopB = { merchantId: "shop-b", merchantName: "Shop B", quantity: 2, subtotalCents: 200 };
const shopC = { merchantId: "shop-c", merchantName: "Shop C", quantity: 1, subtotalCents: 100 };

// A. quantity 6/2/1 → Shop A display; all three remain in operations payload
const a = resolveCustomerPrimaryMerchant([shopA, shopB, shopC]);
assert.equal(a?.merchantName, "Shop A");
const presentedA = presentCustomerCheckout(
  checkout([
    order("shop-a", "Shop A", [{ quantity: 6, lineTotalCents: 600 }]),
    order("shop-b", "Shop B", [{ quantity: 2, lineTotalCents: 200 }]),
    order("shop-c", "Shop C", [{ quantity: 1, lineTotalCents: 100 }])
  ])
);
assert.equal(presentedA.merchantName, "Shop A");
assert.equal(presentedA.merchant.name, "Shop A");
assert.equal(presentedA.shops.length, 3);
assert.deepEqual(
  presentedA.shops.map((s) => s.name).sort(),
  ["Shop A", "Shop B", "Shop C"]
);
assert.equal(presentedA.shopCount, 3);
console.log("A PASS");

// B. qty tie, greater subtotal wins
const b = resolveCustomerPrimaryMerchant([
  { merchantId: "shop-a", merchantName: "Shop A", quantity: 4, subtotalCents: 800 },
  { merchantId: "shop-b", merchantName: "Shop B", quantity: 4, subtotalCents: 400 }
]);
assert.equal(b?.merchantName, "Shop A");
console.log("B PASS");

// C. qty + subtotal tie → stable merchant id
const c = resolveCustomerPrimaryMerchant([
  { merchantId: "shop-z", merchantName: "Shop Z", quantity: 3, subtotalCents: 300 },
  { merchantId: "shop-m", merchantName: "Shop M", quantity: 3, subtotalCents: 300 }
]);
assert.equal(c?.merchantId, "shop-m");
assert.equal(c?.merchantName, "Shop M");
console.log("C PASS");

// D. single merchant
const d = presentCustomerCheckout(checkout([order("shop-a", "Shop A", [{ quantity: 2, lineTotalCents: 200 }])]));
assert.equal(d.merchantName, "Shop A");
assert.equal(d.shopCount, 1);
console.log("D PASS");

const helper = src("../src/modules/commerce/multi-shop-checkout.service.ts");
const job = src("../../mobile/src/screens/shared/DeliveryJobScreen.tsx");
const merchantWa = src("../src/modules/whatsapp/merchant-handler.ts");
const customerWa = src("../src/modules/whatsapp/customer-handler.ts");
const waCopy = src("../src/modules/whatsapp/copy.ts");
const provider = src("../src/modules/whatsapp/provider.ts");
const detail = src("../../mobile/src/screens/commerce/CommerceOrderDetailScreen.tsx");
const pricing = src("../../../packages/shared/src/pilot-delivery-pricing.ts");
const delivery = src("../src/modules/gigs/delivery.service.ts");

assert.match(helper, /resolveCustomerPrimaryMerchant/);
assert.doesNotMatch(helper, /\$\{shopCount\} shops/);
assert.match(detail, /Shop: \{order\.merchant\.name\}/);
assert.doesNotMatch(detail, /shops • One delivery/);
assert.doesNotMatch(detail, /pickupProgress\.map/);

// E. courier still lists every pickup shop
assert.match(job, /s\.shopName/);
assert.doesNotMatch(job, /resolveCustomerPrimaryMerchant/);
console.log("E PASS");

// F. merchant WhatsApp still own-merchant fulfillment
assert.match(merchantWa, /merchant\.name/);
assert.doesNotMatch(merchantWa, /resolveCustomerPrimaryMerchant/);
console.log("F PASS");

// G. admin not using customer display helper
assert.doesNotMatch(src("../../admin/src/App.tsx"), /resolveCustomerPrimaryMerchant/);
console.log("G PASS");

assert.doesNotMatch(customerWa, /resolveCustomerPrimaryMerchant/);
assert.doesNotMatch(waCopy, /resolveCustomerPrimaryMerchant/);
assert.doesNotMatch(provider, /resolveCustomerPrimaryMerchant/);
assert.match(pricing, /PILOT_TYPED_ADDRESS_FEE_CENTS/);
assert.match(delivery, /hashedPinsMatch/);
assert.match(helper, /createMultiShopCheckout/);

console.log("✅ Customer primary shop display tests A–G passed.");
