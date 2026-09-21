/**
 * Phase G2 master-catalog visibility (no production writes).
 * Run: npx tsx apps/api/scripts/test-admin-catalog-visibility.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ADMIN_CATALOG_LIST_LIMIT,
  CATALOG_PRODUCT_SCAN_LIMIT,
  MERCHANT_CATALOG_SEARCH_LIMIT_MAX,
  UNRESOLVED_LEGACY_CATALOG_PRODUCT_IDS,
  expandSearchTerms,
  isUnresolvedLegacyCatalogProduct,
  searchCatalogProductsSchema
} from "@gigflow/shared";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const adminSrc = join(root, "..", "admin", "src");

function read(rel: string) {
  return readFileSync(join(root, rel), "utf8");
}

function readAdmin(rel: string) {
  return readFileSync(join(adminSrc, rel), "utf8");
}

assert.equal(CATALOG_PRODUCT_SCAN_LIMIT, 1000);
assert.equal(ADMIN_CATALOG_LIST_LIMIT, 1000);
assert.equal(MERCHANT_CATALOG_SEARCH_LIMIT_MAX, 100);
assert.ok(ADMIN_CATALOG_LIST_LIMIT >= 281);
assert.equal(UNRESOLVED_LEGACY_CATALOG_PRODUCT_IDS.length, 2);
assert.equal(isUnresolvedLegacyCatalogProduct("cd5ff8f9-14ea-4193-88a2-85d97114ea26"), true);
assert.equal(isUnresolvedLegacyCatalogProduct("4eb36208-3c3d-4fbc-b856-c62767a7093e"), true);
assert.equal(isUnresolvedLegacyCatalogProduct("50da102e-a66e-4f9f-be02-df2d9fe3d569"), false);

const admin1000 = searchCatalogProductsSchema.parse({ adminList: true, limit: 1000, view: "canonical" });
assert.equal(admin1000.limit, 1000);
assert.equal(admin1000.view, "canonical");

const over100 = searchCatalogProductsSchema.safeParse({ adminList: true, limit: 150 });
assert.equal(over100.success, true);

const merchantTooHigh = searchCatalogProductsSchema.safeParse({ limit: 1000 });
assert.equal(merchantTooHigh.success, false);

const merchantOk = searchCatalogProductsSchema.parse({ limit: 30 });
assert.equal(merchantOk.limit, 30);
assert.equal(merchantOk.adminList, false);

const terms = expandSearchTerms("matemba");
assert.ok(terms.includes("kapenta"), "matemba should expand to kapenta");
assert.ok(expandSearchTerms("rice").includes("rice"));
assert.ok(expandSearchTerms("surf").some((t) => t.includes("surf") || t === "surf"));

const service = read("src/modules/commerce/catalog.service.ts");
assert.match(service, /ADMIN_CATALOG_LIST_LIMIT/);
assert.match(service, /view === "canonical"/);
assert.match(service, /status:\s*"ARCHIVED"/);
assert.match(service, /notIn:\s*unresolvedLegacyIds/);
assert.match(service, /canonical:\s*Math\.max\(0,\s*approved - unresolvedApproved\)/);
assert.doesNotMatch(service, /primaryImageUrl:\s*\{\s*not:\s*null/);
assert.doesNotMatch(service, /primaryImageUrl:\s*\{\s*not: null/);
assert.match(service, /take:\s*CATALOG_PRODUCT_SCAN_LIMIT/);
assert.doesNotMatch(service, /take:\s*50\b/);

const routes = read("src/modules/commerce/catalog.routes.ts");
assert.match(routes, /ADMIN_CATALOG_LIST_LIMIT/);
assert.match(routes, /view \?\? \(status \? undefined : "canonical"\)/);
assert.match(routes, /adminList:\s*true/);
assert.match(routes, /MERCHANT_CATALOG_SEARCH_LIMIT_MAX/);
assert.doesNotMatch(routes, /limit:\s*50\b/);

const panel = readAdmin("DutsCatalogPanel.tsx");
assert.match(panel, /params\.set\("limit", "1000"\)/);
assert.doesNotMatch(panel, /params\.set\("limit", "50"\)/);
assert.match(panel, /canonical products/);
assert.match(panel, /All Categories/);
assert.match(panel, /No image/);
assert.match(panel, /id: "canonical"/);
assert.match(panel, /catalogRowMatchesQuery/);
assert.match(panel, /visibleProducts\.map/);
assert.doesNotMatch(panel, /\.slice\(0,\s*50\)/);
assert.doesNotMatch(panel, /\.slice\(0,\s*100\)/);
assert.match(panel, /if \(categoryFilter && p\.category !== categoryFilter\) return false/);
assert.doesNotMatch(panel, /if \(p\.primaryImageUrl\)/);

const whatsapp = read("src/modules/whatsapp/customer-handler.ts");
assert.match(whatsapp, /sorted\.slice\(0,\s*5\)/);
assert.match(whatsapp, /matches\.slice\(0,\s*12\)/);
assert.doesNotMatch(whatsapp, /ADMIN_CATALOG_LIST_LIMIT/);
assert.doesNotMatch(whatsapp, /CATALOG_PRODUCT_SCAN_LIMIT/);

const customer = read("src/modules/commerce/customer-commerce.service.ts");
assert.match(customer, /clampStorefrontPage/);
assert.match(customer, /STOREFRONT_SHOW_APPROVED_CATALOG_WITHOUT_OFFERS/);
assert.match(customer, /take:\s*500/);
assert.doesNotMatch(customer, /ADMIN_CATALOG_LIST_LIMIT/);

const merchantPanel = readAdmin("CommercePilotPanel.tsx");
assert.match(merchantPanel, /limit=20/);

console.log(
  JSON.stringify(
    {
      ok: true,
      ADMIN_CATALOG_LIST_LIMIT,
      CATALOG_PRODUCT_SCAN_LIMIT,
      MERCHANT_CATALOG_SEARCH_LIMIT_MAX,
      UNRESOLVED: UNRESOLVED_LEGACY_CATALOG_PRODUCT_IDS.length
    },
    null,
    2
  )
);
