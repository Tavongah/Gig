/**
 * Storefront catalog-browsing helpers (no DB unless DATABASE_URL is set).
 * Run: npx tsx scripts/test-storefront-catalog-browse.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  STOREFRONT_CATALOG_PAGE_SIZE,
  STOREFRONT_SHOW_APPROVED_CATALOG_WITHOUT_OFFERS,
  UNRESOLVED_LEGACY_CATALOG_PRODUCT_IDS,
  isPublicStorefrontCatalogProduct
} from "@gigflow/shared";
import {
  catalogOnlyAcc,
  clampStorefrontPage,
  compareStorefrontRows,
  matchesStorefrontCategory,
  paginateStorefront,
  presentStorefrontCard,
  scoreStorefrontSearch,
  type StorefrontAcc
} from "../src/modules/commerce/storefront-catalog.js";

const here = fileURLToPath(new URL(".", import.meta.url));
const skipped: string[] = [];

assert.equal(STOREFRONT_SHOW_APPROVED_CATALOG_WITHOUT_OFFERS, true);
assert.equal(STOREFRONT_CATALOG_PAGE_SIZE, 24);
assert.equal(clampStorefrontPage(999, -4).limit, 48);
assert.equal(clampStorefrontPage(undefined, undefined).offset, 0);

assert.equal(isPublicStorefrontCatalogProduct({ id: "ok", status: "APPROVED" }), true);
assert.equal(isPublicStorefrontCatalogProduct({ id: "ok", status: "PENDING" }), false);
assert.equal(isPublicStorefrontCatalogProduct({ id: "ok", status: "REJECTED" }), false);
assert.equal(isPublicStorefrontCatalogProduct({ id: "ok", status: "ARCHIVED" }), false);
for (const id of UNRESOLVED_LEGACY_CATALOG_PRODUCT_IDS) {
  assert.equal(isPublicStorefrontCatalogProduct({ id, status: "APPROVED" }), false);
}

assert.equal(matchesStorefrontCategory("Soft Drinks", "soft"), true);
assert.equal(matchesStorefrontCategory("Household", "drinks"), false);

assert.ok(scoreStorefrontSearch({
  name: "Mazoe Orange Crush",
  brand: "Mazoe",
  sizeLabel: "2L",
  category: "Drinks",
  terms: ["mazoe"]
}) > 0);
assert.equal(scoreStorefrontSearch({
  name: "Surf",
  brand: "Surf",
  sizeLabel: "500g",
  category: "Household",
  terms: ["mazoe"]
}), 0);

const catalogOnly = catalogOnlyAcc({
  id: "11111111-1111-1111-1111-111111111111",
  name: "Mazoe Raspberry",
  brand: "Mazoe",
  sizeLabel: "2L",
  category: "Drinks",
  description: "Crush",
  primaryImageUrl: "https://cdn.example/mazoe.jpg",
  terms: []
});
assert.ok(catalogOnly);
const presented = presentStorefrontCard(catalogOnly);
assert.equal(presented.purchasable, false);
assert.equal(presented.productId, null);
assert.equal(presented.fromPriceCents, null);
assert.equal(presented.merchantOfferCount, 0);
assert.equal(presented.offerCount, 0);
assert.ok(!JSON.stringify(presented).includes("$0"));
assert.equal(presented.fromPriceCents === 0, false);

const withOffer = presentStorefrontCard({
  ...catalogOnly,
  productId: "22222222-2222-2222-2222-222222222222",
  fromPriceCents: 250,
  currency: "usd",
  merchantOfferCount: 1,
  purchasable: true
});
assert.equal(withOffer.purchasable, true);
assert.equal(withOffer.productId, "22222222-2222-2222-2222-222222222222");
assert.equal(withOffer.fromPriceCents, 250);

const alcoholOffer = presentStorefrontCard({
  ...catalogOnly,
  category: "Alcohol",
  productId: "44444444-4444-4444-4444-444444444444",
  fromPriceCents: 999,
  currency: "usd",
  merchantOfferCount: 1,
  purchasable: true
});
assert.equal(alcoholOffer.purchasable, false);
assert.equal(alcoholOffer.productId, null);
assert.equal(alcoholOffer.fromPriceCents, null);

const sibling = catalogOnlyAcc({
  id: "33333333-3333-3333-3333-333333333333",
  name: "Mazoe Raspberry",
  brand: "Mazoe",
  sizeLabel: "5L",
  category: "Drinks",
  description: null,
  primaryImageUrl: null,
  terms: []
})!;
assert.equal(sibling.purchasable, false);
assert.notEqual(withOffer.productId, sibling.catalogProductId);

const page = paginateStorefront(
  [
    sibling,
    catalogOnly,
    {
      ...catalogOnly,
      catalogProductId: "44444444-4444-4444-4444-444444444444",
      name: "AAA No Image",
      imageUrl: null,
      score: 1
    }
  ],
  2,
  0
);
assert.equal(page.products.length, 2);
assert.equal(page.hasMore, true);
assert.equal(page.products[0]!.imageUrl != null, true);

const sorted = [sibling, catalogOnly].sort(compareStorefrontRows);
assert.equal(sorted[0]!.imageUrl != null, true);

{
  const routes = readFileSync(resolve(here, "../src/modules/commerce/customer-commerce.routes.ts"), "utf8");
  assert.ok(routes.includes("optionalGeoQuery"), "catalog browse geo is optional");
  assert.ok(routes.includes("offset"), "pagination offset accepted");
  assert.ok(routes.includes('customerCommerceRouter.post("/cart/quote"'), "quote unchanged");
  assert.ok(routes.includes("productId: z.string().uuid()"), "cart still requires Product UUID");
  assert.ok(!routes.includes("catalogProductId: z.string().uuid()"), "cart must not accept CatalogProduct IDs");
}

{
  const service = readFileSync(resolve(here, "../src/modules/commerce/customer-commerce.service.ts"), "utf8");
  assert.ok(service.includes("STOREFRONT_SHOW_APPROVED_CATALOG_WITHOUT_OFFERS"), "policy flag used");
  assert.ok(service.includes('status: "APPROVED"'), "public catalog is APPROVED only");
  assert.ok(!service.includes("fake"), "no fake offers");
}

{
  const quote = readFileSync(resolve(here, "../src/modules/commerce/customer-commerce.service.ts"), "utf8");
  assert.ok(quote.includes("prisma.product.findMany"), "quote looks up merchant Product rows");
  assert.ok(quote.includes("lines: Array<{ productId: string; quantity: number }>"), "quote lines are Product IDs");
}

{
  const wa = readFileSync(resolve(here, "../src/modules/commerce/merchant.service.ts"), "utf8");
  assert.ok(wa.includes("searchProductsNear"), "WhatsApp nearby search unchanged");
}

async function maybeDb() {
  if (!process.env.DATABASE_URL) {
    skipped.push("DATABASE_URL");
    return;
  }
  const { browseNearbyProducts, getProductDetailNear, listBrowseCategories } = await import(
    "../src/modules/commerce/customer-commerce.service.js"
  );
  const { prisma } = await import("../src/config/prisma.js");

  const page1 = await browseNearbyProducts({ limit: 24, offset: 0 });
  assert.ok(page1.products.length > 2, "catalog browse returns approved products without geo");
  assert.ok(page1.products.length <= 24, "page size capped");
  assert.equal(
    page1.products.every((p) => p.purchasable === Boolean(p.productId && p.fromPriceCents != null && p.merchantOfferCount > 0)),
    true
  );
  assert.equal(
    page1.products.filter((p) => !p.purchasable).every((p) => p.fromPriceCents === null && p.productId === null),
    true,
    "catalog-only rows have no price and no productId"
  );

  const pending = await prisma.catalogProduct.findMany({ where: { status: "PENDING" }, take: 3, select: { id: true } });
  const publicIds = new Set(page1.products.map((p) => p.catalogProductId));
  for (const row of pending) assert.equal(publicIds.has(row.id), false);

  const rejected = await prisma.catalogProduct.findMany({ where: { status: "REJECTED" }, take: 3, select: { id: true } });
  for (const row of rejected) assert.equal(publicIds.has(row.id), false);

  const archived = await prisma.catalogProduct.findMany({ where: { status: "ARCHIVED" }, take: 3, select: { id: true } });
  for (const row of archived) assert.equal(publicIds.has(row.id), false);

  for (const id of UNRESOLVED_LEGACY_CATALOG_PRODUCT_IDS) {
    assert.equal(publicIds.has(id), false);
  }

  const mazoe = await browseNearbyProducts({ q: "Mazoe", limit: 24, offset: 0 });
  assert.ok(mazoe.products.some((p) => /mazoe/i.test(p.name) || /mazoe/i.test(p.brand ?? "")), "search uses full catalog");

  const cats = await listBrowseCategories();
  assert.ok(cats.categories.length >= 2, "categories from approved catalog");

  const catalogOnlyRow = page1.products.find((p) => !p.purchasable && p.catalogProductId);
  if (catalogOnlyRow?.catalogProductId) {
    const detail = await getProductDetailNear({ catalogProductId: catalogOnlyRow.catalogProductId });
    assert.equal(detail.purchasable, false);
    assert.equal(detail.offers.length, 0);
    assert.equal(detail.fromPriceCents, null);
  }

  if (pending[0]) {
    await assert.rejects(
      () => getProductDetailNear({ catalogProductId: pending[0]!.id }),
      /not found/i
    );
  }

  const merchantCount = await prisma.product.count();
  const orderCount = await prisma.commerceOrder.count();
  assert.ok(merchantCount >= 0);
  assert.ok(orderCount >= 0);

  await prisma.$disconnect();
}

await maybeDb();

console.log(JSON.stringify({ ok: true, skipped }, null, 2));
