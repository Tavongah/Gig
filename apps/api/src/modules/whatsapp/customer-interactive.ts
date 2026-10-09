import type { ConversationContext } from "./conversation.service.js";
import { setExpected } from "./checkout-session.js";
import {
  registerInteractiveAction,
  type InteractiveActionKind,
  type InteractiveActionSpec
} from "./interactive-actions.js";
import { getWhatsAppProvider, type WhatsAppButton } from "./provider.js";
import {
  formatChangeWhat,
  formatCustomerHelpMenu,
  formatChoiceTextFallback,
  formatCustomerWelcome,
  formatDisambiguation,
  formatLocationAmbiguous,
  formatLocationAsk,
  formatLocationUseThisArea,
  formatMainMenu,
  formatPaymentMethodChoice,
  formatReadyToOrder,
  formatShopPrompt,
  formatStatusChoices,
  formatUnlistedNotFoundOffer,
  formatUnlistedPaymentChoice,
  formatUnlistedQuote
} from "./copy.js";
import type { UnlistedPublicRequest } from "../commerce/unlisted-item.service.js";

export type CustomerChoice = {
  title: string;
  description?: string;
  action: InteractiveActionSpec;
};

function sessionBound(
  ctx: ConversationContext,
  kind: InteractiveActionKind,
  extra?: Partial<InteractiveActionSpec>
): InteractiveActionSpec {
  return {
    kind,
    checkoutSessionId: ctx.checkoutSessionId,
    expectedInput: ctx.expectedInput ?? "NONE",
    ...extra
  };
}

export async function sendCustomerChoices(
  phone: string,
  ctx: ConversationContext,
  body: string,
  choices: CustomerChoice[]
): Promise<void> {
  const wa = getWhatsAppProvider();
  if (!choices.length) {
    await wa.sendText(phone, body);
    return;
  }
  const buttons: WhatsAppButton[] = choices.map((c) => {
    const rec = registerInteractiveAction(ctx, c.action);
    return {
      id: rec.token,
      title: c.title.slice(0, 20),
      description: c.description?.slice(0, 72)
    };
  });
  try {
    if (buttons.length > 3 && wa.sendList) {
      await wa.sendList(phone, body, "View options", buttons);
      return;
    }
    await wa.sendButtons(phone, body, buttons.slice(0, 3));
  } catch {
    await wa.sendText(
      phone,
      formatChoiceTextFallback(
        body,
        choices.map((c) => c.title)
      )
    );
  }
}

export async function sendMainMenu(phone: string, ctx: ConversationContext, welcome: boolean): Promise<void> {
  ctx.welcomeSentAt = ctx.welcomeSentAt ?? new Date().toISOString();
  setExpected(ctx, "NONE");
  const body = welcome ? formatCustomerWelcome() : formatMainMenu();
  await sendCustomerChoices(phone, ctx, body, [
    { title: "Shop", action: { kind: "MENU_SHOP" } },
    { title: "Track order", action: { kind: "MENU_TRACK" } },
    { title: "Help", action: { kind: "MENU_HELP" } }
  ]);
}

export async function sendShopPrompt(phone: string, ctx: ConversationContext): Promise<void> {
  await getWhatsAppProvider().sendText(phone, formatShopPrompt());
}

export async function sendHelpMenu(phone: string, ctx: ConversationContext): Promise<void> {
  await sendCustomerChoices(phone, ctx, formatCustomerHelpMenu(), [
    { title: "Track order", action: { kind: "MENU_TRACK" } },
    { title: "Main menu", action: { kind: "MENU_MAIN" } }
  ]);
}

export async function sendCartActions(
  phone: string,
  ctx: ConversationContext,
  input: {
    lines: Array<{ quantity: number; productName: string; lineTotalCents: number }>;
    subtotalCents: number;
  }
): Promise<void> {
  const body = formatReadyToOrder(input);
  await sendCustomerChoices(phone, ctx, body, [
    { title: "Continue", action: sessionBound(ctx, "CART_CONTINUE") },
    { title: "Add more", action: sessionBound(ctx, "CART_ADD_MORE") },
    { title: "View cart", action: sessionBound(ctx, "CART_VIEW") }
  ]);
}

export async function sendProductChoices(
  phone: string,
  ctx: ConversationContext,
  title: string,
  options: Array<{ productId: string; name: string; priceCents: number }>
): Promise<void> {
  const body = formatDisambiguation(title, options);
  const bounded = options.slice(0, 10);
  await sendCustomerChoices(
    phone,
    ctx,
    body,
    bounded.map((o, i) => ({
      title: o.name.slice(0, 20),
      description: `$${(o.priceCents / 100).toFixed(2)}`,
      action: sessionBound(ctx, "SELECT_PRODUCT", {
        productId: o.productId,
        choiceIndex: i + 1,
        expectedInput: "PRODUCT_DISAMBIGUATION"
      })
    }))
  );
}

export async function sendLocationCandidates(
  phone: string,
  ctx: ConversationContext,
  options: Array<{ label: string }>
): Promise<void> {
  const body = formatLocationAmbiguous(options);
  const rows: CustomerChoice[] = options.slice(0, 9).map((o, i) => ({
    title: o.label.slice(0, 24),
    action: sessionBound(ctx, "LOC_PICK", {
      choiceIndex: i + 1,
      expectedInput: "LOCATION_CLARIFICATION",
      locationClarificationType: "ADDRESS_CHOICE"
    })
  }));
  rows.push({
    title: "None of these",
    action: sessionBound(ctx, "LOC_NONE", {
      expectedInput: "LOCATION_CLARIFICATION",
      locationClarificationType: "ADDRESS_CHOICE"
    })
  });
  await sendCustomerChoices(phone, ctx, body, rows);
}

export async function sendUseThisArea(phone: string, ctx: ConversationContext, label: string): Promise<void> {
  await sendCustomerChoices(phone, ctx, formatLocationUseThisArea({ label }), [
    {
      title: "Use this area",
      action: sessionBound(ctx, "LOC_USE_AREA", {
        expectedInput: "LOCATION_CLARIFICATION",
        locationClarificationType: ctx.locationClarificationType ?? "CONFIRM_AREA"
      })
    },
    {
      title: "Change address",
      action: sessionBound(ctx, "LOC_CHANGE", {
        expectedInput: "LOCATION_CLARIFICATION",
        locationClarificationType: ctx.locationClarificationType ?? "CONFIRM_AREA"
      })
    }
  ]);
}

export async function sendLocationAsk(phone: string): Promise<void> {
  await getWhatsAppProvider().sendText(phone, formatLocationAsk());
}

export async function sendOrderReview(
  phone: string,
  ctx: ConversationContext,
  body: string
): Promise<void> {
  await sendCustomerChoices(phone, ctx, body, [
    { title: "Place order", action: sessionBound(ctx, "REVIEW_PLACE", { expectedInput: "ORDER_CONFIRMATION" }) },
    {
      title: "Change address",
      action: sessionBound(ctx, "REVIEW_CHANGE_ADDRESS", { expectedInput: "ORDER_CONFIRMATION" })
    },
    {
      title: "Change items",
      action: sessionBound(ctx, "REVIEW_CHANGE_ITEMS", { expectedInput: "ORDER_CONFIRMATION" })
    }
  ]);
}

export async function sendPaymentChoices(phone: string, ctx: ConversationContext, totalCents?: number): Promise<void> {
  await sendCustomerChoices(phone, ctx, formatPaymentMethodChoice(totalCents), [
    {
      title: "EcoCash",
      action: sessionBound(ctx, "PAYMENT_ECOCASH", { expectedInput: ctx.expectedInput ?? "PAYMENT_METHOD" })
    },
    {
      title: "Cash on delivery",
      action: sessionBound(ctx, "PAYMENT_COD", { expectedInput: ctx.expectedInput ?? "PAYMENT_METHOD" })
    }
  ]);
}

export async function sendChangeWhat(phone: string, ctx: ConversationContext, includePayment: boolean): Promise<void> {
  const choices: CustomerChoice[] = [
    { title: "Items", action: sessionBound(ctx, "CHANGE_ITEMS", { expectedInput: "CHANGE_WHAT" }) },
    { title: "Location", action: sessionBound(ctx, "CHANGE_LOCATION", { expectedInput: "CHANGE_WHAT" }) }
  ];
  if (includePayment) {
    choices.push({
      title: "Payment",
      action: sessionBound(ctx, "CHANGE_PAYMENT", { expectedInput: "CHANGE_WHAT" })
    });
  }
  await sendCustomerChoices(phone, ctx, formatChangeWhat(includePayment), choices);
}

export async function sendTrackChoices(
  phone: string,
  ctx: ConversationContext,
  orders: Array<{ id: string; orderNumber: number; label: string }>
): Promise<void> {
  const body = formatStatusChoices(orders.map((o) => ({ orderNumber: o.orderNumber, label: o.label })));
  await sendCustomerChoices(
    phone,
    ctx,
    body,
    orders.slice(0, 10).map((o) => ({
      title: `Order #${o.orderNumber}`.slice(0, 24),
      description: o.label.slice(0, 72),
      action: { kind: "TRACK_ORDER", orderId: o.id }
    }))
  );
}

export function formatStaleChoiceNotice(): string {
  return "That option is no longer active.";
}

export async function sendUnlistedOffer(phone: string, ctx: ConversationContext, itemName: string): Promise<void> {
  await sendCustomerChoices(phone, ctx, formatUnlistedNotFoundOffer(itemName), [
    {
      title: "Request this item",
      action: sessionBound(ctx, "UNLISTED_REQUEST", { expectedInput: "UNLISTED_OFFER" })
    },
    {
      title: "Try another search",
      action: sessionBound(ctx, "UNLISTED_TRY_AGAIN", { expectedInput: "UNLISTED_OFFER" })
    }
  ]);
}

export async function sendUnlistedQuoteMessage(
  phone: string,
  ctx: ConversationContext,
  request: UnlistedPublicRequest
): Promise<void> {
  const itemCents = (request.foundPriceCents ?? 0) * request.quantity;
  const body = formatUnlistedQuote({
    productName: request.foundProductName ?? request.parsedItemName,
    itemCents,
    deliveryCents: request.deliveryFeeCents ?? 0,
    totalCents: request.totalCents ?? itemCents,
    merchantName: request.foundMerchantName,
    quantity: request.quantity,
    maxBudgetCents: request.optionalMaxBudgetCents,
    foundPriceCents: request.foundPriceCents,
    photoUrl: request.foundPhotoUrl
  });
  await sendCustomerChoices(phone, ctx, body, [
    {
      title: "Buy it",
      action: sessionBound(ctx, "UNLISTED_BUY", {
        expectedInput: "UNLISTED_QUOTE",
        unlistedRequestId: request.id,
        approvalId: request.approvalId ?? undefined
      })
    },
    {
      title: "No thanks",
      action: sessionBound(ctx, "UNLISTED_DECLINE", {
        expectedInput: "UNLISTED_QUOTE",
        unlistedRequestId: request.id,
        approvalId: request.approvalId ?? undefined
      })
    }
  ]);
}

export async function sendUnlistedPaymentChoice(
  phone: string,
  ctx: ConversationContext,
  totalCents: number
): Promise<void> {
  await sendCustomerChoices(phone, ctx, formatUnlistedPaymentChoice(totalCents), [
    {
      title: "EcoCash",
      action: sessionBound(ctx, "UNLISTED_PAY_ECOCASH", {
        expectedInput: ctx.expectedInput ?? "UNLISTED_PAYMENT",
        unlistedRequestId: ctx.unlistedRequestId
      })
    }
  ]);
}
