/**
 * Static checks for H4 Product Image Queue mobile capture UX.
 * Run: npx tsx apps/admin/scripts/test-catalog-image-queue-ux.ts
 */
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const src = join(dirname(fileURLToPath(import.meta.url)), "..", "src");

function read(rel: string) {
  const p = join(src, rel);
  assert.ok(existsSync(p), `missing ${rel}`);
  return readFileSync(p, "utf8");
}

const queue = read("CatalogImageQueuePanel.tsx");
assert.match(queue, /Product Image Queue/);
assert.match(queue, /Take photo/);
assert.match(queue, /Choose from library/);
assert.match(queue, /capture="environment"/);
assert.match(queue, /accept="image\/\*"/);
assert.match(queue, /Confirm and assign this product only/);
assert.match(queue, /Retake \/ Upload another photo/);
assert.match(queue, /Photograph one product only/);
assert.match(queue, /Do not use screenshots or downloaded internet images/);
assert.match(queue, /Brand matches/);
assert.match(queue, /Size matches/);
assert.match(queue, /Zimbabwe market/);
assert.match(queue, /IMAGE_ALREADY_EXISTS/);
assert.match(queue, /uploadImageQueueCandidate/);
assert.doesNotMatch(queue, /primaryImageUrl:\s*uploaded\.url/);
assert.match(queue, /PACK_A_BEVERAGES/);
assert.match(queue, /Priority A/);
assert.match(queue, /Generic Exceptions/);
assert.match(queue, /Legacy Image Review/);

const catalog = read("DutsCatalogPanel.tsx");
assert.match(catalog, /Image Queue/);
assert.match(catalog, /CatalogImageQueuePanel/);

const ui = read("commerceAdminUi.ts");
assert.match(ui, /uploadImageQueueCandidate/);
assert.match(ui, /image-queue\/\$\{acquisitionId\}\/candidate/);

const css = read("styles.css");
assert.match(css, /\.iq-packs/);
assert.match(css, /\.iq-compare/);

console.log(JSON.stringify({ ok: true, mobileCameraUpload: "PASS" }, null, 2));
