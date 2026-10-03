import { randomUUID } from "node:crypto";
import { WhatsAppConversationState } from "@prisma/client";
import { getCartTtlMs } from "./cart-mutations.js";
import type { ConversationContext } from "./conversation.service.js";

export type CheckoutExpectedInput =
  | "NONE"
  | "PRODUCT_TEXT"
  | "PRODUCT_DISAMBIGUATION"
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
  | "PENDING_PAYMENT_HANDOFF";

export type CheckoutSource = "WHATSAPP" | "WEB_HANDOFF";

export type LockedProductLine = {
  productId: string;
  quantity: number;
  productName: string;
  unitPriceCents: number;
  merchantId: string;
};

export type ParkedPayment = {
  checkoutSessionId: string;
  paymentAttemptId?: string;
  pendingPaymentOrderId?: string;
  paymentPhase?: ConversationContext["paymentPhase"];
};

const COORD_RE = /^-?\d{1,3}\.\d+\s*,\s*-?\d{1,3}\.\d+$/;

export function newCheckoutSessionId(): string {
  return randomUUID();
}

export function looksLikeRawCoordinates(label: string | null | undefined): boolean {
  return COORD_RE.test(String(label ?? "").trim());
}

export function customerFacingDeliveryLabel(label: string | null | undefined): string {
  const trimmed = String(label ?? "").trim();
  if (!trimmed || looksLikeRawCoordinates(trimmed)) return "Pinned location ✓";
  return trimmed;
}

/** Prefer the customer's typed landmark/address. Never surface raw coordinates. */
export function humanDeliveryLabel(input: {
  typed?: string | null;
  formattedAddress?: string | null;
  city?: string | null;
  region?: string | null;
}): string {
  const typed = String(input.typed ?? "").trim();
  if (typed && !looksLikeRawCoordinates(typed)) {
    return typed.length > 80 ? `${typed.slice(0, 77)}…` : typed;
  }
  const formatted = String(input.formattedAddress ?? "").trim();
  if (formatted && !looksLikeRawCoordinates(formatted)) {
    return formatted.length > 80 ? `${formatted.slice(0, 77)}…` : formatted;
  }
  const pretty = [input.city, input.region].filter(Boolean).join(", ");
  if (pretty && !looksLikeRawCoordinates(pretty)) return pretty;
  return "Pinned location ✓";
}

export function conversationStateForExpected(expected: CheckoutExpectedInput): WhatsAppConversationState {
  switch (expected) {
    case "LOCATION":
    case "LOCATION_CLARIFICATION":
      return WhatsAppConversationState.AWAITING_LOCATION;
    case "PRODUCT_DISAMBIGUATION":
      return WhatsAppConversationState.AWAITING_PRODUCT_CHOICE;
    case "ORDER_CONFIRMATION":
    case "CHANGE_WHAT":
      return WhatsAppConversationState.AWAITING_ORDER_CONFIRMATION;
    case "PAYMENT_METHOD":
    case "ECOCASH_NUMBER":
    case "PAYMENT_PENDING":
    case "PAYMENT_RETRY":
    case "PENDING_PAYMENT_HANDOFF":
      return WhatsAppConversationState.AWAITING_PAYMENT;
    case "READY_TO_ORDER":
    case "PRODUCT_TEXT":
      return WhatsAppConversationState.BUILDING_CART;
    default:
      return WhatsAppConversationState.BUILDING_CART;
  }
}

export function expectedFromLegacyState(
  state: WhatsAppConversationState,
  ctx: ConversationContext
): CheckoutExpectedInput {
  if (ctx.expectedInput) return ctx.expectedInput;
  switch (state) {
    case WhatsAppConversationState.AWAITING_PRODUCT_CHOICE:
      return "PRODUCT_DISAMBIGUATION";
    case WhatsAppConversationState.AWAITING_LOCATION:
      return ctx.pendingLocationChoices?.length ? "LOCATION_CLARIFICATION" : "LOCATION";
    case WhatsAppConversationState.AWAITING_ORDER_CONFIRMATION:
      return "ORDER_CONFIRMATION";
    case WhatsAppConversationState.AWAITING_PAYMENT:
      if (ctx.paymentPhase === "ENTER_PAYMENT_PHONE") return "ECOCASH_NUMBER";
      if (ctx.paymentPhase === "PENDING_PROVIDER") return "PAYMENT_PENDING";
      if (ctx.paymentPhase === "FAILED" || ctx.paymentPhase === "EXPIRED") return "PAYMENT_RETRY";
      return "PAYMENT_METHOD";
    case WhatsAppConversationState.BUILDING_CART:
      return ctx.requestedItems?.length ? "READY_TO_ORDER" : "PRODUCT_TEXT";
    default:
      return "NONE";
  }
}

export function isLivePendingPayment(ctx: ConversationContext): boolean {
  return (
    ctx.paymentPhase === "PENDING_PROVIDER" &&
    Boolean(ctx.paymentAttemptId || ctx.pendingPaymentOrderId)
  );
}

export function conversationOwnsOrder(ctx: ConversationContext, orderId: string): boolean {
  if (ctx.pendingPaymentOrderId === orderId || ctx.activeOrderId === orderId) return true;
  return Boolean(ctx.parkedPayments?.some((p) => p.pendingPaymentOrderId === orderId));
}

export function conversationOwnsAttempt(ctx: ConversationContext, attemptId: string): boolean {
  if (ctx.paymentAttemptId === attemptId) return true;
  return Boolean(ctx.parkedPayments?.some((p) => p.paymentAttemptId === attemptId));
}

export function currentSessionOwnsOrder(ctx: ConversationContext, orderId: string): boolean {
  return ctx.pendingPaymentOrderId === orderId || ctx.activeOrderId === orderId;
}

function placedOrderIds(ctx: ConversationContext): string[] {
  const ids = [ctx.activeOrderId, ctx.pendingPaymentOrderId].filter(Boolean) as string[];
  for (const p of ctx.parkedPayments ?? []) {
    if (p.pendingPaymentOrderId) ids.push(p.pendingPaymentOrderId);
  }
  return ids;
}

/** Keep placed-order pointers; drop unfinished checkout draft fields. */
export function snapshotPlacedOrders(ctx: ConversationContext): Pick<
  ConversationContext,
  "activeOrderId" | "parkedPayments"
> {
  const parked = [...(ctx.parkedPayments ?? [])];
  return {
    activeOrderId: ctx.activeOrderId,
    parkedPayments: parked.length ? parked : undefined
  };
}

export function beginCheckoutSession(
  ctx: ConversationContext,
  source: CheckoutSource,
  expected: CheckoutExpectedInput
): ConversationContext {
  return {
    ...snapshotPlacedOrders(ctx),
    checkoutSessionId: newCheckoutSessionId(),
    checkoutSource: source,
    checkoutStatus: "ACTIVE",
    expectedInput: expected,
    choiceType: expected,
    choiceId: undefined,
    sessionStartedAt: new Date().toISOString(),
    consumedHandoffToken: source === "WEB_HANDOFF" ? ctx.consumedHandoffToken : undefined
  };
}

export function supersedeCheckoutDraft(ctx: ConversationContext): ConversationContext {
  const parked = [...(ctx.parkedPayments ?? [])];
  if (isLivePendingPayment(ctx) && ctx.checkoutSessionId) {
    parked.push({
      checkoutSessionId: ctx.checkoutSessionId,
      paymentAttemptId: ctx.paymentAttemptId,
      pendingPaymentOrderId: ctx.pendingPaymentOrderId,
      paymentPhase: ctx.paymentPhase
    });
  }
  return {
    activeOrderId: ctx.activeOrderId,
    parkedPayments: parked.length ? parked.slice(-5) : undefined,
    lastDeliveryLat: ctx.deliveryLat ?? ctx.lastDeliveryLat,
    lastDeliveryLng: ctx.deliveryLng ?? ctx.lastDeliveryLng,
    lastDeliveryLabel: ctx.deliveryLabel ?? ctx.lastDeliveryLabel
  };
}

export function clearPendingClarification(ctx: ConversationContext): void {
  ctx.pendingChoices = undefined;
  ctx.lastDisambiguationQuery = undefined;
  ctx.choiceId = undefined;
  ctx.pendingLocationChoices = undefined;
  if (ctx.expectedInput === "PRODUCT_DISAMBIGUATION") {
    ctx.expectedInput = ctx.requestedItems?.length ? "READY_TO_ORDER" : "PRODUCT_TEXT";
    ctx.choiceType = ctx.expectedInput;
  }
  if (ctx.expectedInput === "LOCATION_CLARIFICATION") {
    ctx.expectedInput = "LOCATION";
    ctx.choiceType = "LOCATION";
  }
}

export function setExpected(ctx: ConversationContext, expected: CheckoutExpectedInput): void {
  ctx.expectedInput = expected;
  ctx.choiceType = expected;
  ctx.checkoutStatus = "ACTIVE";
  if (!ctx.checkoutSessionId) ctx.checkoutSessionId = newCheckoutSessionId();
}

export function completeCheckoutSession(ctx: ConversationContext): ConversationContext {
  return {
    activeOrderId: ctx.activeOrderId,
    parkedPayments: ctx.parkedPayments,
    lastDeliveryLat: ctx.deliveryLat ?? ctx.lastDeliveryLat,
    lastDeliveryLng: ctx.deliveryLng ?? ctx.lastDeliveryLng,
    lastDeliveryLabel: ctx.deliveryLabel ?? ctx.lastDeliveryLabel,
    checkoutSessionId: ctx.checkoutSessionId,
    checkoutStatus: "COMPLETED",
    expectedInput: "NONE",
    choiceType: "NONE",
    checkoutSource: ctx.checkoutSource
  };
}

export function cancelCheckoutDraft(ctx: ConversationContext): ConversationContext {
  return {
    activeOrderId: ctx.activeOrderId,
    parkedPayments: ctx.parkedPayments,
    lastDeliveryLat: ctx.deliveryLat ?? ctx.lastDeliveryLat,
    lastDeliveryLng: ctx.deliveryLng ?? ctx.lastDeliveryLng,
    lastDeliveryLabel: ctx.deliveryLabel ?? ctx.lastDeliveryLabel,
    checkoutStatus: "CANCELLED",
    expectedInput: "NONE",
    choiceType: "NONE"
  };
}

export function isUnfinishedCheckout(ctx: ConversationContext, state: WhatsAppConversationState): boolean {
  if (ctx.checkoutStatus === "COMPLETED" || ctx.checkoutStatus === "CANCELLED" || ctx.checkoutStatus === "EXPIRED") {
    return false;
  }
  if (isLivePendingPayment(ctx)) return true;
  if (ctx.pendingChoices?.length) return true;
  if (ctx.requestedItems?.length || ctx.draftLines?.length || ctx.lockedProductLines?.length) return true;
  if (ctx.paymentPhase) return true;
  const unfinishedStates: WhatsAppConversationState[] = [
    WhatsAppConversationState.AWAITING_PRODUCT_CHOICE,
    WhatsAppConversationState.AWAITING_LOCATION,
    WhatsAppConversationState.AWAITING_ORDER_CONFIRMATION,
    WhatsAppConversationState.AWAITING_PAYMENT,
    WhatsAppConversationState.BUILDING_CART
  ];
  return unfinishedStates.includes(state);
}

export function sessionIsExpired(ctx: ConversationContext, now = Date.now()): boolean {
  if (isLivePendingPayment(ctx)) return false;
  const started = ctx.sessionStartedAt ? Date.parse(ctx.sessionStartedAt) : NaN;
  const quoted = ctx.draftQuotedAt ? Date.parse(ctx.draftQuotedAt) : NaN;
  const t = Number.isFinite(quoted) ? quoted : started;
  if (!Number.isFinite(t)) return false;
  return now - t > getCartTtlMs();
}

/**
 * Invalidate leftover pending state from older conversations.
 * Never touches placed orders or payment attempt records.
 */
export function sanitizeCheckoutContext(
  state: WhatsAppConversationState,
  raw: ConversationContext
): { ctx: ConversationContext; expired: boolean; state: WhatsAppConversationState } {
  const ctx: ConversationContext = { ...raw };
  if (!ctx.checkoutSessionId) ctx.checkoutSessionId = newCheckoutSessionId();
  if (!ctx.expectedInput) ctx.expectedInput = expectedFromLegacyState(state, ctx);
  ctx.choiceType = ctx.expectedInput;

  if (ctx.expectedInput !== "PRODUCT_DISAMBIGUATION") {
    ctx.pendingChoices = undefined;
    ctx.lastDisambiguationQuery = undefined;
    if (ctx.expectedInput !== "LOCATION_CLARIFICATION") ctx.choiceId = undefined;
  } else if (!ctx.choiceId && ctx.pendingChoices?.[0]) {
    ctx.choiceId = newCheckoutSessionId();
  }

  if (ctx.expectedInput !== "LOCATION_CLARIFICATION") {
    ctx.pendingLocationChoices = undefined;
  } else if (!ctx.choiceId && ctx.pendingLocationChoices?.[0]) {
    ctx.choiceId = newCheckoutSessionId();
  }

  if (sessionIsExpired(ctx) && isUnfinishedCheckout(ctx, state) && !isLivePendingPayment(ctx)) {
    const kept = snapshotPlacedOrders(ctx);
    return {
      ctx: {
        ...kept,
        lastDeliveryLat: ctx.deliveryLat ?? ctx.lastDeliveryLat,
        lastDeliveryLng: ctx.deliveryLng ?? ctx.lastDeliveryLng,
        lastDeliveryLabel: ctx.deliveryLabel ?? ctx.lastDeliveryLabel,
        checkoutStatus: "EXPIRED",
        expectedInput: "NONE",
        choiceType: "NONE"
      },
      expired: true,
      state: WhatsAppConversationState.IDLE
    };
  }

  return { ctx, expired: false, state };
}

export function parseNumericChoice(text: string): number | null {
  const prepared = text.trim().toLowerCase().replace(/[?.!]+$/g, "").trim();
  if (/^\d+$/.test(prepared)) return Number(prepared);
  if (/^(number\s*)?(1|one)$/i.test(prepared) || /^(first|the first)$/i.test(prepared)) return 1;
  if (/^(number\s*)?(2|two)$/i.test(prepared) || /^(second|the second)$/i.test(prepared)) return 2;
  if (/^(number\s*)?(3|three)$/i.test(prepared) || /^(third|the third)$/i.test(prepared)) return 3;
  return null;
}

export function isCartCommand(text: string): boolean {
  return /^(cart|basket|show (my )?(cart|basket)|my cart)$/i.test(text.trim());
}

export function applyPaidOrderToConversation(
  ctx: ConversationContext,
  orderId: string
): { ctx: ConversationContext; completedCurrent: boolean } {
  if (currentSessionOwnsOrder(ctx, orderId)) {
    return {
      ctx: completeCheckoutSession({ ...ctx, activeOrderId: orderId }),
      completedCurrent: true
    };
  }
  const parked = ctx.parkedPayments ?? [];
  if (parked.some((p) => p.pendingPaymentOrderId === orderId)) {
    return {
      ctx: {
        ...ctx,
        parkedPayments: parked.filter((p) => p.pendingPaymentOrderId !== orderId)
      },
      completedCurrent: false
    };
  }
  return { ctx, completedCurrent: false };
}

export function applyFailedPaymentToConversation(
  ctx: ConversationContext,
  orderId: string,
  phase: "FAILED" | "EXPIRED"
): { ctx: ConversationContext; updateCurrent: boolean } {
  if (currentSessionOwnsOrder(ctx, orderId)) {
    const next = { ...ctx, paymentPhase: phase };
    setExpected(next, "PAYMENT_RETRY");
    clearPendingClarification(next);
    return { ctx: next, updateCurrent: true };
  }
  const parked = (ctx.parkedPayments ?? []).map((p) =>
    p.pendingPaymentOrderId === orderId ? { ...p, paymentPhase: phase } : p
  );
  if (parked.some((p) => p.pendingPaymentOrderId === orderId)) {
    return { ctx: { ...ctx, parkedPayments: parked }, updateCurrent: false };
  }
  return { ctx, updateCurrent: false };
}
