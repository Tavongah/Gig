/**
 * Offline seller commission + feature-flag helpers (no DB).
 * Run: npx tsx apps/api/scripts/test-seller-marketplace-commission.ts
 */
import assert from "node:assert/strict";
import {
  computeSellerCommissionCents,
  createSellerOfferSchema,
  createSellerSchema,
  DEFAULT_MARKETPLACE_SELLER_COMMISSION_RATE,
  parseSellerMarketplaceEnabled
} from "@gigflow/shared";

assert.equal(parseSellerMarketplaceEnabled(undefined), false);
assert.equal(parseSellerMarketplaceEnabled(""), false);
assert.equal(parseSellerMarketplaceEnabled("false"), false);
assert.equal(parseSellerMarketplaceEnabled("true"), true);
assert.equal(parseSellerMarketplaceEnabled("1"), true);
assert.equal(DEFAULT_MARKETPLACE_SELLER_COMMISSION_RATE, 0.15);

const example = computeSellerCommissionCents(4000, 0.15);
assert.equal(example.commissionCents, 600);
assert.equal(example.sellerProceedsCents, 3400);

const odd = computeSellerCommissionCents(1001, 0.15);
assert.equal(odd.commissionCents, 150); // floor(1001*150/1000)
assert.equal(odd.sellerProceedsCents, 851);

assert.throws(() => computeSellerCommissionCents(10.5 as unknown as number, 0.15));
assert.throws(() => computeSellerCommissionCents(100, 1.5));

const seller = createSellerSchema.parse({
  displayName: "Test Seller",
  phone: "+12035550199",
  pickupLocationLabel: "MSU Test Pickup",
  pickupLatitude: -17.3,
  pickupLongitude: 31.1
});
assert.equal(seller.displayName, "Test Seller");

const offer = createSellerOfferSchema.parse({
  catalogProductId: "11111111-1111-4111-8111-111111111111",
  priceCents: 4000,
  quantityAvailable: 20
});
assert.equal(offer.priceCents, 4000);

console.log(JSON.stringify({ ok: true, example }, null, 2));
