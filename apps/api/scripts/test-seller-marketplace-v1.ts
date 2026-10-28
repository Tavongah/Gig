/**
 * Seller Marketplace V1 foundation (DB required).
 * Run from apps/api: npx tsx scripts/test-seller-marketplace-v1.ts
 *
 * Does NOT enable customer fulfillment. Does NOT modify merchant stock/prices.
 */
import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const here = fileURLToPath(new URL(".", import.meta.url));
loadEnv({ path: resolve(here, "../../../.env") });
loadEnv({ path: resolve(here, "../.env") });

if (process.env.GIG_TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.GIG_TEST_DATABASE_URL;
} else if (process.env.DATABASE_URL && !process.env.DATABASE_URL.includes("duts_gig_dev")) {
  process.env.DATABASE_URL = process.env.DATABASE_URL.replace(/\/[^/?]+(\?|$)/, "/duts_gig_dev$1");
}

async function main() {
  process.env.NODE_ENV = "test";
  process.env.SELLER_MARKETPLACE_ENABLED = "false";

  const { prisma } = await import("../src/config/prisma.js");
  const { parseSellerMarketplaceEnabled } = await import("@gigflow/shared");
  const {
    createSeller,
    createSellerOffer,
    evaluateSellerOfferEligibility,
    isSellerMarketplaceCustomerEnabled,
    pauseSellerOffer,
    recordSellerSaleFulfillment,
    setSellerStatus,
    updateSellerOffer,
    confirmSellerSettlementPayment,
    sellerPickupContext
  } = await import("../src/modules/commerce/seller.service.js");
  const { createCatalogProduct, linkCatalogProductToMerchant } = await import(
    "../src/modules/commerce/catalog.service.js"
  );
  const { createMerchant } = await import("../src/modules/commerce/merchant.service.js");
  const { AppError } = await import("../src/lib/errors.js");

  assert.equal(parseSellerMarketplaceEnabled(process.env.SELLER_MARKETPLACE_ENABLED), false);
  assert.equal(isSellerMarketplaceCustomerEnabled(), false);

  const stamp = Date.now();
  const suffix = String(stamp).slice(-7);

  await prisma.platformSetting.upsert({
    where: { id: "default" },
    create: {
      id: "default",
      marketplaceSellerCommissionRate: 0.15,
      marketplaceMerchantCommissionRate: 0.1
    },
    update: {
      marketplaceSellerCommissionRate: 0.15
    }
  });

  const catalog = await createCatalogProduct({
    name: `Seller Test Nike Air Max ${stamp}`,
    brand: "Nike",
    category: "Footwear",
    sizeLabel: "9",
    primaryImageUrl: "https://example.com/nike-air-max-test.png"
  });

  const merchant = await createMerchant({
    name: `Seller Coexist Shop ${suffix}`,
    whatsappPhone: `+1203555${suffix.slice(0, 4)}`,
    locationLabel: "Merchant Pilot",
    latitude: -17.86,
    longitude: 30.99
  });

  const merchantOfferLinked = await linkCatalogProductToMerchant(merchant.id, {
    catalogProductId: catalog.id,
    priceCents: 4500,
    available: true
  });
  const merchantOffer = await prisma.product.update({
    where: { id: merchantOfferLinked.id },
    data: { quantityApprox: 8 }
  });
  const merchantPriceBefore = merchantOffer.priceCents;
  const merchantQtyBefore = merchantOffer.quantityApprox;
  const merchantAvailableBefore = merchantOffer.available;

  const sellerA = await createSeller({
    displayName: `Test Seller A ${suffix}`,
    phone: `+1203556${suffix.slice(0, 4)}`,
    pickupLocationLabel: "Seller A Pickup",
    pickupLatitude: -17.85,
    pickupLongitude: 31.0,
    status: "ACTIVE"
  });

  const sellerB = await createSeller({
    displayName: `Test Seller B ${suffix}`,
    phone: `+1203557${suffix.slice(0, 4)}`,
    pickupLocationLabel: "Seller B Pickup",
    pickupLatitude: -17.84,
    pickupLongitude: 31.01,
    status: "ACTIVE"
  });

  const pendingSeller = await createSeller({
    displayName: `Pending Seller ${suffix}`,
    phone: `+1203558${suffix.slice(0, 4)}`,
    pickupLocationLabel: "Pending Pickup",
    pickupLatitude: -17.83,
    pickupLongitude: 31.02
  });
  assert.equal(pendingSeller.status, "PENDING");

  try {
    console.log("1) seller creation + pickup…");
    const pickup = sellerPickupContext(sellerA);
    assert.equal(pickup.pickupLocationLabel, "Seller A Pickup");
    assert.equal(pickup.pickupContactPhone, sellerA.phone);

    console.log("2) offer links existing CatalogProduct (no duplicate)…");
    const offerA = await createSellerOffer({
      sellerId: sellerA.id,
      catalogProductId: catalog.id,
      priceCents: 4000,
      quantityAvailable: 20
    });
    assert.equal(offerA.catalogProductId, catalog.id);
    assert.equal(offerA.quantityAvailable, 20);
    assert.equal(offerA.status, "ACTIVE");

    const catalogCount = await prisma.catalogProduct.count({
      where: { name: catalog.name }
    });
    assert.equal(catalogCount, 1, "must not duplicate CatalogProduct");

    console.log("3) multiple sellers same product…");
    const offerB = await createSellerOffer({
      sellerId: sellerB.id,
      catalogProductId: catalog.id,
      priceCents: 3800,
      quantityAvailable: 5
    });
    assert.equal(offerB.catalogProductId, catalog.id);
    assert.notEqual(offerA.id, offerB.id);

    const offersForCatalog = await prisma.sellerOffer.count({
      where: { catalogProductId: catalog.id }
    });
    assert.equal(offersForCatalog, 2);

    console.log("4) merchant + seller coexist; merchant unchanged…");
    const merchantReload = await prisma.product.findUniqueOrThrow({ where: { id: merchantOffer.id } });
    assert.equal(merchantReload.priceCents, merchantPriceBefore);
    assert.equal(merchantReload.quantityApprox, merchantQtyBefore);
    assert.equal(merchantReload.available, merchantAvailableBefore);

    console.log("5) eligibility ACTIVE…");
    const elig = await evaluateSellerOfferEligibility(offerA.id, 1);
    assert.equal(elig.eligible, true);

    console.log("6) inventory after simulated paid fulfillment…");
    const { offer: afterSale, settlement } = await recordSellerSaleFulfillment({
      sellerOfferId: offerA.id,
      quantity: 1,
      paymentStatusSnapshot: "PAID",
      deliveryFeeCents: 250
    });
    assert.equal(afterSale.quantityAvailable, 19);
    assert.equal(settlement.merchandiseCents, 4000);
    assert.equal(settlement.commissionCents, 600);
    assert.equal(settlement.sellerProceedsCents, 3400);
    assert.equal(settlement.deliveryFeeCents, 250);
    assert.equal(settlement.status, "READY_FOR_SETTLEMENT");

    const merchantAfterSale = await prisma.product.findUniqueOrThrow({ where: { id: merchantOffer.id } });
    assert.equal(merchantAfterSale.quantityApprox, merchantQtyBefore, "merchant stock untouched");

    console.log("7) COD settlement stays PENDING_PAYMENT…");
    const { settlement: codSettlement } = await recordSellerSaleFulfillment({
      sellerOfferId: offerA.id,
      quantity: 1,
      paymentStatusSnapshot: "DUE_ON_DELIVERY",
      deliveryFeeCents: 250
    });
    assert.equal(codSettlement.status, "PENDING_PAYMENT");
    assert.equal(codSettlement.sellerProceedsCents, 3400);
    const confirmed = await confirmSellerSettlementPayment(codSettlement.id);
    assert.equal(confirmed.status, "READY_FOR_SETTLEMENT");

    console.log("8) pause…");
    const paused = await pauseSellerOffer(offerB.id);
    assert.equal(paused.status, "PAUSED");
    const pausedElig = await evaluateSellerOfferEligibility(offerB.id, 1);
    assert.equal(pausedElig.eligible, false);
    assert.equal(pausedElig.reason, "OFFER_PAUSED");

    console.log("9) sold out…");
    const soldOutOffer = await createSellerOffer({
      sellerId: sellerA.id,
      catalogProductId: (
        await createCatalogProduct({
          name: `Seller SoldOut SKU ${stamp}`,
          category: "Footwear",
          primaryImageUrl: "https://example.com/soldout.png"
        })
      ).id,
      priceCents: 1000,
      quantityAvailable: 1
    });
    await recordSellerSaleFulfillment({
      sellerOfferId: soldOutOffer.id,
      quantity: 1,
      paymentStatusSnapshot: "PAID"
    });
    const soldOutReload = await prisma.sellerOffer.findUniqueOrThrow({ where: { id: soldOutOffer.id } });
    assert.equal(soldOutReload.quantityAvailable, 0);
    assert.equal(soldOutReload.status, "SOLD_OUT");
    const soldOutElig = await evaluateSellerOfferEligibility(soldOutOffer.id, 1);
    assert.equal(soldOutElig.eligible, false);
    assert.equal(soldOutElig.reason, "OFFER_SOLD_OUT");
    // history retained
    assert.ok(soldOutReload.id);

    console.log("10) suspension…");
    await setSellerStatus(sellerA.id, "SUSPENDED");
    const suspElig = await evaluateSellerOfferEligibility(offerA.id, 1);
    assert.equal(suspElig.eligible, false);
    assert.equal(suspElig.reason, "SELLER_NOT_ACTIVE");
    await setSellerStatus(sellerA.id, "ACTIVE");

    console.log("11) pending seller cannot fulfill…");
    const pendingOffer = await createSellerOffer({
      sellerId: pendingSeller.id,
      catalogProductId: catalog.id,
      priceCents: 3900,
      quantityAvailable: 3
    });
    const pendingElig = await evaluateSellerOfferEligibility(pendingOffer.id, 1);
    assert.equal(pendingElig.eligible, false);
    assert.equal(pendingElig.reason, "SELLER_NOT_ACTIVE");

    console.log("12) security: actorSellerId mismatch…");
    await assert.rejects(
      () => updateSellerOffer(offerA.id, { priceCents: 4100 }, { actorSellerId: sellerB.id }),
      (err: unknown) => err instanceof AppError && err.code === "SELLER_OFFER_FORBIDDEN"
    );

    console.log("13) oversell blocked…");
    await assert.rejects(
      () =>
        recordSellerSaleFulfillment({
          sellerOfferId: offerB.id,
          quantity: 1,
          paymentStatusSnapshot: "PAID"
        }),
      (err: unknown) => err instanceof AppError && err.code === "SELLER_OFFER_NOT_ELIGIBLE"
    );

    // Final merchant non-regression
    const merchantFinal = await prisma.product.findUniqueOrThrow({ where: { id: merchantOffer.id } });
    assert.equal(merchantFinal.priceCents, merchantPriceBefore);
    assert.equal(merchantFinal.quantityApprox, merchantQtyBefore);
    assert.equal(merchantFinal.available, merchantAvailableBefore);

    console.log(
      JSON.stringify(
        {
          ok: true,
          sellerMarketplaceEnabled: isSellerMarketplaceCustomerEnabled(),
          catalogProductId: catalog.id,
          sellerOffers: 2,
          merchantProductId: merchantOffer.id,
          merchantUnchanged: true
        },
        null,
        2
      )
    );
  } finally {
    await prisma.sellerSettlement.deleteMany({
      where: { sellerId: { in: [sellerA.id, sellerB.id, pendingSeller.id] } }
    });
    await prisma.sellerOffer.deleteMany({
      where: { sellerId: { in: [sellerA.id, sellerB.id, pendingSeller.id] } }
    });
    await prisma.seller.deleteMany({
      where: { id: { in: [sellerA.id, sellerB.id, pendingSeller.id] } }
    });
    // Leave catalog + merchant for shared DB hygiene similar to other tests;
    // archive merchant products created here.
    await prisma.product.updateMany({
      where: { merchantId: merchant.id },
      data: { archived: true, available: false }
    });
    await prisma.merchant.update({
      where: { id: merchant.id },
      data: { isActive: false, acceptsOrders: false }
    });
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
