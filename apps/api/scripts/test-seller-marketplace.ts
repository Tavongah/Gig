/**
 * Seller Marketplace V1 foundation.
 * Creates only stamped test rows and deletes them. Does not enable customer fulfillment.
 * Run from apps/api: npx tsx scripts/test-seller-marketplace.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseSellerMarketplaceEnabled, splitSellerMerchandiseCents } from "@gigflow/shared";
import { prisma } from "../src/config/prisma.js";
import { AppError } from "../src/lib/errors.js";
import {
  commitSellerFulfillment,
  createSeller,
  createSellerOffer,
  getSellerCommissionRate,
  listPurchasableSellerOffers,
  pauseSellerOffer,
  sellerPickupForCourier,
  setSellerCommissionRate,
  toCustomerSellerOffer,
  updateSeller,
  updateSellerOffer
} from "../src/modules/commerce/seller.service.js";

const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function assertCode(error: unknown, code: string) {
  assert.ok(error instanceof AppError, `expected AppError, got ${String(error)}`);
  assert.equal(error.code, code);
}

async function rejectsCode(fn: () => Promise<unknown>, code: string) {
  try {
    await fn();
  } catch (error) {
    assertCode(error, code);
    return;
  }
  assert.fail(`expected ${code}`);
}

async function main() {
  assert.equal(parseSellerMarketplaceEnabled(undefined), false);
  assert.equal(parseSellerMarketplaceEnabled(""), false);
  assert.equal(parseSellerMarketplaceEnabled("false"), false);
  assert.equal(parseSellerMarketplaceEnabled("true"), true);

  const forty = splitSellerMerchandiseCents(4000, 0.15);
  assert.deepEqual(forty, { merchandiseCents: 4000, commissionCents: 600, sellerProceedsCents: 3400 });
  assert.equal(forty.commissionCents + forty.sellerProceedsCents, forty.merchandiseCents);
  const tenPercent = splitSellerMerchandiseCents(4000, 0.1);
  assert.equal(tenPercent.commissionCents, 400);
  assert.equal(tenPercent.sellerProceedsCents, 3600);
  assert.throws(() => splitSellerMerchandiseCents(4000, 1.5), /INVALID_COMMISSION_RATE/);

  const untouchedSources = [
    "src/modules/commerce/order.service.ts",
    "src/modules/commerce/smart-basket.service.ts",
    "src/modules/commerce/customer-commerce.service.ts",
    "src/modules/commerce/customer-commerce.routes.ts",
    "src/modules/gigs/delivery.service.ts",
    "src/modules/whatsapp/customer-handler.ts",
    "src/modules/whatsapp/merchant-handler.ts"
  ];
  for (const relative of untouchedSources) {
    const source = readFileSync(resolve(apiRoot, relative), "utf8");
    assert.equal(source.includes("SellerOffer"), false, relative);
    assert.equal(source.includes("commitSellerFulfillment"), false, relative);
  }
  const sellerRoutes = readFileSync(resolve(apiRoot, "src/modules/commerce/seller.routes.ts"), "utf8");
  assert.ok(sellerRoutes.includes("requireRole(UserRole.ADMIN)"));
  const appSource = readFileSync(resolve(apiRoot, "src/app.ts"), "utf8");
  assert.ok(appSource.includes('app.use("/v1/admin/commerce", sellerAdminRouter)'));
  assert.equal(appSource.includes('app.use("/v1/commerce", sellerAdminRouter)'), false);

  const stamp = Date.now();
  const previousFlag = process.env.SELLER_MARKETPLACE_ENABLED;
  process.env.SELLER_MARKETPLACE_ENABLED = "false";

  const settingsBefore = await prisma.platformSetting.findUniqueOrThrow({ where: { id: "default" } });
  const merchantRateBefore = settingsBefore.marketplaceMerchantCommissionRate.toString();
  const sellerRateBefore = settingsBefore.marketplaceSellerCommissionRate.toString();

  const fingerprint = async () => {
    const [catalog, merchant, product, order, payment, gig] = await Promise.all([
      prisma.catalogProduct.findFirst({
        orderBy: { createdAt: "asc" },
        select: { id: true, status: true, name: true, updatedAt: true }
      }),
      prisma.merchant.findFirst({
        orderBy: { createdAt: "asc" },
        select: { id: true, name: true, updatedAt: true }
      }),
      prisma.product.findFirst({
        orderBy: { createdAt: "asc" },
        select: { id: true, priceCents: true, quantityApprox: true, available: true, updatedAt: true }
      }),
      prisma.commerceOrder.findFirst({
        orderBy: { createdAt: "asc" },
        select: { id: true, status: true, totalCents: true, updatedAt: true }
      }),
      prisma.commercePaymentAttempt.findFirst({
        orderBy: { createdAt: "asc" },
        select: { id: true, status: true, amountCents: true, updatedAt: true }
      }),
      prisma.gig.findFirst({
        orderBy: { createdAt: "asc" },
        select: { id: true, status: true, updatedAt: true }
      })
    ]);
    return { catalog, merchant, product, order, payment, gig };
  };
  const beforeRows = await fingerprint();
  const beforeCounts = {
    catalogs: await prisma.catalogProduct.count(),
    merchants: await prisma.merchant.count(),
    products: await prisma.product.count(),
    orders: await prisma.commerceOrder.count(),
    payments: await prisma.commercePaymentAttempt.count(),
    gigs: await prisma.gig.count()
  };

  const catalog = await prisma.catalogProduct.create({
    data: {
      name: `Seller Test Shoe ${stamp}`,
      normalizedName: `seller test shoe ${stamp}`,
      brand: "Test",
      category: "Shoes",
      sizeLabel: "9",
      status: "APPROVED",
      source: "DUTS_ADMIN"
    }
  });
  const catalogUpdatedAt = catalog.updatedAt.getTime();

  const merchant = await prisma.merchant.create({
    data: {
      name: `Seller Test Shop ${stamp}`,
      contactName: "Shop Contact",
      phone: `+26371${String(stamp).slice(-7)}`,
      whatsappPhone: `+26371${String(stamp).slice(-7)}`,
      locationLabel: "Test shop",
      latitude: -17.825,
      longitude: 31.033,
      category: "TUCK_SHOP"
    }
  });
  const merchantProduct = await prisma.product.create({
    data: {
      merchantId: merchant.id,
      catalogProductId: catalog.id,
      name: catalog.name,
      normalizedName: catalog.normalizedName,
      priceCents: 250,
      quantityApprox: 7,
      available: true
    }
  });
  const merchantProductUpdatedAt = (
    await prisma.product.findUniqueOrThrow({ where: { id: merchantProduct.id } })
  ).updatedAt.getTime();

  const sellerIds: string[] = [];

  try {
    const pending = await createSeller({
      displayName: "Test Seller",
      phone: `+26377${String(stamp).slice(-7)}`,
      whatsappPhone: `+26377${String(stamp).slice(-7)}`,
      pickupLocationLabel: "Test seller gate",
      pickupLatitude: -17.83,
      pickupLongitude: 31.05,
      pickupContactName: "Test Seller"
    });
    sellerIds.push(pending.id);
    assert.equal(pending.displayName, "Test Seller");
    assert.equal(pending.status, "PENDING");
    assert.equal(await prisma.catalogProduct.count({ where: { id: catalog.id } }), 1);

    await rejectsCode(
      () =>
        createSellerOffer(pending.id, {
          catalogProductId: catalog.id,
          priceCents: 4000,
          quantity: 20,
          status: "ACTIVE"
        }),
      "SELLER_NOT_ACTIVE"
    );
    assert.equal(await prisma.sellerOffer.count({ where: { sellerId: pending.id } }), 0);

    const paused = await createSellerOffer(pending.id, {
      catalogProductId: catalog.id,
      priceCents: 4000,
      quantity: 20
    });
    assert.equal(paused.status, "PAUSED");
    assert.equal(paused.quantity, 20);
    assert.equal(paused.priceCents, 4000);
    assert.equal(paused.catalogProductId, catalog.id);
    assert.equal(await prisma.catalogProduct.count(), beforeCounts.catalogs + 1);
    const catalogAfterLink = await prisma.catalogProduct.findUniqueOrThrow({ where: { id: catalog.id } });
    assert.equal(catalogAfterLink.updatedAt.getTime(), catalogUpdatedAt);
    assert.equal(catalogAfterLink.status, "APPROVED");
    assert.equal(catalogAfterLink.name, catalog.name);

    await rejectsCode(
      () => updateSellerOffer(pending.id, paused.id, { status: "ACTIVE" }),
      "SELLER_NOT_ACTIVE"
    );

    const activeSeller = await updateSeller(pending.id, { status: "ACTIVE" });
    assert.equal(activeSeller.status, "ACTIVE");
    const offer = await updateSellerOffer(pending.id, paused.id, { status: "ACTIVE" });
    assert.equal(offer.status, "ACTIVE");
    assert.equal(offer.quantity, 20);

    assert.deepEqual(await listPurchasableSellerOffers({ catalogProductId: catalog.id, quantity: 1 }), []);
    await rejectsCode(
      () => commitSellerFulfillment(pending.id, offer.id, { quantity: 1, paymentStatus: "PAID" }),
      "FEATURE_DISABLED"
    );
    assert.equal((await prisma.sellerOffer.findUniqueOrThrow({ where: { id: offer.id } })).quantity, 20);

    process.env.SELLER_MARKETPLACE_ENABLED = "true";
    await setSellerCommissionRate(0.15);
    const rated = await getSellerCommissionRate();
    assert.equal(rated, 0.15);
    const merchantRateMid = await prisma.platformSetting.findUniqueOrThrow({ where: { id: "default" } });
    assert.equal(merchantRateMid.marketplaceMerchantCommissionRate.toString(), merchantRateBefore);

    const hidden = await listPurchasableSellerOffers({ catalogProductId: catalog.id, quantity: 1 });
    assert.equal(hidden.length, 1);
    assert.equal("pickupLocationLabel" in hidden[0], false);
    assert.equal("phone" in hidden[0], false);
    assert.equal("whatsappPhone" in hidden[0], false);
    const customerView = toCustomerSellerOffer({
      id: offer.id,
      catalogProductId: catalog.id,
      priceCents: 4000,
      currency: "usd",
      quantity: 20,
      status: "ACTIVE"
    });
    assert.deepEqual(Object.keys(customerView).sort(), [
      "catalogProductId",
      "currency",
      "offerId",
      "priceCents",
      "quantity",
      "status"
    ]);
    const pickup = await sellerPickupForCourier(pending.id);
    assert.equal(pickup.pickupLocationLabel, "Test seller gate");
    assert.ok(pickup.pickupContactPhone.startsWith("+"));

    const sold = await commitSellerFulfillment(pending.id, offer.id, {
      quantity: 1,
      paymentStatus: "PAID",
      deliveryFeeCents: 250,
      reference: `test-${stamp}`
    });
    assert.equal(sold.offer.quantity, 19);
    assert.equal(sold.offer.status, "ACTIVE");
    assert.equal(sold.entry.merchandiseCents, 4000);
    assert.equal(sold.entry.commissionCents, 600);
    assert.equal(sold.entry.sellerProceedsCents, 3400);
    assert.equal(sold.entry.deliveryFeeCents, 250);
    assert.equal(sold.entry.commissionCents + sold.entry.sellerProceedsCents, sold.entry.merchandiseCents);
    assert.equal(sold.entry.settlementStatus, "ACCRUED");
    assert.equal(sold.entry.paymentStatus, "PAID");
    assert.equal(sold.entry.kind, "SALE");
    assert.notEqual(sold.entry.sellerProceedsCents, 4000);
    assert.equal(await prisma.commerceOrder.count(), beforeCounts.orders);

    await setSellerCommissionRate(0.1);
    const second = await commitSellerFulfillment(pending.id, offer.id, {
      quantity: 1,
      paymentStatus: "PAID",
      deliveryFeeCents: 250
    });
    assert.equal(second.offer.quantity, 18);
    assert.equal(second.entry.commissionCents, 400);
    assert.equal(second.entry.sellerProceedsCents, 3600);
    assert.equal(second.entry.deliveryFeeCents, 250);

    const cod = await commitSellerFulfillment(pending.id, offer.id, {
      quantity: 1,
      paymentStatus: "DUE_ON_DELIVERY",
      deliveryFeeCents: 250
    });
    assert.equal(cod.offer.quantity, 17);
    assert.equal(cod.entry.settlementStatus, "AWAITING_COLLECTION");
    assert.equal(cod.entry.sellerProceedsCents, 3600);
    assert.notEqual(cod.entry.settlementStatus, "ACCRUED");

    await rejectsCode(
      () => commitSellerFulfillment(pending.id, offer.id, { quantity: 100, paymentStatus: "PAID" }),
      "INSUFFICIENT_QUANTITY"
    );
    assert.equal((await prisma.sellerOffer.findUniqueOrThrow({ where: { id: offer.id } })).quantity, 17);

    const pausedOffer = await pauseSellerOffer(pending.id, offer.id);
    assert.equal(pausedOffer.status, "PAUSED");
    await rejectsCode(
      () => commitSellerFulfillment(pending.id, offer.id, { quantity: 1, paymentStatus: "PAID" }),
      "OFFER_NOT_ELIGIBLE"
    );
    assert.equal((await prisma.sellerOffer.findUniqueOrThrow({ where: { id: offer.id } })).quantity, 17);
    assert.deepEqual(await listPurchasableSellerOffers({ catalogProductId: catalog.id, quantity: 1 }), []);

    const reactivated = await updateSellerOffer(pending.id, offer.id, { status: "ACTIVE" });
    assert.equal(reactivated.status, "ACTIVE");
    const drained = await updateSellerOffer(pending.id, offer.id, { quantity: 0 });
    assert.equal(drained.quantity, 0);
    assert.equal(drained.status, "SOLD_OUT");
    const stillThere = await prisma.sellerOffer.findUnique({ where: { id: offer.id } });
    assert.ok(stillThere);
    await rejectsCode(
      () => commitSellerFulfillment(pending.id, offer.id, { quantity: 1, paymentStatus: "PAID" }),
      "OFFER_NOT_ELIGIBLE"
    );
    const restocked = await updateSellerOffer(pending.id, offer.id, { quantity: 2 });
    assert.equal(restocked.status, "PAUSED");
    assert.equal(restocked.quantity, 2);
    await updateSellerOffer(pending.id, offer.id, { status: "ACTIVE" });

    const ledgerBeforeSuspend = await prisma.sellerLedgerEntry.count({ where: { sellerId: pending.id } });
    assert.ok(ledgerBeforeSuspend >= 3);
    await updateSeller(pending.id, { status: "SUSPENDED" });
    await rejectsCode(
      () => commitSellerFulfillment(pending.id, offer.id, { quantity: 1, paymentStatus: "PAID" }),
      "SELLER_NOT_ACTIVE"
    );
    assert.equal(await prisma.sellerLedgerEntry.count({ where: { sellerId: pending.id } }), ledgerBeforeSuspend);
    assert.equal((await prisma.sellerOffer.findUniqueOrThrow({ where: { id: offer.id } })).quantity, 2);
    assert.deepEqual(await listPurchasableSellerOffers({ catalogProductId: catalog.id, quantity: 1 }), []);

    const sellerB = await createSeller({
      displayName: "Test Seller B",
      phone: `+26378${String(stamp).slice(-7)}`,
      whatsappPhone: `+26378${String(stamp).slice(-7)}`,
      pickupLocationLabel: "Second gate",
      pickupLatitude: -17.84,
      pickupLongitude: 31.06,
      pickupContactName: "Seller B",
      status: "ACTIVE"
    });
    sellerIds.push(sellerB.id);
    const offerB = await createSellerOffer(sellerB.id, {
      catalogProductId: catalog.id,
      priceCents: 3800,
      quantity: 5,
      status: "ACTIVE"
    });
    assert.equal(offerB.priceCents, 3800);
    assert.equal(offerB.quantity, 5);
    assert.equal(offerB.catalogProductId, catalog.id);
    assert.equal(await prisma.catalogProduct.count({ where: { normalizedName: catalog.normalizedName } }), 1);
    assert.equal(await prisma.sellerOffer.count({ where: { catalogProductId: catalog.id } }), 2);

    await rejectsCode(
      () => updateSellerOffer(sellerB.id, offer.id, { priceCents: 100 }),
      "SELLER_OFFER_NOT_FOUND"
    );
    assert.equal((await prisma.sellerOffer.findUniqueOrThrow({ where: { id: offer.id } })).priceCents, 4000);

    await rejectsCode(
      () =>
        createSellerOffer(sellerB.id, {
          catalogProductId: catalog.id,
          priceCents: 3800,
          quantity: 1
        }),
      "SELLER_OFFER_EXISTS"
    );

    const raceSeller = await createSeller({
      displayName: "Test Seller Race",
      phone: `+26379${String(stamp).slice(-7)}`,
      pickupLocationLabel: "Race gate",
      pickupLatitude: -17.85,
      pickupLongitude: 31.07,
      pickupContactName: "Race",
      status: "ACTIVE"
    });
    sellerIds.push(raceSeller.id);
    const raceOffer = await createSellerOffer(raceSeller.id, {
      catalogProductId: catalog.id,
      priceCents: 4000,
      quantity: 1,
      status: "ACTIVE"
    });
    const raced = await Promise.allSettled([
      commitSellerFulfillment(raceSeller.id, raceOffer.id, { quantity: 1, paymentStatus: "PAID", deliveryFeeCents: 100 }),
      commitSellerFulfillment(raceSeller.id, raceOffer.id, { quantity: 1, paymentStatus: "PAID", deliveryFeeCents: 100 })
    ]);
    const fulfilled = raced.filter((row) => row.status === "fulfilled");
    const rejected = raced.filter((row) => row.status === "rejected");
    assert.equal(fulfilled.length, 1);
    assert.equal(rejected.length, 1);
    const raceError = (rejected[0] as PromiseRejectedResult).reason;
    assert.ok(raceError instanceof AppError);
    assert.ok(raceError.code === "INSUFFICIENT_QUANTITY" || raceError.code === "OFFER_NOT_ELIGIBLE");
    const raceSaved = await prisma.sellerOffer.findUniqueOrThrow({ where: { id: raceOffer.id } });
    assert.equal(raceSaved.quantity, 0);
    assert.equal(raceSaved.status, "SOLD_OUT");
    assert.ok(raceSaved.quantity >= 0);
    assert.equal(await prisma.sellerLedgerEntry.count({ where: { sellerOfferId: raceOffer.id } }), 1);

    const shop = await prisma.product.findUniqueOrThrow({ where: { id: merchantProduct.id } });
    assert.equal(shop.priceCents, 250);
    assert.equal(shop.quantityApprox, 7);
    assert.equal(shop.available, true);
    assert.equal(shop.catalogProductId, catalog.id);
    assert.equal(shop.updatedAt.getTime(), merchantProductUpdatedAt);
    assert.equal(shop.merchantId, merchant.id);

    const catalogFinal = await prisma.catalogProduct.findUniqueOrThrow({ where: { id: catalog.id } });
    assert.equal(catalogFinal.status, "APPROVED");
    assert.equal(catalogFinal.updatedAt.getTime(), catalogUpdatedAt);
    assert.equal(await prisma.commerceOrder.count(), beforeCounts.orders);
    assert.equal(await prisma.commercePaymentAttempt.count(), beforeCounts.payments);
    assert.equal(await prisma.gig.count(), beforeCounts.gigs);

    console.log(
      JSON.stringify(
        {
          ok: true,
          sellerId: pending.id,
          catalogProductId: catalog.id,
          quantityAfterFirstSale: 19,
          offersForCatalog: 2,
          merchantProductUnchanged: true
        },
        null,
        2
      )
    );
  } finally {
    process.env.SELLER_MARKETPLACE_ENABLED = previousFlag;
    const rateNow = await prisma.platformSetting.findUniqueOrThrow({ where: { id: "default" } });
    if (rateNow.marketplaceSellerCommissionRate.toString() !== sellerRateBefore) {
      await prisma.platformSetting.update({
        where: { id: "default" },
        data: { marketplaceSellerCommissionRate: sellerRateBefore }
      });
    }
    if (sellerIds.length) {
      await prisma.sellerLedgerEntry.deleteMany({ where: { sellerId: { in: sellerIds } } });
      await prisma.sellerOffer.deleteMany({ where: { sellerId: { in: sellerIds } } });
      await prisma.seller.deleteMany({ where: { id: { in: sellerIds } } });
    }
    await prisma.product.deleteMany({ where: { id: merchantProduct.id } });
    await prisma.merchant.deleteMany({ where: { id: merchant.id } });
    await prisma.catalogProduct.deleteMany({ where: { id: catalog.id } });

    const restored = await prisma.platformSetting.findUniqueOrThrow({ where: { id: "default" } });
    assert.equal(restored.marketplaceMerchantCommissionRate.toString(), merchantRateBefore);
    assert.equal(restored.marketplaceSellerCommissionRate.toString(), sellerRateBefore);
    assert.equal(await prisma.catalogProduct.count(), beforeCounts.catalogs);
    assert.equal(await prisma.merchant.count(), beforeCounts.merchants);
    assert.equal(await prisma.product.count(), beforeCounts.products);
    assert.equal(await prisma.commerceOrder.count(), beforeCounts.orders);
    assert.deepEqual(await fingerprint(), beforeRows);

    await prisma.$disconnect();
  }
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
