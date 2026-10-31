/**
 * Shop offers become marketplace catalog products without merging different goods.
 * Run: npm run test:shop-catalog-sync --workspace=@gigflow/api
 */
import { config as loadEnv } from "dotenv";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { categoryFromShopOffer } from "@gigflow/shared";

const here = fileURLToPath(new URL(".", import.meta.url));
loadEnv({ path: resolve(here, "../../../.env") });
loadEnv({ path: resolve(here, "../.env") });

assert.equal(categoryFromShopOffer({ name: "Nike Shox", category: "Personal Care" }), "Shoes");
assert.equal(categoryFromShopOffer({ name: "Nike mind slides", category: "Personal Care" }), "Shoes");
assert.equal(categoryFromShopOffer({ name: "Bold Long stretch dress", category: "Fashion" }), "Fashion");
assert.equal(categoryFromShopOffer({ name: "Mazoe Orange", category: "Juices" }), "Juices");

async function main() {
  const { prisma } = await import("../src/config/prisma.js");
  const { matchPublicCatalogDemand, syncShopCatalog } = await import("../src/modules/commerce/catalog.service.js");
  const { upsertProductForMerchant } = await import("../src/modules/commerce/merchant.service.js");
  const { handleCustomerWhatsAppMessage } = await import("../src/modules/whatsapp/customer-handler.js");
  const { MockWhatsAppProvider, setWhatsAppProviderForTests } = await import("../src/modules/whatsapp/provider.js");

  const stamp = Date.now() % 10_000_000;
  const merchantIds: string[] = [];
  const catalogIds: string[] = [];
  const phones: string[] = [];
  let n = 0;

  async function shop(label: string) {
    const row = await prisma.merchant.create({
      data: {
        name: `Sync Shop ${label} ${stamp}`,
        contactName: "Tester",
        phone: `+1203555${String(stamp + n).slice(-4)}`,
        whatsappPhone: `+1203666${String(1000 + (stamp % 8000) + n).slice(-4)}`,
        locationLabel: "Gweru",
        latitude: -19.455,
        longitude: 29.812,
        category: "TUCK_SHOP"
      }
    });
    n += 1;
    merchantIds.push(row.id);
    return row;
  }

  try {
    const shopA = await shop("A");
    const shopB = await shop("B");
    const image = `https://cdn.example.com/sync-${stamp}.jpg`;

    const created = await upsertProductForMerchant(shopA.id, {
      name: `Unique Roller ${stamp}`,
      category: "Household",
      priceCents: 250,
      imageUrl: image
    });
    assert.ok(created.catalogProductId);
    assert.equal(created.priceCents, 250);
    const createdCatalog = await prisma.catalogProduct.findUniqueOrThrow({ where: { id: created.catalogProductId! } });
    catalogIds.push(createdCatalog.id);
    assert.equal(createdCatalog.status, "APPROVED");
    assert.equal(createdCatalog.primaryImageUrl, image);
    assert.equal(createdCatalog.name, created.name);

    const mazoe = await prisma.catalogProduct.create({
      data: {
        name: `Mazoe Orange ${stamp}`,
        normalizedName: `mazoe orange ${stamp}`,
        category: "Juices",
        status: "APPROVED",
        source: "DUTS_ADMIN",
        approvedAt: new Date()
      }
    });
    catalogIds.push(mazoe.id);
    const reused = await upsertProductForMerchant(shopA.id, {
      name: mazoe.name,
      category: "Juices",
      priceCents: 180
    });
    assert.equal(reused.catalogProductId, mazoe.id);
    assert.equal(reused.priceCents, 180);
    assert.equal(await prisma.catalogProduct.count({ where: { normalizedName: mazoe.normalizedName } }), 1);

    const sharedName = `Shared Bottle ${stamp}`;
    const first = await upsertProductForMerchant(shopA.id, { name: sharedName, priceCents: 200, category: "Drinks" });
    const second = await upsertProductForMerchant(shopB.id, { name: sharedName, priceCents: 180, category: "Drinks" });
    assert.equal(first.catalogProductId, second.catalogProductId);
    assert.equal(first.priceCents, 200);
    assert.equal(second.priceCents, 180);
    if (first.catalogProductId) catalogIds.push(first.catalogProductId);

    const red = await upsertProductForMerchant(shopA.id, { name: `School Shoe Red ${stamp}`, priceCents: 900, category: "Shoes" });
    const blue = await upsertProductForMerchant(shopA.id, { name: `School Shoe Blue ${stamp}`, priceCents: 950, category: "Shoes" });
    assert.notEqual(red.catalogProductId, blue.catalogProductId);
    if (red.catalogProductId) catalogIds.push(red.catalogProductId);
    if (blue.catalogProductId) catalogIds.push(blue.catalogProductId);

    const small = await upsertProductForMerchant(shopA.id, {
      name: `Size Bottle ${stamp}`,
      unit: "1l",
      priceCents: 100,
      category: "Drinks"
    });
    const large = await upsertProductForMerchant(shopB.id, {
      name: `Size Bottle ${stamp}`,
      unit: "2l",
      priceCents: 150,
      category: "Drinks"
    });
    assert.notEqual(small.catalogProductId, large.catalogProductId);
    if (small.catalogProductId) catalogIds.push(small.catalogProductId);
    if (large.catalogProductId) catalogIds.push(large.catalogProductId);

    const hidden = await prisma.product.create({
      data: {
        merchantId: shopA.id,
        name: `Hidden Roller ${stamp}`,
        normalizedName: `hidden roller ${stamp}`,
        priceCents: 100,
        available: false,
        category: "Household"
      }
    });
    const rejectedCatalog = await prisma.catalogProduct.create({
      data: {
        name: `Rejected Roller ${stamp}`,
        normalizedName: `rejected roller ${stamp}`,
        category: "Household",
        status: "REJECTED",
        source: "MERCHANT_SUBMISSION"
      }
    });
    catalogIds.push(rejectedCatalog.id);
    const rejectedOffer = await prisma.product.create({
      data: {
        merchantId: shopA.id,
        catalogProductId: rejectedCatalog.id,
        name: rejectedCatalog.name,
        normalizedName: rejectedCatalog.normalizedName,
        priceCents: 100,
        available: true,
        category: "Household"
      }
    });

    const shoeName = `000 Nike Shox ${stamp}`;
    const orphanCatalog = await prisma.catalogProduct.create({
      data: {
        name: shoeName,
        normalizedName: shoeName.toLowerCase(),
        category: "Personal Care",
        status: "PENDING",
        source: "MERCHANT_SUBMISSION",
        submittedByMerchantId: shopA.id
      }
    });
    catalogIds.push(orphanCatalog.id);
    const orphan = await prisma.product.create({
      data: {
        merchantId: shopA.id,
        catalogProductId: orphanCatalog.id,
        name: shoeName,
        normalizedName: shoeName.toLowerCase(),
        priceCents: 3200,
        available: true,
        category: "Personal Care",
        imageUrl: image
      }
    });

    const preview = await syncShopCatalog({ apply: false });
    assert.equal(preview.applied, false);
    assert.equal((await prisma.catalogProduct.findUniqueOrThrow({ where: { id: orphanCatalog.id } })).status, "PENDING");
    const publish = preview.actions.find((action) => action.productId === orphan.productId || action.productId === orphan.id);
    assert.equal(publish?.action, "publish");
    if (publish?.action === "publish") assert.equal(publish.category, "Shoes");

    const applied = await syncShopCatalog({ apply: true });
    const published = await prisma.catalogProduct.findUniqueOrThrow({ where: { id: orphanCatalog.id } });
    assert.equal(published.status, "APPROVED");
    assert.equal(published.category, "Shoes");
    assert.equal(published.primaryImageUrl, image);
    assert.equal((await prisma.product.findUniqueOrThrow({ where: { id: orphan.id } })).priceCents, 3200);
    assert.equal((await prisma.product.findUniqueOrThrow({ where: { id: hidden.id } })).catalogProductId, null);
    assert.equal((await prisma.catalogProduct.findUniqueOrThrow({ where: { id: rejectedCatalog.id } })).status, "REJECTED");

    const beforeSecond = await prisma.catalogProduct.count();
    const again = await syncShopCatalog({ apply: true });
    assert.equal(await prisma.catalogProduct.count(), beforeSecond);
    assert.equal(again.created, applied.created);

    const found = await matchPublicCatalogDemand("shoes");
    assert.ok(found.some((product) => product.id === orphanCatalog.id));
    assert.ok(found.every((product) => product.status === "APPROVED"));

    const mock = new MockWhatsAppProvider();
    setWhatsAppProviderForTests(mock);
    const phone = `+2637${String(stamp).padStart(8, "0").slice(-8)}`;
    phones.push(phone);
    mock.sent.length = 0;
    await handleCustomerWhatsAppMessage({
      providerMessageId: `sync-${stamp}-shoes`,
      from: phone,
      text: "I want shoes"
    });
    const shoesReply = mock.sent.map((message) => message.body).join("\n");
    assert.match(shoesReply, new RegExp(shoeName));
    assert.doesNotMatch(shoesReply, /couldn't identify/i);

    mock.sent.length = 0;
    await handleCustomerWhatsAppMessage({
      providerMessageId: `sync-${stamp}-snacks`,
      from: phone,
      text: "I want snacks"
    });
    const snacksReply = mock.sent.map((message) => message.body).join("\n");
    assert.doesNotMatch(snacksReply, new RegExp(shoeName));

    mock.sent.length = 0;
    await handleCustomerWhatsAppMessage({
      providerMessageId: `sync-${stamp}-mazoe`,
      from: phone,
      text: "Mazoe"
    });
    const mazoeReply = mock.sent.map((message) => message.body).join("\n");
    assert.match(mazoeReply, /mazoe/i);
    assert.doesNotMatch(mazoeReply, /couldn't identify/i);

    console.log("shop catalog sync ok", {
      published: applied.published,
      created: applied.created,
      linked: applied.linked
    });
    void rejectedOffer;
  } finally {
    const customers = phones.length
      ? await prisma.commerceCustomer.findMany({ where: { whatsappPhone: { in: phones } }, select: { id: true } })
      : [];
    const customerIds = customers.map((row) => row.id);
    if (customerIds.length) {
      await prisma.whatsAppConversation.deleteMany({ where: { commerceCustomerId: { in: customerIds } } });
      await prisma.commerceCustomer.deleteMany({ where: { id: { in: customerIds } } });
      await prisma.whatsAppInboundMessage.deleteMany({ where: { phoneNormalized: { in: phones } } });
    }
    if (merchantIds.length) {
      await prisma.product.deleteMany({ where: { merchantId: { in: merchantIds } } });
      await prisma.merchant.deleteMany({ where: { id: { in: merchantIds } } });
    }
    if (catalogIds.length) await prisma.catalogProduct.deleteMany({ where: { id: { in: catalogIds } } });
    await prisma.catalogProduct.deleteMany({ where: { name: { contains: String(stamp) } } });
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
