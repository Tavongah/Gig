/**
 * H1 catalog image manifest invariants (no DB, no uploads).
 * Run: npx tsx apps/api/scripts/test-catalog-image-manifest.ts
 */
import assert from "node:assert/strict";
import {
  CATALOG_IMAGE_MANIFEST,
  CATALOG_IMAGE_MANIFEST_SUMMARY
} from "../data/catalog-image-manifest.ts";

assert.equal(CATALOG_IMAGE_MANIFEST_SUMMARY.missingImages, 214);
assert.equal(CATALOG_IMAGE_MANIFEST.length, 214);
assert.equal(new Set(CATALOG_IMAGE_MANIFEST.map((r) => r.catalogProductId)).size, 214);

const strategies = new Set(CATALOG_IMAGE_MANIFEST.map((r) => r.strategy));
assert.ok(strategies.has("BRANDED_EXACT"));
assert.ok(strategies.has("GENERIC_PRODUCT"));
assert.ok(strategies.has("GENERIC_PACKAGED"));
assert.ok(strategies.has("SAME_PRODUCT_DIFFERENT_SIZE"));
assert.ok(strategies.has("NEEDS_HUMAN_REVIEW"));

for (const row of CATALOG_IMAGE_MANIFEST) {
  assert.ok(row.catalogProductId);
  assert.ok(row.name);
  assert.ok([1, 2, 3].includes(row.priority));
  if (row.strategy === "BRANDED_EXACT") {
    assert.equal(row.exactPackageRequired, true);
    assert.equal(row.imageReuseSafe, false);
  }
  if (row.sharedImageFamily?.startsWith("branded:")) {
    assert.equal(row.imageReuseSafe, false);
    assert.equal(row.exactPackageRequired, true);
  }
}

const rice = CATALOG_IMAGE_MANIFEST.filter((r) => r.name === "White Rice");
assert.equal(rice.length, 4);
assert.ok(rice.every((r) => r.sharedImageFamily === "generic:white rice"));
assert.ok(rice.every((r) => r.imageReuseSafe === true));

const coke = CATALOG_IMAGE_MANIFEST.filter((r) => r.name === "Coca-Cola");
assert.ok(coke.length >= 3);
assert.ok(coke.every((r) => r.imageReuseSafe === false));
assert.ok(coke.every((r) => r.exactPackageRequired === true));

assert.ok(CATALOG_IMAGE_MANIFEST.some((r) => r.name === "Infant Formula" && r.strategy === "NEEDS_HUMAN_REVIEW"));
assert.ok(CATALOG_IMAGE_MANIFEST_SUMMARY.estimatedUniqueImagesRequired <= 214);
assert.ok(CATALOG_IMAGE_MANIFEST_SUMMARY.recommendedH2BatchSize <= 25);

console.log(
  JSON.stringify(
    {
      ok: true,
      missing: CATALOG_IMAGE_MANIFEST.length,
      unique: CATALOG_IMAGE_MANIFEST_SUMMARY.estimatedUniqueImagesRequired
    },
    null,
    2
  )
);
