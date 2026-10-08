import {
  WhatsAppConversationState,
  WhatsAppParty,
  type Prisma
} from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { normalizePhoneNumber } from "../auth/access.service.js";
import type { InteractiveActionRecord } from "./interactive-actions.js";

export type ConversationContext = {
  /** One active unfinished checkout per phone. Placed orders stay independent. */
  checkoutSessionId?: string;
  checkoutSource?: "WHATSAPP" | "WEB_HANDOFF";
  checkoutStatus?: "ACTIVE" | "COMPLETED" | "CANCELLED" | "SUPERSEDED" | "EXPIRED";
  expectedInput?:
    | "NONE"
    | "PRODUCT_TEXT"
    | "PRODUCT_DISAMBIGUATION"
    | "PRODUCT_FLAVOR"
    | "READY_TO_ORDER"
    | "LOCATION"
    | "LOCATION_CLARIFICATION"
    | "ORDER_CONFIRMATION"
    | "PAYMENT_METHOD"
    | "ECOCASH_NUMBER"
    | "PAYMENT_PENDING"
    | "PAYMENT_RETRY"
    | "CHANGE_WHAT"
    | "ACTIVE_ORDER_STATUS"
    | "PENDING_PAYMENT_HANDOFF"
    | "UNLISTED_OFFER"
    | "UNLISTED_QUOTE"
    | "UNLISTED_PAYMENT"
    | "UNLISTED_ECOCASH";
  choiceType?: ConversationContext["expectedInput"];
  choiceId?: string;
  sessionStartedAt?: string;
  consumedHandoffToken?: string;
  pendingHandoffToken?: string;
  lockedProductLines?: Array<{
    productId: string;
    quantity: number;
    productName: string;
    unitPriceCents: number;
    merchantId: string;
    flavorOptionId?: string | null;
    flavorName?: string | null;
    flavorPreference?: "ANY" | "SPECIFIC" | null;
  }>;
  pendingFlavorChoices?: Array<{
    productId: string;
    productName: string;
    flavors: Array<{ id: string | null; name: string }>;
    choiceId?: string;
  }>;
  parkedPayments?: Array<{
    checkoutSessionId: string;
    paymentAttemptId?: string;
    pendingPaymentOrderId?: string;
    paymentPhase?: ConversationContext["paymentPhase"];
  }>;
  statusOrderIds?: string[];
  lastDeliveryLat?: number;
  lastDeliveryLng?: number;
  lastDeliveryLabel?: string;
  requestedItems?: Array<{ query: string; quantity: number }>;
  deliveryLat?: number;
  deliveryLng?: number;
  deliveryLabel?: string;
  /** Customer-entered house/street/landmark text, even when geocode is area-level. */
  deliveryInstructions?: string;
  deliveryPrecision?: "EXACT" | "STREET" | "LANDMARK" | "AREA" | "GPS";
  /** Exact customer-typed address, never rewritten by geocoding. */
  originalTypedAddress?: string;
  pilotLocationMode?: "GPS" | "TYPED_PILOT";
  deliveryLocationDraft?: {
    originalText?: string;
    house?: string;
    street?: string;
    suburb?: string;
    city?: string;
    country?: string;
    landmark?: string;
  };
  locationClarificationType?: "CITY" | "AREA" | "LANDMARK" | "ADDRESS_CHOICE" | "CONFIRM_AREA";
  pendingAreaMatch?: {
    label: string;
    suburb?: string;
    city?: string;
    latitude: number;
    longitude: number;
    originalText: string;
  };
  pendingChoices?: Array<{
    query: string;
    options: Array<{ productId: string; name: string; priceCents: number }>;
    choiceId?: string;
  }>;
  pendingLocationChoices?: Array<{
    label: string;
    formattedAddress?: string;
    latitude: number;
    longitude: number;
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
    flavorOptionId?: string | null;
    flavorName?: string | null;
    flavorPreference?: "ANY" | "SPECIFIC" | null;
  }>;
  merchantId?: string;
  previousMerchantId?: string;
  draftOrderId?: string;
  activeOrderId?: string;
  lastDisambiguationQuery?: string;
  budgetCents?: number;
  /** ISO timestamp when draft quote was last priced */
  draftQuotedAt?: string;
  /**
   * WhatsApp mobile-money payment phase (MVP).
   * SELECT_METHOD → ENTER_PAYMENT_PHONE → PENDING_PROVIDER → (RETRY / CASH fallback)
   */
  paymentPhase?:
    | "SELECT_METHOD"
    | "ENTER_PAYMENT_PHONE"
    | "PENDING_PROVIDER"
    | "FAILED"
    | "EXPIRED";
  paymentAttemptId?: string;
  pendingPaymentOrderId?: string;
  /** Display-local payer number last requested (not PIN). */
  payerPhoneDisplay?: string;
  /** EcoCash vs OneMoney selection for the pending mobile-money attempt. */
  selectedPaymentMethod?: "ECOCASH" | "ONEMONEY";
  /** Idempotent welcome — set after the first idle welcome/menu. */
  welcomeSentAt?: string;
  /** Opaque WhatsApp button/list tokens bound to this conversation. */
  interactiveActions?: InteractiveActionRecord[];
  /** Restore checkout expectedInput after a track-order pick. */
  statusResumeExpected?: ConversationContext["expectedInput"];
  pendingUnlistedQuery?: string;
  unlistedRequestId?: string;
  unlistedApprovalId?: string;
};

export async function getOrCreateConversation(
  phone: string,
  party: WhatsAppParty,
  extras?: { merchantId?: string; customerUserId?: string; commerceCustomerId?: string }
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
      commerceCustomerId: extras?.commerceCustomerId,
      contextJson: {}
    },
    update: {
      ...(extras?.merchantId ? { merchantId: extras.merchantId } : {}),
      ...(extras?.customerUserId ? { customerUserId: extras.customerUserId } : {}),
      ...(extras?.commerceCustomerId ? { commerceCustomerId: extras.commerceCustomerId } : {})
    }
  });
}

export function readContext(conv: { contextJson: Prisma.JsonValue }): ConversationContext {
  if (conv.contextJson && typeof conv.contextJson === "object" && !Array.isArray(conv.contextJson)) {
    return conv.contextJson as ConversationContext;
  }
  return {};
}

/** Expire unfinished WhatsApp checkout drafts. Never cancels placed orders or payments. */
export async function expireStaleCheckoutConversations(): Promise<number> {
  const { sanitizeCheckoutContext, isLivePendingPayment, sessionIsExpired, isUnfinishedCheckout } =
    await import("./checkout-session.js");
  const convs = await prisma.whatsAppConversation.findMany({
    where: {
      party: WhatsAppParty.CUSTOMER,
      state: {
        in: [
          WhatsAppConversationState.IDLE,
          WhatsAppConversationState.BUILDING_CART,
          WhatsAppConversationState.AWAITING_LOCATION,
          WhatsAppConversationState.AWAITING_PRODUCT_CHOICE,
          WhatsAppConversationState.AWAITING_ORDER_CONFIRMATION,
          WhatsAppConversationState.AWAITING_PAYMENT
        ]
      }
    },
    take: 200,
    orderBy: { updatedAt: "asc" }
  });
  let n = 0;
  for (const conv of convs) {
    const ctx = readContext(conv);
    if (isLivePendingPayment(ctx)) continue;
    if (!sessionIsExpired(ctx) || !isUnfinishedCheckout(ctx, conv.state)) continue;
    const sanitized = sanitizeCheckoutContext(conv.state, ctx);
    if (!sanitized.expired) continue;
    await updateConversation(conv.id, { state: sanitized.state, context: sanitized.ctx });
    n += 1;
  }
  return n;
}

export async function updateConversation(
  id: string,
  data: {
    state?: WhatsAppConversationState;
    context?: ConversationContext;
    merchantId?: string | null;
    customerUserId?: string | null;
    commerceCustomerId?: string | null;
  }
) {
  return prisma.whatsAppConversation.update({
    where: { id },
    data: {
      ...(data.state ? { state: data.state } : {}),
      ...(data.context ? { contextJson: data.context as Prisma.InputJsonValue } : {}),
      ...(data.merchantId !== undefined ? { merchantId: data.merchantId } : {}),
      ...(data.customerUserId !== undefined ? { customerUserId: data.customerUserId } : {}),
      ...(data.commerceCustomerId !== undefined
        ? { commerceCustomerId: data.commerceCustomerId }
        : {})
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
