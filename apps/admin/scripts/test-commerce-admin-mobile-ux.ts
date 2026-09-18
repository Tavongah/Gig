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
  friendlyApiError(new Error("The specified bucket does not exist"), "Photo couldn't be uploaded. Please try again.").includes(
    "Photo couldn't be uploaded"
  )
);
assert.ok(
  friendlyApiError(new Error("Please choose a photo."), "Photo couldn't be uploaded. Please try again.") ===
    "Please choose a photo."
);

const catalog = read("DutsCatalogPanel.tsx");
assert.ok(catalog.includes("Manage products available across DUTS"));
assert.ok(!catalog.includes("Canonical product information"));
assert.ok(catalog.includes("Advanced"));
assert.ok(catalog.includes("Try again"));
assert.ok(catalog.includes("Photo couldn't be uploaded. Please try again."));
assert.ok(catalog.includes("pendingPhotoRef"));
assert.ok(catalog.includes("Choose photo"));
assert.ok(catalog.includes('accept="image/*"'));
assert.ok(catalog.includes('capture="environment"'));
assert.ok(catalog.includes("Photo selected ✓"));
assert.ok(!catalog.includes("image/jpeg,image/png,image/webp,image/gif"));
assert.ok(catalog.includes("Product saved."));
assert.ok(catalog.includes("Edit product"));
assert.ok(catalog.includes("Change photo"));
assert.ok(catalog.includes("PhotoHero"));
assert.ok(!catalog.includes("Product Family"));
assert.ok(!catalog.includes("flavor selector"));

const thumb = read("ProductThumb.tsx");
assert.ok(thumb.includes("onError"));
assert.ok(thumb.includes("product-thumb-placeholder"));
assert.ok(thumb.includes("PhotoHero"));

const ui = read("commerceAdminUi.ts");
assert.ok(ui.includes("readAsDataURL"));
assert.ok(ui.includes("image/jpg"));

const pilot = read("CommercePilotPanel.tsx");
assert.ok(pilot.includes("Add another product"));
assert.ok(pilot.includes("Search DUTS Catalog"));
assert.ok(pilot.includes("Add to shop"));
assert.ok(pilot.includes("In stock"));
assert.ok(pilot.includes("uploadCatalogImage"));
assert.ok(pilot.includes("Try again"));
assert.ok(pilot.includes("Photo couldn't be uploaded. Please try again."));
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
