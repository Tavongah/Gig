import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { AppError } from "../../lib/errors.js";
import {
  CROSS_BORDER_TERMS_VERSION,
  type ContactChannel,
  type NormalizedLine,
  type RequestStatus,
  assertTransition,
  canTransition,
  customerStatusMessage,
  localDeliveryCoverage,
  normalizeCustomer,
  normalizeLines
} from "./domain.js";
import { crossBorderEnabled } from "./flag.js";

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function newPublicToken(): string {
  return randomBytes(32).toString("base64url");
}

function assertEnabled(): void {
  if (!crossBorderEnabled()) {
    throw new AppError("South African shopping is not available yet.", 404, "CROSS_BORDER_DISABLED");
  }
}

async function nextReference(tx: Prisma.TransactionClient): Promise<string> {
  const rows = await tx.$queryRaw<Array<{ nextValue: number }>>`
    UPDATE "CrossBorderReferenceCounter"
    SET "nextValue" = "nextValue" + 1
    WHERE id = 1
    RETURNING "nextValue" - 1 AS "nextValue"
  `;
  const value = rows[0]?.nextValue;
  if (!Number.isInteger(value)) throw new AppError("Could not allocate a request reference.", 500, "REFERENCE_FAILED");
  return `CB-${value}`;
}

export async function createCrossBorderRequest(input: {
  customerName: string;
  phone?: string | null;
  email?: string | null;
  preferredContactChannel?: ContactChannel | null;
  destinationCity: string;
  deliveryAddress: string;
  deliveryInstructions?: string | null;
  lines: Parameters<typeof normalizeLines>[0];
  source: "WEB" | "WHATSAPP";
  customerId?: string | null;
  whatsappIdempotencyKey?: string | null;
}) {
  assertEnabled();
  const customer = normalizeCustomer(input);
  const lines = normalizeLines(input.lines);
  const trackingToken = newPublicToken();
  const trackingTokenHash = hashToken(trackingToken);

  try {
    const created = await prisma.$transaction(async (tx) => {
      if (input.whatsappIdempotencyKey) {
        const existing = await tx.crossBorderRequest.findUnique({
          where: { whatsappIdempotencyKey: input.whatsappIdempotencyKey }
        });
        if (existing) return { request: existing, replay: true };
      }
      const reference = await nextReference(tx);
      const request = await tx.crossBorderRequest.create({
        data: {
          reference,
          customerId: input.customerId ?? null,
          customerName: customer.customerName,
          phone: customer.phone,
          email: customer.email,
          preferredContactChannel: customer.preferredContactChannel,
          destinationCity: customer.destinationCity,
          deliveryAddress: customer.deliveryAddress,
          deliveryInstructions: customer.deliveryInstructions,
          trackingTokenHash,
          source: input.source,
          whatsappIdempotencyKey: input.whatsappIdempotencyKey ?? null,
          lines: {
            create: lines.map((line, index) => ({ ...line, sortOrder: index }))
          }
        },
        include: { lines: { orderBy: { sortOrder: "asc" } } }
      });
      await tx.crossBorderAuditEvent.create({
        data: {
          requestId: request.id,
          action: "request_created",
          payload: { reference, source: input.source, lineCount: lines.length }
        }
      });
      return { request, replay: false };
    });
    return {
      request: created.request,
      trackingToken: created.replay ? null : trackingToken,
      replay: created.replay,
      message: `Thank you for shopping with DUTS! We've received your South African shopping request ${created.request.reference}. Our team will verify the products and send your quotation to your selected contact.`
    };
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (error instanceof Error && error.message.startsWith("INVALID_")) {
      throw new AppError("Check the shopping request and try again.", 400, error.message);
    }
    if (error instanceof Error && (error.message === "CONTACT_REQUIRED" || error.message === "CHANNEL_UNAVAILABLE" || error.message === "UNSAFE_PRODUCT_URL")) {
      throw new AppError(publicIntakeMessage(error.message), 400, error.message);
    }
    throw error;
  }
}

function publicIntakeMessage(code: string): string {
  if (code === "CONTACT_REQUIRED") return "Add a phone number or an email address.";
  if (code === "CHANNEL_UNAVAILABLE") return "Choose a contact method DUTS can use. WhatsApp needs a phone number. Email needs an email address.";
  if (code === "UNSAFE_PRODUCT_URL") return "Send a public https product link.";
  return "Check the shopping request and try again.";
}

export async function publicTracking(token: string) {
  const request = await prisma.crossBorderRequest.findUnique({
    where: { trackingTokenHash: hashToken(token) },
    include: {
      lines: { orderBy: { sortOrder: "asc" } },
      shipment: true
    }
  });
  if (!request) throw new AppError("Shopping request not found.", 404, "REQUEST_NOT_FOUND");
  return {
    reference: request.reference,
    status: request.status,
    message: customerStatusMessage(request.status as RequestStatus),
    destinationCity: request.destinationCity,
    localDeliveryCoverage: localDeliveryCoverage(request.destinationCity),
    lines: request.lines.map((line) => ({
      retailer: line.retailer,
      productName: line.productName,
      quantity: line.quantity,
      size: line.size,
      color: line.color,
      variantDetails: line.variantDetails
    })),
    shipment: request.shipment
      ? {
          shipmentStatus: request.shipment.shipmentStatus,
          shippingProvider: request.shipment.shippingProvider,
          trackingNumber: request.shipment.trackingNumber
        }
      : null,
    termsVersion: CROSS_BORDER_TERMS_VERSION
  };
}

export async function listCrossBorderRequests(status?: string) {
  assertEnabled();
  return prisma.crossBorderRequest.findMany({
    where: status ? { status: status as never } : undefined,
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { lines: true, quotes: { orderBy: { version: "desc" }, take: 1 } }
  });
}

export async function getCrossBorderRequest(id: string) {
  assertEnabled();
  const request = await prisma.crossBorderRequest.findUnique({
    where: { id },
    include: {
      lines: { orderBy: { sortOrder: "asc" } },
      quotes: { orderBy: { version: "desc" }, include: { lines: true } },
      payments: { orderBy: { createdAt: "desc" } },
      shipment: true,
      notifications: { orderBy: { createdAt: "desc" } },
      events: { orderBy: { createdAt: "desc" }, take: 50 }
    }
  });
  if (!request) throw new AppError("Shopping request not found.", 404, "REQUEST_NOT_FOUND");
  return {
    ...request,
    localDeliveryCoverage: localDeliveryCoverage(request.destinationCity)
  };
}

export async function changeCrossBorderStatus(input: {
  requestId: string;
  to: RequestStatus;
  actorId: string;
  action: string;
}) {
  assertEnabled();
  return prisma.$transaction(async (tx) => {
    const request = await tx.crossBorderRequest.findUnique({ where: { id: input.requestId } });
    if (!request) throw new AppError("Shopping request not found.", 404, "REQUEST_NOT_FOUND");
    const from = request.status as RequestStatus;
    if (!canTransition(from, input.to)) {
      throw new AppError("That status change is not allowed.", 409, "CROSS_BORDER_TRANSITION");
    }
    assertTransition(from, input.to);
    const updated = await tx.crossBorderRequest.update({
      where: { id: request.id },
      data: { status: input.to }
    });
    await tx.crossBorderAuditEvent.create({
      data: {
        requestId: request.id,
        actorId: input.actorId,
        action: input.action,
        payload: { from, to: input.to }
      }
    });
    return updated;
  });
}

export function newDraftId(): string {
  return randomUUID();
}
