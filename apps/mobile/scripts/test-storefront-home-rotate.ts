/**
 * Homepage product rotation + Nearby Shops presentation removal.
 * Run: npx tsx scripts/test-storefront-home-rotate.ts
 */
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { rotateStorefrontProducts } from "../src/lib/storefront-home-rotate";

const src = join(__dirname, "..", "src");
function read(rel: string) {
  const p = join(src, rel);
  assert.ok(existsSync(p), `missing ${rel}`);
  return readFileSync(p, "utf8");
}

const names = ["Bread", "Milk", "Eggs", "Mazoe", "Rice", "Soap", "Juice", "Biscuits"];
const a = rotateStorefrontProducts(names, 11, 1);
const b = rotateStorefrontProducts(names, 11, 1);
const c = rotateStorefrontProducts(names, 99, 1);
assert.deepEqual(a, b, "same session seed is stable");
assert.notDeepEqual(a, names, "rotation changes API order");
assert.notDeepEqual(a, c, "different visit seeds can differ");
assert.deepEqual([...a].sort(), [...names].sort(), "rotation preserves membership");
assert.deepEqual(names, ["Bread", "Milk", "Eggs", "Mazoe", "Rice", "Soap", "Juice", "Biscuits"], "input not mutated");

const ids = [{ id: "p1" }, { id: "p2" }, { id: "p3" }];
const rotated = rotateStorefrontProducts(ids, 7, 1);
assert.equal(rotated[0], ids.find((x) => x.id === rotated[0]!.id), "same object identity");
assert.deepEqual(rotateStorefrontProducts([], 3, 1), []);

const page1 = rotateStorefrontProducts(names.slice(0, 4), 5, 1);
const page2 = rotateStorefrontProducts(names.slice(4), 5, 2);
const appended = [...page1, ...page2];
const page1Again = rotateStorefrontProducts(names.slice(0, 4), 5, 1);
assert.deepEqual(appended.slice(0, 4), page1Again, "later pages append without reshuffling earlier rows");

const home = read("screens/commerce/ShopHomeScreen.tsx");
assert.ok(home.includes("storefrontVisitSeed"), "session-stable seed");
assert.ok(home.includes("rotateStorefrontProducts"), "homepage rotates eligible products");
assert.ok(home.includes("useMemo(() => storefrontVisitSeed(), [])"), "seed is not regenerated each render");
assert.ok(!home.includes("Math.random"), "no per-render Math.random");
assert.ok(!home.includes("Nearby shops"), "Nearby Shops section removed");
assert.ok(!home.includes("commerceNearbyShops"), "homepage does not call nearby shops API");
assert.ok(home.includes("isProductCardPurchasable"), "eligibility split unchanged");
assert.ok(home.includes("addStorefrontProduct"), "add uses existing cart identity");
assert.ok(home.includes("Shop by category"), "category discovery preserved");
assert.ok(home.includes("commerceNearbyProducts"), "product data source unchanged");

const api = read("lib/api.ts");
assert.ok(api.includes("commerceNearbyShops"), "nearby shops API remains for other surfaces");
assert.ok(existsSync(join(src, "screens/commerce/ShopDetailScreen.tsx")), "shop detail screen remains");

const helper = read("lib/storefront-home-rotate.ts");
assert.ok(helper.includes("sessionStorage"), "web visit seed persists for the tab session");
assert.ok(!helper.includes("Math.random()"), "shuffle does not use Math.random");

console.log(JSON.stringify({ ok: true }, null, 2));
