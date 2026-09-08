import {
  WhatsAppConversationState,
  WhatsAppParty,
  type Prisma
} from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { normalizePhoneNumber } from "../auth/access.service.js";

export type ConversationContext = {
  requestedItems?: Array<{ query: string; quantity: number }>;
  deliveryLat?: number;
  deliveryLng?: number;
  deliveryLabel?: string;
  pendingChoices?: Array<{
    query: string;
    options: Array<{ productId: string; name: string; priceCents: number }>;
  }>;
  /** Merchant product ambiguity (price update / OOS). */
  pendingMerchantProductChoices?: Array<{ productId: string; name: string; priceCents: number }>;
  pendingMerchantAction?: {
    type: "PRICE" | "OOS" | "AVAILABLE";
    priceCents?: number;
  };
  draftLines?: Array<{
    productId: string;
    productName: string;
    quantity: number;
    unitPriceCents: number;
    lineTotalCents: number;
    merchantId: string;
  }>;
  merchantId?: string;
  previousMerchantId?: string;
  draftOrderId?: string;
  activeOrderId?: string;
  lastDisambiguationQuery?: string;
  budgetCents?: number;
  /** ISO timestamp when draft quote was last priced */
  draftQuotedAt?: string;
};

export async function getOrCreateConversation(
  phone: string,
  party: WhatsAppParty,
  extras?: { merchantId?: string; customerUserId?: string }
) {
  const phoneNormalized = normalizePhoneNumber(phone);
  return prisma.whatsAppConversation.upsert({
    where: { phoneNormalized_party: { phoneNormalized, party } },
    create: {
      phoneNormalized,
      party,
      state: WhatsAppConversationState.IDLE,
      merchantId: extras?.merchantId,
      customerUserId: extras?.customerUserId,
      contextJson: {}
    },
    update: {
      ...(extras?.merchantId ? { merchantId: extras.merchantId } : {}),
      ...(extras?.customerUserId ? { customerUserId: extras.customerUserId } : {})
    }
  });
}

export function readContext(conv: { contextJson: Prisma.JsonValue }): ConversationContext {
  if (conv.contextJson && typeof conv.contextJson === "object" && !Array.isArray(conv.contextJson)) {
    return conv.contextJson as ConversationContext;
  }
  return {};
}

export async function updateConversation(
  id: string,
  data: {
    state?: WhatsAppConversationState;
    context?: ConversationContext;
    merchantId?: string | null;
    customerUserId?: string | null;
  }
) {
  return prisma.whatsAppConversation.update({
    where: { id },
    data: {
      ...(data.state ? { state: data.state } : {}),
      ...(data.context ? { contextJson: data.context as Prisma.InputJsonValue } : {}),
      ...(data.merchantId !== undefined ? { merchantId: data.merchantId } : {}),
      ...(data.customerUserId !== undefined ? { customerUserId: data.customerUserId } : {})
    }
  });
}

/** Persist inbound WA message id; returns false if duplicate (already processed). */
export async function claimInboundMessage(
  providerMessageId: string,
  phoneNormalized: string,
  party?: WhatsAppParty,
  summary?: string
): Promise<boolean> {
  const existing = await prisma.whatsAppInboundMessage.findUnique({
    where: { providerMessageId }
  });
  if (existing) return false;

  try {
    await prisma.whatsAppInboundMessage.create({
      data: {
        providerMessageId,
        phoneNormalized,
        party,
        summary
      }
    });
    try {
      const { logDutsFlow } = await import("../../lib/flow-log.js");
      logDutsFlow("WHATSAPP_INBOUND", {
        userRole: party,
        phone: phoneNormalized.slice(-4),
        providerMessageId: providerMessageId.slice(0, 24)
      });
    } catch {
      /* ignore */
    }
    return true;
  } catch (error) {
    // Race: duplicate provider message id — idempotent no-op
    if (error && typeof error === "object" && "code" in error && (error as { code: string }).code === "P2002") {
      return false;
    }
    return false;
  }
}
