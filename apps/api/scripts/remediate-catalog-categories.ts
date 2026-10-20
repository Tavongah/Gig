/**
 * Controlled CatalogProduct.category remediation.
 * Default: dry-run (zero writes). Explicit --apply required for writes.
 *
 *   npx tsx scripts/remediate-catalog-categories.ts
 *   npx tsx scripts/remediate-catalog-categories.ts --dry-run
 *   npx tsx scripts/remediate-catalog-categories.ts --apply
 */
import { prisma } from "../src/config/prisma.ts";
import { runCatalogCategoryRemediationCli } from "../src/catalog-category-remediation.cli.ts";

runCatalogCategoryRemediationCli()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
