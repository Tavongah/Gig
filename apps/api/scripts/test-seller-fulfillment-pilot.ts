/**
 * Seller fulfillment pilot.
 * Flag stays off except inside this process. Creates only stamped rows and deletes them.
 * Run from apps/api: npx tsx scripts/test-seller-fulfillment-pilot.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseSellerMarketplaceEnabled } from "@gigflow/shared";
import { prisma } from "../src/config/prisma.js";
import { AppError } from "../src/lib/errors.js";
import { createConfirmedCommerceOrder } from "../src/modules/commerce/order.service.js";
import {
  cancelSellerFulfillment,
  completeSellerFulfillment,
  confirmSellerCodCollection,
  confirmSellerFulfillmentPayment,
  createSellerFulfillment,
  failSellerFulfillmentPayment,
  getSellerFulfillment,
  linkSellerFulfillmentDelivery,
  markSellerFulfillmentNeedsAttention,
  toCustomerSellerFulfillment
} from "../src/modules/commerce/seller-fulfillment.service.js";
import {
  createSeller,
  createSellerOffer,
  listPurchasableSellerOffers,
  pauseSellerOffer,
  setSellerCommissionRate,
  updateSeller,
  updateSellerOffer
} from "../src/modules/commerce/seller.service.js";

const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function assertCode(error: unknown, code: string) {
  assert.ok(error instanceof AppError, `expected AppError ${code}, got ${String(error)}`);
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
  assert.equal(parseSellerMarketplaceEnabled("false"), false);

  const locked = [
    "src/modules/commerce/order.service.ts",
    "src/modules/commerce/smart-basket.service.ts",
    "src/modules/commerce/customer-commerce.service.ts",
    "src/modules/commerce/customer-commerce.routes.ts",
    "src/modules/gigs/delivery.service.ts",
    "src/modules/gigs/gig.service.ts",
    "src/modules/whatsapp/customer-handler.ts",
    "src/modules/whatsapp/merchant-handler.ts",
    "src/modules/commerce/payment-mode.ts",
    "src/modules/commerce/payments/paynow.provider.ts",
    "src/modules/commerce/payments/payment.service.ts",
    "src/modules/commerce/payments/ecocash.provider.ts",
    "src/modules/commerce/payments/zb.provider.ts"
  ];
  for (const relative of locked) {
    const source = readFileSync(resolve(apiRoot, relative), "utf8");
    assert.equal(source.includes("SellerFulfillment"), false, relative);
    assert.equal(source.includes("seller-fulfillment"), false, relative);
  }
  const routes = readFileSync(resolve(apiRoot, "src/modules/commerce/seller.routes.ts"), "utf8");
  assert.ok(routes.includes("requireRole(UserRole.ADMIN)"));
  assert.ok(routes.includes("/fulfillments"));
  assert.ok(routes.includes("link-delivery"));
  const appSource = readFileSync(resolve(apiRoot, "src/app.ts"), "utf8");
  assert.equal(appSource.includes('app.use("/v1/commerce", sellerAdminRouter)'), false);

  const stamp = Date.now();
  const phone = (prefix: string) => `+263${prefix}${String(stamp).slice(-7)}`;
  const previousFlag = process.env.SELLER_MARKETPLACE_ENABLED;
  process.env.SELLER_MARKETPLACE_ENABLED = "false";

  const settingsBefore = await prisma.platformSetting.findUniqueOrThrow({ where: { id: "default" } });
  const merchantRateBefore = settingsBefore.marketplaceMerchantCommissionRate.toString();
  const sellerRateBefore = settingsBefore.marketplaceSellerCommissionRate.toString();

  const catalog = await prisma.catalogProduct.create({
    data: {
      name: `Pilot Shoe ${stamp}`,
      normalizedName: `pilot shoe ${stamp}`,
      brand: "Test",
      category: "Shoes",
      sizeLabel: "9",
      status: "APPROVED",
      source: "DUTS_ADMIN"
    }
  });
  const raceCatalog = await prisma.catalogProduct.create({
    data: {
      name: `Pilot Race Shoe ${stamp}`,
      normalizedName: `pilot race shoe ${stamp}`,
      brand: "Test",
      category: "Shoes",
      sizeLabel: "8",
      status: "APPROVED",
      source: "DUTS_ADMIN"
    }
  });
  const merchant = await prisma.merchant.create({
    data: {
      name: `Pilot Shop ${stamp}`,
      contactName: "Shop Contact",
      phone: phone("71"),
      whatsappPhone: phone("71"),
      locationLabel: "Pilot shop",
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

  const user = await prisma.user.create({
    data: {
      email: `pilot-seller-${stamp}@duts.local`,
      fullName: "Pilot Ops",
      phoneNumber: phone("78"),
      phoneVerified: true,
      emailVerified: true,
      profileCompleted: true,
      roles: ["ADMIN"],
      defaultRole: "ADMIN",
      accountStatus: "ACTIVE",
      country: "ZW",
      city: "Harare",
      region: "Harare"
    }
  });

  const sellerIds = [user.id];
  const dropoff = {
    dropoffLabel: "Pilot customer gate",
    dropoffLatitude: -17.831,
    dropoffLongitude: 31.055,
    dropoffContactName: "Pilot Customer",
    dropoffContactPhone: phone("73")
  };

  async function shopUnchanged() {
    const shop = await prisma.product.findUniqueOrThrow({ where: { id: merchantProduct.id } });
    assert.equal(shop.priceCents, 250);
    assert.equal(shop.quantityApprox, 7);
    assert.equal(shop.available, true);
    assert.equal(shop.updatedAt.getTime(), merchantProductUpdatedAt);
    assert.equal(shop.merchantId, merchant.id);
    assert.equal(shop.catalogProductId, catalog.id);
  }

  async function merchantPurchase() {
    const beforeOrders = await prisma.commerceOrder.count();
    const order = await createConfirmedCommerceOrder({
      customerId: user.id,
      merchantId: merchant.id,
      lines: [
        {
          productId: merchantProduct.id,
          productName: merchantProduct.name,
          quantity: 1,
          unitPriceCents: 250,
          lineTotalCents: 250,
          merchantId: merchant.id
        }
      ],
      deliveryLabel: "Pilot customer gate",
      deliveryLatitude: -17.826,
      deliveryLongitude: 31.034,
      paymentMethod: "CASH"
    });
    assert.equal(order.merchantId, merchant.id);
    assert.equal(order.paymentStatus, "DUE_ON_DELIVERY");
    assert.equal(order.items[0]?.productId, merchantProduct.id);
    assert.equal(await prisma.commerceOrder.count(), beforeOrders + 1);
    await shopUnchanged();
    await prisma.commerceOrder.delete({ where: { id: order.id } });
    await prisma.commerceCustomer.deleteMany({ where: { userId: user.id } });
    assert.equal(await prisma.commerceOrder.count(), beforeOrders);
  }

  try {
    await rejectsCode(
      () =>
        createSellerFulfillment("00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002", {
          quantity: 1,
          paymentMethod: "PREPAID",
          ...dropoff
        }),
      "FEATURE_DISABLED"
    );
    assert.deepEqual(await listPurchasableSellerOffers({ catalogProductId: catalog.id, quantity: 1 }), []);
    await merchantPurchase();

    const seller = await createSeller({
      displayName: "Pilot Seller",
      phone: phone("77"),
      pickupLocationLabel: "Pilot seller gate",
      pickupLatitude: -17.829,
      pickupLongitude: 31.053,
      pickupContactName: "Pilot Seller",
      status: "ACTIVE"
    });
    sellerIds.push(seller.id);
    const offer = await createSellerOffer(seller.id, {
      catalogProductId: catalog.id,
      priceCents: 4000,
      quantity: 20,
      status: "ACTIVE"
    });
    assert.equal(offer.status, "ACTIVE");
    assert.equal(offer.quantity, 20);
    assert.equal(offer.catalogProductId, catalog.id);

    process.env.SELLER_MARKETPLACE_ENABLED = "false";
    await rejectsCode(
      () =>
        createSellerFulfillment(seller.id, offer.id, {
          quantity: 1,
          paymentMethod: "PREPAID",
          idempotencyKey: `pilot-off-${stamp}`,
          ...dropoff
        }),
      "FEATURE_DISABLED"
    );
    assert.equal((await prisma.sellerOffer.findUniqueOrThrow({ where: { id: offer.id } })).quantity, 20);
    assert.equal((await prisma.sellerOffer.findUniqueOrThrow({ where: { id: offer.id } })).reservedQuantity, 0);

    process.env.SELLER_MARKETPLACE_ENABLED = "true";
    await setSellerCommissionRate(0.15);

    const key = `pilot-pay-${stamp}`;
    const created = await createSellerFulfillment(seller.id, offer.id, {
      quantity: 1,
      paymentMethod: "PREPAID",
      idempotencyKey: key,
      ...dropoff
    });
    const replay = await createSellerFulfillment(seller.id, offer.id, {
      quantity: 1,
      paymentMethod: "PREPAID",
      idempotencyKey: key,
      ...dropoff
    });
    assert.equal(replay.id, created.id);
    const reserved = await prisma.sellerOffer.findUniqueOrThrow({ where: { id: offer.id } });
    assert.equal(reserved.quantity, 20);
    assert.equal(reserved.reservedQuantity, 1);
    assert.equal(await prisma.sellerLedgerEntry.count({ where: { sellerOfferId: offer.id } }), 0);
    assert.equal(created.sellerOfferId, offer.id);
    assert.equal(created.catalogProductId, catalog.id);
    assert.equal(created.productNameSnapshot, catalog.name);
    assert.equal(created.unitPriceCents, 4000);
    assert.equal(created.quantity, 1);
    assert.equal(created.sellerId, seller.id);
    assert.equal(created.commissionRate, 0.15);
    assert.equal(created.commissionCents, 600);
    assert.equal(created.sellerProceedsCents, 3400);
    assert.equal(created.paymentStatus, "PENDING");
    assert.equal(created.status, "PAYMENT_PENDING");
    assert.equal(created.customerView.pickupLabel, undefined);
    assert.equal("phone" in created.customerView, false);
    assert.equal("commissionCents" in created.customerView, false);
    assert.deepEqual(Object.keys(toCustomerSellerFulfillment(created)).sort(), [
      "catalogProductId",
      "currency",
      "deliveryFeeCents",
      "fulfillmentId",
      "merchandiseCents",
      "paymentStatus",
      "productName",
      "quantity",
      "status",
      "unitPriceCents"
    ]);
    assert.equal(created.pickupLabel, "Pilot seller gate");
    await shopUnchanged();

    const paid = await confirmSellerFulfillmentPayment(created.id, { paymentReference: `ref-${stamp}` });
    assert.equal(paid.paymentStatus, "PAID");
    assert.equal(paid.status, "READY_FOR_PICKUP");
    assert.equal(await prisma.sellerLedgerEntry.count({ where: { sellerFulfillmentId: created.id } }), 0);
    const paidAgain = await confirmSellerFulfillmentPayment(created.id, { paymentReference: `ref-${stamp}` });
    assert.equal(paidAgain.id, created.id);
    assert.equal(paidAgain.paymentStatus, "PAID");
    const afterPay = await prisma.sellerOffer.findUniqueOrThrow({ where: { id: offer.id } });
    assert.equal(afterPay.quantity, 20);
    assert.equal(afterPay.reservedQuantity, 1);

    await rejectsCode(() => completeSellerFulfillment(created.id), "DELIVERY_NOT_LINKED");
    const linked = await linkSellerFulfillmentDelivery(created.id, user.id);
    const linkedAgain = await linkSellerFulfillmentDelivery(created.id, user.id);
    assert.equal(linkedAgain.delivery.gigId, linked.delivery.gigId);
    const gig = await prisma.gig.findUniqueOrThrow({
      where: { id: linked.delivery.gigId! },
      include: { commerceOrder: true }
    });
    assert.equal(gig.commerceOrder, null);
    assert.equal(gig.formattedAddress, "Pilot seller gate");
    assert.equal(gig.pickupContactName, "Pilot Seller");
    assert.equal(gig.pickupContactPhone, seller.phone);
    assert.equal(Number(gig.latitude), -17.829);
    assert.equal(Number(gig.longitude), 31.053);
    assert.equal(gig.dropoffFormattedAddress, "Pilot customer gate");
    assert.ok(gig.packageDescription?.includes(catalog.name));
    assert.ok(gig.packageDescription?.includes("1×"));
    assert.ok(gig.pickupPin && gig.pickupPin.length > 8);
    assert.ok(gig.deliveryPin && gig.deliveryPin.length > 8);
    assert.ok(!/^\d{4}$/.test(gig.pickupPin));
    assert.equal(linked.fulfillment.deliveryFeeCents, gig.totalCents);
    assert.ok(gig.totalCents > 0);
    assert.equal(linked.fulfillment.sellerProceedsCents, 3400);
    assert.equal(linked.fulfillment.commissionCents + linked.fulfillment.sellerProceedsCents, 4000);

    await setSellerCommissionRate(0.18);
    await rejectsCode(() => completeSellerFulfillment(created.id), "DELIVERY_NOT_COMPLETE");
    await prisma.gig.update({
      where: { id: gig.id },
      data: { status: "COMPLETED", deliveryVerifiedAt: new Date() }
    });
    const done = await completeSellerFulfillment(created.id);
    assert.equal(done.status, "DELIVERED");
    assert.equal(done.settlementStatus, "ACCRUED");
    assert.equal(done.commissionRate, 0.15);
    assert.equal(done.commissionCents, 600);
    assert.equal(done.sellerProceedsCents, 3400);
    assert.equal(done.deliveryFeeCents, gig.totalCents);
    const offerAfter = await prisma.sellerOffer.findUniqueOrThrow({ where: { id: offer.id } });
    assert.equal(offerAfter.quantity, 19);
    assert.equal(offerAfter.reservedQuantity, 0);
    assert.equal(offerAfter.status, "ACTIVE");
    const ledger = await prisma.sellerLedgerEntry.findMany({ where: { sellerFulfillmentId: created.id } });
    assert.equal(ledger.length, 1);
    assert.equal(Number(ledger[0]?.commissionRate), 0.15);
    assert.equal(ledger[0]?.commissionCents, 600);
    assert.equal(ledger[0]?.sellerProceedsCents, 3400);
    assert.equal(ledger[0]?.deliveryFeeCents, gig.totalCents);
    assert.equal(ledger[0]?.settlementStatus, "ACCRUED");
    assert.equal(ledger[0]?.sellerProceedsCents + ledger[0]?.commissionCents, ledger[0]?.merchandiseCents);

    const doneAgain = await completeSellerFulfillment(created.id);
    assert.equal(doneAgain.id, created.id);
    assert.equal((await prisma.sellerOffer.findUniqueOrThrow({ where: { id: offer.id } })).quantity, 19);
    assert.equal(await prisma.sellerLedgerEntry.count({ where: { sellerFulfillmentId: created.id } }), 1);
    await confirmSellerFulfillmentPayment(created.id, { paymentReference: `ref-${stamp}-again` });
    assert.equal(await prisma.sellerLedgerEntry.count({ where: { sellerOfferId: offer.id } }), 1);

    await setSellerCommissionRate(0.15);
    const failed = await createSellerFulfillment(seller.id, offer.id, {
      quantity: 1,
      paymentMethod: "PREPAID",
      idempotencyKey: `pilot-fail-${stamp}`,
      ...dropoff
    });
    assert.equal((await prisma.sellerOffer.findUniqueOrThrow({ where: { id: offer.id } })).reservedQuantity, 1);
    const failedRow = await failSellerFulfillmentPayment(failed.id);
    assert.equal(failedRow.status, "PAYMENT_FAILED");
    assert.equal(failedRow.paymentStatus, "PAYMENT_FAILED");
    const released = await prisma.sellerOffer.findUniqueOrThrow({ where: { id: offer.id } });
    assert.equal(released.quantity, 19);
    assert.equal(released.reservedQuantity, 0);
    assert.equal(await prisma.sellerLedgerEntry.count({ where: { sellerFulfillmentId: failed.id } }), 0);
    const failedAgain = await failSellerFulfillmentPayment(failed.id);
    assert.equal(failedAgain.status, "PAYMENT_FAILED");
    assert.equal((await prisma.sellerOffer.findUniqueOrThrow({ where: { id: offer.id } })).reservedQuantity, 0);

    const cod = await createSellerFulfillment(seller.id, offer.id, {
      quantity: 1,
      paymentMethod: "CASH",
      idempotencyKey: `pilot-cod-${stamp}`,
      ...dropoff
    });
    assert.equal(cod.paymentStatus, "DUE_ON_DELIVERY");
    assert.equal(cod.status, "READY_FOR_PICKUP");
    assert.equal(await prisma.sellerLedgerEntry.count({ where: { sellerFulfillmentId: cod.id } }), 0);
    const codLink = await linkSellerFulfillmentDelivery(cod.id, user.id);
    await prisma.gig.update({
      where: { id: codLink.delivery.gigId! },
      data: { status: "COMPLETED", deliveryVerifiedAt: new Date() }
    });
    const codDone = await completeSellerFulfillment(cod.id);
    assert.equal(codDone.paymentStatus, "DUE_ON_DELIVERY");
    assert.equal(codDone.settlementStatus, "AWAITING_COLLECTION");
    assert.equal((await prisma.sellerOffer.findUniqueOrThrow({ where: { id: offer.id } })).quantity, 18);
    await completeSellerFulfillment(cod.id);
    assert.equal((await prisma.sellerOffer.findUniqueOrThrow({ where: { id: offer.id } })).quantity, 18);
    assert.equal(await prisma.sellerLedgerEntry.count({ where: { sellerFulfillmentId: cod.id } }), 1);
    const collected = await confirmSellerCodCollection(cod.id);
    assert.equal(collected.paymentStatus, "PAID");
    assert.equal(collected.settlementStatus, "ACCRUED");
    const collectedAgain = await confirmSellerCodCollection(cod.id);
    assert.equal(collectedAgain.settlementStatus, "ACCRUED");
    assert.equal((await prisma.sellerOffer.findUniqueOrThrow({ where: { id: offer.id } })).quantity, 18);
    assert.equal(await prisma.sellerLedgerEntry.count({ where: { sellerFulfillmentId: cod.id } }), 1);

    const cancel = await createSellerFulfillment(seller.id, offer.id, {
      quantity: 1,
      paymentMethod: "CASH",
      idempotencyKey: `pilot-cancel-${stamp}`,
      ...dropoff
    });
    const cancelled = await cancelSellerFulfillment(cancel.id);
    assert.equal(cancelled.status, "CANCELLED");
    assert.equal((await prisma.sellerOffer.findUniqueOrThrow({ where: { id: offer.id } })).reservedQuantity, 0);
    assert.equal(await prisma.sellerLedgerEntry.count({ where: { sellerFulfillmentId: cancel.id } }), 0);

    const attention = await createSellerFulfillment(seller.id, offer.id, {
      quantity: 1,
      paymentMethod: "CASH",
      idempotencyKey: `pilot-attention-${stamp}`,
      ...dropoff
    });
    const held = await markSellerFulfillmentNeedsAttention(attention.id, {
      reason: "Seller cannot provide this item."
    });
    assert.equal(held.status, "NEEDS_ATTENTION");
    assert.equal((await prisma.sellerOffer.findUniqueOrThrow({ where: { id: offer.id } })).reservedQuantity, 0);
    assert.equal(await prisma.sellerFulfillment.count({ where: { sellerOfferId: offer.id, status: "NEEDS_ATTENTION" } }), 1);

    const raceOffer = await createSellerOffer(seller.id, {
      catalogProductId: raceCatalog.id,
      priceCents: 4000,
      quantity: 1,
      status: "ACTIVE"
    });
    const raced = await Promise.allSettled([
      createSellerFulfillment(seller.id, raceOffer.id, {
        quantity: 1,
        paymentMethod: "PREPAID",
        idempotencyKey: `pilot-race-a-${stamp}`,
        ...dropoff
      }),
      createSellerFulfillment(seller.id, raceOffer.id, {
        quantity: 1,
        paymentMethod: "PREPAID",
        idempotencyKey: `pilot-race-b-${stamp}`,
        ...dropoff
      })
    ]);
    const raceWins = raced.filter((row) => row.status === "fulfilled");
    const raceLosses = raced.filter((row) => row.status === "rejected");
    assert.equal(raceWins.length, 1);
    assert.equal(raceLosses.length, 1);
    const raceError = (raceLosses[0] as PromiseRejectedResult).reason;
    assert.ok(raceError instanceof AppError);
    assert.equal(raceError.code, "INSUFFICIENT_QUANTITY");
    const raceSaved = await prisma.sellerOffer.findUniqueOrThrow({ where: { id: raceOffer.id } });
    assert.equal(raceSaved.quantity, 1);
    assert.equal(raceSaved.reservedQuantity, 1);
    assert.ok(raceSaved.quantity >= 0);
    assert.ok(raceSaved.reservedQuantity >= 0);
    assert.ok(raceSaved.reservedQuantity <= raceSaved.quantity);
    assert.equal(await prisma.sellerLedgerEntry.count({ where: { sellerOfferId: raceOffer.id } }), 0);

    const historyId = created.id;
    await updateSeller(seller.id, { status: "SUSPENDED" });
    await rejectsCode(
      () =>
        createSellerFulfillment(seller.id, offer.id, {
          quantity: 1,
          paymentMethod: "PREPAID",
          idempotencyKey: `pilot-suspended-${stamp}`,
          ...dropoff
        }),
      "SELLER_NOT_ACTIVE"
    );
    const history = await getSellerFulfillment(historyId);
    assert.equal(history.id, historyId);
    assert.equal(history.status, "DELIVERED");
    await updateSeller(seller.id, { status: "ACTIVE" });

    await pauseSellerOffer(seller.id, offer.id);
    await rejectsCode(
      () =>
        createSellerFulfillment(seller.id, offer.id, {
          quantity: 1,
          paymentMethod: "PREPAID",
          idempotencyKey: `pilot-paused-${stamp}`,
          ...dropoff
        }),
      "OFFER_NOT_ELIGIBLE"
    );
    await updateSellerOffer(seller.id, offer.id, { status: "ACTIVE" });

    const soldOut = await updateSellerOffer(seller.id, offer.id, { quantity: 0 });
    assert.equal(soldOut.status, "SOLD_OUT");
    assert.equal(soldOut.quantity, 0);
    await rejectsCode(
      () =>
        createSellerFulfillment(seller.id, offer.id, {
          quantity: 1,
          paymentMethod: "PREPAID",
          idempotencyKey: `pilot-soldout-${stamp}`,
          ...dropoff
        }),
      "OFFER_NOT_ELIGIBLE"
    );
    assert.equal((await prisma.sellerOffer.findUniqueOrThrow({ where: { id: offer.id } })).quantity, 0);

    process.env.SELLER_MARKETPLACE_ENABLED = "true";
    await merchantPurchase();
    await shopUnchanged();
    const merchantRow = await prisma.merchant.findUniqueOrThrow({ where: { id: merchant.id } });
    assert.equal(merchantRow.name, `Pilot Shop ${stamp}`);
    assert.equal(await prisma.catalogProduct.count({ where: { normalizedName: catalog.normalizedName } }), 1);

    const listed = await listPurchasableSellerOffers({ catalogProductId: catalog.id, quantity: 1 });
    assert.equal(listed.length, 0);

    console.log(
      JSON.stringify(
        {
          ok: true,
          quantityAfterPrepaid: 19,
          quantityAfterCod: 18,
          commissionSnapshot: 0.15,
          sellerProceedsCents: 3400,
          deliveryFeeSeparate: true,
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
    const realSellerIds = sellerIds.filter((id) => id !== user.id);
    if (realSellerIds.length) {
      await prisma.sellerLedgerEntry.deleteMany({ where: { sellerId: { in: realSellerIds } } });
      await prisma.sellerFulfillment.updateMany({
        where: { sellerId: { in: realSellerIds } },
        data: { linkedDeliveryGigId: null }
      });
      await prisma.gig.deleteMany({ where: { clientId: user.id } });
      await prisma.sellerFulfillment.deleteMany({ where: { sellerId: { in: realSellerIds } } });
      await prisma.sellerOffer.deleteMany({ where: { sellerId: { in: realSellerIds } } });
      await prisma.seller.deleteMany({ where: { id: { in: realSellerIds } } });
    } else {
      await prisma.gig.deleteMany({ where: { clientId: user.id } });
    }
    await prisma.commerceOrder.deleteMany({ where: { merchantId: merchant.id } });
    await prisma.commerceCustomer.deleteMany({ where: { userId: user.id } });
    await prisma.product.deleteMany({ where: { id: merchantProduct.id } });
    await prisma.merchant.deleteMany({ where: { id: merchant.id } });
    await prisma.catalogProduct.deleteMany({ where: { id: { in: [catalog.id, raceCatalog.id] } } });
    await prisma.user.delete({ where: { id: user.id } });

    const restored = await prisma.platformSetting.findUniqueOrThrow({ where: { id: "default" } });
    assert.equal(restored.marketplaceMerchantCommissionRate.toString(), merchantRateBefore);
    assert.equal(restored.marketplaceSellerCommissionRate.toString(), sellerRateBefore);
    await prisma.$disconnect();
  }
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
