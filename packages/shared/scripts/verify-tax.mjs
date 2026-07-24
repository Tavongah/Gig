/**
 * Quick verification for CT tax + customer total helpers.
 * Run: node packages/shared/scripts/verify-tax.mjs
 */
import {
  calculateApplicableTaxCents,
  calculateCustomerTotalCents,
  CT_SALES_TAX_RATE_BPS
} from "../dist/index.js";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const ct = calculateApplicableTaxCents(10_000, { region: "CT", country: "US" });
assert(ct.taxRateBps === CT_SALES_TAX_RATE_BPS, "CT rate should be 635 bps");
assert(ct.taxAmountCents === 635, `Expected 635 tax on $100, got ${ct.taxAmountCents}`);

const ny = calculateApplicableTaxCents(10_000, { region: "NY", country: "US" });
assert(ny.taxAmountCents === 0, "NY should be 0 until configured");

const total = calculateCustomerTotalCents({
  serviceAmountCents: 10_000,
  taxAmountCents: 635
});
assert(total === 10_635, `Customer total should be 10635, got ${total}`);

console.log("verify-tax: ok");
