/**
 * Offline category remediation policy tests. No production writes.
 * Run: npx tsx scripts/test-catalog-category-remediation.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { classifyCatalogCategory } from "../../../packages/shared/src/catalog-category-classifier.ts";
import { evaluateCatalogCategoryRemediation } from "../src/modules/commerce/catalog-category-remediation.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function decide(partial: {
  id?: string;
  name: string;
  brand?: string | null;
  description?: string | null;
  category: string;
  status: string;
}) {
  return evaluateCatalogCategoryRemediation({
    id: partial.id ?? "test-id",
    name: partial.name,
    brand: partial.brand,
    description: partial.description,
    status: partial.status,
    classification: classifyCatalogCategory({
      name: partial.name,
      brand: partial.brand,
      description: partial.description,
      category: partial.category
    })
  });
}

const slides = decide({
  name: "Nike mind slides",
  brand: "Nike",
  category: "Personal Care",
  status: "PENDING"
});
assert.equal(slides.action, "CORRECT");
assert.equal(slides.suggestedCategory, "Shoes");
assert.equal(slides.confidence, "HIGH");
assert.equal(slides.status, "PENDING");

const crocs = decide({
  name: "Classic Crocs",
  category: "Personal Care",
  status: "PENDING"
});
assert.equal(crocs.action, "CORRECT");
assert.equal(crocs.suggestedCategory, "Shoes");

const dunk = decide({
  name: "Nike dunk",
  brand: "Nike",
  category: "Personal Care",
  status: "PENDING"
});
assert.notEqual(dunk.confidence, "HIGH");
assert.equal(dunk.action, "SKIP");

const soup = decide({
  name: "Karinga beef n vegetables",
  brand: "Soup",
  category: "Groceries",
  status: "APPROVED"
});
assert.equal(soup.confidence, "HIGH");
assert.equal(soup.suggestedCategory, "Vegetables");
assert.equal(soup.action, "SKIP");
assert.equal(soup.reason, "conflicting product identity");

const archived = decide({
  name: "Nike mind slides",
  category: "Personal Care",
  status: "ARCHIVED"
});
assert.equal(archived.action, "SKIP");
assert.equal(archived.reason, "ARCHIVED");

const alreadyShoes = decide({
  name: "Nike mind slides",
  category: "Shoes",
  status: "PENDING"
});
assert.equal(alreadyShoes.action, "SKIP");

const tomatoes = decide({
  name: "Tomatoes",
  category: "Household",
  status: "APPROVED"
});
assert.notEqual(tomatoes.confidence, "HIGH");
assert.equal(tomatoes.action, "SKIP");

const biscuits = decide({
  name: "Charhons Biscuits",
  category: "Drinks",
  status: "APPROVED"
});
assert.equal(biscuits.action, "CORRECT");
assert.equal(biscuits.suggestedCategory, "Biscuits");
assert.equal(biscuits.status, "APPROVED");

const spinach = decide({
  name: "Spinach",
  category: "Household",
  status: "APPROVED"
});
assert.equal(spinach.action, "CORRECT");
assert.equal(spinach.suggestedCategory, "Vegetables");

const babyWipes = decide({
  name: "Baby wipes",
  brand: "Huggies",
  category: "Personal Care",
  status: "APPROVED"
});
assert.equal(babyWipes.action, "CORRECT");
assert.equal(babyWipes.suggestedCategory, "Baby Products");

const src = readFileSync(join(root, "src/modules/commerce/catalog-category-remediation.ts"), "utf8");
assert.match(src, /UPDATE "CatalogProduct"/);
assert.match(src, /SET category =/);
assert.match(src, /confidence !== "HIGH"/);
assert.doesNotMatch(src, /SET status/i);
assert.doesNotMatch(src, /approvalStatus/);
assert.doesNotMatch(src, /updateMany/);
assert.doesNotMatch(src, /SET name|SET brand|SET description|SET subcategory/);

const cli = readFileSync(join(root, "src/catalog-category-remediation.cli.ts"), "utf8");
assert.match(cli, /argv.includes\("--apply"\)/);
assert.match(cli, /Unknown argument/);

const script = readFileSync(join(root, "scripts/remediate-catalog-categories.ts"), "utf8");
assert.match(script, /Default: dry-run/);
assert.doesNotMatch(script, /--apply"\)\s*\|\|\s*true/);

const classifier = readFileSync(
  join(root, "../../packages/shared/src/catalog-category-classifier.ts"),
  "utf8"
);
assert.match(classifier, /confidence === "HIGH"/);

const catalogService = readFileSync(join(root, "src/modules/commerce/catalog.service.ts"), "utf8");
assert.match(catalogService, /applyFutureCatalogCategory/);

console.log(
  JSON.stringify(
    {
      ok: true,
      writes: 0,
      samples: {
        slides: { action: slides.action, suggested: slides.suggestedCategory, status: slides.status },
        dunk: { action: dunk.action, confidence: dunk.confidence },
        soup: { action: soup.action, reason: soup.reason },
        archived: archived.action,
        biscuits: biscuits.suggestedCategory
      }
    },
    null,
    2
  )
);
