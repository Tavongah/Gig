/**
 * Phase 2B.2 — approve one exact merchant quote, then one cash or EcoCash order.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { WhatsAppParty } from "@prisma/client";
import { AppError } from "../src/lib/errors.js";
import { prisma } from "../src/config/prisma.js";
import { createCatalogProduct, linkCatalogProductToMerchant } from "../src/modules/commerce/catalog.service.js";
import { approveProposedQuote, handoffApprovedQuote } from "../src/modules/commerce/quote-approval.service.js";
import { proposeMerchantPriceForCheckout } from "../src/modules/commerce/quote-proposal.service.js";
import { MockCommercePaymentProvider } from "../src/modules/commerce/payments/mock.provider.js";
import { setCommercePaymentProviderForTests } from "../src/modules/commerce/payments/payment.service.js";
import { notifyAfterPaidCommerceOrder } from "../src/modules/commerce/merchant-notification.service.js";
import { handleCustomerWhatsAppMessage } from "../src/modules/whatsapp/customer-handler.js";

const root = dirname(fileURLToPath(import.meta.url));
const GWERU = { lat: -19.455, lng: 29.812, label: "Senga, Gweru" };

function source(rel: string) {
  return readFileSync(resolve(root, rel), "utf8");
}

function zw(seed: number) {
  return `+2637${String(seed).padStart(8, "0").slice(-8)}`;
}

async function main() {
  const approval = source("../src/modules/commerce/quote-approval.service.ts");
  const handler = source("../src/modules/whatsapp/customer-handler.ts");
  const goi = source("../src/modules/commerce/order.service.ts");
  assert.match(approval, /validationFixture: false/);
  assert.match(approval, /QUOTE_INTEGRITY/);
  assert.match(handler, /QUOTE_APPROVAL/);
  assert.match(handler, /approveProposedQuote/);
  assert.doesNotMatch(approval, /SellerOffer/);
  assert.doesNotMatch(approval, /DeliveryGig/);
  assert.doesNotMatch(goi.slice(goi.indexOf("export async function syncCommerceOrderFromGig")), /PRICE_PROPOSED/);

  const stamp = Date.now() % 10_000_000;
  const user = await prisma.user.create({
    data: { email: `quote-approval-${stamp}@duts.test`, fullName: "Quote Approval", phoneNumber: zw(stamp) }
  });
  const sellersBefore = await prisma.seller.count();
  const gigsBefore = await prisma.gig.count();
  const checkoutIds: string[] = [];
  const merchantIds: string[] = [];
  const catalogIds: string[] = [];
  let n = 30;

  async function merchant(name: string) {
    const row = await prisma.merchant.create({
      data: {
        name: `${name} ${stamp}`,
        contactName: "Tester",
        phone: zw(stamp + n),
        whatsappPhone: zw(stamp + n),
        locationLabel: "Gweru",
        latitude: GWERU.lat,
        longitude: GWERU.lng,
        category: "TUCK_SHOP"
      }
    });
    n += 1;
    merchantIds.push(row.id);
    return row;
  }

  async function pricedCheckout(price = 250, fee = 170) {
    const shop = await merchant("Shop");
    const item = await createCatalogProduct({ name: `Approval Cola ${stamp}-${n}`, category: "Drinks", sizeLabel: "2L" });
    catalogIds.push(item.id);
    const offer = await linkCatalogProductToMerchant(shop.id, {
      catalogProductId: item.id,
      priceCents: price,
      currency: "usd",
      available: true
    });
    const checkout = await prisma.commerceCheckout.create({
      data: {
        customerId: user.id,
        status: "AWAITING_FULFILLMENT",
        itemsSubtotalCents: 0,
        deliveryFeeCents: fee,
        serviceFeeCents: 0,
        totalCents: 0,
        deliveryLabel: GWERU.label,
        deliveryLatitude: GWERU.lat,
        deliveryLongitude: GWERU.lng,
        packageClass: "SMALL",
        pickupSequence: [],
        allocations: { merchants: [], awaitingFulfillment: true },
        lines: {
          create: [{
            catalogProductId: item.id,
            quantity: 1,
            productNameSnapshot: item.name,
            fulfillmentStatus: "AWAITING_SOURCE"
          }]
        }
      }
    });
    checkoutIds.push(checkout.id);
    const proposed = await proposeMerchantPriceForCheckout(checkout.id);
    assert.equal(proposed.outcome, "PROPOSED");
    return { checkout, shop, offer, proposed };
  }

  function actor() {
    return { userId: user.id };
  }

  try {
    setCommercePaymentProviderForTests(new MockCommercePaymentProvider());
    const happy = await pricedCheckout();
    const approved = await approveProposedQuote({
      checkoutId: happy.checkout.id,
      approvalId: happy.proposed.approvalId!,
      quoteVersion: happy.proposed.quoteVersion,
      actor: actor()
    });
    assert.equal(approved.status, "CUSTOMER_APPROVED");
    assert.equal(approved.payable, false);
    const again = await approveProposedQuote({
      checkoutId: happy.checkout.id,
      approvalId: happy.proposed.approvalId!,
      quoteVersion: 1,
      actor: actor()
    });
    assert.equal(again.status, "CUSTOMER_APPROVED");
    assert.equal(again.quoteVersion, 1);
    assert.equal(await prisma.commerceOrder.count({ where: { checkoutId: happy.checkout.id } }), 0);
    assert.equal(await prisma.commercePaymentAttempt.count({ where: { commerceCheckoutId: happy.checkout.id } }), 0);

    const wrongId = await pricedCheckout();
    await assert.rejects(
      () =>
        approveProposedQuote({
          checkoutId: wrongId.checkout.id,
          approvalId: "00000000-0000-4000-8000-000000000000",
          quoteVersion: 1,
          actor: actor()
        }),
      (error: unknown) => error instanceof AppError && error.code === "QUOTE_STALE_APPROVAL"
    );
    assert.equal((await prisma.commerceCheckout.findUniqueOrThrow({ where: { id: wrongId.checkout.id } })).status, "PRICE_PROPOSED");

    const wrongVersion = await pricedCheckout();
    await assert.rejects(
      () =>
        approveProposedQuote({
          checkoutId: wrongVersion.checkout.id,
          approvalId: wrongVersion.proposed.approvalId!,
          quoteVersion: 9,
          actor: actor()
        }),
      (error: unknown) => error instanceof AppError && error.code === "QUOTE_STALE_APPROVAL"
    );

    const expired = await pricedCheckout();
    await prisma.commerceCheckout.update({
      where: { id: expired.checkout.id },
      data: { quoteExpiresAt: new Date(Date.now() - 1000) }
    });
    await assert.rejects(
      () =>
        approveProposedQuote({
          checkoutId: expired.checkout.id,
          approvalId: expired.proposed.approvalId!,
          quoteVersion: 1,
          actor: actor()
        }),
      (error: unknown) => error instanceof AppError && error.code === "QUOTE_EXPIRED"
    );
    const expiredRow = await prisma.commerceCheckout.findUniqueOrThrow({ where: { id: expired.checkout.id } });
    assert.equal(expiredRow.status, "AWAITING_FULFILLMENT");
    assert.equal(expiredRow.approvalId, null);

    const changed = await pricedCheckout();
    await prisma.product.update({ where: { id: changed.offer.id }, data: { priceCents: 999 } });
    await assert.rejects(
      () =>
        approveProposedQuote({
          checkoutId: changed.checkout.id,
          approvalId: changed.proposed.approvalId!,
          quoteVersion: 1,
          actor: actor()
        }),
      (error: unknown) => error instanceof AppError && error.code === "QUOTE_SOURCE_CHANGED"
    );
    assert.equal((await prisma.commerceCheckout.findUniqueOrThrow({ where: { id: changed.checkout.id } })).approvalId, null);

    for (const tweak of [
      { available: false },
      { archived: true }
    ] as const) {
      const row = await pricedCheckout();
      await prisma.product.update({ where: { id: row.offer.id }, data: tweak });
      await assert.rejects(
        () =>
          approveProposedQuote({
            checkoutId: row.checkout.id,
            approvalId: row.proposed.approvalId!,
            quoteVersion: 1,
            actor: actor()
          }),
        (error: unknown) => error instanceof AppError && error.code === "QUOTE_SOURCE_CHANGED"
      );
    }

    const inactive = await pricedCheckout();
    await prisma.merchant.update({ where: { id: inactive.shop.id }, data: { isActive: false } });
    await assert.rejects(
      () =>
        approveProposedQuote({
          checkoutId: inactive.checkout.id,
          approvalId: inactive.proposed.approvalId!,
          quoteVersion: 1,
          actor: actor()
        }),
      (error: unknown) => error instanceof AppError && error.code === "QUOTE_SOURCE_CHANGED"
    );

    const closed = await pricedCheckout();
    await prisma.merchant.update({ where: { id: closed.shop.id }, data: { acceptsOrders: false } });
    await assert.rejects(
      () =>
        approveProposedQuote({
          checkoutId: closed.checkout.id,
          approvalId: closed.proposed.approvalId!,
          quoteVersion: 1,
          actor: actor()
        }),
      (error: unknown) => error instanceof AppError && error.code === "QUOTE_SOURCE_CHANGED"
    );

    const short = await pricedCheckout();
    await prisma.product.update({ where: { id: short.offer.id }, data: { quantityApprox: 0 } });
    await assert.rejects(
      () =>
        approveProposedQuote({
          checkoutId: short.checkout.id,
          approvalId: short.proposed.approvalId!,
          quoteVersion: 1,
          actor: actor()
        }),
      (error: unknown) => error instanceof AppError && error.code === "QUOTE_SOURCE_CHANGED"
    );

    const remapped = await pricedCheckout();
    const other = await createCatalogProduct({ name: `Other ${stamp}`, category: "Drinks", sizeLabel: "2L" });
    catalogIds.push(other.id);
    await prisma.product.update({ where: { id: remapped.offer.id }, data: { catalogProductId: other.id } });
    await assert.rejects(
      () =>
        approveProposedQuote({
          checkoutId: remapped.checkout.id,
          approvalId: remapped.proposed.approvalId!,
          quoteVersion: 1,
          actor: actor()
        }),
      (error: unknown) => error instanceof AppError && error.code === "QUOTE_SOURCE_CHANGED"
    );

    const moved = await pricedCheckout(400, 130);
    await prisma.merchant.update({
      where: { id: moved.shop.id },
      data: { latitude: GWERU.lat + 0.2, longitude: GWERU.lng }
    });
    await approveProposedQuote({
      checkoutId: moved.checkout.id,
      approvalId: moved.proposed.approvalId!,
      quoteVersion: 1,
      actor: actor()
    });
    const movedRow = await prisma.commerceCheckout.findUniqueOrThrow({ where: { id: moved.checkout.id } });
    assert.equal(movedRow.deliveryFeeCents, 130);
    assert.equal(movedRow.totalCents, 530);

    const badSubtotal = await pricedCheckout();
    await prisma.commerceCheckout.update({ where: { id: badSubtotal.checkout.id }, data: { itemsSubtotalCents: 1 } });
    await assert.rejects(
      () =>
        approveProposedQuote({
          checkoutId: badSubtotal.checkout.id,
          approvalId: badSubtotal.proposed.approvalId!,
          quoteVersion: 1,
          actor: actor()
        }),
      (error: unknown) => error instanceof AppError && error.code === "QUOTE_INTEGRITY"
    );
    assert.equal((await prisma.commerceCheckout.findUniqueOrThrow({ where: { id: badSubtotal.checkout.id } })).status, "PRICE_PROPOSED");

    const badTotal = await pricedCheckout();
    await prisma.commerceCheckout.update({ where: { id: badTotal.checkout.id }, data: { totalCents: 1 } });
    await assert.rejects(
      () =>
        approveProposedQuote({
          checkoutId: badTotal.checkout.id,
          approvalId: badTotal.proposed.approvalId!,
          quoteVersion: 1,
          actor: actor()
        }),
      (error: unknown) => error instanceof AppError && error.code === "QUOTE_INTEGRITY"
    );

    const fixture = await pricedCheckout();
    await prisma.commerceCheckout.update({ where: { id: fixture.checkout.id }, data: { validationFixture: true } });
    await assert.rejects(
      () =>
        approveProposedQuote({
          checkoutId: fixture.checkout.id,
          approvalId: fixture.proposed.approvalId!,
          quoteVersion: 1,
          actor: actor()
        }),
      (error: unknown) => error instanceof AppError && error.code === "FIXTURE_EXCLUDED"
    );
    assert.equal(await prisma.commerceOrder.count({ where: { checkoutId: fixture.checkout.id } }), 0);

    const cash = await pricedCheckout(250, 100);
    await approveProposedQuote({
      checkoutId: cash.checkout.id,
      approvalId: cash.proposed.approvalId!,
      quoteVersion: 1,
      actor: actor()
    });
    const cod = await handoffApprovedQuote({
      checkoutId: cash.checkout.id,
      approvalId: cash.proposed.approvalId!,
      quoteVersion: 1,
      paymentMethod: "CASH",
      actor: actor()
    });
    const codAgain = await handoffApprovedQuote({
      checkoutId: cash.checkout.id,
      approvalId: cash.proposed.approvalId!,
      quoteVersion: 1,
      paymentMethod: "CASH",
      actor: actor()
    });
    assert.equal(cod.orderId, codAgain.orderId);
    assert.equal(cod.paymentStatus, "DUE_ON_DELIVERY");
    assert.equal(await prisma.commerceOrder.count({ where: { checkoutId: cash.checkout.id } }), 1);
    const codOrder = await prisma.commerceOrder.findUniqueOrThrow({ where: { id: cod.orderId } });
    assert.equal(codOrder.merchantId, cash.shop.id);
    assert.equal(codOrder.totalCents, 350);
    assert.equal(codOrder.deliveryFeeCents, 100);
    assert.equal(codOrder.linkedDeliveryGigId, null);
    assert.equal(await prisma.commerceNotificationAttempt.count({ where: { commerceOrderId: cod.orderId } }), 1);
    assert.equal(await prisma.gig.count(), gigsBefore);

    const ecocash = await pricedCheckout(300, 100);
    await approveProposedQuote({
      checkoutId: ecocash.checkout.id,
      approvalId: ecocash.proposed.approvalId!,
      quoteVersion: 1,
      actor: actor()
    });
    assert.equal(await prisma.commerceNotificationAttempt.count({ where: { commerceOrder: { checkoutId: ecocash.checkout.id } } }), 0);
    const paid = await handoffApprovedQuote({
      checkoutId: ecocash.checkout.id,
      approvalId: ecocash.proposed.approvalId!,
      quoteVersion: 1,
      paymentMethod: "ECOCASH",
      payerPhone: "0771234567",
      actor: actor()
    });
    const paidAgain = await handoffApprovedQuote({
      checkoutId: ecocash.checkout.id,
      approvalId: ecocash.proposed.approvalId!,
      quoteVersion: 1,
      paymentMethod: "ECOCASH",
      payerPhone: "0771234567",
      actor: actor()
    });
    assert.equal(paid.orderId, paidAgain.orderId);
    assert.equal(await prisma.commerceOrder.count({ where: { checkoutId: ecocash.checkout.id } }), 1);
    assert.equal(await prisma.commercePaymentAttempt.count({ where: { commerceOrderId: paid.orderId } }), 1);
    assert.equal(await prisma.commerceNotificationAttempt.count({ where: { commerceOrderId: paid.orderId } }), 0);
    await prisma.commerceOrder.update({ where: { id: paid.orderId }, data: { paymentStatus: "PAID" } });
    await notifyAfterPaidCommerceOrder(paid.orderId);
    assert.equal(await prisma.commerceNotificationAttempt.count({ where: { commerceOrderId: paid.orderId } }), 1);

    const race = await pricedCheckout(220, 100);
    await approveProposedQuote({
      checkoutId: race.checkout.id,
      approvalId: race.proposed.approvalId!,
      quoteVersion: 1,
      actor: actor()
    });
    const raced = await Promise.all([
      handoffApprovedQuote({
        checkoutId: race.checkout.id,
        approvalId: race.proposed.approvalId!,
        quoteVersion: 1,
        paymentMethod: "CASH",
        actor: actor()
      }),
      handoffApprovedQuote({
        checkoutId: race.checkout.id,
        approvalId: race.proposed.approvalId!,
        quoteVersion: 1,
        paymentMethod: "CASH",
        actor: actor()
      })
    ]);
    assert.equal(raced[0].orderId, raced[1].orderId);
    assert.equal(await prisma.commerceOrder.count({ where: { checkoutId: race.checkout.id } }), 1);

    const waCheckout = await pricedCheckout(150, 100);
    await prisma.commerceCheckout.update({
      where: { id: waCheckout.checkout.id },
      data: { customerWhatsAppPhone: zw(stamp + 90) }
    });
    const phone = zw(stamp + 90);
    await handleCustomerWhatsAppMessage({ providerMessageId: `qa-${stamp}-boot`, from: phone, text: "hello" });
    const conv = await prisma.whatsAppConversation.findFirstOrThrow({
      where: { phoneNormalized: phone, party: WhatsAppParty.CUSTOMER }
    });
    const bound = {
      expectedInput: "QUOTE_APPROVAL",
      choiceType: "QUOTE_APPROVAL",
      choiceId: "choice-1",
      quoteCheckoutId: waCheckout.checkout.id,
      quoteApprovalId: waCheckout.proposed.approvalId,
      quoteVersion: 1,
      unresolvedCheckoutId: waCheckout.checkout.id
    };
    await prisma.whatsAppConversation.update({
      where: { id: conv.id },
      data: { contextJson: bound }
    });
    await handleCustomerWhatsAppMessage({ providerMessageId: `qa-${stamp}-yes`, from: phone, text: "YES" });
    await handleCustomerWhatsAppMessage({ providerMessageId: `qa-${stamp}-yes`, from: phone, text: "YES" });
    const waRow = await prisma.commerceCheckout.findUniqueOrThrow({ where: { id: waCheckout.checkout.id } });
    assert.equal(waRow.status, "CUSTOMER_APPROVED");
    assert.equal(await prisma.commerceOrder.count({ where: { checkoutId: waCheckout.checkout.id } }), 0);

    const declined = await pricedCheckout();
    await prisma.commerceCheckout.update({
      where: { id: declined.checkout.id },
      data: { customerWhatsAppPhone: phone }
    });
    await prisma.whatsAppConversation.update({
      where: { id: conv.id },
      data: {
        contextJson: {
          expectedInput: "QUOTE_APPROVAL",
          choiceType: "QUOTE_APPROVAL",
          choiceId: "choice-no",
          quoteCheckoutId: declined.checkout.id,
          quoteApprovalId: declined.proposed.approvalId,
          quoteVersion: 1
        }
      }
    });
    await handleCustomerWhatsAppMessage({ providerMessageId: `qa-${stamp}-no`, from: phone, text: "NO" });
    const declinedRow = await prisma.commerceCheckout.findUniqueOrThrow({ where: { id: declined.checkout.id } });
    assert.equal(declinedRow.status, "AWAITING_FULFILLMENT");
    assert.equal(declinedRow.approvalId, null);
    assert.equal(await prisma.commerceOrder.count({ where: { checkoutId: declined.checkout.id } }), 0);

    const stale = await pricedCheckout();
    await prisma.whatsAppConversation.update({
      where: { id: conv.id },
      data: {
        contextJson: {
          expectedInput: "PRODUCT_TEXT",
          unresolvedCheckoutId: stale.checkout.id
        }
      }
    });
    await handleCustomerWhatsAppMessage({ providerMessageId: `qa-${stamp}-stale`, from: phone, text: "YES" });
    assert.equal((await prisma.commerceCheckout.findUniqueOrThrow({ where: { id: stale.checkout.id } })).status, "PRICE_PROPOSED");

    const isolated = await pricedCheckout();
    await prisma.whatsAppConversation.update({
      where: { id: conv.id },
      data: {
        contextJson: {
          expectedInput: "PRODUCT_DISAMBIGUATION",
          choiceType: "PRODUCT_DISAMBIGUATION",
          choiceId: "other-choice",
          pendingChoices: [{ query: "cola", options: [{ productId: "x", name: "Cola", priceCents: 100 }], choiceId: "other-choice" }]
        }
      }
    });
    await handleCustomerWhatsAppMessage({ providerMessageId: `qa-${stamp}-num`, from: phone, text: "1" });
    assert.equal((await prisma.commerceCheckout.findUniqueOrThrow({ where: { id: isolated.checkout.id } })).status, "PRICE_PROPOSED");

    assert.equal(await prisma.gig.count(), gigsBefore);
    assert.equal(await prisma.seller.count(), sellersBefore);
    console.log("quote approval phase 2b.2 ok");
  } finally {
    if (checkoutIds.length) {
      await prisma.commercePaymentAttempt.deleteMany({ where: { commerceOrder: { checkoutId: { in: checkoutIds } } } });
      await prisma.commerceNotificationAttempt.deleteMany({ where: { commerceOrder: { checkoutId: { in: checkoutIds } } } });
      await prisma.commerceOrder.deleteMany({ where: { checkoutId: { in: checkoutIds } } });
      await prisma.commerceCheckout.deleteMany({ where: { id: { in: checkoutIds } } });
    }
    if (merchantIds.length) await prisma.merchant.deleteMany({ where: { id: { in: merchantIds } } });
    if (catalogIds.length) await prisma.catalogProduct.deleteMany({ where: { id: { in: catalogIds } } });
    await prisma.user.delete({ where: { id: user.id } }).catch(() => undefined);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
