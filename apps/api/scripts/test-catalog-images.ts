/**
 * Catalog image URL/MIME helpers (no DB).
 * Run: npx tsx apps/api/scripts/test-catalog-images.ts
 */
import assert from "node:assert/strict";
import { createCatalogProductSchema } from "@gigflow/shared";
import {
  browserAccessibleMediaUrl,
  detectImageContentType,
  isHeicLike,
  normalizeImageContentType
} from "../src/lib/catalog-media.js";

import { AppError, mapErrorToResponse, PHOTO_UPLOAD_FAILED } from "../src/lib/errors.js";

const cdn =
  "https://gigflow-uploads.nyc3.cdn.digitaloceanspaces.com/products/catalog/u/1-mazoe.jpg";
const origin =
  "https://gigflow-uploads.nyc3.digitaloceanspaces.com/products/catalog/u/1-mazoe.jpg";

assert.equal(browserAccessibleMediaUrl(cdn), origin);
assert.equal(browserAccessibleMediaUrl(origin), origin);
assert.equal(browserAccessibleMediaUrl(null), null);
assert.equal(browserAccessibleMediaUrl("https://cdn.example.com/x.png"), "https://cdn.example.com/x.png");

assert.equal(normalizeImageContentType("image/jpg"), "image/jpeg");
assert.equal(normalizeImageContentType("image/pjpeg"), "image/jpeg");
assert.equal(normalizeImageContentType("image/png"), "image/png");

const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
assert.equal(detectImageContentType(jpeg), "image/jpeg");
assert.equal(isHeicLike(jpeg), false);

const heic = Buffer.alloc(12);
heic.write("xxxxftypheic", 0, "ascii");
assert.equal(isHeicLike(heic), true);

const parsed = createCatalogProductSchema.parse({
  name: "Mazoe Orange Crush",
  brand: "Mazoe",
  category: "Drinks",
  sizeLabel: "2L",
  primaryImageUrl: origin
});
assert.equal(parsed.primaryImageUrl, origin);

const raspberry = createCatalogProductSchema.parse({
  name: "Mazoe Raspberry",
  brand: "Mazoe",
  category: "Drinks",
  sizeLabel: "2L",
  primaryImageUrl: origin
});
assert.equal(raspberry.name, "Mazoe Raspberry");

{
  const mapped = mapErrorToResponse(Object.assign(new Error("The specified bucket does not exist"), { name: "NoSuchBucket", Code: "NoSuchBucket" }));
  assert.equal(mapped.status, 503);
  assert.equal(mapped.body.error, "Photo couldn't be uploaded. Please try again.");
  assert.doesNotMatch(mapped.body.error, /bucket/i);
}

{
  const mapped = mapErrorToResponse(new AppError(PHOTO_UPLOAD_FAILED, 503, "STORAGE_NOT_CONFIGURED"));
  assert.equal(mapped.body.error, "Photo couldn't be uploaded. Please try again.");
  const notFound = mapErrorToResponse(new Error("NOT_FOUND"));
  assert.equal(notFound.status, 404);
  assert.equal(notFound.body.error, "NOT_FOUND");
}

console.log(JSON.stringify({ ok: true }, null, 2));
