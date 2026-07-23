import assert from "node:assert/strict";
import {
  calculatePriceEstimate,
  DEFAULT_HOURLY_RATE_CENTS,
  resolveHourlyRateCents,
  roundBillableMinutes
} from "../dist/index.js";

const category = {
  baseRateCents: 4500,
  hourlyRateCents: 9999,
  distanceRateCents: 0,
  multiplier: 1
};

const baseInput = {
  serviceCategoryId: "00000000-0000-0000-0000-000000000001",
  location: {
    latitude: 41.76,
    longitude: -72.67,
    formattedAddress: "Hartford, CT",
    addressLine1: "1 Main St",
    city: "Hartford",
    region: "CT",
    postalCode: "06103",
    country: "US"
  },
  estimatedHours: 2,
  distanceMiles: 0,
  urgency: "STANDARD",
  startsAt: new Date().toISOString(),
  demandMultiplier: 1,
  size: "MEDIUM"
};

const fixed = calculatePriceEstimate({ ...baseInput, pricingType: "FIXED" }, category);
assert.equal(fixed.laborCents, 0);
assert.equal(fixed.hourlyRateCents, 0);
assert.equal(fixed.baseRateCents, 4500);
assert.equal(fixed.totalCents, 4500);
assert.equal(resolveHourlyRateCents("FIXED"), 0);

const timed = calculatePriceEstimate({ ...baseInput, pricingType: "ESTIMATE_TIMER" }, category);
assert.equal(timed.hourlyRateCents, DEFAULT_HOURLY_RATE_CENTS);
assert.equal(timed.baseRateCents, 0);
assert.equal(timed.laborCents, 2 * DEFAULT_HOURLY_RATE_CENTS);
assert.equal(timed.totalCents, 5000);
assert.equal(resolveHourlyRateCents("ESTIMATE_TIMER"), DEFAULT_HOURLY_RATE_CENTS);
assert.equal(resolveHourlyRateCents("HOURLY"), DEFAULT_HOURLY_RATE_CENTS);

assert.equal(roundBillableMinutes(10, 60, 15), 60);
assert.equal(roundBillableMinutes(61, 60, 15), 75);
assert.equal(roundBillableMinutes(98, 60, 15), 105);

const finalEstimate = calculatePriceEstimate(
  { ...baseInput, pricingType: "ESTIMATE_TIMER", estimatedHours: 75 / 60 },
  category
);
assert.equal(finalEstimate.totalCents, Math.round(DEFAULT_HOURLY_RATE_CENTS * (75 / 60)));

console.log("MVP pricing checks passed.");
