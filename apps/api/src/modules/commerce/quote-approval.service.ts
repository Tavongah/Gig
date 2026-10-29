/**
 * Accept one snapshotted merchant quote, then hand it to the existing
 * cash or EcoCash order path. Fixtures, expired quotes, and changed
 * prices never become an order.
 */
import {
  CommerceCheckoutStatus,
  CommercePaymentMethod,
  CommercePaymentStatus,
  type CatalogProductStatus,
  type OrderSource
} from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { normalizePhoneNumber } from "../auth/access.service.js";
import { AppError } from "../../lib/errors.js";
import { createConfirmedCommerceOrder } from "./order.service.js";
import { paymentStatusForMethod, resolveCommercePaymentMethod } from "./payment-mode.js";
import { initiateMobileMoneyPaymentForOrder } from "./payments/payment.service.js";
import { notifyMerchantNewOrderSafe } from "./merchant-notification.service.js";

const PRICEABLE_CATALOG = new Set<CatalogProductStatus>(["APPROVED", "PENDING"]);

export type QuoteActor = {
  userId?: string | null;
  commerceCustomerId?: string | null;
  phone?: string | null;
};

type CheckoutLine = {
  id: string;
  catalogProductId: string;
  quantity: number;
  productNameSnapshot: string;
  unitPriceCents: number | null;
  sourceProductId: string | null;
  sourceMerchantId: string | null;
};

type CheckoutRow = {
  id: string;
  customerId: string | null;
  commerceCustomerId: string | null;
  customerWhatsAppPhone: string | null;
  status: CommerceCheckoutStatus;
  validationFixture: boolean;
  approvalId: string | null;
  quoteVersion: number;
  quoteExpiresAt: Date | null;
  approvedAt: Date | null;
  itemsSubtotalCents: number;
  deliveryFeeCents: number;
  serviceFeeCents: number;
  totalCents: number;
  deliveryLabel: string;
  deliveryLatitude: { toString(): string } | number;
  deliveryLongitude: { toString(): string } | number;
  orderSource: OrderSource;
  packageClass: string | null;
  lines: CheckoutLine[];
  orders: Array<{ id: string }>;
};

function ownsCheckout(row: CheckoutRow, actor: QuoteActor) {
  if (actor.userId && row.customerId === actor.userId) return true;
  if (actor.commerceCustomerId && row.commerceCustomerId === actor.commerceCustomerId) return true;
  if (
    actor.phone &&
    row.customerWhatsAppPhone &&
    normalizePhoneNumber(actor.phone) === normalizePhoneNumber(row.customerWhatsAppPhone)
  ) {
    return true;
  }
  return false;
}

function assertOwned(row: CheckoutRow, actor: QuoteActor) {
  if (row.validationFixture) {
    throw new AppError("This validation request cannot be approved.", 409, "FIXTURE_EXCLUDED");
  }
  if (!ownsCheckout(row, actor)) {
    throw new AppError("Order not found.", 404, "ORDER_NOT_FOUND");
  }
}

function neededQuantities(lines: CheckoutLine[]) {
  const needed = new Map<string, number>();
  for (const line of lines) {
    needed.set(line.catalogProductId, (needed.get(line.catalogProductId) ?? 0) + line.quantity);
  }
  return needed;
}

function assertTotals(row: CheckoutRow) {
  const sum = row.lines.reduce((total, line) => total + (line.unitPriceCents ?? 0) * line.quantity, 0);
  if (sum !== row.itemsSubtotalCents || row.itemsSubtotalCents + row.deliveryFeeCents !== row.totalCents) {
    throw new AppError("This quote total does not match its lines.", 409, "QUOTE_INTEGRITY");
  }
}

async function loadCheckout(checkoutId: string) {
  return prisma.commerceCheckout.findUnique({
    where: { id: checkoutId },
    include: { lines: true, orders: { select: { id: true } } }
  });
}

async function revalidateSources(row: CheckoutRow) {
  const merchantIds = new Set(row.lines.map((line) => line.sourceMerchantId).filter(Boolean));
  if (merchantIds.size !== 1) {
    throw new AppError("This quote no longer has one shop.", 409, "QUOTE_SOURCE_CHANGED");
  }
  const merchantId = [...merchantIds][0]!;
  const needed = neededQuantities(row.lines);
  for (const line of row.lines) {
    if (!line.sourceProductId || line.unitPriceCents == null || line.sourceMerchantId !== merchantId) {
      throw new AppError("This quote no longer matches the shop price.", 409, "QUOTE_SOURCE_CHANGED");
    }
    const product = await prisma.product.findUnique({
      where: { id: line.sourceProductId },
      include: { merchant: true, catalogProduct: { select: { status: true } } }
    });
    const quantity = needed.get(line.catalogProductId) ?? line.quantity;
    const catalogOk = product?.catalogProduct && PRICEABLE_CATALOG.has(product.catalogProduct.status);
    const quantityOk = product?.quantityApprox == null || product.quantityApprox >= quantity;
    if (
      !product ||
      product.catalogProductId !== line.catalogProductId ||
      !product.available ||
      product.archived ||
      product.priceCents !== line.unitPriceCents ||
      product.merchantId !== merchantId ||
      !product.merchant.isActive ||
      !product.merchant.acceptsOrders ||
      !catalogOk ||
      !quantityOk ||
      product.currency.toLowerCase() !== "usd"
    ) {
      throw new AppError("This quote no longer matches the shop price.", 409, "QUOTE_SOURCE_CHANGED");
    }
  }
  return merchantId;
}

/** Drop a proposal so its approval id cannot be reused. Does not create a new quote. */
export async function invalidateProposedQuote(checkoutId: string) {
  const current = await prisma.commerceCheckout.findFirst({
    where: { id: checkoutId, validationFixture: false, orders: { none: {} } }
  });
  if (!current) return;
  if (
    current.status !== CommerceCheckoutStatus.PRICE_PROPOSED &&
    current.status !== CommerceCheckoutStatus.CUSTOMER_APPROVED
  ) {
    return;
  }
  await prisma.$transaction(async (tx) => {
    const existingOrders = await tx.commerceOrder.count({ where: { checkoutId } });
    if (existingOrders > 0) return;
    const cleared = await tx.commerceCheckout.updateMany({
      where: {
        id: checkoutId,
        validationFixture: false,
        status: current.status
      },
      data: {
        status: CommerceCheckoutStatus.AWAITING_FULFILLMENT,
        approvalId: null,
        quoteExpiresAt: null,
        approvedAt: null,
        itemsSubtotalCents: 0,
        totalCents: 0
      }
    });
    if (cleared.count !== 1) return;
    await tx.commerceCheckoutLine.updateMany({
      where: { checkoutId },
      data: {
        unitPriceCents: null,
        sourceProductId: null,
        sourceMerchantId: null,
        quotedAt: null
      }
    });
  });
}

export async function readPresentableQuote(checkoutId: string) {
  const row = await prisma.commerceCheckout.findUnique({
    where: { id: checkoutId },
    include: { lines: true }
  });
  if (!row || row.validationFixture || row.status !== CommerceCheckoutStatus.PRICE_PROPOSED) return null;
  if (!row.approvalId || !row.quoteExpiresAt || row.quoteExpiresAt.getTime() <= Date.now()) {
    return { expired: true as const, checkoutId: row.id };
  }
  return {
    expired: false as const,
    checkoutId: row.id,
    approvalId: row.approvalId,
    quoteVersion: row.quoteVersion,
    deliveryFeeCents: row.deliveryFeeCents,
    totalCents: row.totalCents,
    lines: row.lines.map((line) => ({
      name: line.productNameSnapshot,
      quantity: line.quantity,
      lineTotalCents: (line.unitPriceCents ?? 0) * line.quantity
    }))
  };
}

export async function approveProposedQuote(input: {
  checkoutId: string;
  approvalId: string;
  quoteVersion: number;
  actor: QuoteActor;
}) {
  const row = await loadCheckout(input.checkoutId);
  if (!row) throw new AppError("Order not found.", 404, "ORDER_NOT_FOUND");
  assertOwned(row, input.actor);
  if (row.orders.length > 0 && row.approvalId === input.approvalId && row.quoteVersion === input.quoteVersion) {
    return { checkoutId: row.id, status: row.status, approvalId: row.approvalId, quoteVersion: row.quoteVersion, payable: false as const };
  }
  if (row.status === CommerceCheckoutStatus.CUSTOMER_APPROVED && row.approvalId === input.approvalId && row.quoteVersion === input.quoteVersion) {
    return { checkoutId: row.id, status: row.status, approvalId: row.approvalId, quoteVersion: row.quoteVersion, payable: false as const };
  }
  if (row.status !== CommerceCheckoutStatus.PRICE_PROPOSED) {
    throw new AppError("This request is not waiting for confirmation.", 409, "QUOTE_NOT_PROPOSED");
  }
  if (row.approvalId !== input.approvalId || row.quoteVersion !== input.quoteVersion) {
    throw new AppError("That confirmation is for an older total.", 409, "QUOTE_STALE_APPROVAL");
  }
  if (!row.quoteExpiresAt || row.quoteExpiresAt.getTime() <= Date.now()) {
    await invalidateProposedQuote(row.id);
    throw new AppError("That total has expired.", 409, "QUOTE_EXPIRED");
  }
  try {
    assertTotals(row);
    await revalidateSources(row);
  } catch (error) {
    if (error instanceof AppError && error.code === "QUOTE_SOURCE_CHANGED") {
      await invalidateProposedQuote(row.id);
    }
    throw error;
  }

  const approvedAt = new Date();
  const claimed = await prisma.commerceCheckout.updateMany({
    where: {
      id: row.id,
      validationFixture: false,
      status: CommerceCheckoutStatus.PRICE_PROPOSED,
      approvalId: input.approvalId,
      quoteVersion: input.quoteVersion,
      quoteExpiresAt: { gt: new Date() }
    },
    data: {
      status: CommerceCheckoutStatus.CUSTOMER_APPROVED,
      approvedAt
    }
  });
  if (claimed.count !== 1) {
    const again = await loadCheckout(row.id);
    if (
      again &&
      again.status === CommerceCheckoutStatus.CUSTOMER_APPROVED &&
      again.approvalId === input.approvalId &&
      again.quoteVersion === input.quoteVersion
    ) {
      return {
        checkoutId: again.id,
        status: again.status,
        approvalId: again.approvalId,
        quoteVersion: again.quoteVersion,
        payable: false as const
      };
    }
    throw new AppError("That confirmation is for an older total.", 409, "QUOTE_STALE_APPROVAL");
  }
  return {
    checkoutId: row.id,
    status: CommerceCheckoutStatus.CUSTOMER_APPROVED,
    approvalId: input.approvalId,
    quoteVersion: input.quoteVersion,
    payable: false as const
  };
}

async function existingOrder(checkoutId: string) {
  return prisma.commerceOrder.findFirst({
    where: { checkoutId },
    orderBy: { createdAt: "asc" }
  });
}

export async function handoffApprovedQuote(input: {
  checkoutId: string;
  approvalId: string;
  quoteVersion: number;
  paymentMethod: "CASH" | "ECOCASH";
  payerPhone?: string | null;
  actor: QuoteActor;
}) {
  const method = resolveCommercePaymentMethod(input.paymentMethod);
  if (method !== CommercePaymentMethod.CASH && method !== CommercePaymentMethod.ECOCASH) {
    throw new AppError("EcoCash USD and cash on delivery are available.", 400, "ZB_ECOCASH_USD_ONLY");
  }
  if (method === CommercePaymentMethod.ECOCASH && !input.payerPhone) {
    throw new AppError("Enter the EcoCash number you want to pay with.", 400, "INVALID_PAYER_PHONE");
  }

  const row = await loadCheckout(input.checkoutId);
  if (!row) throw new AppError("Order not found.", 404, "ORDER_NOT_FOUND");
  assertOwned(row, input.actor);
  if (row.approvalId !== input.approvalId || row.quoteVersion !== input.quoteVersion) {
    throw new AppError("That confirmation is for an older total.", 409, "QUOTE_STALE_APPROVAL");
  }
  const already = await existingOrder(row.id);
  if (already) {
    if (already.paymentMethod !== method) {
      return {
        orderId: already.id,
        orderNumber: already.orderNumber,
        totalCents: already.totalCents,
        paymentStatus: already.paymentStatus,
        created: false
      };
    }
    return finishExisting(already.id, method, input.payerPhone);
  }
  if (!row.quoteExpiresAt || row.quoteExpiresAt.getTime() <= Date.now()) {
    await invalidateProposedQuote(row.id);
    throw new AppError("That total has expired.", 409, "QUOTE_EXPIRED");
  }
  if (row.status !== CommerceCheckoutStatus.CUSTOMER_APPROVED) {
    throw new AppError("Confirm the total before choosing payment.", 409, "QUOTE_NOT_APPROVED");
  }

  try {
    assertTotals(row);
    await revalidateSources(row);
  } catch (error) {
    if (error instanceof AppError && error.code === "QUOTE_SOURCE_CHANGED") {
      await invalidateProposedQuote(row.id);
    }
    throw error;
  }

  const merchantId = row.lines[0]?.sourceMerchantId;
  if (!merchantId) throw new AppError("This quote no longer matches the shop price.", 409, "QUOTE_SOURCE_CHANGED");

  let createdId: string;
  let created = true;
  try {
    const placed = await prisma.$transaction(async (tx) => {
      const claimed = await tx.commerceCheckout.updateMany({
        where: {
          id: row.id,
          validationFixture: false,
          status: CommerceCheckoutStatus.CUSTOMER_APPROVED,
          approvalId: input.approvalId,
          quoteVersion: input.quoteVersion
        },
        data: {
          paymentMethod: method,
          paymentStatus: paymentStatusForMethod(method),
          status: CommerceCheckoutStatus.CONFIRMED
        }
      });
      if (claimed.count !== 1) {
        const winner = await tx.commerceOrder.findFirst({ where: { checkoutId: row.id } });
        if (!winner) throw new AppError("Confirm the total before choosing payment.", 409, "QUOTE_NOT_APPROVED");
        return { id: winner.id, created: false };
      }
      const order = await createConfirmedCommerceOrder({
        db: tx,
        customerId: row.customerId ?? undefined,
        commerceCustomerId: row.commerceCustomerId ?? undefined,
        merchantId,
        lines: row.lines.map((line) => ({
          productId: line.sourceProductId!,
          productName: line.productNameSnapshot,
          quantity: line.quantity,
          unitPriceCents: line.unitPriceCents!,
          lineTotalCents: line.unitPriceCents! * line.quantity,
          merchantId
        })),
        deliveryLabel: row.deliveryLabel,
        deliveryLatitude: Number(row.deliveryLatitude),
        deliveryLongitude: Number(row.deliveryLongitude),
        typedAddress: row.deliveryLabel,
        customerWhatsAppPhone: row.customerWhatsAppPhone ?? input.actor.phone ?? undefined,
        paymentMethod: method,
        paymentStatus: paymentStatusForMethod(method),
        orderSource: row.orderSource,
        checkoutId: row.id,
        totals: {
          subtotalCents: row.itemsSubtotalCents,
          deliveryFeeCents: row.deliveryFeeCents,
          serviceFeeCents: row.serviceFeeCents,
          totalCents: row.totalCents
        }
      });
      await tx.commerceCheckout.update({
        where: { id: row.id },
        data: { pickupSequence: [order.id] }
      });
      return { id: order.id, created: true };
    });
    createdId = placed.id;
    created = placed.created;
  } catch (error) {
    if (error instanceof AppError && (error.code === "PRICE_CHANGED" || error.code === "PRODUCT_UNAVAILABLE" || error.code === "MERCHANT_CLOSED")) {
      await invalidateProposedQuote(row.id);
      throw new AppError("This quote no longer matches the shop price.", 409, "QUOTE_SOURCE_CHANGED");
    }
    throw error;
  }

  return finishExisting(createdId, method, input.payerPhone, created);
}

async function finishExisting(
  orderId: string,
  method: CommercePaymentMethod,
  payerPhone?: string | null,
  created = false
) {
  const order = await prisma.commerceOrder.findUniqueOrThrow({ where: { id: orderId } });
  if (method === CommercePaymentMethod.CASH) {
    if (created) await notifyMerchantNewOrderSafe(order);
    return {
      orderId: order.id,
      orderNumber: order.orderNumber,
      totalCents: order.totalCents,
      paymentStatus: order.paymentStatus,
      created
    };
  }
  try {
    const payment = await initiateMobileMoneyPaymentForOrder({
      commerceOrderId: order.id,
      payerPhoneRaw: payerPhone ?? "",
      paymentMethod: CommercePaymentMethod.ECOCASH,
      commerceCheckoutId: order.checkoutId ?? undefined
    });
    return {
      orderId: order.id,
      orderNumber: order.orderNumber,
      totalCents: order.totalCents,
      paymentStatus: CommercePaymentStatus.PAYMENT_PENDING,
      created,
      attemptId: payment.attempt.id
    };
  } catch (error) {
    if (error instanceof AppError && error.code === "PAYMENT_ALREADY_PENDING") {
      return {
        orderId: order.id,
        orderNumber: order.orderNumber,
        totalCents: order.totalCents,
        paymentStatus: CommercePaymentStatus.PAYMENT_PENDING,
        created: false
      };
    }
    if (created) {
      await prisma.commerceOrder.update({
        where: { id: order.id },
        data: { paymentStatus: CommercePaymentStatus.PAYMENT_FAILED }
      });
      if (order.checkoutId) {
        await prisma.commerceCheckout.update({
          where: { id: order.checkoutId },
          data: { paymentStatus: CommercePaymentStatus.PAYMENT_FAILED, status: CommerceCheckoutStatus.PAYMENT_FAILED }
        });
      }
    }
    throw error;
  }
}
