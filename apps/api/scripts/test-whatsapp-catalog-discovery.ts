/**
 * WhatsApp catalog discovery: category words, phrases, typos, and exact names.
 * Run: npm run test:whatsapp-catalog-discovery --workspace=@gigflow/api
 */
import { config as loadEnv } from "dotenv";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  catalogCategoriesForCustomerQuery,
  fuzzyCatalogCategoryForCustomerQuery
} from "@gigflow/shared";

const here = fileURLToPath(new URL(".", import.meta.url));
loadEnv({ path: resolve(here, "../../../.env") });
loadEnv({ path: resolve(here, "../.env") });

assert.ok(catalogCategoriesForCustomerQuery("shoes").includes("Shoes"));
assert.ok(catalogCategoriesForCustomerQuery("sneakers").includes("Shoes"));
assert.ok(catalogCategoriesForCustomerQuery("toiletries").includes("Personal Care"));
assert.equal(catalogCategoriesForCustomerQuery("soap").includes("Personal Care"), false);
assert.equal(fuzzyCatalogCategoryForCustomerQuery("shoos"), "Shoes");
assert.equal(fuzzyCatalogCategoryForCustomerQuery("zzzzqqqq"), null);

async function main() {
  const { prisma } = await import("../src/config/prisma.js");
  const { createCatalogProduct, matchPublicCatalogDemand } = await import(
    "../src/modules/commerce/catalog.service.js"
  );
  const { classifyShoppingIntent, extractShoppingItems } = await import(
    "../src/modules/whatsapp/shopping-intent.js"
  );
  const { handleCustomerWhatsAppMessage } = await import("../src/modules/whatsapp/customer-handler.js");
  const { MockWhatsAppProvider, setWhatsAppProviderForTests, TwilioWhatsAppProvider } = await import(
    "../src/modules/whatsapp/provider.js"
  );

  let twilioBody = "";
  const twilio = new TwilioWhatsAppProvider({
    accountSid: "ACtest",
    authToken: "token",
    fromWhatsApp: "whatsapp:+14155238886",
    fetchImpl: (async (_url: string, init?: RequestInit) => {
      twilioBody = String(init?.body ?? "");
      return new Response(JSON.stringify({ sid: "SM1" }), { status: 201 });
    }) as typeof fetch
  });
  const twilioResult = await twilio.sendOutbound("+263770000099", {
    body: "1. Apple",
    mediaUrl: "https://cdn.example.com/apple.jpg"
  });
  assert.equal(twilioResult.ok, true);
  assert.match(twilioBody, /MediaUrl=https%3A%2F%2Fcdn\.example\.com%2Fapple\.jpg/);
  assert.match(twilioBody, /Body=/);

  assert.equal(extractShoppingItems("I want shoes")[0]?.query, "shoes");
  assert.equal(extractShoppingItems("I'm looking for shoes")[0]?.query, "shoes");
  assert.equal(extractShoppingItems("give me shoes")[0]?.query, "shoes");
  const availability = classifyShoppingIntent("Do you have shoes?");
  assert.equal(availability.kind, "CHECK_AVAILABILITY");
  assert.equal(availability.targetQuery, "shoes");

  const stamp = Date.now() % 10_000_000;
  const phones: string[] = [];
  const catalogIds: string[] = [];
  const mock = new MockWhatsAppProvider();
  setWhatsAppProviderForTests(mock);
  let n = 0;

  function phone() {
    const value = `+2637${String(stamp + n).padStart(8, "0").slice(-8)}`;
    n += 1;
    phones.push(value);
    return value;
  }

  async function catalog(name: string, category: string, primaryImageUrl?: string) {
    const row = await createCatalogProduct({
      name,
      category,
      sizeLabel: "1",
      ...(primaryImageUrl ? { primaryImageUrl } : {})
    });
    catalogIds.push(row.id);
    return row;
  }

  async function say(from: string, text: string) {
    mock.sent.length = 0;
    await handleCustomerWhatsAppMessage({
      providerMessageId: `disc-${stamp}-${n}-${text.slice(0, 16)}`,
      from,
      text
    });
    n += 1;
    return mock.sent.map((message) => message.body).join("\n");
  }

  try {
    const mazoe = await catalog(`Mazoe Orange ${stamp}`, "Juices");
    const exact = await catalog(`Qxv${stamp}zeta`, "Groceries");
    const campus = await catalog(`000 Campus ${stamp}`, "Shoes");
    const school = await catalog(`000 School ${stamp}`, "Shoes");

    const mazoeReply = await say(phone(), "Mazoe");
    assert.doesNotMatch(mazoeReply, /couldn't identify/i);
    assert.match(mazoeReply, /mazoe/i);

    const exactReply = await say(phone(), `I want ${exact.name}`);
    assert.match(exactReply, /got your request/i);
    assert.match(exactReply, new RegExp(exact.name));
    assert.doesNotMatch(exactReply, /Reply 1/);
    assert.equal(mock.sent.some((message) => message.mediaUrl), false);

    const shoes = await matchPublicCatalogDemand("sneakers");
    assert.ok(shoes.some((product) => product.id === campus.id));
    assert.ok(shoes.some((product) => product.id === school.id));

    for (const text of ["Shoes", "I want shoes", "Do you have shoes?", "I'm looking for shoes"]) {
      const reply = await say(phone(), text);
      assert.doesNotMatch(reply, /couldn't identify/i, text);
      assert.match(reply, /1\./, text);
      assert.match(reply, new RegExp(campus.name), text);
      assert.match(reply, new RegExp(school.name), text);
      assert.doesNotMatch(reply, /\$\d/, text);
      assert.equal(mock.sent.some((message) => message.mediaUrl), false, text);
    }

    const typoName = exact.name.replace("zeta", "yeta");
    const typoReply = await say(phone(), typoName);
    assert.doesNotMatch(typoReply, /couldn't identify/i);
    assert.match(typoReply, new RegExp(exact.name));

    const unknown = await say(phone(), `qqqqzzzz${stamp}`);
    assert.match(unknown, /couldn't identify/i);
    assert.equal(mock.sent.some((message) => message.mediaUrl), false);

    const pictured = await catalog(`Onlyimg${stamp}`, "Groceries", `https://cdn.example.com/only-${stamp}.jpg`);
    const picturedReply = await say(phone(), `I want ${pictured.name}`);
    assert.match(picturedReply, /got your request/i);
    assert.equal(
      mock.sent.filter((message) => message.mediaUrl === pictured.primaryImageUrl).length,
      1
    );

    const withPhoto = await catalog(`Pair${stamp} alpha`, "Groceries", `https://cdn.example.com/pair-a-${stamp}.jpg`);
    const alsoPhoto = await catalog(`Pair${stamp} beta`, "Groceries", `https://cdn.example.com/pair-b-${stamp}.jpg`);
    const pairReply = await say(phone(), `Pair${stamp}`);
    assert.match(pairReply, /1\./);
    assert.match(pairReply, new RegExp(withPhoto.name));
    assert.match(pairReply, new RegExp(alsoPhoto.name));
    const pairMedia = mock.sent.filter((message) => message.mediaUrl);
    assert.equal(pairMedia.length, 2);
    assert.match(pairMedia[0]!.body, /^1\. /);
    assert.match(pairMedia[1]!.body, /^2\. /);

    const mixedPhoto = await catalog(`Mixset${stamp} alpha`, "Groceries", `https://cdn.example.com/mix-${stamp}.jpg`);
    const mixedPlain = await catalog(`Mixset${stamp} beta`, "Groceries");
    const mixedReply = await say(phone(), `Mixset${stamp}`);
    assert.match(mixedReply, new RegExp(mixedPhoto.name));
    assert.match(mixedReply, new RegExp(mixedPlain.name));
    assert.equal(mock.sent.filter((message) => message.mediaUrl).length, 1);

    const capNames = ["a", "b", "c", "d", "e", "f"];
    for (const suffix of capNames) {
      await catalog(`Imgcap${stamp} ${suffix}`, "Groceries", `https://cdn.example.com/cap-${stamp}-${suffix}.jpg`);
    }
    const capReply = await say(phone(), `Imgcap${stamp}`);
    assert.match(capReply, new RegExp(`Imgcap${stamp} a`));
    assert.doesNotMatch(capReply, new RegExp(`Imgcap${stamp} f`));
    assert.ok(mock.sent.filter((message) => message.mediaUrl).length <= 5);
    assert.equal(mock.sent.filter((message) => message.mediaUrl).length, 5);

    mock.failMedia = true;
    const failedReply = await say(phone(), `Pair${stamp}`);
    assert.match(failedReply, /1\./);
    assert.match(failedReply, new RegExp(withPhoto.name));
    assert.match(failedReply, new RegExp(alsoPhoto.name));
    assert.equal(mock.sent.some((message) => message.mediaUrl), false);
    mock.failMedia = false;

    console.log("whatsapp catalog discovery ok");
    void mazoe;
  } finally {
    const customers = phones.length
      ? await prisma.commerceCustomer.findMany({
          where: { whatsappPhone: { in: phones } },
          select: { id: true }
        })
      : [];
    const customerIds = customers.map((row) => row.id);
    if (customerIds.length) {
      await prisma.whatsAppConversation.deleteMany({ where: { commerceCustomerId: { in: customerIds } } });
      await prisma.commerceCustomer.deleteMany({ where: { id: { in: customerIds } } });
    }
    if (phones.length) {
      await prisma.whatsAppInboundMessage.deleteMany({ where: { phoneNormalized: { in: phones } } });
    }
    if (catalogIds.length) await prisma.catalogProduct.deleteMany({ where: { id: { in: catalogIds } } });
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
