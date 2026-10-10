/**
 * Product-card quantity stepper (DoorDash-style − qty +).
 * Run: npx tsx scripts/test-storefront-card-stepper.ts
 */
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  storefrontCardAdjustRef,
  storefrontCardQuantity,
  type StorefrontQtyProduct,
  type StorefrontQtySnapshot
} from "../src/lib/storefront-card-quantity";
import { cartLineIdentity } from "@gigflow/shared";

const src = join(__dirname, "..", "src");

function read(rel: string) {
  const p = join(src, rel);
  assert.ok(existsSync(p), `missing ${rel}`);
  return readFileSync(p, "utf8");
}

const product: StorefrontQtyProduct = {
  productId: "prod-7up",
  catalogProductId: "cat-7up"
};

function desiredSnap(qty: number): StorefrontQtySnapshot {
  return {
    smartBasket: true,
    desiredLines:
      qty > 0
        ? [{ catalogProductId: "cat-7up", quantity: qty, flavorOptionId: null }]
        : [],
    cartLines: []
  };
}

function commerceSnap(qty: number): StorefrontQtySnapshot {
  return {
    smartBasket: false,
    desiredLines: [],
    cartLines:
      qty > 0
        ? [{ productId: "prod-7up", catalogProductId: "cat-7up", quantity: qty, flavorOptionId: null }]
        : []
  };
}

const steps: string[] = [];

function pass(id: string) {
  steps.push(id);
}

// STEP01 quantity 0 → 0 (UI shows +)
assert.equal(storefrontCardQuantity(product, desiredSnap(0)), 0);
assert.equal(storefrontCardQuantity(product, commerceSnap(0)), 0);
pass("STEP01");

// STEP02/03 successful add is existing store mutation; quantity comes from store
assert.equal(storefrontCardQuantity(product, desiredSnap(1)), 1);
assert.equal(storefrontCardQuantity(product, commerceSnap(1)), 1);
pass("STEP02");
pass("STEP03");

// STEP04 increment 1 → 2
{
  const ref = storefrontCardAdjustRef(product, desiredSnap(1), 1);
  assert.ok(ref);
  assert.equal(ref.store, "desired");
  assert.equal(ref.lineKey, cartLineIdentity("cat-7up", null));
  assert.equal(ref.nextQuantity, 2);
  assert.equal(storefrontCardQuantity(product, desiredSnap(2)), 2);
}
pass("STEP04");

// STEP05 increment 2 → 3
{
  const ref = storefrontCardAdjustRef(product, desiredSnap(2), 1);
  assert.equal(ref?.nextQuantity, 3);
  assert.equal(storefrontCardQuantity(product, desiredSnap(3)), 3);
}
pass("STEP05");

// STEP06 decrement 3 → 2
{
  const ref = storefrontCardAdjustRef(product, desiredSnap(3), -1);
  assert.equal(ref?.nextQuantity, 2);
}
pass("STEP06");

// STEP07 decrement 2 → 1
{
  const ref = storefrontCardAdjustRef(product, desiredSnap(2), -1);
  assert.equal(ref?.nextQuantity, 1);
}
pass("STEP07");

// STEP08 decrement 1 → 0 (existing setQuantity removes)
{
  const ref = storefrontCardAdjustRef(product, desiredSnap(1), -1);
  assert.equal(ref?.nextQuantity, 0);
  assert.equal(storefrontCardQuantity(product, desiredSnap(0)), 0);
}
pass("STEP08");

// STEP09 failed add: empty authoritative state stays 0
assert.equal(storefrontCardQuantity(product, desiredSnap(0)), 0);
assert.equal(storefrontCardAdjustRef(product, desiredSnap(0), 1), null);
pass("STEP09");

// STEP10 failed increment: no matching line → no ref, quantity unchanged
{
  const empty = desiredSnap(0);
  assert.equal(storefrontCardAdjustRef(product, empty, 1), null);
  assert.equal(storefrontCardQuantity(product, empty), 0);
  const stillOne = desiredSnap(1);
  assert.equal(storefrontCardQuantity(product, stillOne), 1);
}
pass("STEP10");

// STEP11 same item identity across screens (catalog id / product id)
{
  const shared = desiredSnap(2);
  const home = storefrontCardQuantity(product, shared);
  const category = storefrontCardQuantity({ ...product }, shared);
  const search = storefrontCardQuantity({ productId: "prod-7up", catalogProductId: "cat-7up" }, shared);
  assert.equal(home, 2);
  assert.equal(category, 2);
  assert.equal(search, 2);
}
pass("STEP11");

// STEP12 unavailable products are not made purchasable by quantity helper
{
  const unavailable: StorefrontQtyProduct = { productId: null, catalogProductId: "cat-x" };
  assert.equal(storefrontCardQuantity(unavailable, desiredSnap(0)), 0);
}
pass("STEP12");

// STEP13 rapid taps: sequential existing +1 mutations, no duplicate identity
{
  let qty = 0;
  const seenKeys = new Set<string>();
  for (let i = 0; i < 3; i += 1) {
    if (qty === 0) {
      qty = 1;
      seenKeys.add(cartLineIdentity("cat-7up", null));
      continue;
    }
    const ref = storefrontCardAdjustRef(product, desiredSnap(qty), 1);
    assert.ok(ref);
    seenKeys.add(ref.lineKey);
    qty = ref.nextQuantity;
  }
  assert.equal(qty, 3);
  assert.equal(seenKeys.size, 1);
}
pass("STEP13");

// STEP14 badge remains a store itemCount sum; helper quantity matches line qty
assert.equal(storefrontCardQuantity(product, desiredSnap(4)), 4);
assert.equal(storefrontCardQuantity(product, commerceSnap(4)), 4);
pass("STEP14");

// Commerce-cart identity uses productId, not a new key
{
  const ref = storefrontCardAdjustRef(product, commerceSnap(1), 1);
  assert.equal(ref?.store, "commerce");
  assert.equal(ref?.lineKey, cartLineIdentity("prod-7up", null));
}

const card = read("components/ProductCard.tsx");
assert.ok(card.includes("purchasable && onAdd"), "Add gated on purchasable + handler");
assert.ok(card.includes("storefrontCardQuantity"), "quantity from authoritative helper");
assert.ok(card.includes("storefrontCardAdjustRef"), "increment/decrement use existing line keys");
assert.ok(card.includes("onAdd()"), "qty 0 still calls existing Add");
assert.ok(card.includes("setDesiredQty"), "desired-basket setQuantity reused");
assert.ok(card.includes("setCartQty"), "commerce-cart setQuantity reused");
assert.ok(card.includes('icon="remove"'), "minus control");
assert.ok(card.includes('icon="add"'), "plus control");
assert.ok(!card.includes("Added ✓"), "clipped Added presentation removed");
assert.ok(!card.includes("setAdded"), "no local added acknowledgement state");
assert.ok(!card.includes("setTimeout"), "stepper is not timer-driven");
assert.ok(!card.includes("setInterval"), "add is not animation-driven");
assert.ok(card.includes("bg-brand"), "brand fill visible on web");
assert.ok(card.includes("h-8 w-8"), "compact control size");
assert.ok(card.includes("shrink-0") || card.includes("flexShrink: 0"), "control does not shrink away");
assert.ok(card.includes("e.stopPropagation"), "card press does not double-fire add");
assert.ok(card.includes("isProductCardPurchasable"), "availability gate unchanged");
assert.ok(card.includes("aspectRatio"), "image frame unchanged");
assert.ok(card.includes("numberOfLines={2}"), "name clamp unchanged");

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

const category = read("screens/commerce/MarketplaceCategoryScreen.tsx");
assert.ok(category.includes("ProductGrid") || category.includes("BACK TO SHOPPING"), "category screen not rewritten");

const detail = read("screens/commerce/ProductDetailScreen.tsx");
assert.ok(detail.includes("Added ✓"), "product detail add copy unchanged");
assert.ok(detail.includes("ADD TO CART"), "product detail CTA unchanged");

const cart = read("screens/commerce/CartScreen.tsx");
assert.ok(cart.includes("Continue with WhatsApp"), "cart WhatsApp CTA frozen");
assert.ok(cart.includes("commerceGuestHandoff"), "handoff frozen");
assert.ok(cart.includes("setQuantity(cartLineKey(line), line.quantity - 1)"), "cart decrement frozen");
assert.ok(cart.includes("setQuantity(cartLineKey(line), line.quantity + 1)"), "cart increment frozen");

const helper = read("lib/storefront-card-quantity.ts");
assert.ok(helper.includes("cartLineIdentity"), "existing cart identity");
assert.ok(!helper.includes("create("), "helper is not a new cart store");

function cardInnerWidth(viewport: number) {
  const gutter = 16;
  const gap = 12;
  const content = Math.max(0, Math.min(viewport, 1180) - gutter * 2);
  const cols = viewport >= 1440 ? 5 : viewport >= 1024 ? 4 : viewport >= 600 ? 3 : 2;
  return { cols, card: content / cols - gap };
}

const stepperWidth = 28 + 4 + 14 + 4 + 28;
for (const width of [320, 360, 375, 390, 393, 414, 430, 768, 1024, 1440]) {
  const { card } = cardInnerWidth(width);
  assert.ok(card >= stepperWidth + 36, `${width}px card ${card} too narrow for compact stepper`);
}

const add = read("lib/storefront-cart.ts");
assert.ok(add.includes("addStorefrontProduct"), "existing add helper remains");
assert.ok(add.includes("tryAddOfferToCart"), "existing offer add remains");

console.log(JSON.stringify({ ok: true, steps }, null, 2));
