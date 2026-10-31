import { WhatsAppConversationState, WhatsAppParty } from "@prisma/client";
import type { Server } from "socket.io";
import { normalizeProductSearchName, resolveSupportedPackagePricingCity } from "@gigflow/shared";
import { matchPublicCatalogDemand } from "../commerce/catalog.service.js";
import {
  buildOneStoreBasket,
  searchProductsNear
} from "../commerce/merchant.service.js";
import {
  createConfirmedCommerceOrder,
  formatOrderTrackMessage,
  getCustomerActiveOrders,
  quoteBasketTotals
} from "../commerce/order.service.js";
import { quoteCart } from "../commerce/customer-commerce.service.js";
import { acceptUnresolvedProductRequest, acceptUnresolvedTextRequest } from "../commerce/unresolved-checkout.service.js";
import { proposeMerchantPriceForCheckout } from "../commerce/quote-proposal.service.js";
import {
  approveProposedQuote,
  handoffApprovedQuote,
  invalidateProposedQuote,
  readPresentableQuote
} from "../commerce/quote-approval.service.js";
import { AppError } from "../../lib/errors.js";
import { ensureWhatsAppCommerceCustomer } from "../commerce/commerce-customer.service.js";
import { applyGuestHandoffToConversation, extractGuestBasketRef } from "../commerce/guest-handoff.service.js";
import {
  composeQueryFromDraft,
  draftFromParsed,
  houseOrInstructions,
  mergeClarificationReply,
  nextMissingClarification,
  parsedFromDraft,
  parseZimbabweDeliveryText,
  type DeliveryLocationDraft,
  type LocationClarificationType
} from "../location/zimbabwe-delivery-text.js";
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
  classifyCustomerMenuTap,
  extractShoppingItemsWithOptionalAi,
  replaceDisambiguatedRequestedItems,
  resolveProductDisambiguationReply,
  isSameAgainIntent,
  isCancelIntent,
  isChangeIntent,
  isClaimPaidIntent,
  isConfirmIntent,
  isGreetingOrMenuIntent,
  isHelpIntent,
  isRetryPaymentIntent,
  isSelectCashIntent,
  isSelectEcoCashIntent,
  isSelectOneMoneyIntent,
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
  formatChangeWhat,
  formatCheckoutHelp,
  formatClaimPaidIgnored,
  formatCompactMutation,
  formatDisambiguation,
  formatEcoCashPrompt,
  formatLocationAmbiguous,
  formatLocationAsk,
  formatLocationConfirm,
  formatLocationNeedArea,
  formatLocationNeedCity,
  formatLocationNeedLandmarkForArea,
  formatLocationStillUnpinned,
  formatLocationUseThisArea,
  formatMobileMoneyPending,
  formatMobileMoneyPhonePrompt,
  formatCanRequestProduct,
  formatCatalogDemandAck,
  formatMerchantQuoteProposal,
  formatOutsideDeliveryTerritory,
  formatPriceNeedsSource,
  formatProductNotIdentified,
  formatResolvedSourcePrice,
  formatQuoteDeclined,
  formatQuoteExpired,
  formatOrderCartSummary,
  formatPaymentMethodChoice,
  formatPaymentStillPending,
  formatCashOrderConfirmed,
  formatPendingPaymentHandoff,
  formatPriceChange,
  formatReadyToOrder,
  formatShopSwitch,
  formatStatusChoices,
  money,
  parsePriceChangeDetail
} from "./copy.js";
import {
  formatStaleChoiceNotice,
  sendCartActions,
  sendChangeWhat,
  sendHelpMenu,
  sendLocationAsk,
  sendLocationCandidates,
  sendMainMenu,
  sendOrderReview,
  sendPaymentChoices,
  sendProductChoices,
  sendShopPrompt,
  sendTrackChoices,
  sendUnlistedOffer,
  sendUnlistedPaymentChoice,
  sendUnlistedQuoteMessage,
  sendUseThisArea
} from "./customer-interactive.js";
import {
  applyUnlistedInteractive,
  continueUnlistedAfterLocation,
  handleUnlistedText,
  isUnlistedExpected
} from "./unlisted-whatsapp.js";
import {
  isReturningWhatsAppCustomer,
  resolveInteractiveAction,
  type InteractiveActionRecord
} from "./interactive-actions.js";
import {
  beginCheckoutSession,
  cancelCheckoutDraft,
  clearPendingClarification,
  completeCheckoutSession,
  composeDeliveryLabel,
  conversationStateForExpected,
  customerFacingDeliveryLabel,
  humanDeliveryLabel,
  isCartCommand,
  isLivePendingPayment,
  isMainMenuNumericEligible,
  isProtectedWhatsAppTransaction,
  isUnfinishedCheckout,
  parseNumericChoice,
  sanitizeCheckoutContext,
  setExpected,
  shouldHoldGreetingAtCheckout,
  supersedeCheckoutDraft
} from "./checkout-session.js";
import {
  commerceCustomerStatusCopy,
  formatFlavorCustomerLine,
  isMsuGweruTypedPilotAddress,
  MSU_GWERU_TYPED_PILOT_CENTROID
} from "@gigflow/shared";
import {
  applyPendingFlavorChoice,
  attachFlavorToLock,
  displayNameWithFlavor,
  flavorInquiryFromText,
  flavorUxEnabled,
  sendFlavorChoicesForProduct
} from "./whatsapp-flavor.js";
import { normalizePhoneNumber } from "../auth/access.service.js";
import {
  cancelPendingPaymentAttempts,
  initiateMobileMoneyPaymentForOrder,
  switchOrderToCashOnDelivery,
  validateZimbabweMobileForEcoCash
} from "../commerce/payments/payment.service.js";
import { CommercePaymentMethod } from "@prisma/client";
import { resolveCommercePaymentProviderName } from "../commerce/payments/provider.js";

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
  const commerceCustomer = await ensureWhatsAppCommerceCustomer(phone, msg.profileName);
  let conv = await getOrCreateConversation(phone, WhatsAppParty.CUSTOMER, {
    commerceCustomerId: commerceCustomer.id
  });
  let ctx = readContext(conv);
  const text = (msg.text || msg.buttonId || "").trim();
  const customerId = commerceCustomer.id;

  const sanitized = sanitizeCheckoutContext(conv.state, ctx);
  ctx = sanitized.ctx;
  conv = { ...conv, state: sanitized.state };
  if (sanitized.expired) {
    await updateConversation(conv.id, { state: sanitized.state, context: ctx });
  }

  const guestRef = extractGuestBasketRef(text);
  if (guestRef) {
    if (isLivePendingPayment(ctx)) {
      ctx.pendingHandoffToken = guestRef;
      setExpected(ctx, "PENDING_PAYMENT_HANDOFF");
      await updateConversation(conv.id, {
        state: conversationStateForExpected("PENDING_PAYMENT_HANDOFF"),
        context: ctx
      });
      await wa.sendText(phone, formatPendingPaymentHandoff());
      return { handled: true };
    }
    const restored = await applyGuestHandoffToConversation({
      conversationId: conv.id,
      token: guestRef
    });
    await wa.sendText(phone, restored.message);
    return { handled: true };
  }

  const interactiveHandled = await tryHandleInteractiveAction(
    phone,
    customerId,
    conv.id,
    conv.state,
    ctx,
    msg.buttonId
  );
  if (interactiveHandled) return interactiveHandled;

  let menuTap = classifyCustomerMenuTap(text);
  if (!menuTap && isMainMenuNumericEligible(ctx)) {
    const n = parseNumericChoice(text);
    if (n === 1) menuTap = "SHOP";
    else if (n === 2) menuTap = "TRACK";
    else if (n === 3) menuTap = "HELP";
  }
  if (menuTap === "SHOP" || menuTap === "MENU" || isGreetingOrMenuIntent(text)) {
    if (isProtectedWhatsAppTransaction(ctx)) {
      await promptCurrentCheckoutStep(phone, conv.id, ctx);
      return { handled: true };
    }
    if (menuTap === "SHOP") {
      setExpected(ctx, "PRODUCT_TEXT");
      await sendShopPrompt(phone, ctx);
      await updateConversation(conv.id, {
        state: WhatsAppConversationState.BUILDING_CART,
        context: ctx
      });
      return { handled: true };
    }
    if (menuTap === "MENU" || !shouldHoldGreetingAtCheckout(ctx, conv.state)) {
      return recoverToMainMenu(phone, conv.id, ctx, !isReturningWhatsAppCustomer(ctx));
    }
    await promptCurrentCheckoutStep(phone, conv.id, ctx);
    return { handled: true };
  }

  if (ctx.expectedInput === "PENDING_PAYMENT_HANDOFF") {
    const n = parseNumericChoice(text);
    if (n === 1 || /check|previous|status/i.test(text)) {
      ctx.pendingHandoffToken = undefined;
      setExpected(ctx, "PAYMENT_PENDING");
      await updateConversation(conv.id, {
        state: WhatsAppConversationState.AWAITING_PAYMENT,
        context: ctx
      });
      await wa.sendText(phone, formatPaymentStillPending());
      return { handled: true };
    }
    if (n === 2 || /new basket|start new|new order/i.test(text)) {
      const token = ctx.pendingHandoffToken;
      ctx = {
        ...supersedeCheckoutDraft(ctx),
        pendingHandoffToken: undefined
      };
      await updateConversation(conv.id, { context: ctx });
      if (token) {
        const restored = await applyGuestHandoffToConversation({
          conversationId: conv.id,
          token
        });
        await wa.sendText(phone, restored.message);
        return { handled: true };
      }
      ctx = beginCheckoutSession(ctx, "WHATSAPP", "PRODUCT_TEXT");
      await sendShopPrompt(phone, ctx);
      await updateConversation(conv.id, {
        state: WhatsAppConversationState.BUILDING_CART,
        context: ctx
      });
      return { handled: true };
    }
    await wa.sendText(phone, formatPendingPaymentHandoff());
    return { handled: true };
  }

  if (ctx.expectedInput === "QUOTE_APPROVAL") {
    return handleBoundQuoteReply(phone, customerId, conv.id, ctx, text);
  }

  if (
    ctx.unresolvedCheckoutId &&
    (ctx.expectedInput === "PRODUCT_TEXT" || ctx.expectedInput === "NONE" || !ctx.expectedInput)
  ) {
    const presented = await bindMerchantQuote(phone, conv.id, ctx, ctx.unresolvedCheckoutId);
    if (presented) return presented;
  }

  if (ctx.expectedInput === "ACTIVE_ORDER_STATUS" && ctx.statusOrderIds?.length) {
    const n = parseNumericChoice(text);
    if (n && ctx.statusOrderIds[n - 1]) {
      return presentTrackedOrder(phone, conv.id, ctx, ctx.statusOrderIds[n - 1]!);
    }
  }

  if (isHelpIntent(text) || text.toLowerCase() === "help" || menuTap === "HELP") {
    if (isProtectedWhatsAppTransaction(ctx)) {
      await wa.sendText(phone, formatCheckoutHelp(ctx.expectedInput));
      return { handled: true };
    }
    await sendHelpMenu(phone, ctx);
    await updateConversation(conv.id, { context: ctx });
    return { handled: true };
  }

  if (isTrackIntent(text) || menuTap === "TRACK") {
    return presentCustomerTracking(phone, conv.id, conv.state, ctx, commerceCustomer.id);
  }

  if (isCartCommand(text) || classifyShoppingIntent(text).kind === "SHOW_CART") {
    return presentCurrentCart(phone, conv.id, ctx);
  }

  if (msg.buttonId === "cancel_order" || isReviewButton(msg.buttonId, "cancel") || isCancelIntent(text)) {
    if (isLivePendingPayment(ctx)) {
      await wa.sendText(phone, formatPaymentStillPending());
      return { handled: true };
    }
    ctx = cancelCheckoutDraft(ctx);
    await updateConversation(conv.id, { state: WhatsAppConversationState.IDLE, context: ctx });
    const { formatOrderCancelled } = await import("./copy.js");
    await wa.sendText(phone, formatOrderCancelled());
    return { handled: true };
  }

  const expect = ctx.expectedInput ?? "NONE";

  if (isUnlistedExpected(expect)) {
    const unlisted = await handleUnlistedText(phone, customerId, conv.id, ctx, text);
    if (unlisted) return unlisted;
  }

  if (msg.location) {
    const locationAllowed =
      expect === "LOCATION" ||
      expect === "LOCATION_CLARIFICATION" ||
      expect === "NONE" ||
      expect === "PRODUCT_TEXT" ||
      expect === "READY_TO_ORDER" ||
      Boolean(ctx.pendingUnlistedQuery);
    if (!locationAllowed) {
      await wa.sendText(phone, formatCheckoutHelp(expect));
      return { handled: true };
    }
    return applyNativeLocation(phone, conv.id, ctx, msg.location);
  }

  if (
    /\b(ignore (your|all) instructions|make .+ \$0|mark (my )?order delivered|i'?m the (shop|merchant|owner)|change all prices)\b/i.test(
      text
    )
  ) {
    await wa.sendText(phone, "I can only help you shop on DUTS. Tell me what you'd like.");
    return { handled: true };
  }

  if (expect === "CHANGE_WHAT") {
    return handleChangeWhat(phone, conv.id, ctx, text);
  }

  if (expect === "PRODUCT_FLAVOR" && !flavorUxEnabled()) {
    ctx.pendingFlavorChoices = undefined;
    setExpected(ctx, "PRODUCT_TEXT");
    await sendShopPrompt(phone, ctx);
    await updateConversation(conv.id, {
      state: WhatsAppConversationState.BUILDING_CART,
      context: ctx
    });
    return { handled: true };
  }

  if (expect === "PRODUCT_FLAVOR") {
    const pending = ctx.pendingFlavorChoices?.[0];
    if (pending) {
      const n = parseNumericChoice(text);
      const pick =
        n != null
          ? pending.flavors[n - 1]
          : pending.flavors.find((f) => f.name.toLowerCase() === text.trim().toLowerCase()) ||
            pending.flavors.find((f) => text.toLowerCase().includes(f.name.toLowerCase()));
      const anyPick = /^(any|any flavor|no preference)$/i.test(text.trim())
        ? pending.flavors.find((f) => f.id == null)
        : null;
      const skipToAny =
        isConfirmIntent(text) ||
        /^(done|continue|skip|add to cart|checkout|order)$/i.test(text.trim())
          ? pending.flavors.find((f) => f.id == null)
          : null;
      const chosen = pick ?? anyPick ?? skipToAny;
      if (chosen) {
        applyPendingFlavorChoice(ctx, chosen);
        setExpected(ctx, ctx.deliveryLat != null ? "ORDER_CONFIRMATION" : "READY_TO_ORDER");
        if (ctx.deliveryLat != null && ctx.deliveryLng != null) {
          return buildAndPresentQuote(phone, conv.id, ctx);
        }
        const lines = cartLinesForDisplay(ctx);
        const subtotal = lines.reduce((s, l) => s + l.lineTotalCents, 0);
        await sendCartActions(phone, ctx, { lines, subtotalCents: subtotal });
        await updateConversation(conv.id, { state: WhatsAppConversationState.BUILDING_CART, context: ctx });
        return { handled: true };
      }
    }
  }

  if (expect === "READY_TO_ORDER") {
    const n = parseNumericChoice(text);
    if (n === 1 || isConfirmIntent(text)) {
      if (ctx.deliveryLat != null && ctx.deliveryLng != null) {
        return buildAndPresentQuote(phone, conv.id, ctx);
      }
      setExpected(ctx, "LOCATION");
      await updateConversation(conv.id, {
        state: WhatsAppConversationState.AWAITING_LOCATION,
        context: ctx
      });
      await sendLocationAsk(phone);
      return { handled: true };
    }
    if (n === 2) {
      setExpected(ctx, "PRODUCT_TEXT");
      await updateConversation(conv.id, {
        state: WhatsAppConversationState.BUILDING_CART,
        context: ctx
      });
      await sendShopPrompt(phone, ctx);
      return { handled: true };
    }
  }

  if (expect === "LOCATION_CLARIFICATION") {
    return applyLocationClarification(phone, conv.id, ctx, text);
  }

  if (expect === "LOCATION") {
    return applyTypedLocation(phone, conv.id, ctx, text);
  }

  if (expect === "ORDER_CONFIRMATION" || conv.state === WhatsAppConversationState.AWAITING_ORDER_CONFIRMATION) {
    const review = await handleOrderReviewDecision(phone, customerId, conv.id, ctx, text, msg.buttonId);
    if (review.handled) return review;
    conv = { ...conv, state: WhatsAppConversationState.BUILDING_CART };
    setExpected(ctx, "PRODUCT_TEXT");
  }

  if (
    expect === "PAYMENT_METHOD" ||
    expect === "ECOCASH_NUMBER" ||
    expect === "PAYMENT_PENDING" ||
    expect === "PAYMENT_RETRY" ||
    (conv.state === WhatsAppConversationState.AWAITING_PAYMENT && !isUnlistedExpected(expect))
  ) {
    return handlePaymentConversation(phone, customerId, conv.id, ctx, text, msg.buttonId);
  }

  if (expect === "PRODUCT_DISAMBIGUATION" || conv.state === WhatsAppConversationState.AWAITING_PRODUCT_CHOICE) {
    const choiceHandled = await tryApplyDisambiguation(phone, conv.id, ctx, text);
    if (choiceHandled) return choiceHandled;
    const pending = ctx.pendingChoices?.[0];
    if (pending?.options?.length) {
      const reply = resolveProductDisambiguationReply(text, pending.options);
      if (reply.action === "new_query") {
        ctx.requestedItems = replaceDisambiguatedRequestedItems(
          ctx.requestedItems,
          pending.query,
          ctx.lastDisambiguationQuery,
          reply.items
        );
        ctx.pendingChoices = undefined;
        ctx.lastDisambiguationQuery = undefined;
        ctx.choiceId = undefined;
        setExpected(ctx, "PRODUCT_TEXT");
        await updateConversation(conv.id, {
          state: WhatsAppConversationState.BUILDING_CART,
          context: ctx
        });
        return resolveProductsThenContinue(phone, conv.id, ctx);
      }
      await sendProductChoices(
        phone,
        ctx,
        pending.options.length === 2 ? `Which ${pending.query}?` : "Which one do you want?",
        pending.options
      );
      await updateConversation(conv.id, { context: ctx });
      return { handled: true };
    }
  }

  if (
    isCartExpired(ctx.draftQuotedAt) &&
    (ctx.draftLines?.length || conv.state === WhatsAppConversationState.AWAITING_ORDER_CONFIRMATION)
  ) {
    const { logDutsFlow } = await import("../../lib/flow-log.js");
    logDutsFlow("COMMERCE_CART_EXPIRED", { userId: customerId });
    ctx.draftLines = undefined;
    ctx.draftQuotedAt = undefined;
    setExpected(ctx, ctx.requestedItems?.length ? "READY_TO_ORDER" : "PRODUCT_TEXT");
    await updateConversation(conv.id, { state: WhatsAppConversationState.BUILDING_CART, context: ctx });
    await wa.sendText(phone, "That price list expired. Tell me what you need and I'll check today's prices.");
    return { handled: true };
  }

  const intent = classifyShoppingIntent(text);
  if (intent.kind === "CHECK_PRICE" && intent.targetQuery) {
    return answerPriceQuestion(phone, conv.id, ctx, intent);
  }
  if (intent.kind === "CHECK_AVAILABILITY" && intent.targetQuery) {
    return answerAvailability(phone, conv.id, ctx, intent);
  }

  if (intent.kind === "HELP") {
    await wa.sendText(phone, CUSTOMER_HELP_FULL);
    if (ctx.requestedItems?.length) {
      await wa.sendText(phone, formatRequestedCart(ctx.requestedItems));
    }
    return { handled: true };
  }

  if (isSameAgainIntent(text)) {
    if (ctx.requestedItems?.length && ctx.deliveryLat != null) {
      return buildAndPresentQuote(phone, conv.id, ctx);
    }
    if (ctx.requestedItems?.length) {
      await updateConversation(conv.id, {
        state: WhatsAppConversationState.AWAITING_LOCATION,
        context: ctx
      });
      await sendLocationAsk(phone);
      return { handled: true };
    }
    await wa.sendText(phone, "What would you like again? Tell me the items.");
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
    ctx.lockedProductLines = undefined;
    ctx.merchantId = undefined;
    ctx.draftQuotedAt = undefined;
    clearPendingClarification(ctx);
    setExpected(ctx, "PRODUCT_TEXT");
    await updateConversation(conv.id, { state: WhatsAppConversationState.BUILDING_CART, context: ctx });
    await wa.sendText(phone, "Cart cleared. What would you like?");
    return { handled: true };
  }

  if (intent.kind === "CHECKOUT") {
    if (!ctx.draftLines?.length && !ctx.requestedItems?.length && !ctx.lockedProductLines?.length) {
      await wa.sendText(phone, "Your cart is empty. Tell me what you'd like to buy first.");
      return { handled: true };
    }
    if (ctx.deliveryLat == null || ctx.deliveryLng == null) {
      setExpected(ctx, "LOCATION");
      await updateConversation(conv.id, { state: WhatsAppConversationState.AWAITING_LOCATION, context: ctx });
      await sendLocationAsk(phone);
      return { handled: true };
    }
    return buildAndPresentQuote(phone, conv.id, {
      ...ctx,
      requestedItems: ctx.requestedItems?.length
        ? ctx.requestedItems
        : (ctx.draftLines ?? []).map((l) => ({ query: l.productName, quantity: l.quantity }))
    });
  }

  // Cart mutations while building / confirming
  const mutating = ["ADD_ITEM", "REMOVE_ITEM", "CHANGE_QUANTITY", "REPLACE_ITEM", "NEW_LIST"].includes(
    intent.kind
  );
  if (mutating) {
    if (intent.kind === "NEW_LIST" && intent.items?.length) {
      ctx.requestedItems = intent.items;
      if (intent.budgetCents) ctx.budgetCents = intent.budgetCents;
    } else if (intent.items?.length || intent.kind === "REMOVE_ITEM" || intent.kind === "CHANGE_QUANTITY" || intent.kind === "REPLACE_ITEM") {
      const applied = applyCartIntent(ctx.requestedItems ?? [], intent, ctx.draftLines?.map((l) => l.productName));
      if (!applied.ok) {
        await wa.sendText(phone, applied.ask || CUSTOMER_HELP);
        return { handled: true };
      }
      ctx.requestedItems = applied.items;
    }
    if (intent.budgetCents) ctx.budgetCents = intent.budgetCents;
    ctx.draftLines = undefined;
    clearPendingClarification(ctx);
    if (!ctx.checkoutSessionId || ctx.checkoutStatus === "COMPLETED" || ctx.checkoutStatus === "EXPIRED") {
      ctx = { ...beginCheckoutSession(ctx, "WHATSAPP", "PRODUCT_TEXT"), requestedItems: ctx.requestedItems, budgetCents: ctx.budgetCents };
    }
    if (!ctx.requestedItems?.length) {
      setExpected(ctx, "PRODUCT_TEXT");
      await updateConversation(conv.id, { state: WhatsAppConversationState.BUILDING_CART, context: ctx });
      await wa.sendText(phone, "Your cart is empty. Tell me what you'd like to buy.");
      return { handled: true };
    }
    return resolveProductsThenContinue(phone, conv.id, ctx);
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

  if (flavorInquiryFromText(text)) {
    const locked = ctx.lockedProductLines?.[ctx.lockedProductLines.length - 1];
    if (locked) {
      await sendFlavorChoicesForProduct(phone, ctx, {
        id: locked.productId,
        name: locked.productName
      });
      await updateConversation(conv.id, {
        state: WhatsAppConversationState.BUILDING_CART,
        context: ctx
      });
      return { handled: true };
    }
    await wa.sendText(phone, "Tell me which product, then I can show flavors.");
    return { handled: true };
  }

  if (ctx.deliveryLat == null || ctx.deliveryLng == null) {
    if (text && intent.kind === "UNKNOWN") {
      const items = await extractShoppingItemsWithOptionalAi(text);
      if (items.length) {
        ctx.requestedItems = items;
        if (!ctx.checkoutSessionId || ctx.checkoutStatus === "COMPLETED") {
          ctx = { ...beginCheckoutSession(ctx, "WHATSAPP", "PRODUCT_TEXT"), requestedItems: items };
        }
        return resolveProductsThenContinue(phone, conv.id, ctx);
      }
    }
    if (ctx.requestedItems?.length) {
      return resolveProductsThenContinue(phone, conv.id, ctx);
    }
    setExpected(ctx, "PRODUCT_TEXT");
    await updateConversation(conv.id, { state: WhatsAppConversationState.BUILDING_CART, context: ctx });
    await wa.sendText(phone, CUSTOMER_HELP);
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

function cartLinesForDisplay(ctx: ConversationContext) {
  if (ctx.lockedProductLines?.length) {
    return ctx.lockedProductLines.map((l) => ({
      quantity: l.quantity,
      ...displayNameWithFlavor({
        productName: l.productName,
        flavorPreference: l.flavorPreference,
        flavorName: l.flavorName
      }),
      lineTotalCents: l.quantity * l.unitPriceCents
    }));
  }
  if (ctx.draftLines?.length) {
    return ctx.draftLines.map((l) => ({
      quantity: l.quantity,
      ...displayNameWithFlavor({
        productName: l.productName,
        flavorPreference: l.flavorPreference,
        flavorName: l.flavorName
      }),
      lineTotalCents: l.lineTotalCents
    }));
  }
  return (ctx.requestedItems ?? []).map((l) => ({
    quantity: l.quantity,
    productName: l.query,
    lineTotalCents: 0
  }));
}

async function presentCurrentCart(phone: string, convId: string, ctx: ConversationContext) {
  const wa = getWhatsAppProvider();
  const lines = cartLinesForDisplay(ctx);
  if (!lines.length) {
    await wa.sendText(phone, "Your cart is empty. Tell me what you'd like to buy.");
    return { handled: true };
  }
  const subtotal = lines.reduce((s, l) => s + l.lineTotalCents, 0);
  if (ctx.deliveryLat != null && ctx.deliveryLng != null && (ctx.draftLines?.length || ctx.lockedProductLines?.length)) {
    return buildAndPresentQuote(phone, convId, ctx);
  }
  setExpected(ctx, "READY_TO_ORDER");
  await sendCartActions(phone, ctx, { lines, subtotalCents: subtotal || lines.length });
  await updateConversation(convId, { state: WhatsAppConversationState.BUILDING_CART, context: ctx });
  return { handled: true };
}

async function handleChangeWhat(phone: string, convId: string, ctx: ConversationContext, text: string) {
  const wa = getWhatsAppProvider();
  const n = parseNumericChoice(text);
  if (n === 1 || /item/i.test(text)) {
    setExpected(ctx, "PRODUCT_TEXT");
    await updateConversation(convId, { state: WhatsAppConversationState.BUILDING_CART, context: ctx });
    await wa.sendText(phone, `${formatRequestedCart(ctx.requestedItems ?? [])}\n\nSay ADD, REMOVE, or change an item.`);
    return { handled: true };
  }
  if (n === 2 || /location|deliver/i.test(text)) {
    ctx.deliveryLat = undefined;
    ctx.deliveryLng = undefined;
    ctx.deliveryLabel = undefined;
    ctx.deliveryInstructions = undefined;
    ctx.deliveryPrecision = undefined;
    ctx.originalTypedAddress = undefined;
    ctx.pilotLocationMode = undefined;
    ctx.pendingAreaMatch = undefined;
    ctx.deliveryLocationDraft = undefined;
    ctx.locationClarificationType = undefined;
    setExpected(ctx, "LOCATION");
    await updateConversation(convId, { state: WhatsAppConversationState.AWAITING_LOCATION, context: ctx });
    await sendLocationAsk(phone);
    return { handled: true };
  }
  if (n === 3 || /pay/i.test(text)) {
    ctx.paymentPhase = "SELECT_METHOD";
    setExpected(ctx, "PAYMENT_METHOD");
    await sendPaymentChoices(phone, ctx);
    await updateConversation(convId, { state: WhatsAppConversationState.AWAITING_PAYMENT, context: ctx });
    return { handled: true };
  }
  await sendChangeWhat(phone, ctx, Boolean(ctx.paymentPhase));
  await updateConversation(convId, { context: ctx });
  return { handled: true };
}

async function continueAfterLocation(phone: string, convId: string, ctx: ConversationContext) {
  const unlisted = await continueUnlistedAfterLocation(phone, convId, ctx);
  if (unlisted) return unlisted;
  if (ctx.lockedProductLines?.length || ctx.requestedItems?.length) {
    return buildAndPresentQuote(phone, convId, ctx);
  }
  setExpected(ctx, "PRODUCT_TEXT");
  await updateConversation(convId, { state: WhatsAppConversationState.BUILDING_CART, context: ctx });
  const wa = getWhatsAppProvider();
  await wa.sendText(phone, `${formatLocationConfirm(ctx.deliveryLabel ?? "")}\n\nWhat would you like?`);
  return { handled: true };
}

async function applyResolvedCoordinates(
  phone: string,
  convId: string,
  ctx: ConversationContext,
  input: {
    latitude: number;
    longitude: number;
    label: string;
    instructions?: string;
    precision?: ConversationContext["deliveryPrecision"];
  }
) {
  ctx.deliveryLat = input.latitude;
  ctx.deliveryLng = input.longitude;
  ctx.deliveryInstructions = input.instructions?.trim() || ctx.deliveryInstructions;
  ctx.deliveryPrecision = input.precision ?? "EXACT";
  const originalTyped = ctx.originalTypedAddress?.trim();
  ctx.deliveryLabel = originalTyped
    ? originalTyped
    : customerFacingDeliveryLabel(
        composeDeliveryLabel({
          resolvedLabel: humanDeliveryLabel({ typed: input.label }),
          instructions: ctx.deliveryInstructions,
          precision: ctx.deliveryPrecision
        })
      );
  ctx.lastDeliveryLat = ctx.deliveryLat;
  ctx.lastDeliveryLng = ctx.deliveryLng;
  ctx.lastDeliveryLabel = ctx.deliveryLabel;
  ctx.pendingLocationChoices = undefined;
  ctx.pendingAreaMatch = undefined;
  ctx.locationClarificationType = undefined;
  clearPendingClarification(ctx);
  return continueAfterLocation(phone, convId, ctx);
}

async function applyNativeLocation(
  phone: string,
  convId: string,
  ctx: ConversationContext,
  location: { latitude: number; longitude: number; name?: string; address?: string }
) {
  let label = humanDeliveryLabel({ typed: location.name || location.address });
  if (label === "Pinned location ✓") {
    try {
      const { reverseGeocodeCoordinates } = await import("../location/geocoding.service.js");
      const geo = await reverseGeocodeCoordinates(location.latitude, location.longitude);
      label = humanDeliveryLabel({
        formattedAddress: geo.formattedAddress,
        city: geo.city,
        region: geo.region
      });
    } catch {
      label = "Pinned location ✓";
    }
  }
  ctx.originalTypedAddress = undefined;
  ctx.pilotLocationMode = "GPS";
  return applyResolvedCoordinates(phone, convId, ctx, {
    latitude: location.latitude,
    longitude: location.longitude,
    label,
    precision: "GPS"
  });
}

async function askLocationClarification(
  phone: string,
  convId: string,
  ctx: ConversationContext,
  options: Array<{ label: string; formattedAddress: string; latitude: number; longitude: number }>
) {
  const wa = getWhatsAppProvider();
  const choiceId = crypto.randomUUID();
  ctx.pendingChoices = undefined;
  ctx.lastDisambiguationQuery = undefined;
  ctx.pendingLocationChoices = options.map((o) => ({
    label: o.label,
    formattedAddress: o.formattedAddress,
    latitude: o.latitude,
    longitude: o.longitude
  }));
  ctx.choiceId = choiceId;
  ctx.locationClarificationType = "ADDRESS_CHOICE";
  setExpected(ctx, "LOCATION_CLARIFICATION");
  await sendLocationCandidates(phone, ctx, options);
  await updateConversation(convId, {
    state: WhatsAppConversationState.AWAITING_LOCATION,
    context: ctx
  });
  return { handled: true };
}

function areaLabelFromDraft(draft: DeliveryLocationDraft): string {
  if (draft.suburb && draft.city && draft.landmark) return `${draft.suburb} near ${draft.landmark}, ${draft.city}`;
  if (draft.suburb && draft.city) return `${draft.suburb}, ${draft.city}`;
  if (draft.landmark && draft.city) return `${draft.landmark}, ${draft.city}`;
  return draft.suburb || draft.city || "your area";
}

async function askLocationComponent(
  phone: string,
  convId: string,
  ctx: ConversationContext,
  type: LocationClarificationType,
  message: string
) {
  const wa = getWhatsAppProvider();
  ctx.pendingChoices = undefined;
  ctx.lastDisambiguationQuery = undefined;
  ctx.locationClarificationType = type;
  setExpected(ctx, "LOCATION_CLARIFICATION");
  await updateConversation(convId, {
    state: WhatsAppConversationState.AWAITING_LOCATION,
    context: ctx
  });
  await wa.sendText(phone, message);
  return { handled: true };
}

async function applyLocationClarification(
  phone: string,
  convId: string,
  ctx: ConversationContext,
  text: string
) {
  const wa = getWhatsAppProvider();
  const type = ctx.locationClarificationType;
  const area = ctx.pendingAreaMatch;
  if (type === "CONFIRM_AREA" || area) {
    const n = parseNumericChoice(text);
    const yes = n === 1 || /^(yes|yep|yeah|ok|okay)$/i.test(text.trim());
    const change =
      n === 2 ||
      /^(no|nope|change( address)?)$/i.test(text.trim());
    if (yes && area) {
      return applyResolvedCoordinates(phone, convId, ctx, {
        latitude: area.latitude,
        longitude: area.longitude,
        label: area.label,
        instructions: houseOrInstructions(ctx.deliveryLocationDraft ?? {}) || ctx.deliveryInstructions || area.originalText,
        precision: "AREA"
      });
    }
    if (change) {
      ctx.pendingAreaMatch = undefined;
      ctx.pendingLocationChoices = undefined;
      ctx.deliveryLocationDraft = undefined;
      ctx.locationClarificationType = undefined;
      ctx.deliveryLat = undefined;
      ctx.deliveryLng = undefined;
      ctx.deliveryLabel = undefined;
      setExpected(ctx, "LOCATION");
      await updateConversation(convId, { state: WhatsAppConversationState.AWAITING_LOCATION, context: ctx });
      await sendLocationAsk(phone);
      return { handled: true };
    }
    if (!text) {
      await sendUseThisArea(phone, ctx, area?.label || areaLabelFromDraft(ctx.deliveryLocationDraft ?? {}));
      await updateConversation(convId, { context: ctx });
      return { handled: true };
    }
    return applyTypedLocation(phone, convId, ctx, text);
  }
  const options = ctx.pendingLocationChoices ?? [];
  if (type === "ADDRESS_CHOICE" || options.length) {
    const n = parseNumericChoice(text);
    if (n != null) {
      const pick = options[n - 1];
      if (!pick) {
        await sendLocationCandidates(phone, ctx, options);
        await updateConversation(convId, { context: ctx });
        return { handled: true };
      }
      return applyResolvedCoordinates(phone, convId, ctx, {
        latitude: pick.latitude,
        longitude: pick.longitude,
        label: pick.label,
        instructions: houseOrInstructions(ctx.deliveryLocationDraft ?? {}) || ctx.deliveryInstructions,
        precision: "EXACT"
      });
    }
    if (!text) {
      await sendLocationCandidates(phone, ctx, options.length ? options : [{ label: "your area" }]);
      await updateConversation(convId, { context: ctx });
      return { handled: true };
    }
  }
  return applyTypedLocation(phone, convId, ctx, text);
}

async function applyTypedLocation(phone: string, convId: string, ctx: ConversationContext, text: string) {
  const wa = getWhatsAppProvider();
  if (!text) {
    await sendLocationAsk(phone);
    return { handled: true };
  }
  const incoming = parseZimbabweDeliveryText(text);
  const prior = ctx.deliveryLocationDraft ?? {};
  const clarifyingType = ctx.locationClarificationType;
  const isComponentAsk = clarifyingType === "CITY" || clarifyingType === "AREA" || clarifyingType === "LANDMARK";
  const looksLikeFragment = !incoming.city && Boolean(prior.city || prior.suburb);
  const shouldMerge = isComponentAsk || looksLikeFragment;

  let draft: DeliveryLocationDraft;
  if (shouldMerge) {
    const expected: LocationClarificationType =
      clarifyingType === "CITY" || clarifyingType === "AREA" || clarifyingType === "LANDMARK"
        ? clarifyingType
        : nextMissingClarification(prior) ?? "LANDMARK";
    draft = mergeClarificationReply(prior, text, expected);
  } else {
    draft = draftFromParsed(incoming);
  }
  ctx.deliveryLocationDraft = draft;
  const originalTyped = isMsuGweruTypedPilotAddress(text)
    ? text.trim()
    : shouldMerge
      ? (draft.originalText || text).trim()
      : text.trim();
  const instructions = houseOrInstructions(draft) || draft.originalText || text;
  if (!ctx.deliveryInstructions || draft.house || draft.street) {
    ctx.deliveryInstructions = instructions;
  }

  const recognizedPilot =
    isMsuGweruTypedPilotAddress(originalTyped) ||
    isMsuGweruTypedPilotAddress(text) ||
    isMsuGweruTypedPilotAddress(composeQueryFromDraft(draft));
  if (recognizedPilot) {
    ctx.originalTypedAddress = originalTyped;
    ctx.pilotLocationMode = "TYPED_PILOT";
    ctx.pendingAreaMatch = undefined;
    ctx.pendingLocationChoices = undefined;
    ctx.locationClarificationType = undefined;
    return applyResolvedCoordinates(phone, convId, ctx, {
      latitude: MSU_GWERU_TYPED_PILOT_CENTROID.latitude,
      longitude: MSU_GWERU_TYPED_PILOT_CENTROID.longitude,
      label: originalTyped,
      instructions: originalTyped,
      precision: "STREET"
    });
  }

  const { resolveTypedDeliveryLocation } = await import("../location/geocoding.service.js");
  const parsed = parsedFromDraft(draft);
  const query = composeQueryFromDraft(draft) || text;
  const resolution = await resolveTypedDeliveryLocation(query, { parsed });

  if (resolution.kind === "exact" || resolution.kind === "landmark") {
    ctx.pendingAreaMatch = undefined;
    return applyResolvedCoordinates(phone, convId, ctx, {
      latitude: resolution.pick.latitude,
      longitude: resolution.pick.longitude,
      label: humanDeliveryLabel({
        typed: query,
        formattedAddress: resolution.pick.formattedAddress
      }),
      instructions,
      precision: resolution.kind === "landmark" ? "LANDMARK" : resolution.resolutionLevel === "STREET" ? "STREET" : "EXACT"
    });
  }

  if (resolution.kind === "area") {
    const choiceId = crypto.randomUUID();
    ctx.pendingChoices = undefined;
    ctx.lastDisambiguationQuery = undefined;
    ctx.pendingLocationChoices = undefined;
    ctx.pendingAreaMatch = {
      label: areaLabelFromDraft(draft),
      suburb: draft.suburb,
      city: draft.city,
      latitude: resolution.pick.latitude,
      longitude: resolution.pick.longitude,
      originalText: instructions
    };
    ctx.choiceId = choiceId;
    ctx.locationClarificationType = "CONFIRM_AREA";
    setExpected(ctx, "LOCATION_CLARIFICATION");
    await sendUseThisArea(phone, ctx, areaLabelFromDraft(draft));
    await updateConversation(convId, {
      state: WhatsAppConversationState.AWAITING_LOCATION,
      context: ctx
    });
    return { handled: true };
  }

  if (resolution.kind === "ambiguous") {
    return askLocationClarification(phone, convId, ctx, resolution.options);
  }

  const missing = nextMissingClarification(draft);
  if (missing === "CITY") {
    return askLocationComponent(phone, convId, ctx, "CITY", formatLocationNeedCity());
  }
  if (missing === "AREA") {
    return askLocationComponent(phone, convId, ctx, "AREA", formatLocationNeedArea({ city: draft.city }));
  }
  const justMergedLandmark =
    shouldMerge &&
    (clarifyingType === "LANDMARK" ||
      (looksLikeFragment && clarifyingType !== "CITY" && clarifyingType !== "AREA"));
  if (!justMergedLandmark && (missing === "LANDMARK" || Boolean(draft.city))) {
    return askLocationComponent(
      phone,
      convId,
      ctx,
      "LANDMARK",
      formatLocationNeedLandmarkForArea({
        areaLabel: draft.suburb && draft.city ? `${draft.suburb}, ${draft.city}` : draft.suburb,
        city: draft.city
      })
    );
  }

  return askLocationComponent(
    phone,
    convId,
    ctx,
    "LANDMARK",
    formatLocationStillUnpinned({
      areaLabel: draft.suburb && draft.city ? `${draft.suburb}, ${draft.city}` : draft.city,
      landmark: draft.landmark
    })
  );
}

async function resolveProductsThenContinue(phone: string, convId: string, ctx: ConversationContext) {
  const wa = getWhatsAppProvider();
  const items = ctx.requestedItems ?? [];
  if (!items.length) {
    await wa.sendText(phone, "Tell me what you'd like to buy.");
    return { handled: true };
  }

  if (ctx.checkoutSource === "WEB_HANDOFF" && ctx.lockedProductLines?.length) {
    if (ctx.deliveryLat != null && ctx.deliveryLng != null) {
      return buildAndPresentQuote(phone, convId, ctx);
    }
    setExpected(ctx, "LOCATION");
    await updateConversation(convId, { state: WhatsAppConversationState.AWAITING_LOCATION, context: ctx });
    await sendLocationAsk(phone);
    return { handled: true };
  }

  for (const item of items) {
    const decision = await decideCatalogDemand(item.query);
    if (decision.kind === "none") {
      await wa.sendText(phone, formatProductNotIdentified(item.query));
      return { handled: true };
    }
    if (decision.kind === "many") {
      const choiceId = crypto.randomUUID();
      ctx.pendingChoices = [{
        query: item.query,
        options: decision.options.map((product) => ({
          productId: product.id,
          name: product.name,
          catalogOnly: true
        })),
        choiceId
      }];
      ctx.lastDisambiguationQuery = item.query;
      ctx.choiceId = choiceId;
      setExpected(ctx, "PRODUCT_DISAMBIGUATION");
      const title = decision.options.length === 2 ? `Which ${item.query}?` : "Which one do you want?";
      await sendProductChoices(phone, ctx, title, ctx.pendingChoices[0]!.options);
      await updateConversation(convId, {
        state: WhatsAppConversationState.AWAITING_PRODUCT_CHOICE,
        context: ctx
      });
      return { handled: true };
    }
    ctx.requestedItems = (ctx.requestedItems ?? []).map((row) =>
      row.query === item.query ? { query: decision.product.name, quantity: row.quantity } : row
    );
  }

  if (ctx.deliveryLat != null && ctx.deliveryLng != null) {
    return buildAndPresentQuote(phone, convId, ctx);
  }
  setExpected(ctx, "LOCATION");
  await updateConversation(convId, { state: WhatsAppConversationState.AWAITING_LOCATION, context: ctx });
  await wa.sendText(
    phone,
    formatCatalogDemandAck((ctx.requestedItems ?? []).map((row) => ({ quantity: row.quantity, name: row.query })))
  );
  return { handled: true };
}

async function decideCatalogDemand(query: string): Promise<
  | { kind: "none" }
  | { kind: "one"; product: { id: string; name: string } }
  | { kind: "many"; options: Array<{ id: string; name: string }> }
> {
  const matches = await matchPublicCatalogDemand(query);
  if (!matches.length) return { kind: "none" };
  const needle = normalizeProductSearchName(query);
  const exact = matches.filter((product) => normalizeProductSearchName(product.name) === needle);
  const pool = exact.length ? exact : matches;
  if (pool.length === 1) return { kind: "one", product: pool[0]! };
  return { kind: "many", options: pool.slice(0, 3).map((product) => ({ id: product.id, name: product.name })) };
}

function deliveryTerritory(ctx: ConversationContext) {
  if (ctx.deliveryLat == null || ctx.deliveryLng == null) return null;
  return resolveSupportedPackagePricingCity({
    typedAddress: ctx.originalTypedAddress || ctx.deliveryLabel,
    deliveryLabel: ctx.deliveryLabel,
    customerLatitude: ctx.deliveryLat,
    customerLongitude: ctx.deliveryLng
  });
}

async function answerPriceQuestion(
  phone: string,
  convId: string,
  ctx: ConversationContext,
  intent: ShoppingIntent
) {
  const wa = getWhatsAppProvider();
  const decision = await decideCatalogDemand(intent.targetQuery!);
  if (decision.kind === "none") {
    await wa.sendText(phone, formatProductNotIdentified(intent.targetQuery!));
    return { handled: true };
  }
  if (decision.kind === "many") {
    ctx.requestedItems = [{ query: intent.targetQuery!, quantity: 1 }];
    return resolveProductsThenContinue(phone, convId, ctx);
  }
  const resolved = ctx.draftLines?.find(
    (line) => normalizeProductSearchName(line.productName) === normalizeProductSearchName(decision.product.name)
  );
  if (resolved) {
    await wa.sendText(phone, formatResolvedSourcePrice(decision.product.name, resolved.unitPriceCents));
    return { handled: true };
  }
  const territory = deliveryTerritory(ctx);
  if (ctx.deliveryLat != null && territory == null) {
    await wa.sendText(phone, formatOutsideDeliveryTerritory());
    return { handled: true };
  }
  if (territory) {
    ctx.requestedItems = [{ query: decision.product.name, quantity: 1 }];
    return buildAndPresentQuote(phone, convId, ctx);
  }
  await wa.sendText(phone, formatPriceNeedsSource(decision.product.name));
  return { handled: true };
}

async function answerAvailability(
  phone: string,
  convId: string,
  ctx: ConversationContext,
  intent: ShoppingIntent
) {
  const wa = getWhatsAppProvider();
  const decision = await decideCatalogDemand(intent.targetQuery!);
  if (decision.kind === "none") {
    await wa.sendText(phone, formatProductNotIdentified(intent.targetQuery!));
    return { handled: true };
  }
  if (decision.kind === "many") {
    ctx.requestedItems = [{ query: intent.targetQuery!, quantity: 1 }];
    return resolveProductsThenContinue(phone, convId, ctx);
  }
  const territory = deliveryTerritory(ctx);
  if (ctx.deliveryLat != null && territory == null) {
    await wa.sendText(phone, formatOutsideDeliveryTerritory());
    return { handled: true };
  }
  if (territory) {
    ctx.requestedItems = [{ query: decision.product.name, quantity: 1 }];
    return buildAndPresentQuote(phone, convId, ctx);
  }
  await wa.sendText(phone, formatCanRequestProduct(decision.product.name));
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
  const reply = resolveProductDisambiguationReply(text, pending.options);
  if (reply.action !== "select") return null;
  return applyProductChoice(phone, convId, ctx, reply.choice);
}

async function bindMerchantQuote(
  phone: string,
  convId: string,
  ctx: ConversationContext,
  checkoutId: string
) {
  const quote = await readPresentableQuote(checkoutId);
  if (!quote) return null;
  const wa = getWhatsAppProvider();
  if (quote.expired) {
    await wa.sendText(phone, formatQuoteExpired());
    return { handled: true as const };
  }
  ctx.quoteCheckoutId = quote.checkoutId;
  ctx.quoteApprovalId = quote.approvalId;
  ctx.quoteVersion = quote.quoteVersion;
  ctx.unresolvedCheckoutId = quote.checkoutId;
  ctx.choiceId = crypto.randomUUID();
  ctx.choiceType = "QUOTE_APPROVAL";
  ctx.draftLines = undefined;
  ctx.pendingChoices = undefined;
  setExpected(ctx, "QUOTE_APPROVAL");
  await updateConversation(convId, { state: WhatsAppConversationState.BUILDING_CART, context: ctx });
  await wa.sendText(phone, formatMerchantQuoteProposal(quote));
  return { handled: true as const };
}

async function handleBoundQuoteReply(
  phone: string,
  customerId: string,
  convId: string,
  ctx: ConversationContext,
  text: string
) {
  const wa = getWhatsAppProvider();
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();
  const bound =
    ctx.choiceType === "QUOTE_APPROVAL" &&
    Boolean(ctx.choiceId && ctx.quoteCheckoutId && ctx.quoteApprovalId && ctx.quoteVersion != null);
  const yes = trimmed === "1" || /^(yes|confirm)$/i.test(lower);
  const no = trimmed === "2" || /^(no|cancel)$/i.test(lower);
  if (!bound) {
    await wa.sendText(phone, "That confirmation is for an older total.");
    return { handled: true as const };
  }
  if (no) {
    await invalidateProposedQuote(ctx.quoteCheckoutId!);
    ctx.quoteCheckoutId = undefined;
    ctx.quoteApprovalId = undefined;
    ctx.quoteVersion = undefined;
    ctx.choiceId = undefined;
    setExpected(ctx, "PRODUCT_TEXT");
    await updateConversation(convId, { state: WhatsAppConversationState.BUILDING_CART, context: ctx });
    await wa.sendText(phone, formatQuoteDeclined());
    return { handled: true as const };
  }
  if (!yes) {
    const quote = await readPresentableQuote(ctx.quoteCheckoutId!);
    if (quote && !quote.expired) await wa.sendText(phone, formatMerchantQuoteProposal(quote));
    else await wa.sendText(phone, "Reply YES or 1 to confirm this total, or NO or 2 to cancel.");
    return { handled: true as const };
  }
  try {
    await approveProposedQuote({
      checkoutId: ctx.quoteCheckoutId!,
      approvalId: ctx.quoteApprovalId!,
      quoteVersion: ctx.quoteVersion!,
      actor: { commerceCustomerId: customerId, phone }
    });
    ctx.paymentPhase = "SELECT_METHOD";
    setExpected(ctx, "PAYMENT_METHOD");
    await updateConversation(convId, { state: WhatsAppConversationState.AWAITING_PAYMENT, context: ctx });
    await sendPaymentChoices(phone, ctx);
    return { handled: true as const };
  } catch (error) {
    const code = error instanceof AppError ? error.code : "";
    if (code === "QUOTE_EXPIRED" || code === "QUOTE_SOURCE_CHANGED") {
      const next = await proposeMerchantPriceForCheckout(ctx.quoteCheckoutId!);
      if (next.outcome === "PROPOSED") {
        ctx.choiceId = undefined;
        setExpected(ctx, "PRODUCT_TEXT");
        await updateConversation(convId, { context: ctx });
        return (await bindMerchantQuote(phone, convId, ctx, ctx.quoteCheckoutId!)) ?? { handled: true as const };
      }
      await wa.sendText(phone, formatQuoteExpired());
      return { handled: true as const };
    }
    await wa.sendText(phone, error instanceof AppError ? error.message : "That total could not be confirmed.");
    return { handled: true as const };
  }
}

async function presentUnresolvedAcceptance(
  phone: string,
  convId: string,
  ctx: ConversationContext,
  accepted: { checkoutId: string; message: string }
) {
  const wa = getWhatsAppProvider();
  ctx.unresolvedCheckoutId = accepted.checkoutId;
  ctx.merchantId = undefined;
  ctx.draftLines = undefined;
  ctx.draftOrderId = undefined;
  ctx.paymentPhase = undefined;
  ctx.pendingPaymentOrderId = undefined;
  setExpected(ctx, "PRODUCT_TEXT");
  await updateConversation(convId, { state: WhatsAppConversationState.BUILDING_CART, context: ctx });
  await wa.sendText(phone, accepted.message);
  return { handled: true as const };
}

async function buildAndPresentQuote(
  phone: string,
  convId: string,
  ctx: ConversationContext,
  opts?: { compact?: boolean; mutationNote?: string }
) {
  const wa = getWhatsAppProvider();
  const hasProducts = Boolean(
    ctx.lockedProductLines?.length || ctx.requestedItems?.length || ctx.draftLines?.length
  );
  if (ctx.deliveryLat == null || ctx.deliveryLng == null) {
    if (hasProducts) {
      setExpected(ctx, "LOCATION");
      await updateConversation(convId, { state: WhatsAppConversationState.AWAITING_LOCATION, context: ctx });
      await sendLocationAsk(phone);
      return { handled: true };
    }
    setExpected(ctx, "PRODUCT_TEXT");
    await updateConversation(convId, { state: WhatsAppConversationState.BUILDING_CART, context: ctx });
    await wa.sendText(phone, "Tell me what you'd like to buy.");
    return { handled: true };
  }

  const skipFuzzy =
    ctx.checkoutSource === "WEB_HANDOFF" || Boolean(ctx.lockedProductLines?.length);
  const preferredId = ctx.merchantId ?? ctx.previousMerchantId;

  type QuoteBasket = {
    ok: true;
    merchant: { id: string; name: string; latitude?: unknown; longitude?: unknown };
    lines: NonNullable<ConversationContext["draftLines"]>;
    switchedFromPreferred?: boolean;
  };

  let basket: QuoteBasket | { ok: false; missing: string[]; partialByMerchant: Array<{ merchant: { name: string }; covered: string[] }> };

  if (skipFuzzy && ctx.lockedProductLines?.length) {
    try {
      const quoted = await quoteCart({
        lat: ctx.deliveryLat,
        lng: ctx.deliveryLng,
        lines: ctx.lockedProductLines.map((l) => ({
          productId: l.productId,
          quantity: l.quantity,
          flavorOptionId: l.flavorOptionId ?? null,
          flavorPreference: l.flavorPreference ?? null
        })),
        preferredMerchantId: preferredId
      });
      basket = {
        ok: true,
        merchant: { id: quoted.merchant.id, name: quoted.merchant.name },
        lines: quoted.lines,
        switchedFromPreferred: false
      };
    } catch (err) {
      if (err instanceof AppError && err.code === "SHOP_NOT_NEARBY" && ctx.lockedProductLines?.length) {
        if (!deliveryTerritory(ctx)) {
          await wa.sendText(phone, formatOutsideDeliveryTerritory());
          return { handled: true };
        }
        const accepted = await acceptUnresolvedProductRequest({
          phone,
          lat: ctx.deliveryLat,
          lng: ctx.deliveryLng,
          deliveryLabel: ctx.originalTypedAddress || ctx.deliveryLabel || "Delivery location",
          lines: ctx.lockedProductLines.map((line) => ({ productId: line.productId, quantity: line.quantity }))
        });
        if (accepted) return presentUnresolvedAcceptance(phone, convId, ctx, accepted);
      }
      setExpected(ctx, "PRODUCT_TEXT");
      await updateConversation(convId, { state: WhatsAppConversationState.BUILDING_CART, context: ctx });
      await wa.sendText(phone, formatProductNotIdentified("that product"));
      return { handled: true };
    }
  } else {
    if (!ctx.requestedItems?.length) {
      setExpected(ctx, "PRODUCT_TEXT");
      await updateConversation(convId, { state: WhatsAppConversationState.BUILDING_CART, context: ctx });
      await wa.sendText(phone, "Tell me what you'd like to buy.");
      return { handled: true };
    }
    const built = await buildOneStoreBasket(ctx.deliveryLat, ctx.deliveryLng, ctx.requestedItems, {
      preferredMerchantId: preferredId
    });
    basket = built;
  }

  if (!basket.ok) {
    if (!deliveryTerritory(ctx)) {
      await wa.sendText(phone, formatOutsideDeliveryTerritory());
      return { handled: true };
    }
    const accepted = await acceptUnresolvedTextRequest({
      phone,
      lat: ctx.deliveryLat,
      lng: ctx.deliveryLng,
      deliveryLabel: ctx.originalTypedAddress || ctx.deliveryLabel || "Delivery location",
      items: ctx.requestedItems ?? []
    });
    if (accepted) return presentUnresolvedAcceptance(phone, convId, ctx, accepted);
    await wa.sendText(phone, formatProductNotIdentified(basket.missing.join(", ") || "that product"));
    return { handled: true };
  }

  if (!skipFuzzy) {
    for (const item of ctx.requestedItems ?? []) {
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
        const choiceId = crypto.randomUUID();
        ctx.pendingChoices = [{ query: item.query, options, choiceId }];
        ctx.lastDisambiguationQuery = item.query;
        ctx.choiceId = choiceId;
        setExpected(ctx, "PRODUCT_DISAMBIGUATION");
        const title =
          options.length === 2 ? `Which ${item.query}?` : "Which one do you want?";
        await sendProductChoices(phone, ctx, title, options);
        await updateConversation(convId, {
          state: WhatsAppConversationState.AWAITING_PRODUCT_CHOICE,
          context: ctx
        });
        return { handled: true };
      }
    }
  }

  ctx.draftLines = basket.lines;
  ctx.merchantId = basket.merchant.id;
  ctx.draftQuotedAt = new Date().toISOString();
  clearPendingClarification(ctx);

  let merchantLat = Number((basket.merchant as { latitude?: unknown }).latitude);
  let merchantLng = Number((basket.merchant as { longitude?: unknown }).longitude);
  if (!Number.isFinite(merchantLat) || !Number.isFinite(merchantLng)) {
    const { prisma } = await import("../../config/prisma.js");
    const m = await prisma.merchant.findUnique({
      where: { id: basket.merchant.id },
      select: { latitude: true, longitude: true }
    });
    merchantLat = Number(m?.latitude);
    merchantLng = Number(m?.longitude);
  }

  const totals = await quoteBasketTotals({
    merchantLat,
    merchantLng,
    customerLat: ctx.deliveryLat,
    customerLng: ctx.deliveryLng,
    lines: basket.lines,
    locationMode: ctx.pilotLocationMode,
    deliveryPrecision: ctx.deliveryPrecision,
    typedAddress: ctx.originalTypedAddress,
    deliveryLabel: ctx.originalTypedAddress || ctx.deliveryLabel
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
  setExpected(ctx, "ORDER_CONFIRMATION");

  if (opts?.compact && !basket.switchedFromPreferred) {
    await updateConversation(convId, {
      state: WhatsAppConversationState.AWAITING_ORDER_CONFIRMATION,
      context: ctx
    });
    await wa.sendText(
      phone,
      formatCompactMutation({
        note: opts.mutationNote || "Updated",
        totalCents: totals.totalCents
      })
    );
    return { handled: true };
  }

  const switchNote = basket.switchedFromPreferred
    ? formatShopSwitch({
        previousShopName,
        newShopName: basket.merchant.name,
        totalCents: totals.totalCents
      }) + "\n\n"
    : "";

  const textBody = formatOrderCartSummary({
    lines: basket.lines.map((l) => ({
      quantity: l.quantity,
      productName: l.productName,
      flavorLine: formatFlavorCustomerLine(l.flavorPreference, l.flavorName),
      lineTotalCents: l.lineTotalCents
    })),
    subtotalCents: totals.subtotalCents,
    deliveryFeeCents: totals.deliveryFeeCents,
    serviceFeeCents: totals.serviceFeeCents,
    totalCents: totals.totalCents,
    deliveryLabel: ctx.deliveryLabel ?? undefined,
    includeConfirmChoices: true
  });
  await sendOrderReview(phone, ctx, switchNote + textBody);
  await updateConversation(convId, {
    state: WhatsAppConversationState.AWAITING_ORDER_CONFIRMATION,
    context: ctx
  });
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
  const qty =
    ctx.requestedItems?.find((r) => r.query === pending.query || r.query === ctx.lastDisambiguationQuery)
      ?.quantity ?? 1;
  ctx.requestedItems = (ctx.requestedItems ?? []).map((r) =>
    r.query === pending.query || r.query === ctx.lastDisambiguationQuery
      ? { query: selected.name, quantity: r.quantity }
      : r
  );
  if (selected.catalogOnly) {
    ctx.pendingChoices = undefined;
    ctx.lastDisambiguationQuery = undefined;
    ctx.choiceId = undefined;
    return resolveProductsThenContinue(phone, convId, ctx);
  }
  const flavor = await attachFlavorToLock(
    { id: selected.productId, name: selected.name },
    pending.query
  );
  ctx.lockedProductLines = [
    ...(ctx.lockedProductLines ?? []).filter((l) => l.productId !== selected.productId),
    {
      productId: selected.productId,
      quantity: qty,
      productName: selected.name,
      unitPriceCents: selected.priceCents ?? 0,
      merchantId: ctx.merchantId ?? "",
      flavorOptionId: flavor.flavorOptionId,
      flavorName: flavor.flavorName,
      flavorPreference: flavor.flavorPreference
    }
  ];
  const resolvedChoiceId = pending.choiceId ?? ctx.choiceId;
  ctx.pendingChoices = undefined;
  ctx.lastDisambiguationQuery = undefined;
  ctx.choiceId = undefined;
  void resolvedChoiceId;
  if (ctx.deliveryLat != null && ctx.deliveryLng != null) {
    return buildAndPresentQuote(phone, convId, ctx);
  }
  setExpected(ctx, "READY_TO_ORDER");
  const lines = cartLinesForDisplay(ctx);
  const subtotal = lines.reduce((s, l) => s + l.lineTotalCents, 0);
  await sendCartActions(phone, ctx, { lines, subtotalCents: subtotal });
  await updateConversation(convId, { state: WhatsAppConversationState.BUILDING_CART, context: ctx });
  return { handled: true };
}

/** Twilio may send button id OR the visible title ("Confirm") as ButtonPayload. */
function isReviewButton(
  buttonId: string | undefined,
  action: "confirm" | "change" | "cancel"
): boolean {
  if (!buttonId) return false;
  const id = buttonId.trim().toLowerCase();
  if (action === "confirm") return id === "confirm_order" || id === "confirm";
  if (action === "change") return id === "change_order" || id === "change";
  return id === "cancel_order" || id === "cancel";
}

/**
 * Order-review pending state: CONFIRM / CHANGE / CANCEL only.
 * Always returns — never falls through to product extraction.
 */
async function handleOrderReviewDecision(
  phone: string,
  customerId: string,
  convId: string,
  ctx: ConversationContext,
  text: string,
  buttonId?: string
): Promise<{ handled: boolean }> {
  const wa = getWhatsAppProvider();
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();

  const isConfirm =
    isReviewButton(buttonId, "confirm") ||
    trimmed === "1" ||
    isConfirmIntent(text) ||
    /^(confirm(\s+order)?|yes|ok|okay)$/i.test(lower);

  if (isConfirm) {
    return confirmDraftOrder(phone, customerId, convId, ctx);
  }

  const isChange =
    isReviewButton(buttonId, "change") ||
    trimmed === "2" ||
    isChangeIntent(text);

  if (isChange) {
    setExpected(ctx, "CHANGE_WHAT");
    await sendChangeWhat(phone, ctx, Boolean(ctx.paymentPhase));
    await updateConversation(convId, {
      state: WhatsAppConversationState.AWAITING_ORDER_CONFIRMATION,
      context: ctx
    });
    return { handled: true };
  }

  const isCancel =
    isReviewButton(buttonId, "cancel") ||
    trimmed === "3" ||
    isCancelIntent(text) ||
    /^cancel(\s+order)?$/i.test(lower);

  if (isCancel) {
    const cleared = cancelCheckoutDraft(ctx);
    await updateConversation(convId, {
      state: WhatsAppConversationState.IDLE,
      context: cleared
    });
    const { formatOrderCancelled } = await import("./copy.js");
    await wa.sendText(phone, formatOrderCancelled());
    return { handled: true };
  }

  // Unrecognized while reviewing — if it looks like shopping/cart edit, leave review
  // and let the main handler apply mutations. Otherwise re-prompt.
  const intent = classifyShoppingIntent(text);
  const shoppingEdit = [
    "ADD_ITEM",
    "REMOVE_ITEM",
    "CHANGE_QUANTITY",
    "REPLACE_ITEM",
    "NEW_LIST",
    "SHOW_CART",
    "CLEAR_CART",
    "CHECK_TOTAL",
    "CHECK_PRICE",
    "CHECK_AVAILABILITY",
    "SET_BUDGET"
  ].includes(intent.kind);
  if (shoppingEdit || (await extractShoppingItemsWithOptionalAi(text)).length > 0) {
    await updateConversation(convId, {
      state: WhatsAppConversationState.BUILDING_CART,
      context: ctx
    });
    return { handled: false };
  }

  await sendOrderReview(
    phone,
    ctx,
    ["Confirm order?", "", "1. Confirm", "2. Change", "3. Cancel"].join("\n")
  );
  await updateConversation(convId, { context: ctx });
  return { handled: true };
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

  const totals = await quoteBasketTotalsFromContext(ctx);
  if (!totals) {
    await wa.sendText(phone, "That expired. Tell me what you'd like to buy again.");
    return { handled: true };
  }

  ctx.paymentPhase = "SELECT_METHOD";
  ctx.paymentAttemptId = undefined;
  ctx.pendingPaymentOrderId = undefined;
  ctx.payerPhoneDisplay = undefined;
  ctx.selectedPaymentMethod = undefined;
  setExpected(ctx, "PAYMENT_METHOD");
  await sendPaymentChoices(phone, ctx, totals.totalCents);
  await updateConversation(convId, {
    state: WhatsAppConversationState.AWAITING_PAYMENT,
    context: ctx
  });
  return { handled: true };
}

async function handlePaymentConversation(
  phone: string,
  customerId: string,
  convId: string,
  ctx: ConversationContext,
  text: string,
  buttonId?: string
) {
  const wa = getWhatsAppProvider();
  const phase = ctx.paymentPhase ?? "SELECT_METHOD";

  if (isClaimPaidIntent(text)) {
    await wa.sendText(phone, formatClaimPaidIgnored());
    return { handled: true };
  }

  if (
    buttonId === "pay_ecocash" ||
    buttonId?.trim().toLowerCase() === "ecocash" ||
    isSelectEcoCashIntent(text) ||
    (phase === "SELECT_METHOD" && text.trim() === "1")
  ) {
    if (phase === "PENDING_PROVIDER") {
      await wa.sendText(phone, formatPaymentStillPending());
      return { handled: true };
    }
    ctx.selectedPaymentMethod = "ECOCASH";
    ctx.paymentPhase = "ENTER_PAYMENT_PHONE";
    setExpected(ctx, "ECOCASH_NUMBER");
    await updateConversation(convId, {
      state: WhatsAppConversationState.AWAITING_PAYMENT,
      context: ctx
    });
    await wa.sendText(phone, formatMobileMoneyPhonePrompt("ECOCASH"));
    return { handled: true };
  }

  if (
    buttonId === "pay_onemoney" ||
    buttonId?.trim().toLowerCase() === "onemoney" ||
    isSelectOneMoneyIntent(text)
  ) {
    if (resolveCommercePaymentProviderName() !== "paynow") {
      await sendPaymentChoices(phone, ctx);
      await updateConversation(convId, { context: ctx });
      return { handled: true };
    }
    if (phase === "PENDING_PROVIDER") {
      await wa.sendText(phone, formatPaymentStillPending());
      return { handled: true };
    }
    ctx.selectedPaymentMethod = "ONEMONEY";
    ctx.paymentPhase = "ENTER_PAYMENT_PHONE";
    setExpected(ctx, "ECOCASH_NUMBER");
    await updateConversation(convId, {
      state: WhatsAppConversationState.AWAITING_PAYMENT,
      context: ctx
    });
    await wa.sendText(phone, formatMobileMoneyPhonePrompt("ONEMONEY"));
    return { handled: true };
  }

  if (
    isRetryPaymentIntent(text) ||
    text.trim().toUpperCase() === "RETRY" ||
    ((phase === "FAILED" || phase === "EXPIRED") && text.trim() === "1")
  ) {
    if (ctx.pendingPaymentOrderId) {
      await cancelPendingPaymentAttempts(ctx.pendingPaymentOrderId);
    }
    const method = ctx.selectedPaymentMethod ?? "ECOCASH";
    ctx.selectedPaymentMethod = method;
    ctx.paymentPhase = "ENTER_PAYMENT_PHONE";
    ctx.paymentAttemptId = undefined;
    ctx.payerPhoneDisplay = undefined;
    setExpected(ctx, "ECOCASH_NUMBER");
    await updateConversation(convId, {
      state: WhatsAppConversationState.AWAITING_PAYMENT,
      context: ctx
    });
    await wa.sendText(phone, formatMobileMoneyPhonePrompt(method));
    return { handled: true };
  }

  if (
    buttonId === "pay_cash" ||
    buttonId?.trim().toLowerCase() === "cash" ||
    isSelectCashIntent(text) ||
    text.trim().toUpperCase() === "CASH" ||
    (phase === "SELECT_METHOD" && text.trim() === "2") ||
    ((phase === "FAILED" || phase === "EXPIRED" || phase === "PENDING_PROVIDER") &&
      text.trim() === "2")
  ) {
    return finalizeCashPayment(phone, customerId, convId, ctx);
  }

  if (phase === "PENDING_PROVIDER") {
    const maybePhone = validateZimbabweMobileForEcoCash(text);
    if (maybePhone.ok) {
      await wa.sendText(phone, formatPaymentStillPending());
      return { handled: true };
    }
    await wa.sendText(phone, formatPaymentStillPending());
    return { handled: true };
  }

  if (phase === "ENTER_PAYMENT_PHONE" || phase === "FAILED" || phase === "EXPIRED") {
    return startMobileMoneyWithPayerPhone(phone, customerId, convId, ctx, text);
  }

  const totals = await quoteBasketTotalsFromContext(ctx);
  await sendPaymentChoices(phone, ctx, totals?.totalCents ?? 0);
  await updateConversation(convId, { context: ctx });
  return { handled: true };
}

async function finalizeCashPayment(
  phone: string,
  customerId: string,
  convId: string,
  ctx: ConversationContext
) {
  const wa = getWhatsAppProvider();

  if (ctx.quoteCheckoutId && ctx.quoteApprovalId && ctx.quoteVersion != null) {
    try {
      const placed = await handoffApprovedQuote({
        checkoutId: ctx.quoteCheckoutId,
        approvalId: ctx.quoteApprovalId,
        quoteVersion: ctx.quoteVersion,
        paymentMethod: "CASH",
        actor: { commerceCustomerId: customerId, phone }
      });
      ctx.quoteCheckoutId = undefined;
      ctx.quoteApprovalId = undefined;
      ctx.quoteVersion = undefined;
      ctx.choiceId = undefined;
      ctx.activeOrderId = placed.orderId;
      ctx.paymentPhase = undefined;
      ctx = completeCheckoutSession(ctx);
      await updateConversation(convId, { state: WhatsAppConversationState.ORDER_ACTIVE, context: ctx });
      await wa.sendText(phone, formatCashOrderConfirmed(placed.totalCents, placed.orderNumber));
      return { handled: true };
    } catch (error) {
      const err = error as Error & { code?: string };
      await wa.sendText(phone, err.message || "That total could not be confirmed.");
      return { handled: true };
    }
  }

  if (ctx.pendingPaymentOrderId) {
    try {
      const order = await switchOrderToCashOnDelivery(ctx.pendingPaymentOrderId);
      ctx.activeOrderId = order.id;
      ctx.draftLines = undefined;
      ctx.draftQuotedAt = undefined;
      ctx.requestedItems = undefined;
      ctx.lockedProductLines = undefined;
      ctx.paymentPhase = undefined;
      ctx.paymentAttemptId = undefined;
      ctx.pendingPaymentOrderId = undefined;
      ctx.payerPhoneDisplay = undefined;
      ctx.selectedPaymentMethod = undefined;
      ctx = completeCheckoutSession(ctx);
      await updateConversation(convId, {
        state: WhatsAppConversationState.ORDER_ACTIVE,
        context: ctx
      });
      await wa.sendText(phone, formatCashOrderConfirmed(order.totalCents, order.orderNumber));
      const { notifyMerchantNewOrder } = await import("./merchant-handler.js");
      await notifyMerchantNewOrder(order);
      return { handled: true };
    } catch (error) {
      const err = error as Error & { code?: string };
      await wa.sendText(phone, err.message || "Could not switch to cash on delivery.");
      return { handled: true };
    }
  }

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

  try {
    const order = await createConfirmedCommerceOrder({
      commerceCustomerId: customerId,
      merchantId: ctx.merchantId,
      lines: ctx.draftLines,
      deliveryLabel: ctx.originalTypedAddress || ctx.deliveryLabel || "Shared location",
      deliveryLatitude: ctx.deliveryLat,
      deliveryLongitude: ctx.deliveryLng,
      locationMode: ctx.pilotLocationMode,
      deliveryPrecision: ctx.deliveryPrecision,
      typedAddress: ctx.originalTypedAddress,
      customerWhatsAppPhone: phone,
      paymentMethod: CommercePaymentMethod.CASH
    });

    ctx.activeOrderId = order.id;
    ctx.draftLines = undefined;
    ctx.draftQuotedAt = undefined;
    ctx.requestedItems = undefined;
    ctx.lockedProductLines = undefined;
    ctx.paymentPhase = undefined;
    ctx.paymentAttemptId = undefined;
    ctx.pendingPaymentOrderId = undefined;
    ctx = completeCheckoutSession(ctx);
    await updateConversation(convId, {
      state: WhatsAppConversationState.ORDER_ACTIVE,
      context: ctx
    });

    await wa.sendText(phone, formatCashOrderConfirmed(order.totalCents, order.orderNumber));

    const { notifyMerchantNewOrder } = await import("./merchant-handler.js");
    await notifyMerchantNewOrder(order);

    return { handled: true };
  } catch (error) {
    return handleOrderCreateError(phone, customerId, convId, ctx, error);
  }
}

async function startMobileMoneyWithPayerPhone(
  phone: string,
  customerId: string,
  convId: string,
  ctx: ConversationContext,
  rawPhone: string
) {
  const wa = getWhatsAppProvider();
  const validated = validateZimbabweMobileForEcoCash(rawPhone);
  if (!validated.ok) {
    await wa.sendText(phone, validated.reason);
    return { handled: true };
  }

  const method =
    ctx.selectedPaymentMethod === "ONEMONEY"
      ? CommercePaymentMethod.ONEMONEY
      : CommercePaymentMethod.ECOCASH;

  try {
    let orderId = ctx.pendingPaymentOrderId;
    if (!orderId && ctx.quoteCheckoutId && ctx.quoteApprovalId && ctx.quoteVersion != null) {
      const placed = await handoffApprovedQuote({
        checkoutId: ctx.quoteCheckoutId,
        approvalId: ctx.quoteApprovalId,
        quoteVersion: ctx.quoteVersion,
        paymentMethod: "ECOCASH",
        payerPhone: rawPhone,
        actor: { commerceCustomerId: customerId, phone }
      });
      orderId = placed.orderId;
      ctx.quoteCheckoutId = undefined;
      ctx.quoteApprovalId = undefined;
      ctx.quoteVersion = undefined;
      ctx.choiceId = undefined;
      ctx.activeOrderId = placed.orderId;
      ctx.pendingPaymentOrderId = placed.orderId;
      ctx.paymentPhase = "PENDING_PROVIDER";
      ctx.paymentAttemptId = placed.attemptId;
      setExpected(ctx, "PAYMENT_PENDING");
      await updateConversation(convId, { state: WhatsAppConversationState.AWAITING_PAYMENT, context: ctx });
      await wa.sendText(
        phone,
        formatMobileMoneyPending({
          method: "ECOCASH",
          displayLocal: validated.displayLocal,
          paynowTestMode: false
        })
      );
      return { handled: true };
    }
    if (!orderId) {
      if (!ctx.draftLines?.length || !ctx.merchantId || ctx.deliveryLat == null || ctx.deliveryLng == null) {
        await wa.sendText(phone, "That expired. Tell me what you'd like to buy again.");
        return { handled: true };
      }
      const order = await createConfirmedCommerceOrder({
        commerceCustomerId: customerId,
        merchantId: ctx.merchantId,
        lines: ctx.draftLines,
        deliveryLabel: ctx.originalTypedAddress || ctx.deliveryLabel || "Shared location",
        deliveryLatitude: ctx.deliveryLat,
        deliveryLongitude: ctx.deliveryLng,
        locationMode: ctx.pilotLocationMode,
        deliveryPrecision: ctx.deliveryPrecision,
        typedAddress: ctx.originalTypedAddress,
        customerWhatsAppPhone: phone,
        paymentMethod: method
      });
      orderId = order.id;
      ctx.draftLines = undefined;
      ctx.draftQuotedAt = undefined;
      ctx.requestedItems = undefined;
      ctx.activeOrderId = order.id;
      ctx.pendingPaymentOrderId = order.id;
    }

    const { attempt, displayLocal, testMode, paymentMethod } =
      await initiateMobileMoneyPaymentForOrder({
        commerceOrderId: orderId,
        payerPhoneRaw: rawPhone,
        paymentMethod: method
      });

    ctx.selectedPaymentMethod =
      paymentMethod === CommercePaymentMethod.ONEMONEY ? "ONEMONEY" : "ECOCASH";
    ctx.paymentPhase = "PENDING_PROVIDER";
    ctx.paymentAttemptId = attempt.id;
    ctx.pendingPaymentOrderId = orderId;
    ctx.payerPhoneDisplay = displayLocal;
    setExpected(ctx, "PAYMENT_PENDING");
    await updateConversation(convId, {
      state: WhatsAppConversationState.AWAITING_PAYMENT,
      context: ctx
    });
    await wa.sendText(
      phone,
      formatMobileMoneyPending({
        method: ctx.selectedPaymentMethod,
        displayLocal,
        paynowTestMode: testMode
      })
    );
    return { handled: true };
  } catch (error) {
    const err = error as Error & { code?: string };
    if (err.code === "PAYMENT_ALREADY_PENDING") {
      await wa.sendText(phone, err.message);
      return { handled: true };
    }
    if (
      err.code === "PRICE_CHANGED" ||
      err.code === "PRODUCT_UNAVAILABLE" ||
      err.code === "EMPTY_BASKET" ||
      err.code === "MERCHANT_CLOSED"
    ) {
      return handleOrderCreateError(phone, customerId, convId, ctx, error);
    }
    await wa.sendText(phone, err.message || "Could not start payment. Reply RETRY or CASH.");
    ctx.paymentPhase = "FAILED";
    setExpected(ctx, "PAYMENT_RETRY");
    await updateConversation(convId, {
      state: WhatsAppConversationState.AWAITING_PAYMENT,
      context: ctx
    });
    return { handled: true };
  }
}

async function handleOrderCreateError(
  phone: string,
  _customerId: string,
  convId: string,
  ctx: ConversationContext,
  error: unknown
) {
  const wa = getWhatsAppProvider();
  const err = error as Error & { code?: string; errors?: Record<string, string> };
  if (err.code === "PRICE_CHANGED") {
    const { logDutsFlow } = await import("../../lib/flow-log.js");
    logDutsFlow("COMMERCE_PRICE_CHANGED", { merchantId: ctx.merchantId });
    logDutsFlow("COMMERCE_QUOTE_INVALIDATED", { reason: "PRICE_CHANGED" });
    const refreshed = err.errors?.lines ? (JSON.parse(err.errors.lines) as typeof ctx.draftLines) : null;
    if (refreshed?.length) {
      ctx.draftLines = refreshed;
      ctx.draftQuotedAt = new Date().toISOString();
      ctx.paymentPhase = undefined;
      ctx.pendingPaymentOrderId = undefined;
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
          : formatPriceChange({
              changes: parsed.length
                ? parsed
                : [{ name: "Item", oldCents: 0, newCents: totals?.totalCents ?? 0 }],
              totalCents: totals?.totalCents ?? 0
            });
      setExpected(ctx, "ORDER_CONFIRMATION");
      await sendOrderReview(phone, ctx, body);
      await updateConversation(convId, {
        state: WhatsAppConversationState.AWAITING_ORDER_CONFIRMATION,
        context: ctx
      });
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
    ctx.paymentPhase = undefined;
    await updateConversation(convId, { state: WhatsAppConversationState.BUILDING_CART, context: ctx });
    return { handled: true };
  }
  await wa.sendText(phone, "Couldn't place your order. Please try again or say HELP.");
  return { handled: true };
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
    lines: ctx.draftLines,
    locationMode: ctx.pilotLocationMode,
    deliveryPrecision: ctx.deliveryPrecision,
    typedAddress: ctx.originalTypedAddress,
    deliveryLabel: ctx.originalTypedAddress || ctx.deliveryLabel
  });
}

async function recoverToMainMenu(
  phone: string,
  convId: string,
  ctx: ConversationContext,
  welcome: boolean
): Promise<{ handled: true }> {
  const next: ConversationContext = {
    ...cancelCheckoutDraft(ctx),
    welcomeSentAt: ctx.welcomeSentAt
  };
  await sendMainMenu(phone, next, welcome);
  await updateConversation(convId, {
    state: WhatsAppConversationState.IDLE,
    context: next
  });
  return { handled: true };
}

async function tryHandleInteractiveAction(
  phone: string,
  customerId: string,
  convId: string,
  state: WhatsAppConversationState,
  ctx: ConversationContext,
  buttonId?: string
): Promise<{ handled: boolean } | null> {
  if (!buttonId) return null;
  const resolved = resolveInteractiveAction(ctx, buttonId);
  if (resolved.ok === false && resolved.reason === "unknown") return null;
  if (resolved.ok === false) {
    const wa = getWhatsAppProvider();
    await wa.sendText(phone, formatStaleChoiceNotice());
    if (isProtectedWhatsAppTransaction(ctx) || shouldHoldGreetingAtCheckout(ctx, state)) {
      await promptCurrentCheckoutStep(phone, convId, ctx);
    } else {
      return recoverToMainMenu(phone, convId, ctx, false);
    }
    return { handled: true };
  }
  return applyInteractiveAction(phone, customerId, convId, state, ctx, resolved.action);
}

async function applyInteractiveAction(
  phone: string,
  customerId: string,
  convId: string,
  state: WhatsAppConversationState,
  ctx: ConversationContext,
  action: InteractiveActionRecord
): Promise<{ handled: boolean }> {
  switch (action.kind) {
    case "MENU_SHOP":
      if (isProtectedWhatsAppTransaction(ctx)) {
        await promptCurrentCheckoutStep(phone, convId, ctx);
        return { handled: true };
      }
      setExpected(ctx, "PRODUCT_TEXT");
      await sendShopPrompt(phone, ctx);
      await updateConversation(convId, {
        state: WhatsAppConversationState.BUILDING_CART,
        context: ctx
      });
      return { handled: true };
    case "MENU_TRACK":
      return presentCustomerTracking(phone, convId, state, ctx, customerId);
    case "MENU_HELP":
      if (isProtectedWhatsAppTransaction(ctx)) {
        await getWhatsAppProvider().sendText(phone, formatCheckoutHelp(ctx.expectedInput));
        return { handled: true };
      }
      await sendHelpMenu(phone, ctx);
      await updateConversation(convId, { context: ctx });
      return { handled: true };
    case "MENU_MAIN":
      if (isProtectedWhatsAppTransaction(ctx)) {
        await promptCurrentCheckoutStep(phone, convId, ctx);
        return { handled: true };
      }
      return recoverToMainMenu(phone, convId, ctx, false);
    case "SELECT_FLAVOR": {
      if (!flavorUxEnabled()) {
        await getWhatsAppProvider().sendText(phone, formatStaleChoiceNotice());
        setExpected(ctx, "PRODUCT_TEXT");
        await sendShopPrompt(phone, ctx);
        await updateConversation(convId, {
          state: WhatsAppConversationState.BUILDING_CART,
          context: ctx
        });
        return { handled: true };
      }
      const pending = ctx.pendingFlavorChoices?.[0];
      const pick = pending?.flavors.find((f) => (f.id ?? null) === (action.flavorOptionId ?? null));
      if (!pending || pending.productId !== action.productId || !pick) {
        await getWhatsAppProvider().sendText(phone, formatStaleChoiceNotice());
        await promptCurrentCheckoutStep(phone, convId, ctx);
        return { handled: true };
      }
      applyPendingFlavorChoice(ctx, pick);
      if (ctx.deliveryLat != null && ctx.deliveryLng != null) {
        return buildAndPresentQuote(phone, convId, ctx);
      }
      setExpected(ctx, "READY_TO_ORDER");
      const lines = cartLinesForDisplay(ctx);
      const subtotal = lines.reduce((s, l) => s + l.lineTotalCents, 0);
      await sendCartActions(phone, ctx, { lines, subtotalCents: subtotal });
      await updateConversation(convId, { state: WhatsAppConversationState.BUILDING_CART, context: ctx });
      return { handled: true };
    }
    case "SELECT_PRODUCT": {
      const pending = ctx.pendingChoices?.[0];
      const idx = pending?.options.findIndex((o) => o.productId === action.productId) ?? -1;
      if (idx < 0) {
        await getWhatsAppProvider().sendText(phone, formatStaleChoiceNotice());
        await promptCurrentCheckoutStep(phone, convId, ctx);
        return { handled: true };
      }
      return applyProductChoice(phone, convId, ctx, idx + 1);
    }
    case "CART_CONTINUE":
      if (ctx.deliveryLat != null && ctx.deliveryLng != null) {
        return buildAndPresentQuote(phone, convId, ctx);
      }
      setExpected(ctx, "LOCATION");
      await updateConversation(convId, {
        state: WhatsAppConversationState.AWAITING_LOCATION,
        context: ctx
      });
      await sendLocationAsk(phone);
      return { handled: true };
    case "CART_ADD_MORE":
      setExpected(ctx, "PRODUCT_TEXT");
      await sendShopPrompt(phone, ctx);
      await updateConversation(convId, {
        state: WhatsAppConversationState.BUILDING_CART,
        context: ctx
      });
      return { handled: true };
    case "CART_VIEW":
      return presentCurrentCart(phone, convId, ctx);
    case "CART_CANCEL":
    case "REVIEW_CANCEL":
      if (isLivePendingPayment(ctx)) {
        await getWhatsAppProvider().sendText(phone, formatPaymentStillPending());
        return { handled: true };
      }
      ctx = cancelCheckoutDraft(ctx);
      await updateConversation(convId, { state: WhatsAppConversationState.IDLE, context: ctx });
      {
        const { formatOrderCancelled } = await import("./copy.js");
        await getWhatsAppProvider().sendText(phone, formatOrderCancelled());
      }
      return { handled: true };
    case "LOC_USE_AREA":
      return applyLocationClarification(phone, convId, ctx, "1");
    case "LOC_CHANGE":
      return applyLocationClarification(phone, convId, ctx, "2");
    case "LOC_NONE":
      ctx.pendingLocationChoices = undefined;
      ctx.pendingAreaMatch = undefined;
      ctx.locationClarificationType = undefined;
      setExpected(ctx, "LOCATION");
      await updateConversation(convId, {
        state: WhatsAppConversationState.AWAITING_LOCATION,
        context: ctx
      });
      await sendLocationAsk(phone);
      return { handled: true };
    case "LOC_PICK":
      return applyLocationClarification(phone, convId, ctx, String(action.choiceIndex ?? 0));
    case "REVIEW_PLACE":
      return confirmDraftOrder(phone, customerId, convId, ctx);
    case "REVIEW_CHANGE_ADDRESS":
      return handleChangeWhat(phone, convId, ctx, "2");
    case "REVIEW_CHANGE_ITEMS":
      return handleChangeWhat(phone, convId, ctx, "1");
    case "CHANGE_ITEMS":
      return handleChangeWhat(phone, convId, ctx, "1");
    case "CHANGE_LOCATION":
      return handleChangeWhat(phone, convId, ctx, "2");
    case "CHANGE_PAYMENT":
      return handleChangeWhat(phone, convId, ctx, "3");
    case "PAYMENT_ECOCASH":
      if (ctx.expectedInput === "PAYMENT_RETRY") {
        return handlePaymentConversation(phone, customerId, convId, ctx, "RETRY");
      }
      return handlePaymentConversation(phone, customerId, convId, ctx, "EcoCash", "pay_ecocash");
    case "PAYMENT_COD":
      return handlePaymentConversation(phone, customerId, convId, ctx, "Cash", "pay_cash");
    case "TRACK_ORDER":
      if (!action.orderId) {
        return presentCustomerTracking(phone, convId, state, ctx, customerId);
      }
      return presentTrackedOrder(phone, convId, ctx, action.orderId, customerId);
    case "UNLISTED_REQUEST":
    case "UNLISTED_TRY_AGAIN":
    case "UNLISTED_BUY":
    case "UNLISTED_DECLINE":
    case "UNLISTED_PAY_ECOCASH": {
      const unlisted = await applyUnlistedInteractive(phone, customerId, convId, ctx, action);
      if (unlisted) return unlisted;
      await promptCurrentCheckoutStep(phone, convId, ctx);
      return { handled: true };
    }
    default:
      await promptCurrentCheckoutStep(phone, convId, ctx);
      return { handled: true };
  }
}

async function promptCurrentCheckoutStep(
  phone: string,
  convId: string,
  ctx: ConversationContext
): Promise<void> {
  const expect = ctx.expectedInput ?? "NONE";
  switch (expect) {
    case "PAYMENT_PENDING":
      await getWhatsAppProvider().sendText(phone, formatPaymentStillPending());
      return;
    case "PENDING_PAYMENT_HANDOFF":
      await getWhatsAppProvider().sendText(phone, formatPendingPaymentHandoff());
      return;
    case "PAYMENT_METHOD":
    case "PAYMENT_RETRY": {
      const totals = await quoteBasketTotalsFromContext(ctx);
      await sendPaymentChoices(phone, ctx, totals?.totalCents);
      await updateConversation(convId, { context: ctx });
      return;
    }
    case "ECOCASH_NUMBER":
      await getWhatsAppProvider().sendText(
        phone,
        formatMobileMoneyPhonePrompt(ctx.selectedPaymentMethod === "ONEMONEY" ? "ONEMONEY" : "ECOCASH")
      );
      return;
    case "UNLISTED_OFFER":
      await sendUnlistedOffer(phone, ctx, ctx.pendingUnlistedQuery ?? "that item");
      await updateConversation(convId, { context: ctx });
      return;
    case "UNLISTED_QUOTE":
      if (ctx.unlistedRequestId) {
        const { getUnlistedRequest } = await import("../commerce/unlisted-item.service.js");
        const request = await getUnlistedRequest(ctx.unlistedRequestId);
        await sendUnlistedQuoteMessage(phone, ctx, request);
        await updateConversation(convId, { context: ctx });
      }
      return;
    case "UNLISTED_PAYMENT":
    case "UNLISTED_ECOCASH": {
      if (ctx.unlistedRequestId) {
        const { getUnlistedRequest } = await import("../commerce/unlisted-item.service.js");
        const request = await getUnlistedRequest(ctx.unlistedRequestId);
        if (expect === "UNLISTED_ECOCASH") {
          await getWhatsAppProvider().sendText(phone, formatEcoCashPrompt());
        } else {
          await sendUnlistedPaymentChoice(phone, ctx, request.totalCents ?? 0);
        }
        await updateConversation(convId, { context: ctx });
      }
      return;
    }
    case "LOCATION_CLARIFICATION":
      if (ctx.locationClarificationType === "CONFIRM_AREA" || ctx.pendingAreaMatch) {
        await sendUseThisArea(
          phone,
          ctx,
          ctx.pendingAreaMatch?.label || areaLabelFromDraft(ctx.deliveryLocationDraft ?? {})
        );
        await updateConversation(convId, { context: ctx });
        return;
      }
      if (ctx.pendingLocationChoices?.length) {
        await sendLocationCandidates(phone, ctx, ctx.pendingLocationChoices);
        await updateConversation(convId, { context: ctx });
        return;
      }
      await getWhatsAppProvider().sendText(phone, formatCheckoutHelp(expect));
      return;
    case "PRODUCT_FLAVOR": {
      if (!flavorUxEnabled()) {
        await sendShopPrompt(phone, ctx);
        return;
      }
      const pending = ctx.pendingFlavorChoices?.[0];
      if (pending) {
        await sendFlavorChoicesForProduct(phone, ctx, { id: pending.productId, name: pending.productName });
        await updateConversation(convId, { context: ctx });
        return;
      }
      await getWhatsAppProvider().sendText(phone, formatCheckoutHelp(expect));
      return;
    }
    case "PRODUCT_DISAMBIGUATION": {
      const pending = ctx.pendingChoices?.[0];
      if (pending?.options?.length) {
        await sendProductChoices(
          phone,
          ctx,
          pending.options.length === 2 ? `Which ${pending.query}?` : "Which one do you want?",
          pending.options
        );
        await updateConversation(convId, { context: ctx });
        return;
      }
      await getWhatsAppProvider().sendText(phone, formatCheckoutHelp(expect));
      return;
    }
    case "READY_TO_ORDER": {
      const lines = cartLinesForDisplay(ctx);
      const subtotal = lines.reduce((s, l) => s + l.lineTotalCents, 0);
      await sendCartActions(phone, ctx, { lines, subtotalCents: subtotal });
      await updateConversation(convId, { context: ctx });
      return;
    }
    case "ORDER_CONFIRMATION":
      await sendOrderReview(phone, ctx, formatCheckoutHelp(expect));
      await updateConversation(convId, { context: ctx });
      return;
    case "CHANGE_WHAT":
      await sendChangeWhat(phone, ctx, Boolean(ctx.paymentPhase));
      await updateConversation(convId, { context: ctx });
      return;
    case "PRODUCT_TEXT":
      await sendShopPrompt(phone, ctx);
      return;
    default:
      await getWhatsAppProvider().sendText(phone, formatCheckoutHelp(expect));
  }
}

async function presentCustomerTracking(
  phone: string,
  convId: string,
  state: WhatsAppConversationState,
  ctx: ConversationContext,
  commerceCustomerId: string
): Promise<{ handled: boolean }> {
  const wa = getWhatsAppProvider();
  const orders = await getCustomerActiveOrders(commerceCustomerId);
  if (orders.length > 1) {
    if (isUnfinishedCheckout(ctx, state) || isLivePendingPayment(ctx)) {
      ctx.statusResumeExpected = ctx.expectedInput;
    }
    ctx.statusOrderIds = orders.map((o) => o.id);
    setExpected(ctx, "ACTIVE_ORDER_STATUS");
    await sendTrackChoices(
      phone,
      ctx,
      orders.map((o) => ({
        id: o.id,
        orderNumber: o.orderNumber,
        label: commerceCustomerStatusCopy(o.status as never)
      }))
    );
    await updateConversation(convId, { context: ctx });
    return { handled: true };
  }
  await wa.sendText(phone, formatOrderTrackMessage(orders[0] ?? null));
  return { handled: true };
}

async function presentTrackedOrder(
  phone: string,
  convId: string,
  ctx: ConversationContext,
  orderId: string,
  commerceCustomerId?: string
): Promise<{ handled: boolean }> {
  const wa = getWhatsAppProvider();
  if (commerceCustomerId) {
    const owned = await getCustomerActiveOrders(commerceCustomerId);
    if (!owned.some((o) => o.id === orderId) && !(ctx.statusOrderIds ?? []).includes(orderId)) {
      await wa.sendText(phone, formatStaleChoiceNotice());
      await sendMainMenu(phone, ctx, false);
      await updateConversation(convId, { context: ctx });
      return { handled: true };
    }
  }
  const { prisma } = await import("../../config/prisma.js");
  const order = await prisma.commerceOrder.findUnique({
    where: { id: orderId },
    include: {
      items: true,
      merchant: true,
      linkedDeliveryGig: { include: { assignments: { include: { worker: true } } } }
    }
  });
  ctx.statusOrderIds = undefined;
  const resume = ctx.statusResumeExpected;
  ctx.statusResumeExpected = undefined;
  if (resume) {
    setExpected(ctx, resume);
  } else {
    setExpected(ctx, ctx.draftLines?.length ? "ORDER_CONFIRMATION" : "NONE");
  }
  await updateConversation(convId, { context: ctx });
  await wa.sendText(phone, formatOrderTrackMessage(order));
  return { handled: true };
}
