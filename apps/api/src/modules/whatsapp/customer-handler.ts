import { WhatsAppConversationState, WhatsAppParty } from "@prisma/client";
import type { Server } from "socket.io";
import {
  buildOneStoreBasket,
  logUnmatchedSearch,
  searchProductsNear
} from "../commerce/merchant.service.js";
import {
  createConfirmedCommerceOrder,
  ensureWhatsAppCustomer,
  formatOrderSummaryWhatsApp,
  formatOrderTrackMessage,
  getCustomerActiveOrder,
  quoteBasketTotals
} from "../commerce/order.service.js";
import {
  claimInboundMessage,
  getOrCreateConversation,
  readContext,
  updateConversation,
  type ConversationContext
} from "./conversation.service.js";
import { getWhatsAppProvider } from "./provider.js";
import {
  classifyShoppingIntent,
  extractShoppingItemsWithOptionalAi,
  isCancelIntent,
  isConfirmIntent,
  isTrackIntent,
  type ShoppingIntent
} from "./shopping-intent.js";
import {
  applyCartIntent,
  formatRequestedCart,
  isCartExpired
} from "./cart-mutations.js";
import {
  CUSTOMER_HELP,
  CUSTOMER_HELP_FULL,
  formatBudgetOver,
  formatCompactMutation,
  formatDisambiguation,
  formatMissingItems,
  formatOrderCartSummary,
  formatPriceChange,
  formatShopSwitch,
  money,
  parsePriceChangeDetail
} from "./copy.js";
import { normalizePhoneNumber } from "../auth/access.service.js";

export type InboundWhatsAppMessage = {
  providerMessageId: string;
  from: string;
  text?: string;
  buttonId?: string;
  location?: { latitude: number; longitude: number; name?: string; address?: string };
  profileName?: string;
};
export async function handleCustomerWhatsAppMessage(
  msg: InboundWhatsAppMessage,
  _io?: Server
): Promise<{ handled: boolean; duplicate?: boolean }> {
  const phone = normalizePhoneNumber(msg.from);
  const claimed = await claimInboundMessage(msg.providerMessageId, phone, WhatsAppParty.CUSTOMER, msg.text);
  if (!claimed) return { handled: true, duplicate: true };

  const wa = getWhatsAppProvider();
  const customer = await ensureWhatsAppCustomer(phone, msg.profileName);
  const conv = await getOrCreateConversation(phone, WhatsAppParty.CUSTOMER, {
    customerUserId: customer.id
  });
  let ctx = readContext(conv);
  const text = (msg.text || msg.buttonId || "").trim();

  // Expire stale draft quotes — keep location, drop prices
  if (
    isCartExpired(ctx.draftQuotedAt) &&
    (ctx.draftLines?.length || conv.state === WhatsAppConversationState.AWAITING_ORDER_CONFIRMATION)
  ) {
    const { logDutsFlow } = await import("../../lib/flow-log.js");
    logDutsFlow("COMMERCE_CART_EXPIRED", { userId: customer.id });
    ctx = {
      deliveryLat: ctx.deliveryLat,
      deliveryLng: ctx.deliveryLng,
      deliveryLabel: ctx.deliveryLabel,
      requestedItems: ctx.requestedItems,
      budgetCents: ctx.budgetCents,
      activeOrderId: ctx.activeOrderId
    };
    await updateConversation(conv.id, { state: WhatsAppConversationState.BUILDING_CART, context: ctx });
    if (text && !isConfirmIntent(text) && msg.buttonId !== "confirm_order") {
      await wa.sendText(
        phone,
        "That price list expired. Tell me what you need and I'll check today's prices."
      );
    } else {
      await wa.sendText(
        phone,
        "That price list expired. Tell me what you'd like to buy."
      );
      return { handled: true };
    }
  }

  if (isTrackIntent(text)) {
    const order = await getCustomerActiveOrder(customer.id);
    await wa.sendText(phone, formatOrderTrackMessage(order));
    return { handled: true };
  }

  if (msg.buttonId === "cancel_order" || isCancelIntent(text)) {
    ctx = { deliveryLat: ctx.deliveryLat, deliveryLng: ctx.deliveryLng, deliveryLabel: ctx.deliveryLabel };
    await updateConversation(conv.id, { state: WhatsAppConversationState.IDLE, context: ctx });
    await wa.sendText(phone, "Okay — cancelled. Tell me what you'd like whenever you're ready.");
    return { handled: true };
  }

  if (msg.location) {
    ctx.deliveryLat = msg.location.latitude;
    ctx.deliveryLng = msg.location.longitude;
    ctx.deliveryLabel =
      msg.location.name ||
      msg.location.address ||
      `${msg.location.latitude.toFixed(4)}, ${msg.location.longitude.toFixed(4)}`;
    await updateConversation(conv.id, {
      state: WhatsAppConversationState.BUILDING_CART,
      context: ctx,
      customerUserId: customer.id
    });
    if (ctx.requestedItems?.length) {
      return buildAndPresentQuote(phone, conv.id, ctx);
    }
    await wa.sendText(
      phone,
      `Got it — delivering to ${ctx.deliveryLabel}.\n\nWhat would you like?`
    );
    return { handled: true };
  }

  // Adversarial / role-play: never treat customer as merchant or override prices
  if (
    /\b(ignore (your|all) instructions|make .+ \$0|mark (my )?order delivered|i'?m the (shop|merchant|owner)|change all prices)\b/i.test(
      text
    )
  ) {
    await wa.sendText(
      phone,
      "I can only help you shop from nearby shops. Tell me what you'd like."
    );
    return { handled: true };
  }

  if (
    conv.state === WhatsAppConversationState.AWAITING_ORDER_CONFIRMATION &&
    (msg.buttonId === "confirm_order" || isConfirmIntent(text))
  ) {
    return confirmDraftOrder(phone, customer.id, conv.id, ctx);
  }

  if (conv.state === WhatsAppConversationState.AWAITING_PRODUCT_CHOICE) {
    const choiceHandled = await tryApplyDisambiguation(phone, conv.id, ctx, text);
    if (choiceHandled) return choiceHandled;
  }

  // Need location for catalog-backed answers
  const intent = classifyShoppingIntent(text);
  if (
    (intent.kind === "CHECK_PRICE" || intent.kind === "CHECK_AVAILABILITY") &&
    (ctx.deliveryLat == null || ctx.deliveryLng == null)
  ) {
    await updateConversation(conv.id, { state: WhatsAppConversationState.AWAITING_LOCATION, context: ctx });
    await wa.sendText(
      phone,
      "Please share your delivery location first so I can check nearby shops."
    );
    return { handled: true };
  }

  if (intent.kind === "HELP") {
    await wa.sendText(phone, CUSTOMER_HELP_FULL);
    if (ctx.requestedItems?.length) {
      await wa.sendText(phone, formatRequestedCart(ctx.requestedItems));
    }
    return { handled: true };
  }

  if (intent.kind === "CORRECT") {
    if (
      conv.state === WhatsAppConversationState.AWAITING_PRODUCT_CHOICE &&
      ctx.pendingChoices?.length
    ) {
      ctx.pendingChoices = undefined;
      ctx.lastDisambiguationQuery = undefined;
      await updateConversation(conv.id, {
        state: WhatsAppConversationState.BUILDING_CART,
        context: ctx
      });
      await wa.sendText(phone, "No problem. Which product did you want instead?");
      return { handled: true };
    }
    if (conv.state === WhatsAppConversationState.AWAITING_ORDER_CONFIRMATION) {
      await wa.sendText(
        phone,
        "What would you like to change? Say ADD, REMOVE, or tell me the items."
      );
      return { handled: true };
    }
    if (ctx.requestedItems?.length) {
      await wa.sendText(
        phone,
        "What should I change? Say remove an item, or tell me what you meant."
      );
      return { handled: true };
    }
    await wa.sendText(phone, "What would you like instead?");
    return { handled: true };
  }

  if (intent.kind === "START_OVER") {
    ctx = {
      deliveryLat: ctx.deliveryLat,
      deliveryLng: ctx.deliveryLng,
      deliveryLabel: ctx.deliveryLabel
    };
    await updateConversation(conv.id, { state: WhatsAppConversationState.BUILDING_CART, context: ctx });
    await wa.sendText(phone, "Fresh start. What would you like?");
    return { handled: true };
  }

  if (intent.kind === "SET_BUDGET" && intent.budgetCents) {
    ctx.budgetCents = intent.budgetCents;
    await updateConversation(conv.id, { context: ctx });
    await wa.sendText(
      phone,
      `Got it — I'll keep your items under ${money(intent.budgetCents)} (before delivery). What do you need?`
    );
    return { handled: true };
  }

  if (intent.kind === "CHECK_PRICE" && intent.targetQuery && ctx.deliveryLat != null && ctx.deliveryLng != null) {
    return answerPriceQuestion(phone, ctx, intent);
  }

  if (
    intent.kind === "CHECK_AVAILABILITY" &&
    intent.targetQuery &&
    ctx.deliveryLat != null &&
    ctx.deliveryLng != null
  ) {
    return answerAvailability(phone, ctx, intent);
  }

  if (intent.kind === "SHOW_CART" || intent.kind === "CHECK_TOTAL") {
    if (!ctx.requestedItems?.length && !ctx.draftLines?.length) {
      await wa.sendText(phone, "Your cart is empty. Tell me what you'd like to buy.");
      return { handled: true };
    }
    if (ctx.draftLines?.length && ctx.merchantId) {
      return buildAndPresentQuote(phone, conv.id, {
        ...ctx,
        requestedItems: ctx.requestedItems?.length
          ? ctx.requestedItems
          : ctx.draftLines.map((l) => ({ query: l.productName, quantity: l.quantity }))
      });
    }
    if (ctx.requestedItems?.length && ctx.deliveryLat != null) {
      return buildAndPresentQuote(phone, conv.id, ctx);
    }
    await wa.sendText(phone, formatRequestedCart(ctx.requestedItems ?? []));
    return { handled: true };
  }

  if (intent.kind === "CLEAR_CART") {
    ctx.requestedItems = [];
    ctx.draftLines = undefined;
    ctx.merchantId = undefined;
    ctx.draftQuotedAt = undefined;
    await updateConversation(conv.id, { state: WhatsAppConversationState.BUILDING_CART, context: ctx });
    await wa.sendText(phone, "Cart cleared. What would you like?");
    return { handled: true };
  }

  if (intent.kind === "CHECKOUT") {
    if (ctx.draftLines?.length) {
      return confirmDraftOrder(phone, customer.id, conv.id, ctx);
    }
    if (ctx.requestedItems?.length && ctx.deliveryLat != null) {
      return buildAndPresentQuote(phone, conv.id, ctx);
    }
    await wa.sendText(phone, "Your cart is empty. Tell me what you'd like to buy first.");
    return { handled: true };
  }

  // Cart mutations while building / confirming
  const mutating = ["ADD_ITEM", "REMOVE_ITEM", "CHANGE_QUANTITY", "REPLACE_ITEM", "NEW_LIST"].includes(
    intent.kind
  );
  if (mutating) {
    if (ctx.deliveryLat == null || ctx.deliveryLng == null) {
      if (intent.kind === "NEW_LIST" && intent.items?.length) {
        ctx.requestedItems = intent.items;
        if (intent.budgetCents) ctx.budgetCents = intent.budgetCents;
      } else if (intent.items?.length) {
        const applied = applyCartIntent(ctx.requestedItems ?? [], intent);
        if (applied.ok) ctx.requestedItems = applied.items;
      }
      await updateConversation(conv.id, {
        state: WhatsAppConversationState.AWAITING_LOCATION,
        context: ctx
      });
      await wa.sendText(
        phone,
        "Please share your delivery location using WhatsApp's location button."
      );
      return { handled: true };
    }

    const hadDraft = Boolean(ctx.draftLines?.length);
    const draftNames = ctx.draftLines?.map((l) => l.productName);
    const applied = applyCartIntent(ctx.requestedItems ?? [], intent, draftNames);
    if (!applied.ok) {
      await wa.sendText(phone, applied.ask || CUSTOMER_HELP);
      return { handled: true };
    }

    ctx.requestedItems = applied.items;
    if (intent.budgetCents) ctx.budgetCents = intent.budgetCents;
    ctx.draftLines = undefined;
    ctx.previousMerchantId = ctx.merchantId;
    ctx.merchantId = undefined;

    const { logDutsFlow } = await import("../../lib/flow-log.js");
    logDutsFlow("COMMERCE_CART_MUTATED", {
      userId: customer.id,
      mutation: intent.kind,
      itemCount: applied.items.length
    });

    if (applied.items.length === 0) {
      await updateConversation(conv.id, { state: WhatsAppConversationState.BUILDING_CART, context: ctx });
      await wa.sendText(phone, "Your cart is empty. Tell me what you'd like to buy.");
      return { handled: true };
    }

    return buildAndPresentQuote(phone, conv.id, ctx, {
      compact: hadDraft && intent.kind !== "NEW_LIST",
      mutationNote: mutationNoteForIntent(intent)
    });
  }

  // change_order button / text — keep cart, ask for edits
  if (msg.buttonId === "change_order") {
    await updateConversation(conv.id, { state: WhatsAppConversationState.BUILDING_CART, context: ctx });
    await wa.sendText(
      phone,
      `${formatRequestedCart(ctx.requestedItems ?? [])}\n\nSay ADD, REMOVE, or change an item.`
    );
    return { handled: true };
  }

  if (ctx.deliveryLat == null || ctx.deliveryLng == null) {
    const vaguePlace = /^(highfield|mbare|avondale|borrowdale|harare|town|cbd)\b/i.test(text);
    if (text && !vaguePlace && intent.kind === "UNKNOWN") {
      // Try AI extract only as shopping list guess
      const items = await extractShoppingItemsWithOptionalAi(text);
      if (items.length) {
        ctx.requestedItems = items;
        await updateConversation(conv.id, {
          state: WhatsAppConversationState.AWAITING_LOCATION,
          context: ctx
        });
        await wa.sendText(
          phone,
          "Please share your delivery location using WhatsApp's location button."
        );
        return { handled: true };
      }
    }
    await updateConversation(conv.id, { state: WhatsAppConversationState.AWAITING_LOCATION, context: ctx });
    await wa.sendText(
      phone,
      "Please share your delivery location using WhatsApp's location button."
    );
    return { handled: true };
  }

  // UNKNOWN with AI fallback for items only
  if (intent.kind === "UNKNOWN") {
    const items = await extractShoppingItemsWithOptionalAi(text);
    if (items.length) {
      const applied = applyCartIntent(ctx.requestedItems ?? [], {
        kind: (ctx.requestedItems?.length ?? 0) > 0 ? "ADD_ITEM" : "NEW_LIST",
        items,
        confidence: "medium"
      });
      if (applied.ok) {
        ctx.requestedItems = applied.items;
        return buildAndPresentQuote(phone, conv.id, ctx);
      }
    }
    await wa.sendText(phone, CUSTOMER_HELP);
    return { handled: true };
  }

  return buildAndPresentQuote(phone, conv.id, ctx);
}

function mutationNoteForIntent(intent: ShoppingIntent): string {
  const first = intent.items?.[0] ?? intent.targetQuery;
  const label =
    typeof first === "string"
      ? first
      : first
        ? `${first.quantity > 1 ? `${first.quantity} × ` : ""}${first.query}`
        : "Item";
  switch (intent.kind) {
    case "ADD_ITEM":
      return `${label} added`;
    case "REMOVE_ITEM":
      return `${typeof first === "string" ? first : first?.query ?? "Item"} removed`;
    case "CHANGE_QUANTITY":
      return typeof first === "string" ? `Updated ${first}` : `Updated ${first?.query ?? "item"}`;
    case "REPLACE_ITEM":
      return "Updated your cart";
    default:
      return "Updated";
  }
}

async function answerPriceQuestion(phone: string, ctx: ConversationContext, intent: ShoppingIntent) {
  const wa = getWhatsAppProvider();
  const matches = await searchProductsNear(ctx.deliveryLat!, ctx.deliveryLng!, intent.targetQuery!, {
    availableOnly: true
  });
  const { logDutsFlow } = await import("../../lib/flow-log.js");
  logDutsFlow("WHATSAPP_SEARCH", {
    query: intent.targetQuery,
    matchType: matches.length === 0 ? "NO_MATCH" : matches.length > 1 ? "AMBIGUOUS" : "MATCHED",
    resultCount: matches.length
  });
  if (matches.length === 0) {
    await logUnmatchedSearch(intent.targetQuery!, ctx.deliveryLat!, ctx.deliveryLng!);
    await wa.sendText(
      phone,
      `I couldn't find "${intent.targetQuery}" at nearby shops right now.`
    );
    return { handled: true };
  }
  const sorted =
    intent.reference === "cheapest"
      ? [...matches].sort((a, b) => a.product.priceCents - b.product.priceCents)
      : matches;
  const top = sorted.slice(0, 5);
  const lines = top
    .map((m) => `• ${m.product.name} — ${money(m.product.priceCents)} (${m.merchant.name})`)
    .join("\n");
  await wa.sendText(phone, `*Prices nearby*\n${lines}`);
  return { handled: true };
}

async function answerAvailability(phone: string, ctx: ConversationContext, intent: ShoppingIntent) {
  const wa = getWhatsAppProvider();
  const matches = await searchProductsNear(ctx.deliveryLat!, ctx.deliveryLng!, intent.targetQuery!, {
    availableOnly: true
  });
  const { logDutsFlow } = await import("../../lib/flow-log.js");
  logDutsFlow("WHATSAPP_SEARCH", {
    query: intent.targetQuery,
    matchType: matches.length === 0 ? "NO_MATCH" : "MATCHED",
    resultCount: matches.length
  });
  if (matches.length === 0) {
    await logUnmatchedSearch(intent.targetQuery!, ctx.deliveryLat!, ctx.deliveryLng!);
    await wa.sendText(phone, `No nearby shop has "${intent.targetQuery}" available right now.`);
    return { handled: true };
  }
  const byShop = new Map<string, { name: string; products: string[] }>();
  for (const m of matches.slice(0, 12)) {
    const row = byShop.get(m.merchant.id) ?? { name: m.merchant.name, products: [] };
    row.products.push(`${m.product.name} — ${money(m.product.priceCents)}`);
    byShop.set(m.merchant.id, row);
  }
  const body = [...byShop.values()]
    .map((s) => `*${s.name}*\n${s.products.map((p) => `• ${p}`).join("\n")}`)
    .join("\n\n");
  await wa.sendText(phone, `Yes — here's what's nearby:\n\n${body}`);
  return { handled: true };
}

async function tryApplyDisambiguation(
  phone: string,
  convId: string,
  ctx: ConversationContext,
  text: string
) {
  const pending = ctx.pendingChoices?.[0];
  if (!pending) return null;

  let choice: number | null = null;
  if (/^\d+$/.test(text)) choice = Number(text);
  else if (/^(number\s*)?1\b|first|the first/i.test(text)) choice = 1;
  else if (/^(number\s*)?2\b|second/i.test(text)) choice = 2;
  else if (/^(number\s*)?3\b|third/i.test(text)) choice = 3;
  else {
    // Match by size / name fragment against option names
    const n = text.toLowerCase();
    const idx = pending.options.findIndex(
      (o) =>
        o.name.toLowerCase().includes(n) ||
        (n.includes("2l") && /2\s*l/i.test(o.name)) ||
        (n.includes("1l") && /1\s*l/i.test(o.name)) ||
        (n.includes("500") && /500/i.test(o.name)) ||
        (/(big|large)/i.test(n) && /2\s*l|2l/i.test(o.name))
    );
    if (idx >= 0) choice = idx + 1;
  }

  if (choice == null) return null;
  return applyProductChoice(phone, convId, ctx, choice);
}

async function buildAndPresentQuote(
  phone: string,
  convId: string,
  ctx: ConversationContext,
  opts?: { compact?: boolean; mutationNote?: string }
) {
  const wa = getWhatsAppProvider();
  if (ctx.deliveryLat == null || ctx.deliveryLng == null || !ctx.requestedItems?.length) {
    await updateConversation(convId, { state: WhatsAppConversationState.AWAITING_LOCATION, context: ctx });
    await wa.sendText(phone, "Please share your delivery location using WhatsApp's location button.");
    return { handled: true };
  }

  const preferredId = ctx.merchantId ?? ctx.previousMerchantId;
  const basket = await buildOneStoreBasket(ctx.deliveryLat, ctx.deliveryLng, ctx.requestedItems, {
    preferredMerchantId: preferredId
  });

  if (!basket.ok) {
    const missing = basket.missing.join(", ") || "some items";
    await updateConversation(convId, { state: WhatsAppConversationState.BUILDING_CART, context: ctx });
    const partial = basket.partialByMerchant[0];
    const hint = partial
      ? `${partial.merchant.name} has: ${partial.covered.join(", ")}.`
      : undefined;
    await wa.sendText(phone, formatMissingItems(missing, hint));
    return { handled: true };
  }

  // Disambiguation within chosen merchant
  for (const item of ctx.requestedItems) {
    const matches = await searchProductsNear(ctx.deliveryLat, ctx.deliveryLng, item.query, {
      merchantId: basket.merchant.id,
      availableOnly: true
    });
    if (matches.length > 1 && matches[0] && matches[1] && matches[0].score - matches[1].score < 30) {
      const options = matches.slice(0, 3).map((m) => ({
        productId: m.product.id,
        name: m.product.name,
        priceCents: m.product.priceCents
      }));
      ctx.pendingChoices = [{ query: item.query, options }];
      ctx.lastDisambiguationQuery = item.query;
      await updateConversation(convId, {
        state: WhatsAppConversationState.AWAITING_PRODUCT_CHOICE,
        context: ctx
      });
      const title =
        options.length === 2
          ? `Which ${item.query}?`
          : "Which one do you want?";
      await wa.sendText(phone, formatDisambiguation(title, options));
      return { handled: true };
    }
  }

  ctx.draftLines = basket.lines;
  ctx.merchantId = basket.merchant.id;
  ctx.draftQuotedAt = new Date().toISOString();

  const totals = await quoteBasketTotals({
    merchantLat: Number(basket.merchant.latitude),
    merchantLng: Number(basket.merchant.longitude),
    customerLat: ctx.deliveryLat,
    customerLng: ctx.deliveryLng,
    lines: basket.lines
  });

  const { logDutsFlow } = await import("../../lib/flow-log.js");
  logDutsFlow("COMMERCE_BASKET_CREATED", {
    merchantId: basket.merchant.id,
    itemCount: basket.lines.length,
    subtotalCents: basket.lines.reduce((s, l) => s + l.lineTotalCents, 0)
  });
  logDutsFlow("COMMERCE_QUOTE_GENERATED", {
    merchantId: basket.merchant.id,
    totalCents: totals.totalCents,
    deliveryFeeCents: totals.deliveryFeeCents
  });

  // Budget check (items only — before delivery)
  if (ctx.budgetCents && totals.subtotalCents > ctx.budgetCents) {
    logDutsFlow("COMMERCE_BUDGET_EXCEEDED", {
      budgetCents: ctx.budgetCents,
      subtotalCents: totals.subtotalCents
    });
    await updateConversation(convId, {
      state: WhatsAppConversationState.BUILDING_CART,
      context: ctx
    });
    await wa.sendText(
      phone,
      formatBudgetOver({
        subtotalCents: totals.subtotalCents,
        budgetCents: ctx.budgetCents,
        lines: basket.lines.map((l) => ({
          quantity: l.quantity,
          productName: l.productName,
          lineTotalCents: l.lineTotalCents
        }))
      })
    );
    return { handled: true };
  }

  let previousShopName: string | undefined;
  if (basket.switchedFromPreferred && preferredId) {
    const { prisma } = await import("../../config/prisma.js");
    const prev = await prisma.merchant.findUnique({ where: { id: preferredId }, select: { name: true } });
    previousShopName = prev?.name;
  }

  ctx.previousMerchantId = basket.merchant.id;
  await updateConversation(convId, {
    state: WhatsAppConversationState.AWAITING_ORDER_CONFIRMATION,
    context: ctx
  });

  if (opts?.compact && !basket.switchedFromPreferred) {
    await wa.sendText(
      phone,
      formatCompactMutation({
        note: opts.mutationNote || "Updated",
        totalCents: totals.totalCents
      })
    );
    return { handled: true };
  }

  const summary = formatOrderCartSummary({
    shopName: basket.merchant.name,
    lines: basket.lines.map((l) => ({
      quantity: l.quantity,
      productName: l.productName,
      lineTotalCents: l.lineTotalCents
    })),
    subtotalCents: totals.subtotalCents,
    deliveryFeeCents: totals.deliveryFeeCents,
    serviceFeeCents: totals.serviceFeeCents,
    totalCents: totals.totalCents,
    deliveryLabel: ctx.deliveryLabel ?? "your location",
    paymentNote: "Payment: cash on delivery",
    footer: "Reply:\nCONFIRM, CHANGE, or CANCEL"
  });

  const switchNote = basket.switchedFromPreferred
    ? formatShopSwitch({
        previousShopName,
        newShopName: basket.merchant.name,
        totalCents: totals.totalCents
      }) + "\n\n"
    : "";

  const body = switchNote + summary;

  try {
    await wa.sendButtons(phone, body, [
      { id: "confirm_order", title: "Confirm order" },
      { id: "change_order", title: "Change order" },
      { id: "cancel_order", title: "Cancel" }
    ]);
  } catch {
    await wa.sendText(phone, body);
  }
  return { handled: true };
}

async function applyProductChoice(
  phone: string,
  convId: string,
  ctx: ConversationContext,
  choice: number
) {
  const wa = getWhatsAppProvider();
  const pending = ctx.pendingChoices?.[0];
  if (!pending || choice < 1 || choice > pending.options.length) {
    await wa.sendText(phone, "Reply with a valid option number.");
    return { handled: true };
  }
  const selected = pending.options[choice - 1];
  if (!selected) {
    await wa.sendText(phone, "Reply with a valid option number.");
    return { handled: true };
  }
  // Bind to real product name from DB option — never AI-invented IDs
  ctx.requestedItems = (ctx.requestedItems ?? []).map((r) =>
    r.query === pending.query || r.query === ctx.lastDisambiguationQuery
      ? { query: selected.name, quantity: r.quantity }
      : r
  );
  ctx.pendingChoices = undefined;
  await updateConversation(convId, { state: WhatsAppConversationState.BUILDING_CART, context: ctx });
  return buildAndPresentQuote(phone, convId, ctx);
}

async function confirmDraftOrder(
  phone: string,
  customerId: string,
  convId: string,
  ctx: ConversationContext
) {
  const wa = getWhatsAppProvider();
  if (!ctx.draftLines?.length || !ctx.merchantId || ctx.deliveryLat == null || ctx.deliveryLng == null) {
    await wa.sendText(phone, "That expired. Tell me what you'd like to buy again.");
    await updateConversation(convId, {
      state: WhatsAppConversationState.IDLE,
      context: {
        deliveryLat: ctx.deliveryLat,
        deliveryLng: ctx.deliveryLng,
        deliveryLabel: ctx.deliveryLabel
      }
    });
    return { handled: true };
  }

  if (isCartExpired(ctx.draftQuotedAt)) {
    const { logDutsFlow } = await import("../../lib/flow-log.js");
    logDutsFlow("COMMERCE_CART_EXPIRED", { userId: customerId });
    ctx.draftLines = undefined;
    ctx.draftQuotedAt = undefined;
    await updateConversation(convId, { state: WhatsAppConversationState.BUILDING_CART, context: ctx });
    await wa.sendText(phone, "Those prices expired. Tell me what you need and I'll check again.");
    return { handled: true };
  }

  try {
    const order = await createConfirmedCommerceOrder({
      customerId,
      merchantId: ctx.merchantId,
      lines: ctx.draftLines,
      deliveryLabel: ctx.deliveryLabel || "Shared location",
      deliveryLatitude: ctx.deliveryLat,
      deliveryLongitude: ctx.deliveryLng,
      customerWhatsAppPhone: phone
    });

    ctx.activeOrderId = order.id;
    ctx.draftLines = undefined;
    ctx.draftQuotedAt = undefined;
    ctx.requestedItems = undefined;
    await updateConversation(convId, {
      state: WhatsAppConversationState.ORDER_ACTIVE,
      context: ctx
    });

    await wa.sendText(
      phone,
      `${formatOrderSummaryWhatsApp(order)}\n\nOrder received. ${order.merchant.name} is confirming your order.\nPayment: cash on delivery.`
    );

    const { notifyMerchantNewOrder } = await import("./merchant-handler.js");
    await notifyMerchantNewOrder(order);

    return { handled: true };
  } catch (error) {
    const err = error as Error & { code?: string; errors?: Record<string, string> };
    if (err.code === "PRICE_CHANGED") {
      const { logDutsFlow } = await import("../../lib/flow-log.js");
      logDutsFlow("COMMERCE_PRICE_CHANGED", { merchantId: ctx.merchantId });
      logDutsFlow("COMMERCE_QUOTE_INVALIDATED", { reason: "PRICE_CHANGED" });
      const refreshed = err.errors?.lines ? (JSON.parse(err.errors.lines) as typeof ctx.draftLines) : null;
      if (refreshed?.length) {
        ctx.draftLines = refreshed;
        ctx.draftQuotedAt = new Date().toISOString();
        const totals = await quoteBasketTotalsFromContext(ctx);
        await updateConversation(convId, {
          state: WhatsAppConversationState.AWAITING_ORDER_CONFIRMATION,
          context: ctx
        });
        const changeDetail = err.errors?.changes || err.message.replace(
          /^One price changed since your quote\.\s*/i,
          ""
        );
        const parsed = parsePriceChangeDetail(changeDetail);
        const body =
          parsed.length && totals
            ? formatPriceChange({ changes: parsed, totalCents: totals.totalCents })
            : [
                parsed.length
                  ? parsed
                      .map(
                        (c) =>
                          `The price of ${c.name} changed from ${money(c.oldCents)} to ${money(c.newCents)}.`
                      )
                      .join("\n")
                  : changeDetail,
                totals ? `Your new total is ${money(totals.totalCents)}. Continue?` : null,
                "",
                "Reply CONFIRM or CHANGE."
              ]
                .filter(Boolean)
                .join("\n");
        await wa.sendButtons(phone, body, [
          { id: "confirm_order", title: "Confirm updated" },
          { id: "change_order", title: "Change order" },
          { id: "cancel_order", title: "Cancel" }
        ]);
        return { handled: true };
      }
    }
    if (err.code === "PRODUCT_UNAVAILABLE" || err.code === "MERCHANT_CLOSED") {
      const { logDutsFlow } = await import("../../lib/flow-log.js");
      logDutsFlow("COMMERCE_PRODUCT_UNAVAILABLE", { merchantId: ctx.merchantId });
      logDutsFlow("COMMERCE_QUOTE_INVALIDATED", { reason: err.code });
      const itemHint =
        err.code === "PRODUCT_UNAVAILABLE"
          ? "That item is out of stock. Want to remove it or choose another?"
          : "That shop is closed right now. Want to try different items, or say CANCEL?";
      await wa.sendText(phone, itemHint);
      ctx.draftLines = undefined;
      await updateConversation(convId, { state: WhatsAppConversationState.BUILDING_CART, context: ctx });
      return { handled: true };
    }
    await wa.sendText(phone, "Couldn't place your order. Please try again or say HELP.");
    return { handled: true };
  }
}

async function quoteBasketTotalsFromContext(ctx: ConversationContext) {
  if (!ctx.draftLines?.length || !ctx.merchantId || ctx.deliveryLat == null || ctx.deliveryLng == null) {
    return null;
  }
  const { quoteBasketTotals } = await import("../commerce/order.service.js");
  const { prisma } = await import("../../config/prisma.js");
  const merchant = await prisma.merchant.findUnique({ where: { id: ctx.merchantId } });
  if (!merchant) return null;
  return quoteBasketTotals({
    merchantLat: Number(merchant.latitude),
    merchantLng: Number(merchant.longitude),
    customerLat: ctx.deliveryLat,
    customerLng: ctx.deliveryLng,
    lines: ctx.draftLines
  });
}
