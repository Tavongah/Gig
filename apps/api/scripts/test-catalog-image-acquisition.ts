/**
 * H4 branded image acquisition workflow (no production writes).
 * Run: npx tsx apps/api/scripts/test-catalog-image-acquisition.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assignCatalogImageAcquisitionSchema,
  listCatalogImageQueueSchema,
  rejectCatalogImageAcquisitionSchema
} from "@gigflow/shared";
import {
  BRANDED_ACQUISITION_PLAN,
  GENERIC_EXCEPTION_PLAN,
  LEGACY_REVIEW_PLAN,
  filterAcquisitionQueue,
  identityMatchesPlan,
  packProgressFromRows,
  sortAcquisitionQueue,
  type FilterableAcquisition
} from "../src/modules/commerce/catalog-image-acquisition.plan.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const adminSrc = join(root, "..", "admin", "src");

function readAdmin(rel: string) {
  return readFileSync(join(adminSrc, rel), "utf8");
}

assert.equal(BRANDED_ACQUISITION_PLAN.length, 48);
assert.equal(GENERIC_EXCEPTION_PLAN.length, 8);
assert.equal(LEGACY_REVIEW_PLAN.length, 8);
assert.equal(new Set(BRANDED_ACQUISITION_PLAN.map((r) => r.catalogProductId)).size, 48);
assert.equal(
  BRANDED_ACQUISITION_PLAN.filter((r) => r.acquisitionPriority === "BRANDED_PRIORITY_A").length,
  25
);
assert.equal(
  BRANDED_ACQUISITION_PLAN.filter((r) => r.acquisitionPriority === "BRANDED_PRIORITY_B").length,
  16
);
assert.equal(
  BRANDED_ACQUISITION_PLAN.filter((r) => r.acquisitionPriority === "BRANDED_PRIORITY_C").length,
  7
);
assert.equal(
  BRANDED_ACQUISITION_PLAN.filter((r) => r.acquisitionPack === "PACK_A_BEVERAGES").length,
  23
);
assert.equal(
  BRANDED_ACQUISITION_PLAN.filter((r) => r.acquisitionPack === "PACK_B_HOUSEHOLD").length,
  8
);
assert.equal(
  BRANDED_ACQUISITION_PLAN.filter((r) => r.acquisitionPack === "PACK_C_SNACKS").length,
  7
);
assert.equal(
  BRANDED_ACQUISITION_PLAN.filter((r) => r.acquisitionPack === "PACK_D_BREAKFAST").length,
  7
);
assert.equal(
  BRANDED_ACQUISITION_PLAN.filter((r) => r.acquisitionPack === "PACK_E_PERSONAL_CARE").length,
  3
);
assert.equal(BRANDED_ACQUISITION_PLAN.filter((r) => r.brandMetadataReview).length, 6);
assert.ok(LEGACY_REVIEW_PLAN.some((r) => r.plannedName === "Instant Noodles"));

const rows: FilterableAcquisition[] = [
  ...BRANDED_ACQUISITION_PLAN.map((r) => ({
    catalogProductId: r.catalogProductId,
    queueKind: r.queueKind,
    exceptionQueue: r.exceptionQueue,
    plannedName: r.plannedName,
    plannedBrand: r.plannedBrand,
    plannedSizeLabel: r.plannedSizeLabel,
    plannedCategory: r.plannedCategory,
    brandFamily: r.brandFamily,
    likelyBrand: r.likelyBrand,
    acquisitionPack: r.acquisitionPack,
    acquisitionPriority: r.acquisitionPriority,
    status: "NEEDS_IMAGE_ACQUISITION",
    hasLiveImage: false
  })),
  ...GENERIC_EXCEPTION_PLAN.map((r) => ({
    catalogProductId: r.catalogProductId,
    queueKind: r.queueKind,
    exceptionQueue: r.exceptionQueue,
    plannedName: r.plannedName,
    plannedBrand: r.plannedBrand,
    plannedSizeLabel: r.plannedSizeLabel,
    plannedCategory: r.plannedCategory,
    brandFamily: r.brandFamily,
    likelyBrand: r.likelyBrand,
    acquisitionPack: r.acquisitionPack,
    acquisitionPriority: r.acquisitionPriority,
    status: "NEEDS_IMAGE_ACQUISITION",
    hasLiveImage: false
  }))
];

const branded = filterAcquisitionQueue(rows, { tab: "branded" });
assert.equal(branded.length, 48);
assert.equal(filterAcquisitionQueue(rows, { tab: "exceptions" }).length, 8);
assert.equal(filterAcquisitionQueue(rows, { tab: "human-review" }).length, 2);
assert.equal(filterAcquisitionQueue(rows, { tab: "all-missing" }).length, 56);
assert.equal(filterAcquisitionQueue(rows, { tab: "completed" }).length, 0);
assert.equal(
  filterAcquisitionQueue(rows, { tab: "branded", priority: "BRANDED_PRIORITY_A" }).length,
  25
);
assert.equal(
  filterAcquisitionQueue(rows, { tab: "branded", pack: "PACK_A_BEVERAGES" }).length,
  23
);
assert.ok(filterAcquisitionQueue(rows, { tab: "branded", q: "Coca-Cola" }).length >= 5);
assert.ok(filterAcquisitionQueue(rows, { tab: "branded", q: "Mazoe" }).length === 3);
assert.ok(filterAcquisitionQueue(rows, { tab: "branded", q: "500ml" }).length >= 5);
assert.ok(filterAcquisitionQueue(rows, { tab: "branded", q: "Surf" }).length === 2);
assert.ok(filterAcquisitionQueue(rows, { tab: "branded", q: "Biscuits" }).length >= 3);

const sorted = sortAcquisitionQueue(branded);
assert.equal(sorted[0].acquisitionPriority, "BRANDED_PRIORITY_A");

const packs = packProgressFromRows(rows);
assert.deepEqual(
  packs.map((p) => [p.pack, p.total, p.complete]),
  [
    ["PACK_A_BEVERAGES", 23, 0],
    ["PACK_B_HOUSEHOLD", 8, 0],
    ["PACK_C_SNACKS", 7, 0],
    ["PACK_D_BREAKFAST", 7, 0],
    ["PACK_E_PERSONAL_CARE", 3, 0]
  ]
);

const cokeFamily = BRANDED_ACQUISITION_PLAN.filter((r) => r.brandFamily === "Coca-Cola");
assert.equal(cokeFamily.length, 4);
assert.equal(new Set(cokeFamily.map((r) => r.catalogProductId)).size, 4);

function assignOnlyTarget(familyIds: string[], targetId: string, assigned: Set<string>) {
  assigned.add(targetId);
  return familyIds.filter((id) => assigned.has(id));
}
const assigned = new Set<string>();
const cokeIds = cokeFamily.map((r) => r.catalogProductId);
const after500 = assignOnlyTarget(cokeIds, cokeIds[3]!, assigned);
assert.equal(after500.length, 1);
assert.ok(!cokeIds.slice(0, 3).some((id) => assigned.has(id)));

assert.equal(
  identityMatchesPlan(
    { name: "Coca-Cola", brand: "Coca-Cola", sizeLabel: "500ml" },
    { plannedName: "Coca-Cola", plannedSizeLabel: "500ml", brandMetadataReview: false }
  ),
  true
);
assert.equal(
  identityMatchesPlan(
    { name: "Coca-Cola", brand: "Coca-Cola", sizeLabel: "2L" },
    { plannedName: "Coca-Cola", plannedSizeLabel: "500ml", brandMetadataReview: false }
  ),
  false
);

const reject = rejectCatalogImageAcquisitionSchema.parse({ reason: "WRONG_SIZE" });
assert.equal(reject.reason, "WRONG_SIZE");
const list = listCatalogImageQueueSchema.parse({ tab: "branded", q: "Surf" });
assert.equal(list.tab, "branded");
const badAssign = assignCatalogImageAcquisitionSchema.safeParse({
  catalogProductId: BRANDED_ACQUISITION_PLAN[0]!.catalogProductId,
  sourceType: "MERCHANT_SUPPLIED_PHOTO",
  checks: {
    brandMatches: true,
    productMatches: true,
    sizeMatches: false,
    flavorMatches: true,
    packageTypeMatches: true,
    imageClear: true,
    noWatermark: true,
    noPriceOverlay: true
  }
});
assert.equal(badAssign.success, false);

const routes = readFileSync(join(root, "src/modules/commerce/catalog.routes.ts"), "utf8");
assert.match(routes, /requireAuth, requireRole\(UserRole.ADMIN\)/);
assert.match(routes, /\/catalog\/image-queue/);
assert.match(routes, /\/catalog\/image-queue\/:id\/assign/);
assert.doesNotMatch(routes, /app\.get\("\/v1\/catalog\/image-queue"/);
assert.match(routes, /persistNormalizedCatalogPhoto/);

const service = readFileSync(
  join(root, "src/modules/commerce/catalog-image-acquisition.service.ts"),
  "utf8"
);
assert.match(service, /IMAGE_ALREADY_EXISTS/);
assert.match(service, /VALIDATION_REQUIRED/);
assert.match(service, /updateCatalogProduct\(row\.catalogProductId/);
assert.doesNotMatch(service, /prisma\.product\.update/);
assert.doesNotMatch(service, /CommerceOrder/);
assert.match(service, /role: "REJECTED"/);
assert.match(service, /role: "CANDIDATE"/);
assert.match(service, /brandFamily/);
assert.doesNotMatch(service, /updateMany\(\s*\{\s*where:\s*\{\s*brandFamily/);

const panel = readAdmin("CatalogImageQueuePanel.tsx");
assert.match(panel, /capture="environment"/);
assert.match(panel, /accept="image\/\*"/);
assert.match(panel, /Take photo/);
assert.match(panel, /Choose from library/);
assert.match(panel, /Confirm and assign this product only/);
assert.match(panel, /Zimbabwe market/);
assert.match(panel, /IMAGE_ALREADY_EXISTS/);
assert.match(panel, /BRAND METADATA REVIEW/);
assert.match(panel, /Do not use screenshots/);

const catalogPanel = readAdmin("DutsCatalogPanel.tsx");
assert.match(catalogPanel, /Image Queue/);
assert.match(catalogPanel, /CatalogImageQueuePanel/);
assert.match(catalogPanel, /canonical products/);

console.log(
  JSON.stringify(
    {
      ok: true,
      branded: BRANDED_ACQUISITION_PLAN.length,
      exceptions: GENERIC_EXCEPTION_PLAN.length,
      legacy: LEGACY_REVIEW_PLAN.length,
      priorityA: 25,
      packs: packs.map((p) => `${p.label} ${p.complete}/${p.total}`)
    },
    null,
    2
  )
);
