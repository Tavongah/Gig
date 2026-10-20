/**
 * Read-only classifier dry-run. NEVER writes CatalogProduct rows.
 * Usage:
 *   npx tsx scripts/dry-run-catalog-category-classifier.ts [csv-path]
 * CSV columns: id,name,brand,category,subcategory,status,size_label,description
 */
import { readFileSync } from "node:fs";
import {
  classifyCatalogCategory,
  summarizeCategoryClassifications,
  type CatalogCategoryClassification
} from "../../../packages/shared/src/catalog-category-classifier.ts";

function parseCsvLine(line: string): string[] {
  const parts: string[] = [];
  let cur = "";
  let quoted = false;
  for (const ch of line) {
    if (ch === '"') {
      quoted = !quoted;
      continue;
    }
    if (ch === "," && !quoted) {
      parts.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  parts.push(cur);
  return parts;
}

function loadRows(path: string) {
  const raw = readFileSync(path, "utf8").replace(/^\uFEFF/, "");
  const lines = raw.trim().split(/\r?\n/);
  const header = parseCsvLine(lines[0] ?? "").map((h) => h.trim().toLowerCase());
  const idx = (name: string) => header.indexOf(name);
  return lines.slice(1).map((line) => {
    const cols = parseCsvLine(line);
    return {
      id: cols[idx("id")] ?? "",
      name: cols[idx("name")] ?? "",
      brand: cols[idx("brand")] ?? "",
      category: cols[idx("category")] ?? "",
      subcategory: cols[idx("subcategory")] ?? "",
      status: cols[idx("status")] ?? "",
      sizeLabel: cols[idx("size_label")] ?? cols[idx("sizelabel")] ?? "",
      description: cols[idx("description")] ?? ""
    };
  });
}

const csvPath = process.argv[2];
if (!csvPath) {
  console.log(JSON.stringify({ ok: true, skipped: "no-csv", writes: 0 }, null, 2));
  process.exit(0);
}

const products = loadRows(csvPath);
const classifications: CatalogCategoryClassification[] = products.map((p) =>
  classifyCatalogCategory({
    name: p.name,
    brand: p.brand,
    description: p.description,
    category: p.category,
    subcategory: p.subcategory,
    sizeLabel: p.sizeLabel
  })
);

const summary = summarizeCategoryClassifications(classifications);
const highMismatches = products
  .map((p, i) => ({ product: p, row: classifications[i] }))
  .filter((x) => x.row.confidence === "HIGH" && !x.row.agrees)
  .slice(0, 25)
  .map((x) => ({
    name: x.product.name,
    status: x.product.status,
    current: x.row.currentCategory,
    suggested: x.row.suggestedCategory,
    confidence: x.row.confidence,
    evidence: x.row.evidence
  }));

console.log(
  JSON.stringify(
    {
      ok: true,
      writes: 0,
      source: csvPath,
      ...summary,
      representativeHighConfidenceMismatches: highMismatches
    },
    null,
    2
  )
);
