/**
 * Backfill CatalogProduct links for existing merchant Product rows.
 * Run: npx tsx apps/api/scripts/migrate-products-to-catalog.ts
 *
 * Safe / idempotent: does not change prices, stock, merchant ownership, or order history.
 */
import { migrateExistingProductsToCatalog } from "../src/modules/commerce/catalog.service.js";

async function main() {
  const report = await migrateExistingProductsToCatalog();
  console.log(JSON.stringify(report, null, 2));
  if (report.errors.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
