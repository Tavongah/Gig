import { randomBytes } from "node:crypto";
import type { ConversationContext } from "./conversation.service.js";

/** Opaque, session-bound WhatsApp interactive actions. Do not treat labels as identity. */
export type InteractiveActionKind =
  | "MENU_SHOP"
  | "MENU_TRACK"
  | "MENU_HELP"
  | "MENU_MAIN"
  | "SELECT_PRODUCT"
  | "SELECT_FLAVOR"
  | "CART_CONTINUE"
  | "CART_ADD_MORE"
  | "CART_VIEW"
  | "CART_CANCEL"
  | "LOC_USE_AREA"
  | "LOC_CHANGE"
  | "LOC_NONE"
  | "LOC_PICK"
  | "REVIEW_PLACE"
  | "REVIEW_CHANGE_ADDRESS"
  | "REVIEW_CHANGE_ITEMS"
  | "REVIEW_CANCEL"
  | "CHANGE_ITEMS"
  | "CHANGE_LOCATION"
  | "CHANGE_PAYMENT"
  | "PAYMENT_ECOCASH"
  | "PAYMENT_COD"
  | "TRACK_ORDER"
  | "UNLISTED_REQUEST"
  | "UNLISTED_TRY_AGAIN"
  | "UNLISTED_BUY"
  | "UNLISTED_DECLINE"
  | "UNLISTED_PAY_ECOCASH";

export type InteractiveActionRecord = {
  token: string;
  kind: InteractiveActionKind;
  checkoutSessionId?: string;
  expectedInput?: string;
  locationClarificationType?: string;
  productId?: string;
  flavorOptionId?: string | null;
  orderId?: string;
  choiceIndex?: number;
  unlistedRequestId?: string;
  approvalId?: string;
  createdAt: string;
};

export type InteractiveActionSpec = Omit<InteractiveActionRecord, "token" | "createdAt">;

const MAX_ACTIONS = 24;
const TOKEN_RE = /^[A-Za-z0-9_-]{8,32}$/;

const MENU_KINDS = new Set<InteractiveActionKind>(["MENU_SHOP", "MENU_TRACK", "MENU_HELP", "MENU_MAIN"]);

export function newInteractiveToken(): string {
  return randomBytes(8).toString("base64url").slice(0, 12);
}

export function registerInteractiveAction(
  ctx: ConversationContext,
  spec: InteractiveActionSpec
): InteractiveActionRecord {
  const record: InteractiveActionRecord = {
    ...spec,
    token: newInteractiveToken(),
    createdAt: new Date().toISOString()
  };
  const next = [...(ctx.interactiveActions ?? []), record];
  ctx.interactiveActions = next.slice(-MAX_ACTIONS);
  return record;
}

export function findInteractiveAction(
  ctx: ConversationContext,
  token: string | undefined
): InteractiveActionRecord | null {
  const id = token?.trim();
  if (!id || !TOKEN_RE.test(id)) return null;
  return ctx.interactiveActions?.find((a) => a.token === id) ?? null;
}

export type InteractiveResolveResult =
  | { ok: true; action: InteractiveActionRecord }
  | { ok: false; reason: "unknown" | "stale" };

function expectedAllows(action: InteractiveActionRecord, ctx: ConversationContext): boolean {
  const expected = ctx.expectedInput ?? "NONE";
  if (MENU_KINDS.has(action.kind)) return true;
  if (!action.expectedInput) return true;
  if (action.expectedInput === expected) return true;
  if (action.kind === "PAYMENT_COD" && (expected === "PAYMENT_RETRY" || expected === "PAYMENT_PENDING")) {
    return true;
  }
  if (action.kind === "PAYMENT_ECOCASH" && expected === "PAYMENT_RETRY") return true;
  if (action.kind === "UNLISTED_PAY_ECOCASH" && expected === "UNLISTED_ECOCASH") return true;
  return false;
}

export function resolveInteractiveAction(
  ctx: ConversationContext,
  token: string | undefined
): InteractiveResolveResult {
  const action = findInteractiveAction(ctx, token);
  if (!action) return { ok: false, reason: "unknown" };

  if (action.checkoutSessionId && ctx.checkoutSessionId && action.checkoutSessionId !== ctx.checkoutSessionId) {
    return { ok: false, reason: "stale" };
  }
  if (action.checkoutSessionId && !ctx.checkoutSessionId && !MENU_KINDS.has(action.kind)) {
    return { ok: false, reason: "stale" };
  }
  if (!expectedAllows(action, ctx)) return { ok: false, reason: "stale" };

  if (action.kind.startsWith("LOC_") && (ctx.expectedInput ?? "NONE") !== "LOCATION_CLARIFICATION") {
    return { ok: false, reason: "stale" };
  }
  if (
    action.locationClarificationType &&
    ctx.locationClarificationType &&
    action.locationClarificationType !== ctx.locationClarificationType
  ) {
    return { ok: false, reason: "stale" };
  }
  if (action.kind === "SELECT_PRODUCT" && (ctx.expectedInput ?? "NONE") !== "PRODUCT_DISAMBIGUATION") {
    return { ok: false, reason: "stale" };
  }
  if (action.kind === "SELECT_PRODUCT" && action.productId) {
    const found = ctx.pendingChoices?.some((c) => c.options.some((o) => o.productId === action.productId));
    if (!found) return { ok: false, reason: "stale" };
  }
  if (action.kind === "SELECT_FLAVOR" && (ctx.expectedInput ?? "NONE") !== "PRODUCT_FLAVOR") {
    return { ok: false, reason: "stale" };
  }
  if (action.kind === "SELECT_FLAVOR") {
    const pending = ctx.pendingFlavorChoices?.[0];
    if (!pending || pending.productId !== action.productId) return { ok: false, reason: "stale" };
    const flavorOk = pending.flavors.some((f) => (f.id ?? null) === (action.flavorOptionId ?? null));
    if (!flavorOk) return { ok: false, reason: "stale" };
  }
  if (action.unlistedRequestId && ctx.unlistedRequestId && action.unlistedRequestId !== ctx.unlistedRequestId) {
    return { ok: false, reason: "stale" };
  }
  if (action.approvalId && ctx.unlistedApprovalId && action.approvalId !== ctx.unlistedApprovalId) {
    return { ok: false, reason: "stale" };
  }
  if (
    (action.kind === "UNLISTED_BUY" || action.kind === "UNLISTED_DECLINE") &&
    action.approvalId &&
    ctx.unlistedApprovalId !== action.approvalId
  ) {
    return { ok: false, reason: "stale" };
  }
  return { ok: true, action };
}

export function isReturningWhatsAppCustomer(ctx: ConversationContext): boolean {
  return Boolean(
    ctx.welcomeSentAt ||
      ctx.activeOrderId ||
      ctx.lastDeliveryLat != null ||
      ctx.checkoutStatus === "COMPLETED" ||
      ctx.checkoutStatus === "CANCELLED"
  );
}
