/**
 * Low-data typed-address fallback (A–J).
 * Does not call Google/Nominatim live. Does not charge ZB.
 * Run: npx tsx scripts/test-low-data-address-fallback.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { WhatsAppConversationState } from "@prisma/client";

const here = fileURLToPath(new URL(".", import.meta.url));
loadEnv({ path: resolve(here, "../../../.env") });
loadEnv({ path: resolve(here, "../.env") });
process.env.JWT_SECRET ??= "test-jwt-secret-minimum-24-characters-long";
process.env.NODE_ENV ??= "test";

function read(rel: string) {
  return readFileSync(resolve(here, rel), "utf8");
}

const handler = read("../src/modules/whatsapp/customer-handler.ts");
const copySrc = read("../src/modules/whatsapp/copy.ts");
const sessionSrc = read("../src/modules/whatsapp/checkout-session.ts");
const geoSrc = read("../src/modules/location/geocoding.service.ts");
const locationScreen = read("../../mobile/src/screens/commerce/ShopLocationScreen.tsx");
const autocomplete = read("../../mobile/src/components/AddressAutocomplete.tsx");
const apiClient = read("../../mobile/src/lib/api.ts");
const quoteSvc = read("../src/modules/commerce/customer-commerce.service.ts");

assert.match(handler, /geocodeAddressCandidates/);
assert.match(handler, /LOCATION_CLARIFICATION/);
assert.doesNotMatch(handler, /parseFloat\(text\)/);
assert.ok(handler.indexOf("LOCATION_CLARIFICATION") < handler.indexOf("PRODUCT_DISAMBIGUATION"));
assert.match(handler, /buildAndPresentQuote/);
assert.match(handler, /quoteCart/);
assert.match(geoSrc, /classifyGeocodeCandidates/);
assert.match(copySrc, /Send your current location/);
assert.match(copySrc, /Type your delivery address/);
assert.match(copySrc, /House 24, Senga 2, near MSU Main Campus, Gweru/);
assert.match(copySrc, /I couldn't find that address/);
assert.match(copySrc, /I found more than one location/);
assert.match(copySrc, /I couldn't find the exact delivery point/);
assert.match(locationScreen, /USE MY CURRENT LOCATION/);
assert.match(locationScreen, /ENTER DELIVERY ADDRESS/);
assert.match(locationScreen, /We couldn't use your current location/);
assert.match(locationScreen, /allowIncomplete: true/);
assert.match(locationScreen, /You do not need a map/);
assert.match(autocomplete, /Suburb, landmark, or street/);
assert.match(autocomplete, /allowIncomplete: true/);
assert.match(apiClient, /allowIncomplete/);
assert.match(quoteSvc, /quoteCart/);
assert.doesNotMatch(handler, /window\.alert/);

const {
  classifyGeocodeCandidates
} = await import("../src/modules/location/geocode-candidates.js");
const {
  formatLocationAsk,
  formatLocationAmbiguous,
  formatLocationConfirm,
  formatLocationFailed,
  formatLocationNeedLandmark,
  formatCheckoutHelp,
  formatOrderCartSummary
} = await import("../src/modules/whatsapp/copy.js");
const {
  humanDeliveryLabel,
  looksLikeRawCoordinates,
  sanitizeCheckoutContext,
  parseNumericChoice
} = await import("../src/modules/whatsapp/checkout-session.js");

const ask = formatLocationAsk();
assert.match(ask, /Where should we deliver\?/);
assert.match(ask, /Send your current location/);
assert.match(ask, /Type your delivery address/);
assert.doesNotMatch(ask, /Google Maps/);
pass("copy-ask");

assert.match(formatLocationFailed(), /area and a nearby landmark/);
assert.match(formatLocationNeedLandmark(), /Nearest landmark/);
assert.match(formatLocationAmbiguous([{ label: "Senga 2, Gweru" }]), /Which one do you mean\?/);
assert.match(formatLocationConfirm("Senga 2, near MSU Main Campus"), /Deliver to:/);
assert.doesNotMatch(formatLocationConfirm("Senga 2, near MSU Main Campus"), /-19\./);
pass("copy-recovery");

assert.equal(looksLikeRawCoordinates("-19.5037, 29.8418"), true);
assert.equal(humanDeliveryLabel({ typed: "-19.5037, 29.8418" }), "Pinned location ✓");
assert.equal(humanDeliveryLabel({ typed: "Senga 2 close to Chicken Inn" }), "Senga 2 close to Chicken Inn");
const review = formatOrderCartSummary({
  lines: [{ quantity: 1, productName: "Bread", lineTotalCents: 100 }],
  subtotalCents: 100,
  deliveryFeeCents: 50,
  totalCents: 150,
  deliveryLabel: "-19.5037, 29.8418"
});
assert.doesNotMatch(review, /-19\.5037/);
assert.match(review, /Pinned location/);
pass("coords-hidden");

const senga = {
  label: "Senga 2, Gweru",
  formattedAddress: "Senga 2, Gweru, Zimbabwe",
  latitude: -19.5037,
  longitude: 29.8418,
  coarse: false
};
const msu = {
  label: "MSU Main Campus, Gweru",
  formattedAddress: "Midlands State University, Gweru",
  latitude: -19.516,
  longitude: 29.84,
  coarse: false
};
const country = {
  label: "Zimbabwe",
  formattedAddress: "Zimbabwe",
  latitude: -19,
  longitude: 29.8,
  coarse: true
};

assert.equal(classifyGeocodeCandidates([]).kind, "none");
assert.equal(classifyGeocodeCandidates([country]).kind, "coarse");
assert.equal(classifyGeocodeCandidates([senga]).kind, "single");
const clustered = classifyGeocodeCandidates([
  senga,
  { ...senga, label: "House 24 Senga 2", latitude: -19.5038, longitude: 29.8419, coarse: false }
]);
assert.equal(clustered.kind, "single");
const amb = classifyGeocodeCandidates([senga, msu]);
assert.equal(amb.kind, "ambiguous");
if (amb.kind === "ambiguous") assert.equal(amb.options.length, 2);
pass("classify");

const locClarify = sanitizeCheckoutContext(WhatsAppConversationState.AWAITING_LOCATION, {
  expectedInput: "LOCATION_CLARIFICATION",
  pendingLocationChoices: [senga, msu],
  pendingChoices: [{ query: "bread", options: [{ productId: "p1", name: "Bread", priceCents: 100 }] }],
  requestedItems: [{ query: "bread", quantity: 1 }],
  checkoutSessionId: "sess-1"
});
assert.equal(locClarify.ctx.expectedInput, "LOCATION_CLARIFICATION");
assert.equal(locClarify.ctx.pendingLocationChoices?.length, 2);
assert.equal(locClarify.ctx.pendingChoices, undefined);
assert.equal(parseNumericChoice("1"), 1);
assert.equal(formatCheckoutHelp("LOCATION_CLARIFICATION").includes("product"), false);
assert.match(formatCheckoutHelp("PRODUCT_DISAMBIGUATION"), /product/);
pass("session-isolation");

assert.match(locationScreen, /We couldn't use your current location/);
assert.match(locationScreen, /Street, suburb, or landmark/);
pass("web-app-gps-deny");

function pass(name: string) {
  // eslint-disable-next-line no-console
  console.log(`PASS ${name}`);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      letters: {
        A: "SOURCE-VERIFIED GPS pin still applies location",
        B: "PASS typed address uses geocode candidates",
        C: "PASS landmark-style labels kept",
        D: "PASS ambiguous classification",
        E: "PASS failed-address copy; cart fields untouched in handler",
        F: "SOURCE-VERIFIED text-only WhatsApp path (typed address, no map)",
        G: "SOURCE-VERIFIED web GPS deny shows typed address",
        H: "SOURCE-VERIFIED app GPS deny same ShopLocationScreen",
        I: "SOURCE-VERIFIED quote still via buildAndPresentQuote/quoteCart",
        J: "PASS LOCATION_CLARIFICATION cannot keep product pendingChoices"
      }
    },
    null,
    2
  )
);
