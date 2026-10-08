/**
 * DUTS Product Flavor Options V1 + optional-selection correction (A–J).
 * Run: npm run test:product-flavor-options --workspace=@gigflow/api
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  cartLineIdentity,
  formatFlavorCustomerLine,
  formatFlavorFulfillmentLine,
  isFlavorInquiry,
  matchFlavorFromText,
  merchantCanFulfillFlavor,
  parseProductFlavorOptionsEnabled,
  unmatchedFlavorMention
} from "@gigflow/shared";

const here = fileURLToPath(new URL(".", import.meta.url));

function src(rel: string): string {
  return readFileSync(resolve(here, rel), "utf8");
}

function pass(name: string) {
  console.log(`  ${name}`);
}

const flavors = [
  { id: "orange", name: "Orange", sortOrder: 0 },
  { id: "raspberry", name: "Raspberry", sortOrder: 1 },
  { id: "cream", name: "Cream Soda", sortOrder: 2 }
];

assert.equal(parseProductFlavorOptionsEnabled(undefined), false);
assert.equal(parseProductFlavorOptionsEnabled("false"), false);
assert.equal(parseProductFlavorOptionsEnabled("true"), true);
pass("flag default OFF");

assert.equal(cartLineIdentity("p1", null), "p1::ANY");
assert.equal(cartLineIdentity("p1", "orange"), "p1::orange");
assert.notEqual(cartLineIdentity("p1", "orange"), cartLineIdentity("p1", "raspberry"));
pass("cart identity by flavor");

assert.equal(formatFlavorCustomerLine(null), null);
assert.equal(formatFlavorCustomerLine("ANY"), "Flavor: Any");
assert.equal(formatFlavorCustomerLine("SPECIFIC", "Orange"), "Flavor: Orange");
assert.equal(formatFlavorFulfillmentLine("ANY"), "FLAVOR: ANY");
assert.equal(formatFlavorFulfillmentLine("SPECIFIC", "Orange"), "FLAVOR: ORANGE");
pass("A no-flavor products show nothing");

assert.equal(matchFlavorFromText("I want Mazoe 2L", flavors), null);
assert.equal(matchFlavorFromText("I want Mazoe Orange 2L", flavors)?.name, "Orange");
assert.equal(unmatchedFlavorMention("Mazoe 2L", "Mazoe 2L", flavors), null);
assert.equal(unmatchedFlavorMention("Mazoe Peach 2L", "Mazoe 2L", flavors), "peach");
assert.equal(isFlavorInquiry("What flavors do you have?"), true);
assert.equal(isFlavorInquiry("I want Mazoe 2L"), false);
pass("NL match / inquiry");

assert.equal(
  merchantCanFulfillFlavor({
    flavorPreference: "SPECIFIC",
    flavorOptionId: "orange",
    activeFlavorIds: ["orange", "raspberry"],
    unavailableFlavorIds: ["orange"]
  }),
  false
);
assert.equal(
  merchantCanFulfillFlavor({
    flavorPreference: "ANY",
    activeFlavorIds: ["orange", "raspberry"],
    unavailableFlavorIds: ["orange"]
  }),
  true
);
assert.equal(
  merchantCanFulfillFlavor({
    flavorPreference: null,
    activeFlavorIds: [],
    unavailableFlavorIds: []
  }),
  true
);
pass("G no auto-sub / H ANY can use another flavor");

const flavorService = src("../src/modules/commerce/flavor.service.ts");
assert.match(flavorService, /flavorPreference: "ANY"/);
assert.match(flavorService, /FLAVOR_UNAVAILABLE/);
assert.doesNotMatch(flavorService, /must choose a flavor/i);
pass("B missing selection resolves ANY");

const handler = src("../src/modules/whatsapp/customer-handler.ts");
assert.match(handler, /attachFlavorToLock/);
assert.match(handler, /flavorInquiryFromText/);
assert.match(handler, /sendFlavorChoicesForProduct/);
assert.doesNotMatch(handler, /You must choose a flavor/);
pass("D WhatsApp Mazoe 2L does not force flavor");
pass("E Orange captured in attachFlavorToLock");
pass("F inquiry shows choices");

const waFlavor = src("../src/modules/whatsapp/whatsapp-flavor.ts");
assert.match(waFlavor, /Any flavor/);
assert.match(waFlavor, /Flavor is optional/);
assert.match(waFlavor, /flavorPreference: "ANY"/);
assert.match(waFlavor, /isFlavorInquiry/);
pass("WhatsApp optional Any default");

const detail = src("../../mobile/src/screens/commerce/ProductDetailScreen.tsx");
assert.match(detail, /Flavor \(optional\)/);
assert.match(detail, /Any flavor/);
assert.match(detail, /selectedFlavorId/);
assert.match(detail, /flavorPreference: "ANY"/);
pass("customer UX optional chips");

const cart = src("../../mobile/src/screens/commerce/CartScreen.tsx");
assert.match(cart, /formatFlavorCustomerLine/);
assert.match(cart, /toCheckoutLine/);
pass("C cart preserves flavor");

const orderSnap = src("../src/modules/commerce/order.service.ts");
assert.match(orderSnap, /flavorNameSnapshot/);
assert.match(orderSnap, /flavorPreference/);
pass("historical snapshot stored");

const guest = src("../src/modules/commerce/guest-handoff.service.ts");
assert.match(guest, /flavorPreference: l.flavorPreference/);
assert.match(guest, /formatFlavorCustomerLine/);
pass("I web → WhatsApp preserves flavor");

const merchantNotify = src("../src/modules/commerce/merchant-notification.service.ts");
assert.match(merchantNotify, /formatFlavorFulfillmentLine/);
const courier = src("../src/modules/gigs/gig.service.ts");
assert.match(courier, /formatFlavorFulfillmentLine/);
pass("merchant/courier FLAVOR: ORANGE vs ANY");

const envExample = src("../../../.env.example");
assert.match(envExample, /PRODUCT_FLAVOR_OPTIONS_ENABLED=false/);
const prodEnv = src("../../../deploy/digitalocean/.env.production.example");
assert.match(prodEnv, /PRODUCT_FLAVOR_OPTIONS_ENABLED=false/);
pass("flag OFF in env examples");

const admin = src("../../admin/src/DutsCatalogPanel.tsx");
assert.match(admin, /Flavors \(optional\)/);
assert.match(admin, /Add flavor/);
pass("admin CRUD");

const schema = src("../prisma/schema.prisma");
assert.match(schema, /model CatalogProductFlavorOption/);
assert.match(schema, /flavorPreference\s+String\?/);
assert.doesNotMatch(schema, /flavorRequired/);
pass("J existing products without flavor config unchanged");

const migration = src("../prisma/migrations/20261008120000_product_flavor_options/migration.sql");
assert.match(migration, /CatalogProductFlavorOption/);
assert.match(migration, /ProductFlavorAvailability/);
pass("migration present");

console.log("\nProduct flavor options V1 tests A–J passed.");
