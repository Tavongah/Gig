/**
 * Static checks for Commerce Admin mobile UX redesign (no DB).
 * Run: npx tsx apps/admin/scripts/test-commerce-admin-mobile-ux.ts
 */
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  displayCategory,
  friendlyCatalogStatus,
  friendlyApiError
} from "../src/commerceAdminUi.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = join(__dirname, "..", "src");

function read(rel: string) {
  const p = join(src, rel);
  assert.ok(existsSync(p), `missing ${rel}`);
  return readFileSync(p, "utf8");
}

assert.equal(friendlyCatalogStatus("APPROVED"), "Approved");
assert.equal(friendlyCatalogStatus("PENDING"), "Pending review");
assert.equal(displayCategory("baking"), "Baking");
assert.equal(displayCategory("Drinks"), "Drinks");
assert.ok(
  friendlyApiError(new Error("Spaces upload failed"), "Couldn't upload this photo. Try another photo.").includes(
    "Couldn't upload"
  )
);

const catalog = read("DutsCatalogPanel.tsx");
assert.ok(catalog.includes("Manage products available across DUTS"));
assert.ok(!catalog.includes("Canonical product information"));
assert.ok(catalog.includes("Advanced"));
assert.ok(catalog.includes("Take photo"));
assert.ok(catalog.includes("Choose photo"));
assert.ok(catalog.includes('capture="environment"'));
assert.ok(catalog.includes("Product saved."));
assert.ok(catalog.includes("Edit product"));

const pilot = read("CommercePilotPanel.tsx");
assert.ok(pilot.includes("Add another product"));
assert.ok(pilot.includes("Search DUTS Catalog"));
assert.ok(pilot.includes("Add to shop"));
assert.ok(pilot.includes("In stock"));
assert.ok(pilot.includes("uploadCatalogImage"));
assert.ok(pilot.includes("Possible match"));

const app = read("App.tsx");
assert.ok(app.includes("Manage shops, products and orders"));
assert.ok(app.includes("Deliveries"));
assert.ok(app.includes("commerce-home-card"));

const css = read("styles.css");
assert.ok(css.includes("product-card"));
assert.ok(css.includes("btn-primary"));
assert.ok(css.includes("@media (max-width: 720px)"));
assert.ok(css.includes("photo-hero"));
assert.ok(css.includes("grid-template-columns: 1fr"));

console.log(JSON.stringify({ ok: true }, null, 2));
