import { prisma } from "../../config/prisma.js";
import { AppError } from "../../lib/errors.js";
import {
  CROSS_BORDER_TERMS_VERSION,
  assertExchangeSnapshot,
  lineTotalCents,
  quoteTotalCents
} from "./domain.js";
import { crossBorderEnabled } from "./flag.js";
import { changeCrossBorderStatus } from "./request.service.js";

function assertEnabled(): void {
  if (!crossBorderEnabled()) throw new AppError("South African shopping is not available yet.", 404, "CROSS_BORDER_DISABLED");
}

export async function createCrossBorderQuote(input: {
  requestId: string;
  actorId: string;
  currency?: string;
  merchandiseSubtotalCents: number;
  saShippingCents: number;
  crossBorderFreightCents: number;
  customsCents: number;
  customsIsEstimate: boolean;
  serviceFeeCents: number;
  zimbabweDeliveryCents: number;
  additionalCents?: number;
  additionalLabel?: string | null;
  zarMerchandiseCents?: number | null;
  exchangeRate?: string | null;
  exchangeRateSource?: string | null;
  exchangeRateAt?: string | null;
  expiresAt: string;
  deliveryEstimateNote?: string | null;
  lines: Array<{ requestLineId: string; unitPriceCents: number }>;
}) {
  assertEnabled();
  if ((input.currency ?? "USD").toUpperCase() !== "USD") {
    throw new AppError("Quotations are issued in USD.", 400, "QUOTE_CURRENCY");
  }
  if (input.customsCents > 0 && input.customsIsEstimate !== true && input.customsIsEstimate !== false) {
    throw new AppError("Say whether customs is an estimate.", 400, "CUSTOMS_DISCLOSURE");
  }
  const rateAt = input.exchangeRateAt ? new Date(input.exchangeRateAt) : null;
  try {
    assertExchangeSnapshot({
      zarMerchandiseCents: input.zarMerchandiseCents,
      exchangeRate: input.exchangeRate,
      exchangeRateSource: input.exchangeRateSource,
      exchangeRateAt: rateAt
    });
  } catch {
    throw new AppError("Enter the exchange rate, source, time and ZAR amount together.", 400, "EXCHANGE_SNAPSHOT_INCOMPLETE");
  }
  const totalCents = safeTotal(input);
  const expiresAt = new Date(input.expiresAt);
  if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) {
    throw new AppError("Choose a quote expiry in the future.", 400, "QUOTE_EXPIRY");
  }

  return prisma.$transaction(async (tx) => {
    const request = await tx.crossBorderRequest.findUnique({
      where: { id: input.requestId },
      include: { lines: true, quotes: true }
    });
    if (!request) throw new AppError("Shopping request not found.", 404, "REQUEST_NOT_FOUND");
    if (!["REQUESTED", "UNDER_REVIEW", "QUOTED", "AWAITING_PAYMENT", "PAYMENT_FAILED"].includes(request.status)) {
      throw new AppError("This request can no longer be re-quoted.", 409, "QUOTE_LOCKED");
    }
    const lineIds = new Set(request.lines.map((line) => line.id));
    if (input.lines.length !== request.lines.length) throw new AppError("Price every product line.", 400, "QUOTE_LINES");
    let merchandise = 0;
    let snapshots: Array<{ source: (typeof request.lines)[number]; unitPriceCents: number; lineTotalCents: number }>;
    try {
      snapshots = input.lines.map((quoted) => {
      const source = request.lines.find((line) => line.id === quoted.requestLineId);
      if (!source || !lineIds.has(quoted.requestLineId)) throw new AppError("Unknown product line.", 400, "QUOTE_LINES");
      const lineTotal = lineTotalCents(quoted.unitPriceCents, source.quantity);
      merchandise += lineTotal;
      return { source, unitPriceCents: quoted.unitPriceCents, lineTotalCents: lineTotal };
      });
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError("Enter a whole-cent price for every product.", 400, "INVALID_CENTS");
    }
    if (merchandise !== input.merchandiseSubtotalCents) {
      throw new AppError("Item prices must add up to the merchandise subtotal.", 400, "QUOTE_MERCHANDISE_MISMATCH");
    }
    const version = request.quotes.reduce((max, quote) => Math.max(max, quote.version), 0) + 1;
    await tx.crossBorderQuote.updateMany({
      where: {
        requestId: request.id,
        status: { in: ["DRAFT", "APPROVED", "SENT", "ACCEPTED"] }
      },
      data: { status: "SUPERSEDED" }
    });
    const quote = await tx.crossBorderQuote.create({
      data: {
        requestId: request.id,
        version,
        currency: "USD",
        merchandiseSubtotalCents: input.merchandiseSubtotalCents,
        saShippingCents: input.saShippingCents,
        crossBorderFreightCents: input.crossBorderFreightCents,
        customsCents: input.customsCents,
        customsIsEstimate: input.customsCents > 0 ? input.customsIsEstimate : false,
        serviceFeeCents: input.serviceFeeCents,
        zimbabweDeliveryCents: input.zimbabweDeliveryCents,
        additionalCents: input.additionalCents ?? 0,
        additionalLabel: input.additionalLabel ?? null,
        totalCents,
        zarMerchandiseCents: input.zarMerchandiseCents ?? null,
        exchangeRate: input.exchangeRate ?? null,
        exchangeRateSource: input.exchangeRateSource ?? null,
        exchangeRateAt: rateAt,
        expiresAt,
        status: "DRAFT",
        deliveryEstimateNote: input.deliveryEstimateNote ?? null,
        termsVersion: CROSS_BORDER_TERMS_VERSION,
        createdById: input.actorId,
        lines: {
          create: snapshots.map((line) => ({
            requestLineId: line.source.id,
            productName: line.source.productName,
            retailer: line.source.retailer,
            quantity: line.source.quantity,
            size: line.source.size,
            color: line.source.color,
            variantDetails: line.source.variantDetails,
            unitPriceCents: line.unitPriceCents,
            lineTotalCents: line.lineTotalCents
          }))
        }
      },
      include: { lines: true }
    });
    await tx.crossBorderAuditEvent.create({
      data: {
        requestId: request.id,
        actorId: input.actorId,
        action: "quote_drafted",
        payload: { quoteId: quote.id, version, totalCents }
      }
    });
    if (request.status === "REQUESTED") {
      await tx.crossBorderRequest.update({ where: { id: request.id }, data: { status: "UNDER_REVIEW" } });
    }
    return quote;
  });
}

function safeTotal(input: {
  merchandiseSubtotalCents: number;
  saShippingCents: number;
  crossBorderFreightCents: number;
  customsCents: number;
  serviceFeeCents: number;
  zimbabweDeliveryCents: number;
  additionalCents?: number;
}): number {
  try {
    return quoteTotalCents({
      merchandiseSubtotalCents: input.merchandiseSubtotalCents,
      saShippingCents: input.saShippingCents,
      crossBorderFreightCents: input.crossBorderFreightCents,
      customsCents: input.customsCents,
      serviceFeeCents: input.serviceFeeCents,
      zimbabweDeliveryCents: input.zimbabweDeliveryCents,
      additionalCents: input.additionalCents ?? 0
    });
  } catch {
    throw new AppError("Enter charges as whole cents. The total must be at least one cent.", 400, "INVALID_CENTS");
  }
}

export async function approveCrossBorderQuote(quoteId: string, actorId: string) {
  assertEnabled();
  return prisma.$transaction(async (tx) => {
    const quote = await tx.crossBorderQuote.findUnique({ where: { id: quoteId } });
    if (!quote || quote.status !== "DRAFT") throw new AppError("Only a draft quotation can be approved.", 409, "QUOTE_NOT_DRAFT");
    if (quote.expiresAt.getTime() <= Date.now()) throw new AppError("This quotation is already expired.", 409, "QUOTE_EXPIRED");
    const updated = await tx.crossBorderQuote.update({
      where: { id: quote.id },
      data: { status: "APPROVED", approvedById: actorId, approvedAt: new Date() }
    });
    await tx.crossBorderRequest.update({ where: { id: quote.requestId }, data: { status: "QUOTED" } });
    await tx.crossBorderAuditEvent.create({
      data: { requestId: quote.requestId, actorId, action: "quote_approved", payload: { quoteId, version: quote.version } }
    });
    return updated;
  });
}

export async function expireCrossBorderQuoteIfNeeded(quoteId: string) {
  const quote = await prisma.crossBorderQuote.findUnique({ where: { id: quoteId } });
  if (!quote) return null;
  if ((quote.status === "SENT" || quote.status === "APPROVED" || quote.status === "ACCEPTED") && quote.expiresAt.getTime() <= Date.now()) {
    return prisma.crossBorderQuote.update({ where: { id: quote.id }, data: { status: "EXPIRED" } });
  }
  return quote;
}

export { changeCrossBorderStatus };
