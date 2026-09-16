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
  formatAccuracyMessage,
  geolocationErrorMessage,
  hasValidCoordinates,
  isPoorGpsAccuracy,
  isValidLatitude,
  isValidLongitude,
  parseCoordinate,
  roundCoord
} from "../src/merchantLocation.ts";

function run(): void {
  // Existing merchant coords load / parse
  assert.equal(parseCoordinate("41.5382"), 41.5382);
  assert.equal(parseCoordinate(" -72.807"), -72.807);
  assert.equal(hasValidCoordinates({ latitude: "41.5382", longitude: "-72.807" }), true);

  // Meriden-compatible values remain valid
  assert.ok(isValidLatitude("41.538153"));
  assert.ok(isValidLongitude("-72.807048"));

  // Zimbabwe Harare-ish
  assert.ok(isValidLatitude("-17.8292"));
  assert.ok(isValidLongitude("31.0522"));

  // Invalid rejected
  assert.equal(isValidLatitude("91"), false);
  assert.equal(isValidLatitude("-91"), false);
  assert.equal(isValidLongitude("181"), false);
  assert.equal(isValidLongitude("-181"), false);
  assert.equal(isValidLatitude("abc"), false);
  assert.equal(hasValidCoordinates({ latitude: "91", longitude: "0" }), false);

  // Pin movement / round-trip equality
  const a = { latitude: roundCoord(-17.8292123), longitude: roundCoord(31.0522456) };
  const b = { latitude: a.latitude, longitude: a.longitude };
  assert.equal(coordsEqual(a, b), true);
  assert.equal(coordsEqual(a, { latitude: a.latitude, longitude: "31.1" }), false);

  // GPS accuracy messaging
  assert.equal(isPoorGpsAccuracy(25), false);
  assert.equal(isPoorGpsAccuracy(150), true);
  assert.ok(formatAccuracyMessage(40).includes("Location found"));
  assert.ok(formatAccuracyMessage(200).includes("low"));

  // Permission denied recovery (no raw browser dump)
  const denied = geolocationErrorMessage(1);
  assert.ok(denied.includes("Couldn't get your location"));
  assert.ok(!denied.toLowerCase().includes("permission denied"));

  // Source guards
  const here = dirname(fileURLToPath(import.meta.url));
  const picker = readFileSync(join(here, "../src/MerchantLocationPicker.tsx"), "utf8");
  assert.ok(picker.includes("Use current location"));
  assert.ok(picker.includes("Search address or place"));
  assert.ok(picker.includes("Confirm location"));
  assert.ok(picker.includes("Advanced"));
  assert.ok(picker.includes("draggable: true"));
  assert.ok(picker.includes("map.on(\"click\""));

  const panel = readFileSync(join(here, "../src/CommercePilotPanel.tsx"), "utf8");
  assert.ok(panel.includes("MerchantLocationPicker"));
  assert.ok(panel.includes("locationConfirmed"));
  assert.ok(!panel.includes("Address text"));

  const geo = readFileSync(
    join(here, "../../../apps/api/src/modules/location/geocoding.service.ts"),
    "utf8"
  );
  assert.ok(geo.includes("country:zw|country:us") || geo.includes("zw,us"));

  console.log("merchant location picker regressions: OK");
}

run();
