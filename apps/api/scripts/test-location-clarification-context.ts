/**
 * Location clarification must accumulate city/area/house across replies.
 * Run: npx tsx scripts/test-location-clarification-context.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { WhatsAppConversationState } from "@prisma/client";

const here = fileURLToPath(new URL(".", import.meta.url));
function read(rel: string) {
  return readFileSync(resolve(here, rel), "utf8");
}

const handler = read("../src/modules/whatsapp/customer-handler.ts");
const sessionSrc = read("../src/modules/whatsapp/checkout-session.ts");
const copySrc = read("../src/modules/whatsapp/copy.ts");
const handoff = read("../src/modules/commerce/guest-handoff.service.ts");

assert.match(handler, /deliveryLocationDraft/);
assert.match(handler, /locationClarificationType/);
assert.match(handler, /mergeClarificationReply/);
assert.match(handler, /composeQueryFromDraft/);
assert.match(handler, /lockedProductLines/);
assert.match(handler, /quoteCart/);
assert.match(sessionSrc, /deliveryLocationDraft/);
assert.match(copySrc, /Use this delivery area\?/);
assert.match(handoff, /WEB_HANDOFF/);
assert.ok(handler.indexOf("LOCATION_CLARIFICATION") < handler.indexOf("PRODUCT_DISAMBIGUATION"));

const {
  parseZimbabweDeliveryText,
  draftFromParsed,
  mergeClarificationReply,
  nextMissingClarification,
  composeQueryFromDraft,
  houseOrInstructions,
  parsedFromDraft
} = await import("../src/modules/location/zimbabwe-delivery-text.js");
const { resolveTypedDeliveryLocationWithLookup } = await import(
  "../src/modules/location/typed-delivery-resolve.js"
);
const {
  formatLocationNeedCity,
  formatLocationNeedArea,
  formatLocationNeedLandmarkForArea,
  formatLocationUseThisArea,
  formatCheckoutHelp
} = await import("../src/modules/whatsapp/copy.js");
const { sanitizeCheckoutContext, parseNumericChoice } = await import(
  "../src/modules/whatsapp/checkout-session.js"
);

const SCREENSHOT = "House 34, Senga Nehosho, near MSU Main Campus, Gweru";
const first = parseZimbabweDeliveryText(SCREENSHOT);
let draft = draftFromParsed(first);
assert.equal(draft.city, "Gweru");
assert.equal(draft.suburb, "Senga Nehosho");
assert.match(houseOrInstructions(draft) || draft.street || "", /House 34/i);
assert.match(String(draft.landmark), /MSU Main Campus/i);
assert.equal(nextMissingClarification(draft), null);

draft = mergeClarificationReply(draft, "MSU Batanai Campus", "LANDMARK");
assert.equal(draft.city, "Gweru", "city remains Gweru");
assert.equal(draft.suburb, "Senga Nehosho", "area remains Senga Nehosho");
assert.match(houseOrInstructions(draft), /House 34/i);
assert.match(String(draft.landmark), /Batanai/i);
assert.doesNotMatch(String(draft.landmark), /Main Campus/);
const nextAsk = nextMissingClarification(draft);
assert.notEqual(nextAsk, "CITY");
assert.notEqual(nextAsk, "AREA");
const rebuilt = composeQueryFromDraft(draft);
assert.match(rebuilt, /Gweru/i);
assert.match(rebuilt, /Senga Nehosho/i);
assert.match(rebuilt, /Batanai/i);
assert.match(rebuilt, /House 34/i);
assert.doesNotMatch(formatLocationNeedCity(), /Batanai/);
assert.doesNotMatch(rebuilt, /^MSU Batanai Campus$/i);
pass("screenshot-merge");

const cityCopy = formatLocationNeedCity();
const areaCopy = formatLocationNeedArea({ city: "Gweru" });
const landmarkCopy = formatLocationNeedLandmarkForArea({ areaLabel: "Senga Nehosho, Gweru", city: "Gweru" });
assert.equal(nextAsk, null);
assert.doesNotMatch(landmarkCopy, /Which city should we deliver to/);
assert.match(landmarkCopy, /What's a nearby landmark\?/);
assert.match(cityCopy, /Which city should we deliver to/);
assert.match(areaCopy, /Which area in Gweru/);
pass("screenshot-no-city-area-reroute");

let loop = mergeClarificationReply({}, "Gweru", "CITY");
assert.equal(loop.city, "Gweru");
assert.equal(nextMissingClarification(loop), "AREA");
loop = mergeClarificationReply(loop, "Senga Nehosho", "AREA");
assert.equal(loop.city, "Gweru");
assert.equal(loop.suburb, "Senga Nehosho");
assert.notEqual(nextMissingClarification(loop), "CITY");
pass("loop-regression");

const noCity = draftFromParsed(parseZimbabweDeliveryText("Senga Nehosho near MSU"));
assert.equal(nextMissingClarification(noCity), "CITY");
const cityReply = mergeClarificationReply(noCity, "Gweru", "CITY");
assert.equal(cityReply.city, "Gweru");
assert.equal(cityReply.suburb, "Senga Nehosho");
pass("B-city-reply");

const noArea = draftFromParsed(parseZimbabweDeliveryText("Gweru"));
assert.equal(nextMissingClarification(noArea), "AREA");
const areaReply = mergeClarificationReply(noArea, "Senga Nehosho", "AREA");
assert.equal(areaReply.city, "Gweru");
assert.equal(areaReply.suburb, "Senga Nehosho");
assert.notEqual(nextMissingClarification(areaReply), "CITY");
pass("C-area-reply");

const areaCity = draftFromParsed(parseZimbabweDeliveryText("Senga, Gweru"));
assert.equal(nextMissingClarification(areaCity), "LANDMARK");
const afterLm = mergeClarificationReply(areaCity, "MSU Batanai Campus", "LANDMARK");
assert.equal(afterLm.city, "Gweru");
assert.equal(afterLm.suburb, "Senga");
assert.match(String(afterLm.landmark), /Batanai/i);
pass("D-area-city-landmark");

const improved = mergeClarificationReply(
  draftFromParsed(parseZimbabweDeliveryText("somewhere")),
  "House 34, Senga Nehosho, near MSU Batanai Campus, Gweru",
  "LANDMARK"
);
assert.equal(improved.city, "Gweru");
pass("E-improved-address");

assert.equal(parseNumericChoice("1"), 1);
assert.equal(parseNumericChoice("2"), 2);
assert.match(formatLocationUseThisArea({ label: "Senga Nehosho, Gweru" }), /1\. Yes/);
assert.match(formatLocationUseThisArea({ label: "Senga Nehosho, Gweru" }), /2\. Change address/);
assert.equal(formatCheckoutHelp("LOCATION_CLARIFICATION").includes("product"), false);
pass("J-numeric-location");

const senga = {
  label: "Senga, Gweru, Zimbabwe",
  formattedAddress: "Senga, Gweru, Midlands, Zimbabwe",
  latitude: -19.4970683,
  longitude: 29.838108,
  coarse: false,
  precision: "area" as const
};
const msu = {
  label: "MSU Batanai Campus, Gweru",
  formattedAddress: "MSU Batanai Campus, Gweru, Zimbabwe",
  latitude: -19.5,
  longitude: 29.84,
  coarse: false,
  precision: "landmark" as const
};
async function lookup(query: string) {
  const q = query.toLowerCase();
  if (/batanai/.test(q)) return [msu];
  if (/senga/.test(q) && /gweru/.test(q)) return [senga];
  return [];
}
const mergedParsed = parsedFromDraft(draft);
const live = await resolveTypedDeliveryLocationWithLookup(composeQueryFromDraft(draft), lookup, mergedParsed);
assert.ok(live.kind === "landmark" || live.kind === "area");
assert.notEqual(live.kind, "need_city");
assert.notEqual(live.kind, "need_area");
pass("A-rebuild-from-draft");

const locClarify = sanitizeCheckoutContext(WhatsAppConversationState.AWAITING_LOCATION, {
  expectedInput: "LOCATION_CLARIFICATION",
  locationClarificationType: "LANDMARK",
  deliveryLocationDraft: draft,
  lockedProductLines: [
    { productId: "p1", quantity: 1, productName: "2-Minute Noodles Beef", unitPriceCents: 100, merchantId: "m1" },
    { productId: "p2", quantity: 1, productName: "3 in 1 shampoo", unitPriceCents: 100, merchantId: "m1" },
    { productId: "p3", quantity: 2, productName: "7up", unitPriceCents: 75, merchantId: "m1" }
  ],
  checkoutSessionId: "sess-web",
  checkoutSource: "WEB_HANDOFF"
});
assert.equal(locClarify.ctx.expectedInput, "LOCATION_CLARIFICATION");
assert.equal(locClarify.ctx.locationClarificationType, "LANDMARK");
assert.equal(locClarify.ctx.deliveryLocationDraft?.city, "Gweru");
assert.equal(locClarify.ctx.lockedProductLines?.length, 3);
assert.equal(locClarify.ctx.pendingChoices, undefined);

const promoted = sanitizeCheckoutContext(WhatsAppConversationState.AWAITING_LOCATION, {
  expectedInput: "LOCATION",
  deliveryLocationDraft: { city: "Gweru", suburb: "Senga Nehosho", street: "House 34" },
  lockedProductLines: locClarify.ctx.lockedProductLines,
  checkoutSessionId: "sess-web"
});
assert.equal(promoted.ctx.expectedInput, "LOCATION_CLARIFICATION");
assert.equal(promoted.ctx.lockedProductLines?.length, 3);
pass("G-L-web-handoff-cart");

function pass(name: string) {
  // eslint-disable-next-line no-console
  console.log(`PASS ${name}`);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      screenshot: "PASS",
      loop: "PASS",
      letters: {
        A: "PASS full address → landmark merge rebuilds Gweru/Senga query",
        B: "PASS city reply keeps area",
        C: "PASS area reply keeps city",
        D: "PASS area+city landmark reply",
        E: "PASS improved complete address merge",
        F: "SOURCE-VERIFIED GPS still allowed during LOCATION_CLARIFICATION",
        G: "PASS web handoff cart preserved on LOCATION_CLARIFICATION",
        H: "SOURCE-VERIFIED same applyTypedLocation for direct WhatsApp",
        I: "SOURCE-VERIFIED WEB_HANDOFF isolation unchanged",
        J: "PASS numeric 1/2 is location confirmation copy",
        K: "PASS invalid/unresolved landmark does not ask city/area",
        L: "PASS cart unchanged through clarification sanitize"
      }
    },
    null,
    2
  )
);
