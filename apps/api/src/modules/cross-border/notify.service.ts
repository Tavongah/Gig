import { prisma } from "../../config/prisma.js";
import { AppError } from "../../lib/errors.js";
import { isEmailConfigured, sendTransactionalEmail } from "../../lib/email.js";
import { getWhatsAppProvider } from "../whatsapp/provider.js";
import { CROSS_BORDER_TERMS } from "./domain.js";
import { crossBorderEnabled } from "./flag.js";

function money(cents: number): string {
  const dollars = Math.floor(cents / 100);
  const rem = String(cents % 100).padStart(2, "0");
  return `$${dollars}.${rem}`;
}

export async function sendCrossBorderQuote(quoteId: string, actorId: string) {
  if (!crossBorderEnabled()) throw new AppError("South African shopping is not available yet.", 404, "CROSS_BORDER_DISABLED");
  const quote = await prisma.crossBorderQuote.findUnique({
    where: { id: quoteId },
    include: { request: true, lines: true }
  });
  if (!quote) throw new AppError("Quotation not found.", 404, "QUOTE_NOT_FOUND");
  if (quote.status !== "APPROVED" && quote.status !== "SENT") {
    throw new AppError("Approve the quotation before sending it.", 409, "QUOTE_NOT_APPROVED");
  }
  if (quote.expiresAt.getTime() <= Date.now()) throw new AppError("This quotation is expired.", 409, "QUOTE_EXPIRED");
  const channel = quote.request.preferredContactChannel;
  const idempotencyKey = `quote:${quote.id}:deliver`;
  const existing = await prisma.crossBorderNotification.findUnique({ where: { idempotencyKey } });
  if (existing?.status === "ACCEPTED") {
    return { sent: true, duplicate: true, channel, status: existing.status };
  }

  const text = [
    `Your DUTS shopping quotation is ready. Reference ${quote.request.reference}.`,
    ...quote.lines.map((line) => `${line.quantity} x ${line.productName}${line.size ? `, size ${line.size}` : ""}${line.color ? `, colour ${line.color}` : ""}`),
    `Total ${money(quote.totalCents)} ${quote.currency}.`,
    quote.customsIsEstimate ? "Customs is an estimate and is not a guaranteed all-inclusive price." : "Customs on this quotation is the amount DUTS has identified.",
    `This quotation expires ${quote.expiresAt.toISOString()}.`,
    "DUTS will give you a secure payment link separately. This message does not take payment.",
    CROSS_BORDER_TERMS
  ].join("\n");

  await prisma.crossBorderNotification.upsert({
    where: { idempotencyKey },
    create: {
      requestId: quote.requestId,
      quoteId: quote.id,
      channel,
      kind: "QUOTE",
      status: "ATTEMPTED",
      idempotencyKey
    },
    update: { status: "ATTEMPTED", error: null }
  });

  try {
    if (channel === "EMAIL") {
      if (!quote.request.email || !isEmailConfigured()) {
        await prisma.crossBorderNotification.update({
          where: { idempotencyKey },
          data: { status: "FAILED", error: "EMAIL_NOT_CONFIGURED" }
        });
        return {
          sent: false,
          duplicate: false,
          channel,
          status: "FAILED" as const,
          reason: "Email delivery is not configured. The quotation was not marked sent."
        };
      }
      await sendTransactionalEmail({
        to: quote.request.email,
        subject: `Your DUTS quotation ${quote.request.reference}`,
        text,
        html: `<p>${text.replace(/\n/g, "<br>")}</p>`
      });
    } else {
      if (!quote.request.phone) throw new AppError("This request has no WhatsApp number.", 409, "CHANNEL_UNAVAILABLE");
      await getWhatsAppProvider().sendText(quote.request.phone, text);
    }
    await prisma.crossBorderNotification.update({
      where: { idempotencyKey },
      data: { status: "ACCEPTED" }
    });
    await prisma.crossBorderQuote.update({
      where: { id: quote.id },
      data: { status: "SENT", sentAt: new Date() }
    });
    if (quote.request.status === "QUOTED") {
      await prisma.crossBorderRequest.update({ where: { id: quote.requestId }, data: { status: "AWAITING_PAYMENT" } });
    }
    await prisma.crossBorderAuditEvent.create({
      data: { requestId: quote.requestId, actorId, action: "quote_sent", payload: { quoteId, channel } }
    });
    return { sent: true, duplicate: false, channel, status: "ACCEPTED" as const };
  } catch (error) {
    const message = error instanceof Error ? error.message : "send_failed";
    await prisma.crossBorderNotification.update({
      where: { idempotencyKey },
      data: { status: "FAILED", error: message.slice(0, 300) }
    });
    return {
      sent: false,
      duplicate: false,
      channel,
      status: "FAILED" as const,
      reason: message.slice(0, 300)
    };
  }
}
