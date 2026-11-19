/**
 * Request Products WhatsApp formatting and validation.
 * Does not open WhatsApp or contact DUTS.
 * Run: npx tsx scripts/test-request-products-whatsapp.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  REQUEST_PRODUCT_LIMIT,
  buildRequestProductsWhatsAppUrl,
  emptyRequestProduct,
  formatRequestProductsMessage,
  requestProductsDestinationDigits,
  validateRequestProducts,
  type RequestProductDraft
} from "../src/lib/request-products-whatsapp";

const example = validateRequestProducts({
  products: [
    { id: "a", name: "Samsung Galaxy A56", quantity: "1", details: "Black, 128GB" },
    { id: "b", name: "Nike sneakers", quantity: "2", details: "Size 8, white" }
  ],
  whatsappNumber: "+263771234567",
  deliveryCity: "Harare",
  notes: ""
});
assert.equal(example.ok, true);
if (!example.ok) throw new Error("example should validate");
const message = formatRequestProductsMessage(example.value);
assert.equal(
  message,
  [
    "Hello DUTS, I'd like to request the following products:",
    "",
    "1. Samsung Galaxy A56 — Quantity: 1",
    "   Details: Black, 128GB",
    "",
    "2. Nike sneakers — Quantity: 2",
    "   Details: Size 8, white",
    "",
    "Delivery city: Harare",
    "My WhatsApp: +263771234567",
    "",
    "Please help me check availability and prices. Thank you!"
  ].join("\n")
);

const noted = validateRequestProducts({
  products: [{ id: "a", name: "Rice", quantity: "1", details: "" }],
  whatsappNumber: "263771234567",
  deliveryCity: "Bulawayo",
  notes: "Leave at the gate"
});
assert.equal(noted.ok, true);
if (!noted.ok) throw new Error("noted should validate");
assert.match(formatRequestProductsMessage(noted.value), /Additional notes: Leave at the gate/);
assert.equal(noted.value.whatsappNumber, "+263771234567");

const special = validateRequestProducts({
  products: [{ id: "a", name: "Bread & milk", quantity: "1", details: "100% whole grain\nunsliced" }],
  whatsappNumber: "+1 (203) 555-0100",
  deliveryCity: "Harare",
  notes: ""
});
assert.equal(special.ok, true);
if (!special.ok) throw new Error("special should validate");
const specialMessage = formatRequestProductsMessage(special.value);
assert.match(specialMessage, /Bread & milk/);
assert.match(specialMessage, /100% whole grain\nunsliced/);
const url = buildRequestProductsWhatsAppUrl("263700000001", specialMessage);
assert.ok(url);
assert.match(url!, /^https:\/\/wa\.me\/263700000001\?text=/);
const decoded = decodeURIComponent(url!.split("?text=")[1]);
assert.equal(decoded, specialMessage);
assert.ok(url!.includes(encodeURIComponent("&")));
assert.ok(url!.includes(encodeURIComponent("\n")));
assert.equal(buildRequestProductsWhatsAppUrl("", specialMessage), null);
assert.equal(buildRequestProductsWhatsAppUrl("123", specialMessage), null);

function draft(products: RequestProductDraft[], extra?: Partial<{ whatsappNumber: string; deliveryCity: string }>) {
  return validateRequestProducts({
    products,
    whatsappNumber: extra?.whatsappNumber ?? "+263771234567",
    deliveryCity: extra?.deliveryCity ?? "Harare",
    notes: ""
  });
}

assert.equal(draft([{ id: "a", name: "  ", quantity: "1", details: "" }]).ok, false);
assert.equal(draft([{ id: "a", name: "Rice", quantity: "0", details: "" }]).ok, false);
assert.equal(draft([{ id: "a", name: "Rice", quantity: "", details: "" }]).ok, false);
assert.equal(draft([{ id: "a", name: "Rice", quantity: "1.5", details: "" }]).ok, false);
assert.equal(draft([{ id: "a", name: "Rice", quantity: "1", details: "" }], { whatsappNumber: "abc" }).ok, false);
assert.equal(draft([{ id: "a", name: "Rice", quantity: "1", details: "" }], { whatsappNumber: "+26377" }).ok, false);
assert.equal(draft([{ id: "a", name: "Rice", quantity: "1", details: "" }], { deliveryCity: "  " }).ok, false);

const tooMany = Array.from({ length: REQUEST_PRODUCT_LIMIT + 1 }, (_, index) =>
  emptyRequestProduct(String(index), `Item ${index + 1}`)
);
assert.equal(draft(tooMany).ok, false);
const ten = tooMany.slice(0, REQUEST_PRODUCT_LIMIT);
assert.equal(draft(ten).ok, true);

const previousDestination = process.env.EXPO_PUBLIC_DUTS_REQUESTS_WHATSAPP;
process.env.EXPO_PUBLIC_DUTS_REQUESTS_WHATSAPP = "263780941428";
assert.equal(requestProductsDestinationDigits(), "263780941428");
const supportUrl = buildRequestProductsWhatsAppUrl(requestProductsDestinationDigits(), message);
assert.ok(supportUrl);
assert.match(supportUrl!, /^https:\/\/wa\.me\/263780941428\?text=/);
assert.equal(decodeURIComponent(supportUrl!.split("?text=")[1]), message);
delete process.env.EXPO_PUBLIC_DUTS_REQUESTS_WHATSAPP;
assert.equal(requestProductsDestinationDigits(), null);
if (previousDestination == null) delete process.env.EXPO_PUBLIC_DUTS_REQUESTS_WHATSAPP;
else process.env.EXPO_PUBLIC_DUTS_REQUESTS_WHATSAPP = previousDestination;

const screen = readFileSync(join(__dirname, "../src/screens/commerce/ProductSearchScreen.tsx"), "utf8");
const panel = readFileSync(join(__dirname, "../src/components/RequestProductsPanel.tsx"), "utf8");
const handoff = readFileSync(join(__dirname, "../../api/src/modules/commerce/guest-handoff.service.ts"), "utf8");
const requests = readFileSync(join(__dirname, "../src/lib/request-products-whatsapp.ts"), "utf8");
assert.match(screen, /Platform\.OS === "web"/);
assert.match(screen, /RequestProductsPanel/);
assert.doesNotMatch(screen, /whatsappDigits/);
assert.doesNotMatch(screen, /wa\.me\/263/);
assert.match(panel, /requestProductsDestinationDigits/);
assert.match(panel, /Send via WhatsApp/);
assert.match(panel, /Add Another Product/);
assert.doesNotMatch(panel, /Request sent/);
assert.doesNotMatch(panel, /wa\.me\/263/);
assert.match(requests, /EXPO_PUBLIC_DUTS_REQUESTS_WHATSAPP/);
assert.doesNotMatch(requests, /263780941428/);
assert.doesNotMatch(requests, /263716818790/);
assert.match(handoff, /TWILIO_WHATSAPP_FROM/);
assert.doesNotMatch(handoff, /263780941428/);
assert.doesNotMatch(handoff, /EXPO_PUBLIC_DUTS_REQUESTS_WHATSAPP/);

console.log(JSON.stringify({ ok: true }));
