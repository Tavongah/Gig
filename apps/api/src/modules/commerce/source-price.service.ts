/**
 * Courier merchandise totals are proposals until the customer confirms them.
 * Confirmation does not create a shop order or mark cash as paid.
 */
import { randomUUID } from "node:crypto";
import {
  CommerceCheckoutStatus,
  CommercePaymentAttemptStatus,
  CommercePaymentMethod,
  CommercePaymentStatus,
  DeliveryJobKind,
  GigStatus,
  Prisma,
  SourcePriceProposalStatus
} from "@prisma/client";
import { formatSourcePriceConfirmation } from "@gigflow/shared";
import { prisma } from "../../config/prisma.js";
import { AppError } from "../../lib/errors.js";
import { logDutsFlow } from "../../lib/flow-log.js";
import { quoteTtlMs } from "./quote-proposal.service.js";
import type { QuoteActor } from "./quote-approval.service.js";

const ASSIGNED: GigStatus[] = [
  GigStatus.WORKER_ASSIGNED,
  GigStatus.WORKER_EN_ROUTE,
  GigStatus.WORKER_ARRIVED
];

const OUT_FOR_DELIVERY: GigStatus[] = [
  GigStatus.PACKAGE_COLLECTED,
  GigStatus.EN_ROUTE_TO_DROPOFF,
  GigStatus.ARRIVED_AT_DROPOFF,
  GigStatus.WAITING_CUSTOMER_CONFIRMATION,
  GigStatus.COMPLETED
];

function assertMerchandiseCents(merchandiseCents: number) {
  if (!Number.isInteger(merchandiseCents) || merchandiseCents < 1 || merchandiseCents > 10_000_000) {
    throw new AppError("Enter the merchandise total in cents.", 400, "INVALID_MERCHANDISE_PRICE");
  }
}

async function loadSourceJob(gigId: string, workerId: string) {
  const gig = await prisma.gig.findUnique({ where: { id: gigId } });
  if (!gig || gig.deliveryJobKind !== DeliveryJobKind.SOURCE_AND_DELIVER) {
    throw new AppError("This action is only for a sourcing delivery.", 409, "NOT_SOURCE_DELIVERY");
  }
  if (gig.assignedWorkerId !== workerId) {
    throw new AppError("Only the assigned courier can update this delivery.", 403, "COURIER_NOT_ASSIGNED");
  }
  if (OUT_FOR_DELIVERY.includes(gig.status) || gig.status === GigStatus.CANCELLED) {
    throw new AppError("This delivery can no longer change its merchandise total.", 409, "SOURCE_PRICE_LOCKED");
  }
  if (!ASSIGNED.includes(gig.status)) {
    throw new AppError("Accept the sourcing job before setting a price.", 409, "SOURCE_NOT_ACCEPTED");
  }
  const checkout = await prisma.commerceCheckout.findFirst({
    where: { linkedDeliveryGigId: gigId },
    include: { orders: { select: { id: true } }, paymentAttempts: true }
  });
  if (!checkout || checkout.orders.length > 0 || checkout.fulfillmentOwner === "SHOP") {
    throw new AppError("A shop is already fulfilling this request.", 409, "SHOP_FULFILLMENT_OWNED");
  }
  return { gig, checkout };
}

async function latestConfirmedProposal(checkoutId: string) {
  return prisma.sourcePriceProposal.findFirst({
    where: { checkoutId, status: SourcePriceProposalStatus.CONFIRMED },
    orderBy: { resolvedAt: "desc" }
  });
}

async function restoreConfirmedSourceAmount(
  tx: Prisma.TransactionClient,
  checkout: { id: string; deliveryFeeCents: number; serviceFeeCents: number; approvedAt: Date | null },
  confirmed: { id: string; merchandiseCents: number }
) {
  await tx.commerceCheckout.updateMany({
    where: { id: checkout.id, fulfillmentOwner: "COURIER_SOURCE" },
    data: {
      status: CommerceCheckoutStatus.CUSTOMER_APPROVED,
      approvalId: confirmed.id,
      approvedAt: checkout.approvedAt ?? new Date(),
      itemsSubtotalCents: confirmed.merchandiseCents,
      totalCents: confirmed.merchandiseCents + checkout.deliveryFeeCents + checkout.serviceFeeCents,
      paymentMethod: CommercePaymentMethod.CASH,
      paymentStatus: CommercePaymentStatus.DUE_ON_DELIVERY,
      quoteExpiresAt: null
    }
  });
}

async function notifyCustomer(checkoutId: string, body: string) {
  const checkout = await prisma.commerceCheckout.findUnique({
    where: { id: checkoutId },
    select: {
      customerWhatsAppPhone: true,
      commerceCustomer: { select: { whatsappPhone: true } }
    }
  });
  const phone = checkout?.customerWhatsAppPhone || checkout?.commerceCustomer?.whatsappPhone;
  if (!phone) return;
  try {
    const { notifyCustomerStatus } = await import("../whatsapp/merchant-handler.js");
    await notifyCustomerStatus(phone, body);
  } catch {
    /* non-blocking */
  }
}

export async function proposeSourceMerchandisePrice(input: {
  gigId: string;
  workerId: string;
  merchandiseCents: number;
}) {
  assertMerchandiseCents(input.merchandiseCents);
  const { gig, checkout } = await loadSourceJob(input.gigId, input.workerId);
  const paidAttempt = checkout.paymentAttempts.find((attempt) => attempt.status === CommercePaymentAttemptStatus.PAID);
  if (checkout.paymentStatus === CommercePaymentStatus.PAID || paidAttempt) {
    throw new AppError("A completed payment cannot be changed.", 409, "PRICE_LOCKED");
  }
  if (OUT_FOR_DELIVERY.includes(gig.status)) {
    throw new AppError("This delivery can no longer change its merchandise total.", 409, "SOURCE_PRICE_LOCKED");
  }

  if (checkout.paymentMethod !== CommercePaymentMethod.CASH) {
    throw new AppError("Source & Deliver V1 accepts cash only.", 409, "SOURCE_V1_CASH_ONLY");
  }
  const confirmed = await latestConfirmedProposal(checkout.id);
  if (confirmed && confirmed.merchandiseCents === input.merchandiseCents) {
    await prisma.$transaction(async (tx) => {
      await tx.sourcePriceProposal.updateMany({
        where: { checkoutId: checkout.id, status: SourcePriceProposalStatus.PROPOSED },
        data: { status: SourcePriceProposalStatus.SUPERSEDED, resolvedAt: new Date() }
      });
      await restoreConfirmedSourceAmount(tx, checkout, confirmed);
    });
    return {
      proposalId: confirmed.id,
      quoteVersion: checkout.quoteVersion,
      merchandiseCents: confirmed.merchandiseCents,
      unchanged: true as const
    };
  }
  const existing = await prisma.sourcePriceProposal.findFirst({
    where: { checkoutId: checkout.id, status: SourcePriceProposalStatus.PROPOSED },
    orderBy: { createdAt: "desc" }
  });
  if (
    existing &&
    existing.workerId === input.workerId &&
    existing.merchandiseCents === input.merchandiseCents &&
    checkout.approvalId === existing.id &&
    checkout.status === CommerceCheckoutStatus.PRICE_PROPOSED
  ) {
    return { proposalId: existing.id, quoteVersion: checkout.quoteVersion, merchandiseCents: existing.merchandiseCents };
  }

  const now = new Date();
  const proposalId = randomUUID();
  const quoteVersion = checkout.quoteVersion + 1;
  await prisma.$transaction(async (tx) => {
    if (existing) {
      await tx.sourcePriceProposal.update({
        where: { id: existing.id },
        data: { status: SourcePriceProposalStatus.SUPERSEDED, resolvedAt: now }
      });
    }
    await tx.sourcePriceProposal.create({
      data: {
        id: proposalId,
        checkoutId: checkout.id,
        gigId: gig.id,
        workerId: input.workerId,
        merchandiseCents: input.merchandiseCents,
        status: SourcePriceProposalStatus.PROPOSED
      }
    });
    const written = await tx.commerceCheckout.updateMany({
      where: {
        id: checkout.id,
        OR: [{ fulfillmentOwner: null }, { fulfillmentOwner: "COURIER_SOURCE" }],
        status: { in: [CommerceCheckoutStatus.AWAITING_FULFILLMENT, CommerceCheckoutStatus.PRICE_PROPOSED, CommerceCheckoutStatus.CUSTOMER_APPROVED] }
      },
      data: {
        status: CommerceCheckoutStatus.PRICE_PROPOSED,
        fulfillmentOwner: "COURIER_SOURCE",
        approvalId: proposalId,
        quoteVersion,
        quoteExpiresAt: new Date(now.getTime() + quoteTtlMs()),
        ...(confirmed
          ? {}
          : {
              approvedAt: null,
              itemsSubtotalCents: 0,
              totalCents: 0,
              paymentStatus: CommercePaymentStatus.PENDING
            })
      }
    });
    if (written.count !== 1) {
      throw new AppError("A shop is already fulfilling this request.", 409, "SHOP_FULFILLMENT_OWNED");
    }
  });

  logDutsFlow("SOURCE_PRICE_PROPOSED", {
    gigId: gig.id,
    userId: input.workerId,
    userRole: "WORKER",
    checkoutId: checkout.id,
    merchandiseCents: input.merchandiseCents,
    quoteVersion
  });
  await notifyCustomer(
    checkout.id,
    formatSourcePriceConfirmation({
      merchandiseCents: input.merchandiseCents,
      deliveryFeeCents: checkout.deliveryFeeCents,
      serviceFeeCents: checkout.serviceFeeCents
    })
  );
  return { proposalId, quoteVersion, merchandiseCents: input.merchandiseCents };
}

export async function confirmSourceMerchandisePrice(input: {
  checkoutId: string;
  approvalId: string;
  quoteVersion: number;
  actor: QuoteActor;
}) {
  const { ownsCheckout } = await import("./quote-approval.service.js");
  const row = await prisma.commerceCheckout.findUnique({
    where: { id: input.checkoutId },
    include: { paymentAttempts: true }
  });
  if (!row) throw new AppError("Order not found.", 404, "ORDER_NOT_FOUND");
  if (!ownsCheckout(row as never, input.actor)) throw new AppError("Order not found.", 404, "ORDER_NOT_FOUND");
  if (row.fulfillmentOwner === "SHOP") {
    throw new AppError("This request is not waiting for confirmation.", 409, "QUOTE_NOT_PROPOSED");
  }
  if (row.paymentMethod !== CommercePaymentMethod.CASH) {
    throw new AppError("Source & Deliver V1 accepts cash only.", 409, "SOURCE_V1_CASH_ONLY");
  }
  const proposal = await prisma.sourcePriceProposal.findFirst({
    where: { id: input.approvalId, checkoutId: row.id }
  });
  if (
    row.status === CommerceCheckoutStatus.CUSTOMER_APPROVED &&
    row.approvalId === input.approvalId &&
    row.quoteVersion === input.quoteVersion &&
    proposal?.status === SourcePriceProposalStatus.CONFIRMED
  ) {
    return presentConfirmation(row, proposal.merchandiseCents);
  }
  if (row.status !== CommerceCheckoutStatus.PRICE_PROPOSED || !proposal || proposal.status !== SourcePriceProposalStatus.PROPOSED) {
    throw new AppError("This request is not waiting for confirmation.", 409, "QUOTE_NOT_PROPOSED");
  }
  if (row.approvalId !== input.approvalId || row.quoteVersion !== input.quoteVersion) {
    throw new AppError("That confirmation is for an older total.", 409, "QUOTE_STALE_APPROVAL");
  }
  if (!row.quoteExpiresAt || row.quoteExpiresAt.getTime() <= Date.now()) {
    throw new AppError("That total has expired.", 409, "QUOTE_EXPIRED");
  }
  const gig = await prisma.gig.findUnique({ where: { id: proposal.gigId } });
  if (!gig || gig.assignedWorkerId !== proposal.workerId || gig.deliveryJobKind !== DeliveryJobKind.SOURCE_AND_DELIVER) {
    throw new AppError("That confirmation is for an older total.", 409, "QUOTE_STALE_APPROVAL");
  }
  const totalCents = proposal.merchandiseCents + row.deliveryFeeCents + row.serviceFeeCents;
  const claimed = await prisma.commerceCheckout.updateMany({
    where: {
      id: row.id,
      status: CommerceCheckoutStatus.PRICE_PROPOSED,
      approvalId: input.approvalId,
      quoteVersion: input.quoteVersion,
      OR: [{ fulfillmentOwner: null }, { fulfillmentOwner: "COURIER_SOURCE" }]
    },
    data: {
      status: CommerceCheckoutStatus.CUSTOMER_APPROVED,
      fulfillmentOwner: "COURIER_SOURCE",
      approvedAt: new Date(),
      itemsSubtotalCents: proposal.merchandiseCents,
      totalCents,
      paymentMethod: CommercePaymentMethod.CASH,
      paymentStatus: CommercePaymentStatus.DUE_ON_DELIVERY
    }
  });
  if (claimed.count !== 1) {
    throw new AppError("That confirmation is for an older total.", 409, "QUOTE_STALE_APPROVAL");
  }
  const confirmedAt = new Date();
  await prisma.sourcePriceProposal.updateMany({
    where: { checkoutId: row.id, status: SourcePriceProposalStatus.CONFIRMED, NOT: { id: proposal.id } },
    data: { status: SourcePriceProposalStatus.SUPERSEDED, resolvedAt: confirmedAt }
  });
  await prisma.sourcePriceProposal.update({
    where: { id: proposal.id },
    data: { status: SourcePriceProposalStatus.CONFIRMED, resolvedAt: confirmedAt }
  });
  logDutsFlow("SOURCE_PRICE_CONFIRMED", {
    gigId: proposal.gigId,
    userId: proposal.workerId,
    checkoutId: row.id,
    merchandiseCents: proposal.merchandiseCents,
    totalCents
  });
  const saved = await prisma.commerceCheckout.findUniqueOrThrow({ where: { id: row.id } });
  return presentConfirmation(saved, proposal.merchandiseCents);
}

function presentConfirmation(
  row: { id: string; status: CommerceCheckoutStatus; approvalId: string | null; quoteVersion: number; paymentMethod: CommercePaymentMethod; totalCents: number },
  merchandiseCents: number
) {
  return {
    checkoutId: row.id,
    status: row.status,
    approvalId: row.approvalId,
    quoteVersion: row.quoteVersion,
    payable: false as const,
    sourceDelivery: true as const,
    paymentMethod: row.paymentMethod,
    merchandiseCents,
    totalCents: row.totalCents
  };
}

export async function rejectSourceMerchandisePrice(checkoutId: string, actor: QuoteActor) {
  const { ownsCheckout } = await import("./quote-approval.service.js");
  const row = await prisma.commerceCheckout.findUnique({ where: { id: checkoutId } });
  if (!row || row.fulfillmentOwner !== "COURIER_SOURCE") return;
  if (!ownsCheckout(row as never, actor)) throw new AppError("Order not found.", 404, "ORDER_NOT_FOUND");
  if (row.status === CommerceCheckoutStatus.CUSTOMER_APPROVED) {
    throw new AppError("This total is already confirmed.", 409, "SOURCE_PRICE_CONFIRMED");
  }
  if (row.status !== CommerceCheckoutStatus.PRICE_PROPOSED || !row.approvalId) return;
  await declineOpenSourceProposal(checkoutId, "REJECTED");
  logDutsFlow("SOURCE_PRICE_REJECTED", { checkoutId, userId: actor.userId ?? undefined });
}

export async function declineOpenSourceProposal(checkoutId: string, outcome: "REJECTED" | "INVALIDATED") {
  const checkout = await prisma.commerceCheckout.findUnique({ where: { id: checkoutId } });
  if (!checkout || checkout.fulfillmentOwner !== "COURIER_SOURCE") return;
  const confirmed = await latestConfirmedProposal(checkoutId);
  await prisma.$transaction(async (tx) => {
    await tx.sourcePriceProposal.updateMany({
      where: { checkoutId, status: SourcePriceProposalStatus.PROPOSED },
      data: { status: outcome, resolvedAt: new Date() }
    });
    if (confirmed) {
      await restoreConfirmedSourceAmount(tx, checkout, confirmed);
      return;
    }
    if (checkout.status === CommerceCheckoutStatus.PRICE_PROPOSED) {
      await tx.commerceCheckout.updateMany({
        where: { id: checkoutId, status: CommerceCheckoutStatus.PRICE_PROPOSED },
        data: {
          status: CommerceCheckoutStatus.AWAITING_FULFILLMENT,
          approvalId: null,
          quoteExpiresAt: null,
          approvedAt: null,
          itemsSubtotalCents: 0,
          totalCents: 0,
          paymentStatus: CommercePaymentStatus.PENDING
        }
      });
    }
  });
}

export async function invalidateCourierSourceProposal(checkoutId: string, workerId: string) {
  await declineOpenSourceProposal(checkoutId, "INVALIDATED");
  logDutsFlow("SOURCE_PRICE_INVALIDATED", { checkoutId, userId: workerId, userRole: "WORKER" });
}

export async function reportSourceProductsNotFound(gigId: string, workerId: string) {
  const { gig, checkout } = await loadSourceJob(gigId, workerId);
  const { releaseCommerceDelivery } = await import("../gigs/delivery.service.js");
  const released = await releaseCommerceDelivery(gigId, workerId, { reason: "OTHER", note: "products_not_found" });
  logDutsFlow("SOURCE_PRODUCTS_NOT_FOUND", { gigId: gig.id, userId: workerId, userRole: "WORKER", checkoutId: checkout.id });
  return released;
}

export async function assertSourceMayLeaveForDelivery(gigId: string) {
  const gig = await prisma.gig.findUnique({ where: { id: gigId } });
  if (!gig || gig.deliveryJobKind !== DeliveryJobKind.SOURCE_AND_DELIVER) return;
  const checkout = await prisma.commerceCheckout.findFirst({
    where: { linkedDeliveryGigId: gigId },
    include: { paymentAttempts: true }
  });
  if (!checkout) throw new AppError("This request isn't ready for delivery.", 409, "SOURCE_PRICE_UNCONFIRMED");
  if (checkout.paymentMethod !== CommercePaymentMethod.CASH) {
    throw new AppError("Source & Deliver V1 accepts cash only.", 409, "SOURCE_V1_CASH_ONLY");
  }
  const pending = await prisma.sourcePriceProposal.findFirst({
    where: { checkoutId: checkout.id, status: SourcePriceProposalStatus.PROPOSED }
  });
  const confirmed = await latestConfirmedProposal(checkout.id);
  const expectedTotal = confirmed ? confirmed.merchandiseCents + checkout.deliveryFeeCents + checkout.serviceFeeCents : null;
  if (
    pending ||
    !confirmed ||
    checkout.status !== CommerceCheckoutStatus.CUSTOMER_APPROVED ||
    checkout.itemsSubtotalCents !== confirmed.merchandiseCents ||
    checkout.totalCents !== expectedTotal ||
    checkout.paymentStatus !== CommercePaymentStatus.DUE_ON_DELIVERY ||
    !gig.assignedWorkerId
  ) {
    throw new AppError("The customer has not confirmed the merchandise total.", 409, "SOURCE_PRICE_UNCONFIRMED");
  }
}

export async function settleSourcePaymentChoice(input: {
  checkoutId: string;
  paymentMethod: "CASH" | "ECOCASH";
}) {
  const row = await prisma.commerceCheckout.findUnique({
    where: { id: input.checkoutId },
    include: { paymentAttempts: true }
  });
  if (!row || row.fulfillmentOwner !== "COURIER_SOURCE") {
    throw new AppError("Confirm the total before choosing payment.", 409, "QUOTE_NOT_APPROVED");
  }
  if (row.status !== CommerceCheckoutStatus.CUSTOMER_APPROVED) {
    throw new AppError("Confirm the total before choosing payment.", 409, "QUOTE_NOT_APPROVED");
  }
  if (row.linkedDeliveryGigId) {
    const gig = await prisma.gig.findUnique({
      where: { id: row.linkedDeliveryGigId },
      select: { status: true, deliveryJobKind: true }
    });
    if (gig?.deliveryJobKind === DeliveryJobKind.SOURCE_AND_DELIVER && gig.status === GigStatus.CANCELLED) {
      throw new AppError("This order was cancelled.", 409, "SOURCE_DELIVERY_CANCELLED");
    }
  }
  const orders = await prisma.commerceOrder.count({ where: { checkoutId: row.id } });
  if (orders > 0) throw new AppError("A shop is already fulfilling this request.", 409, "SHOP_FULFILLMENT_OWNED");
  if (input.paymentMethod !== "CASH" || row.paymentMethod !== CommercePaymentMethod.CASH) {
    throw new AppError("Source & Deliver V1 accepts cash only.", 409, "SOURCE_V1_CASH_ONLY");
  }
  await prisma.commerceCheckout.updateMany({
    where: { id: row.id, status: CommerceCheckoutStatus.CUSTOMER_APPROVED, fulfillmentOwner: "COURIER_SOURCE" },
    data: {
      paymentMethod: CommercePaymentMethod.CASH,
      paymentStatus: CommercePaymentStatus.DUE_ON_DELIVERY
    }
  });
  return {
    orderId: row.id,
    orderNumber: row.checkoutNumber,
    totalCents: row.totalCents,
    paymentStatus: CommercePaymentStatus.DUE_ON_DELIVERY,
    created: false,
    sourceDelivery: true as const
  };
}

