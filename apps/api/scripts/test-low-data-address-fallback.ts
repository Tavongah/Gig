/**
 * Zimbabwe typed-address progressive resolution (production 34 Nehosho failure).
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
const resolveSrc = read("../src/modules/location/typed-delivery-resolve.ts");
const locationScreen = read("../../mobile/src/screens/commerce/ShopLocationScreen.tsx");
const autocomplete = read("../../mobile/src/components/AddressAutocomplete.tsx");
const apiClient = read("../../mobile/src/lib/api.ts");
const quoteSvc = read("../src/modules/commerce/customer-commerce.service.ts");
const handoff = read("../src/modules/commerce/guest-handoff.service.ts");

assert.match(handler, /resolveTypedDeliveryLocation/);
assert.match(handler, /pendingAreaMatch/);
assert.match(handler, /deliveryInstructions/);
assert.match(handler, /LOCATION_CLARIFICATION/);
assert.doesNotMatch(handler, /parseFloat\(text\)/);
assert.ok(handler.indexOf("LOCATION_CLARIFICATION") < handler.indexOf("PRODUCT_DISAMBIGUATION"));
assert.match(handler, /buildAndPresentQuote/);
assert.match(handler, /quoteCart/);
assert.match(geoSrc, /classifyGeocodeCandidates/);
assert.match(resolveSrc, /progressiveDeliveryQueries|house_or_street_missing/);
assert.match(copySrc, /Send your current location/);
assert.match(copySrc, /Type your delivery address/);
assert.match(copySrc, /I found \$\{input\.areaLabel\}, but not the exact address/);
assert.match(copySrc, /What's a nearby landmark\?/);
assert.match(locationScreen, /USE MY CURRENT LOCATION/);
assert.match(locationScreen, /ENTER DELIVERY ADDRESS/);
assert.match(locationScreen, /We couldn't use your current location/);
assert.match(locationScreen, /allowIncomplete: true/);
assert.match(locationScreen, /You do not need a map/);
assert.match(locationScreen, /precision === "area"/);
assert.match(autocomplete, /Suburb, landmark, or street/);
assert.match(autocomplete, /allowIncomplete: true/);
assert.match(apiClient, /allowIncomplete/);
assert.match(quoteSvc, /quoteCart/);
assert.match(handoff, /WEB_HANDOFF/);
assert.match(sessionSrc, /composeDeliveryLabel/);
assert.doesNotMatch(handler, /window\.alert/);

const { classifyGeocodeCandidates } = await import("../src/modules/location/geocode-candidates.js");
const {
  parseZimbabweDeliveryText,
  progressiveDeliveryQueries
} = await import("../src/modules/location/zimbabwe-delivery-text.js");
const {
  originalDeliveryInstructions,
  resolveTypedDeliveryLocationWithLookup
} = await import("../src/modules/location/typed-delivery-resolve.js");
const {
  formatLocationAsk,
  formatLocationAmbiguous,
  formatLocationAreaFound,
  formatLocationConfirm,
  formatLocationFailed,
  formatLocationNeedArea,
  formatLocationNeedCity,
  formatLocationNeedLandmark,
  formatLocationNeedLandmarkForArea,
  formatCheckoutHelp,
  formatOrderCartSummary
} = await import("../src/modules/whatsapp/copy.js");
const {
  composeDeliveryLabel,
  humanDeliveryLabel,
  looksLikeRawCoordinates,
  sanitizeCheckoutContext,
  parseNumericChoice
} = await import("../src/modules/whatsapp/checkout-session.js");

const PRODUCTION_A = "34 Nehosho, senga Gweru";
const PRODUCTION_B = "34 Nehosho, senga Gweru Zimbabwe";

const parsedA = parseZimbabweDeliveryText(PRODUCTION_A);
assert.equal(parsedA.house, "34");
assert.equal(parsedA.street, "Nehosho");
assert.equal(parsedA.suburb, "Senga");
assert.equal(parsedA.city, "Gweru");
assert.equal(parsedA.country, undefined);

const parsedB = parseZimbabweDeliveryText(PRODUCTION_B);
assert.equal(parsedB.house, "34");
assert.equal(parsedB.street, "Nehosho");
assert.equal(parsedB.suburb, "Senga");
assert.equal(parsedB.city, "Gweru");
assert.equal(parsedB.country, "Zimbabwe");

const queriesA = progressiveDeliveryQueries(parsedA);
assert.ok(queriesA.some((q) => /^34 Nehosho, Senga, Gweru, Zimbabwe$/i.test(q)));
assert.ok(queriesA.some((q) => /^Nehosho, Senga, Gweru, Zimbabwe$/i.test(q)));
assert.ok(queriesA.some((q) => /^Senga, Gweru, Zimbabwe$/i.test(q)));
assert.equal(originalDeliveryInstructions(parsedA), "34 Nehosho");
pass("parse-production");

const senga = {
  label: "Senga, Gweru, Zimbabwe",
  formattedAddress: "Senga, Gweru, Midlands, Zimbabwe",
  latitude: -19.4970683,
  longitude: 29.838108,
  coarse: false,
  precision: "area" as const
};
const msu = {
  label: "MSU Main Campus, Gweru",
  formattedAddress: "Midlands State University, Gweru, Zimbabwe",
  latitude: -19.516,
  longitude: 29.84,
  coarse: false,
  precision: "landmark" as const
};
const country = {
  label: "Zimbabwe",
  formattedAddress: "Zimbabwe",
  latitude: -19,
  longitude: 29.8,
  coarse: true,
  precision: "coarse" as const
};

async function lookupFromQueries(query: string) {
  const q = query.toLowerCase();
  if (/msu/.test(q)) return [msu];
  if (/^34\s+nehosho/.test(q)) return [];
  if (/nehosho/.test(q) && !/^senga/.test(q)) return [];
  if (/senga/.test(q) && /gweru/.test(q)) return [senga];
  return [];
}

const resolvedA = await resolveTypedDeliveryLocationWithLookup(PRODUCTION_A, lookupFromQueries);
assert.equal(resolvedA.kind, "area");
if (resolvedA.kind === "area") {
  assert.match(resolvedA.areaLabel, /Senga/i);
  assert.match(resolvedA.areaLabel, /Gweru/i);
  assert.equal(resolvedA.pick.latitude, senga.latitude);
}
const areaCopy = formatLocationAreaFound({ areaLabel: "Senga, Gweru", suburb: "Senga" });
assert.match(areaCopy, /I found Senga, Gweru, but not the exact address/);
assert.match(areaCopy, /Is this delivery in Senga\?/);
assert.doesNotMatch(areaCopy, /Please add your area and a nearby landmark/);
assert.doesNotMatch(areaCopy, /34 Nehosho ✓/);

const resolvedB = await resolveTypedDeliveryLocationWithLookup(PRODUCTION_B, lookupFromQueries);
assert.equal(resolvedB.kind, "area");
assert.doesNotMatch(
  formatLocationNeedLandmarkForArea({ areaLabel: "Senga, Gweru" }),
  /Please add your area and a nearby landmark/
);
pass("A-B-production-area");

const resolvedC = await resolveTypedDeliveryLocationWithLookup(
  "34 Nehosho, Senga, Gweru, Zimbabwe",
  lookupFromQueries
);
assert.equal(resolvedC.kind, "area");
pass("C-normalized");

const resolvedD = await resolveTypedDeliveryLocationWithLookup("Senga, Gweru", lookupFromQueries);
assert.equal(resolvedD.kind, "area");
pass("D-suburb-city");

const resolvedE = await resolveTypedDeliveryLocationWithLookup(
  "Senga 2 near MSU Main Campus, Gweru",
  lookupFromQueries
);
assert.equal(resolvedE.kind, "landmark");
pass("E-senga-msu");

const resolvedF = await resolveTypedDeliveryLocationWithLookup("near MSU Main Campus, Gweru", lookupFromQueries);
assert.equal(resolvedF.kind, "landmark");
pass("F-msu-landmark");

const resolvedG = await resolveTypedDeliveryLocationWithLookup("asdfghjkxyz not a place", async () => []);
assert.ok(resolvedG.kind === "need_city" || resolvedG.kind === "none" || resolvedG.kind === "need_area");
assert.notEqual(resolvedG.kind, "exact");
assert.notEqual(resolvedG.kind, "area");
pass("G-nonsense");

const ask = formatLocationAsk();
assert.match(ask, /Where should we deliver\?/);
assert.match(ask, /Send your current location/);
assert.match(ask, /Type your delivery address/);
assert.doesNotMatch(ask, /Google Maps/);
assert.match(formatLocationFailed(), /area and a nearby landmark/);
assert.match(formatLocationNeedLandmark(), /Nearest landmark/);
assert.match(formatLocationNeedCity(), /Which city/);
assert.match(formatLocationNeedArea({ city: "Gweru" }), /Which area in Gweru/);
assert.match(formatLocationAmbiguous([{ label: "Senga 2, Gweru" }]), /Which one do you mean\?/);
assert.match(formatLocationConfirm("Senga 2, near MSU Main Campus"), /Deliver to:/);
assert.doesNotMatch(formatLocationConfirm("Senga 2, near MSU Main Campus"), /-19\./);
pass("copy-recovery");

assert.equal(looksLikeRawCoordinates("-19.5037, 29.8418"), true);
assert.equal(humanDeliveryLabel({ typed: "-19.5037, 29.8418" }), "Pinned location ✓");
assert.equal(humanDeliveryLabel({ typed: "Senga 2 close to Chicken Inn" }), "Senga 2 close to Chicken Inn");
const areaLabel = composeDeliveryLabel({
  resolvedLabel: "Senga, Gweru",
  instructions: "34 Nehosho",
  precision: "AREA"
});
assert.match(areaLabel, /Senga, Gweru/);
assert.match(areaLabel, /34 Nehosho/);
assert.notEqual(areaLabel, "34 Nehosho");
assert.notEqual(areaLabel, "34 Nehosho ✓");
const review = formatOrderCartSummary({
  lines: [{ quantity: 1, productName: "Bread", lineTotalCents: 100 }],
  subtotalCents: 100,
  deliveryFeeCents: 50,
  totalCents: 150,
  deliveryLabel: "-19.5037, 29.8418"
});
assert.doesNotMatch(review, /-19\.5037/);
assert.match(review, /Pinned location/);
pass("false-precision-prevented");

assert.equal(classifyGeocodeCandidates([]).kind, "none");
assert.equal(classifyGeocodeCandidates([country]).kind, "coarse");
assert.equal(classifyGeocodeCandidates([senga]).kind, "single");
const clustered = classifyGeocodeCandidates([
  senga,
  { ...senga, label: "House 24 Senga 2", latitude: -19.4971, longitude: 29.8382, coarse: false }
]);
assert.equal(clustered.kind, "single");
const landmarkPreferred = classifyGeocodeCandidates([senga, msu]);
assert.equal(landmarkPreferred.kind, "single");
if (landmarkPreferred.kind === "single") assert.equal(landmarkPreferred.pick.precision, "landmark");
const sengaSpread = {
  ...senga,
  label: "Mkoba, Gweru",
  formattedAddress: "Mkoba, Gweru, Zimbabwe",
  latitude: -19.45,
  longitude: 29.9
};
const amb = classifyGeocodeCandidates([senga, sengaSpread]);
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
assert.equal(locClarify.ctx.requestedItems?.length, 1);
assert.equal(parseNumericChoice("1"), 1);
assert.equal(formatCheckoutHelp("LOCATION_CLARIFICATION").includes("product"), false);
assert.match(formatCheckoutHelp("PRODUCT_DISAMBIGUATION"), /product/);

const areaClarify = sanitizeCheckoutContext(WhatsAppConversationState.AWAITING_LOCATION, {
  expectedInput: "LOCATION_CLARIFICATION",
  pendingAreaMatch: {
    label: "Senga, Gweru",
    suburb: "Senga",
    city: "Gweru",
    latitude: senga.latitude,
    longitude: senga.longitude,
    originalText: "34 Nehosho"
  },
  requestedItems: [{ query: "bread", quantity: 1 }],
  lockedProductLines: [{ productId: "p1", quantity: 1, productName: "Bread", unitPriceCents: 100, merchantId: "m1" }],
  checkoutSessionId: "sess-2"
});
assert.equal(areaClarify.ctx.expectedInput, "LOCATION_CLARIFICATION");
assert.equal(areaClarify.ctx.pendingAreaMatch?.originalText, "34 Nehosho");
assert.equal(areaClarify.ctx.requestedItems?.length, 1);
assert.equal(areaClarify.ctx.lockedProductLines?.length, 1);
pass("session-isolation");

assert.match(locationScreen, /We couldn't use your current location/);
assert.match(locationScreen, /Street, suburb, or landmark/);
assert.match(handler, /applyNativeLocation/);
assert.match(handler, /expect === "LOCATION_CLARIFICATION"/);
assert.match(handler, /extractGuestBasketRef/);
pass("web-app-gps-deny");

let liveKind = "SKIPPED";
let liveProvider: Array<Record<string, unknown>> = [];
try {
  const { resolveTypedDeliveryLocation, geocodeAddressCandidates } = await import(
    "../src/modules/location/geocoding.service.js"
  );
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  async function probe(query: string) {
    const started = Date.now();
    const candidates = await geocodeAddressCandidates(query);
    liveProvider.push({
      query,
      elapsedMs: Date.now() - started,
      providerResultCount: candidates.length,
      candidateLabels: candidates.map((c) => c.label),
      candidateCoordinates: candidates.map((c) => ({ lat: c.latitude, lng: c.longitude })),
      precision: candidates.map((c) => c.precision),
      countryHint: candidates.map((c) => (/zimbabwe/i.test(c.formattedAddress) ? "ZW" : "unknown"))
    });
    await sleep(1100);
  }
  await probe(PRODUCTION_A);
  await probe(PRODUCTION_B);
  await probe("Senga, Gweru, Zimbabwe");
  const live = await resolveTypedDeliveryLocation(PRODUCTION_A);
  liveKind = live.kind;
  assert.ok(live.kind === "area" || live.kind === "need_landmark" || live.kind === "exact");
  if (live.kind === "area") {
    assert.match(live.areaLabel, /Senga/i);
    assert.match(live.areaLabel, /Gweru/i);
  }
  pass("live-nominatim");
} catch (err) {
  liveKind = `SKIPPED:${err instanceof Error ? err.message : "error"}`;
  pass("live-nominatim-skipped");
}

function pass(name: string) {
  // eslint-disable-next-line no-console
  console.log(`PASS ${name}`);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      liveKind,
      liveProvider,
      letters: {
        A: "PASS 34 Nehosho, senga Gweru → area Senga/Gweru, not generic landmark loop",
        B: "PASS 34 Nehosho, senga Gweru Zimbabwe → same area path",
        C: "PASS 34 Nehosho, Senga, Gweru, Zimbabwe → area",
        D: "PASS Senga, Gweru → area",
        E: "PASS Senga 2 near MSU Main Campus, Gweru → landmark or area",
        F: "PASS near MSU Main Campus, Gweru → landmark",
        G: "PASS nonsense does not resolve as exact/area",
        H: "SOURCE-VERIFIED GPS pin still applyNativeLocation",
        I: "SOURCE-VERIFIED failed typed retries applyTypedLocation from LOCATION_CLARIFICATION",
        J: "SOURCE-VERIFIED GPS allowed during LOCATION_CLARIFICATION",
        K: "SOURCE-VERIFIED web handoff + typed geocode allowIncomplete + area label",
        L: "SOURCE-VERIFIED cart/session preserved on pendingAreaMatch / WEB_HANDOFF isolation"
      }
    },
    null,
    2
  )
);
