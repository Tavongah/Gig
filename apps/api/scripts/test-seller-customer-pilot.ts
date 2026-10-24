/**
 * Controlled customer seller purchase.
 * The global flag stays off except inside this process. Rows created here are deleted.
 * Run from apps/api: npx tsx scripts/test-seller-customer-pilot.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  merchantCartBlockedBySellerPilot,
  planSellerPilotCartAdd
} from "@gigflow/shared";
import { prisma } from "../src/config/prisma.js";
import { AppError } from "../src/lib/errors.js";
import { createConfirmedCommerceOrder } from "../src/modules/commerce/order.service.js";
import { applyProviderPaymentResult } from "../src/modules/commerce/payments/payment.service.js";
import { simulateMockPaymentOutcome } from "../src/modules/commerce/payments/mock.provider.js";
import {
  cancelCustomerSellerPurchase,
  createCustomerSellerPurchase,
  getCustomerPilotOffer,
  getCustomerSellerPurchase
} from "../src/modules/commerce/seller-customer.service.js";
import { completeSellerFulfillment, confirmSellerCodCollection } from "../src/modules/commerce/seller-fulfillment.service.js";
import {
  createSeller,
  createSellerOffer,
  setSellerCommissionRate,
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
  const locked = [
    "src/modules/commerce/order.service.ts",
    "src/modules/commerce/smart-basket.service.ts",
    "src/modules/commerce/customer-commerce.service.ts",
    "src/modules/whatsapp/customer-handler.ts",
    "src/modules/whatsapp/merchant-handler.ts",
    "src/modules/gigs/delivery.service.ts"
  ];
  for (const relative of locked) {
    const source = readFileSync(resolve(apiRoot, relative), "utf8");
    assert.equal(source.includes("customerPilotEnabled"), false, relative);
    assert.equal(source.includes("seller-customer"), false, relative);
  }
  const paymentSource = readFileSync(resolve(apiRoot, "src/modules/commerce/payments/payment.service.ts"), "utf8");
  assert.equal(paymentSource.includes("SellerFulfillment"), false);
  assert.equal(paymentSource.includes("seller-fulfillment"), false);
  assert.ok(paymentSource.includes("seller-customer-payment"));

  const merchantLine = { sellerOfferId: null, quantity: 1, unitPriceCents: 250, productId: "p1" };
  const sellerA = { sellerOfferId: "offer-a", quantity: 1, unitPriceCents: 4000, sellableQuantity: 20, productId: "cat" };
  const added = planSellerPilotCartAdd([], { ...sellerA, sellableQuantity: 20 });
  assert.equal(added.ok, true);
  if (added.ok) {
    assert.equal(added.lines[0]?.unitPriceCents, 4000);
    assert.equal(added.lines[0]?.sellerOfferId, "offer-a");
    assert.equal(added.lines[0]?.quantity, 1);
  }
  const mixed = planSellerPilotCartAdd([merchantLine], { ...sellerA, sellableQuantity: 20 });
  assert.equal(mixed.ok, false);
  if (!mixed.ok) assert.equal(mixed.code, "MERCHANT_CART");
  assert.equal(merchantLine.quantity, 1);
  const otherSeller = planSellerPilotCartAdd([sellerA], {
    sellerOfferId: "offer-b",
    quantity: 1,
    unitPriceCents: 1000,
    sellableQuantity: 5
  });
  assert.equal(otherSeller.ok, false);
  if (!otherSeller.ok) assert.equal(otherSeller.code, "OTHER_SELLER");
  assert.equal(merchantCartBlockedBySellerPilot([sellerA]), true);
  assert.equal(merchantCartBlockedBySellerPilot([merchantLine]), false);

  const stamp = Date.now();
  const phone = (prefix: string) => `+263${prefix}${String(stamp).slice(-7)}`;
  const previousFlag = process.env.SELLER_MARKETPLACE_ENABLED;
  process.env.SELLER_MARKETPLACE_ENABLED = "false";
  const settingsBefore = await prisma.platformSetting.findUniqueOrThrow({ where: { id: "default" } });
  const sellerRateBefore = settingsBefore.marketplaceSellerCommissionRate.toString();
  const merchantRateBefore = settingsBefore.marketplaceMerchantCommissionRate.toString();

  const catalog = await prisma.catalogProduct.create({
    data: {
      name: `Customer Pilot Shoe ${stamp}`,
      normalizedName: `customer pilot shoe ${stamp}`,
      brand: "Test",
      category: "Shoes",
      sizeLabel: "9",
      status: "APPROVED",
      source: "DUTS_ADMIN"
    }
  });
  const raceCatalog = await prisma.catalogProduct.create({
    data: {
      name: `Customer Pilot Race ${stamp}`,
      normalizedName: `customer pilot race ${stamp}`,
      brand: "Test",
      category: "Shoes",
      sizeLabel: "8",
      status: "APPROVED",
      source: "DUTS_ADMIN"
    }
  });
  const merchant = await prisma.merchant.create({
    data: {
      name: `Customer Pilot Shop ${stamp}`,
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
  const productUpdatedAt = (await prisma.product.findUniqueOrThrow({ where: { id: merchantProduct.id } })).updatedAt.getTime();
  const admin = await prisma.user.create({
    data: {
      email: `pilot-admin-${stamp}@duts.local`,
      fullName: "Pilot Admin",
      phoneNumber: phone("78"),
      roles: ["ADMIN"],
      defaultRole: "ADMIN",
      accountStatus: "ACTIVE",
      country: "ZW",
      city: "Harare"
    }
  });
  const customer = await prisma.user.create({
    data: {
      email: `pilot-customer-${stamp}@duts.local`,
      fullName: "Pilot Customer",
      phoneNumber: phone("73"),
      roles: ["CLIENT"],
      defaultRole: "CLIENT",
      accountStatus: "ACTIVE",
      country: "ZW",
      city: "Harare"
    }
  });
  const dropoff = {
    dropoffLabel: "Customer gate",
    dropoffLatitude: -17.831,
    dropoffLongitude: 31.055,
    dropoffContactName: "Pilot Customer",
    dropoffContactPhone: phone("73")
  };

  const seller = await createSeller({
    displayName: "Pilot Seller",
    phone: phone("77"),
    pickupLocationLabel: "Seller collection gate",
    pickupLatitude: -17.829,
    pickupLongitude: 31.053,
    pickupContactName: "Pilot Seller",
    status: "ACTIVE"
  });
  const offer = await createSellerOffer(seller.id, {
    catalogProductId: catalog.id,
    priceCents: 4000,
    quantity: 20,
    status: "ACTIVE"
  });
  assert.equal(offer.customerPilotEnabled, false);

  async function shopUnchanged() {
    const shop = await prisma.product.findUniqueOrThrow({ where: { id: merchantProduct.id } });
    assert.equal(shop.priceCents, 250);
    assert.equal(shop.quantityApprox, 7);
    assert.equal(shop.available, true);
    assert.equal(shop.updatedAt.getTime(), productUpdatedAt);
  }

  try {
    await updateSellerOffer(seller.id, offer.id, { customerPilotEnabled: true });
    await rejectsCode(
      () =>
        createCustomerSellerPurchase(customer.id, {
          offerId: offer.id,
          quantity: 1,
          expectedUnitPriceCents: 4000,
          paymentMethod: "CASH",
          ...dropoff
        }),
      "FEATURE_DISABLED"
    );
    const merchantOrder = await createConfirmedCommerceOrder({
      customerId: customer.id,
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
      deliveryLabel: "Customer gate",
      deliveryLatitude: -17.826,
      deliveryLongitude: 31.034,
      paymentMethod: "CASH"
    });
    assert.equal(merchantOrder.merchantId, merchant.id);
    assert.equal(merchantOrder.paymentStatus, "DUE_ON_DELIVERY");
    await shopUnchanged();
    await prisma.commerceOrder.delete({ where: { id: merchantOrder.id } });

    process.env.SELLER_MARKETPLACE_ENABLED = "true";
    await setSellerCommissionRate(0.15);
    await updateSellerOffer(seller.id, offer.id, { customerPilotEnabled: false });
    await rejectsCode(() => getCustomerPilotOffer(offer.id), "PILOT_NOT_ENABLED");

    await updateSellerOffer(seller.id, offer.id, { customerPilotEnabled: true });
    const visible = await getCustomerPilotOffer(offer.id);
    assert.equal(visible.productName, catalog.name);
    assert.equal(visible.catalogProductId, catalog.id);
    assert.equal(visible.unitPriceCents, 4000);
    assert.equal(visible.sellableQuantity, 20);
    assert.equal(visible.available, true);
    assert.equal("phone" in visible, false);
    assert.equal(JSON.stringify(visible).includes(seller.phone), false);
    assert.equal(JSON.stringify(visible).includes("Seller collection gate"), false);

    const reservedTwo = await createCustomerSellerPurchase(customer.id, {
      offerId: offer.id,
      quantity: 2,
      expectedUnitPriceCents: 4000,
      paymentMethod: "CASH",
      ...dropoff
    });
    assert.equal((await prisma.sellerOffer.findUniqueOrThrow({ where: { id: offer.id } })).reservedQuantity, 2);
    assert.equal((await prisma.sellerOffer.findUniqueOrThrow({ where: { id: offer.id } })).quantity, 20);
    const cancelled = await cancelCustomerSellerPurchase(customer.id, reservedTwo.purchase.purchaseId);
    assert.equal(cancelled.statusLabel, "Cancelled");
    assert.equal((await prisma.sellerOffer.findUniqueOrThrow({ where: { id: offer.id } })).reservedQuantity, 0);
    assert.equal(await prisma.sellerLedgerEntry.count({ where: { sellerFulfillmentId: reservedTwo.purchase.purchaseId } }), 0);

    await updateSellerOffer(seller.id, offer.id, { priceCents: 4500 });
    await rejectsCode(
      () =>
        createCustomerSellerPurchase(customer.id, {
          offerId: offer.id,
          quantity: 1,
          expectedUnitPriceCents: 4000,
          paymentMethod: "CASH",
          ...dropoff
        }),
      "PRICE_CHANGED"
    );
    assert.equal((await prisma.sellerOffer.findUniqueOrThrow({ where: { id: offer.id } })).reservedQuantity, 0);
    await updateSellerOffer(seller.id, offer.id, { priceCents: 4000, customerPilotEnabled: true });

    const prepaid = await createCustomerSellerPurchase(customer.id, {
      offerId: offer.id,
      quantity: 1,
      expectedUnitPriceCents: 4000,
      paymentMethod: "ECOCASH",
      payerPhone: "0772000111",
      ...dropoff
    });
    assert.equal(prepaid.purchase.statusLabel, "Payment pending");
    assert.equal(prepaid.purchase.paymentLabel, "Payment pending");
    assert.ok(prepaid.providerPaymentId);
    assert.equal(await prisma.sellerLedgerEntry.count({ where: { sellerFulfillmentId: prepaid.purchase.purchaseId } }), 0);
    assert.equal((await prisma.sellerOffer.findUniqueOrThrow({ where: { id: offer.id } })).reservedQuantity, 1);
    assert.equal((await prisma.sellerOffer.findUniqueOrThrow({ where: { id: offer.id } })).quantity, 20);
    const customerView = JSON.stringify(prepaid.purchase);
    assert.equal(customerView.includes(seller.phone), false);
    assert.equal(customerView.includes("Seller collection gate"), false);
    assert.equal(customerView.includes("pickupLatitude"), false);
    assert.equal(prepaid.purchase.productName, catalog.name);
    assert.equal(prepaid.purchase.unitPriceCents, 4000);

    const paidResult = await simulateMockPaymentOutcome({
      providerPaymentId: prepaid.providerPaymentId!,
      status: "PAID"
    });
    assert.ok(paidResult);
    const firstCallback = await applyProviderPaymentResult(paidResult!);
    const secondCallback = await applyProviderPaymentResult(paidResult!);
    assert.equal(firstCallback.applied, true);
    assert.equal(secondCallback.duplicate, true);
    const paid = await getCustomerSellerPurchase(customer.id, prepaid.purchase.purchaseId);
    assert.equal(paid.paymentLabel, "Paid");
    assert.equal(paid.statusLabel, "Preparing pickup");
    const fulfillment = await prisma.sellerFulfillment.findUniqueOrThrow({
      where: { id: prepaid.purchase.purchaseId },
      include: { linkedDeliveryGig: true, paymentAttempts: true }
    });
    assert.equal(fulfillment.paymentStatus, "PAID");
    assert.equal(fulfillment.status, "READY_FOR_PICKUP");
    assert.equal(fulfillment.paymentAttempts.length, 1);
    assert.equal(fulfillment.paymentAttempts[0]?.status, "PAID");
    const gig = fulfillment.linkedDeliveryGig;
    assert.ok(gig);
    assert.equal(await prisma.gig.count({ where: { id: gig!.id } }), 1);
    assert.notEqual(gig!.clientId, customer.id);
    assert.equal(gig!.formattedAddress, "Seller collection gate");
    assert.equal(gig!.pickupContactName, "Pilot Seller");
    assert.equal(gig!.pickupContactPhone, seller.phone);
    assert.equal(gig!.dropoffFormattedAddress, "Customer gate");
    assert.ok(gig!.packageDescription?.includes(catalog.name));
    assert.ok(gig!.pickupPin && gig!.pickupPin.length > 8);
    assert.ok(gig!.deliveryPin && gig!.deliveryPin.length > 8);
    assert.equal(gig!.commerceOrder, undefined);
    assert.equal(await prisma.commerceOrder.count({ where: { linkedDeliveryGigId: gig!.id } }), 0);
    assert.equal(fulfillment.sellerProceedsCents, 3400);
    assert.equal(fulfillment.commissionCents, 600);
    assert.ok(fulfillment.deliveryFeeCents > 0);
    assert.equal(fulfillment.paymentAttempts[0]?.amountCents, fulfillment.merchandiseCents + gig!.totalCents);
    assert.equal(await prisma.sellerLedgerEntry.count({ where: { sellerFulfillmentId: fulfillment.id } }), 0);

    await setSellerCommissionRate(0.18);
    await prisma.gig.update({
      where: { id: gig!.id },
      data: { status: "COMPLETED", deliveryVerifiedAt: new Date() }
    });
    const done = await completeSellerFulfillment(fulfillment.id);
    assert.equal(done.commissionRate, 0.15);
    assert.equal(done.commissionCents, 600);
    assert.equal(done.sellerProceedsCents, 3400);
    assert.equal(done.deliveryFeeCents, gig!.totalCents);
    const afterPrepaid = await prisma.sellerOffer.findUniqueOrThrow({ where: { id: offer.id } });
    assert.equal(afterPrepaid.quantity, 19);
    assert.equal(afterPrepaid.reservedQuantity, 0);
    assert.equal(await prisma.sellerLedgerEntry.count({ where: { sellerFulfillmentId: fulfillment.id } }), 1);
    await completeSellerFulfillment(fulfillment.id);
    assert.equal((await prisma.sellerOffer.findUniqueOrThrow({ where: { id: offer.id } })).quantity, 19);
    assert.equal(await prisma.sellerLedgerEntry.count({ where: { sellerFulfillmentId: fulfillment.id } }), 1);
    const deliveredView = await getCustomerSellerPurchase(customer.id, fulfillment.id);
    assert.equal(deliveredView.statusLabel, "Delivered");

    await setSellerCommissionRate(0.15);
    const cod = await createCustomerSellerPurchase(customer.id, {
      offerId: offer.id,
      quantity: 1,
      expectedUnitPriceCents: 4000,
      paymentMethod: "CASH",
      ...dropoff
    });
    assert.equal(cod.purchase.paymentLabel, "Pay on delivery");
    assert.equal(cod.purchase.statusLabel, "Preparing pickup");
    const codRow = await prisma.sellerFulfillment.findUniqueOrThrow({ where: { id: cod.purchase.purchaseId } });
    assert.equal(codRow.paymentStatus, "DUE_ON_DELIVERY");
    assert.ok(codRow.linkedDeliveryGigId);
    assert.equal(await prisma.sellerLedgerEntry.count({ where: { sellerFulfillmentId: codRow.id } }), 0);

    process.env.SELLER_MARKETPLACE_ENABLED = "false";
    await rejectsCode(
      () =>
        createCustomerSellerPurchase(customer.id, {
          offerId: offer.id,
          quantity: 1,
          expectedUnitPriceCents: 4000,
          paymentMethod: "CASH",
          ...dropoff
        }),
      "FEATURE_DISABLED"
    );
    const stillThere = await getCustomerSellerPurchase(customer.id, cod.purchase.purchaseId);
    assert.equal(stillThere.purchaseId, cod.purchase.purchaseId);
    await prisma.gig.update({
      where: { id: codRow.linkedDeliveryGigId! },
      data: { status: "COMPLETED", deliveryVerifiedAt: new Date() }
    });
    const codDone = await completeSellerFulfillment(codRow.id);
    assert.equal(codDone.settlementStatus, "AWAITING_COLLECTION");
    assert.equal(codDone.paymentStatus, "DUE_ON_DELIVERY");
    const collected = await confirmSellerCodCollection(codRow.id);
    assert.equal(collected.settlementStatus, "ACCRUED");
    assert.equal(collected.paymentStatus, "PAID");
    assert.equal((await prisma.sellerOffer.findUniqueOrThrow({ where: { id: offer.id } })).quantity, 18);
    assert.equal(await prisma.sellerLedgerEntry.count({ where: { sellerFulfillmentId: codRow.id } }), 1);

    process.env.SELLER_MARKETPLACE_ENABLED = "true";
    await updateSellerOffer(seller.id, offer.id, { customerPilotEnabled: false });
    await rejectsCode(
      () =>
        createCustomerSellerPurchase(customer.id, {
          offerId: offer.id,
          quantity: 1,
          expectedUnitPriceCents: 4000,
          paymentMethod: "CASH",
          ...dropoff
        }),
      "PILOT_NOT_ENABLED"
    );
    assert.equal((await getCustomerSellerPurchase(customer.id, fulfillment.id)).statusLabel, "Delivered");

    const raceOffer = await createSellerOffer(seller.id, {
      catalogProductId: raceCatalog.id,
      priceCents: 4000,
      quantity: 1,
      status: "ACTIVE"
    });
    await updateSellerOffer(seller.id, raceOffer.id, { customerPilotEnabled: true });
    const raced = await Promise.allSettled([
      createCustomerSellerPurchase(customer.id, {
        offerId: raceOffer.id,
        quantity: 1,
        expectedUnitPriceCents: 4000,
        paymentMethod: "CASH",
        ...dropoff
      }),
      createCustomerSellerPurchase(customer.id, {
        offerId: raceOffer.id,
        quantity: 1,
        expectedUnitPriceCents: 4000,
        paymentMethod: "CASH",
        ...dropoff
      })
    ]);
    assert.equal(raced.filter((row) => row.status === "fulfilled").length, 1);
    const raceLoss = raced.find((row) => row.status === "rejected") as PromiseRejectedResult;
    assert.ok(raceLoss.reason instanceof AppError);
    assert.equal(raceLoss.reason.code, "INSUFFICIENT_QUANTITY");
    const raceSaved = await prisma.sellerOffer.findUniqueOrThrow({ where: { id: raceOffer.id } });
    assert.equal(raceSaved.quantity, 1);
    assert.equal(raceSaved.reservedQuantity, 1);
    assert.ok(raceSaved.quantity >= 0);

    await shopUnchanged();
    const merchantAgain = await createConfirmedCommerceOrder({
      customerId: customer.id,
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
      deliveryLabel: "Customer gate",
      deliveryLatitude: -17.826,
      deliveryLongitude: 31.034,
      paymentMethod: "CASH"
    });
    assert.equal(merchantAgain.paymentStatus, "DUE_ON_DELIVERY");
    await prisma.commerceOrder.delete({ where: { id: merchantAgain.id } });
    await shopUnchanged();

    console.log(
      JSON.stringify(
        {
          ok: true,
          quantityAfterPrepaid: 19,
          quantityAfterCod: 18,
          commissionSnapshot: 0.15,
          sellerProceedsCents: 3400,
          customerPilotDefault: false
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
    const linked = await prisma.sellerFulfillment.findMany({
      where: { sellerId: seller.id },
      select: { linkedDeliveryGigId: true }
    });
    const gigIds = linked.map((row) => row.linkedDeliveryGigId).filter((id): id is string => Boolean(id));
    await prisma.sellerLedgerEntry.deleteMany({ where: { sellerId: seller.id } });
    await prisma.sellerPaymentAttempt.deleteMany({ where: { sellerFulfillment: { sellerId: seller.id } } });
    await prisma.sellerFulfillment.updateMany({ where: { sellerId: seller.id }, data: { linkedDeliveryGigId: null } });
    if (gigIds.length) await prisma.gig.deleteMany({ where: { id: { in: gigIds } } });
    await prisma.sellerFulfillment.deleteMany({ where: { sellerId: seller.id } });
    await prisma.sellerOffer.deleteMany({ where: { sellerId: seller.id } });
    await prisma.seller.deleteMany({ where: { id: seller.id } });
    await prisma.commerceOrder.deleteMany({ where: { merchantId: merchant.id } });
    await prisma.commerceCustomer.deleteMany({ where: { userId: { in: [customer.id, admin.id] } } });
    await prisma.product.deleteMany({ where: { id: merchantProduct.id } });
    await prisma.merchant.deleteMany({ where: { id: merchant.id } });
    await prisma.catalogProduct.deleteMany({ where: { id: { in: [catalog.id, raceCatalog.id] } } });
    await prisma.user.deleteMany({ where: { id: { in: [admin.id, customer.id] } } });
    const restored = await prisma.platformSetting.findUniqueOrThrow({ where: { id: "default" } });
    assert.equal(restored.marketplaceSellerCommissionRate.toString(), sellerRateBefore);
    assert.equal(restored.marketplaceMerchantCommissionRate.toString(), merchantRateBefore);
    await prisma.$disconnect();
  }
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
