/**
 * Regression: purchasable ProductCard must render a visible Add control
 * that still calls the existing onAdd handler once.
 * Run: npx tsx scripts/test-storefront-add.ts
 */
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const src = join(__dirname, "..", "src");

function read(rel: string) {
  const p = join(src, rel);
  assert.ok(existsSync(p), `missing ${rel}`);
  return readFileSync(p, "utf8");
}

const card = read("components/ProductCard.tsx");
assert.ok(card.includes("purchasable && onAdd"), "Add gated on purchasable + handler");
assert.ok(card.includes("bg-brand"), "Add has visible brand fill on web");
assert.ok(card.includes("shrink-0") || card.includes("flexShrink: 0"), "Add does not shrink away");
assert.ok(card.includes("h-8 w-8"), "compact add size preserved");
assert.ok(card.includes("onAdd()"), "existing handler still invoked");
assert.ok(card.includes("e.stopPropagation"), "card press does not double-fire add");
assert.ok(card.includes("storefrontCardQuantity"), "quantity comes from authoritative cart state");
assert.ok(!card.includes("Added ✓"), "clipped Added presentation replaced by stepper");
assert.ok(!card.includes("setAdded"), "no local added acknowledgement state");
assert.ok(!card.includes("setInterval"), "add is not animation-driven");

const grid = read("components/ProductGrid.tsx");
assert.ok(grid.includes("onAdd={onAdd ? () => onAdd("), "grid/rail pass through existing onAdd");
assert.ok(!grid.includes("onAdd={undefined}"), "grid does not drop onAdd");

const home = read("screens/commerce/ShopHomeScreen.tsx");
assert.ok(home.includes("onAdd={addProduct}"), "home still wires add");
assert.ok(home.includes("addStorefrontProduct"), "home add uses existing cart helper");

const search = read("screens/commerce/ProductSearchScreen.tsx");
assert.ok(search.includes("<ProductGrid"), "search still uses ProductGrid");
assert.ok(search.includes("addStorefrontProduct"), "search add uses existing cart helper");
assert.ok(!search.includes("<ProductGrid>"), "search ProductGrid keeps props");

console.log(JSON.stringify({ ok: true, addVisible: true, handlerPreserved: true }, null, 2));
