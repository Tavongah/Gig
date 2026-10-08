import {
  CommerceNotificationStatus,
  CommerceOrderStatus,
  CommercePaymentStatus,
  WhatsAppParty,
  type CommerceOrder
} from "@prisma/client";
import { FULFILLMENT_NOTE, addFulfillmentNote, formatFlavorFulfillmentLine, hasFulfillmentNote } from "@gigflow/shared";
import { prisma } from "../../config/prisma.js";
import { logDutsFlow } from "../../lib/flow-log.js";
import { normalizePhoneNumber } from "../auth/access.service.js";
import { formatMerchantNewOrder, money } from "../whatsapp/copy.js";
import { getWhatsAppProvider, type WhatsAppSendResult } from "../whatsapp/provider.js";
import { templateNameFor } from "../whatsapp/templates.js";
import { resolveTwilioStatusCallbackUrl } from "../whatsapp/twilio-payload.js";

export const MERCHANT_NEW_ORDER_PURPOSE = "NEW_ORDER";
const MAX_ATTEMPTS = 4;
const RETRY_DELAYS_MS = [0, 30_000, 120_000, 600_000];
const SESSION_WINDOW_MS = 24 * 60 * 60 * 1000;
const E164 = /^\+[1-9]\d{7,14}$/;

export function merchantNewOrderIdempotencyKey(commerceOrderId: string): string {
  return `merchant-new-order-${commerceOrderId}`;
}

function isE164(phone: string): boolean {
  return E164.test(phone);
}

function twilioContentSid(): string | null {
  return (
    process.env.TWILIO_CONTENT_SID_MERCHANT_NEW_ORDER?.trim() ||
    process.env.WHATSAPP_TEMPLATE_MERCHANT_NEW_ORDER?.trim() ||
    null
  );
}

function statusCallbackUrl(): string | undefined {
  return resolveTwilioStatusCallbackUrl();
}

function nextRetryAt(attemptCount: number): Date | null {
  const delay = RETRY_DELAYS_MS[Math.min(attemptCount, RETRY_DELAYS_MS.length - 1)];
  if (attemptCount >= MAX_ATTEMPTS) return null;
  return new Date(Date.now() + (delay ?? 600_000));
}

function isPermanentCategory(category: string | null | undefined): boolean {
  return category === "INVALID_NUMBER" || category === "TEMPLATE_REQUIRED" || category === "SESSION_WINDOW";
}

async function merchantSessionOpen(phone: string): Promise<boolean> {
  const since = new Date(Date.now() - SESSION_WINDOW_MS);
  const inbound = await prisma.whatsAppInboundMessage.findFirst({
    where: {
      phoneNormalized: phone,
      party: WhatsAppParty.MERCHANT,
      processedAt: { gte: since }
    },
    select: { id: true }
  });
  return Boolean(inbound);
}

type OrderForNotify = CommerceOrder & {
  merchant: { whatsappPhone: string; name: string; id: string };
  items: Array<{
    quantity: number;
    productNameSnapshot: string;
    lineTotalCents: number;
    flavorPreference?: string | null;
    flavorNameSnapshot?: string | null;
  }>;
  checkout?: { checkoutNumber: number } | null;
  fulfillmentLabel?: string | null;
};

async function loadOrder(orderId: string): Promise<OrderForNotify | null> {
  return prisma.commerceOrder.findUnique({
    where: { id: orderId },
    include: { merchant: true, items: true, checkout: { select: { checkoutNumber: true } } }
  });
}

function buildBody(order: OrderForNotify): string {
  const displayRef =
    order.checkout?.checkoutNumber && order.fulfillmentLabel
      ? `${order.checkout.checkoutNumber}-${order.fulfillmentLabel}`
      : undefined;
  return formatMerchantNewOrder({
    orderNumber: order.orderNumber,
    displayRef,
    lines: order.items.map((i) => {
      const flavor = formatFlavorFulfillmentLine(i.flavorPreference, i.flavorNameSnapshot);
      return flavor
        ? `${i.quantity} × ${i.productNameSnapshot}\n${flavor}`
        : `${i.quantity} × ${i.productNameSnapshot}`;
    }),
    itemsTotalCents: order.subtotalCents,
    totalCents: order.totalCents
  });
}

function contentVariables(order: OrderForNotify): Record<string, string> {
  const itemSummary = order.items
    .map((i) => {
      const flavor = formatFlavorFulfillmentLine(i.flavorPreference, i.flavorNameSnapshot);
      return flavor ? `${i.quantity} × ${i.productNameSnapshot} (${flavor})` : `${i.quantity} × ${i.productNameSnapshot}`;
    })
    .join("\n")
    .slice(0, 500);
  return {
    "1": String(order.orderNumber),
    "2": itemSummary || "See DUTS order",
    "3": money(order.subtotalCents)
  };
}

async function persistOrderNotifyNote(
  orderId: string,
  token: string,
  extra?: string
): Promise<void> {
  const order = await prisma.commerceOrder.findUnique({ where: { id: orderId }, select: { notes: true } });
  if (!order) return;
  let notes = addFulfillmentNote(order.notes, token);
  if (extra) notes = addFulfillmentNote(notes, extra);
  await prisma.commerceOrder.update({ where: { id: orderId }, data: { notes } });
}

async function sendMerchantNewOrder(
  order: OrderForNotify,
  toPhone: string
): Promise<WhatsAppSendResult> {
  const wa = getWhatsAppProvider();
  const inSession = await merchantSessionOpen(toPhone);
  const contentSid = wa.name === "twilio" ? twilioContentSid() : templateNameFor("merchant_new_order");
  const body = buildBody(order);
  const buttons = [
    { id: `accept_${order.orderNumber}`, title: "Accept" },
    { id: `reject_${order.orderNumber}`, title: "Reject" }
  ];

  if (!inSession && wa.name === "twilio" && !contentSid) {
    return {
      ok: false,
      errorCode: "63016",
      errorCategory: "TEMPLATE_REQUIRED",
      errorMessage: "Merchant is outside the WhatsApp session window and no approved template is configured."
    };
  }

  const useTemplate = !inSession && Boolean(contentSid) && wa.name === "twilio";
  if (wa.sendOutbound) {
    const result = await wa.sendOutbound(toPhone, {
      body,
      buttons: useTemplate ? undefined : buttons,
      contentSid: useTemplate ? contentSid! : undefined,
      contentVariables: useTemplate ? contentVariables(order) : undefined,
      statusCallbackUrl: wa.name === "twilio" ? statusCallbackUrl() : undefined
    });
    if (
      !result.ok &&
      !useTemplate &&
      contentSid &&
      (result.errorCode === "63016" ||
        result.errorCategory === "TEMPLATE_REQUIRED" ||
        result.errorCategory === "SESSION_WINDOW")
    ) {
      return wa.sendOutbound(toPhone, {
        body,
        contentSid,
        contentVariables: contentVariables(order),
        statusCallbackUrl: wa.name === "twilio" ? statusCallbackUrl() : undefined
      });
    }
    return result;
  }

  try {
    await wa.sendButtons(toPhone, body, buttons);
    return { ok: true };
  } catch {
    try {
      await wa.sendText(toPhone, body);
      return { ok: true };
    } catch {
      return { ok: false, errorCategory: "PROVIDER", errorMessage: "WhatsApp send failed" };
    }
  }
}

export async function enqueueMerchantNewOrderNotification(
  order: { id: string },
  opts?: { force?: boolean }
): Promise<{
  status: CommerceNotificationStatus;
  providerMessageSid?: string | null;
  duplicate: boolean;
}> {
  const full = await loadOrder(order.id);
  if (!full) {
    return { status: CommerceNotificationStatus.FAILED, duplicate: false };
  }

  const toPhone = normalizePhoneNumber(full.merchant.whatsappPhone);
  const key = merchantNewOrderIdempotencyKey(full.id);
  const provider = getWhatsAppProvider().name;

  const existing = await prisma.commerceNotificationAttempt.findUnique({ where: { idempotencyKey: key } });
  if (existing?.status === CommerceNotificationStatus.DELIVERED && !opts?.force) {
    return { status: existing.status, providerMessageSid: existing.providerMessageSid, duplicate: true };
  }
  if (
    existing &&
    !opts?.force &&
    (existing.status === CommerceNotificationStatus.SENT || existing.status === CommerceNotificationStatus.QUEUED) &&
    existing.lastAttemptAt &&
    Date.now() - existing.lastAttemptAt.getTime() < 15_000
  ) {
    return { status: existing.status, providerMessageSid: existing.providerMessageSid, duplicate: true };
  }

  const row =
    existing ??
    (await prisma.commerceNotificationAttempt.create({
      data: {
        idempotencyKey: key,
        commerceOrderId: full.id,
        merchantId: full.merchantId,
        channel: "WHATSAPP",
        messagePurpose: MERCHANT_NEW_ORDER_PURPOSE,
        provider,
        toPhone,
        status: CommerceNotificationStatus.PENDING
      }
    }));

  if (!isE164(toPhone)) {
    const updated = await prisma.commerceNotificationAttempt.update({
      where: { id: row.id },
      data: {
        attemptCount: { increment: 1 },
        lastAttemptAt: new Date(),
        nextRetryAt: null,
        status: CommerceNotificationStatus.NEEDS_ATTENTION,
        lastErrorCode: "INVALID_E164",
        lastErrorCategory: "INVALID_NUMBER"
      }
    });
    await persistOrderNotifyNote(full.id, FULFILLMENT_NOTE.MERCHANT_NOTIFY_FAILED, FULFILLMENT_NOTE.NEEDS_ATTENTION);
    logDutsFlow("MERCHANT_NOTIFICATION_FAILED", {
      orderId: full.id,
      orderNumber: full.orderNumber,
      merchantId: full.merchantId,
      reason: "invalid_number"
    });
    return { status: updated.status, providerMessageSid: updated.providerMessageSid, duplicate: false };
  }

  await persistOrderNotifyNote(full.id, FULFILLMENT_NOTE.MERCHANT_NOTIFY_PENDING);
  logDutsFlow("MERCHANT_NOTIFICATION_ATTEMPTED", {
    orderId: full.id,
    orderNumber: full.orderNumber,
    merchantId: full.merchantId,
    attempt: row.attemptCount + 1
  });

  const result = await sendMerchantNewOrder(full, toPhone);
  const attemptCount = row.attemptCount + 1;
  const permanent = !result.ok && isPermanentCategory(result.errorCategory);
  const exhausted = attemptCount >= MAX_ATTEMPTS;
  let status: CommerceNotificationStatus = CommerceNotificationStatus.SENT;
  if (result.ok) {
    status = CommerceNotificationStatus.QUEUED;
  } else if (permanent || exhausted) {
    status = CommerceNotificationStatus.NEEDS_ATTENTION;
  } else {
    status = CommerceNotificationStatus.FAILED;
  }

  const updated = await prisma.commerceNotificationAttempt.update({
    where: { id: row.id },
    data: {
      toPhone,
      provider,
      attemptCount,
      lastAttemptAt: new Date(),
      providerMessageSid: result.providerMessageSid ?? row.providerMessageSid,
      status,
      lastErrorCode: result.ok ? null : result.errorCode ?? null,
      lastErrorCategory: result.ok ? null : result.errorCategory ?? null,
      nextRetryAt: result.ok || permanent || exhausted ? null : nextRetryAt(attemptCount)
    }
  });

  if (result.ok) {
    logDutsFlow("COMMERCE_MERCHANT_NOTIFIED", {
      orderId: full.id,
      orderNumber: full.orderNumber,
      merchantId: full.merchantId
    });
  } else {
    await persistOrderNotifyNote(full.id, FULFILLMENT_NOTE.MERCHANT_NOTIFY_FAILED);
    if (status === CommerceNotificationStatus.NEEDS_ATTENTION) {
      await persistOrderNotifyNote(full.id, FULFILLMENT_NOTE.NEEDS_ATTENTION);
    }
    logDutsFlow("MERCHANT_NOTIFICATION_FAILED", {
      orderId: full.id,
      orderNumber: full.orderNumber,
      merchantId: full.merchantId,
      reason: result.errorCategory ?? "unknown"
    });
  }

  return { status: updated.status, providerMessageSid: updated.providerMessageSid, duplicate: false };
}

/** Fire-and-forget wrapper used after order persistence. Never throws. Never creates orders. */
export async function notifyMerchantNewOrderSafe(order: { id: string }): Promise<void> {
  try {
    await enqueueMerchantNewOrderNotification(order);
  } catch {
    /* order remains authoritative */
  }
}

export async function retryMerchantNewOrderNotification(orderId: string): Promise<{
  status: CommerceNotificationStatus;
  providerMessageSid?: string | null;
}> {
  const result = await enqueueMerchantNewOrderNotification({ id: orderId }, { force: true });
  return { status: result.status, providerMessageSid: result.providerMessageSid };
}

export async function applyTwilioMessageStatus(input: {
  messageSid: string;
  messageStatus: string;
  errorCode?: string;
}): Promise<boolean> {
  const row = await prisma.commerceNotificationAttempt.findFirst({
    where: { providerMessageSid: input.messageSid }
  });
  if (!row) return false;

  const statusRaw = input.messageStatus.trim().toLowerCase();
  let status: CommerceNotificationStatus = row.status;
  let deliveredAt = row.deliveredAt;
  if (statusRaw === "queued") status = CommerceNotificationStatus.QUEUED;
  else if (statusRaw === "sent" || statusRaw === "sending") status = CommerceNotificationStatus.SENT;
  else if (statusRaw === "delivered" || statusRaw === "read") {
    status = CommerceNotificationStatus.DELIVERED;
    deliveredAt = new Date();
  } else if (statusRaw === "undelivered") status = CommerceNotificationStatus.UNDELIVERED;
  else if (statusRaw === "failed") status = CommerceNotificationStatus.FAILED;

  const errorCode = input.errorCode?.trim() || row.lastErrorCode;
  const errorCategory =
    errorCode === "63016" || errorCode === "63024"
      ? "TEMPLATE_REQUIRED"
      : status === CommerceNotificationStatus.FAILED || status === CommerceNotificationStatus.UNDELIVERED
        ? row.lastErrorCategory ?? "PROVIDER"
        : null;

  const needsAttention =
    (status === CommerceNotificationStatus.FAILED || status === CommerceNotificationStatus.UNDELIVERED) &&
    (isPermanentCategory(errorCategory) || row.attemptCount >= MAX_ATTEMPTS);

  await prisma.commerceNotificationAttempt.update({
    where: { id: row.id },
    data: {
      status: needsAttention ? CommerceNotificationStatus.NEEDS_ATTENTION : status,
      deliveredAt,
      lastErrorCode: errorCode,
      lastErrorCategory: errorCategory,
      nextRetryAt:
        needsAttention || status === CommerceNotificationStatus.DELIVERED
          ? null
          : status === CommerceNotificationStatus.FAILED || status === CommerceNotificationStatus.UNDELIVERED
            ? nextRetryAt(row.attemptCount)
            : row.nextRetryAt
    }
  });

  if (status === CommerceNotificationStatus.DELIVERED) {
    logDutsFlow("MERCHANT_NOTIFICATION_DELIVERED", {
      orderId: row.commerceOrderId,
      merchantId: row.merchantId
    });
  }
  if (needsAttention) {
    await persistOrderNotifyNote(
      row.commerceOrderId,
      FULFILLMENT_NOTE.MERCHANT_NOTIFY_FAILED,
      FULFILLMENT_NOTE.NEEDS_ATTENTION
    );
  }
  return true;
}

export async function processDueMerchantNotifications(limit = 20): Promise<number> {
  const due = await prisma.commerceNotificationAttempt.findMany({
    where: {
      messagePurpose: MERCHANT_NEW_ORDER_PURPOSE,
      status: { in: [CommerceNotificationStatus.PENDING, CommerceNotificationStatus.FAILED] },
      OR: [{ nextRetryAt: null, status: CommerceNotificationStatus.PENDING }, { nextRetryAt: { lte: new Date() } }]
    },
    take: limit,
    orderBy: { createdAt: "asc" }
  });
  let n = 0;
  for (const row of due) {
    if (row.attemptCount >= MAX_ATTEMPTS) {
      await prisma.commerceNotificationAttempt.update({
        where: { id: row.id },
        data: { status: CommerceNotificationStatus.NEEDS_ATTENTION, nextRetryAt: null }
      });
      continue;
    }
    await enqueueMerchantNewOrderNotification({ id: row.commerceOrderId }, { force: true });
    n += 1;
  }

  const missing = await prisma.commerceOrder.findMany({
    where: {
      orderNumber: { not: 2 },
      status: {
        notIn: [
          CommerceOrderStatus.DRAFT,
          CommerceOrderStatus.CANCELLED,
          CommerceOrderStatus.DELIVERED,
          CommerceOrderStatus.MERCHANT_REJECTED,
          CommerceOrderStatus.PAYMENT_FAILED
        ]
      },
      paymentStatus: { in: [CommercePaymentStatus.PAID, CommercePaymentStatus.DUE_ON_DELIVERY] },
      notificationAttempts: { none: { messagePurpose: MERCHANT_NEW_ORDER_PURPOSE } }
    },
    take: Math.max(0, limit - n),
    orderBy: { createdAt: "asc" },
    select: { id: true }
  });
  for (const order of missing) {
    await enqueueMerchantNewOrderNotification(order);
    n += 1;
  }
  return n;
}

export async function notifyAfterPaidCommerceOrder(orderId: string): Promise<void> {
  const order = await prisma.commerceOrder.findUnique({
    where: { id: orderId },
    include: { merchant: true, items: true, customer: true, checkout: true }
  });
  if (!order) return;

  const targets = [order];
  if (order.checkoutId) {
    const siblings = await prisma.commerceOrder.findMany({
      where: { checkoutId: order.checkoutId, id: { not: order.id } },
      include: { merchant: true, items: true, customer: true, checkout: true }
    });
    targets.push(...siblings);
  }

  for (const target of targets) {
    await notifyMerchantNewOrderSafe(target);
  }

  if (order.customerWhatsAppPhone) {
    try {
      const { notifyCustomerStatus } = await import("../whatsapp/merchant-handler.js");
      const { formatEcoCashPaid } = await import("../whatsapp/copy.js");
      await notifyCustomerStatus(
        order.customerWhatsAppPhone,
        formatEcoCashPaid(order.totalCents, order.orderNumber)
      );
    } catch {
      /* customer WhatsApp is not a fulfillment gate */
    }

    try {
      const { WhatsAppConversationState, WhatsAppParty } = await import("@prisma/client");
      const conv = await prisma.whatsAppConversation.findUnique({
        where: {
          phoneNormalized_party: {
            phoneNormalized: order.customerWhatsAppPhone,
            party: WhatsAppParty.CUSTOMER
          }
        }
      });
      if (conv) {
        const { readContext } = await import("../whatsapp/conversation.service.js");
        const { applyPaidOrderToConversation } = await import("../whatsapp/checkout-session.js");
        const current = readContext(conv);
        const applied = applyPaidOrderToConversation(current, order.id);
        if (applied.completedCurrent) {
          await prisma.whatsAppConversation.update({
            where: { id: conv.id },
            data: {
              state: WhatsAppConversationState.ORDER_ACTIVE,
              contextJson: applied.ctx as import("@prisma/client").Prisma.InputJsonValue
            }
          });
        } else if (applied.ctx !== current) {
          await prisma.whatsAppConversation.update({
            where: { id: conv.id },
            data: {
              contextJson: applied.ctx as import("@prisma/client").Prisma.InputJsonValue
            }
          });
        }
      }
    } catch {
      /* conversation update is best-effort */
    }
  }
}

export function hasFulfillmentNotifyFailed(notes?: string | null): boolean {
  return hasFulfillmentNote(notes, FULFILLMENT_NOTE.MERCHANT_NOTIFY_FAILED);
}
