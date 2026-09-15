import { WhatsAppConversationState, WhatsAppParty, type CommerceOrder } from "@prisma/client";
import type { Server } from "socket.io";
import { normalizePhoneNumber } from "../auth/access.service.js";
import {
  findMerchantByWhatsApp,
  findMerchantProductsByQuery,
  listMerchantProducts,
  parseBackInStockText,
  parseMerchantAddProductText,
  parseMerchantBulkCatalogText,
  parseMerchantPriceUpdateText,
  parseOutOfStockText,
  requireAuthorizedMerchant,
  setMerchantAcceptsOrders,
  setProductAvailability,
  upsertProductForMerchant
} from "../commerce/merchant.service.js";
import {
  listMerchantActiveOrders,
  merchantAcceptOrder,
  merchantMarkItemUnavailable,
  merchantMarkReadyForPickup,
  merchantRejectOrder
} from "../commerce/order.service.js";
import {
  claimInboundMessage,
  getOrCreateConversation,
  readContext,
  updateConversation
} from "./conversation.service.js";
import { getWhatsAppProvider } from "./provider.js";
import type { InboundWhatsAppMessage } from "./customer-handler.js";
import { sendCommerceNotification } from "./templates.js";
import { formatMerchantAccepted, formatMerchantNewOrder, formatMerchantReady, formatCustomerMerchantAccepted, formatCustomerOrderReady, MERCHANT_HELP, money } from "./copy.js";

function friendlyMerchantOrderStatus(status: string): string {
  switch (status) {
    case "MERCHANT_PENDING":
      return "new";
    case "MERCHANT_ACCEPTED":
      return "preparing";
    case "READY_FOR_PICKUP":
      return "ready for pickup";
    case "COURIER_ASSIGNED":
      return "courier assigned";
    case "PICKED_UP":
      return "picked up";
    case "OUT_FOR_DELIVERY":
      return "on the way";
    default:
      return status.toLowerCase().replace(/_/g, " ");
  }
}

export async function notifyMerchantNewOrder(
  order: CommerceOrder & {
    merchant: { whatsappPhone: string; name: string };
    items: Array<{ quantity: number; productNameSnapshot: string; lineTotalCents: number }>;
  }
): Promise<void> {
  const body = formatMerchantNewOrder({
    orderNumber: order.orderNumber,
    lines: order.items.map((i) => `${i.quantity} × ${i.productNameSnapshot}`),
    itemsTotalCents: order.subtotalCents,
    totalCents: order.totalCents
  });
  await sendCommerceNotification(order.merchant.whatsappPhone, "merchant_new_order", body, [
    { id: `accept_${order.orderNumber}`, title: "Accept" },
    { id: `reject_${order.orderNumber}`, title: "Reject" }
  ]);
  const { logDutsFlow } = await import("../../lib/flow-log.js");
  logDutsFlow("COMMERCE_MERCHANT_NOTIFIED", {
    orderId: order.id,
    orderNumber: order.orderNumber,
    merchantId: order.merchantId
  });
}

export async function notifyCustomerStatus(phone: string, message: string): Promise<void> {
  await getWhatsAppProvider().sendText(phone, message);
}

export async function handleMerchantWhatsAppMessage(
  msg: InboundWhatsAppMessage,
  io: Server
): Promise<{ handled: boolean; duplicate?: boolean; unauthorized?: boolean }> {
  const phone = normalizePhoneNumber(msg.from);
  const claimed = await claimInboundMessage(msg.providerMessageId, phone, WhatsAppParty.MERCHANT, msg.text);
  if (!claimed) return { handled: true, duplicate: true };

  const wa = getWhatsAppProvider();
  const linked = await findMerchantByWhatsApp(phone);

  if (!linked) {
    await wa.sendText(
      phone,
      "This WhatsApp number is not linked to a DUTS merchant yet.\nAsk DUTS admin to onboard your shop first."
    );
    return { handled: true, unauthorized: true };
  }

  let merchant: Awaited<ReturnType<typeof requireAuthorizedMerchant>>;
  try {
    merchant = await requireAuthorizedMerchant(phone);
  } catch {
    await wa.sendText(phone, "Your merchant account is inactive. Contact DUTS support.");
    return { handled: true, unauthorized: true };
  }

  const conv = await getOrCreateConversation(phone, WhatsAppParty.MERCHANT, { merchantId: merchant.id });
  let ctx = readContext(conv);
  const text = (msg.text || "").trim();
  const buttonId = msg.buttonId || "";

  // Resolve pending product ambiguity
  if (ctx.pendingMerchantProductChoices?.length && ctx.pendingMerchantAction) {
    const choice = /^\d+$/.test(text) ? Number(text) : null;
    if (choice && choice >= 1 && choice <= ctx.pendingMerchantProductChoices.length) {
      const selected = ctx.pendingMerchantProductChoices[choice - 1]!;
      const action = ctx.pendingMerchantAction;
      ctx.pendingMerchantProductChoices = undefined;
      ctx.pendingMerchantAction = undefined;
      await updateConversation(conv.id, { context: ctx });

      if (action.type === "PRICE" && action.priceCents) {
        const product = await upsertProductForMerchant(
          merchant.id,
          {
            name: selected.name,
            priceCents: action.priceCents,
            available: true,
            searchAliases: []
          },
          selected.productId
        );
        await wa.sendText(phone, `Updated *${product.name}* to ${money(product.priceCents)}.`);
        return { handled: true };
      }
      if (action.type === "OOS") {
        await setProductAvailability(merchant.id, selected.productId, false);
        await wa.sendText(phone, `*${selected.name}* marked unavailable.`);
        return { handled: true };
      }
      if (action.type === "AVAILABLE") {
        await setProductAvailability(merchant.id, selected.productId, true);
        await wa.sendText(phone, `*${selected.name}* is available again.`);
        return { handled: true };
      }
    }
  }

  const acceptBtn = buttonId.match(/^accept_(\d+)$/);
  const rejectBtn = buttonId.match(/^reject_(\d+)$/);
  const readyBtn = buttonId.match(/^ready_(\d+)$/);

  async function resolveBareOrderNumber(
    action: "accept" | "reject" | "ready"
  ): Promise<number | null> {
    const orders = await listMerchantActiveOrders(merchant.id);
    const pool =
      action === "ready"
        ? orders.filter((o) => o.status === "MERCHANT_ACCEPTED")
        : orders.filter((o) => o.status === "MERCHANT_PENDING");
    if (pool.length === 1) return pool[0]!.orderNumber;
    if (pool.length === 0) {
      await wa.sendText(
        phone,
        action === "ready"
          ? "No accepted orders waiting. Reply ORDERS to see what's open."
          : "No new orders waiting. Reply ORDERS to see what's open."
      );
      return null;
    }
    await wa.sendText(
      phone,
      `Which order?\n${pool.map((o) => `#${o.orderNumber}`).join("\n")}\n\nReply e.g. ${action.toUpperCase()} ${pool[0]!.orderNumber}`
    );
    return null;
  }

  try {
    if (
      acceptBtn ||
      /^accept\s+(\d+)$/i.test(text) ||
      /^accept$/i.test(text) ||
      /^(1|yes)$/i.test(text.trim())
    ) {
      let num: number | null = acceptBtn
        ? Number(acceptBtn[1])
        : /^accept\s+(\d+)$/i.test(text)
          ? Number(text.match(/^accept\s+(\d+)$/i)![1])
          : null;
      if (num == null) num = await resolveBareOrderNumber("accept");
      if (num == null) return { handled: true };
      const order = await merchantAcceptOrder(merchant.id, num);
      await wa.sendText(phone, formatMerchantAccepted(order.orderNumber));
      if (order.customerWhatsAppPhone) {
        await notifyCustomerStatus(order.customerWhatsAppPhone, formatCustomerMerchantAccepted());
      }
      return { handled: true };
    }

    if (
      rejectBtn ||
      /^reject\s+(\d+)$/i.test(text) ||
      /^reject$/i.test(text) ||
      /^(2|no)$/i.test(text.trim())
    ) {
      let num: number | null = rejectBtn
        ? Number(rejectBtn[1])
        : /^reject\s+(\d+)$/i.test(text)
          ? Number(text.match(/^reject\s+(\d+)$/i)![1])
          : null;
      if (num == null) num = await resolveBareOrderNumber("reject");
      if (num == null) return { handled: true };
      const order = await merchantRejectOrder(merchant.id, num);
      await wa.sendText(phone, `Order #${order.orderNumber} rejected.`);
      if (order.customerWhatsAppPhone) {
        await notifyCustomerStatus(
          order.customerWhatsAppPhone,
          `${merchant.name} couldn't take your order. You can place a new one anytime.`
        );
      }
      return { handled: true };
    }

    if (
      readyBtn ||
      /order\s+(\d+)\s+is\s+ready/i.test(text) ||
      /^ready\s+(\d+)$/i.test(text) ||
      /^ready for pickup\s+(\d+)$/i.test(text) ||
      /^ready$/i.test(text)
    ) {
      let num: number | null = readyBtn
        ? Number(readyBtn[1])
        : Number(
            text.match(/order\s+(\d+)\s+is\s+ready/i)?.[1] ||
              text.match(/^ready(?:\s+for\s+pickup)?\s+(\d+)$/i)?.[1] ||
              NaN
          );
      if (!Number.isFinite(num)) num = await resolveBareOrderNumber("ready");
      if (num == null) return { handled: true };
      const { order } = await merchantMarkReadyForPickup(merchant.id, num, io);
      await wa.sendText(phone, formatMerchantReady(order.orderNumber));
      if (order.customerWhatsAppPhone) {
        await notifyCustomerStatus(order.customerWhatsAppPhone, formatCustomerOrderReady());
      }
      return { handled: true };
    }

    if (/^(show|list)\s+(my\s+)?(products|catalog)/i.test(text) || /^products$/i.test(text)) {
      const products = await listMerchantProducts(merchant.id, true);
      if (products.length === 0) {
        await wa.sendText(phone, "No products yet. Try: Add Mazoe Orange 2L for $2.50");
        return { handled: true };
      }
      const list = products
        .slice(0, 40)
        .map((p) => `• ${p.name} — ${money(p.priceCents)}${p.available ? "" : " (unavailable)"}`)
        .join("\n");
      await wa.sendText(phone, `*Your products*\n${list}`);
      return { handled: true };
    }

    if (/^(show|list)\s+(my\s+)?orders/i.test(text) || /^orders$/i.test(text)) {
      const orders = await listMerchantActiveOrders(merchant.id);
      if (orders.length === 0) {
        await wa.sendText(phone, "No active orders.");
        return { handled: true };
      }
      const list = orders
        .map(
          (o) =>
            `#${o.orderNumber} · ${friendlyMerchantOrderStatus(o.status)} · ${money(o.subtotalCents)} · ${o.items.map((i) => `${i.quantity}×${i.productNameSnapshot}`).join(", ")}`
        )
        .join("\n");
      await wa.sendText(phone, `*Active orders*\n${list}`);
      return { handled: true };
    }

    if (/^(open|we are open|accepting orders)/i.test(text)) {
      await setMerchantAcceptsOrders(merchant.id, true);
      await wa.sendText(phone, "Store is open for DUTS orders.");
      return { handled: true };
    }

    if (/^(close|we are closed|stop orders)/i.test(text)) {
      await setMerchantAcceptsOrders(merchant.id, false);
      await wa.sendText(phone, "Store closed for new DUTS orders.");
      return { handled: true };
    }

    // Bulk catalog (multi-line)
    const bulk = parseMerchantBulkCatalogText(text);
    if (bulk.valid.length >= 2) {
      const added: string[] = [];
      for (const row of bulk.valid) {
        const product = await upsertProductForMerchant(merchant.id, {
          name: row.name,
          priceCents: row.priceCents,
          available: true,
          searchAliases: []
        });
        added.push(`${product.name} — ${money(product.priceCents)}`);
      }
      const invalidNote =
        bulk.invalid.length > 0
          ? `\n\nCould not parse:\n${bulk.invalid.map((l) => `• ${l}`).join("\n")}`
          : "";
      await wa.sendText(
        phone,
        `Added ${added.length} products:\n${added.map((a) => `• ${a}`).join("\n")}${invalidNote}`
      );
      return { handled: true };
    }

    const add = parseMerchantAddProductText(text);
    if (add) {
      const product = await upsertProductForMerchant(merchant.id, {
        name: add.name,
        priceCents: add.priceCents,
        available: true,
        searchAliases: []
      });
      await wa.sendText(phone, `Added *${product.name}* at ${money(product.priceCents)}.`);
      return { handled: true };
    }

    const priceUp = parseMerchantPriceUpdateText(text);
    if (priceUp) {
      const matches = await findMerchantProductsByQuery(merchant.id, priceUp.query, 5);
      if (matches.length === 0) {
        await wa.sendText(phone, `Couldn't find a product matching "${priceUp.query}".`);
        return { handled: true };
      }
      if (
        matches.length > 1 &&
        matches[0] &&
        matches[1] &&
        matches[0].score - matches[1].score < 30
      ) {
        ctx.pendingMerchantProductChoices = matches.slice(0, 3).map((m) => ({
          productId: m.product.id,
          name: m.product.name,
          priceCents: m.product.priceCents
        }));
        ctx.pendingMerchantAction = { type: "PRICE", priceCents: priceUp.priceCents };
        await updateConversation(conv.id, { context: ctx, state: WhatsAppConversationState.MERCHANT_MENU });
        const list = ctx.pendingMerchantProductChoices
          .map((p, i) => `${i + 1}. ${p.name} (now ${money(p.priceCents)})`)
          .join("\n");
        await wa.sendText(
          phone,
          `Which product?\n${list}\n\nReply 1, 2, or 3 to set price to ${money(priceUp.priceCents)}.`
        );
        return { handled: true };
      }
      const product = matches[0]!.product;
      const updated = await upsertProductForMerchant(
        merchant.id,
        {
          name: product.name,
          priceCents: priceUp.priceCents,
          available: product.available,
          description: product.description ?? undefined,
          unit: product.unit ?? undefined,
          searchAliases: product.searchAliases
        },
        product.id
      );
      await wa.sendText(phone, `Updated *${updated.name}* to ${money(updated.priceCents)}.`);
      return { handled: true };
    }

    const oos = parseOutOfStockText(text);
    if (oos) {
      const matches = await findMerchantProductsByQuery(merchant.id, oos, 5);
      if (matches.length === 0) {
        await wa.sendText(phone, `Couldn't find "${oos}" in your catalog.`);
        return { handled: true };
      }
      if (
        matches.length > 1 &&
        matches[0] &&
        matches[1] &&
        matches[0].score - matches[1].score < 30
      ) {
        ctx.pendingMerchantProductChoices = matches.slice(0, 3).map((m) => ({
          productId: m.product.id,
          name: m.product.name,
          priceCents: m.product.priceCents
        }));
        ctx.pendingMerchantAction = { type: "OOS" };
        await updateConversation(conv.id, { context: ctx });
        const list = ctx.pendingMerchantProductChoices.map((p, i) => `${i + 1}. ${p.name}`).join("\n");
        await wa.sendText(phone, `Which product is out of stock?\n${list}\n\nReply 1, 2, or 3.`);
        return { handled: true };
      }
      await setProductAvailability(merchant.id, matches[0]!.product.id, false);
      await wa.sendText(phone, `*${matches[0]!.product.name}* marked unavailable.`);
      return { handled: true };
    }

    const back = parseBackInStockText(text);
    if (back) {
      const matches = await findMerchantProductsByQuery(merchant.id, back, 5);
      if (matches.length === 0) {
        await wa.sendText(phone, `Couldn't find "${back}" in your catalog.`);
        return { handled: true };
      }
      if (
        matches.length > 1 &&
        matches[0] &&
        matches[1] &&
        matches[0].score - matches[1].score < 30
      ) {
        ctx.pendingMerchantProductChoices = matches.slice(0, 3).map((m) => ({
          productId: m.product.id,
          name: m.product.name,
          priceCents: m.product.priceCents
        }));
        ctx.pendingMerchantAction = { type: "AVAILABLE" };
        await updateConversation(conv.id, { context: ctx });
        const list = ctx.pendingMerchantProductChoices.map((p, i) => `${i + 1}. ${p.name}`).join("\n");
        await wa.sendText(phone, `Which product is available again?\n${list}\n\nReply 1, 2, or 3.`);
        return { handled: true };
      }
      await setProductAvailability(merchant.id, matches[0]!.product.id, true);
      await wa.sendText(phone, `*${matches[0]!.product.name}* is available again.`);
      return { handled: true };
    }

    const unavailableOrder = text.match(/^(.+?)\s+unavailable\s+(\d+)$/i);
    if (unavailableOrder?.[1] && unavailableOrder[2]) {
      const order = await merchantMarkItemUnavailable(merchant.id, unavailableOrder[2], unavailableOrder[1]);
      await wa.sendText(phone, `Marked item unavailable on order #${order.orderNumber}.`);
      if (order.customerWhatsAppPhone) {
        const item = order.items.find((i) => i.unavailableMarked);
        await notifyCustomerStatus(
          order.customerWhatsAppPhone,
          `*${merchant.name}* says ${item?.productNameSnapshot ?? "an item"} is unavailable.\nReply CANCEL to cancel, or message us to adjust your order.`
        );
      }
      return { handled: true };
    }

    await updateConversation(conv.id, { state: WhatsAppConversationState.MERCHANT_MENU });

    await wa.sendText(phone, MERCHANT_HELP);
    return { handled: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Something went wrong.";
    await wa.sendText(phone, message);
    return { handled: true };
  }
}

/** Route inbound WA traffic: merchant numbers go to merchant handler, else customer. */
export async function routeInboundWhatsApp(
  msg: InboundWhatsAppMessage,
  io: Server
): Promise<{ handled: boolean; party: "CUSTOMER" | "MERCHANT"; duplicate?: boolean }> {
  const phone = normalizePhoneNumber(msg.from);
  const merchant = await findMerchantByWhatsApp(phone);
  if (merchant) {
    const result = await handleMerchantWhatsAppMessage(msg, io);
    return { handled: result.handled, party: "MERCHANT", duplicate: result.duplicate };
  }
  const { handleCustomerWhatsAppMessage } = await import("./customer-handler.js");
  const result = await handleCustomerWhatsAppMessage(msg, io);
  return { handled: result.handled, party: "CUSTOMER", duplicate: result.duplicate };
}
