import { OrderSource, WhatsAppConversationState, WhatsAppParty } from "@prisma/client";
import { parseUnlistedItemRequestEnabled, parseUnlistedRequestText } from "@gigflow/shared";
import { prisma } from "../../config/prisma.js";
import { AppError } from "../../lib/errors.js";
import {
  createUnlistedItemRequest,
  approveUnlistedQuote,
  declineUnlistedQuote,
  getUnlistedRequest,
  type UnlistedPublicRequest
} from "../commerce/unlisted-item.service.js";
import { initiateUnlistedEcoCashPayment } from "../commerce/unlisted-item-payment.js";
import { ensureWhatsAppCommerceCustomer } from "../commerce/commerce-customer.service.js";
import { readContext, updateConversation, type ConversationContext } from "./conversation.service.js";
import { setExpected } from "./checkout-session.js";
import { getWhatsAppProvider } from "./provider.js";
import {
  sendLocationAsk,
  sendUnlistedOffer,
  sendUnlistedPaymentChoice,
  sendUnlistedQuoteMessage,
  sendShopPrompt
} from "./customer-interactive.js";
import {
  formatEcoCashPrompt,
  formatMobileMoneyPending,
  formatUnlistedDeclined,
  formatUnlistedExpired,
  formatUnlistedNeedsAttention,
  formatUnlistedNotFoundCustomer,
  formatUnlistedPaid,
  formatUnlistedSearching
} from "./copy.js";
import type { InteractiveActionRecord } from "./interactive-actions.js";
import { notifyCustomerStatus } from "./merchant-handler.js";

export function unlistedFeatureEnabled(): boolean {
  return parseUnlistedItemRequestEnabled(process.env.UNLISTED_ITEM_REQUEST_ENABLED);
}

export function isUnlistedExpected(expected?: string | null): boolean {
  return (
    expected === "UNLISTED_OFFER" ||
    expected === "UNLISTED_QUOTE" ||
    expected === "UNLISTED_PAYMENT" ||
    expected === "UNLISTED_ECOCASH"
  );
}

export async function offerUnlistedItemIfEnabled(
  phone: string,
  convId: string,
  ctx: ConversationContext,
  itemName: string
): Promise<{ handled: boolean } | null> {
  if (!unlistedFeatureEnabled()) return null;
  const query = itemName.trim().slice(0, 180);
  if (!query) return null;
  let conversationId = convId;
  if (!conversationId) {
    const conv = await prisma.whatsAppConversation.findUnique({
      where: { phoneNormalized_party: { phoneNormalized: phone, party: WhatsAppParty.CUSTOMER } }
    });
    if (!conv) return null;
    conversationId = conv.id;
  }
  ctx.pendingUnlistedQuery = query;
  setExpected(ctx, "UNLISTED_OFFER");
  await sendUnlistedOffer(phone, ctx, query);
  await updateConversation(conversationId, {
    state: WhatsAppConversationState.BUILDING_CART,
    context: ctx
  });
  return { handled: true };
}

export async function beginUnlistedRequestFromContext(
  phone: string,
  customerId: string,
  convId: string,
  ctx: ConversationContext
): Promise<{ handled: boolean }> {
  const query = ctx.pendingUnlistedQuery?.trim();
  if (!query) {
    setExpected(ctx, "PRODUCT_TEXT");
    await sendShopPrompt(phone, ctx);
    await updateConversation(convId, { state: WhatsAppConversationState.BUILDING_CART, context: ctx });
    return { handled: true };
  }
  if (ctx.deliveryLat == null || ctx.deliveryLng == null) {
    setExpected(ctx, "LOCATION");
    await updateConversation(convId, {
      state: WhatsAppConversationState.AWAITING_LOCATION,
      context: ctx
    });
    await sendLocationAsk(phone);
    return { handled: true };
  }
  const parsed = parseUnlistedRequestText(query);
  const created = await createUnlistedItemRequest({
    originalRequestText: query,
    quantity: parsed.quantity,
    optionalMaxBudgetCents: parsed.optionalMaxBudgetCents,
    commerceCustomerId: customerId,
    checkoutSessionId: ctx.checkoutSessionId ?? null,
    whatsappPhone: phone,
    orderSource: OrderSource.WHATSAPP,
    deliveryLatitude: ctx.deliveryLat,
    deliveryLongitude: ctx.deliveryLng,
    deliveryLabel: ctx.deliveryLabel ?? "WhatsApp delivery",
    deliveryPrecision: ctx.deliveryPrecision ?? null,
    deliveryInstructions: ctx.deliveryInstructions ?? null
  });
  ctx.unlistedRequestId = created.id;
  ctx.pendingUnlistedQuery = undefined;
  ctx.requestedItems = undefined;
  setExpected(ctx, "NONE");
  await getWhatsAppProvider().sendText(phone, formatUnlistedSearching(created.parsedItemName));
  await updateConversation(convId, { state: WhatsAppConversationState.IDLE, context: ctx });
  return { handled: true };
}

export async function presentUnlistedQuoteToWhatsApp(request: UnlistedPublicRequest): Promise<void> {
  const phone = request.whatsappPhone;
  if (!phone) return;
  const conv = await prisma.whatsAppConversation.findUnique({
    where: { phoneNormalized_party: { phoneNormalized: phone, party: WhatsAppParty.CUSTOMER } }
  });
  if (!conv) {
    const itemCents = (request.foundPriceCents ?? 0) * request.quantity;
    await notifyCustomerStatus(
      phone,
      `We found it. ${request.foundProductName ?? request.parsedItemName}. Item $${((request.foundPriceCents ?? 0) / 100).toFixed(2)}. Delivery $${((request.deliveryFeeCents ?? 0) / 100).toFixed(2)}. Total $${((request.totalCents ?? itemCents) / 100).toFixed(2)}. Reply BUY to approve.`
    );
    return;
  }
  const ctx = readContext(conv);
  ctx.unlistedRequestId = request.id;
  ctx.unlistedApprovalId = request.approvalId ?? undefined;
  setExpected(ctx, "UNLISTED_QUOTE");
  await sendUnlistedQuoteMessage(phone, ctx, request);
  await updateConversation(conv.id, {
    state: WhatsAppConversationState.AWAITING_ORDER_CONFIRMATION,
    context: ctx
  });
}

export async function notifyUnlistedCustomerEvent(
  request: UnlistedPublicRequest,
  kind: "NOT_FOUND" | "EXPIRED" | "PAID" | "DECLINED" | "NEEDS_ATTENTION" | "PAYMENT_FAILED"
): Promise<void> {
  const phone = request.whatsappPhone;
  if (!phone) return;
  const body =
    kind === "NOT_FOUND"
      ? formatUnlistedNotFoundCustomer()
      : kind === "EXPIRED"
        ? formatUnlistedExpired()
        : kind === "PAID"
          ? formatUnlistedPaid()
          : kind === "DECLINED"
            ? formatUnlistedDeclined()
            : kind === "NEEDS_ATTENTION"
              ? formatUnlistedNeedsAttention()
              : formatUnlistedExpired();
  await notifyCustomerStatus(phone, body);
}

export async function applyUnlistedInteractive(
  phone: string,
  customerId: string,
  convId: string,
  ctx: ConversationContext,
  action: InteractiveActionRecord
): Promise<{ handled: boolean } | null> {
  switch (action.kind) {
    case "UNLISTED_REQUEST":
      return beginUnlistedRequestFromContext(phone, customerId, convId, ctx);
    case "UNLISTED_TRY_AGAIN":
      ctx.pendingUnlistedQuery = undefined;
      setExpected(ctx, "PRODUCT_TEXT");
      await sendShopPrompt(phone, ctx);
      await updateConversation(convId, { state: WhatsAppConversationState.BUILDING_CART, context: ctx });
      return { handled: true };
    case "UNLISTED_BUY":
      return approveAndOfferPayment(phone, customerId, convId, ctx, action);
    case "UNLISTED_DECLINE":
      return declineQuote(phone, convId, ctx, action);
    case "UNLISTED_PAY_ECOCASH":
      setExpected(ctx, "UNLISTED_ECOCASH");
      await getWhatsAppProvider().sendText(phone, formatEcoCashPrompt());
      await updateConversation(convId, { state: WhatsAppConversationState.AWAITING_PAYMENT, context: ctx });
      return { handled: true };
    default:
      return null;
  }
}

async function approveAndOfferPayment(
  phone: string,
  customerId: string,
  convId: string,
  ctx: ConversationContext,
  action: InteractiveActionRecord
): Promise<{ handled: boolean }> {
  const requestId = action.unlistedRequestId ?? ctx.unlistedRequestId;
  const approvalId = action.approvalId ?? ctx.unlistedApprovalId;
  if (!requestId || !approvalId) {
    throw new AppError("This offer is no longer valid.", 409, "UNLISTED_STALE_APPROVAL");
  }
  const approved = await approveUnlistedQuote({ requestId, approvalId, actorId: customerId });
  ctx.unlistedRequestId = approved.id;
  ctx.unlistedApprovalId = approved.approvalId ?? approvalId;
  setExpected(ctx, "UNLISTED_PAYMENT");
  await sendUnlistedPaymentChoice(phone, ctx, approved.totalCents ?? 0);
  await updateConversation(convId, { state: WhatsAppConversationState.AWAITING_PAYMENT, context: ctx });
  return { handled: true };
}

async function declineQuote(
  phone: string,
  convId: string,
  ctx: ConversationContext,
  action: InteractiveActionRecord
): Promise<{ handled: boolean }> {
  const requestId = action.unlistedRequestId ?? ctx.unlistedRequestId;
  const approvalId = action.approvalId ?? ctx.unlistedApprovalId;
  if (requestId && approvalId) {
    await declineUnlistedQuote({ requestId, approvalId, actorId: ctx.unlistedRequestId });
  }
  ctx.unlistedRequestId = undefined;
  ctx.unlistedApprovalId = undefined;
  ctx.pendingUnlistedQuery = undefined;
  setExpected(ctx, "PRODUCT_TEXT");
  await getWhatsAppProvider().sendText(phone, formatUnlistedDeclined());
  await updateConversation(convId, { state: WhatsAppConversationState.IDLE, context: ctx });
  return { handled: true };
}

export async function handleUnlistedText(
  phone: string,
  customerId: string,
  convId: string,
  ctx: ConversationContext,
  text: string
): Promise<{ handled: boolean } | null> {
  const expect = ctx.expectedInput ?? "NONE";
  const n = Number.parseInt(text.trim(), 10);
  const lower = text.trim().toLowerCase();

  if (expect === "UNLISTED_OFFER") {
    if (n === 1 || /request/.test(lower)) {
      return beginUnlistedRequestFromContext(phone, customerId, convId, ctx);
    }
    if (n === 2 || /another|try/.test(lower)) {
      return applyUnlistedInteractive(phone, customerId, convId, ctx, {
        token: "text",
        kind: "UNLISTED_TRY_AGAIN",
        createdAt: new Date().toISOString()
      });
    }
    await sendUnlistedOffer(phone, ctx, ctx.pendingUnlistedQuery ?? "that item");
    await updateConversation(convId, { context: ctx });
    return { handled: true };
  }

  if (expect === "UNLISTED_QUOTE") {
    if (n === 1 || /buy|yes|ok/.test(lower)) {
      return approveAndOfferPayment(phone, customerId, convId, ctx, {
        token: "text",
        kind: "UNLISTED_BUY",
        unlistedRequestId: ctx.unlistedRequestId,
        approvalId: ctx.unlistedApprovalId,
        createdAt: new Date().toISOString()
      });
    }
    if (n === 2 || /no|decline/.test(lower)) {
      return declineQuote(phone, convId, ctx, {
        token: "text",
        kind: "UNLISTED_DECLINE",
        unlistedRequestId: ctx.unlistedRequestId,
        approvalId: ctx.unlistedApprovalId,
        createdAt: new Date().toISOString()
      });
    }
    if (ctx.unlistedRequestId) {
      const request = await getUnlistedRequest(ctx.unlistedRequestId);
      await sendUnlistedQuoteMessage(phone, ctx, request);
      await updateConversation(convId, { context: ctx });
    }
    return { handled: true };
  }

  if (expect === "UNLISTED_PAYMENT") {
    if (n === 1 || /ecocash|eco/.test(lower)) {
      setExpected(ctx, "UNLISTED_ECOCASH");
      await getWhatsAppProvider().sendText(phone, formatEcoCashPrompt());
      await updateConversation(convId, { state: WhatsAppConversationState.AWAITING_PAYMENT, context: ctx });
      return { handled: true };
    }
    if (ctx.unlistedRequestId) {
      const request = await getUnlistedRequest(ctx.unlistedRequestId);
      await sendUnlistedPaymentChoice(phone, ctx, request.totalCents ?? 0);
      await updateConversation(convId, { context: ctx });
    }
    return { handled: true };
  }

  if (expect === "UNLISTED_ECOCASH") {
    if (!ctx.unlistedRequestId) return { handled: true };
    const result = await initiateUnlistedEcoCashPayment({
      requestId: ctx.unlistedRequestId,
      payerPhoneRaw: text
    });
    setExpected(ctx, "UNLISTED_PAYMENT");
    await getWhatsAppProvider().sendText(
      phone,
      formatMobileMoneyPending({ method: "ECOCASH", displayLocal: result.displayLocal })
    );
    await updateConversation(convId, { state: WhatsAppConversationState.AWAITING_PAYMENT, context: ctx });
    return { handled: true };
  }

  return null;
}

export async function continueUnlistedAfterLocation(
  phone: string,
  convId: string,
  ctx: ConversationContext
): Promise<{ handled: boolean } | null> {
  if (!ctx.pendingUnlistedQuery) return null;
  const customer = await ensureWhatsAppCommerceCustomer(phone);
  return beginUnlistedRequestFromContext(phone, customer.id, convId, ctx);
}

export async function ensureUnlistedWhatsAppCustomer(phone: string) {
  return ensureWhatsAppCommerceCustomer(phone);
}
