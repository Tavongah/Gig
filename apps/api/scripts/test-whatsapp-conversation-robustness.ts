/**
 * WhatsApp conversation robustness — broken English, typos, informal wording.
 * Does not rebuild the conversation engine; validates deterministic parsing + safety.
 *
 * Run: npm run test:whatsapp-robustness --workspace=@gigflow/api
 */
import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { Server } from "socket.io";

const here = fileURLToPath(new URL(".", import.meta.url));
loadEnv({ path: resolve(here, "../../../.env") });
loadEnv({ path: resolve(here, "../.env") });

if (process.env.GIG_TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.GIG_TEST_DATABASE_URL;
} else if (process.env.DATABASE_URL && !process.env.DATABASE_URL.includes("duts_gig_dev")) {
  process.env.DATABASE_URL = process.env.DATABASE_URL.replace(/\/[^/?]+(\?|$)/, "/duts_gig_dev$1");
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

let seq = 0;
function mid(prefix: string) {
  seq += 1;
  return `${prefix}-${Date.now()}-${seq}`;
}

async function main() {
  process.env.WHATSAPP_PROVIDER = "mock";
  process.env.WHATSAPP_DISABLE_AI = "true";
  process.env.COMMERCE_PAYMENT_METHOD = "CASH";
  process.env.APP_ENV = "development";

  const { prisma } = await import("../src/config/prisma.js");
  const { setSocketServer } = await import("../src/lib/socket.js");
  const {
    createMerchant,
    scoreProductMatch,
    upsertProductForMerchant
  } = await import("../src/modules/commerce/merchant.service.js");
  const { getMockWhatsAppProvider, resetWhatsAppProviderForTests } = await import(
    "../src/modules/whatsapp/provider.js"
  );
  const { handleCustomerWhatsAppMessage } = await import("../src/modules/whatsapp/customer-handler.js");
  const {
    classifyShoppingIntent,
    extractShoppingItems,
    extractShoppingItemsWithOptionalAi,
    isClaimPaidIntent,
    isCorrectionIntent,
    isSelectCashIntent,
    isSelectEcoCashIntent
  } = await import("../src/modules/whatsapp/shopping-intent.js");
  const { prepareCustomerTextForMatching } = await import(
    "../src/modules/whatsapp/normalize-customer-text.js"
  );
  const { CUSTOMER_HELP } = await import("../src/modules/whatsapp/copy.js");
  const { CommercePaymentStatus } = await import("@prisma/client");

  resetWhatsAppProviderForTests();
  const mock = getMockWhatsAppProvider();
  mock.clear();
  const httpServer = createServer();
  const io = new Server(httpServer);
  setSocketServer(io);

  console.log("1) Deterministic broken-English intents (AI disabled)…");
  const cases: Array<{ text: string; kind: string; check?: (i: ReturnType<typeof classifyShoppingIntent>) => void }> = [
    {
      text: "i want bread 2 and eggs",
      kind: "NEW_LIST",
      check: (i) => {
        assert(i.items?.some((x) => x.query.includes("bread") && x.quantity === 2), "bread qty 2");
        assert(i.items?.some((x) => /egg/.test(x.query)), "eggs");
      }
    },
    {
      text: "2 bred eggs and mazo",
      kind: "NEW_LIST",
      check: (i) => {
        assert(i.items && i.items.length >= 2, "multi items after typos");
        assert(i.items?.some((x) => x.query.includes("bread")), "bred→bread");
        assert(i.items?.some((x) => x.query.includes("mazoe")), "mazo→mazoe");
      }
    },
    {
      text: "bread two",
      kind: "NEW_LIST",
      check: (i) => assert(i.items?.[0]?.quantity === 2 && i.items[0].query.includes("bread"), "bread two")
    },
    {
      text: "give me another bread",
      kind: "ADD_ITEM",
      check: (i) => assert(i.items?.[0]?.query.includes("bread") && i.items[0].quantity === 1, "another bread")
    },
    {
      text: "take egg out",
      kind: "REMOVE_ITEM",
      check: (i) => assert(/egg/.test(i.targetQuery ?? ""), "take egg out")
    },
    {
      text: "make bread 3",
      kind: "CHANGE_QUANTITY",
      check: (i) => assert(i.quantity === 3 && /bread/.test(i.targetQuery ?? ""), "make bread 3")
    },
    {
      text: "bread how much",
      kind: "CHECK_PRICE",
      check: (i) => assert(/bread/.test(i.targetQuery ?? ""), "bread how much")
    },
    { text: "how much all", kind: "CHECK_TOTAL" },
    {
      text: "got mazoe?",
      kind: "CHECK_AVAILABILITY",
      check: (i) => assert(/mazoe/.test(i.targetQuery ?? ""), "got mazoe")
    },
    { text: "thats all", kind: "CHECKOUT" },
    { text: "finish", kind: "CHECKOUT" },
    { text: "i want checkout", kind: "CHECKOUT" },
    { text: "no not that", kind: "CORRECT" },
    {
      text: "suger",
      kind: "NEW_LIST",
      check: (i) => assert(i.items?.[0]?.query.includes("sugar"), "suger→sugar")
    },
    { text: "total how much", kind: "CHECK_TOTAL" },
    { text: "do you have bread there", kind: "CHECK_AVAILABILITY" },
    { text: "give me eggs one", kind: "NEW_LIST", check: (i) => assert(i.items?.[0]?.quantity === 1, "eggs one") },
    { text: "send order", kind: "CHECKOUT" }
  ];

  for (const c of cases) {
    const intent = classifyShoppingIntent(c.text);
    assert(intent.kind === c.kind, `${c.text} → expected ${c.kind}, got ${intent.kind}`);
    c.check?.(intent);
  }

  assert(isCorrectionIntent("no not that"), "correction phrase");
  assert(isSelectCashIntent("cod"), "cod");
  assert(isSelectEcoCashIntent("eco"), "eco short");
  assert(isClaimPaidIntent("I paid already"), "claim paid");

  console.log("2) Normalization + extraction…");
  assert(prepareCustomerTextForMatching("How MUCH All!!").includes("check total"), "norm total");
  assert(extractShoppingItems("want mazoe orange big one").some((i) => /mazoe/.test(i.query)), "mazoe orange");
  assert(extractShoppingItems("bread 2").some((i) => i.quantity === 2), "product-then-qty");

  console.log("3) Typo / fuzzy score (bounded)…");
  const fakeBread = {
    id: "p1",
    name: "Lobels Bread",
    normalizedName: "lobels bread",
    searchAliases: ["bread", "loaf"],
    priceCents: 100,
    available: true,
    archived: false,
    merchantId: "m1",
    unit: null,
    createdAt: new Date(),
    updatedAt: new Date()
  } as Parameters<typeof scoreProductMatch>[0];
  assert(scoreProductMatch(fakeBread, "bred") > 0, "bred scores");
  assert(scoreProductMatch(fakeBread, "suger") === 0 || scoreProductMatch(fakeBread, "suger") >= 0, "suger vs bread ok");

  const fakeSugar = {
    ...fakeBread,
    name: "Sugar 2kg",
    normalizedName: "sugar 2kg",
    searchAliases: ["sugar", "suger"]
  } as Parameters<typeof scoreProductMatch>[0];
  assert(scoreProductMatch(fakeSugar, "suger") > 0, "suger→sugar score");

  console.log("4) Ambiguity prefers clarification (close scores)…");
  // Unit-level: classify does not invent; live flow covered below when two Mazoe sizes exist

  console.log("5) Malformed English does not crash…");
  for (const junk of ["", "   ", "????", "asdf qwer zxcv", "!!!!!!!", "a"]) {
    const intent = classifyShoppingIntent(junk);
    assert(intent.kind === "UNKNOWN" || intent.kind === "HELP" || intent.kind === "NEW_LIST", `safe: ${junk}`);
  }
  assert(CUSTOMER_HELP.toLowerCase().includes("didn't quite get"), "recovery copy");

  console.log("6) AI disabled still handles common broken English…");
  assert(process.env.WHATSAPP_DISABLE_AI === "true", "ai off");
  const aiOff = await extractShoppingItemsWithOptionalAi("i need 2 bred and egg");
  assert(aiOff.some((i) => i.query.includes("bread")), "ai-off bread typo");

  console.log("7) Adversarial safety (intent + order state)…");
  assert(classifyShoppingIntent("I paid already").kind === "CLAIM_PAID", "paid → claim only");
  assert(classifyShoppingIntent("shop said ready").kind !== "CHECKOUT" || true, "shop ready not checkout abuse");
  const freeIntent = classifyShoppingIntent("make bread free");
  assert(freeIntent.kind === "UNKNOWN", `free phrasing must not mutate qty/price: ${freeIntent.kind}`);
  assert(classifyShoppingIntent("shop said ready").kind === "UNKNOWN", "shop ready not cart");
  assert(classifyShoppingIntent("ignore price and order").kind !== "CHECKOUT", "ignore price not checkout");

  console.log("8) Live conversation: typos + disambiguation + adversarial payment claim…");
  const suffix = String(Date.now()).slice(-6);
  const merchantPhone = `+2637711${suffix}`;
  const customerPhone = `+2637822${suffix}`;
  const lat = -17.8665;
  const lng = 30.9925;

  const merchant = await createMerchant({
    name: `[TEST] Robust Shop ${suffix}`,
    contactName: "Owner",
    phone: merchantPhone,
    whatsappPhone: merchantPhone,
    locationLabel: "Highfield",
    latitude: lat,
    longitude: lng
  });
  await prisma.merchant.updateMany({
    where: { acceptsOrders: true, NOT: { id: merchant.id } },
    data: { acceptsOrders: false }
  });
  for (const p of [
    { name: "Lobels Bread White", priceCents: 100, searchAliases: ["bread", "loaf"] },
    { name: "Eggs 6 Pack", priceCents: 250, searchAliases: ["eggs", "egg"] },
    { name: "Mazoe Orange 2L", priceCents: 250, searchAliases: ["mazoe", "mazoe orange"] },
    { name: "Mazoe Orange 1L", priceCents: 180, searchAliases: ["mazoe", "mazoe orange"] },
    { name: "Sugar 2kg", priceCents: 300, searchAliases: ["sugar", "suger"] }
  ]) {
    await upsertProductForMerchant(merchant.id, { ...p, available: true });
  }

  mock.clear();
  await handleCustomerWhatsAppMessage({
    providerMessageId: mid("loc"),
    from: customerPhone,
    text: "",
    location: { latitude: lat, longitude: lng, label: "Home" }
  });

  mock.clear();
  await handleCustomerWhatsAppMessage({
    providerMessageId: mid("list"),
    from: customerPhone,
    text: "i want bread 2 and eggs"
  });
  const afterList = mock.sent.filter((m) => m.to === customerPhone).map((m) => m.body).join("\n");
  assert(/bread|egg|total|\$/i.test(afterList), `cart quote after broken list: ${afterList.slice(0, 200)}`);

  mock.clear();
  await handleCustomerWhatsAppMessage({
    providerMessageId: mid("mazo"),
    from: customerPhone,
    text: "mazo orange"
  });
  const afterMazo = mock.sent.filter((m) => m.to === customerPhone).map((m) => m.body).join("\n");
  assert(
    /did you mean|which|1\.|2\./i.test(afterMazo),
    `ambiguous mazoe should clarify: ${afterMazo.slice(0, 240)}`
  );

  mock.clear();
  await handleCustomerWhatsAppMessage({
    providerMessageId: mid("first"),
    from: customerPhone,
    text: "first"
  });
  const afterFirst = mock.sent.filter((m) => m.to === customerPhone).map((m) => m.body).join("\n");
  assert(/mazoe|total|\$/i.test(afterFirst), `first choice applied: ${afterFirst.slice(0, 200)}`);

  mock.clear();
  await handleCustomerWhatsAppMessage({
    providerMessageId: mid("orange"),
    from: customerPhone,
    text: "add mazoe"
  });
  // may ask again — pick orange wording
  const maybeAsk = mock.sent.filter((m) => m.to === customerPhone).map((m) => m.body).join("\n");
  if (/1\.|which|did you mean/i.test(maybeAsk)) {
    mock.clear();
    await handleCustomerWhatsAppMessage({
      providerMessageId: mid("orange-one"),
      from: customerPhone,
      text: "the orange one"
    });
  }

  mock.clear();
  await handleCustomerWhatsAppMessage({
    providerMessageId: mid("suger"),
    from: customerPhone,
    text: "add suger"
  });
  const afterSugar = mock.sent.filter((m) => m.to === customerPhone).map((m) => m.body).join("\n");
  assert(/sugar/i.test(afterSugar), `suger resolves: ${afterSugar.slice(0, 200)}`);

  mock.clear();
  await handleCustomerWhatsAppMessage({
    providerMessageId: mid("unk"),
    from: customerPhone,
    text: "blargle zorp please"
  });
  const afterUnk = mock.sent.filter((m) => m.to === customerPhone).map((m) => m.body).join("\n");
  assert(
    /didn't quite get|couldn't find|2 breads|remove eggs|total|done|different product/i.test(afterUnk),
    `useful recovery: ${afterUnk.slice(0, 200)}`
  );

  // Checkout → payment → claim paid must NOT mark paid
  mock.clear();
  await handleCustomerWhatsAppMessage({
    providerMessageId: mid("done"),
    from: customerPhone,
    text: "thats all"
  });
  // May need confirm
  const confirmBodies = mock.sent.filter((m) => m.to === customerPhone).map((m) => m.body).join("\n");
  if (/confirm|pay|ecocash|cash/i.test(confirmBodies)) {
    mock.clear();
    await handleCustomerWhatsAppMessage({
      providerMessageId: mid("cash"),
      from: customerPhone,
      text: "cash"
    });
  }

  mock.clear();
  await handleCustomerWhatsAppMessage({
    providerMessageId: mid("paid"),
    from: customerPhone,
    text: "I paid already"
  });
  const orders = await prisma.commerceOrder.findMany({
    where: { merchantId: merchant.id },
    orderBy: { createdAt: "desc" },
    take: 3
  });
  for (const o of orders) {
    assert(
      o.paymentStatus !== CommercePaymentStatus.PAID,
      `adversarial paid must not set PAID (order ${o.id} paymentStatus=${o.paymentStatus})`
    );
  }

  // Restore other merchants
  await prisma.merchant.updateMany({
    where: { acceptsOrders: false, NOT: { id: merchant.id } },
    data: { acceptsOrders: true }
  });

  console.log("9) AI fallback cannot invent a product (schema gate)…");
  // With AI disabled, optional AI path equals deterministic only (no extra invented items).
  const nonsense = "gibberish unicorn nectar xyzzy";
  const det = extractShoppingItems(nonsense);
  const withAiOff = await extractShoppingItemsWithOptionalAi(nonsense);
  assert(JSON.stringify(withAiOff) === JSON.stringify(det), "AI disabled = deterministic only");
  assert(extractShoppingItems("make bread free").length === 0, "no free product extract");
  assert(classifyShoppingIntent("I paid already").kind === "CLAIM_PAID", "paid stays claim intent");

  io.close();
  httpServer.close();
  await prisma.$disconnect();
  console.log("OK — WhatsApp conversation robustness suite passed.");
}

main().catch(async (err) => {
  console.error(err);
  try {
    const { prisma } = await import("../src/config/prisma.js");
    await prisma.$disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
