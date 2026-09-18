/**
 * Offline catalog helpers (no DB).
 * Run: npx tsx apps/api/scripts/test-catalog-helpers.ts
 */
import assert from "node:assert/strict";
import {
  catalogSearchHaystack,
  createCatalogProductSchema,
  expandSearchTerms,
  normalizeBarcode,
  searchCatalogProductsSchema,
  submitMerchantCatalogProductSchema,
  ADMIN_CATALOG_LIST_LIMIT
} from "@gigflow/shared";

assert.equal(normalizeBarcode(null), null);
assert.equal(normalizeBarcode("abc"), null);
assert.equal(normalizeBarcode("12345678"), "12345678");
assert.equal(normalizeBarcode(" 12-3456-789012 "), "123456789012");

const hay = catalogSearchHaystack({
  name: "Mazoe Orange Crush 2L",
  brand: "Mazoe",
  sizeLabel: "2L",
  category: "Drinks"
});
assert.ok(hay.includes("mazoe"));
assert.ok(hay.includes("2l"));

const ok = createCatalogProductSchema.parse({
  name: "Coca-Cola 500ml",
  category: "Drinks",
  sizeLabel: "500ml"
});
assert.equal(ok.name, "Coca-Cola 500ml");

assert.throws(() =>
  submitMerchantCatalogProductSchema.parse({
    name: "X",
    category: "Drinks",
    priceCents: 100
  })
);

const withImage = submitMerchantCatalogProductSchema.parse({
  name: "X",
  category: "Drinks",
  primaryImageUrl: "https://cdn.example.com/x.png",
  priceCents: 100
});
assert.equal(withImage.forceCreate, false);

assert.equal(ADMIN_CATALOG_LIST_LIMIT, 1000);
assert.equal(searchCatalogProductsSchema.parse({ adminList: true, limit: 1000 }).limit, 1000);
assert.equal(searchCatalogProductsSchema.safeParse({ limit: 1000 }).success, false);
assert.ok(expandSearchTerms("matemba").includes("kapenta"));

console.log(JSON.stringify({ ok: true }, null, 2));
