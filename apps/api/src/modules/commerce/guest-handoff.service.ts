import { createHash, randomBytes } from "node:crypto";
import { WhatsAppConversationState } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { AppError } from "../../lib/errors.js";
import { logDutsFlow } from "../../lib/flow-log.js";
import { getCartTtlMs } from "../whatsapp/cart-mutations.js";
import { formatOrderCartSummary } from "../whatsapp/copy.js";
import { updateConversation, type ConversationContext } from "../whatsapp/conversation.service.js";
import { quoteCart } from "./customer-commerce.service.js";

export type GuestHandoffBasket = {
  lines: Array<{ productId: string; quantity: number }>;
};

export function hashHandoffToken(token: string): string {
  return createHash("sha256").update(token.trim().toUpperCase()).digest("hex");
}

export function generateHandoffToken(): string {
  return randomBytes(8).toString("hex").toUpperCase();
}

export function extractGuestBasketRef(text: string): string | null {
  const trimmed = (text || "").trim();
  const labeled = trimmed.match(/\bRef:\s*([A-F0-9]{12,24})\b/i);
  if (labeled?.[1]) return labeled[1].toUpperCase();
  if (/^[A-F0-9]{16}$/i.test(trimmed)) return trimmed.toUpperCase();
  return null;
}

export function publicWhatsAppDigits(): string | null {
  const raw = process.env.TWILIO_WHATSAPP_FROM || process.env.TWILIO_FROM_NUMBER || "";
  const digits = raw.replace(/\D/g, "");
  return digits.length >= 10 ? digits : null;
}

export function buildWhatsAppHandoffUrl(token: string): string | null {
  const digits = publicWhatsAppDigits();
  if (!digits) return null;
  const text = `Hi DUTS, I want to order my basket.\nRef: ${token}`;
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

export async function createGuestHandoff(input: {
  lat: number;
  lng: number;
  deliveryLabel: string;
  lines: Array<{ productId: string; quantity: number }>;
}) {
  const quote = await quoteCart({
    lat: input.lat,
    lng: input.lng,
    lines: input.lines
  });

  const token = generateHandoffToken();
  const tokenHash = hashHandoffToken(token);
  const expiresAt = new Date(Date.now() + getCartTtlMs());
  const label = input.deliveryLabel.trim() || "Delivery location";

  await prisma.guestCommerceHandoff.create({
    data: {
      tokenHash,
      merchantId: quote.merchant.id,
      basketJson: {
        lines: input.lines.map((l) => ({ productId: l.productId, quantity: l.quantity }))
      },
      deliveryLabel: label.slice(0, 200),
      deliveryLat: input.lat,
      deliveryLng: input.lng,
      expiresAt
    }
  });

  logDutsFlow("GUEST_WHATSAPP_HANDOFF", {
    merchantId: quote.merchant.id,
    itemCount: quote.lines.length
  });

  return {
    token,
    expiresAt: expiresAt.toISOString(),
    whatsappUrl: buildWhatsAppHandoffUrl(token),
    merchantName: quote.merchant.name,
    totalCents: quote.totalCents,
    currency: quote.currency
  };
}

export async function applyGuestHandoffToConversation(input: {
  conversationId: string;
  token: string;
}): Promise<{ ok: true; message: string } | { ok: false; message: string }> {
  const tokenHash = hashHandoffToken(input.token);
  const row = await prisma.guestCommerceHandoff.findUnique({ where: { tokenHash } });
  if (!row) {
    return {
      ok: false,
      message: "I couldn't find that basket. Open DUTS and tap Continue on WhatsApp again."
    };
  }
  if (row.consumedAt) {
    return {
      ok: false,
      message: "That basket was already opened. Tell me if you'd like to change it."
    };
  }
  if (row.expiresAt.getTime() <= Date.now()) {
    return {
      ok: false,
      message: "This cart has expired.\n\nReturn to DUTS and tap Continue on WhatsApp again."
    };
  }

  const payload = row.basketJson as GuestHandoffBasket;
  const lines = Array.isArray(payload?.lines) ? payload.lines : [];
  if (!lines.length) {
    return { ok: false, message: "That basket is empty. Return to DUTS to add products." };
  }

  let quote: Awaited<ReturnType<typeof quoteCart>>;
  try {
    quote = await quoteCart({
      lat: Number(row.deliveryLat),
      lng: Number(row.deliveryLng),
      lines
    });
  } catch (err) {
    const message =
      err instanceof AppError
        ? err.message
        : "Something in that basket is no longer available. Return to DUTS to update it.";
    return { ok: false, message };
  }

  const ctx: ConversationContext = {
    deliveryLat: Number(row.deliveryLat),
    deliveryLng: Number(row.deliveryLng),
    deliveryLabel: row.deliveryLabel,
    merchantId: quote.merchant.id,
    previousMerchantId: quote.merchant.id,
    draftLines: quote.lines,
    requestedItems: quote.lines.map((l) => ({ query: l.productName, quantity: l.quantity })),
    draftQuotedAt: new Date().toISOString()
  };

  await updateConversation(input.conversationId, {
    state: WhatsAppConversationState.AWAITING_ORDER_CONFIRMATION,
    context: ctx,
    merchantId: quote.merchant.id
  });

  await prisma.guestCommerceHandoff.update({
    where: { id: row.id },
    data: { consumedAt: new Date() }
  });

  const message = formatOrderCartSummary({
    heading: "Your DUTS cart",
    shopName: quote.merchant.name,
    lines: quote.lines.map((l) => ({
      quantity: l.quantity,
      productName: l.productName,
      lineTotalCents: l.lineTotalCents
    })),
    subtotalCents: quote.subtotalCents,
    deliveryFeeCents: quote.deliveryFeeCents,
    serviceFeeCents: quote.serviceFeeCents,
    totalCents: quote.totalCents,
    deliveryLabel: row.deliveryLabel,
    includeConfirmChoices: true
  });

  return { ok: true, message };
}
