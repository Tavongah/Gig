/**
 * Stage 4.6A — WhatsApp copy snapshot / assertion suite.
 * Run: npm run test:whatsapp-copy --workspace=@gigflow/api
 *
 * Asserts representative customer + merchant copy paths.
 * Not brittle on punctuation unless required.
 */
import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
loadEnv({ path: resolve(here, "../../../.env") });
loadEnv({ path: resolve(here, "../.env") });

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function includesAll(hay: string, needles: string[], label: string) {
  for (const n of needles) {
    assert(hay.toLowerCase().includes(n.toLowerCase()), `${label} missing "${n}":\n${hay}`);
  }
}

function excludesAll(hay: string, needles: string[], label: string) {
  for (const n of needles) {
    assert(!hay.toLowerCase().includes(n.toLowerCase()), `${label} should not contain "${n}":\n${hay}`);
  }
}

async function main() {
  const {
    CUSTOMER_HELP,
    MERCHANT_HELP,
    formatBudgetOver,
    formatCompactMutation,
    formatDisambiguation,
    formatMerchantNewOrder,
    formatMissingItems,
    formatOrderCartSummary,
    formatPriceChange,
    formatShopSwitch,
    parsePriceChangeDetail
  } = await import("../src/modules/whatsapp/copy.js");
  const { classifyShoppingIntent, isCorrectionIntent, isStartOverIntent } = await import(
    "../src/modules/whatsapp/shopping-intent.js"
  );
  const { formatRequestedCart } = await import("../src/modules/whatsapp/cart-mutations.js");

  // --- simple add (compact) ---
  const addCopy = formatCompactMutation({ note: "Milk added", totalCents: 870 });
  includesAll(addCopy, ["milk added", "total is now", "$8.70", "add", "remove", "checkout"], "simple add");
  excludesAll(addCopy, ["basket", "commerce", "quote invalidated"], "simple add");

  // --- remove ---
  const removeCopy = formatCompactMutation({ note: "Eggs removed", totalCents: 540 });
  includesAll(removeCopy, ["eggs removed", "$5.40"], "remove");

  // --- ambiguity ---
  const amb = formatDisambiguation("Which Coke?", [
    { name: "Coca-Cola 500ml", priceCents: 100 },
    { name: "Coca-Cola 2L", priceCents: 200 }
  ]);
  includesAll(amb, ["which coke", "500ml", "$1.00", "2l", "$2.00", "reply 1 or 2"], "ambiguity");
  excludesAll(amb, ["merchant id", "sku", "productid"], "ambiguity");

  // --- over budget ---
  const budget = formatBudgetOver({
    subtotalCents: 1240,
    budgetCents: 1000,
    lines: [
      { quantity: 2, productName: "Bread", lineTotalCents: 240 },
      { quantity: 1, productName: "Mazoe 2L", lineTotalCents: 1000 }
    ]
  });
  includesAll(
    budget,
    ["$12.40", "$2.40 over", "$10.00", "remove an item", "reduce a quantity"],
    "over budget"
  );

  // --- shop switch ---
  const shop = formatShopSwitch({
    previousShopName: "ABC Tuck Shop",
    newShopName: "Tariro Shop",
    totalCents: 980
  });
  includesAll(shop, ["abc tuck shop", "tariro shop", "full order", "$9.80"], "shop switch");
  excludesAll(shop, ["preferredmerchant", "rematch", "one-store"], "shop switch");

  // --- stale price ---
  const price = formatPriceChange({
    changes: [{ name: "Bread", oldCents: 100, newCents: 120 }],
    totalCents: 840
  });
  includesAll(price, ["price of bread", "$1.00", "$1.20", "new total", "$8.40", "confirm"], "stale price");
  excludesAll(price, ["quote invalidated", "authoritative"], "stale price");
  assert(parsePriceChangeDetail("Bread: $1.00 → $1.20").length === 1, "parse price change");

  // --- out of stock / missing ---
  const missing = formatMissingItems("Mazoe");
  includesAll(missing, ["couldn't find", "remove an item", "different product"], "out of stock path");
  excludesAll(missing, ["fulfill", "matching failed"], "out of stock path");

  // --- unknown input ---
  includesAll(
    CUSTOMER_HELP,
    ["didn't quite get", "2 breads and eggs", "remove eggs", "total", "done"],
    "unknown"
  );
  excludesAll(CUSTOMER_HELP, ["parser", "intent", "unknown intent", "invalid intent"], "unknown");

  // --- start over intent ---
  assert(isStartOverIntent("start again"), "start again");
  assert(classifyShoppingIntent("start over").kind === "START_OVER", "start over kind");

  // --- correction intents ---
  for (const phrase of ["no", "that's wrong", "not that one", "go back", "change that"]) {
    assert(isCorrectionIntent(phrase), `correction: ${phrase}`);
    assert(classifyShoppingIntent(phrase).kind === "CORRECT", `CORRECT kind: ${phrase}`);
  }

  // --- cart / order review summary ---
  const cart = formatOrderCartSummary({
    shopName: "Tariro Shop",
    lines: [
      { quantity: 2, productName: "Bread", lineTotalCents: 240 },
      { quantity: 1, productName: "Eggs", lineTotalCents: 280 },
      { quantity: 1, productName: "Mazoe 2L", lineTotalCents: 250 }
    ],
    subtotalCents: 770,
    deliveryFeeCents: 150,
    totalCents: 920,
    includeConfirmChoices: true
  });
  includesAll(
    cart,
    ["your order", "2 × bread", "eggs", "mazoe", "items: $7.70", "delivery: $1.50", "total: $9.20", "1. confirm", "2. change"],
    "cart summary"
  );
  excludesAll(
    cart,
    ["basket", "payment: cash", "confirm, change, or cancel", "PAYMENT_PENDING"],
    "cart summary"
  );

  const {
    formatPaymentMethodChoice,
    formatEcoCashPending,
    formatCashOrderConfirmed,
    formatEcoCashPaid,
    formatEcoCashFailed
  } = await import("../src/modules/whatsapp/copy.js");
  const pay = formatPaymentMethodChoice(498);
  includesAll(pay, ["choose payment", "1. ecocash", "2. onemoney", "3. cash on delivery"], "payment choice");
  excludesAll(pay, ["payment: cash on delivery", "PAYMENT_PENDING"], "payment choice");
  includesAll(formatEcoCashPending(), ["payment request sent", "approve", "waiting"], "ecocash pending");
  excludesAll(formatEcoCashPending(), ["payment received", "payment successful", "order paid"], "ecocash pending");
  includesAll(formatCashOrderConfirmed(498), ["cash on delivery", "$4.98", "sent to the shop"], "cash confirmed");
  includesAll(formatEcoCashPaid(498), ["payment received", "$4.98", "sent to the shop"], "paid");
  includesAll(formatEcoCashFailed(), ["payment failed", "1. try again", "2. pay cash"], "failed");

  const requested = formatRequestedCart([]);
  includesAll(requested, ["cart is empty", "like to buy"], "empty cart");

  // --- merchant new order ---
  const mNew = formatMerchantNewOrder({
    orderNumber: 1042,
    lines: ["2 × Bread", "1 × Eggs", "1 × Mazoe 2L"],
    itemsTotalCents: 770,
    totalCents: 920
  });
  includesAll(mNew, ["new order #1042", "2 × bread", "total: $9.20", "1. accept", "2. reject"], "merchant new");
  excludesAll(mNew, ["merchant_pending", "fulfillment", "commerceorder"], "merchant new");

  // --- merchant help / unknown ---
  includesAll(
    MERCHANT_HELP,
    ["didn't quite get", "orders", "add product", "change price", "out of stock", "ready"],
    "merchant unknown"
  );

  const { formatMerchantAccepted, formatMerchantReady, formatMerchantReadyDeliveryFailed } = await import(
    "../src/modules/whatsapp/copy.js"
  );
  includesAll(formatMerchantAccepted(1042), ["accepted", "prepare", "ready"], "merchant accept");
  includesAll(formatMerchantReady(1042), ["ready", "finding a courier"], "merchant ready");
  includesAll(
    formatMerchantReadyDeliveryFailed(),
    ["order is ready", "couldn't start delivery", "try ready again"],
    "merchant ready failed"
  );
  excludesAll(
    formatMerchantReadyDeliveryFailed(),
    ["contactphone", "zod", "prisma", "too_small"],
    "merchant ready failed"
  );

  console.log("Stage 4.6A WhatsApp copy assertions: PASS");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
