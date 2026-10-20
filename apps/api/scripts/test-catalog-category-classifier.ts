/**
 * Offline category classifier tests. No DB. No catalog writes.
 * Run: npx tsx scripts/test-catalog-category-classifier.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyFutureCatalogCategory,
  classifyCatalogCategory,
  sameCatalogCategoryFamily,
  summarizeCategoryClassifications,
  type CatalogCategoryClassification,
  type CatalogCategoryInput
} from "../../../packages/shared/src/catalog-category-classifier.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function readSrc(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

function classify(partial: CatalogCategoryInput) {
  return classifyCatalogCategory(partial);
}

const shoesWrong = classify({ name: "Nike Air Max Running Shoes", category: "Groceries" });
assert.equal(shoesWrong.suggestedCategory, "Shoes");
assert.equal(shoesWrong.confidence, "HIGH");
assert.equal(shoesWrong.appliedWouldChange, true);
assert.ok(shoesWrong.evidence.includes("shoes"));

const adidasWrong = classify({ name: "Adidas Running Shoes", category: "Groceries" });
assert.equal(adidasWrong.suggestedCategory, "Shoes");
assert.equal(adidasWrong.confidence, "HIGH");

const breadOk = classify({ name: "Lobels White Bread 700g", brand: "Lobels", category: "Bread & Bakery" });
assert.equal(breadOk.suggestedCategory, "Bread & Bakery");
assert.equal(breadOk.confidence, "HIGH");
assert.equal(breadOk.agrees, true);
assert.equal(breadOk.appliedWouldChange, false);

const breadWrong = classify({ name: "Lobels White Bread", category: "Snacks" });
assert.equal(breadWrong.suggestedCategory, "Bread & Bakery");
assert.equal(breadWrong.confidence, "HIGH");
assert.equal(breadWrong.appliedWouldChange, true);

const colaWrong = classify({ name: "Coca-Cola 2L", category: "Household" });
assert.equal(colaWrong.suggestedCategory, "Drinks");
assert.equal(colaWrong.confidence, "HIGH");
assert.ok(colaWrong.evidence.includes("cola"));

const colaOk = classify({ name: "Coca-Cola 2L", category: "Drinks" });
assert.equal(colaOk.agrees, true);
assert.equal(colaOk.appliedWouldChange, false);

const juiceFamily = classify({ name: "Mazoe Orange Crush", brand: "Mazoe", category: "Juices" });
assert.equal(sameCatalogCategoryFamily("Juices", "Drinks"), true);
assert.equal(juiceFamily.appliedWouldChange, false);

const ambiguous = classify({ name: "Classic Original 500ml", category: "Drinks" });
assert.ok(ambiguous.confidence === "LOW" || !ambiguous.suggestedCategory);
assert.equal(ambiguous.appliedWouldChange, false);

const brandVsType = classify({ name: "Nike Body Lotion", brand: "Nike", category: "Shoes" });
assert.equal(brandVsType.suggestedCategory, "Personal Care");
assert.equal(brandVsType.confidence, "HIGH");
assert.ok(brandVsType.evidence.includes("lotion"));

const brandAlone = classify({ name: "Nike", brand: "Nike", category: "Groceries" });
assert.notEqual(brandAlone.confidence, "HIGH");
assert.equal(brandAlone.appliedWouldChange, false);

const typoCase = classify({ name: "RUNNING SHOES!!!", category: "groceries" });
assert.equal(typoCase.suggestedCategory, "Shoes");
assert.equal(typoCase.confidence, "HIGH");

const soap = classify({ name: "Bath Soap", category: "Personal Care" });
assert.equal(soap.suggestedCategory, "Personal Care");
assert.equal(soap.agrees, true);

const exerciseBook = classify({ name: "A4 Exercise Book", category: "Groceries" });
assert.equal(exerciseBook.suggestedCategory, "Student / Everyday Essentials");
assert.equal(exerciseBook.confidence, "HIGH");

const charger = classify({ name: "Phone Charger", category: "Groceries" });
assert.equal(charger.suggestedCategory, "Electronics");
assert.equal(charger.confidence, "HIGH");

const shirt = classify({ name: "Cotton T Shirt", category: "Groceries" });
assert.equal(shirt.suggestedCategory, "Fashion");

const chips = classify({ name: "Cheese Snacks", category: "Snacks" });
assert.equal(chips.suggestedCategory, "Snacks");
assert.equal(chips.agrees, true);

const bleach = classify({ name: "Household Bleach", category: "Household" });
assert.equal(bleach.agrees, true);

const bakingSoda = classify({ name: "Baking soda", category: "Baking" });
assert.notEqual(bakingSoda.suggestedCategory, "Drinks");
assert.equal(bakingSoda.appliedWouldChange, false);

const beerSticks = classify({ name: "Beer sticks", category: "Snacks" });
assert.notEqual(beerSticks.suggestedCategory, "Alcohol");
assert.equal(beerSticks.appliedWouldChange, false);

const shortBread = classify({ name: "Hazelnuts and short bread chocolate", category: "Snacks" });
assert.notEqual(shortBread.suggestedCategory, "Bread & Bakery");
assert.equal(shortBread.appliedWouldChange, false);

const futureHigh = applyFutureCatalogCategory({
  name: "Adidas Running Shoes",
  category: "Groceries"
});
assert.equal(futureHigh.applied, true);
assert.equal(futureHigh.category, "Shoes");

const futureLow = applyFutureCatalogCategory({
  name: "Classic Original 500ml",
  category: "Drinks"
});
assert.equal(futureLow.applied, false);
assert.equal(futureLow.category, "Drinks");

const futureAgree = applyFutureCatalogCategory({
  name: "White Bread",
  category: "Bread & Bakery"
});
assert.equal(futureAgree.applied, false);
assert.equal(futureAgree.category, "Bread & Bakery");

const failed = applyFutureCatalogCategory({ name: "Anything", category: "Snacks" }, () => {
  throw new Error("boom");
});
assert.equal(failed.applied, false);
assert.equal(failed.category, "Snacks");
assert.deepEqual(failed.classification.evidence, ["classifier-error"]);

const dryRows: CatalogCategoryClassification[] = [
  shoesWrong,
  breadOk,
  ambiguous,
  classify({ name: "Unknown Item", category: "Other" })
];
const summary = summarizeCategoryClassifications(dryRows);
assert.equal(summary.productsChecked, 4);
assert.ok(summary.highConfidenceMismatches >= 1);
assert.ok(summary.categoryAgrees >= 1);

const classifierSrc = readFileSync(
  join(root, "../../packages/shared/src/catalog-category-classifier.ts"),
  "utf8"
);
assert.doesNotMatch(classifierSrc, /openai|anthropic|fetch\(|prisma\./i);
assert.doesNotMatch(classifierSrc, /UPDATE\s+"CatalogProduct"/i);
assert.match(classifierSrc, /confidence === "HIGH"/);

const catalogService = readSrc("src/modules/commerce/catalog.service.ts");
assert.match(catalogService, /applyFutureCatalogCategory/);
assert.doesNotMatch(catalogService, /classifyCatalogCategory.*updateMany/);
const migrateFn = catalogService.slice(catalogService.indexOf("migrateExistingProductsToCatalog"));
assert.match(migrateFn, /product\.category\?\.trim\(\) \|\| "Uncategorized"/);
const dryRunSrc = readSrc("scripts/dry-run-catalog-category-classifier.ts");
assert.match(dryRunSrc, /writes: 0/);
assert.doesNotMatch(dryRunSrc, /prisma/);

console.log(
  JSON.stringify(
    {
      ok: true,
      samples: {
        shoesWrong,
        breadOk,
        colaWrong,
        ambiguous: { confidence: ambiguous.confidence, suggested: ambiguous.suggestedCategory },
        brandVsType,
        futureHigh: { applied: futureHigh.applied, category: futureHigh.category },
        futureLow: { applied: futureLow.applied, category: futureLow.category },
        failed: { applied: failed.applied, category: failed.category }
      }
    },
    null,
    2
  )
);
