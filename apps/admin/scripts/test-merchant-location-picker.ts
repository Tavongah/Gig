/**
 * Admin merchant location picker regressions (no browser).
 * Run: npx tsx scripts/test-merchant-location-picker.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  coordsEqual,
  defaultShopLocationLabel,
  formatAccuracyMessage,
  geolocationErrorMessage,
  hasValidCoordinates,
  isPoorGpsAccuracy,
  isValidLatitude,
  isValidLongitude,
  parseCoordinate,
  presentationLocationLabel,
  roundCoord
} from "../src/merchantLocation.ts";

function run(): void {
  // 1 / 9 / 10 — Zimbabwe + US coordinates accepted
  assert.equal(parseCoordinate("41.5382"), 41.5382);
  assert.equal(parseCoordinate(" -72.807"), -72.807);
  assert.equal(hasValidCoordinates({ latitude: "41.5382", longitude: "-72.807" }), true);
  assert.ok(isValidLatitude("41.538153"));
  assert.ok(isValidLongitude("-72.807048"));
  assert.ok(isValidLatitude("-17.8292"));
  assert.ok(isValidLongitude("31.0522"));
  assert.ok(hasValidCoordinates({ latitude: "-17.829212", longitude: "31.052246" }));

  // 11 / 12 — invalid rejected
  assert.equal(isValidLatitude("91"), false);
  assert.equal(isValidLatitude("-91"), false);
  assert.equal(isValidLongitude("181"), false);
  assert.equal(isValidLongitude("-181"), false);
  assert.equal(isValidLatitude("abc"), false);
  assert.equal(hasValidCoordinates({ latitude: "91", longitude: "0" }), false);

  // 4 / 5 — pin movement updates coords (round-trip equality)
  const a = { latitude: roundCoord(-17.8292123), longitude: roundCoord(31.0522456) };
  const b = { latitude: a.latitude, longitude: a.longitude };
  assert.equal(coordsEqual(a, b), true);
  assert.equal(coordsEqual(a, { latitude: a.latitude, longitude: "31.1" }), false);

  // 9 — GPS accuracy messaging (does not block)
  assert.equal(isPoorGpsAccuracy(25), false);
  assert.equal(isPoorGpsAccuracy(150), true);
  assert.ok(formatAccuracyMessage(40).toLowerCase().includes("confirm"));
  assert.ok(formatAccuracyMessage(200).includes("low"));
  assert.ok(formatAccuracyMessage(200).includes("confirming") || formatAccuracyMessage(200).includes("confirm"));

  // 3 / 22 — permission denied recovery (no raw browser dump)
  const denied = geolocationErrorMessage(1);
  assert.ok(denied.includes("Couldn't access your location") || denied.includes("Couldn't get your location"));
  assert.ok(!denied.toLowerCase().includes("permission denied"));
  assert.ok(!denied.toLowerCase().includes("geolocationpositionerror"));

  // 7 / 8 — label optional; default presentation when GPS-only
  assert.equal(defaultShopLocationLabel(), "Shop location");
  assert.equal(presentationLocationLabel(""), "Shop location");
  assert.equal(presentationLocationLabel("  "), "Shop location");
  assert.equal(presentationLocationLabel("Glen Norah B, Harare"), "Glen Norah B, Harare");

  // Source guards — UX surface
  const here = dirname(fileURLToPath(import.meta.url));
  const picker = readFileSync(join(here, "../src/MerchantLocationPicker.tsx"), "utf8");
  assert.ok(picker.includes("Use my current location"));
  assert.ok(picker.includes("Search address or place"));
  assert.ok(picker.includes("Confirm location"));
  assert.ok(picker.includes("Shop location confirmed") || picker.includes("✓ Shop location confirmed"));
  assert.ok(picker.includes("Change location"));
  assert.ok(picker.includes("Advanced location settings") || picker.includes("Enter coordinates manually"));
  assert.ok(picker.includes("draggable: true"));
  assert.ok(picker.includes('map.on("click"'));
  assert.ok(picker.includes("allowIncomplete: true"));
  assert.ok(picker.includes("reverse-geocode"));
  // 2 — not saved before confirm (confirm gate present; no auto-submit)
  assert.ok(!picker.includes("createMerchant"));
  assert.ok(picker.includes("onConfirmedChange(true)"));

  const panel = readFileSync(join(here, "../src/CommercePilotPanel.tsx"), "utf8");
  assert.ok(panel.includes("MerchantLocationPicker"));
  assert.ok(panel.includes("locationConfirmed"));
  assert.ok(panel.includes("presentationLocationLabel"));
  assert.ok(panel.includes("Confirm the shop location"));
  // Opening edit must load coords without auto-overwrite — loadMerchant sets confirmed true
  assert.ok(panel.includes("setLocationConfirmed(true)"));
  assert.ok(!panel.includes("Address text"));

  const helpers = readFileSync(join(here, "../src/merchantLocation.ts"), "utf8");
  assert.ok(helpers.includes("isValidLatitude"));
  assert.ok(helpers.includes("isValidLongitude"));
  assert.ok(helpers.includes("defaultShopLocationLabel"));

  const geo = readFileSync(
    join(here, "../../../apps/api/src/modules/location/geocoding.service.ts"),
    "utf8"
  );
  assert.ok(geo.includes("country:zw|country:us") || geo.includes("zw,us") || geo.includes("country:ZW|country:US"));
  assert.ok(geo.includes("allowIncomplete"));

  // Courier / matching architecture not rewritten by this feature
  const orderSvc = readFileSync(
    join(here, "../../../apps/api/src/modules/commerce/order.service.ts"),
    "utf8"
  );
  assert.ok(orderSvc.includes("merchant.latitude") || orderSvc.includes("latitude"));

  console.log("merchant location picker regressions: OK");
}

run();
